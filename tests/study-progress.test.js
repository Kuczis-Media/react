'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const scheduler = require('../public/assets/js/study-scheduler');
const model = require('../public/members/module/studio/quiz-model');
const storage = require('../netlify/progress-storage');
const study = require('../netlify/study-progress');
const endpoint = require('../netlify/functions/progress');
const repository = require('../netlify/content-repository');
const now = Date.parse('2026-09-14T10:00:00Z');
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
function deck() { return model.createQuiz({ mode: 'deck', quizId: 'chemia', metadata: { title: 'Chemia', status: 'published', courseId: 'course' }, questions: [
  { questionId: 'f1', type: 'flashcard', front: { text: 'Woda' }, back: { text: '\\(\\ce{H2O}\\)' } },
  { questionId: 'q2', type: 'text', prompt: 'Tkanka?', acceptedAnswers: ['tkanka nabłonkowa'] }
] }); }
class MemoryStore {
  entries = new Map(); revision = 0; reads = []; writes = [];
  async getWithMetadata(key) { this.reads.push(key); const e = this.entries.get(key); return e ? { data: e.data, etag: e.etag, metadata: {} } : null; }
  async set(key, data, options = {}) { const previous = this.entries.get(key);
    if ((options.onlyIfNew && previous) || (options.onlyIfMatch && previous?.etag !== options.onlyIfMatch)) return { modified: false };
    this.writes.push(key); this.entries.set(key, { data, etag: String(++this.revision) }); return { modified: true };
  }
  async list({ prefix }) { return { blobs: [...this.entries.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })) }; }
}
function environment(t) {
  const store = new MemoryStore(), value = deck(), user = { id: 'student-one', app_metadata: { roles: ['active'] } };
  t.mock.method(repository, 'readAsset', async () => ({ content: JSON.stringify(value), repositoryId: 'glowne' }));
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify(user)));
  endpoint._test.setStoreFactory(() => store); t.after(() => endpoint._test.setStoreFactory(null));
  const ctx = { clientContext: { user, identity: { url: 'https://course.example/.netlify/identity' } } };
  const call = async (method, body, query = { view: 'study', repo: 'glowne', deck: 'chemia' }) => {
    const result = await endpoint.handler({ httpMethod: method, headers: { authorization: 'Bearer fixture', 'content-type': 'application/json', origin: 'https://course.example', host: 'course.example' }, queryStringParameters: query, ...(body ? { body: JSON.stringify(body) } : {}) }, ctx);
    return { status: result.statusCode, ...JSON.parse(result.body) };
  };
  return { store, value, user, call };
}

