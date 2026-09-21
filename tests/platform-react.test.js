'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { buildSync } = require('esbuild');
const { options } = require('../scripts/build-dashboard.cjs');
const bundle = buildSync({ ...options, write: false, logLevel: 'silent' }).outputFiles[0].text;
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const plain = (value) => JSON.parse(JSON.stringify(value));

function setup(t, file, query = '') {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(file ? read(file) : '<div id="view"></div>', { url: `https://course.example/${file || 'members/'}${query}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.structuredClone = structuredClone;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.confirm = () => true;
  w.ChemAuth = { ready: Promise.resolve({ authenticated: true, session: { ok: true } }), getUser: () => ({ id: 'admin', app_metadata: { roles: ['admin'] } }), getAccessToken: async () => 'test-token' };
  w.ChemAssessmentText = { render(node, text) { node.textContent = text || ''; } };
  if (file === 'members/module/quiz/index.html') {
    ['members/module/lesson/lesson-parser.js', 'assets/js/assessment-text.js', 'assets/js/quiz-practice.js', 'assets/js/quiz-occlusion-model.js', 'assets/js/quiz-flashcards.js', 'assets/js/quiz-occlusion.js'].forEach((name) => w.eval(read(name)));
  }
  w.eval(bundle);
  t.after(() => { w.NextMedUI.releaseWithin(w.document.body); w.close(); assert.deepEqual(errors, []); });
  return { w, d: w.document, evalFile: (name) => w.eval(read(name)), render: (name, props, host = w.document.getElementById('view')) => w.NextMedUI.render(name, host, props) };
}
async function input(w, node, value) {
  assert.ok(node, 'Control exists');
  const proto = node.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : node.tagName === 'SELECT' ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
  node.dispatchEvent(new w.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  await tick();
}

function attempt(questions) {
  return { attemptId: 'a1', status: 'active', revision: 1, answers: {}, flags: [], confirmedQuestionIds: [], timedOutQuestionIds: [], currentIndex: 0, highestReachedIndex: 0, totalQuestions: questions.length, questions,
    exam: { metadata: { name: 'Test' }, display: { mode: 'one' }, navigation: { allowFreeNavigation: true, allowBack: true, allowSkip: true, allowFlagging: true }, timing: { mode: 'none' }, security: {}, resultVisibility: {} } };
}

test('React exam controls preserve every answer shape and lock confirmed questions', async (t) => {
  const h = setup(t);
  const questions = [
    { questionId: 'single', type: 'single_choice', options: [{ answerId: 'a', text: 'A' }, { answerId: 'b', text: 'B' }] },
    { questionId: 'multiple', type: 'multiple_choice', options: [{ answerId: 'a', text: 'A' }, { answerId: 'b', text: 'B' }] },
    { questionId: 'text', type: 'short_text' }, { questionId: 'number', type: 'number' }, { questionId: 'open', type: 'open_answer' },
    { questionId: 'matching', type: 'matching', left: [{ pairId: 'l', text: 'L' }], right: [{ answerId: 'r', text: 'R' }] },
    { questionId: 'ordering', type: 'ordering', items: [{ itemId: 'a', text: 'A' }, { itemId: 'b', text: 'B' }] },
    { questionId: 'blanks', type: 'fill_blanks', template: 'H{{liczba}}O', blanks: [{ blankId: 'b1' }] }
  ].map((q) => ({ prompt: 'Treść', images: [], ...q }));
  const a = attempt(questions);
  let writes = 0;
  const props = { indices: questions.map((_, i) => i), attempt: a, typeLabel: (v) => v, getUrl: async () => '', onConfirm() {}, onAnswer(id, value) { writes++; a.answers[id] = value; } };
  assert.equal(h.render('exam-questions', props), true);
  const q = (id, selector) => h.d.querySelector(`[data-question-id="${id}"] ${selector}`);
  q('single', 'input[value="b"]').click(); await tick();
  q('multiple', 'input[value="a"]').click(); await tick();
  q('multiple', 'input[value="b"]').click(); await tick();
  await input(h.w, q('text', 'input'), 'komórka');
  await input(h.w, q('number', 'input'), '1,25');
  await input(h.w, q('open', 'textarea'), 'Opis reakcji H₂O');
  await input(h.w, q('matching', 'select'), 'r');
  q('ordering', '[aria-label="Przesuń niżej"]').click(); await tick();
  await input(h.w, q('blanks', 'input'), '2');
  assert.deepEqual(plain(a.answers), { single: 'b', multiple: ['a', 'b'], text: 'komórka', number: '1,25', open: 'Opis reakcji H₂O', matching: { l: 'r' }, ordering: ['b', 'a'], blanks: { b1: '2' } });
  assert.equal(writes, 9);
  h.render('exam-questions', { ...props, indices: [0] });
  h.render('exam-questions', { ...props, indices: [4] });
  assert.equal(q('open', 'textarea').value, 'Opis reakcji H₂O');
  a.confirmedQuestionIds = ['open'];
  h.render('exam-questions', { ...props, indices: [4] });
  assert.equal(q('open', 'textarea').disabled, true);
});

test('real exam controller keeps optimistic navigation and batches answers with React DOM', async (t) => {
  const h = setup(t, 'members/module/exam/index.html', '?exam=test&repo=glowne');
  const requests = [];
  h.w.ChemExamClient = { mutate(action, params) { return new Promise((resolve) => requests.push({ action, ...params.body, resolve })); } };
  const source = read('members/module/exam/script.js').replace("document.addEventListener('DOMContentLoaded', start);", 'window.testExam = { state, bind, initializeAttempt, renderAttempt, navigateTo };');
  h.w.eval(source);
  const api = h.w.testExam;
  const server = attempt(Array.from({ length: 6 }, (_, i) => ({ questionId: `q${i}`, type: 'short_text', prompt: `Pytanie ${i}` })));
  api.state.reference = { repositoryId: 'glowne', examId: 'test' };
  api.bind(); api.initializeAttempt(plain(server), false); api.renderAttempt();
  assert.equal(h.d.getElementById('exam-question-list').dataset.reactView, 'exam-questions');
  await input(h.w, h.d.querySelector('.exam-text-answer'), 'pierwsza');
  const first = api.navigateTo(1); await tick();
  await input(h.w, h.d.querySelector('.exam-text-answer'), 'druga');
  const latest = api.navigateTo(4); await tick();
  assert.equal(h.d.querySelector('.exam-question').dataset.questionIndex, '4');
  assert.equal(requests.length, 1);
  function respond(index) { const req = requests[index]; Object.assign(server.answers, req.answers); server.currentIndex = req.targetIndex; server.highestReachedIndex = Math.max(server.highestReachedIndex, req.targetIndex); server.revision++; req.resolve({ attempt: plain(server) }); }
  respond(0); await tick();
  assert.equal(h.d.querySelector('.exam-question').dataset.questionIndex, '4');
  assert.equal(requests.length, 2);
  respond(1); await Promise.all([first, latest]);
  assert.deepEqual(plain(api.state.attempt.answers), { q0: 'pierwsza', q1: 'druga' });
  assert.equal(api.state.dirtyQuestions.size, 0);
  assert.equal(h.d.querySelectorAll('#exam-navigator-grid button').length, 6);
});

test('quiz batches long lists, reveals unmounted required questions and retains answers', async (t) => {
  const h = setup(t);
  const questions = Array.from({ length: 80 }, (_, i) => ({ questionId: `q${i}`, type: 'text', prompt: `Pytanie ${i}`, points: 1, image: {} }));
  const props = { questions, answers: {}, results: {}, locked: false, getUrl: async () => '', onAnswer(id, value) { props.answers[id] = value; } };
  h.render('quiz-questions', props);
  assert.equal(h.d.querySelectorAll('fieldset').length, 24);
  await input(h.w, h.d.querySelector('[data-answer-text]'), 'zapamiętaj');
  h.d.querySelector('.react-list-more button').click(); await tick();
  assert.equal(h.d.querySelectorAll('fieldset').length, 48);
  h.render('quiz-questions', { ...props, revealId: 'q70' });
  assert.equal(h.d.querySelectorAll('fieldset').length, 72);
  assert.equal(h.d.querySelector('[data-answer-text]').value, 'zapamiętaj');
  h.render('quiz-questions', { ...props, locked: true, results: { q0: { reviewStatus: 'pending' } } });
  assert.equal(h.d.querySelector('[data-answer-text]').disabled, true);
  assert.match(h.d.querySelector('.quiz-player-feedback').textContent, /oczekuje na ocenę/);
  assert.equal(h.d.querySelector('fieldset').classList.contains('is-wrong'), false);
});

test('real quiz player submits open answers only on request, locks during grading and resets on retry', async (t) => {
  const h = setup(t, 'members/module/quiz/index.html', '?quiz=test&repo=glowne');
  let submit, posts = 0;
  const quiz = { metadata: { title: 'Quiz', description: '', cover: {} }, settings: { passingScore: 50, allowRetry: true, shuffleQuestions: false, showFeedback: true },
    questions: [{ questionId: 'open', type: 'open', prompt: 'Wyjaśnij', points: 5, required: true, gradingMode: 'manual', image: {} }] };
  h.w.fetch = async (_, options = {}) => {
    if (options.method === 'POST') { posts++; return new Promise((resolve) => { submit = () => resolve({ ok: true, json: async () => ({ attemptId: 'one', attemptNumber: 1, progressSaved: true, result: { gradingStatus: 'pending_review', pendingQuestionCount: 1, earned: 0, maximum: 5, percent: null, passed: null, results: [{ questionId: 'open', reviewStatus: 'pending' }] } }) }); }); }
    return { ok: true, json: async () => ({ quiz }) };
  };
  h.evalFile('members/module/quiz/script.js'); await tick();
  assert.equal(h.d.getElementById('quiz-player-form').dataset.reactView, 'quiz-questions');
  assert.equal(posts, 0);
  await input(h.w, h.d.querySelector('.quiz-player-open-answer'), 'Ręczna odpowiedź');
  h.d.getElementById('quiz-player-check').click(); await tick();
  assert.equal(posts, 1);
  assert.equal(h.d.querySelector('textarea').disabled, true);
  h.d.getElementById('quiz-player-check').click(); assert.equal(posts, 1);
  submit(); await tick();
  assert.match(h.d.getElementById('quiz-player-result').textContent, /ocen/);
  h.d.getElementById('quiz-player-retry').click(); await tick();
  assert.equal(h.d.querySelector('textarea').value, '');
  assert.equal(h.d.querySelector('textarea').disabled, false);
  assert.equal(posts, 1);
});

for (const react of [true, false]) test(`closed quiz is checked locally with its downloaded key (${react ? 'React' : 'native fallback'})`, async (t) => {
  const h = setup(t, 'members/module/quiz/index.html', '?quiz=local-test&repo=glowne');
  if (!react) h.w.NextMedUI = { ...h.w.NextMedUI, render: () => false };
  const model = require('../public/members/module/studio/quiz-model');
  const common = require('../netlify/quiz-common');
  const quiz = model.createQuiz({ quizId: 'local-test', metadata: { status: 'published' }, settings: { showFeedback: true, shuffleQuestions: false, passingScore: 60, allowRetry: true }, questions: [
    { questionId: 'single', type: 'single', points: 2, options: [{ optionId: 's-a', text: 'Poprawna', correct: true }, { optionId: 's-b', text: 'Błędna', correct: false }] },
    { questionId: 'multiple', type: 'multiple', points: 2, options: [{ optionId: 'm-a', text: 'Tlen', correct: true }, { optionId: 'm-b', text: 'Wodór', correct: true }, { optionId: 'm-c', text: 'Woda', correct: false }] },
    { questionId: 'boolean', type: 'true_false', points: 1 },
    { questionId: 'text', type: 'text', acceptedAnswers: ['tlen', 'O'], points: 1, explanation: 'To symbol pierwiastka.' }
  ] });
  const requests = [], progress = [];
  h.w.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    assert.equal(options.method || 'GET', 'GET', 'No grading or AI request for an objective quiz');
    return new Response(JSON.stringify({ quiz: common.publicDefinition(quiz), repositoryId: 'glowne' }));
  };
  h.w.ChemProgress = { load: async () => {}, materialId: () => 'quiz:glowne:local-test', record: () => null, update: async (value) => { progress.push(plain(value)); return {}; } };
  h.evalFile('members/module/quiz/script.js'); await tick();
  assert.equal(requests.length, 1);
  assert.match(h.d.getElementById('quiz-player-checking-mode').textContent, /na Twoim urządzeniu/);
  h.d.getElementById('quiz-player-check').click(); await tick();
  assert.equal(progress.length, 1, 'Missing required answers do not save a result');
  const field = (id) => h.d.querySelector(`[data-question-id="${id}"]`);
  field('single').querySelector('input[value="s-b"]').click();
  field('multiple').querySelector('input[value="m-a"]').click();
  field('multiple').querySelector('input[value="m-b"]').click();
  field('boolean').querySelector('input').click();
  await input(h.w, field('text').querySelector('[data-answer-text]'), 'azot');
  h.d.getElementById('quiz-player-check').click(); await tick();
  assert.equal(h.d.querySelector('#quiz-player-result > strong').textContent, '50%');
  assert.match(field('single').querySelector('[data-option-status="missed"]').textContent, /Poprawna/);
  assert.match(field('text').querySelector('[data-local-answer-key]').textContent, /tlen/);
  assert.match(field('text').querySelector('[data-local-answer-key]').textContent, /O/);
  assert.match(field('text').querySelector('.quiz-practice-feedback').textContent, /To symbol pierwiastka/);
  assert.equal(requests.length, 1);
  assert.equal(progress.length, 2);
  assert.equal(progress[1].details.attempts, 1);
  assert.equal(progress[1].details.scorePercent, 50);
  assert.equal(progress[1].details.completed, true);
  h.d.getElementById('quiz-player-retry').click(); await tick();
  assert.equal(h.d.querySelector('[data-local-answer-key]'), null);
  assert.equal(field('text').querySelector('[data-answer-text]').value, '');
  field('single').querySelector('input[value="s-b"]').click();
  field('multiple').querySelector('input[value="m-a"]').click();
  field('boolean').querySelector('input').click();
  await input(h.w, field('text').querySelector('[data-answer-text]'), 'azot');
  h.d.getElementById('quiz-player-check').click(); await tick();
  const expected = common.gradeQuiz(quiz, { single: ['s-b'], multiple: ['m-a'], boolean: [quiz.questions[2].options[0].optionId], text: 'azot' });
  assert.equal(h.d.querySelector('#quiz-player-result > strong').textContent, `${expected.percent}%`);
  assert.equal(progress[2].details.attempts, 2);
  assert.equal(requests.length, 1, 'Retry uses the same in-memory definition and answer key');
});

test('lazy media does not fetch offscreen or reload after a normal React update', async (t) => {
  const h = setup(t);
  const observers = [];
  h.w.IntersectionObserver = class { constructor(callback) { this.callback = callback; observers.push(this); } observe(node) { this.node = node; } disconnect() {} };
  let reads = 0;
  const props = { questions: [{ questionId: 'q', type: 'text', prompt: 'Obraz', image: { ref: 'photos/a.png' }, points: 1 }], answers: {}, results: {}, onAnswer() {}, getUrl: async () => { reads++; return 'blob:local'; } };
  h.render('quiz-questions', props); await tick(); assert.equal(reads, 0);
  observers[0].callback([{ isIntersecting: true }]); observers[0].callback([{ isIntersecting: true }]); await tick();
  assert.equal(reads, 1);
  h.render('quiz-questions', { ...props, answers: { q: 'x' } }); await tick();
  assert.equal(reads, 1);
  assert.equal(h.d.querySelector('img').getAttribute('src'), 'blob:local');
});

test('Studio tools use React search, keep links and dispatch editor navigation', async (t) => {
  const h = setup(t, 'members/module/studio/index.html');
  await tick();
  let mode;
  h.d.addEventListener('studio-select-mode', (event) => { mode = event.detail; });
  h.evalFile('members/module/studio/tool-picker.js');
  h.d.dispatchEvent(new h.w.Event('DOMContentLoaded')); await tick();
  assert.equal(h.d.getElementById('studio-tools').dataset.reactView, 'studio-tools');
  await input(h.w, h.d.getElementById('studio-tool-search'), 'lekcji');
  assert.equal(h.d.querySelectorAll('.project-card').length, 1);
  h.d.querySelector('.project-card').click(); await tick(); assert.equal(mode, 'lesson');
  await input(h.w, h.d.getElementById('studio-tool-select'), 'exam'); assert.equal(mode, 'exam');
  await input(h.w, h.d.getElementById('studio-tool-search'), '');
  h.d.querySelector('[data-tool-filter="management"]').click(); await tick();
  assert.ok(h.d.querySelector('a[href="/members/module/studio/manage/?tab=payments"]'));
  assert.equal(h.d.getElementById('content-explorer').hidden, true);
  assert.ok(h.d.querySelector('.project-icon svg path'));
});

test('React lesson canvas folds long content and retains drag/action IDs and selected blocks', async (t) => {
  const h = setup(t);
  const slides = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, blocks: [{ id: `b${i}`, type: 'text', text: `Tekst ${i}` }] }));
  const props = { model: { slides }, selected: 's0', adapters: { title: (b) => b.text, subtitle: () => '', symbol: () => 'T', nested: (b) => b.blocks, slideTitle: (s) => s.id, slideSummary: () => '' } };
  h.render('studio-lesson', props); await tick();
  assert.equal(h.d.querySelectorAll('.lesson-slide').length, 60);
  assert.equal(h.d.querySelectorAll('.lesson-block').length, 1);
  h.d.querySelector('[aria-label="Zwiń treść slajdu"]').click(); await tick();
  assert.equal(h.d.querySelectorAll('.lesson-block').length, 0);
  h.render('studio-lesson', { ...props, selected: 'b59' }); await tick();
  assert.ok(h.d.querySelector('[data-lesson-block-id="b59"]'));
  assert.equal(h.d.querySelector('[data-lesson-block-id="b59"]').dataset.lessonSlideId, 's59');
  assert.ok(h.d.querySelector('[data-lesson-block-id="b59"] [data-lesson-action="duplicate"]'));
});

test('ENV React editor preserves secrets locally, supports provider, rename, clear and removal', async (t) => {
  const h = setup(t, 'members/module/studio/env/index.html');
  await tick();
  let requests = 0;
  h.w.fetch = async () => { requests++; throw new Error('No network allowed'); };
  h.evalFile('members/module/studio/env/env-model.js'); h.evalFile('members/module/studio/env/script.js');
  h.d.dispatchEvent(new h.w.Event('DOMContentLoaded')); await tick();
  assert.equal(h.d.getElementById('env-list').dataset.reactView, 'studio-env');
  const provider = [...h.d.querySelectorAll('.env-row')].find((row) => row.querySelector('.env-name').value === 'GIT_PROVIDER');
  await input(h.w, provider.querySelector('select'), 'gitea');
  h.d.getElementById('env-add').click(); await tick();
  const row = h.d.querySelector('.env-row:last-child');
  await input(h.w, row.querySelector('.env-name'), 'MY_PRIVATE_TOKEN');
  await input(h.w, row.querySelector('.env-value'), 'fixture-only-not-a-real-secret');
  assert.equal(row.querySelector('.env-value').type, 'password');
  assert.doesNotMatch(h.d.getElementById('env-output').value, /fixture-only/);
  row.querySelector('.reveal-button').click(); await tick();
  assert.equal(row.querySelector('.env-value').type, 'text');
  h.d.getElementById('env-clear').click(); await tick();
  assert.equal(row.querySelector('.env-value').value, '');
  row.querySelector('.remove-button').click(); await tick();
  assert.equal(row.isConnected, false);
  assert.equal(requests, 0);
});

test('shared runtime disposes detached roots and safely declines missing or legacy renderers', async (t) => {
  const h = setup(t);
  const host = h.d.getElementById('view');
  assert.equal(h.render('not-a-view', {}), false);
  h.render('quiz-result', { title: 'Wynik', score: '100%', message: 'Gotowe' });
  host.remove(); await tick(); assert.equal(host.dataset.reactView, undefined);
  h.d.body.append(host);
  h.w.history.replaceState(null, '', '?uiRenderer=legacy');
  assert.equal(h.render('quiz-result', {}), false);
});

async function studio(t, libraryOverrides = {}, prepare) {
  const h = setup(t, 'members/module/studio/index.html');
  if (prepare) prepare(h);
  await tick();
  h.w.ChemContentLibrary = {
    repositories: async () => [{ id: 'glowne', default: true, label: 'Główna' }],
    list: async () => [], search: (items, query) => items.filter((item) => `${item.title} ${item.filename}`.includes(query)),
    readQuestionBank: async () => ({ bank: { questions: [] }, sha: '' }), ...libraryOverrides
  };
  const files = ['assets/js/presentation-layout.js', 'assets/js/presentation-preview.js', 'assets/js/google-media.js', 'members/dashboard-parser.js', 'members/module/lesson/lesson-parser.js', 'assets/js/assessment-text.js', 'assets/js/quiz-practice.js', 'assets/js/quiz-occlusion-model.js', 'assets/js/quiz-flashcards.js', 'assets/js/quiz-occlusion.js',
    ...['paged-list', 'dashboard-model', 'lesson-model', 'answer-fields', 'prompt-model', 'exam-model', 'assessment-editor', 'presentation-model', 'quiz-csv', 'quiz-model', 'exam-builder', 'presentation-builder', 'quiz-builder', 'script', 'tool-picker'].map((file) => `members/module/studio/${file}.js`)];
  files.forEach(h.evalFile);
  h.d.dispatchEvent(new h.w.Event('DOMContentLoaded')); await tick();
  assert.equal(h.d.getElementById('studio-app').hidden, false, h.d.getElementById('access-state').textContent);
  return h;
}

test('actual Studio boots all React workspaces, with local drafts and no changes to publication format', async (t) => {
  const h = await studio(t);
  for (const [mode, host, view] of [['dashboard', 'dashboard-canvas', 'studio-dashboard'], ['lesson', 'lesson-canvas', 'studio-lesson'], ['prompt', 'prompt-points-list', 'studio-prompt'], ['quiz', 'quiz-question-list', 'studio-quiz'], ['presentation', 'presentation-slide-list', 'studio-presentation-slides']]) {
    await input(h.w, h.d.getElementById('studio-tool-select'), mode);
    if (mode === 'prompt') await input(h.w, h.d.getElementById('prompt-format-select'), 'txt');
    assert.equal(h.d.getElementById(`${mode}-workspace`).hidden, false);
    assert.equal(h.d.getElementById(host)?.dataset.reactView, view, `${mode} is rendered by React`);
  }
  await input(h.w, h.d.getElementById('studio-tool-select'), 'exam');
  h.d.querySelector('[data-exam-tab="questions"]').click(); await tick();
  assert.ok(h.d.querySelector('[data-react-view="studio-exam-list"]'));
  h.d.querySelector('[data-exam-action="add-question"]').click(); await tick();
  assert.ok(h.d.querySelector('.exam-question-editor'), 'Established rich question editor remains available');
  h.w.ChemExamBuilder.flush();
  const exam = JSON.parse(h.w.localStorage.getItem('chemdisk.studio.exam.v1'));
  assert.ok(exam.questions.length > 0);
});

test('actual quiz builder React controls save edits, duplicate once and preserve answer editor events', async (t) => {
  const h = await studio(t);
  await input(h.w, h.d.getElementById('studio-tool-select'), 'quiz');
  await input(h.w, h.d.querySelector('[data-quiz-field="prompt"]'), 'Zmieniona treść');
  await input(h.w, h.d.querySelector('[data-quiz-field="points"]'), '3.5');
  await input(h.w, h.d.querySelector('[data-quiz-field="optionText"]'), 'Poprawiona odpowiedź');
  const original = h.d.querySelectorAll('.quiz-question-card').length;
  h.d.querySelector('[data-quiz-action="duplicate"]').click(); await tick();
  assert.equal(h.d.querySelectorAll('.quiz-question-card').length, original + 1);
  h.w.ChemQuizBuilder.flush();
  const quiz = JSON.parse(h.w.localStorage.getItem('chemdisk.studio.quiz.v1'));
  assert.equal(quiz.questions[0].prompt, 'Zmieniona treść');
  assert.equal(quiz.questions[0].points, 3.5);
  assert.equal(quiz.questions[0].options[0].text, 'Poprawiona odpowiedź');
  assert.notEqual(quiz.questions[0].questionId, quiz.questions[1].questionId);
});

test('Studio creates a deck, edits both faces, replaces/removes images and publishes with the current course', async (t) => {
  const saved = [], images = [];
  const h = await studio(t, {
    save: async (kind, value) => { saved.push({ kind, ...plain(value) }); return { sha: 'a'.repeat(40) }; },
    readMediaBlob: async (value) => { images.push(value); return new Blob(['fixture']); }
  });
  h.w.URL.createObjectURL = () => 'blob:https://course.example/image'; h.w.URL.revokeObjectURL = () => {};
  h.w.fetch = async () => new Response(JSON.stringify({ catalog: { nodes: [{ id: 'course', type: 'course', title: 'Kurs chemii' }] } }));
  let selection;
  h.w.ChemMediaManager = { open: async (options) => { selection = options; } };
  await input(h.w, h.d.getElementById('studio-tool-select'), 'quiz');
  h.d.getElementById('quiz-new-deck-button').click(); await tick();
  assert.equal(h.d.getElementById('quiz-mode').value, 'deck');
  await input(h.w, h.d.getElementById('quiz-course'), 'course');
  await input(h.w, h.d.getElementById('quiz-id'), 'fiszki-biologia');
  await input(h.w, h.d.getElementById('quiz-title'), 'Białka — fiszki');
  await input(h.w, h.d.querySelector('[data-quiz-field="frontText"]'), '**Co buduje białko?**\nPodaj nazwę.');
  await input(h.w, h.d.querySelector('[data-quiz-field="backText"]'), 'Aminokwasy.');
  for (const side of ['front', 'back']) {
    h.d.querySelector(`[data-quiz-action="add-flashcard-media"][data-side="${side}"]`).click(); await tick();
    assert.equal(selection.scope, 'shared', 'Unsaved decks use the existing shared library');
    selection.onSelect({ reference: `assets/shared/${side}.png`, filename: `${side}.png` }); await tick();
  }
  h.d.querySelector('[data-quiz-action="replace-flashcard-media"][data-side="front"]').click(); await tick();
  selection.onSelect({ reference: 'assets/shared/replaced.webp', filename: 'replaced.webp' }); await tick();
  h.d.querySelector('[data-quiz-action="remove-flashcard-media"][data-side="back"]').click(); await tick();
  h.d.querySelector('[data-quiz-action="duplicate"]').click(); await tick();
  const before = h.d.querySelector('.quiz-question-card').dataset.questionId;
  h.d.querySelector('[data-quiz-action="down"]').click(); await tick();
  assert.notEqual(h.d.querySelector('.quiz-question-card').dataset.questionId, before);
  h.d.getElementById('quiz-active').click(); await tick();
  h.d.getElementById('quiz-publish-button').click(); await tick();
  assert.equal(saved.length, 1, h.d.getElementById('quiz-builder-status').textContent);
  assert.equal(saved[0].kind, 'quiz');
  const deck = JSON.parse(saved[0].content);
  assert.equal(deck.mode, 'deck'); assert.equal(deck.metadata.courseId, 'course');
  assert.equal(deck.metadata.active, false); assert.equal(deck.metadata.status, 'published');
  assert.equal(deck.questions[0].front.images[0].ref, 'assets/shared/replaced.webp');
  assert.deepEqual(deck.questions[0].back.images, []);
  assert.equal(deck.questions[0].back.text, 'Aminokwasy.');
  assert.ok(images.some((image) => image.reference === 'assets/shared/replaced.webp'));
  assert.ok(h.d.querySelector('#quiz-deck-link a[href*="preview=1"]'));
});

test('Studio fx targets every quiz educational field and publishes a mixed deck with choice images and text tolerances', async (t) => {
  const saved = [];
  const h = await studio(t, { save: async (kind, value) => { saved.push({ kind, ...plain(value) }); return { sha: 'c'.repeat(40) }; }, readMediaBlob: async () => new Blob(['fixture']) });
  h.w.MathJax = { typesetClear() {}, typesetPromise: async () => {} };
  h.w.URL.createObjectURL = () => 'blob:https://course.example/practice'; h.w.URL.revokeObjectURL = () => {};
  h.w.fetch = async () => new Response(JSON.stringify({ catalog: { nodes: [{ id: 'course', type: 'course', title: 'Biologia' }] } }));
  let media;
  h.w.ChemMediaManager = { open: async (options) => { media = options; } };
  await input(h.w, h.d.getElementById('studio-tool-select'), 'quiz');
  h.d.getElementById('quiz-new-deck-button').click(); await tick();
  await input(h.w, h.d.getElementById('quiz-course'), 'course');
  const formula = '\\ce{H2O} + \\alpha';
  async function insertEquation(control) {
    assert.ok(control); control.focus(); control.setSelectionRange(0, 0);
    const field = control.closest('label');
    const button = field.querySelector('.assessment-equation-trigger') || field.parentElement.querySelector('.assessment-equation-trigger');
    assert.ok(button, 'Every educational field has fx'); button.click(); await tick();
    const dialog = h.d.querySelector('.assessment-equation-dialog'); assert.ok(dialog);
    await input(h.w, dialog.querySelector('textarea[aria-label="Wzór matematyczny"]'), formula);
    assert.ok(dialog.querySelector('[aria-label="Podgląd równania"] [data-assessment-math]'));
    dialog.querySelector('[aria-label="Wstaw do wybranego pola"]').click(); await tick();
    assert.equal(h.d.querySelector('.assessment-equation-dialog'), null); assert.ok(control.value.startsWith(`\\(${formula}\\)`));
  }
  for (const name of ['frontText', 'backText', 'explanation']) await insertEquation(h.d.querySelector(`[data-quiz-field="${name}"]`));
  for (const type of ['single', 'multiple', 'text']) {
    const add = h.d.querySelector(`[data-quiz-add="${type}"]`); assert.equal(add.hidden, false); add.click(); await tick();
    const card = () => h.d.querySelector('.quiz-question-card:last-child');
    if (!card().querySelector('[data-quiz-field="prompt"]')) { card().querySelector('.quiz-question-actions > button').click(); await tick(); }
    await insertEquation(card().querySelector('[data-quiz-field="prompt"]'));
    await insertEquation(card().querySelector('[data-quiz-field="explanation"]'));
    if (type === 'text') {
      await insertEquation(card().querySelector('.answer-configurator textarea'));
      await input(h.w, card().querySelector('.quiz-text-tolerances select'), '2');
    } else {
      await insertEquation(card().querySelector('[data-quiz-field="optionText"]'));
      card().querySelector('[data-quiz-action="option-media"]').click(); await tick();
      assert.equal(media.scope, 'shared'); media.onSelect({ reference: 'assets/shared/option.png', filename: 'Opcja.png' }); await tick();
      assert.ok(card().querySelector('.quiz-option-media img'));
      card().querySelector('[data-quiz-action="option-media"]').click(); await tick();
      media.onSelect({ reference: 'assets/shared/replaced-option.webp', filename: 'Zmieniona.webp' }); await tick();
      if (type === 'single') {
        for (let i = 0; i < 2; i++) { card().querySelector('[data-quiz-action="add-option"]').click(); await tick(); }
        assert.equal(card().querySelector('[data-quiz-action="add-option"]'), null);
        assert.equal(card().querySelectorAll('.quiz-option-row').length, 6);
      } else { card().querySelectorAll('[data-quiz-correct]')[1].click(); await tick(); }
    }
  }
  h.d.getElementById('quiz-publish-button').click(); await tick();
  assert.equal(saved.length, 1, h.d.getElementById('quiz-builder-status').textContent);
  const value = JSON.parse(saved[0].content);
  assert.deepEqual(value.questions.map((q) => q.type), ['flashcard', 'single', 'multiple', 'text']);
  for (const question of value.questions) {
    assert.ok(question.prompt.startsWith(`\\(${formula}\\)`));
    assert.ok(question.explanation.startsWith(`\\(${formula}\\)`));
  }
  assert.equal(value.questions[2].options.filter((option) => option.correct).length, 2);
  assert.equal(value.questions[1].options[0].image.ref, 'assets/shared/replaced-option.webp');
  assert.ok(value.questions[1].options[0].text.startsWith(`\\(${formula}\\)`));
  assert.ok(value.questions[3].acceptedAnswers[0].startsWith(`\\(${formula}\\)`));
  assert.equal(value.questions[3].textCompare.maxTypos, 2);
  assert.equal(require('../netlify/quiz-common').validateDefinition(value).valid, true);
});

test('Studio publishes occlusion through the existing image picker, previews masks and confirms replacement', async (t) => {
  const writes = [], images = [];
  const h = await studio(t, { save: async (kind, value) => { writes.push({ kind, ...plain(value) }); return { sha: 'c'.repeat(40) }; }, readMediaBlob: async (value) => { images.push(value); return new Blob(['fixture']); } });
  h.w.MathJax = { typesetClear() {}, typesetPromise: async () => {} };
  h.w.URL.createObjectURL = () => 'blob:https://course.example/masks'; h.w.URL.revokeObjectURL = () => {};
  h.w.fetch = async () => new Response(JSON.stringify({ catalog: { nodes: [{ id: 'course', type: 'course', title: 'Histologia' }] } }));
  let media;
  h.w.ChemMediaManager = { open: async (options) => { media = options; } };
  await input(h.w, h.d.getElementById('studio-tool-select'), 'quiz');
  h.d.getElementById('quiz-new-deck-button').click(); await tick();
  await input(h.w, h.d.getElementById('quiz-course'), 'course');
  h.d.querySelector('[data-quiz-add="image_occlusion"]').click(); await tick();
  await input(h.w, h.d.querySelector('[data-quiz-field="frontText"]'), 'Wstęp');
  await input(h.w, h.d.querySelector('[data-quiz-field="backText"]'), 'Powtórka');
  h.d.querySelector('.io-editor .io-toolbar button').click(); await tick();
  assert.equal(media.scope, 'shared');
  media.onSelect({ reference: 'assets/shared/histologia.webp', filename: 'Tkanka' }); await tick();
  h.d.querySelector('[data-io-add]').click(); await tick();
  await input(h.w, h.d.querySelector('[data-io-coordinate="x"]'), '22');
  h.d.querySelector('[data-io-coordinate="x"]').dispatchEvent(new h.w.Event('change', { bubbles: true })); await tick();
  const answer = h.d.querySelector('[aria-label="Odpowiedź maski (opcjonalnie)"]');
  await input(h.w, answer, 'Jądro komórkowe: '); answer.focus(); answer.setSelectionRange(answer.value.length, answer.value.length);
  answer.closest('.quiz-math-field').querySelector('.assessment-equation-trigger').click(); await tick();
  const dialog = h.d.querySelector('.assessment-equation-dialog');
  await input(h.w, dialog.querySelector('textarea[aria-label="Wzór matematyczny"]'), '\\alpha + \\beta');
  dialog.querySelector('[aria-label="Wstaw do wybranego pola"]').click(); await tick();
  await input(h.w, h.d.querySelector('[aria-label="Wyjaśnienie maski (opcjonalnie)"]'), '**Opis**\nDrugi wiersz.');
  await input(h.w, h.d.querySelector('[data-occlusion-mode]'), 'all');
  h.d.getElementById('quiz-publish-button').click(); await tick();
  assert.equal(writes.length, 1, h.d.getElementById('quiz-builder-status').textContent);
  const value = JSON.parse(writes[0].content), q = value.questions[1];
  assert.equal(q.type, 'image_occlusion'); assert.equal(q.image.ref, 'assets/shared/histologia.webp');
  assert.equal(q.occlusion.masks[0].x, .22); assert.equal(q.occlusion.mode, 'all');
  assert.equal(q.occlusion.masks[0].answer, 'Jądro komórkowe: \\(\\alpha + \\beta\\)');
  assert.equal(require('../netlify/quiz-common').validateDefinition(value).valid, true);
  assert.ok(images.some((image) => image.reference === 'assets/shared/histologia.webp'));
  h.w.confirm = () => false;
  h.d.querySelector('.io-editor .io-toolbar button').click(); await tick();
  media.onSelect({ reference: 'assets/shared/new.webp', filename: 'Nowy' }); await tick();
  h.w.ChemQuizBuilder.flush();
  let draft = JSON.parse(h.w.localStorage.getItem('chemdisk.studio.quiz.v1'));
  assert.equal(draft.questions[1].image.ref, q.image.ref); assert.equal(draft.questions[1].occlusion.masks.length, 1);
  h.w.confirm = () => true;
  media.onSelect({ reference: 'assets/shared/new.webp', filename: 'Nowy' }); await tick();
  h.w.ChemQuizBuilder.flush(); draft = JSON.parse(h.w.localStorage.getItem('chemdisk.studio.quiz.v1'));
  assert.equal(draft.questions[1].image.ref, 'assets/shared/new.webp'); assert.deepEqual(draft.questions[1].occlusion.masks, []);
});

function pasteImage(h, target, file, itemsOnly = false) {
  const event = new h.w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: itemsOnly ? [] : [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } });
  target.dispatchEvent(event);
  return event;
}

async function occlusionUploadStudio(t, overrides = {}) {
  const uploads = [];
  const h = await studio(t, {
    uploadMedia: async (value) => { uploads.push(plain(value)); return { reference: `${value.scope === 'local' ? 'photos' : 'assets/shared'}/${value.filename}` }; },
    readMediaBlob: async () => new Blob(['fixture']), ...overrides
  });
  h.w.URL.createObjectURL = () => 'blob:https://course.example/fixture'; h.w.URL.revokeObjectURL = () => {};
  h.evalFile('assets/js/media-manager.js');
  await input(h.w, h.d.getElementById('studio-tool-select'), 'quiz');
  h.d.querySelector('[data-quiz-add="image_occlusion"]').click(); await tick();
  const draft = () => { h.w.ChemQuizBuilder.flush(); return JSON.parse(h.w.localStorage.getItem('chemdisk.studio.quiz.v1')); };
  return { ...h, uploads, draft, source: () => h.d.querySelector('.io-image-drop'), card: () => draft().questions.find((q) => q.type === 'image_occlusion') };
}

test('mask editor pastes files and clipboard items via existing storage without affecting normal text paste', async (t) => {
  const h = await occlusionUploadStudio(t);
  const file = new h.w.File(['pasted-image'], 'clipboard.png', { type: 'image/png' });
  assert.equal(pasteImage(h, h.source(), file).defaultPrevented, true);
  await tick(); await tick();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].scope, 'shared');
  assert.equal(h.uploads[0].repositoryId, 'glowne');
  assert.equal(h.uploads[0].contentBase64, Buffer.from('pasted-image').toString('base64'));
  assert.match(h.card().image.ref, /^assets\/shared\/clipboard-.*\.png$/);
  assert.equal(h.d.activeElement, h.source(), 'Paste target keeps keyboard focus after rerender');
  const text = new h.w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(text, 'clipboardData', { value: { files: [], items: [{ kind: 'string', type: 'text/plain' }] } });
  h.d.querySelector('.io-editor textarea').dispatchEvent(text);
  assert.equal(text.defaultPrevented, false);
  assert.equal(pasteImage(h, h.d.querySelector('.io-editor textarea'), file, true).defaultPrevented, true);
  await tick(); await tick();
  assert.equal(h.uploads.length, 2, 'Item-only clipboard is supported too');
});

test('mask image replacement preserves masks on cancellation or upload failure, clears them only on success', async (t) => {
  let fail = false, calls = 0;
  const h = await occlusionUploadStudio(t, { uploadMedia: async () => { calls++; if (fail) throw Error('Brak połączenia'); return { reference: `assets/shared/image-${calls}.png` }; } });
  const file = new h.w.File(['image'], 'image.png', { type: 'image/png' });
  pasteImage(h, h.source(), file); await tick(); await tick();
  h.d.querySelector('[data-io-add]').click(); await tick();
  const original = h.card(); assert.equal(original.occlusion.masks.length, 1);
  h.w.confirm = () => false;
  pasteImage(h, h.source(), file); await tick();
  assert.equal(calls, 1); assert.deepEqual(h.card(), original);
  h.w.confirm = () => true; fail = true;
  pasteImage(h, h.source(), file); await tick(); await tick();
  assert.match(h.d.querySelector('.io-upload-status').textContent, /Brak połączenia/);
  assert.equal(h.d.querySelector('.io-editor').inert, false);
  assert.deepEqual(h.card(), original);
  fail = false;
  pasteImage(h, h.source(), file); await tick(); await tick();
  assert.equal(h.card().image.ref, 'assets/shared/image-3.png');
  assert.deepEqual(h.card().occlusion.masks, []);
});

test('mask editor supports drop and file selection, rejecting oversized or unsupported images before requests', async (t) => {
  const h = await occlusionUploadStudio(t);
  for (const file of [new h.w.File(['pdf'], 'file.pdf', { type: 'application/pdf' }), new h.w.File([new Uint8Array(4 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' })]) {
    const event = new h.w.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } }); h.source().dispatchEvent(event);
    await tick();
    assert.equal(event.defaultPrevented, true); assert.equal(h.uploads.length, 0);
    assert.match(h.d.querySelector('.io-upload-status').textContent, /4 MB/);
  }
  const file = new h.w.File(['image'], 'image.webp', { type: 'image/webp' });
  const drop = new h.w.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } }); h.source().dispatchEvent(drop);
  await tick(); await tick(); assert.equal(h.uploads.length, 1);
  const control = h.source().querySelector('input[type="file"]');
  Object.defineProperty(control, 'files', { value: [file] }); control.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  await tick(); await tick(); assert.equal(h.uploads.length, 2);
  assert.equal(h.uploads[1].mimeType, 'image/webp');
});

test('published quiz paste uses its own repository and local photos and resets scrolling when loaded', async (t) => {
  const model = require('../public/members/module/studio/quiz-model');
  const saved = model.createQuiz({ quizId: 'saved-masks', questions: [{ type: 'image_occlusion' }] });
  const h = await occlusionUploadStudio(t, { readQuiz: async () => ({ quiz: saved, sha: 'a'.repeat(40) }) });
  const panels = [...h.d.querySelectorAll('#quiz-workspace, .quiz-editor-panel, .quiz-preview-panel')];
  const report = h.d.getElementById('quiz-report-disclosure');
  assert.ok(h.d.querySelector('.quiz-editor-panel').contains(report));
  report.open = true; panels.forEach((node) => { node.scrollTop = 600; });
  await h.w.ChemQuizBuilder.openAsset({ quizId: saved.quizId, repositoryId: 'other-repo', sha: 'a'.repeat(40) }); await tick();
  assert.ok(panels.every((node) => node.scrollTop === 0)); assert.equal(report.open, false);
  pasteImage(h, h.source(), new h.w.File(['image'], 'image.png', { type: 'image/png' })); await tick(); await tick();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].scope, 'local'); assert.equal(h.uploads[0].materialKind, 'quiz');
  assert.equal(h.uploads[0].materialId, saved.quizId); assert.equal(h.uploads[0].repositoryId, 'other-repo');
  assert.match(h.card().image.ref, /^photos\//);
});

test('late image upload never attaches to another quiz opened during the upload', async (t) => {
  let complete;
  const h = await occlusionUploadStudio(t, { uploadMedia: () => new Promise((resolve) => { complete = resolve; }) });
  pasteImage(h, h.source(), new h.w.File(['image'], 'image.png', { type: 'image/png' })); await tick(); await tick();
  assert.equal(typeof complete, 'function');
  h.d.getElementById('quiz-new-button').click(); await tick();
  const next = h.draft(); complete({ reference: 'assets/shared/late.png' }); await tick();
  assert.deepEqual(h.draft(), next);
});

test('React keeps the random mask and revealed answer when the surrounding quiz updates or expands', async (t) => {
  const h = setup(t, 'members/module/quiz/index.html');
  h.w.MathJax = { typesetPromise: async () => {}, typesetClear() {} };
  let choices = 0;
  h.w.Math.random = () => { choices++; return .8; };
  const q = require('../public/members/module/studio/quiz-model').createQuestion({
    type: 'image_occlusion', image: { ref: 'photos/tkanka.png' }, occlusion: { mode: 'random', masks: [
      { maskId: 'a', x: .2, y: .2, width: .1, height: .1, answer: 'A' },
      { maskId: 'b', x: .6, y: .6, width: .1, height: .1, answer: 'B' }
    ] }
  });
  const props = { questions: [q, ...Array.from({ length: 25 }, (_, i) => ({ questionId: `t${i}`, type: 'text', prompt: 'Tekst', image: {}, points: 1 }))], answers: {}, results: {}, getUrl: async () => 'blob:fixture', onAnswer() {} };
  const host = h.d.getElementById('quiz-player-form');
  h.render('quiz-questions', props, host); await tick();
  const card = host.querySelector('.io-card');
  card.querySelector('[data-flashcard-reveal]').click();
  assert.equal(choices, 1); assert.equal(card.querySelector('.is-revealed').dataset.maskId, 'b');
  h.render('quiz-questions', { ...props, locked: true }, host); await tick();
  host.querySelector('.react-list-more button').click(); await tick();
  assert.equal(host.querySelector('.io-card'), card); assert.equal(choices, 1);
  assert.equal(card.querySelector('[data-mask-answer]').textContent.includes('B'), true);
});

test('React library paginates without fetching and only loads media after opening material', async (t) => {
  const h = setup(t);
  const assets = Array.from({ length: 50 }, (_, i) => ({ filename: `lesson${i}.md`, title: `Lekcja ${i}`, kind: 'lesson', repositoryId: 'glowne' }));
  const paging = require('../public/members/module/studio/paged-list');
  const pagingState = paging.createState();
  let loads = 0;
  const adapters = { repositoryId: 'glowne', open: new Set(), mediaKey: (kind, id) => `${kind}:${id}`, size: () => '25 KB', renderMedia: () => h.d.createElement('div'), renderShared: () => h.d.createElement('div'),
    toggle(key, open) { if (open) this.open.add(key); else this.open.delete(key); }, loadMedia() { loads++; }, more(page) { paging.more(pagingState, page.key, page.total); draw(); } };
  function draw() { h.render('studio-library', { groups: [{ kind: 'lesson', title: 'Lekcje', icon: 'L', assets, paged: paging.page(pagingState, 'lessons', assets) }], adapters }); }
  draw();
  assert.equal(h.d.querySelectorAll('.content-explorer-material').length, 0);
  h.d.querySelector('summary').click(); await tick();
  assert.equal(h.d.querySelectorAll('.content-explorer-material').length, 12);
  assert.equal(loads, 0);
  h.d.querySelector('.studio-list-more').click(); await tick();
  assert.equal(h.d.querySelectorAll('.content-explorer-material').length, 24);
  h.d.querySelector('.content-explorer-material summary').click(); await tick();
  assert.equal(loads, 1);
  assert.equal(h.d.querySelector('[data-explorer-open]').dataset.explorerRepository, 'glowne');
  draw(); assert.equal(loads, 1, 'Rendering does not reload media');
});

test('AI limit controls distinguish zero from empty and payment fields preserve IDs and validation', async (t) => {
  const h = setup(t);
  const props = { metrics: ['requests'], periods: ['hour'], values: { requests: { hour: 0 } }, labels: { requests: 'Żądania' }, periodLabels: { hour: 'Godzina' }, selection: 'default' };
  h.render('studio-ai-limit-grid', props);
  assert.equal(h.d.querySelector('input').value, '0');
  await input(h.w, h.d.querySelector('input'), '20');
  assert.equal(h.d.querySelector('input').value, '20');
  h.render('studio-ai-limit-grid', { ...props, values: null, selection: 'user' });
  assert.equal(h.d.querySelector('input').value, '');
  h.render('studio-price-fields', {});
  assert.equal(h.d.querySelectorAll('.admin-price-plan').length, 6);
  assert.equal(h.d.getElementById('admin-price-month').getAttribute('step'), '0.01');
  assert.equal(h.d.getElementById('admin-price-year').required, true);
});

test('actual quiz publication accepts manual open questions and a failed save leaves the local draft intact', async (t) => {
  const writes = [];
  let fail = true;
  const h = await studio(t, { save: async (kind, value) => { writes.push({ kind, ...value }); if (fail) throw new Error('Zapis niedostępny'); return { sha: 'published-sha' }; } });
  await input(h.w, h.d.getElementById('studio-tool-select'), 'quiz');
  await input(h.w, h.d.querySelector('[data-quiz-field="type"]'), 'open');
  await input(h.w, h.d.querySelector('[data-quiz-field="prompt"]'), 'Wyjaśnij rolę błony komórkowej.');
  await input(h.w, h.d.getElementById('quiz-title'), 'Pytania otwarte');
  h.d.getElementById('quiz-publish-button').click(); await tick();
  assert.equal(writes.length, 1);
  const sent = JSON.parse(writes[0].content);
  assert.equal(sent.questions[0].type, 'open');
  assert.equal(sent.questions[0].gradingMode, 'manual');
  assert.equal(sent.metadata.status, 'published');
  h.w.ChemQuizBuilder.flush();
  assert.equal(JSON.parse(h.w.localStorage.getItem('chemdisk.studio.quiz.v1')).metadata.status, 'draft');
  assert.match(h.d.getElementById('quiz-builder-status').textContent, /Zapis niedostępny/);
  fail = false;
  h.d.getElementById('quiz-publish-button').click(); await tick();
  h.w.ChemQuizBuilder.flush();
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(h.w.localStorage.getItem('chemdisk.studio.quiz.v1')).metadata.status, 'published');
  const reads = [];
  h.w.fetch = async (url, options) => {
    assert.notEqual(options.method, 'POST');
    const cursor = new URL(url).searchParams.get('cursor'); reads.push(cursor);
    return new Response(JSON.stringify({ cursor: cursor ? null : 'offset:25', metricsScope: 'page', metrics: { participants: 1, attempts: 1, pendingReview: 1, graded: 0, average: 0 },
      attempts: [{ attemptId: cursor ? 'older' : 'newer', userId: 'student', number: 1, gradingStatus: 'pending_review' }] }));
  };
  h.d.getElementById('quiz-report-refresh').click(); await tick();
  assert.match(h.d.getElementById('quiz-report-status').textContent, /tej części/);
  h.d.querySelector('[data-quiz-report-action="next"]').click(); await tick();
  assert.equal(h.d.querySelectorAll('[data-quiz-report-action="open"]').length, 1);
  assert.equal(h.d.querySelector('[data-quiz-report-action="open"]').dataset.attemptId, 'older');
  h.d.querySelector('[data-quiz-report-action="first"]').click(); await tick();
  assert.deepEqual(reads, [null, 'offset:25', null]);
});

test('landing reconciles published sections, keeps native form/3D/pricing nodes and applies independent field colors', async (t) => {
  const h = setup(t, 'index.html');
  let requests = 0;
  h.w.fetch = async () => { requests++; throw new Error('Rendering must not fetch'); };
  h.w.NextMedLandingSource = { ready: Promise.resolve({ unavailable: true }) };
  const form = h.d.querySelector('form[name="contact"]');
  const molecule = h.d.getElementById('hero-biomolecule');
  const pricing = h.d.querySelector('[data-pricing]');
  const email = form.querySelector('[name="email"]'); email.value = 'student@example.com';
  let submits = 0; form.addEventListener('submit', (event) => { event.preventDefault(); submits++; });
  const observers = [];
  h.w.IntersectionObserver = class { constructor(callback) { this.callback = callback; this.nodes = []; observers.push(this); } observe(node) { this.nodes.push(node); } disconnect() { this.nodes = []; } unobserve() {} };
  h.evalFile('assets/start_site/script.js');
  h.evalFile('assets/js/landing-runtime.js'); await tick();
  assert.equal(h.d.querySelector('main').dataset.reactView, 'landing-page');
  assert.ok(observers.at(-1).nodes.some((node) => node.closest('main')), 'Motion reattaches to new React DOM even without a published model');
  assert.ok(observers.at(-1).nodes.every((node) => node.isConnected));
  const model = { branding: { brandName: 'NextMed', tagline: 'Nowy kurs' }, sections: [...h.d.querySelectorAll('main > section')].map((section, i) => ({
    id: section.id, order: i, enabled: true, title: `Nowy ${section.id}`, subtitle: 'Podtytuł', body: 'Treść', ctaLabel: 'Poznaj kurs', ctaHref: '#pricing', heroVisual: 'biomolecule-banner',
    backgroundColor: '#123456', textColor: '#ffffff', fieldBackgroundColor: '#abcdef', fieldTextColor: '#112233'
  })) };
  assert.equal(h.w.NextMedLanding.applyModel(model), true);
  assert.match(h.d.querySelector('#home .text-2').textContent, /Nowy home/);
  assert.equal(h.d.getElementById('home').dataset.heroVisual, 'biomolecule-banner');
  model.sections.find((s) => s.id === 'contact').order = -1;
  model.sections.find((s) => s.id === 'services').enabled = false;
  assert.equal(h.w.NextMedLanding.applyModel(model), true);
  assert.equal(h.d.querySelector('main > section').id, 'contact');
  assert.equal(h.d.getElementById('services').hidden, true);
  assert.equal(h.d.querySelector('form[name="contact"]'), form);
  assert.equal(h.d.getElementById('hero-biomolecule'), molecule);
  assert.equal(h.d.querySelector('[data-pricing]'), pricing);
  assert.equal(email.value, 'student@example.com');
  assert.equal(email.style.backgroundColor, 'rgb(171, 205, 239)');
  assert.equal(h.d.getElementById('contact').style.backgroundColor, 'rgb(18, 52, 86)');
  form.dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(submits, 1);
  h.evalFile('assets/js/landing-session.js');
  const hero = model.sections.find((s) => s.id === 'home');
  hero.ctaHref = '/login/'; hero.ctaLabel = 'Zaloguj się';
  h.w.NextMedLanding.applyModel(model);
  assert.equal(h.d.getElementById('login-cta').textContent, 'Przejdź do kursu');
  hero.ctaLabel = 'Dołącz do nas'; h.w.NextMedLanding.applyModel(model);
  h.w.dispatchEvent(new h.w.CustomEvent('chem-auth-user-changed', { detail: { authenticated: false } }));
  assert.equal(h.d.getElementById('login-cta').textContent, 'Dołącz do nas');
  assert.equal(h.d.getElementById('login-cta').getAttribute('href'), '/login/');
  assert.equal(requests, 0);
});

for (const admin of [true, false]) test(`Studio settings ${admin ? 'load only the selected admin tool' : 'deny a student without any admin request'}`, async (t) => {
  const h = setup(t, 'members/module/studio/admin/index.html', '?tab=users');
  await tick();
  const user = { id: admin ? 'admin' : 'student', email: 'person@example.com', user_metadata: {}, app_metadata: { roles: [admin ? 'admin' : 'active'] }, jwt: async () => 'fixture-jwt' };
  h.w.ChemAuth.getUser = () => user;
  const requests = [];
  h.w.fetch = async (url) => { requests.push(String(url)); return new Response(JSON.stringify({ users: Array.from({ length: 65 }, (_, i) => ({ id: `student-${i}`, email: `student${i}@example.com`, app_metadata: { roles: ['active'] }, user_metadata: {} })), total: 65, pagination: { hasMore: false } })); };
  h.evalFile('members/dashboard.js'); await tick();
  assert.equal(h.d.body.dataset.adminReady === 'true', admin);
  assert.equal(h.d.getElementById('admin-dialog').hasAttribute('open'), admin);
  if (admin) {
    assert.equal(requests.length, 1); assert.match(requests[0], /functions\/admin-users/);
    assert.equal(h.d.querySelectorAll('.admin-user-card').length, 24);
    h.d.querySelector('.react-list-more button').click(); await tick();
    assert.equal(h.d.querySelectorAll('.admin-user-card').length, 48);
    await input(h.w, h.d.getElementById('admin-user-search'), 'student64');
    assert.equal(h.d.querySelectorAll('.admin-user-card').length, 1);
    assert.match(h.d.querySelector('.admin-user-card').textContent, /student64@example/);
    assert.equal(requests.length, 1, 'Paging and search are local');
  }
  else { assert.deepEqual(requests, []); assert.match(h.d.getElementById('studio-admin-access').textContent, /Brak dostępu/); }
  assert.ok(requests.every((url) => !/admin-dashboard|progress|dashboard\.md/.test(url)));
});

test('actual Studio exam report pages on demand without accumulating rows or sending mutations', async (t) => {
  const model = require('../public/members/module/studio/exam-model');
  const exam = model.createExam({ examId: 'report-test' });
  const h = await studio(t, { readExam: async () => ({ content: JSON.stringify(exam), sha: 'saved-exam' }) });
  await input(h.w, h.d.getElementById('studio-tool-select'), 'exam');
  await h.w.ChemExamBuilder.openAsset({ filename: exam.examId, repositoryId: 'glowne' });
  const reads = [];
  h.w.fetch = async (url, options) => {
    assert.notEqual(options.method, 'POST');
    const cursor = new URL(url).searchParams.get('cursor'); reads.push(cursor);
    return new Response(JSON.stringify({ cursor: cursor ? null : 'offset:25', metricsScope: 'page', metrics: { participants: 1, attempts: 1 },
      attempts: [{ attemptId: cursor ? 'older-exam' : 'newer-exam', userId: 'student', number: 1, status: 'submitted', gradingStatus: 'pending_review' }] }));
  };
  h.d.querySelector('[data-exam-tab="reports"]').click(); await tick();
  assert.equal(reads.length, 1, 'Opening the report loads its first page once');
  assert.match(h.d.querySelector('.exam-report-view').textContent, /tej części/);
  h.d.querySelector('[data-exam-action="next-report"]').click(); await tick();
  assert.equal(h.d.querySelectorAll('[data-exam-action="open-attempt-report"]').length, 1);
  assert.equal(h.d.querySelector('[data-exam-action="open-attempt-report"]').dataset.attemptId, 'older-exam');
  h.d.querySelector('[data-exam-action="first-report"]').click(); await tick();
  assert.deepEqual(reads, [null, 'offset:25', null]);
});

test('exam review selects students and attempts, keeps drafts, grades partially and never starts AI on opening', async (t) => {
  const model = require('../public/members/module/studio/exam-model');
  const exam = model.createExam({ examId: 'review-test', questions: ['one', 'two'].map((questionId) => ({ questionId, type: 'open_answer', gradingMode: 'ai', answerKey: 'Klucz\nDrugi wiersz', points: 4, prompt: 'Wyjaśnij.\nUzasadnij.' })) });
  const h = await studio(t, { readExam: async () => ({ content: JSON.stringify(exam), sha: 'saved' }) });
  h.w.CSS = { escape: (value) => value };
  await input(h.w, h.d.getElementById('studio-tool-select'), 'exam');
  await h.w.ChemExamBuilder.openAsset({ filename: exam.examId, repositoryId: 'glowne' });
  const row = (userId, attemptId) => ({ userId, attemptId, number: 1, profile: { name: userId === 'a' ? 'Łucja' : 'Bartosz', email: `${userId}@example.com` }, status: 'submitted', gradingStatus: 'pending_review', startedAt: '2026-01-01T12:00:00Z' });
  const rows = [row('a', 'a-latest'), row('b', 'b-latest')];
  const report = (userId, attemptId) => ({ ...row(userId, attemptId), repositoryId: 'glowne', examId: exam.examId, revision: 1, durationSeconds: 10,
    questions: exam.questions.map((q) => ({ ...q, answerDisplay: ['Uczeń: pierwszy wiersz\nDrugi wiersz'], correctAnswerDisplay: [q.answerKey] })),
    result: { gradingStatus: 'pending_review', pendingQuestionIds: ['one', 'two'], questionResults: exam.questions.map((q) => ({ questionId: q.questionId, points: null, maxPoints: 4, reviewStatus: 'pending' })) } });
  const requests = []; let completeGrade;
  h.w.fetch = async (url, options = {}) => {
    const params = new URL(url, h.w.location.origin).searchParams;
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); requests.push(body);
      assert.equal(body.action, 'grade', 'Only an explicit manual save may mutate');
      return new Promise((resolve) => { completeGrade = () => { const attempt = report(body.targetUserId, body.attemptId); attempt.revision++;
        attempt.result.questionResults[0] = { questionId: 'one', points: 2.5, maxPoints: 4, reviewStatus: 'graded', feedback: 'Dobrze\nDodaj przykład' };
        attempt.result.pendingQuestionIds = ['two']; resolve(new Response(JSON.stringify({ attempt }))); }; });
    }
    const view = params.get('view'); requests.push({ view, cursor: params.get('cursor') });
    if (view === 'review') return new Response(JSON.stringify({ attempts: params.get('cursor') ? [rows[1]] : [rows[0]], cursor: params.get('cursor') ? null : 'offset:25' }));
    if (view === 'user') return new Response(JSON.stringify({ user: { attempts: [row(params.get('userId'), `${params.get('userId')}-latest`), row(params.get('userId'), `${params.get('userId')}-older`)] } }));
    assert.equal(view, 'attempt');
    return new Response(JSON.stringify({ attempt: report(params.get('userId'), params.get('attemptId')) }));
  };
  h.d.querySelector('[data-exam-tab="review"]').click(); await tick();
  assert.equal(requests.length, 1);
  assert.equal(h.d.querySelector('.exam-workspace').classList.contains('is-reviewing'), true);
  assert.equal(h.d.getElementById('exam-builder-status').parentElement.classList.contains('exam-editor-panel'), true, 'Review messages remain in the answer panel, not the hidden summary');
  assert.equal(h.d.getElementById('exam-editor-eyebrow').textContent, 'Odpowiedzi uczestników');
  h.d.querySelector('[data-review-more]').click(); await tick();
  assert.equal(h.d.querySelectorAll('[data-review-user]').length, 2);
  await input(h.w, h.d.querySelector('[data-review-search]'), 'lucja');
  assert.equal(h.d.querySelectorAll('[data-review-user]').length, 1);
  h.d.querySelector('[data-review-user="a"]').click(); await tick(); await tick();
  assert.equal(h.d.querySelectorAll('[data-review-attempt] option').length, 2);
  assert.equal(h.d.querySelector('.exam-attempt-question').open, true);
  assert.equal(h.d.querySelector('.assessment-answer-card p').style.fontSize, 'inherit');
  assert.match(h.d.querySelector('.assessment-answer-card p').innerHTML, /<br>/);
  await input(h.w, h.d.querySelector('[data-exam-grade-points="one"]'), '2.5');
  await input(h.w, h.d.querySelector('[data-exam-grade-feedback="one"]'), 'Dobrze\nDodaj przykład');
  await input(h.w, h.d.querySelector('[data-exam-grade-feedback="two"]'), 'Jeszcze nieskończony komentarz');
  await input(h.w, h.d.querySelector('[data-review-attempt]'), 'a-older'); await tick();
  await input(h.w, h.d.querySelector('[data-review-attempt]'), 'a-latest'); await tick();
  assert.equal(h.d.querySelector('[data-exam-grade-points="one"]').value, '2.5');
  h.d.querySelector('[data-exam-action="grade-attempt"]').click(); await tick();
  assert.equal(h.d.querySelector('[data-exam-action="reset-attempt"]').disabled, true, h.d.getElementById('exam-builder-status').textContent);
  assert.equal(h.d.querySelector('[data-exam-grade-points="one"]').disabled, true);
  const post = requests.find((r) => r.action);
  assert.deepEqual(post.grades, [{ questionId: 'one', points: 2.5, feedback: 'Dobrze\nDodaj przykład' }]);
  completeGrade(); await tick();
  assert.equal(h.d.querySelector('[data-exam-grade-feedback="two"]').value, 'Jeszcze nieskończony komentarz', 'Unsubmitted draft comments are retained');
  assert.equal(requests.filter((r) => r.action).length, 1);
  assert.equal(requests.filter((r) => r.view === 'review').length, 2, 'No automatic refresh or polling after saving a grade');
  assert.equal(requests.some((r) => r.view === 'overview' || r.action === 'ai-grade'), false);
  h.d.querySelector('[data-exam-tab="questions"]').click(); await tick();
  assert.equal(h.d.querySelector('.exam-workspace').classList.contains('is-reviewing'), false);
  assert.equal(h.d.getElementById('exam-builder-status').parentElement.classList.contains('exam-summary-panel'), true, 'Leaving review restores the normal definition layout and status');
  assert.equal(h.d.getElementById('exam-editor-eyebrow').textContent, 'Definicja egzaminu');
});

test('Studio adds and edits Google cards in both builders and preserves the student preview', async (t) => {
  const h = await studio(t);
  const url = 'https://drive.google.com/file/d/1ExampleFile12345/view';
  await input(h.w, h.d.getElementById('studio-tool-select'), 'lesson');
  h.d.querySelector('[data-lesson-add="google"]').click(); await tick();
  await input(h.w, h.d.querySelector('[data-lesson-field="url"]'), url);
  await input(h.w, h.d.querySelector('[data-lesson-field="title"]'), 'Nagranie do lekcji');
  await input(h.w, h.d.querySelector('[data-lesson-field="width"]'), '80');
  await input(h.w, h.d.querySelector('[data-lesson-field="heightPercent"]'), '25');
  h.d.querySelector('[data-lesson-panel="preview"]').click(); await tick();
  const preview = h.d.querySelector('.lesson-preview-body [data-google-media]');
  assert.ok(preview);
  assert.equal(preview.style.getPropertyValue('--google-media-height'), '25vh');
  assert.equal(preview.querySelector('iframe'), null);
  preview.querySelector('[data-google-load]').click();
  assert.equal(preview.querySelector('iframe').src, url.replace('/view', '/preview'));
  const notebook = 'https://notebooklm.google.com/notebook/34d7c6f5-8448-4a4b-88a2-54ca40c451dc';
  await input(h.w, h.d.querySelector('[data-lesson-field="url"]'), notebook);
  const notebookPreview = h.d.querySelector('.lesson-preview-body [data-google-media]');
  assert.equal(notebookPreview.querySelector('iframe'), null);
  assert.equal(notebookPreview.querySelector('[data-google-outside]').href, notebook);
  assert.equal(h.d.querySelector('.google-editor-dimensions').hidden, true);
  assert.equal(h.d.querySelector('.google-editor-options > a').href, notebook);
  await input(h.w, h.d.querySelector('[data-lesson-field="url"]'), url);
  assert.equal(h.d.querySelector('.google-editor-dimensions').hidden, false);

  await input(h.w, h.d.getElementById('studio-tool-select'), 'dashboard');
  h.d.querySelector('[data-dashboard-add="google"]').click(); await tick();
  await input(h.w, h.d.querySelector('[data-dashboard-field="id"]'), url);
  await input(h.w, h.d.querySelector('[data-dashboard-field="embedWidth"]'), '75');
  await input(h.w, h.d.querySelector('[data-dashboard-field="embedHeightPercent"]'), '30');
  h.w.dispatchEvent(new h.w.Event('pagehide'));
  const stored = JSON.parse(h.w.localStorage.getItem('chemdisk.studio.dashboard.v1'));
  const source = h.w.ChemDashboardStudioModel.serialize(stored);
  assert.match(source, /\/members\/module\/google\/\?id=/);
  assert.match(source, /width=75&heightPercent=30/);
  assert.equal(h.w.ChemDashboardStudioModel.validate(stored).valid, true);
});

test('Lesson Builder selects only an active published learning pool and preserves the link in preview', async (t) => {
  const model = require('../public/members/module/studio/quiz-model');
  const h = await studio(t, {
    list: async (kind) => kind === 'quiz' ? [{ filename: 'pula', repositoryId: 'glowne', title: 'Pula biologii' }, { filename: 'zwykly', repositoryId: 'glowne', title: 'Zwykły quiz' }] : [],
    readQuiz: async (id) => ({ content: JSON.stringify(model.createQuiz({ mode: id === 'pula' ? 'deck' : 'quiz', quizId: id, metadata: { status: 'published', courseId: 'course' } })) })
  });
  await input(h.w, h.d.getElementById('studio-tool-select'), 'lesson');
  h.d.querySelector('[data-lesson-add="study"]').click(); await tick();
  const choose = async (id) => {
    h.d.querySelector('#lesson-inspector .studio-material-picker-toggle').click(); await tick();
    h.d.querySelector(`#lesson-inspector [data-picker-value="${id}"]`).click(); await tick();
  };
  await choose('zwykly');
  assert.match(h.d.getElementById('lesson-inspector').textContent, /Wybrana pula: brak/);
  await choose('pula');
  assert.match(h.d.getElementById('lesson-inspector').textContent, /Wybrana pula: pula/);
  h.d.querySelector('[data-lesson-panel="preview"]').click(); await tick();
  const link = h.d.querySelector('.lesson-preview-body .lesson-study-card a');
  assert.ok(link); assert.equal(link.target, '_blank'); assert.match(link.href, /quiz=pula/);
  h.w.dispatchEvent(new h.w.Event('pagehide'));
  const lesson = JSON.parse(h.w.localStorage.getItem('chemdisk.studio.lesson.v1'));
  assert.ok(lesson.slides.some((slide) => slide.blocks.some((block) => block.type === 'study' && block.quizId === 'pula')));
});

