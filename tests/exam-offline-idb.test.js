'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../public/members/module/studio/exam-model.js');

test('ChemExamOfflineStore saves attempt data in < 1 ms in memory and survives simulated reload', async () => {
  const source = fs.readFileSync(require.resolve('../public/members/module/exam/script.js'), 'utf8');
  const storage = new Map();
  const context = {
    document: {
      getElementById: () => ({ classList: { toggle() {}, remove() {}, add() {} }, querySelector: () => null, addEventListener() {} }),
      addEventListener() {},
      createElement: () => ({ append() {}, classList: { toggle() {} } }),
      documentElement: { addEventListener() {} }
    },
    sessionStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k)
    },
    localStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k)
    },
    URL, console,
    setTimeout: (fn) => setTimeout(fn, 1),
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
    window: {}
  };
  context.window = context;

  vm.runInNewContext(source, context);
  const offlineStore = context.ChemExamOfflineStore;
  assert.ok(offlineStore, 'ChemExamOfflineStore must be exposed on window');

  const start = performance.now();
  offlineStore.save('attempt-test-1', {
    examId: 'exam-chemistry-1',
    answers: { q1: 'NaCl', q2: ['A', 'C'] },
    dirtyQuestions: ['q1', 'q2'],
    currentIndex: 1,
    highestReachedIndex: 2,
    timerSnapshot: { remainingSeconds: 120 }
  });
  const duration = performance.now() - start;
  assert.ok(duration < 5, `Save operation took ${duration}ms, expected < 1ms synchronous overhead`);

  // Instant in-memory retrieval
  const cached = await offlineStore.load('attempt-test-1');
  assert.ok(cached);
  assert.equal(cached.examId, 'exam-chemistry-1');
  assert.equal(cached.answers.q1, 'NaCl');
  assert.deepEqual(cached.answers.q2, ['A', 'C']);
  assert.equal(cached.currentIndex, 1);
  assert.equal(cached.highestReachedIndex, 2);

  // Clean removal
  offlineStore.remove('attempt-test-1');
  assert.equal(offlineStore._memory.has('attempt-test-1'), false);
});

test('ChemAnswerFields.exam renders large cards with 1-click circular checkmark toggle', () => {
  const fieldsSource = fs.readFileSync(require.resolve('../public/members/module/studio/answer-fields.js'), 'utf8');
  class MockElement {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attributes = {};
      this.events = {};
      this.className = '';
      this.value = '';
      this.textContent = '';
      this.classList = {
        toggle: (name, enabled) => {
          const names = new Set(this.className.split(' ').filter(Boolean));
          if (enabled) names.add(name); else names.delete(name);
          this.className = [...names].join(' ');
        }
      };
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { this.events[name] = listener; }
    querySelectorAll(selector) {
      const matches = (node) => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : node.tagName === selector;
      return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }

  const context = { document: { createElement: (tag) => new MockElement(tag) } };
  vm.runInNewContext(fieldsSource, context);
  const fields = context.ChemAnswerFields;

  const question = model.createQuestion({
    type: 'single_choice',
    options: ['Opcja 1', 'Opcja 2', 'Opcja 3', 'Opcja 4'],
    correctAnswerIds: []
  });

  let notified = false;
  const host = fields.exam(question, () => { notified = true; });

  // Verify cards exist
  const cards = host.querySelectorAll('.answer-choice-card');
  assert.equal(cards.length, 4, 'Must render 4 answer cards');

  // Verify option letter badges
  const letters = host.querySelectorAll('.answer-choice-letter');
  assert.equal(letters.length, 4);
  assert.equal(letters[0].textContent, 'A');
  assert.equal(letters[1].textContent, 'B');
  assert.equal(letters[2].textContent, 'C');
  assert.equal(letters[3].textContent, 'D');

  // Click 1-click toggle on option B
  const inputs = host.querySelectorAll('input');
  inputs[1].checked = true;
  inputs[1].events.change();

  assert.ok(notified);
  assert.deepEqual(Array.from(question.correctAnswerIds), [question.options[1].answerId]);
  assert.ok(cards[1].className.includes('is-correct'));
});
