'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const model = require('../public/members/module/studio/quiz-model');
const scheduler = require('../public/assets/js/study-scheduler');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const copy = (v) => JSON.parse(JSON.stringify(v));
function fixture(t, options = {}) {
  const dom = new JSDOM(read('members/module/flashcards/index.html'), { url: 'https://course.example/members/module/flashcards/?repo=glowne&quiz=chemia', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; t.after(() => w.close());
  const quiz = model.createQuiz({ mode: 'deck', quizId: 'chemia', metadata: { title: 'Chemia', status: 'published', courseId: 'course' }, questions: [
    { questionId: 'io', type: 'image_occlusion', prompt: 'Rozpoznaj narząd', image: { ref: 'photos/source.png' }, occlusion: { mode: 'one_per_mask', masks: [{ maskId: 'a', name: 'Pierwsza', answer: 'Serce', x: .1, y: .1, width: .2, height: .2 }, { maskId: 'b', name: 'Druga', answer: 'Płuco', x: .4, y: .4, width: .2, height: .2 }] } },
    ...Array.from({ length: 35 }, (_, i) => ({ questionId: `f${i}`, type: 'flashcard', front: { text: `Pytanie ${i} **Żółć** $H_2O$` }, back: { text: `Odpowiedź ${i}`, images: [{ ref: 'assets/shared/answer.png' }] } }))
  ] });
  const records = Object.fromEntries(scheduler.cards(quiz.questions).map((c) => [c.studyKey, scheduler.review(null, 3)]));
  const versions = {}, requests = [], images = [];
  let owner = 'student-one', failed = options.failPost === true;
  w.ChemModuleReturn = { url: '/members/module/lesson/?repo=glowne&file=biochemia.md&slide=2' };
  w.confirm = () => true; w.MathJax = { typesetPromise: async () => {}, typesetClear() {} };
  w.URL.createObjectURL = () => 'blob:fixture'; w.URL.revokeObjectURL = () => {};
  w.ChemAuth = { ready: Promise.resolve({ authenticated: true, session: { ok: true } }), getUser: () => ({ id: owner }), getAccessToken: async () => 'fixture' };
  w.ChemContentLibrary = { readMediaBlob: async (args) => { images.push(args); return new w.Blob(['fixture']); } };
  w.fetch = async () => ({ ok: true, json: async () => ({ quiz: copy(quiz), repositoryId: 'glowne' }) });
  w.ChemProgress = {
    load: async () => ({ userId: owner, catalog: { nodes: [] }, access: {} }),
    studyRequest: async (method, body, query) => {
      requests.push({ method, body: body && copy(body), query: copy(query) });
      if (query.view === 'study-summary') return { decks: [{ repositoryId: 'glowne', deckId: 'chemia', title: 'Chemia' }], cursor: query.cursor ? null : 'offset:12' };
      assert.equal(query.view, 'study', 'Every read/reset uses the study route');
      if (method === 'GET') return { records: copy(records), resetVersions: copy(versions), generation: 'fixture-generation', enabled: true, serverNow: new Date().toISOString() };
      if (failed) throw new Error('offline');
      const changes = {}, changedVersions = {};
      for (const event of body.reviews) { assert.equal(event.action, 'reset'); delete records[event.cardId]; versions[event.cardId] = (versions[event.cardId] || 0) + 1; changes[event.cardId] = null; changedVersions[event.cardId] = versions[event.cardId]; }
      return { saved: true, records: changes, resetVersions: changedVersions };
    }
  };
  for (const p of ['members/module/lesson/lesson-parser.js', 'assets/js/assessment-text.js', 'assets/js/quiz-practice.js', 'assets/js/quiz-occlusion-model.js', 'assets/js/quiz-flashcards.js', 'assets/js/quiz-occlusion.js', 'assets/js/study-scheduler.js', 'assets/js/study-client.js', 'members/module/flashcards/script.js']) w.eval(read(p));
  return { w, d: w.document, requests, images, records, allowPost() { failed = false; }, switchOwner() { owner = 'student-two'; w.dispatchEvent(new w.CustomEvent('chem-auth-user-changed', { detail: { authenticated: true } })); } };
}

test('separate manager paginates cards, renders rich media lazily and resets each mask independently', async (t) => {
  const h = fixture(t); await tick(); await tick();
  assert.equal(h.d.getElementById('flashcards-workspace').hidden, false);
  assert.equal(h.requests.find((r) => r.query.view === 'study').query.inspect, '1');
  assert.equal(h.d.querySelectorAll('.flashcards-card-row').length, 25); assert.equal(h.images.length, 0);
  assert.equal(new URL(h.d.getElementById('btn-study-pool').href).searchParams.get('lesson_return'), h.w.ChemModuleReturn.url);
  const row = h.d.querySelector('[data-card-id="io/a"]'); row.querySelector('details').open = true; await tick();
  assert.equal(h.images.length, 1); assert.equal(h.images[0].reference, 'photos/source.png');
  assert.equal(row.querySelector('[data-mask-id="b"]').disabled, true);
  row.querySelector('[data-flashcard-reveal]').click(); assert.match(row.textContent, /Serce/); assert.doesNotMatch(row.textContent, /Płuco/);
  row.querySelector('.flashcards-card-reset-btn').click(); await tick(); await tick();
  assert.equal(h.records['io/a'], undefined); assert.equal(h.records['io/b'].attempts, 1);
  const post = h.requests.find((r) => r.method === 'POST'); assert.equal(post.body.reviews[0].cardId, 'io/a');
  const flashcard = h.d.querySelector('[data-card-id="f0"]'); flashcard.querySelector('details').open = true; await tick();
  assert.ok(flashcard.querySelector('strong')); assert.match(flashcard.textContent, /Odpowiedź 0/); assert.ok(flashcard.querySelector('[data-assessment-math]'));
  h.d.getElementById('pools-more').click(); await tick(); assert.equal(h.requests.filter((r) => r.query.view === 'study-summary').length, 2);
});

test('bulk reset respects filters, retries identical events and clears private state after account change', async (t) => {
  const h = fixture(t, { failPost: true }); await tick(); await tick();
  const search = h.d.getElementById('card-search-input'); search.value = 'Pytanie 1'; search.dispatchEvent(new h.w.Event('input')); await new Promise((resolve) => setTimeout(resolve, 190));
  assert.equal(h.d.querySelectorAll('.flashcards-card-row').length, 11);
  h.d.getElementById('btn-select-all').click(); h.d.getElementById('btn-reset-selected').click(); await tick();
  const first = h.requests.find((r) => r.method === 'POST'); assert.equal(first.body.reviews.length, 11); assert.ok(h.records['io/a']);
  assert.equal(h.d.getElementById('retry-save').hidden, false);
  h.allowPost(); h.d.getElementById('retry-save').click(); await tick(); await tick();
  const posts = h.requests.filter((r) => r.method === 'POST'); assert.deepEqual(posts[0].body, posts[1].body);
  assert.equal(h.records.f1, undefined); assert.ok(h.records.f2); assert.equal(h.d.getElementById('retry-save').hidden, true);
  h.switchOwner(); assert.equal(h.d.getElementById('flashcards-workspace').hidden, true); assert.equal(h.d.querySelectorAll('.flashcards-card-row').length, 0);
});

test('range, page and filtered selection retain card identity across pagination and reset in bounded batches', async (t) => {
  const h = fixture(t); await tick(); await tick();
  let checks = h.d.querySelectorAll('.flashcards-card-row > input'); checks[0].click();
  checks[4].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert.equal(h.d.querySelectorAll('.flashcards-card-row > input:checked').length, 5);
  h.d.getElementById('btn-clear-selection').click();
  h.d.getElementById('btn-select-page').click(); assert.match(h.d.getElementById('bulk-selected-label').textContent, /25/);
  h.d.querySelector('.flashcards-paging button:last-child').click();
  assert.equal(h.d.querySelectorAll('.flashcards-card-row > input:checked').length, 0);
  h.d.getElementById('btn-select-all').click(); assert.match(h.d.getElementById('bulk-selected-label').textContent, /37/);
  h.d.getElementById('btn-reset-selected').click(); await tick(); await tick();
  const posts = h.requests.filter((r) => r.method === 'POST'); assert.deepEqual(posts.map((r) => r.body.reviews.length), [20, 17]);
  assert.equal(new Set(posts.flatMap((r) => r.body.reviews.map((e) => e.cardId))).size, 37);
  assert.equal(Object.keys(h.records).length, 0);
});

test('study selection survives first render, mode/order changes and per-mask random selection', async (t) => {
  const dom = new JSDOM('<main></main>', { url: 'https://course.example/members/module/quiz/?repo=glowne&quiz=chemia&cards=io%2Fb&order=shuffle', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window;
  w.MathJax = { typesetPromise: async () => {}, typesetClear() {} };
  for (const p of ['members/module/lesson/lesson-parser.js', 'assets/js/assessment-text.js', 'assets/js/quiz-practice.js', 'assets/js/quiz-occlusion-model.js', 'assets/js/quiz-flashcards.js', 'assets/js/quiz-occlusion.js', 'assets/js/study-scheduler.js', 'assets/js/study-view.js']) w.eval(read(p));
  const question = model.createQuestion({ questionId: 'io', type: 'image_occlusion', image: { ref: 'photos/source.png' }, occlusion: { mode: 'random', masks: [{ maskId: 'a', x: 0, y: 0, width: .1, height: .1 }, { maskId: 'b', x: .4, y: .4, width: .1, height: .1 }] } });
  const client = { records: {}, onStatus() {}, async flush() {}, rate() {} };
  const view = w.ChemStudyView.study({ questions: [question], review: client, mode: 'all', getUrl: async () => 'blob:test' }); w.document.body.append(view);
  assert.equal(view.querySelector('[data-mask-id="a"]').disabled, true); assert.equal(view.querySelector('[data-mask-id="b"]').disabled, false);
  view.querySelector('.study-order-toggle-btn').click(); assert.equal(view.querySelector('[data-mask-id="b"]').disabled, false);
  assert.match(view.querySelector('.quiz-deck-position').textContent, /Pozostało: 1/);
  assert.ok([...view.querySelectorAll('button')].some((b) => b.textContent.includes('menadżer')));
  assert.equal(view.querySelector('.study-session-list-view'), null);
});

test('session limits apply after selection and ordering, can be cleared and never write progress', async (t) => {
  const h = fixture(t); await tick(); await tick();
  const limit = h.d.getElementById('session-card-limit'); limit.value = '10'; limit.dispatchEvent(new h.w.Event('change'));
  assert.equal(new URL(h.d.getElementById('btn-study-pool').href).searchParams.get('limit'), '10');
  h.d.getElementById('session-limit-reset').click(); assert.equal(new URL(h.d.getElementById('btn-study-pool').href).searchParams.has('limit'), false);
  assert.equal(h.requests.some((r) => r.method === 'POST'), false);
  h.w.history.replaceState(null, '', '/members/module/quiz/?repo=glowne&quiz=chemia&cards=a,b,c&limit=2');
  h.w.eval(read('assets/js/study-view.js'));
  const questions = ['a','b','c','d'].map((questionId) => model.createQuestion({ questionId, type: 'flashcard', front: { text: questionId }, back: { text: 'Odpowiedź' } }));
  const client = { records: {}, onStatus() {}, async flush() {}, rate() {} };
  const view = h.w.ChemStudyView.study({ questions, review: client, mode: 'all', getUrl: async () => '' }); h.d.body.append(view);
  assert.match(view.querySelector('.quiz-deck-position').textContent, /Pozostało: 2/);
  view.querySelector('.study-order-toggle-btn').click(); assert.match(view.querySelector('.quiz-deck-position').textContent, /Pozostało: 2/);
});