test('new flashcards open for editing even after the first three and have a live individual preview', async (t) => {
  const h = await studio(t);
  h.w.MathJax = { typesetClear() {}, typesetPromise: async () => {} };
  h.w.fetch = async () => new Response(JSON.stringify({ catalog: { nodes: [{ id: 'course', type: 'course', title: 'Biologia' }] } }));
  await input(h.w, h.d.getElementById('studio-tool-select'), 'quiz');
  h.d.getElementById('quiz-new-deck-button').click(); await tick();
  for (let i = 0; i < 3; i++) { h.d.querySelector('[data-quiz-add="flashcard"]').click(); await tick(); }
  const card = h.d.querySelector('.quiz-question-card:last-child');
  const front = card.querySelector('[data-quiz-field="frontText"]'); assert.ok(front);
  assert.equal(h.d.activeElement, front);
  await input(h.w, front, 'Co tworzy białka?');
  await input(h.w, card.querySelector('[data-quiz-field="backText"]'), 'Aminokwasy');
  const preview = card.querySelector('.quiz-editor-details'); preview.open = true; await tick();
  assert.match(preview.textContent, /Co tworzy białka/);
  await input(h.w, front, 'Zaktualizowane pytanie'); await new Promise((resolve) => setTimeout(resolve, 250));
  assert.match(preview.textContent, /Zaktualizowane pytanie/);
  card.querySelector('[data-quiz-action="preview-question"]').click(); await tick();
  assert.match(h.d.getElementById('quiz-preview').textContent, /Karta 4/);
  assert.match(h.d.getElementById('quiz-preview').textContent, /Zaktualizowane pytanie/);
});

