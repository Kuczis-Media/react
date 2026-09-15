'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(setImmediate);

class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.replacements = 0;
    this.classList = { toggle() {}, remove() {} };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.replacements++; }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelectorAll() { return []; }
}

function player(overrides = {}) {
  const nodes = new Map(), requests = [], storage = new Map();
  const byId = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const server = {
    attemptId: 'attempt-1', revision: 1, status: 'active', currentIndex: 0, highestReachedIndex: 0,
    totalQuestions: 6, answers: {}, flags: [], confirmedQuestionIds: [], timedOutQuestionIds: [],
    questions: Array.from({ length: 6 }, (_, index) => ({ questionId: `q${index}`, type: 'short_text', prompt: `Question ${index}` })),
    exam: { metadata: { name: 'Exam' }, display: { mode: 'one' }, timing: { mode: 'none' },
      navigation: { allowFreeNavigation: true, allowBack: true, allowSkip: true, requireAnswerBeforeNext: false, allowFlagging: true, ...overrides } }
  };
  const context = {
    document: { getElementById: byId, addEventListener() {}, createElement: () => new Element() },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    URL, console,
    ChemAssessmentText: { render(node, text) { node.textContent = text; } },
    ChemExamClient: { mutate(action, params) { return new Promise((resolve, reject) => requests.push({ action, ...params.body, resolve, reject })); } },
    setTimeout() { return 1; }, clearTimeout() {}, clearInterval() {}
  };
  context.window = context;
  const source = fs.readFileSync(require.resolve('../public/members/module/exam/script.js'), 'utf8');
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.testPlayer = { state, elements, navigateTo, renderNavigator, updateControls, canBrowseWhileSaving, initializeAttempt, protectedImageUrl, clearImageCache, disconnectImageObserver }; })();'), context);
  const api = context.testPlayer;
  api.state.reference = { repositoryId: 'default', examId: 'example' };
  api.initializeAttempt(structuredClone(server), false);
  api.renderNavigator();
  return {
    ...api, requests, storage, context,
    answer(questionId, value) {
      api.state.attempt.answers[questionId] = value;
      api.state.dirtyQuestions.add(questionId);
      api.state.answerVersions.set(questionId, (api.state.answerVersions.get(questionId) || 0) + 1);
    },
    respond(index) {
      const request = requests[index];
      assert.equal(request.revision, server.revision, 'Queued writes use the latest acknowledged revision');
      server.currentIndex = request.targetIndex;
      server.highestReachedIndex = Math.max(server.highestReachedIndex, request.targetIndex);
      server.revision++;
      Object.assign(server.answers, request.answers);
      request.resolve({ attempt: structuredClone(server) });
    }
  };
}

test('free navigation renders immediately, allows further clicks and coalesces them behind one request', async () => {
  const ui = player();
  const first = ui.navigateTo(1);
  assert.equal(ui.state.attempt.currentIndex, 1);
  assert.equal(ui.elements.next.disabled, false);
  await tick();
  const second = ui.navigateTo(2);
  const third = ui.navigateTo(4);
  assert.equal(ui.state.attempt.currentIndex, 4);
  assert.equal(ui.elements.questionList.children[0].dataset.questionIndex, '4');
  assert.equal(ui.requests.length, 1);
  ui.respond(0); await tick();
  assert.equal(ui.state.attempt.currentIndex, 4, 'An old acknowledgment must not jump the view backwards');
  assert.deepEqual(ui.requests.map((request) => request.targetIndex), [1, 4]);
  ui.respond(1); await Promise.all([first, second, third]);
  assert.equal(ui.state.transitioning, false);
  assert.equal(ui.state.navigationTask, null);
  assert.equal(ui.elements.submit.disabled, false);
});

test('typing during a slow navigation response preserves newer answers and sends them in the next batch', async () => {
  const ui = player();
  ui.answer('q0', 'old');
  const done = ui.navigateTo(1); await tick();
  ui.answer('q0', 'new'); ui.answer('q1', 'second');
  const later = ui.navigateTo(3);
  ui.respond(0); await tick();
  assert.equal(ui.state.attempt.answers.q0, 'new');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.requests[1].answers)), { q0: 'new', q1: 'second' });
  ui.respond(1); await Promise.all([done, later]);
  assert.equal(ui.state.dirtyQuestions.size, 0);
  assert.equal(ui.state.attempt.answers.q1, 'second');
});

