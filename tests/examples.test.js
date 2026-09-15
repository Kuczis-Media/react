const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const quizCommon = require(path.join(root, 'netlify', 'quiz-common.js'));
const examCommon = require(path.join(root, 'netlify', 'exam-common.js'));
const presentationCommon = require(path.join(root, 'netlify', 'presentation-common.js'));
const contentRepository = require(path.join(root, 'netlify', 'content-repository.js'));

const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));

function exampleDefinitions(folder, filename) {
  return fs.readdirSync(path.join(root, 'Examples', folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'Examples', folder, entry.name, filename)))
    .map((entry) => ({ id: entry.name, file: `${folder}/${entry.name}/${filename}`, value: readJson('Examples', folder, entry.name, filename) }));
}

test('every example variant validates for publication, with resolvable bank references and local media', () => {
  const bank = readJson('Examples', 'exams', 'question-bank.json');
  assert.doesNotThrow(() => contentRepository._test.validateAssetContent('question_bank', 'question-bank.json', JSON.stringify(bank)));
  const bankIds = new Set(bank.questions.map((q) => q.questionId));
  for (const [folder, filename, api] of [['exams', 'exam.json', examCommon], ['quizzes', 'quiz.json', quizCommon], ['presentations', 'presentation.json', presentationCommon]]) {
    for (const { id, file, value } of exampleDefinitions(folder, filename)) {
      const result = api.validateDefinition(value, id);
      assert.equal(result.valid, true, `${file}: ${JSON.stringify(result.errors)}`);
      assert.ok(Buffer.byteLength(JSON.stringify(value)) < 256 * 1024, file);
      for (const questionId of value.questionRefs || []) assert.ok(bankIds.has(questionId), questionId);
      function media(node) {
        if (!node || typeof node !== 'object') return;
        for (const [key, ref] of Object.entries(node)) {
          if (['ref', 'backgroundRef'].includes(key) && typeof ref === 'string' && /^(assets\/|photos\/)/.test(ref)) {
            const relative = ref.startsWith('photos/') ? `${folder}/${id}/${ref}` : ref;
            assert.ok(fs.existsSync(path.join(root, 'Examples', relative)), `${file}: missing ${ref}`);
          } else if (ref && typeof ref === 'object') media(ref);
        }
      }
      media(value);
    }
  }
  for (const filename of ['example-prompt.json', 'example-prompt.txt']) {
    const source = fs.readFileSync(path.join(root, 'Examples', 'prompts', filename), 'utf8');
    assert.doesNotThrow(() => contentRepository._test.validateAssetContent('prompt', filename, source));
  }
});

test('example variants cover assessment modes and keep every main showcase question visible', () => {
  const exams = exampleDefinitions('exams', 'exam.json').map((entry) => entry.value);
  const quizzes = exampleDefinitions('quizzes', 'quiz.json').map((entry) => entry.value);
  const covers = (values, expected, name) => assert.deepEqual(new Set(values), new Set(expected), name);
  for (const [section, field, expected] of [
    ['display', 'mode', ['one', 'page', 'all']], ['timing', 'mode', ['none', 'exam', 'question']],
    ['timing', 'display', ['countdown', 'countup', 'hidden']], ['availability', 'mode', ['always', 'from', 'until', 'range']],
    ['attempts', 'mode', ['one', 'limited', 'unlimited']], ['attempts', 'resultStrategy', ['best', 'first', 'last', 'average']],
    ['security', 'leavePolicy', ['allow_resume', 'end_attempt', 'warn', 'log']], ['resultVisibility', 'feedbackMode', ['immediate', 'after_submit', 'never']],
    ['scoring', 'multipleChoiceStrategy', ['all_or_nothing', 'per_option', 'correct_minus_incorrect']]
  ]) covers(exams.map((e) => e[section][field]), expected, `${section}.${field}`);
  for (const type of ['ai', 'manual', 'ungraded']) {
    assert.ok(exams.some((e) => e.questions.some((q) => q.gradingMode === type)));
    assert.ok(quizzes.some((e) => e.questions.some((q) => q.gradingMode === type)));
  }
  const main = exams.find((e) => e.examId === 'egzamin-chemia-organiczna');
  assert.equal(examCommon.selectAttemptQuestions(examCommon.normalizeDefinition(main), { questions: [] }).length, main.questions.length);
  for (const id of ['egzamin-natychmiastowy', 'egzamin-refleksja']) {
    const exam = examCommon.normalizeDefinition(exams.find((e) => e.examId === id));
    const result = examCommon.gradeAttempt({ questions: exam.questions, answers: {} }, exam);
    assert.notEqual(result.gradingStatus, 'pending_review');
  }
  for (const key of ['shuffleQuestions', 'showFeedback', 'allowRetry']) covers(quizzes.map((q) => q.settings[key]), [true, false], key);
});