test('actual lesson builder uses multiline options and the same line breaks in saved Markdown and preview', async (t) => {
  const h = await studio(t);
  await input(h.w, h.d.getElementById('studio-tool-select'), 'lesson');
  h.d.querySelector('[data-lesson-add="task-abcd"]').click(); await tick();
  const option = h.d.querySelector('[data-lesson-field="optionItem"]');
  assert.equal(option.tagName, 'TEXTAREA');
  await input(h.w, option, 'Pierwsza odpowiedź\nJej uzasadnienie');
  await input(h.w, h.d.querySelector('[data-lesson-field="question"]'), 'Wiersz pierwszy\nWiersz drugi\n\nOsobny akapit.');
  h.d.querySelector('[data-lesson-panel="preview"]').click(); await tick();
  assert.equal(h.d.querySelector('.preview-choice-copy').textContent, 'Pierwsza odpowiedź\nJej uzasadnienie');
  assert.match(h.d.querySelector('.lesson-preview-body').innerHTML, /Wiersz pierwszy<br>Wiersz drugi/);
  h.w.dispatchEvent(new h.w.Event('pagehide'));
  const saved = JSON.parse(h.w.localStorage.getItem('chemdisk.studio.lesson.v1'));
  const markdown = h.w.ChemLessonStudioModel.serializeLesson(saved);
  assert.match(markdown, /options_json:/);
  const student = h.w.ChemLesson.parseLesson(markdown, 'entery.md').slides.find((slide) => slide.task);
  assert.equal(student.task.options[0], 'Pierwsza odpowiedź\nJej uzasadnienie');
  assert.match(student.html, /Wiersz pierwszy<br>Wiersz drugi/);
});