test('failed navigation returns to the last acknowledged question without discarding local answers', async () => {
  const ui = player();
  const first = ui.navigateTo(1); await tick();
  ui.answer('q1', 'keep me');
  const later = ui.navigateTo(4);
  ui.respond(0); await tick();
  ui.requests[1].reject(new Error('Offline'));
  await Promise.all([first, later]);
  assert.equal(ui.state.attempt.currentIndex, 1);
  assert.equal(ui.state.attempt.answers.q1, 'keep me');
  assert.ok(ui.state.dirtyQuestions.has('q1'));
  assert.ok(ui.storage.get('chemdisk.exam.pending.attempt-1').includes('keep me'));
  assert.equal(ui.state.transitioning, false);
  assert.match(ui.elements.attemptMessage.textContent, /Offline/);
});

test('restricted navigation remains serialized and unanswered required questions remain blocked', async () => {
  const ui = player({ allowFreeNavigation: false });
  const first = ui.navigateTo(1); await tick();
  await ui.navigateTo(2);
  assert.equal(ui.state.attempt.currentIndex, 1);
  assert.equal(ui.elements.next.disabled, true);
  assert.equal(ui.requests.length, 1);
  ui.respond(0); await first;
  assert.equal(ui.elements.next.disabled, false);
  const required = player({ requireAnswerBeforeNext: true });
  await required.navigateTo(1);
  assert.equal(required.requests.length, 0);
  assert.equal(required.state.attempt.currentIndex, 0);
  assert.match(required.elements.attemptMessage.textContent, /odpowiedz/);
  ui.state.attempt.exam.timing.mode = 'question';
  assert.equal(ui.canBrowseWhileSaving(), false);
});

test('navigator updates preserve button nodes and focus rather than rebuilding the grid', () => {
  const ui = player();
  const buttons = [...ui.elements.navigatorGrid.children];
  for (let index = 0; index < 30; index++) { ui.answer('q0', String(index)); ui.renderNavigator(); }
  assert.equal(ui.elements.navigatorGrid.replacements, 1);
  buttons.forEach((button, index) => assert.equal(ui.elements.navigatorGrid.children[index], button));
  assert.equal(buttons[0].attributes['aria-current'], 'step');
  ui.state.attempt.currentIndex = 2; ui.renderNavigator();
  assert.equal(buttons[2].attributes['aria-current'], 'step');
});

test('clicking the current question never writes and navigation cannot re-enable expired confirmation controls', async () => {
  const ui = player();
  await ui.navigateTo(0);
  assert.equal(ui.requests.length, 0);
  const button = new Element(); button.dataset.confirmQuestion = 'q0';
  ui.elements.questionList.querySelectorAll = () => [button];
  ui.state.attempt.timedOutQuestionIds = ['q0'];
  ui.updateControls();
  assert.equal(button.disabled, true);
});

test('a delayed navigation response cannot replace a newly opened attempt', async () => {
  const ui = player();
  const pending = ui.navigateTo(1); await tick();
  const next = structuredClone(ui.state.attempt);
  next.attemptId = 'attempt-2'; next.currentIndex = 0; next.highestReachedIndex = 0;
  ui.initializeAttempt(next, false);
  ui.respond(0); await pending;
  assert.equal(ui.state.attempt.attemptId, 'attempt-2');
  assert.equal(ui.state.attempt.currentIndex, 0);
  assert.equal(ui.state.navigationTask, null);
});

test('exam images reuse one fetch and object URL across question renders; clearing invalidates pending reads', async () => {
  const ui = player();
  let calls = 0;
  ui.context.ChemContentLibrary = { async readMediaBlob() { calls++; return new Blob(['image'], { type: 'image/png' }); } };
  const [first, duplicate] = await Promise.all([ui.protectedImageUrl('a.png'), ui.protectedImageUrl('a.png')]);
  assert.equal(first, duplicate);
  ui.disconnectImageObserver();
  assert.equal(await ui.protectedImageUrl('a.png'), first);
  assert.equal(calls, 1);
  ui.clearImageCache();
  assert.notEqual(await ui.protectedImageUrl('a.png'), first);
  assert.equal(calls, 2);
  const pending = ui.protectedImageUrl('b.png');
  ui.clearImageCache();
  await assert.rejects(pending, /AUTH_EXPIRED/);
  assert.equal(ui.state.imageCache.size, 0);
});

test('failed image requests can retry and fallback fetching is cached too', async () => {
  const ui = player();
  let calls = 0;
  ui.context.ChemAuth = { async getAccessToken() { return 'test'; } };
  ui.context.ChemExamClient.imageUrl = () => '/image';
  ui.context.fetch = async () => {
    calls++;
    return { ok: calls > 1, async blob() { return new Blob(['image'], { type: 'image/png' }); } };
  };
  await assert.rejects(ui.protectedImageUrl('a.png'), /IMAGE_UNAVAILABLE/);
  const url = await ui.protectedImageUrl('a.png');
  assert.equal(await ui.protectedImageUrl('a.png'), url);
  assert.equal(calls, 2);
  ui.clearImageCache();
});
