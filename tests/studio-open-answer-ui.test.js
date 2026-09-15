const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/members/module/studio/script.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/members/module/studio/style.css'), 'utf8');

function section(start, end) {
  const from = script.indexOf(start);
  const to = script.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end} after ${start}`);
  return script.slice(from, to);
}

test('Lesson Studio exposes both open-answer workflow blocks in the palette', () => {
  const palette = section('function ensureOpenAnswerPalette()', 'function bindPalette()');

  assert.match(palette, /type:\s*['"]student-answer['"]/);
  assert.match(palette, /title:\s*['"]Pytanie otwarte['"]/);
  assert.match(palette, /type:\s*['"]answer-review['"]/);
  assert.match(palette, /title:\s*['"]Omówienie odpowiedzi['"]/);
  assert.match(script, /function bindPalette\(\)\s*\{\s*ensureOpenAnswerPalette\(\)/);
});

test('open-answer inspectors expose the complete model contract and enforce UI limits', () => {
  const inspector = section('function renderLessonInspector()', 'function lessonPreviewMarkdown(');
  const studentFields = [
    'questionId',
    'question',
    'label',
    'placeholder',
    'minHeight',
    'multiline',
    'maxLength',
    'required',
    'saveToProgress',
    'allowEdit',
    'button'
  ];
  const reviewFields = [
    'questionId',
    'questionSnapshot',
    'showStudentAnswer',
    'aiEnabled',
    'aiInstruction',
    'order'
  ];

  studentFields.forEach((field) => assert.match(inspector, new RegExp(`['"]${field}['"]`)));
  reviewFields.forEach((field) => assert.match(inspector, new RegExp(`['"]${field}['"]`)));
  assert.match(inspector, /max:\s*6000/);
  assert.match(inspector, /maxLength:\s*2000/);
  assert.match(inspector, /answerKeyQuickInsert\(\)/);
  assert.match(inspector, /student-first/);
  assert.match(inspector, /key-first/);
});

test('review picker is based on stable IDs from earlier slides and linked slide creation preserves the ID', () => {
  const picker = section('function answerReviewQuestionOptions(', 'function answerKeyQuickInsert(');
  const createReview = section('function createLinkedAnswerReview(', 'function regenerateLessonQuestionId(');

  assert.match(picker, /item\.slideIndex\s*<\s*reviewSlideIndex/);
  assert.match(picker, /value:\s*item\.block\.questionId/);
  assert.match(createReview, /defaultAnswerReview\(found\.node\.questionId,\s*found\.node\.question\)/);
  assert.match(createReview, /state\.lesson\.model\.slides\.splice\(slideIndex\s*\+\s*1,\s*0,\s*slide\)/);
  assert.match(script, /dataset\.lessonInspectorAction\s*=\s*['"]create-review['"]/);
});

test('answer key uses nested normal blocks with Studio selection and drag-and-drop support', () => {
  const nested = section('function lessonNestedBlocks(', 'function visitLessonBlocks(');
  const insert = section('function insertLessonBlock(', 'function lessonDefaultTarget(');
  const move = section('function moveLessonBlock(', 'function handleLessonDrop(');

  assert.match(nested, /block\.answerKeyBlocks/);
  assert.match(insert, /lessonNestedBlocks\(parent\.node\)/);
  assert.match(insert, /student-answer['"],\s*['"]answer-review/);
  assert.match(move, /lessonNestedBlocks\(parent\.node\)/);
  assert.match(styles, /\.answer-review-builder-node/);
  assert.match(styles, /\.answer-key-builder-tools/);
});

test('Studio preview keeps a local answer but never calls AI automatically', () => {
  const preview = section('function bindPreviewOpenAnswers(', 'function previewTaskAiResponse(');

  assert.match(preview, /previewOpenAnswers\.set/);
  assert.match(preview, /\[data-student-answer-save\]/);
  assert.match(preview, /\[data-student-answer-display\]/);
  assert.match(preview, /\[data-answer-review-ai\]/);
  assert.match(preview, /AI nie zostało użyte/);
  assert.doesNotMatch(preview, /\bfetch\s*\(/);
  assert.doesNotMatch(preview, /openPreviewAiHelp/);
  assert.match(script, /bindPreviewOpenAnswers\(elements\.lessonPreview\)/);
  assert.match(styles, /\.lesson-preview-body \.lesson-student-answer/);
  assert.match(styles, /\.lesson-preview-body \.lesson-answer-review/);
});