test('review ignores late responses from a previously selected student', async (t) => {
  const model = require('../public/members/module/studio/exam-model');
  const exam = model.createExam({ examId: 'race-test' });
  const h = await studio(t, { readExam: async () => ({ content: JSON.stringify(exam), sha: 'saved' }) });
  await input(h.w, h.d.getElementById('studio-tool-select'), 'exam');
  await h.w.ChemExamBuilder.openAsset({ filename: exam.examId, repositoryId: 'glowne' });
  let firstResponse;
  const row = (id) => ({ userId: id, attemptId: `attempt-${id}`, number: 1, gradingStatus: 'pending_review', status: 'submitted', startedAt: '2026-01-01T12:00:00Z' });
  h.w.fetch = async (url) => {
    const params = new URL(url).searchParams; const userId = params.get('userId');
    if (params.get('view') === 'review') return new Response(JSON.stringify({ attempts: [row('a'), row('b')], cursor: null }));
    if (params.get('view') === 'user') return new Response(JSON.stringify({ user: { attempts: [row(userId)] } }));
    const value = { attempt: { ...row(userId), questions: [], answers: {}, result: { gradingStatus: 'pending_review' } } };
    if (userId === 'a') return new Promise((resolve) => { firstResponse = () => resolve(new Response(JSON.stringify(value))); });
    return new Response(JSON.stringify(value));
  };
  h.d.querySelector('[data-exam-tab="review"]').click(); await tick();
  h.d.querySelector('[data-review-user="a"]').click(); await tick();
  h.d.querySelector('[data-review-user="b"]').click(); await tick();
  assert.match(h.d.querySelector('.exam-attempt-report h3').textContent, /^b /);
  firstResponse(); await tick();
  assert.match(h.d.querySelector('.exam-attempt-report h3').textContent, /^b /);
  assert.equal(h.d.querySelector('[data-review-attempt]').value, 'attempt-b');
});

