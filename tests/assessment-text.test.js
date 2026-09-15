'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rich = require('../public/assets/js/assessment-text.js');
const studio = require('../public/members/module/studio/exam-model.js');
const exams = require('../netlify/exam-common.js');
const admin = require('../netlify/functions/admin-exams.js');

test('question formatting survives editor, JSON, server, bank and student snapshots without exposing the key', () => {
  const format = { color: '#123abc', align: 'justify', font: 'serif', size: 'large', bold: true };
  const question = studio.createQuestion({ type: 'open_answer', prompt: '**Oblicz** dla H~2~O: \\(x^{2}\\)', promptFormat: format, answerKey: 'Tajny klucz', gradingMode: 'ai' });
  const fromJson = exams.normalizeQuestion(JSON.parse(JSON.stringify(question)));
  assert.deepEqual(fromJson.promptFormat, format);
  const fromBank = exams.normalizeQuestionBank({ questions: [question] }).questions[0];
  assert.deepEqual(fromBank.promptFormat, format);
  const student = exams.safeQuestion(fromJson);
  assert.deepEqual(student.promptFormat, format);
  assert.equal(student.prompt, question.prompt);
  assert.equal(student.answerKey, undefined);
  const definition = exams.normalizeDefinition({ examId: 'formatowany', metadata: { name: 'Formatowany' }, questions: [question], resultVisibility: { ownAnswers: true } });
  const attempt = { status: 'submitted', questions: [fromJson], answers: {}, result: { questionResults: [] } };
  assert.deepEqual(exams.resultForStudent(attempt, definition).questions[0].promptFormat, format);
});

test('rich assessment text renders inline formatting and protects TeX indices from Markdown substitutions', () => {
  const html = rich.html('**Woda** H~2~O, x^2^, *kursywa*, __podkreślenie__\n\\[x^{2}+y^{2}=z^{2}\\]\n\\(\\ce{2 H2 + O2 -> 2 H2O}\\)');
  assert.match(html, /<strong>Woda<\/strong> H<sub>2<\/sub>O/);
  assert.match(html, /x<sup>2<\/sup>/);
  assert.match(html, /<em>kursywa<\/em>/);
  assert.match(html, /<u>podkreślenie<\/u>/);
  assert.match(html, /x\^\{2\}\+y\^\{2\}=z\^\{2\}/);
  assert.equal((html.match(/data-assessment-math/g) || []).length, 2);
});

test('untrusted answers and imported styles cannot execute HTML, CSS, links or TeX extensions', () => {
  const html = rich.html('<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1))');
  assert.doesNotMatch(html, /<img|<script|<a /);
  assert.match(html, /&lt;img/);
  const format = rich.normalizeFormat({ color: 'red;}body{display:none', font: '__proto__', align: 'expression(alert(1))', size: '999px', bold: 'false' });
  assert.deepEqual(format, { color: '', font: 'sans', align: 'left', size: 'normal', bold: false });
  for (const formula of ['\\href{javascript:alert(1)}{x}', '\\require{html}', '\\def\\x{evil}', '\\style{display:none}{x}', '\\class{evil}{x}']) {
    assert.equal(rich.safeFormula(formula), false);
    assert.doesNotMatch(rich.html(`\\(${formula}\\)`), /data-assessment-math/);
  }
  assert.equal(rich.safeFormula('\\frac{a}{b} + \\sqrt{x} + \\ce{Fe^{3+}}'), true);
});

