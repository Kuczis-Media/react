'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../public/members/module/studio/exam-model.js');
const engine = require('../netlify/exam-common.js');

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this.className = ''; this.value = ''; this.textContent = '';
    this.classList = { toggle: (name, enabled) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    } };
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
  get lastElementChild() { return this.children.at(-1); }
  focus() { this.focused = true; }
}
function fields() {
  const context = { document: { createElement: (tag) => new Element(tag) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/members/module/studio/answer-fields.js'), 'utf8'), context);
  return context.ChemAnswerFields;
}
function click(host, label, index = 0) {
  const node = host.querySelectorAll('button').filter((item) => item.textContent === label)[index];
  assert.ok(node, `Missing button ${label}`); assert.equal(node.disabled, false);
  node.events.click();
}
function type(node, value) { node.value = value; node.events.input(); }

test('answer configurator keeps stable IDs and media while editing, deleting and adding choices', () => {
  const api = fields();
  const question = model.createQuestion({ questionId: 'q-choice' });
  question.options[1].images = [{ ref: 'photos/atom.svg', alt: 'Atom' }];
  const stable = question.options[1].answerId;
  let changes = 0;
  const host = api.exam(question, () => { changes++; });
  type(host.querySelectorAll('textarea')[1], 'H | OH — bez wpisywania ID');
  const radio = host.querySelectorAll('input')[1]; radio.checked = true; radio.events.change();
  assert.deepEqual(Array.from(question.correctAnswerIds), [stable]);
  click(host, 'Usuń', 0);
  assert.equal(question.options[0].answerId, stable);
  assert.equal(question.options[0].images[0].ref, 'photos/atom.svg');
  click(host, '＋ Dodaj odpowiedź');
  type(host.querySelectorAll('textarea').at(-1), 'Nowy wariant');
  const saved = JSON.parse(model.serializeExam({ examId: 'test', questions: [question] })).questions[0];
  assert.equal(saved.options[0].text, 'H | OH — bez wpisywania ID');
  assert.equal(new Set(saved.options.map((option) => option.answerId)).size, saved.options.length);
  assert.equal(engine.gradeQuestion(engine.normalizeQuestion(saved), stable).correct, true);
  assert.ok(changes >= 4);
});

test('removing the only correct answer requires an explicit new selection instead of inventing a key', () => {
  const question = model.createQuestion({ questionId: 'q-remove' });
  const host = fields().exam(question, () => {});
  click(host, 'Usuń');
  assert.equal(question.correctAnswerIds.length, 0);
  assert.equal(model.validateExam({ questions: [question] }).valid, false);
});

test('multiple choices allow independent ticks and preserve their IDs after text changes', () => {
  const question = model.createQuestion({ type: 'multiple_choice', questionId: 'q-multi' });
  const host = fields().exam(question, () => {});
  const ticks = host.querySelectorAll('input');
  ticks[2].checked = true; ticks[2].events.change();
  assert.equal(question.correctAnswerIds.length, 2);
  ticks[0].checked = false; ticks[0].events.change();
  assert.deepEqual(Array.from(question.correctAnswerIds), [question.options[2].answerId]);
});

test('ordering buttons change the answer key without replacing item IDs or images', () => {
  const question = model.createQuestion({ type: 'ordering' });
  const ids = question.items.map((item) => item.itemId);
  question.items[0].images = [{ ref: 'photos/order.png', alt: 'Pierwszy' }];
  const host = fields().exam(question, () => {});
  click(host, '↓');
  assert.deepEqual(Array.from(question.correctOrder), [ids[1], ids[0]]);
  assert.equal(question.items[0].images.length, 1);
  assert.equal(engine.gradeQuestion(engine.normalizeQuestion(question), [ids[1], ids[0]]).correct, true);
});

test('matching uses two independent fields and preserves existing pair IDs', () => {
  const question = model.createQuestion({ type: 'matching' });
  const id = question.pairs[0].pairId;
  const host = fields().exam(question, () => {});
  type(host.querySelectorAll('input')[0], 'Na'); type(host.querySelectorAll('input')[1], 'Sód');
  assert.equal(question.pairs[0].pairId, id);
  assert.equal(question.pairs[0].left, 'Na'); assert.equal(question.pairs[0].right, 'Sód');
});

test('gap insertion keeps template and answer count in sync, preserving the previous key', () => {
  const question = model.createQuestion({ type: 'fill_blanks' });
  const oldBlank = question.blanks[0].blankId;
  const host = fields().exam(question, () => {});
  click(host, '＋ Wstaw lukę tutaj');
  assert.equal(question.blanks.length, 2);
  assert.equal(question.blanks[1].blankId, oldBlank);
  assert.equal((question.template.match(/\{\{/g) || []).length, 2);
  const answers = host.querySelectorAll('input').filter((input) => input.type === 'text');
  type(answers[0], 'nowa');
  assert.equal(model.validateExam({ questions: [question] }).valid, true);
  click(host, 'Usuń lukę');
  assert.equal(question.blanks[0].blankId, oldBlank);
  assert.equal((question.template.match(/\{\{/g) || []).length, 1);
});

test('alias fields preserve separators and literal markup as plain text', () => {
  let values;
  const host = fields().textList(['woda'], (next) => { values = next; });
  click(host, '＋ Dodaj wariant odpowiedzi');
  type(host.querySelectorAll('input')[1], '<b>H | O</b>');
  assert.deepEqual(Array.from(values), ['woda', '<b>H | O</b>']);
  assert.equal(host.querySelectorAll('b').length, 0);
});

test('empty answers and mismatched blanks cannot be published, including question bank', () => {
  for (const question of [
    model.createQuestion({ type: 'short_text', acceptedAnswers: [''] }),
    model.createQuestion({ type: 'fill_blanks', template: '{{pierwsza}} {{druga}}' }),
    model.createQuestion({ type: 'fill_blanks', blanks: [{ acceptedAnswers: [''] }] })
  ]) {
    assert.equal(model.validateExam({ questions: [question] }).valid, false);
    assert.throws(() => model.serializeQuestionBank({ questions: [question] }));
  }
});