test('CSV preview preserves formulas, explicitly maps headers, confirms once and never publishes before save', async (t) => {
  const writes = [];
  const h = await studio(t, { save: async (kind, value) => { writes.push({ kind, ...plain(value) }); return { sha: 'd'.repeat(40) }; } });
  h.w.fetch = async () => new Response(JSON.stringify({ catalog: { nodes: [{ id: 'course', type: 'course', title: 'Chemia' }] } }));
  await input(h.w, h.d.getElementById('studio-tool-select'), 'quiz');
  h.d.getElementById('quiz-new-deck-button').click(); await tick();
  await input(h.w, h.d.getElementById('quiz-course'), 'course');
  h.d.getElementById('quiz-import-csv-button').click(); await tick();
  assert.equal(h.d.getElementById('quiz-csv-header').checked, false);
  const csv = 'question,answer,explanation,type,tags\n"Woda, wzór?","$H_2O$","\\frac{a}{b}",flashcard,chemia\n"Woda, wzór?","$H_2O$","\\alpha",flashcard,chemia';
  await input(h.w, h.d.getElementById('quiz-csv-paste-input'), csv);
  h.d.getElementById('quiz-csv-header').click();
  h.d.getElementById('quiz-csv-mode-replace').click(); await new Promise((r) => setTimeout(r, 210));
  assert.equal(h.d.getElementById('quiz-csv-confirm-button').disabled, false, h.d.getElementById('quiz-csv-dialog-status').textContent + h.d.getElementById('quiz-csv-preview-count').textContent);
  assert.match(h.d.getElementById('quiz-csv-preview-count').textContent, /Duplikaty: 1/);
  assert.ok(h.d.querySelector('[data-csv-field="question"]'));
  assert.equal(writes.length, 0);
  h.d.getElementById('quiz-csv-confirm-button').click(); await tick();
  assert.equal(writes.length, 0);
  h.w.ChemQuizBuilder.flush();
  const draft = JSON.parse(h.w.localStorage.getItem('chemdisk.studio.quiz.v1'));
  assert.equal(draft.questions.length, 1); assert.equal(draft.questions[0].front.text, 'Woda, wzór?');
  assert.equal(draft.questions[0].back.text, '$H_2O$'); assert.equal(draft.questions[0].explanation, '\\frac{a}{b}');
  h.d.getElementById('quiz-publish-button').click(); await tick();
  assert.equal(writes.length, 1); assert.equal(JSON.parse(writes[0].content).questions.length, 1);
});