test('NextMed scheduler has ordered intervals, deterministic dueAt, retained answers and bounded growth', () => {
  const initial = [1,2,3,4].map((grade) => scheduler.review(null, grade, now));
  assert.equal(Date.parse(initial[0].dueAt) - now, 60000);
  assert.deepEqual(initial.map((s) => s.interval), [1/1440, 1/6, 1, 3]);
  assert.equal(initial[0].lastGrade, 1); assert.equal(initial[0].incorrect, 1);
  let value = initial[2];
  for (let i = 0; i < 50; i++) value = scheduler.review(value, 4, now + i * scheduler.DAY, 'Odpowiedź');
  assert.equal(value.interval, 365); assert.equal(value.ease, 1.6); assert.equal(value.attempts, 51); assert.equal(value.lastAnswer, 'Odpowiedź');
  const reset = scheduler.review(value, 1, now); assert.equal(reset.interval, 1/1440); assert.ok(reset.ease < value.ease);
  assert.throws(() => scheduler.review(null, 0, now), /INVALID_REVIEW/);
});
test('review modes select due, new, wrong and hard without mixing per-mask card IDs', () => {
  const all = scheduler.cards(deck().questions), records = { f1: scheduler.review(null, 2, now) };
  assert.deepEqual(scheduler.select(all, records, 'new', now).map((q) => q.studyKey), ['q2']);
  assert.equal(scheduler.select(all, records, 'hard', now).length, 1);
  assert.equal(scheduler.select(all, records, 'due', now).length, 0);
  assert.equal(scheduler.select(all, records, 'due', now + 4 * 3600000).length, 1);
  records.q2 = scheduler.review(null, 1, now, 'tkanki', false);
  assert.equal(scheduler.stats(all, records, now + 60000).due, 1);
  assert.equal(scheduler.select(all, records, 'failed', now).length, 1);
  const q = model.createQuestion({ type: 'image_occlusion', occlusion: { mode: 'random', masks: [{ maskId: 'a', x: .1, y: .1, width: .1, height: .1 }, { maskId: 'b', x: .3, y: .3, width: .1, height: .1 }] } });
  assert.equal(scheduler.cards([q]).length, 2); assert.equal(scheduler.select(scheduler.cards([q]), {}, 'all').length, 1);
});
test('progress endpoint saves per-account reviews, grades objective answers on server and deduplicates retries', async (t) => {
  const { call, store } = environment(t);
  const first = await call('GET'); assert.equal(first.status, 200); assert.equal(first.summary.new, 2);
  const body = { generation: first.generation, reviews: [{ eventId: 'test-review-event-0001', cardId: 'f1', grade: 3 }, { eventId: 'test-review-event-0002', cardId: 'q2', grade: 4, answer: 'błędna' }] };
  store.reads = [];
  const saved = await call('POST', body); assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal(saved.records.f1.interval, 1); assert.equal(saved.records.q2.lastGrade, 1); assert.equal(saved.records.q2.lastAnswer, 'błędna');
  assert.ok(store.reads.filter((k) => k.startsWith('study/')).length <= 2, 'A batch reads only touched shards, not all cards/history');
  const again = await call('POST', body); assert.equal(again.records.f1.attempts, 1); assert.equal(again.records.q2.incorrect, 1);
  const current = await call('GET'); assert.equal(current.summary.attempts, 2); assert.equal(current.summary.new, 0);
  const summary = await call('GET', null, { view: 'study-summary' }); assert.equal(summary.decks.length, 1); assert.equal(summary.decks[0].incorrect, 1);
  const user = await storage.readUser(store, 'student-one'); assert.equal(user.document.records['quiz:glowne:chemia'].details.studyAttempts, 2);
  assert.equal(user.document.records['quiz:glowne:chemia'].progressPercent, 100);
  assert.ok([...store.entries.values()].every((e) => Buffer.byteLength(e.data) < 1024 * 1024));
});
test('study follows authentication, ownership, activation, tracking and course reset', async (t) => {
  const { call, store, user, value } = environment(t);
  let state = await call('GET');
  const body = { generation: state.generation, reviews: [{ eventId: 'permissions-event-001', cardId: 'f1', grade: 3 }] };
  assert.equal((await call('POST', { ...body, userId: 'somebody-else' })).status, 400);
  user.id = 'student-two';
  assert.equal((await call('GET')).summary.attempts, 0);
  assert.equal((await call('POST', body)).status, 409);
  user.id = 'student-one'; value.metadata.active = false;
  assert.equal((await call('GET')).status, 404); value.metadata.active = true;
  await call('DELETE', { scope: 'course' }, {});
  assert.equal((await call('POST', body)).error, 'STUDY_RESET');
  assert.equal((await call('GET', null, { view: 'study-summary' })).decks.length, 0);
  state = await call('GET'); assert.notEqual(state.generation, body.generation);
  await store.set(storage.CATALOG_KEY, JSON.stringify({ global: { tracking: 'OFF' } }));
  const off = await call('GET'); assert.equal(off.enabled, false);
  assert.equal((await call('POST', { ...body, generation: state.generation })).saved, false);
  user.app_metadata.roles = [];
  assert.equal((await call('GET')).status, 403);
});
test('study preserves concurrent reviews and dashboard reads summaries only', async (t) => {
  const { call, store } = environment(t), first = await call('GET');
  await Promise.all([3,4].map((grade, i) => call('POST', { generation: first.generation, reviews: [{ eventId: `concurrent-event-00${i}`, cardId: 'f1', grade }] })));
  assert.equal((await call('GET')).records.f1.attempts, 2);
  store.reads = []; const summary = await call('GET', null, { view: 'study-summary' });
  assert.equal(summary.decks[0].attempts, 2);
  assert.equal(store.reads.some((key) => key.startsWith('study/')), false);
});
test('invalid review cards, batches and scores never become arbitrary user data', async (t) => {
  const { call } = environment(t), first = await call('GET');
  for (const reviews of [[{ eventId: 'arbitrary-event-001', cardId: 'missing', grade: 3 }], [{ eventId: 'arbitrary-event-001', cardId: 'f1', grade: 9 }], Array(21).fill({ eventId: 'arbitrary-event-001', cardId: 'f1', grade: 3 })]) {
    assert.equal((await call('POST', { generation: first.generation, reviews })).status, 400);
  }
  assert.equal((await call('GET')).summary.attempts, 0);
});
test('reset from a dashboard tile resets the same pool used by lessons and invalidates pending grades', async (t) => {
  const { call, store } = environment(t);
  await store.set(storage.CATALOG_KEY, JSON.stringify({ nodes: [{ id: 'tile-a', type: 'quiz', title: 'Pula', settings: { repositoryId: 'glowne', quizId: 'chemia' } }] }));
  const first = await call('GET');
  const body = { generation: first.generation, reviews: [{ eventId: 'reset-linked-event-001', cardId: 'f1', grade: 3 }] };
  assert.equal((await call('POST', body)).status, 200);
  assert.equal((await storage.readUser(store, 'student-one')).document.records['tile-a'].progressPercent, 50);
  assert.equal((await call('DELETE', { materialId: 'tile-a' }, {})).reset, true);
  assert.equal((await call('POST', body)).error, 'STUDY_RESET');
  assert.equal((await call('GET')).summary.new, 2);
});
function browser(t) {
  const dom = new JSDOM('<main></main>', { url: 'https://course.example/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.Date.now = () => now;
  t.after(() => dom.window.close()); return dom.window;
}
test('client batches grades, retries with the same IDs, merges server state and does not call AI', async (t) => {
  const w = browser(t), posts = []; let fail = true;
  w.ChemAuth = { getUser: () => ({ id: 'student-one' }) };
  w.ChemProgress = { studyRequest: async (method, body) => {
    if (method === 'GET') return { records: {}, generation: 'generation', enabled: true };
    posts.push(JSON.parse(JSON.stringify(body)));
    if (fail) throw new Error('offline');
    return { saved: true, records: { f1: scheduler.review(null, 3, now) } };
  } };
  w.eval(read('assets/js/study-scheduler.js')); w.eval(read('assets/js/study-client.js'));
  const c = await w.ChemStudyClient.connect('repo', 'deck').load();
  const card = scheduler.cards(deck().questions)[0];
  c.rate(card, 3); assert.equal(posts.length, 0); assert.equal(c.pending, 1);
  w.dispatchEvent(new w.CustomEvent('chem-auth-user-changed', { detail: { authenticated: true } }));
  assert.equal(c.pending, 1, 'A profile refresh must not discard queued grades');
  await assert.rejects(c.flush()); assert.equal(c.pending, 1);
  fail = false; await c.flush(); assert.equal(c.pending, 0); assert.deepEqual(posts[0], posts[1]);
  assert.equal(c.records.f1.dueAt, new Date(now + scheduler.DAY).toISOString());
  c.rate(card, 2); w.dispatchEvent(new w.CustomEvent('chem-auth-user-changed', { detail: { authenticated: false } }));
  assert.equal(c.pending, 0); assert.throws(() => c.rate(card, 3), /Sesja konta/);
  assert.equal(Object.keys(c.records).length, 0);
});
test('study learner exposes modes, reveals cards, saves ratings and keeps wrong objective answers separate', async (t) => {
  const w = browser(t); w.MathJax = { typesetPromise: async () => {}, typesetClear() {} };
  for (const file of ['members/module/lesson/lesson-parser.js', 'assets/js/assessment-text.js', 'assets/js/quiz-practice.js', 'assets/js/quiz-flashcards.js', 'assets/js/study-scheduler.js', 'assets/js/study-view.js']) w.eval(read(file));
  const reviews = [], records = {};
  const client = { records, onStatus(fn) { fn({ enabled: true, pending: 0 }); }, async flush() {}, rate(q, grade, answer, correct) { reviews.push({ id: q.studyKey, grade, answer, correct }); records[q.studyKey] = scheduler.review(records[q.studyKey], correct === false ? 1 : grade, now, answer, correct); } };
  const view = w.ChemQuizFlashcards.study({ questions: deck().questions, getUrl: async () => '', review: client }); w.document.body.append(view);
  assert.equal(view.querySelectorAll('select option').length, 5); assert.equal(view.querySelector('.quiz-flashcard-ratings').hidden, true);
  view.querySelector('[data-flashcard-reveal]').click(); view.querySelector('[data-study-grade="3"]').click();
  const answer = view.querySelector('textarea'); answer.value = 'błąd'; answer.dispatchEvent(new w.Event('input'));
  view.querySelector('[data-practice-check]').click(); view.querySelector('[data-study-grade="4"]').click(); await tick();
  assert.equal(reviews.length, 2); assert.equal(reviews[1].correct, false); assert.equal(records.q2.lastGrade, 1);
  assert.match(view.textContent, /Sesja zakończona/);
});
test('dashboard loads a paginated summary once and generates links to the selected review mode', async (t) => {
  const w = browser(t); w.document.body.innerHTML = '<section id="study-dashboard"></section>';
  let calls = 0;
  w.ChemAuth = { ready: Promise.resolve({ authenticated: true, session: { ok: true } }) };
  w.ChemProgress = { studyRequest: async (_, body, query) => { calls++; return { decks: [{ repositoryId: 'repo', deckId: `deck-${calls}`, title: 'Moja pula', due: 12, new: 4, hard: 3, attempts: 20, correct: 15, incorrect: 5 }], cursor: query.cursor ? null : 'offset:12' }; } };
  w.eval(read('assets/js/study-dashboard.js')); await tick();
  assert.equal(calls, 1); assert.match(w.document.body.textContent, /12 do powtórzenia/);
  assert.ok(w.document.querySelector('a[href*="study=due"]'));
  [...w.document.querySelectorAll('button')].find((b) => b.textContent === 'Pokaż kolejne pule').click(); await tick();
  assert.equal(calls, 2); assert.equal(w.document.querySelectorAll('.study-dashboard-card').length, 2);
});
test('Lesson Builder round-trips the study pool link and opens it without navigating away from the lesson', () => {
  const lesson = require('../public/members/module/studio/lesson-model'), parser = require('../public/members/module/lesson/lesson-parser');
  const block = lesson.createBlock('study', { repositoryId: 'glowne', quizId: 'chemia', title: 'Powtórka', button: 'Ucz się' });
  const value = lesson.createLesson({ slides: [{ blocks: [block] }] });
  const markdown = lesson.serializeLesson(value), restored = lesson.parseLesson(markdown);
  assert.equal(restored.slides[0].blocks.find((b) => b.type === 'study').quizId, 'chemia');
  const html = parser.renderMarkdown(markdown);
  assert.match(html, /lesson-study-card/); assert.match(html, /target="_blank"/); assert.match(html, /rel="noopener noreferrer"/); assert.match(html, /study=due/);
});