test('report answer displays use labels, ordered text and matching descriptions, never raw IDs or JSON', () => {
  const questions = [
    exams.normalizeQuestion({ questionId: 'choice', type: 'multiple_choice', prompt: 'Wybierz', options: [{ answerId: 'a1', text: 'Wodór' }, { answerId: 'a2', text: 'Tlen' }], correctAnswerIds: ['a1'] }),
    exams.normalizeQuestion({ questionId: 'order', type: 'ordering', prompt: 'Ułóż', items: [{ itemId: 'i1', text: 'Start' }, { itemId: 'i2', text: 'Koniec' }], correctOrder: ['i1', 'i2'] }),
    exams.normalizeQuestion({ questionId: 'match', type: 'matching', prompt: 'Połącz', pairs: [{ pairId: 'p1', left: 'H', right: 'Wodór' }] }),
    exams.normalizeQuestion({ questionId: 'open', type: 'open_answer', prompt: 'Wyjaśnij', gradingMode: 'ai', answerKey: 'Reakcja **wymiany**.' })
  ];
  questions[2].matchingRightIds = { p1: 'opaque-token' };
  const report = admin._test.adminAttempt({ questions, answers: { choice: ['a1', 'a2'], order: ['i2', 'i1'], match: { p1: 'opaque-token' }, open: 'Własne\nuzasadnienie.' } });
  assert.deepEqual(report.questions[0].answerDisplay, ['Wodór', 'Tlen']);
  assert.deepEqual(report.questions[0].correctAnswerDisplay, ['Wodór']);
  assert.deepEqual(report.questions[1].answerDisplay, ['1. Koniec', '2. Start']);
  assert.deepEqual(report.questions[2].answerDisplay, ['H → Wodór']);
  assert.deepEqual(report.questions[3].answerDisplay, ['Własne\nuzasadnienie.']);
  assert.deepEqual(report.questions[3].correctAnswerDisplay, ['Reakcja **wymiany**.']);
  const source = fs.readFileSync(require.resolve('../public/members/module/studio/exam-builder.js'), 'utf8');
  assert.doesNotMatch(source, /JSON\.stringify\(attempt\.answers/);
  assert.match(source, /answerCard\('Odpowiedź ucznia'/);
});

function editorFixture(value = 'H2O') {
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.events = {}; this.attributes = {}; this.value = ''; this.classList = { add() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(name, handler) { this.events[name] = handler; }
    dispatchEvent(event) { this.events[event.type]?.(event); }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelectorAll() { return []; }
    focus() { this.events.focus?.(); }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    setRangeText(value, start, end) { this.value = this.value.slice(0, start) + value + this.value.slice(end); this.selectionStart = this.selectionEnd = start + value.length; }
  }
  const context = { document: { createElement: (tag) => new Node(tag) }, ChemAssessmentText: rich, Event, setTimeout(fn) { fn(); return 1; }, clearTimeout() {} };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/members/module/studio/assessment-editor.js'), 'utf8'), context);
  const changes = [];
  const editor = context.ChemAssessmentEditor.create(value, {}, (prompt, format) => changes.push({ prompt, format }));
  const all = (node) => [node, ...node.children.flatMap(all)];
  return { editor, changes, nodes: all(editor) };
}

test('editor toolbar wraps selected text, changes alignment and inserts chemistry without AI', () => {
  const { nodes, changes } = editorFixture();
  const input = nodes.find((node) => node.attributes['aria-label'] === 'Treść pytania');
  input.setSelectionRange(1, 2);
  nodes.find((node) => node.attributes['aria-label'] === 'Indeks dolny').events.click();
  assert.equal(changes.at(-1).prompt, 'H~2~O');
  const align = nodes.find((node) => node.tagName === 'SELECT' && node.children.some((option) => option.value === 'justify'));
  align.value = 'justify'; align.events.input();
  assert.equal(changes.at(-1).format.align, 'justify');
  input.setSelectionRange(input.value.length, input.value.length);
  nodes.find((node) => node.textContent === 'Wstaw równanie do pytania').events.click();
  assert.match(changes.at(-1).prompt, /\\\[\\ce\{2 H2 \+ O2 -> 2 H2O\}\\\]/);
});

test('chemistry composer previews indices live, inserts charges into the focused side and preserves the stored equation', () => {
  const { nodes, changes } = editorFixture();
  const get = (label) => nodes.find((node) => node.attributes['aria-label'] === label);
  const builder = nodes.find((node) => node.className === 'assessment-formula-builder');
  builder.open = true; builder.events.toggle();
  const left = get('Substraty'), right = get('Produkty'), preview = get('Podgląd równania');
  left.value = 'SO4'; left.events.input();
  assert.match(preview.innerHTML, /SO<sub>4<\/sub>/);
  left.focus(); left.setSelectionRange(left.value.length, left.value.length);
  get('Ładunek dwa minus').events.click();
  assert.equal(left.value, 'SO4^{2-}');
  assert.match(preview.innerHTML, /SO<sub>4<\/sub><sup>2-<\/sup>/);
  right.value = 'H2O'; right.focus(); right.setSelectionRange(1, 2);
  get('Wstaw indeks dolny do wzoru').events.click();
  assert.equal(right.value, 'H_{2}O');
  assert.match(preview.innerHTML, /H<sub>2<\/sub>O/);
  get('Wstaw równanie do pytania').events.click();
  assert.match(changes.at(-1).prompt, /\\ce\{SO4\^\{2-\} -> H_\{2\}O\}/);
  assert.match(rich.html(changes.at(-1).prompt), /SO<sub>4<\/sub><sup>2-<\/sup>/);
});

test('chemistry examples require an explicit click and swapping sides preserves reaction direction', () => {
  const { nodes } = editorFixture();
  const get = (label) => nodes.find((node) => node.attributes['aria-label'] === label);
  const examples = nodes.find((node) => node.tagName === 'SELECT' && node.children.some((option) => option.value === 'ions'));
  const arrow = nodes.find((node) => node.tagName === 'SELECT' && node.children.some((option) => option.value === '<=>'));
  examples.value = 'ions';
  assert.equal(get('Substraty').value, '2 H2 + O2');
  get('Wstaw wybraną reakcję do kreatora').events.click();
  assert.equal(get('Substraty').value, 'Ag^{+} + Cl^{-}');
  assert.equal(get('Produkty').value, 'AgCl(s)');
  get('Zamień substraty z produktami').events.click();
  assert.equal(arrow.value, '<-');
  assert.equal(get('Substraty').value, 'AgCl(s)');
  get('Zamień substraty z produktami').events.click();
  assert.equal(arrow.value, '->');
  examples.value = 'equilibrium'; get('Wstaw wybraną reakcję do kreatora').events.click();
  get('Zamień substraty z produktami').events.click();
  assert.equal(arrow.value, '<=>');
});

test('composer switches chemistry and math without losing either draft and supports selected numerator insertion', () => {
  const { nodes, changes } = editorFixture();
  const get = (label) => nodes.find((node) => node.attributes['aria-label'] === label);
  const buttons = nodes.filter((node) => node.tagName === 'BUTTON');
  const mathMode = buttons.find((node) => node.textContent === 'Matematyka');
  const chemMode = buttons.find((node) => node.textContent === 'Chemia');
  const expression = nodes.find((node) => node.tagName === 'TEXTAREA' && node.attributes['aria-label'] === 'Wzór matematyczny');
  get('Substraty').value = 'CH4'; get('Substraty').events.input();
  mathMode.events.click();
  assert.equal(mathMode.attributes['aria-pressed'], 'true');
  assert.equal(nodes.find((node) => node.className === 'assessment-chemistry-fields').hidden, true);
  expression.value = 'ab'; expression.setSelectionRange(0, 2);
  get('Wstaw ułamek').events.click();
  assert.equal(expression.value, '\\frac{ab}{b}');
  get('Wstaw równanie do pytania').events.click();
  assert.match(changes.at(-1).prompt, /\\\[\\frac\{ab\}\{b\}\\\]/);
  chemMode.events.click();
  assert.equal(get('Substraty').value, 'CH4');
  assert.equal(expression.value, '\\frac{ab}{b}');
});

test('incomplete equations and unsafe commands cannot be inserted, even through direct event dispatch', () => {
  const { nodes, changes } = editorFixture();
  const get = (label) => nodes.find((node) => node.attributes['aria-label'] === label);
  const left = get('Substraty'), button = get('Wstaw równanie do pytania');
  for (const invalid of ['', 'Fe^{3+', 'Fe}', 'Ca(OH', 'Ca(OH]', 'H2 + ', 'Fe^{}', '2', '\\href{https://example.com}{Fe}']) {
    left.value = invalid; left.events.input();
    assert.equal(button.disabled, true, invalid);
    button.events.click();
    assert.equal(changes.length, 0);
  }
  left.value = 'Fe^{3+}'; left.events.input();
  assert.equal(button.disabled, false);
});

test('formula insertion replaces the selection and programmatic tools respect field size limits', () => {
  const first = editorFixture('Zastąp ten tekst');
  const input = first.nodes.find((node) => node.attributes['aria-label'] === 'Treść pytania');
  input.setSelectionRange(0, input.value.length);
  first.nodes.find((node) => node.textContent === 'Wstaw równanie do pytania').events.click();
  assert.doesNotMatch(first.changes.at(-1).prompt, /Zastąp/);
  assert.match(first.changes.at(-1).prompt, /\\ce\{/);
  const full = editorFixture('x'.repeat(10000));
  const fullInput = full.nodes.find((node) => node.attributes['aria-label'] === 'Treść pytania');
  fullInput.setSelectionRange(10000, 10000);
  full.nodes.find((node) => node.textContent === 'Wstaw równanie do pytania').events.click();
  assert.equal(full.changes.length, 0);
  assert.equal(fullInput.value.length, 10000);
  assert.match(full.nodes.find((node) => node.className === 'assessment-formula-note').textContent, /za długa/);
});

test('student result answers and explanations use the same safe equation renderer as question prompts', () => {
  const source = fs.readFileSync(require.resolve('../public/members/module/exam/script.js'), 'utf8');
  assert.match(source, /ChemAssessmentText\.render\(heading, question\.prompt/);
  assert.match(source, /row\.append\(formattedAnswer\(/);
  assert.match(source, /formattedAnswer\(question\.explanation/);
  assert.match(source, /formattedAnswer\(question\.feedback/);
  assert.match(source, /ChemAssessmentText\.render\(content, value/);
});

test('login keeps the existing photograph and assessment renderer is wired into both author and student pages', () => {
  const login = fs.readFileSync(require.resolve('../public/login/style.css'), 'utf8');
  assert.match(login, /login-hero-bg\.jpg/);
  assert.doesNotMatch(login, /data-site-palette[^\n]+body::before/);
  for (const path of ['../public/members/module/exam/index.html', '../public/members/module/studio/index.html']) {
    const html = fs.readFileSync(require.resolve(path), 'utf8');
    assert.match(html, /src="\/assets\/js\/assessment-text.js"/);
    assert.match(html, /href="\/assets\/css\/assessment-text.css"/);
  }
});

function mathFixture() {
  const scripts = [], timers = new Map(), events = new Map();
  const context = {
    Promise,
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); }
  };
  context.document = {
    querySelector: () => scripts.find((script) => !script.removed) || null,
    addEventListener: context.addEventListener, removeEventListener: context.removeEventListener,
    createElement: () => ({ remove() { this.removed = true; } }), head: { append: (script) => scripts.push(script) }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/assessment-text.js'), 'utf8'), context);
  const target = () => ({ style: {}, classList: { add() {} }, isConnected: true,
    querySelectorAll() { return this.innerHTML.includes('data-assessment-math') ? [{ isConnected: true }] : []; }
  });
  return { context, scripts, timers, events, target, flush: () => new Promise((resolve) => setImmediate(resolve)) };
}

test('math rendering loads one static engine only on demand and serializes multiple question renders', async () => {
  const fixture = mathFixture();
  const { context, scripts, target } = fixture;
  context.ChemAssessmentText.render(target(), 'Zwykłe pytanie');
  await fixture.flush();
  assert.equal(scripts.length, 0);
  for (let i = 0; i < 3; i += 1) context.ChemAssessmentText.render(target(), '\\(x^{2}\\)');
  await fixture.flush();
  assert.equal(scripts.length, 1);
  let typeset = 0;
  context.MathJax = { startup: { promise: Promise.resolve() }, typesetPromise: async () => { typeset += 1; } };
  scripts[0].onload();
  await fixture.flush();
  assert.equal(typeset, 3);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.events.size, 0);
});

test('math loader failure preserves readable questions and does not loop through automatic network retries', async () => {
  const fixture = mathFixture();
  const targets = [fixture.target(), fixture.target(), fixture.target()];
  targets.forEach((target) => fixture.context.ChemAssessmentText.render(target, '\\(x^{2}\\)'));
  await fixture.flush();
  fixture.scripts[0].onerror();
  await fixture.flush();
  assert.equal(fixture.scripts.length, 1);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.events.size, 0);
  for (const target of targets) assert.match(target.innerHTML, /x\^\{2\}/);
});