function deferredLesson() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function lessonFixture(filename, repositoryId = 'glowne') {
  const model = require('../public/members/module/studio/lesson-model.js');
  const lesson = model.createStarterLesson(filename); lesson.title = `Lekcja ${filename}`;
  return { content: model.serializeLesson(lesson), repositoryId, sha: `fresh-${filename}` };
}
const lessonAssets = ['a.md', 'b.md'].map(filename => ({kind:'lesson', filename, title:filename, repositoryId:'glowne', sha:`old-${filename}`}));
const openLesson = (h, name) => h.d.querySelector(`#lesson-asset-list [data-asset-filename="${name}"]`).click();

test('lesson opening keeps the latest selection and ignores late successes and errors', async t => {
  const pending = [];
  const h = await studio(t, { list: async kind => kind === 'lesson' ? lessonAssets : [], readLesson: (name, options) => {
    const request = deferredLesson(); pending.push({name, options, ...request}); return request.promise;
  }});
  await input(h.w,h.d.getElementById('studio-tool-select'),'lesson');
  openLesson(h,'a.md'); openLesson(h,'b.md');
  assert.equal(h.d.getElementById('lesson-repository-save-button').disabled,true);
  pending[1].resolve(lessonFixture('b.md')); await tick();
  pending[0].resolve(lessonFixture('a.md')); await tick();
  assert.equal(h.d.getElementById('lesson-filename-input').value,'b.md');
  assert.equal(h.d.getElementById('lesson-repository-save-button').disabled,false);
  openLesson(h,'a.md'); openLesson(h,'b.md');
  pending[3].resolve(lessonFixture('b.md')); await tick();
  pending[2].reject(Error('Stary błąd A')); await tick();
  assert.equal(h.d.getElementById('lesson-filename-input').value,'b.md');
  assert.doesNotMatch(h.d.getElementById('lesson-asset-status').textContent,/Stary błąd/);
  assert.equal(pending[0].options.repositoryId,'glowne');
});