test('presentation gallery covers every layout, element, font, background and progress mode', () => {
  const model = require('../public/members/module/studio/presentation-model');
  const values = exampleDefinitions('presentations', 'presentation.json').map(({ value }) => model.createPresentation(value));
  const slides = values.flatMap((v) => v.slides); const elements = slides.flatMap((s) => s.elements);
  const covers = (values, expected, label) => assert.deepEqual(new Set(values), new Set(expected), label);
  covers(slides.map((s) => s.layout), model.LAYOUTS, 'layouts');
  covers(elements.map((e) => e.type), model.ELEMENT_TYPES, 'elements');
  covers(elements.filter((e) => ['text', 'heading'].includes(e.type)).map((e) => e.fontFamily), model.FONTS, 'fonts');
  covers(slides.map((s) => s.backgroundType), ['solid', 'gradient', 'image', 'theme'], 'backgrounds');
  covers(values.map((v) => v.settings.theme), ['light', 'dark', 'chemistry', 'minimal'], 'themes');
  covers(values.map((v) => v.settings.aspectRatio), ['16:9', '4:3'], 'aspect ratios');
  covers(values.map((v) => v.progress.mode), ['highest', 'visited', 'all_required'], 'progress');
  covers(elements.filter((e) => e.type === 'shape').map((e) => e.shape), ['rectangle', 'rounded', 'circle', 'line'], 'shapes');
  covers(elements.filter((e) => e.type === 'formula').map((e) => e.mode), ['math', 'chemistry'], 'formulas');
});

test('lesson examples validate in editor and student parser, including multiline options and linked open answers', () => {
  const studio = require('../public/members/module/studio/lesson-model');
  const player = require('../public/members/module/lesson/lesson-parser');
  const lessons = ['lekcja-chemia-organiczna.md', 'lekcja-sekwencyjna.md'].map((file) => {
    const source = fs.readFileSync(path.join(root, 'Examples', 'lessons', file), 'utf8');
    const model = studio.parseLesson(source, file);
    const validation = studio.validateLesson(model);
    assert.equal(validation.valid, true, `${file}: ${JSON.stringify(validation.errors)}`);
    assert.equal(player.parseLesson(studio.serializeLesson(model), file).slides.length, model.slides.length);
    return model;
  });
  assert.deepEqual(new Set(lessons.map((l) => l.navigation)), new Set(['free', 'sequential']));
  const slides = lessons.flatMap((l) => l.slides);
  const allBlocks = (blocks) => blocks.flatMap((block) => [block, ...allBlocks(block.blocks || []), ...allBlocks(block.answerKeyBlocks || [])]);
  const blocks = allBlocks(slides.flatMap((s) => s.blocks));
  assert.deepEqual(new Set(blocks.map((b) => b.type)), new Set(studio.BLOCK_TYPES));
  assert.deepEqual(new Set(slides.flatMap((s) => s.task ? [s.task.type] : [])), new Set(studio.TASK_TYPES));
  for (const [key, expected] of [['transition', studio.SLIDE_TRANSITIONS], ['background', studio.SLIDE_BACKGROUNDS], ['decoration', studio.SLIDE_DECORATIONS], ['textTone', studio.SLIDE_TEXT_TONES]]) {
    assert.deepEqual(new Set(slides.map((s) => s[key])), new Set(expected), key);
  }
  for (const type of studio.TASK_TYPES) assert.ok(slides.some((s) => s.id === `example-enters-${type}` && s.task.question.includes('\n')), type);
  assert.ok(blocks.some((b) => b.type === 'student-answer' && !b.allowEdit));
  assert.ok(blocks.some((b) => b.type === 'answer-review' && !b.showStudentAnswer && !b.aiEnabled));
});

