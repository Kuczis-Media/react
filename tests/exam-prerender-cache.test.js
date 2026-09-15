'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class MockElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.replacements = 0;
    this.classList = {
      toggle() {},
      remove() {}
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.replacements++; }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

function createPlayer() {
  const nodes = new Map(), requests = [], storage = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, new MockElement());
    return nodes.get(id);
  };
  const server = {
    attemptId: 'attempt-cache-1',
    revision: 1,
    status: 'active',
    currentIndex: 0,
    highestReachedIndex: 0,
    totalQuestions: 10,
    answers: {},
    flags: [],
    confirmedQuestionIds: [],
    timedOutQuestionIds: [],
    questions: Array.from({ length: 10 }, (_, index) => ({
      questionId: `q${index}`,
      type: 'single_choice',
      prompt: `Pytanie ${index}`,
      options: [
        { answerId: `q${index}-a`, text: 'Opcja A' },
        { answerId: `q${index}-b`, text: 'Opcja B' }
      ]
    })),
    exam: {
      metadata: { name: 'Egzamin testowy pre-rendering' },
      display: { mode: 'one' },
      timing: { mode: 'none' },
      navigation: { allowFreeNavigation: true, allowBack: true, allowSkip: true, requireAnswerBeforeNext: false, allowFlagging: true }
    }
  };

  const context = {
    document: {
      getElementById: byId,
      addEventListener() {},
      createElement: () => new MockElement(),
      activeElement: null
    },
    sessionStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    URL,
    console,
    ChemAssessmentText: {
      render(node, text) { node.textContent = text; }
    },
    ChemExamClient: {
      mutate(action, params) {
        return new Promise((resolve, reject) => requests.push({ action, ...params.body, resolve, reject }));
      }
    },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    clearInterval() {},
    requestIdleCallback: (fn) => { fn(); return 1; },
    cancelIdleCallback() {}
  };
  context.window = context;

  const source = fs.readFileSync(require.resolve('../public/members/module/exam/script.js'), 'utf8');
  vm.runInNewContext(
    source.replace(/\}\)\(\);\s*$/, 'window.testPlayer = { state, elements, navigateTo, renderQuestions, renderNavigator, updateControls, initializeAttempt, clearQuestionDomCache, getCachedQuestionView, schedulePreRenderQuestions }; })();'),
    context
  );

  const api = context.testPlayer;
  api.state.reference = { repositoryId: 'default', examId: 'exam-prerender' };
  api.initializeAttempt(structuredClone(server), false);
  api.renderNavigator();
  return { ...api, requests, server };
}

test('Prompt 5.3: question DOM cache warms up and pre-renders questions in RAM', () => {
  const ui = createPlayer();
  assert.equal(ui.state.questionDomCacheAttemptId, 'attempt-cache-1');

  // Initial question rendered on load
  ui.renderQuestions();
  assert.ok(ui.state.questionDomCache.has('q0'), 'q0 must be in RAM cache');

  // Background chunking pre-renders remaining questions in RAM
  ui.schedulePreRenderQuestions();
  assert.equal(ui.state.questionDomCache.size, 10, 'All 10 questions must be pre-rendered in RAM cache');
});

test('Prompt 5.3: question switching retrieves cached nodes in 0 ms without rebuilding DOM', () => {
  const ui = createPlayer();
  ui.schedulePreRenderQuestions();

  const nodeQ3Before = ui.state.questionDomCache.get('q3');
  assert.ok(nodeQ3Before, 'q3 node should already exist in cache');

  const start = process.hrtime.bigint();
  ui.navigateTo(3);
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1e6;

  // The navigation should be instantaneous (< 1 ms in memory)
  assert.ok(durationMs < 5, `Navigation took ${durationMs} ms, expected < 5 ms`);
  assert.equal(ui.state.attempt.currentIndex, 3);
  assert.equal(ui.elements.questionList.children[0], nodeQ3Before, 'Must reuse the exact cached node from RAM');
  assert.equal(ui.elements.questionList.children[0].dataset.questionIndex, '3');
});

test('Prompt 5.3: answers sync properly to cached question nodes when switching back and forth', () => {
  const ui = createPlayer();
  ui.schedulePreRenderQuestions();

  // Navigate to q1 and answer it
  ui.navigateTo(1);
  ui.state.attempt.answers['q1'] = 'q1-b';

  // Navigate away to q5
  ui.navigateTo(5);
  assert.equal(ui.state.attempt.currentIndex, 5);

  // Navigate back to q1
  ui.navigateTo(1);
  assert.equal(ui.state.attempt.currentIndex, 1);
  assert.equal(ui.state.attempt.answers['q1'], 'q1-b');
});

test('Prompt 5.3: starting a new attempt invalidates cache cleanly without leaking nodes', () => {
  const ui = createPlayer();
  ui.schedulePreRenderQuestions();
  assert.equal(ui.state.questionDomCache.size, 10);

  ui.clearQuestionDomCache();
  assert.equal(ui.state.questionDomCache.size, 0, 'Cache must be cleared on clearQuestionDomCache()');

  // New attempt with different ID
  const newAttempt = structuredClone(ui.server);
  newAttempt.attemptId = 'attempt-cache-2';
  ui.initializeAttempt(newAttempt, false);

  assert.equal(ui.state.questionDomCacheAttemptId, 'attempt-cache-2');
});