test('new lesson, edits and leaving the editor invalidate an outstanding lesson load', async t => {
  let pending;
  const h=await studio(t,{list:async kind=>kind==='lesson'?lessonAssets:[],readLesson:()=>{pending=deferredLesson();return pending.promise;}});
  await input(h.w,h.d.getElementById('studio-tool-select'),'lesson');
  openLesson(h,'a.md');h.d.getElementById('lesson-new-button').click();
  pending.resolve(lessonFixture('a.md'));await tick();
  assert.equal(h.d.getElementById('lesson-filename-input').value,'nowa-lekcja.md');
  openLesson(h,'a.md');await input(h.w,h.d.getElementById('lesson-title-input'),'Bieżąca praca');
  pending.resolve(lessonFixture('a.md'));await tick();
  assert.equal(h.d.getElementById('lesson-title-input').value,'Bieżąca praca');
  openLesson(h,'a.md');await input(h.w,h.d.getElementById('studio-tool-select'),'home');
  pending.resolve(lessonFixture('a.md'));await tick();
  assert.equal(h.d.getElementById('lesson-workspace').hidden,true);
  assert.equal(h.d.getElementById('studio-tool-select').value,'home');
});

test('a late lesson publication cannot replace another document or its current SHA', async t => {
  const saves=[],firstSave=deferredLesson();
  const h=await studio(t,{list:async kind=>kind==='lesson'?lessonAssets:[],readLesson:async name=>lessonFixture(name),save:async(kind,body)=>{
    saves.push({kind,...plain(body)});return saves.length===1?firstSave.promise:{sha:'saved-b',repositoryId:'glowne'};
  }});
  h.w.fetch=async()=>new Response(JSON.stringify({ok:true}));
  await input(h.w,h.d.getElementById('studio-tool-select'),'lesson');
  openLesson(h,'a.md');await tick();h.d.getElementById('lesson-repository-save-button').click();await tick();
  assert.equal(saves[0].expectedSha,'fresh-a.md','Read SHA wins over stale list SHA');
  openLesson(h,'b.md');await tick();firstSave.resolve({sha:'saved-a',repositoryId:'glowne'});await tick();
  assert.equal(h.d.getElementById('lesson-filename-input').value,'b.md');
  h.d.getElementById('lesson-repository-save-button').click();await tick();
  assert.equal(saves[1].filename,'b.md');assert.equal(saves[1].expectedSha,'fresh-b.md');
});

