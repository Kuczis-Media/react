'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const practice = require('../public/assets/js/quiz-practice');
const model = require('../public/members/module/studio/quiz-model');
const server = require('../netlify/quiz-common');
const publisher = require('../netlify/content-repository');
const quizEndpoint = require('../netlify/functions/quiz');

function choices(type = 'multiple') {
  return model.createQuestion({ type, prompt: 'Wybierz **pierwiastki**: \\(\\alpha\\)', image: { ref: 'photos/pytanie.webp', alt: 'Schemat' },
    options: [{ optionId: 'a', text: 'H\n\\(\\ce{H2O}\\)', correct: true, image: { ref: 'assets/shared/woda.png', alt: 'Woda' } },
      { optionId: 'b', text: 'O', correct: type === 'multiple' }, { optionId: 'c', text: 'CO₂', correct: false }], explanation: 'Wyjaśnienie \\(\\frac{a}{b}\\)' });
}
test('single choice requires exactly the correct selection; multiple distinguishes selected, wrong and missed', () => {
  assert.equal(practice.evaluate(choices('single'), ['a']).correct, true);
  assert.equal(practice.evaluate(choices('single'), ['a', 'b']).correct, false);
  assert.equal(practice.evaluate(choices('single'), ['unknown']).correct, false);
  assert.equal(practice.evaluate(choices(), ['b', 'a']).correct, true);
  const result = practice.evaluate(choices(), ['a', 'c']);
  assert.equal(result.correct, false);
  assert.deepEqual(result.optionStates.map((state) => state.status), ['correct', 'missed', 'wrong']);
});
test('text comparison normalizes only the configured tolerances and uses bounded, deterministic edit distance', () => {
  const compare = (answer, options) => practice.compare(answer, ['tkanka nabłonkowa'], options);
  assert.equal(compare(' TKANKA   NABŁONKOWA ').correct, true);
  assert.equal(compare('TKANKA nabłonkowa', { ignoreCase: false }).correct, false);
  assert.equal(compare('tkanka   nabłonkowa', { collapseWhitespace: false }).correct, false);
  assert.equal(compare('tkanka nabłonkowa.').correct, false);
  assert.equal(compare('tkanka nabłonkowa.', { ignoreFinalPeriod: true }).correct, true);
  const difference = compare('tkanki nabłonkowe');
  assert.equal(difference.edits, 2); assert.equal(difference.correct, false); assert.equal(difference.similarity, 88);
  assert.deepEqual(difference.segments.filter((part) => part.type === 'wrong').map((part) => part.text), ['i', 'e']);
  assert.deepEqual(difference.segments.filter((part) => part.type === 'missing').map((part) => part.text), ['a', 'a']);
  assert.equal(compare('tkanki nabłonkowe', { maxTypos: 1 }).correct, false);
  assert.equal(compare('tkanki nabłonkowe', { maxTypos: 2 }).tolerated, true);
  assert.equal(practice.compare('Na', ['Ca'], { maxTypos: 2, ignoreCase: false }).correct, false, 'Short different chemical symbols are not accepted as typos');
  assert.equal(compare('', { maxTypos: 2 }).correct, false);
  assert.equal(practice.compare('e\u0301', ['é']).correct, true);
  assert.equal(practice.compare('😀a', ['😀b']).edits, 1);
  assert.deepEqual(compare('tkanki nabłonkowe'), difference);
  assert.equal(practice.compare('wodor', ['tlen', 'wodór'], { maxTypos: 1 }).expected, 'wodór');
  const long = practice.compare('a'.repeat(8000), ['b'.repeat(500)], { maxTypos: 2 });
  assert.equal(long.actual.length, 500); assert.equal(long.edits, 500); assert.equal(long.correct, false);
});
test('all session 2 deck types, multiline LaTeX, media and tolerances round-trip through the existing publisher', () => {
  const single = choices('single'), multiple = choices();
  multiple.options.forEach((option) => { option.optionId += '-multi'; });
  const text = model.createQuestion({ type: 'text', prompt: 'Nazwij tkankę', acceptedAnswers: ['tkanka nabłonkowa'], textCompare: { maxTypos: 2 }, image: { ref: 'photos/tkanka.jpg', alt: 'Tkanka' } });
  const deck = model.createQuiz({ mode: 'deck', quizId: 'nauka-biologia', metadata: { status: 'published', courseId: 'course' }, questions: [single, multiple, text] });
  const source = model.serialize(deck);
  assert.deepEqual(model.parse(source), deck);
  assert.equal(server.validateDefinition(deck).valid, true);
  assert.equal(publisher._test.validateAssetContent('quiz', deck.quizId, source), source);
  assert.match(model.parse(source).questions[0].options[0].text, /\n\\\(\\ce\{H2O\}/);
  const answers = { [single.questionId]: ['a'], [multiple.questionId]: ['a-multi', 'b-multi'], [text.questionId]: 'tkanki nabłonkowe' };
  assert.equal(model.score(deck, answers).earned, 3);
  assert.equal(server.gradeQuiz(deck, answers).earned, 3);
  const bad = structuredClone(deck); bad.questions[0].options[0].image.ref = 'https://evil.example/a.svg';
  assert.equal(server.validateDefinition(bad).valid, false);
  const settings = structuredClone(deck); settings.questions[2].textCompare.maxTypos = 99;
  assert.equal(server.validateDefinition(settings).valid, false);
  const tooMany = structuredClone(deck);
  tooMany.questions[0].options.push(...Array.from({ length: 4 }, (_, i) => model.createOption({ optionId: `extra-${i}`, text: 'Opcja' })));
  assert.equal(server.validateDefinition(tooMany).valid, false);
  delete tooMany.mode;
  assert.equal(server.validateDefinition(tooMany).valid, true, 'Previously saved ordinary quizzes with more than six options remain valid');
});
test('stored quiz results return objective answer details, not open-answer rubrics, without persisting character diffs', () => {
  const q = model.createQuestion({ type: 'text', prompt: 'Podaj nazwę', acceptedAnswers: ['tkanka nabłonkowa'], textCompare: { maxTypos: 2 } });
  const value = model.createQuiz({ questions: [q] });
  const graded = server.gradeQuiz(value, { [q.questionId]: 'tkanki nabłonkowe' });
  assert.equal(graded.results[0].comparison, undefined);
  const response = quizEndpoint._test.studentResult(graded, value);
  assert.equal(response.results[0].answer, 'tkanki nabłonkowe');
  assert.equal(response.results[0].practice.comparison.tolerated, true);
});

function browser(t) {
  const dom = new JSDOM('<body></body>', { url: 'https://course.example', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.MathJax = { typesetClear() {}, typesetPromise: async () => {} };
  for (const file of ['members/module/lesson/lesson-parser.js', 'assets/js/assessment-text.js', 'assets/js/quiz-practice.js', 'assets/js/quiz-flashcards.js', 'members/module/studio/assessment-editor.js']) {
    w.eval(fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8'));
  }
  t.after(() => w.close()); return w;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
test('learning mode renders Markdown, equations, question and option images and all multiple-choice feedback states', async (t) => {
  const w = browser(t), loaded = [];
  const card = w.ChemQuizFlashcards.practiceCard(choices(), async (ref) => { loaded.push(ref); return `blob:${ref}`; });
  w.document.body.append(card); await tick();
  assert.equal(card.querySelector('strong').textContent, 'pierwiastki');
  assert.ok(card.querySelector('[data-assessment-math]'));
  assert.equal(card.querySelector('input[value="a"]').checked, false);
  card.querySelector('input[value="a"]').click(); card.querySelector('input[value="c"]').click();
  card.querySelector('[data-practice-check]').click(); await tick();
  assert.equal(card.querySelectorAll('[data-option-status]').length, 3);
  assert.match(card.querySelector('.quiz-practice-feedback').textContent, /Poprawnie zaznaczona.*Poprawna, ale pominięta.*Błędnie zaznaczona/s);
  assert.ok(loaded.includes('photos/pytanie.webp')); assert.ok(loaded.includes('assets/shared/woda.png'));
  assert.equal(card.querySelector('input').disabled, true);
});
test('mixed deck keeps answers on navigation, checks locally, completes once and resets the session', async (t) => {
  const w = browser(t); let complete = 0;
  const text = model.createQuestion({ type: 'text', prompt: 'Podaj nazwę', acceptedAnswers: ['tkanka nabłonkowa'], textCompare: { maxTypos: 2 } });
  const flash = model.createQuestion({ type: 'flashcard', front: { text: 'Pytanie' }, back: { text: 'Odpowiedź' } });
  const study = w.ChemQuizFlashcards.study({ questions: [text, flash], getUrl: async () => '', onComplete: () => { complete++; } });
  w.document.body.append(study);
  const input = study.querySelector('textarea'); input.value = 'tkanki nabłonkowe'; input.dispatchEvent(new w.Event('input'));
  study.querySelector('.quiz-flashcard-navigation button:last-child').click();
  study.querySelector('.quiz-flashcard-navigation button:first-child').click();
  assert.equal(study.querySelector('textarea').value, 'tkanki nabłonkowe');
  study.querySelector('[data-practice-check]').click();
  assert.equal(study.querySelectorAll('.quiz-text-diff del').length, 2);
  assert.equal(study.querySelectorAll('.quiz-text-diff ins').length, 2);
  assert.match(study.textContent, /88%/); assert.equal(complete, 0);
  study.querySelector('.quiz-flashcard-ratings button').click();
  study.querySelector('[data-flashcard-reveal]').click();
  study.querySelector('[data-flashcard-rating="3"]').click(); await tick();
  assert.equal(complete, 1); assert.match(study.textContent, /Pula przejrzana/);
  study.querySelector('button').click(); assert.equal(study.querySelector('textarea').value, ''); assert.equal(complete, 1);
});
test('fx opens the existing composer, previews chemical indices and inserts into the selected field, preserving other fields', async (t) => {
  const w = browser(t), field = w.document.createElement('textarea'), other = w.document.createElement('textarea');
  field.value = 'Pytanie: tutaj koniec'; other.value = 'Nie zmieniaj';
  field.maxLength = 500; w.document.body.append(field, other); field.setSelectionRange(9, 14);
  w.ChemAssessmentEditor.openFor(field); await tick();
  const dialog = w.document.querySelector('dialog'), expression = dialog.querySelector('textarea[aria-label="Wzór matematyczny"]');
  expression.value = '\\ce{Ca^{2+}}'; expression.dispatchEvent(new w.Event('input')); await tick();
  assert.ok(dialog.querySelector('[aria-label="Podgląd równania"] sup'));
  dialog.querySelector('[aria-label="Wstaw do wybranego pola"]').click();
  assert.equal(field.value, 'Pytanie: \\(\\ce{Ca^{2+}}\\) koniec');
  assert.equal(other.value, 'Nie zmieniaj'); assert.equal(w.document.querySelector('dialog'), null);
  w.ChemAssessmentEditor.openFor(field); await tick();
  const next = w.document.querySelector('dialog');
  const unsafe = next.querySelector('textarea[aria-label="Wzór matematyczny"]'); unsafe.value = '\\href{javascript:evil}{x}'; unsafe.dispatchEvent(new w.Event('input'));
  assert.equal(next.querySelector('[aria-label="Wstaw do wybranego pola"]').disabled, true);
});
