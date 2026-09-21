'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs'), path = require('node:path');
const helper = require('../public/assets/js/lesson-answer-ai');
const model = require('../public/members/module/studio/lesson-model');
const parser = require('../public/members/module/lesson/lesson-parser');
function fixture(t) {
  const dom = new JSDOM('', { url: 'https://course.example/members/module/lesson/' }); t.after(() => dom.window.close());
  const question = model.createBlock('student-answer', { questionId: 'q_test', question: 'Wyjaśnij powstawanie $H_2O$.' });
  const image = model.createBlock('image', { ref: 'photos/task.png', alt: 'Schemat wiązania peptydowego' });
  const review = model.createBlock('answer-review', { questionId: question.questionId, question: question.question,
    aiInstruction: 'Ukryte kryterium: wystarczy wskazać kondensację.', answerKeyBlocks: [model.createBlock('text', { text: 'Wydziela się cząsteczka **wody**.' })] });
  const render = (blocks) => blocks.map(model.serializeBlock).map(parser.renderMarkdown).join('\n');
  const slides = [{ html: render([model.createBlock('text', { text: 'Dane zadania: dwa aminokwasy.' }), image, question]) }, { html: render([review]) }];
  const key = dom.window.document.createElement('div'); key.innerHTML = slides[1].html;
  return { window: dom.window, slides, key, review };
}
test('answer context includes the linked task, surrounding text, image and ALT after reopening, without review criteria leaking into the question', (t) => {
  const f = fixture(t);
  const result = helper.context({ slides: f.slides, questionId: 'q_test', fallbackQuestion: 'Stara treść', keyRoot: f.key.querySelector('.lesson-answer-key'), document: f.window.document, parser });
  assert.match(result.question, /\$H_2O\$/); assert.match(result.question, /Dane zadania: dwa aminokwasy/);
  assert.match(result.question, /Obraz 1 — ALT: Schemat wiązania peptydowego/);
  assert.doesNotMatch(result.question, /Ukryte kryterium|Stara treść|Wydziela się/);
  assert.equal(result.images.length, 1); assert.equal(result.images[0].reference, 'photos/task.png');
  assert.doesNotMatch(f.key.textContent, /Ukryte kryterium/);
  assert.equal(f.key.querySelector('.lesson-answer-review').dataset.aiInstruction, f.review.aiInstruction);
});
test('answer context retains image-only key descriptions and deduplicates hydrated managed images', (t) => {
  const f = fixture(t);
  f.key.innerHTML = '<figure data-lesson-media-ref="photos/task.png" data-lesson-media-scope="local" data-lesson-media-alt="Schemat"><img src="blob:display-only" alt="Schemat"></figure><img src="https://course.example/key.png" alt="Rozwiązanie rysunkowe">';
  const result = helper.context({ slides: f.slides, questionId: 'q_test', keyRoot: f.key, document: f.window.document, parser });
  assert.equal(result.images.length, 2); assert.equal(result.images[1].src, 'https://course.example/key.png');
  assert.match(result.question, /Obraz 2 — ALT: Rozwiązanie rysunkowe/);
});
test('the lesson request sends only ALT, visible answer and hidden criteria without loading image files', async (t) => {
  const f = fixture(t), { window } = f;
  const script = fs.readFileSync(path.join(__dirname, '../public/members/module/lesson/script.js'), 'utf8');
  const start = script.indexOf('  async function requestAnswerReviewAi('), end = script.indexOf('  async function analyzeAnswerReview(', start);
  const calls = [];
  window.ChemAuth = { getAccessToken: async () => 'fixture' };
  window.ChemLessonAnswerAI = helper;
  window.ChemContentLibrary = { readMediaBlob: () => { throw new Error('Grading must not fetch images'); } };
  const request = new Function('window', 'document', 'state', 'parser', 'fetch', 'validQuestionId', 'answerKeyAiText', 'LESSON_ANSWER_LIMIT', 'LESSON_AI_RESPONSE_LIMIT', `${script.slice(start, end)}; return requestAnswerReviewAi;`)(
    window, window.document, { lesson: { slides: f.slides }, answerQuestions: new Map(), repositoryId: 'glowne', filename: 'lesson.md' }, parser,
    async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ text: 'Ocena: Poprawna' }) }; },
    (v) => v, (card) => card.querySelector('.lesson-answer-key-content').textContent, 6000, 8000);
  assert.equal(calls.length, 0);
  await request(f.key.querySelector('.lesson-answer-review'), { answer: 'Powstaje woda.' });
  assert.equal(calls.length, 1);
  const body = calls[0]; assert.equal(body.lessonAnswerAttachments, undefined); assert.equal(body.attachmentInline, null);
  assert.match(body.lessonAnswerReview.question, /Schemat wiązania peptydowego/);
  assert.match(body.lessonAnswerReview.answerKey, /Wydziela się cząsteczka wody/);
  assert.equal(body.lessonAnswerReview.aiInstruction, f.review.aiInstruction);
  assert.equal(body.lessonAnswerReview.studentAnswer, 'Powstaje woda.');
});

test('direct answer editing preserves rich key blocks and round-trips hidden AI criteria', (t) => {
  const f = fixture(t), block = f.review;
  block.answerKeyBlocks.push(model.createBlock('image', { ref: 'photos/key.png', alt: 'Schemat odpowiedzi' }));
  const state = { lesson: { selectedId: block.id } };
  const script = fs.readFileSync(path.join(__dirname, '../public/members/module/studio/script.js'), 'utf8');
  const from = script.indexOf('  function handleLessonInspectorInput('), to = script.indexOf('  function handleLessonDocumentInput(', from);
  const input = new Function('lessonModelApi', 'state', 'findLessonNode', 'beginEdit', 'updateLessonNodeSummary', 'scheduleDraftSave', `${script.slice(from, to)};return handleLessonInspectorInput;`)(
    model, state, () => ({ kind: 'block', node: block }), () => {}, () => {}, () => {});
  const field = f.window.document.createElement('textarea'); field.dataset.lessonField = 'answerKeyText';
  field.value = 'Powstaje **woda**: $H_2O$.\n\nTo reakcja kondensacji.'; input({ target: field });
  assert.equal(block.answerKeyBlocks[0].text, field.value);
  assert.equal(block.answerKeyBlocks[1].ref, 'photos/key.png');
  const parsed = model.parseLesson(model.serializeLesson(model.createLesson({ slides: [
    { blocks: [model.createBlock('student-answer', { questionId: 'q_test', question: 'Wyjaśnij powstawanie $H_2O$.' })] },
    { blocks: [block] }
  ] })));
  const restored = parsed.slides[1].blocks.find((b) => b.type === 'answer-review');
  assert.equal(restored.aiInstruction, block.aiInstruction);
  assert.equal(restored.answerKeyBlocks.find((b) => b.type === 'image').ref, 'photos/key.png');
  const html = parser.renderMarkdown(model.serializeBlock(restored));
  assert.match(html, /H_2O/); assert.match(html, /reakcja kondensacji/);
});