test('typing during publication preserves unpublished changes and guards duplicate submissions', async t => {
  const saves=[],pending=deferredLesson();
  const h=await studio(t,{list:async kind=>kind==='lesson'?lessonAssets:[],readLesson:async name=>lessonFixture(name),save:async(kind,body)=>{
    saves.push(plain(body));return saves.length===1?pending.promise:{sha:'saved-new',repositoryId:'glowne'};
  }});
  h.w.fetch=async()=>new Response(JSON.stringify({ok:true}));
  await input(h.w,h.d.getElementById('studio-tool-select'),'lesson');openLesson(h,'a.md');await tick();
  const publish=h.d.getElementById('lesson-repository-save-button');publish.click();publish.dispatchEvent(new h.w.Event('click'));await tick();
  assert.equal(saves.length,1);
  await input(h.w,h.d.getElementById('lesson-title-input'),'Nowszy tytuł');
  pending.resolve({sha:'saved-old',repositoryId:'glowne'});await tick();
  assert.equal(h.d.getElementById('lesson-title-input').value,'Nowszy tytuł');
  assert.equal(JSON.parse(h.w.localStorage.getItem('chemdisk.studio.lesson.v1')).title,'Nowszy tytuł');
  publish.click();await tick();
  assert.equal(saves[1].expectedSha,'saved-old');assert.match(saves[1].content,/Nowszy tytuł/);
});

test('reloading a Studio tab restores its own lesson and repository metadata instead of another tab draft', async t => {
  const library={repositories:async()=>[{id:'glowne',default:true,label:'Główne'},{id:'biology',label:'Biologia'}],list:async(kind,opts)=>kind==='lesson'?lessonAssets.map(a=>({...a,repositoryId:opts.repositoryId})):[],readLesson:async(name,opts)=>lessonFixture(name,opts.repositoryId)};
  const first=await studio(t,library);
  await input(first.w,first.d.getElementById('studio-tool-select'),'lesson');await input(first.w,first.d.getElementById('lesson-repository-select'),'biology');openLesson(first,'a.md');await tick();
  first.w.dispatchEvent(new first.w.Event('pagehide'));
  const tabDraft=first.w.sessionStorage.getItem('chemdisk.studio.lesson.v1');
  const model=require('../public/members/module/studio/lesson-model.js');
  const secondDraft=JSON.stringify(model.parseEditableLesson(lessonFixture('b.md').content,'b.md'));
  const saves=[];
  const restored=await studio(t,{...library,save:async(kind,body)=>{saves.push(plain(body));return{sha:'saved-a',repositoryId:body.repositoryId}}},h=>{
    h.w.localStorage.setItem('chemdisk.studio.lesson.v1',secondDraft);
    h.w.sessionStorage.setItem('chemdisk.studio.lesson.v1',tabDraft);
  });
  restored.w.fetch=async()=>new Response(JSON.stringify({ok:true}));
  await input(restored.w,restored.d.getElementById('studio-tool-select'),'lesson');
  assert.equal(restored.d.getElementById('lesson-filename-input').value,'a.md');
  restored.d.getElementById('lesson-repository-save-button').click();await tick();
  assert.equal(saves[0].filename,'a.md');assert.equal(saves[0].expectedSha,'fresh-a.md');
  assert.equal(saves[0].repositoryId,'biology');
  assert.equal(restored.d.getElementById('lesson-repository-select').value,'biology');
});

test('local lesson file reads and repository loads share one current selection', async t => {
  let remote;
  const h=await studio(t,{list:async kind=>kind==='lesson'?lessonAssets:[],readLesson:()=>{remote=deferredLesson();return remote.promise;}});
  await input(h.w,h.d.getElementById('studio-tool-select'),'lesson');
  const field=h.d.getElementById('lesson-file-input'),file=deferredLesson();
  openLesson(h,'a.md');
  Object.defineProperty(field,'files',{configurable:true,value:[{name:'local.md',size:100,text:()=>file.promise}]});
  field.dispatchEvent(new h.w.Event('change'));
  file.resolve(lessonFixture('local.md').content);await tick();remote.resolve(lessonFixture('a.md'));await tick();
  assert.equal(h.d.getElementById('lesson-filename-input').value,'local.md');
  assert.equal(h.d.getElementById('undo-button').disabled,true,'Import cannot undo into a different document');
  const second=deferredLesson();Object.defineProperty(field,'files',{configurable:true,value:[{name:'late.md',size:100,text:()=>second.promise}]});
  field.dispatchEvent(new h.w.Event('change'));openLesson(h,'b.md');
  remote.resolve(lessonFixture('b.md'));await tick();second.resolve(lessonFixture('late.md').content);await tick();
  assert.equal(h.d.getElementById('lesson-filename-input').value,'b.md');
});

test('switching repository discards pending lesson reads and old background library refreshes', async t => {
  let refreshing=false;const refresh=deferredLesson(),read=deferredLesson();
  const h=await studio(t,{
    repositories:async()=>[{id:'glowne',default:true,label:'Główne'},{id:'other',label:'Drugie'}],
    list:async(kind,opts)=>kind!=='lesson'?[]:opts.repositoryId==='other'?[{kind:'lesson',filename:'other.md',title:'Other',repositoryId:'other'}]:refreshing?refresh.promise:lessonAssets,
    readLesson:()=>read.promise
  });
  await input(h.w,h.d.getElementById('studio-tool-select'),'lesson');openLesson(h,'a.md');
  refreshing=true;h.d.dispatchEvent(new h.w.CustomEvent('chemdisk-content-changed',{detail:{kind:'lesson',repositoryId:'glowne'}}));
  await input(h.w,h.d.getElementById('lesson-repository-select'),'other');
  refresh.resolve(lessonAssets);read.resolve(lessonFixture('a.md'));await tick();
  assert.ok(h.d.querySelector('#lesson-asset-list [data-asset-filename="other.md"]'));
  assert.equal(h.d.querySelector('#lesson-asset-list [data-asset-filename="a.md"]'),null);
  assert.equal(h.d.getElementById('lesson-filename-input').value,'nowa-lekcja.md');
});

test('finishing publication while another lesson is loading does not cancel that selection', async t => {
  const saved=deferredLesson(),loading=deferredLesson();
  const h=await studio(t,{list:async kind=>kind==='lesson'?lessonAssets:[],readLesson:name=>name==='a.md'?Promise.resolve(lessonFixture(name)):loading.promise,save:()=>saved.promise});
  h.w.fetch=async()=>new Response(JSON.stringify({ok:true}));
  await input(h.w,h.d.getElementById('studio-tool-select'),'lesson');openLesson(h,'a.md');await tick();
  h.d.getElementById('lesson-repository-save-button').click();await tick();openLesson(h,'b.md');
  saved.resolve({sha:'saved-a',repositoryId:'glowne'});await tick();loading.resolve(lessonFixture('b.md'));await tick();
  assert.equal(h.d.getElementById('lesson-filename-input').value,'b.md');
});

test('restored lesson selects the actual slide after adding open answers and linked AI reviews', async t => {
  const seed={id:'lesson-old',filename:'odtworzona.md',title:'Odtworzona',slides:[
    {id:'slide-1',blocks:[{id:'block-1',type:'heading',level:2,text:'Pierwszy slajd'}]},
    {id:'slide-2',blocks:[{id:'block-2',type:'heading',level:2,text:'Drugi slajd'}]},
    {id:'slide-3',blocks:[{id:'block-3',type:'heading',level:2,text:'Trzeci slajd'}]}
  ]};
  const h=await studio(t,{},h=>h.w.localStorage.setItem('chemdisk.studio.lesson.v1',JSON.stringify(seed)));
  await input(h.w,h.d.getElementById('studio-tool-select'),'lesson');
  h.d.querySelector('.lesson-slide[data-lesson-slide-id="slide-3"] > .slide-header').click();await tick();
  h.d.querySelector('[data-lesson-quick-task="student-answer"][data-lesson-slide-id="slide-3"]').click();await tick();
  assert.equal(h.d.querySelector('#lesson-preview [data-lesson-preview-slide-id]').dataset.lessonPreviewSlideId,'slide-3');
  assert.ok(h.d.querySelector('[data-lesson-field="question"]'),'Inspector shows the new open question, not a previous block');
  await input(h.w,h.d.querySelector('[data-lesson-field="question"]'),'Wyjaśnij powstawanie H2O.');
  h.d.querySelector('[data-lesson-inspector-action="create-review"]').click();await tick();
  await input(h.w,h.d.querySelector('[data-lesson-field="answerKeyText"]'),'Powstaje woda.');
  await input(h.w,h.d.querySelector('[data-lesson-field="aiInstruction"]'),'Uznaj równoważny wzór chemiczny.');
  const reviewSlide=h.d.querySelector('#lesson-preview [data-lesson-preview-slide-id]').dataset.lessonPreviewSlideId;
  assert.notEqual(reviewSlide,'slide-3');
  for(const id of ['slide-1',reviewSlide,'slide-3','slide-2',reviewSlide]) {
    h.d.querySelector(`.lesson-slide[data-lesson-slide-id="${id}"] > .slide-header`).click();await tick();
    assert.equal(h.d.querySelector('#lesson-preview [data-lesson-preview-slide-id]').dataset.lessonPreviewSlideId,id);
    assert.equal(h.d.querySelector('.lesson-slide.is-selected').dataset.lessonSlideId,id);
  }
  h.w.dispatchEvent(new h.w.Event('pagehide'));
  const saved=JSON.parse(h.w.localStorage.getItem('chemdisk.studio.lesson.v1'));
  const nodes=saved.slides.flatMap(s=>[s,...s.blocks,...s.blocks.flatMap(b=>b.answerKeyBlocks||[])]);
  assert.equal(new Set(nodes.map(n=>n.id)).size,nodes.length);
  const question=saved.slides.find(s=>s.id==='slide-3').blocks.find(b=>b.type==='student-answer');
  const review=saved.slides.find(s=>s.id===reviewSlide).blocks.find(b=>b.type==='answer-review');
  assert.equal(review.questionId,question.questionId);assert.equal(review.aiInstruction,'Uznaj równoważny wzór chemiczny.');
});
