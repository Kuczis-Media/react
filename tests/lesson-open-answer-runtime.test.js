const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const player = fs.readFileSync(
  path.join(root, 'public', 'members', 'module', 'lesson', 'script.js'),
  'utf8'
);
const styles = fs.readFileSync(
  path.join(root, 'public', 'members', 'module', 'lesson', 'style.css'),
  'utf8'
);

test('lesson open answers separate tab restore from profile persistence', () => {
  assert.match(player, /function serializedStudentAnswers\(persistentOnly = false\)/);
  assert.match(player, /sessionStorage\.setItem\([\s\S]*lessonAnswers:\s*serializedStudentAnswers\(\)/);
  assert.match(player, /details:\s*\{[\s\S]*lessonAnswers:\s*serializedStudentAnswers\(true\)/);
  assert.match(player, /mergeStudentAnswers\(saved\.lessonAnswers\)/);
  assert.match(
    player,
    /mergeStudentAnswers\(details\.lessonAnswers,\s*\{\s*respectPersistence:\s*true\s*\}\)/
  );
  assert.match(
    player,
    /options\.respectPersistence\s*&&\s*state\.answerPersistence\.get\(questionId\)\s*!==\s*true/
  );
});

test('lesson answer AI can only start from the explicit review button', () => {
  const endpointCalls = player.match(/fetch\('\/\.netlify\/functions\/chat'/g) || [];
  assert.equal(endpointCalls.length, 1);
  assert.match(
    player,
    /button\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*void analyzeAnswerReview\(card\);\s*\}\)/
  );
  assert.match(player, /async function analyzeAnswerReview\(card\)[\s\S]*requestAnswerReviewAi\(card, record\)/);
  assert.match(player, /AI analizuje Twoją odpowiedź/);
  assert.match(player, /data-answer-review-result/);
  assert.match(player, /INVALID_LESSON_ANSWER_REVIEW/);
});

test('lesson answer review payload and local state use the backend limits', () => {
  assert.match(player, /const LESSON_ANSWER_LIMIT = 6_000/);
  assert.match(player, /const LESSON_AI_RESPONSE_LIMIT = 8_000/);
  assert.match(player, /question:[^\n]*slice\(0, 8_000\)/);
  assert.match(player, /answerKey:[^\n]*answerKeyAiText\(card\)/);
  assert.match(player, /return String\(context\)\.slice\(0, 10_000\)/);
  assert.match(player, /aiInstruction:[^\n]*slice\(0, 2_000\)/);
  assert.match(player, /aiCheckedAnswerVersion:\s*0,[\s\S]*aiResponse:\s*'',[\s\S]*aiCheckedAt:\s*''/);
});

test('required open answers gate navigation and reset removes answer state', () => {
  assert.match(player, /const answerGate = studentAnswerGate\(\)/);
  assert.match(player, /!maySkipCurrent\(\) && \(!answerGate\.satisfied/);
  assert.match(player, /commitCurrentStudentAnswers\(\{\s*focusInvalid:\s*!maySkipCurrent\(\)\s*\}\)/);
  assert.match(player, /sessionStorage\.removeItem\(progressKey\(\)\)/);
  assert.match(player, /state\.studentAnswers = new Map\(\)/);
  assert.match(styles, /\.lesson-answer-review-actions p\[data-state="loading"\]::before/);
  assert.match(styles, /\.lesson-answer-ai-result/);
});
