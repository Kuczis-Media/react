'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const examStudioModel = require('../public/members/module/studio/exam-model.js');

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.replacements = 0;
    this.classList = {
      _classes: new Set(),
      toggle(name, force) {
        const state = force !== undefined ? Boolean(force) : !this._classes.has(name);
        if (state) this._classes.add(name);
        else this._classes.delete(name);
        return state;
      },
      add(name) { this._classes.add(name); },
      remove(name) { this._classes.delete(name); },
      contains(name) { return this._classes.has(name); }
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.replacements++; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] || null; }
  querySelectorAll(selector) {
    const results = [];
    function search(node) {
      if (!node || !node.children) return;
      for (const child of node.children) {
        if (selector === 'input:checked' && child.checked) results.push(child);
        else if (selector.includes('data-answer-input') && child.dataset?.answerInput) results.push(child);
        search(child);
      }
    }
    search(this);
    return results;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function createPlayerWithQuestions(questions) {
  const nodes = new Map(), requests = [], storage = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, new MockElement());
    return nodes.get(id);
  };

  const server = {
    attemptId: 'attempt-split-1',
    revision: 1,
    status: 'active',
    currentIndex: 0,
    highestReachedIndex: 0,
    totalQuestions: questions.length,
    answers: {},
    flags: [],
    confirmedQuestionIds: [],
    timedOutQuestionIds: [],
    questions,
    exam: {
      metadata: { name: 'Egzamin Split-Screen Test' },
      display: { mode: 'one' },
      timing: { mode: 'none' },
      navigation: { allowFreeNavigation: true, allowBack: true, allowSkip: true, requireAnswerBeforeNext: false, allowFlagging: true }
    }
  };

  const context = {
    document: {
      getElementById: byId,
      addEventListener() {},
      createElement: (tag) => new MockElement(tag),
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
    source.replace(/\}\)\(\);\s*$/, 'window.testPlayer = { state, elements, navigateTo, renderQuestions, renderNavigator, updateControls, initializeAttempt, toggleSplitScreen, updateSplitScreenBtn, getCachedQuestionView }; })();'),
    context
  );

  const api = context.testPlayer;
  api.state.reference = { repositoryId: 'default', examId: 'exam-split' };
  api.initializeAttempt(structuredClone(server), false);
  api.renderNavigator();
  return { ...api, requests, server };
}

test('Prompt 5.6: exam-model creates questions with sourceText and splitScreen support', () => {
  const q = examStudioModel.createQuestion({
    prompt: 'Która probówka zawiera jony miedzi(II)?',
    sourceText: 'Do dwóch probówek z roztworami dodano wodorotlenek sodu...',
    splitScreen: true
  });
  assert.equal(q.sourceText, 'Do dwóch probówek z roztworami dodano wodorotlenek sodu...');
  assert.equal(q.splitScreen, true);
});

test('Prompt 5.6: question with sourceText automatically renders in Split-Screen layout', () => {
  const questions = [
    {
      questionId: 'q-source',
      type: 'single_choice',
      prompt: 'Podaj wynik doświadczenia:',
      sourceText: 'Tekst wprowadzający CKE: Do roztworu azotanu(V) srebra dodano kwas solny.',
      options: [
        { answerId: 'opt-1', text: 'Biały osad AgCl' },
        { answerId: 'opt-2', text: 'Czarny osad' }
      ]
    },
    {
      questionId: 'q-regular',
      type: 'single_choice',
      prompt: 'Standardowe krótkie pytanie bez tekstu źródłowego',
      options: [
        { answerId: 'opt-a', text: 'Tak' },
        { answerId: 'opt-b', text: 'Nie' }
      ]
    }
  ];

  const ui = createPlayerWithQuestions(questions);
  ui.renderQuestions();

  const activeArticle = ui.elements.questionList.children[0];
  assert.ok(activeArticle.classList.contains('is-splitscreen'), 'Article must have .is-splitscreen class');

  // Should contain .exam-splitscreen-layout with source column
  const layout = activeArticle.children.find((c) => c.className === 'exam-splitscreen-layout');
  assert.ok(layout, 'Must contain .exam-splitscreen-layout');

  const sourceCol = layout.children.find((c) => c.className?.includes('is-source'));
  assert.ok(sourceCol, 'Must contain .exam-splitscreen-col.is-source');

  const interactiveCol = layout.children.find((c) => c.className?.includes('is-interactive'));
  assert.ok(interactiveCol, 'Must contain .exam-splitscreen-col.is-interactive');

  // Navigate to regular question without sourceText
  ui.navigateTo(1);
  const regularArticle = ui.elements.questionList.children[0];
  assert.ok(!regularArticle.classList.contains('is-splitscreen'), 'Regular question without split-screen should not have .is-splitscreen');
});

test('Prompt 5.6: user toggleSplitScreen switches layout and highlights topbar button', () => {
  const questions = [
    {
      questionId: 'q-regular',
      type: 'single_choice',
      prompt: 'Zwykłe pytanie egzaminacyjne',
      options: [
        { answerId: 'opt-a', text: 'A' },
        { answerId: 'opt-b', text: 'B' }
      ]
    }
  ];

  const ui = createPlayerWithQuestions(questions);
  ui.renderQuestions();

  assert.equal(ui.state.splitScreen, false);
  assert.equal(ui.elements.splitScreenBtn.getAttribute('aria-pressed'), 'false');

  // Toggle Split-Screen ON
  ui.toggleSplitScreen();
  assert.equal(ui.state.splitScreen, true);
  assert.equal(ui.elements.splitScreenBtn.getAttribute('aria-pressed'), 'true');
  assert.ok(ui.elements.splitScreenBtn.classList.contains('is-active'));

  const splitArticle = ui.elements.questionList.children[0];
  assert.ok(splitArticle.classList.contains('is-splitscreen'));

  // Toggle Split-Screen OFF
  ui.toggleSplitScreen();
  assert.equal(ui.state.splitScreen, false);
  assert.equal(ui.elements.splitScreenBtn.getAttribute('aria-pressed'), 'false');
  assert.ok(!ui.elements.splitScreenBtn.classList.contains('is-active'));

  const normalArticle = ui.elements.questionList.children[0];
  assert.ok(!normalArticle.classList.contains('is-splitscreen'));
});