test('organic chemistry examples use matching stable IDs and every question type', () => {
  const quiz = readJson('Examples', 'quizzes', 'quiz-chemia-organiczna', 'quiz.json');
  const exam = readJson('Examples', 'exams', 'egzamin-chemia-organiczna', 'exam.json');
  const presentation = readJson('Examples', 'presentations', 'prezentacja-aldehydy', 'presentation.json');
  const lesson = fs.readFileSync(path.join(root, 'Examples', 'lessons', 'lekcja-chemia-organiczna.md'), 'utf8');
  const prompt = fs.readFileSync(path.join(root, 'Examples', 'prompts', 'example-prompt.txt'), 'utf8');

  assert.equal(quizCommon.validateDefinition(quiz, 'quiz-chemia-organiczna').valid, true);
  assert.equal(examCommon.validateDefinition(exam, 'egzamin-chemia-organiczna').valid, true);
  assert.equal(presentationCommon.validateDefinition(presentation, 'prezentacja-aldehydy').valid, true);
  assert.doesNotThrow(() => contentRepository._test.validateAssetContent('prompt', 'example-prompt.txt', prompt));
  assert.deepEqual(new Set(quiz.questions.map((question) => question.type)), new Set(['single', 'multiple', 'true_false', 'text', 'open']));
  assert.deepEqual(new Set(exam.questions.map((question) => question.type)), new Set([
    'single_choice', 'multiple_choice', 'true_false', 'short_text', 'number', 'matching', 'ordering', 'fill_blanks', 'open_answer'
  ]));
  assert.match(lesson, /presentation: prezentacja-aldehydy/);
  assert.match(lesson, /quiz: quiz-chemia-organiczna/);
  assert.match(lesson, /exam: egzamin-chemia-organiczna/);
  assert.match(lesson, /repository: repo-testowe/);
  assert.doesNotMatch(lesson, /(?:quiz|exam):default:|repository: default/);
  assert.equal(presentation.slides[1].elements.find((element) => element.type === 'image').repositoryId, 'repo-testowe');
});

test('examples and default dashboard contain the supplied real material IDs', () => {
  const lesson = fs.readFileSync(path.join(root, 'Examples', 'lessons', 'lekcja-chemia-organiczna.md'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'public', 'members', 'dashboard.md'), 'utf8');
  const combined = `${lesson}\n${dashboard}`;

  for (const id of [
    '1rxPm5CJl2LDzrzq89fogz-_PWwO_BbqF',
    '1qKkDarVM8qn1GHkNalt9f8n7IXNUawZF',
    '1FAIpQLSeKEXX7ooRB7ZaPJ8UwnqNlPsucgjwnQFzmSlZ3OvrdFlURsA',
    'sU6epNBjvzo',
    'PG6fB57aAoA',
    'kOoRildWO0s'
  ]) assert.match(combined, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.doesNotMatch(combined, /1AbCdEf|1ZyXwVu|1H5__hUC|1YmTr2X0|https:\/\/example\.com/);
  for (const href of [
    '/members/module/lesson/?repo=repo-testowe&file=lekcja-chemia-organiczna.md',
    '/members/module/quiz/?repo=repo-testowe&quiz=quiz-chemia-organiczna',
    '/members/module/exam/?repo=repo-testowe&exam=egzamin-chemia-organiczna',
    '/members/module/presentation/?repo=repo-testowe&presentation=prezentacja-aldehydy',
    '/members/module/chat/?repo=repo-testowe&plik=example-prompt.txt&punkt=1'
  ]) assert.ok(dashboard.includes(href), `missing curated dashboard link: ${href}`);
});
