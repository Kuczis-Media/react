const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const openAnswerGrader = require('../netlify/open-answer-grader.js');
const quizCommon = require('../netlify/quiz-common.js');
const quizModel = require('../public/members/module/studio/quiz-model.js');
const examCommon = require('../netlify/exam-common.js');
const examStorage = require('../netlify/exam-storage.js');
const examModel = require('../public/members/module/studio/exam-model.js');
const examFunction = require('../netlify/functions/exam.js');
const quizFunction = require('../netlify/functions/quiz.js');
const adminExams = require('../netlify/functions/admin-exams.js');
const adminQuizzes = require('../netlify/functions/admin-quizzes.js');

class MemoryStore {
  constructor() { this.entries = new Map(); this.revision = 0; }
  async getWithMetadata(key) {
    const entry = this.entries.get(key);
    return entry ? { data: entry.data, etag: entry.etag, metadata: entry.metadata } : null;
  }
  async set(key, data, options = {}) {
    const current = this.entries.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
    this.revision += 1;
    this.entries.set(key, { data, etag: `etag-${this.revision}`, metadata: options.metadata || {} });
    return { modified: true };
  }
}

test.afterEach(() => {
  openAnswerGrader.setSendRequest(null);
  quizFunction._test.setStoreFactory(null);
  adminExams._test.setExamStoreFactory(null);
  adminExams._test.setProgressStoreFactory(null);
});

test('AI grader batches open answers, clamps ratios and does not call AI for blank answers', async () => {
  let calls = 0;
  openAnswerGrader.setSendRequest(async (input, runtime) => {
    calls += 1;
    assert.equal(input.module, 'aiGrader');
    assert.equal(runtime.timeoutMs, 25_000);
    return {
      text: '```json\n{"grades":[{"questionId":"open-one","ratio":0.75,"feedback":"Dobry tok rozumowania."}]}\n```'
    };
  });
  const questions = [
    { questionId: 'open-one', type: 'open_answer', gradingMode: 'ai', prompt: 'Wyjaśnij.', answerKey: 'Klucz', points: 4 },
    { questionId: 'open-blank', type: 'open_answer', gradingMode: 'ai', prompt: 'Drugie.', answerKey: 'Klucz', points: 2 }
  ];
  const evaluated = await openAnswerGrader.evaluateAiQuestions(questions, { 'open-one': 'Odpowiedź', 'open-blank': '' }, { userId: 'student' });
  assert.equal(calls, 1);
  assert.equal(evaluated.grades['open-one'].ratio, 0.75);
  assert.deepEqual(evaluated.failedQuestionIds, []);
  assert.equal(openAnswerGrader.gradeOpenQuestion(questions[1], '').points, 0);
});

test('AI grading has a hard request cap, stops after provider failure and rejects malformed ratios', async () => {
  let calls = 0;
  openAnswerGrader.setSendRequest(async (input) => {
    calls += 1;
    const batch = JSON.parse(input.messages[0].content).questions;
    return { text: JSON.stringify({ grades: batch.map(({ questionId }) => ({ questionId, ratio: 1 })) }) };
  });
  const questions = Array.from({ length: 50 }, (_, index) => ({
    questionId: `bulk-${index}`, type: 'open_answer', gradingMode: 'ai', points: 1,
    prompt: `Pytanie ${index} ${'p'.repeat(900)}`, answerKey: `Klucz ${'k'.repeat(900)}`
  }));
  const answers = Object.fromEntries(questions.map((question) => [question.questionId, `Odpowiedź ${'o'.repeat(900)}`]));
  const capped = await openAnswerGrader.evaluateAiQuestions(questions, answers, { userId: 'student' });
  assert.equal(calls, 1);
  assert.ok(capped.failedQuestionIds.length > 0);

  calls = 0;
  openAnswerGrader.setSendRequest(async () => { calls += 1; throw Object.assign(new Error('limit'), { code: 'AI_RATE_LIMITED' }); });
  const failed = await openAnswerGrader.evaluateAiQuestions(questions.slice(0, 20), answers, { userId: 'student' });
  assert.equal(calls, 1);
  assert.equal(failed.failedQuestionIds.length, 20);
  assert.deepEqual(Object.keys(openAnswerGrader._test.parseGrades('{"grades":[{"questionId":"q","ratio":null}]}', [{ questionId: 'q' }])), []);
});

test('AI grading accepts one wrapped JSON result but rejects ambiguity and invalid numeric grades', async () => {
  const batch = [{ questionId: 'q' }];
  const body = '{"grades":[{"questionId":"q","ratio":0.75,"feedback":"Wzór {H2O} poprawny."}]}';
  assert.equal(openAnswerGrader._test.parseGrades(`Oto ocena:\n\`\`\`json\n${body}\n\`\`\`\nGotowe.`, batch).q.ratio, 0.75);
  assert.deepEqual(Object.keys(openAnswerGrader._test.parseGrades(`${body}\nAlbo:\n${body}`, batch)), []);
  assert.deepEqual(Object.keys(openAnswerGrader._test.parseGrades('{"grades":[{"questionId":"q","ratio":"1"}]}', batch)), []);
  openAnswerGrader.setSendRequest(async () => ({ text: 'Nie mogę ocenić odpowiedzi.' }));
  const result = await openAnswerGrader.evaluateAiQuestions([{ questionId: 'q', gradingMode: 'ai', points: 1, prompt: 'Pytanie', answerKey: 'Klucz' }], { q: 'Odpowiedź' }, { userId: 'admin' });
  assert.equal(result.errorCode, 'AI_GRADING_INVALID_RESPONSE');
  assert.deepEqual(result.failedQuestionIds, ['q']);
});

test('explicit author AI grading saves formatted feedback, readable report and final score exactly once', async (t) => {
  const store = new MemoryStore(), progressStore = new MemoryStore();
  adminExams._test.setExamStoreFactory(() => store);
  adminExams._test.setProgressStoreFactory(() => progressStore);
  const definition = examCommon.normalizeDefinition({ examId: 'ocena-ai', metadata: { name: 'Ocena AI' }, questions: [
    { questionId: 'open', type: 'open_answer', prompt: '**Wyjaśnij**.', points: 4, gradingMode: 'ai', answerKey: 'Klucz' }
  ] });
  const attempt = { version: 1, revision: 0, attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', number: 1,
    repositoryId: 'default', examId: definition.examId, userId: 'student-123', profile: { email: 'student@example.com', name: 'Uczeń' },
    status: 'submitted', definitionSnapshot: definition, questions: definition.questions, answers: { open: 'Uzasadnienie ucznia' },
    operationIds: [], lastActivityAt: new Date().toISOString(), submittedAt: new Date().toISOString(), durationSeconds: 30 };
  attempt.result = examCommon.gradeAttempt(attempt, definition);
  await examStorage.createAttempt(store, attempt);
  let calls = 0;
  openAnswerGrader.setSendRequest(async (input) => {
    calls += 1;
    assert.equal(input.userId, 'admin-1234', 'Author-triggered grading uses the author quota');
    return { text: 'Ocena:\n```json\n{"grades":[{"questionId":"open","ratio":0.75,"feedback":"Dobry tok rozumowania."}]}\n```' };
  });
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ id: 'admin-1234', app_metadata: { roles: ['admin'] } }), { status: 200 }));
  const event = { httpMethod: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json', origin: 'https://course.example', host: 'course.example', 'x-forwarded-proto': 'https' }, body: JSON.stringify({
    action: 'ai-grade', repositoryId: 'default', examId: definition.examId, targetUserId: attempt.userId, attemptId: attempt.attemptId,
    revision: 0, operationId: 'admin-ai-grade:one-click'
  }) };
  const context = { clientContext: { user: { id: 'admin-1234', app_metadata: { roles: ['admin'] } }, identity: { url: 'https://course.example/.netlify/identity' } } };
  const response = await adminExams.handler(event, context);
  assert.equal(response.statusCode, 200, response.body);
  const result = JSON.parse(response.body);
  assert.equal(result.aiGradedCount, 1);
  assert.equal(result.attempt.result.points, 3);
  assert.equal(result.attempt.result.gradingStatus, 'graded');
  assert.deepEqual(result.attempt.questions[0].answerDisplay, ['Uzasadnienie ucznia']);
  assert.equal(result.attempt.result.questionResults[0].feedback, 'Dobry tok rozumowania.');
  assert.equal((await adminExams.handler(event, context)).statusCode, 200);
  assert.equal(calls, 1, 'Replaying a completed operation never calls AI again');
});

test('quiz open questions support AI, manual and ungraded scoring without leaking the key', () => {
  const quiz = quizModel.createQuiz({
    quizId: 'otwarte-pytania',
    metadata: { title: 'Otwarte pytania', status: 'published' },
    settings: { passingScore: 50 },
    questions: [
      { questionId: 'open-ai', type: 'open', prompt: 'Wyjaśnij reakcję.', points: 4, gradingMode: 'ai', answerKey: 'Reakcja wymiany.' },
      { questionId: 'open-manual', type: 'open', prompt: 'Uzasadnij.', points: 2, gradingMode: 'manual', answerKey: '' },
      { questionId: 'open-note', type: 'open', prompt: 'Refleksja.', points: 99, gradingMode: 'ungraded', answerKey: '' }
    ]
  });
  assert.equal(quizModel.validate(quiz).valid, true);
  assert.equal(quizCommon.validateDefinition(JSON.parse(quizModel.serialize(quiz)), quiz.quizId).valid, true);
  const publicQuiz = quizCommon.publicDefinition(quiz);
  assert.equal(Object.hasOwn(publicQuiz.questions[0], 'answerKey'), false);
  assert.equal(Object.hasOwn(publicQuiz.questions[0], 'aiInstruction'), false);
  assert.equal(Object.hasOwn(publicQuiz.questions[0], 'explanation'), false);

  const answers = { 'open-ai': 'Reakcja wymiany', 'open-manual': 'Uzasadnienie', 'open-note': 'Notatka' };
  const pending = quizCommon.gradeQuiz(quiz, answers, { aiGrades: { 'open-ai': { ratio: 1 } } });
  assert.equal(pending.gradingStatus, 'pending_review');
  assert.equal(pending.maximum, 6);
  assert.equal(pending.percent, null);

  const graded = quizCommon.gradeQuiz(quiz, answers, {
    aiGrades: { 'open-ai': { ratio: 1, feedback: 'Poprawnie.' } },
    manualGrades: { 'open-manual': { points: 1, feedback: 'Częściowo.' } }
  });
  assert.equal(graded.gradingStatus, 'graded');
  assert.equal(graded.earned, 5);
  assert.equal(graded.maximum, 6);
  assert.equal(graded.percent, 83.33);
  assert.equal(graded.results.find((entry) => entry.questionId === 'open-note').reviewStatus, 'not_scored');
});

test('quiz response marks a deferred AI check without leaking hidden feedback', () => {
  const quiz = quizModel.createQuiz({
    quizId: 'ai-odroczone',
    metadata: { title: 'AI odroczone', status: 'published' },
    settings: { showFeedback: false },
    questions: [{
      questionId: 'open-ai', type: 'open', prompt: 'Wyjaśnij.', points: 2,
      gradingMode: 'ai', answerKey: 'Tajny klucz', explanation: 'Tajne wyjaśnienie'
    }]
  });
  const result = quizCommon.gradeQuiz(quiz, { 'open-ai': 'Odpowiedź ucznia' });
  const student = quizFunction._test.studentResult(result, quiz, { aiDeferredCount: 1 });
  assert.equal(student.gradingStatus, 'pending_review');
  assert.equal(student.aiDeferredCount, 1);
  assert.equal(student.results[0].feedback, '');
  assert.equal(student.results[0].explanation, '');
  assert.equal(JSON.stringify(student).includes('Tajny'), false);
});

test('blank optional and zero-point open questions finish immediately without affecting the score', () => {
  const quiz = quizModel.createQuiz({
    quizId: 'bez-punktow', metadata: { title: 'Bez punktów', status: 'published' },
    questions: [
      { questionId: 'blank-manual', type: 'open', prompt: 'Opcjonalne', required: false, points: 2, gradingMode: 'manual' },
      { questionId: 'zero-ai', type: 'open', prompt: 'Zero', points: 0, gradingMode: 'ai', answerKey: 'Klucz' }
    ]
  });
  const blank = quizCommon.gradeQuiz(quiz, { 'blank-manual': '', 'zero-ai': 'Treść' });
  assert.equal(blank.gradingStatus, 'graded');
  assert.equal(blank.percent, 0);
  assert.equal(blank.results[0].points, 0);
  assert.equal(blank.results[1].reviewStatus, 'not_scored');

  const unscoredQuiz = quizModel.createQuiz({
    quizId: 'tylko-notatka', metadata: { title: 'Notatka', status: 'published' },
    questions: [{ questionId: 'note', type: 'open', prompt: 'Refleksja', points: 5, gradingMode: 'ungraded' }]
  });
  const unscored = quizCommon.gradeQuiz(unscoredQuiz, { note: 'Moja refleksja' });
  assert.equal(unscored.gradingStatus, 'not_scored');
  assert.equal(unscored.percent, null);
  assert.equal(unscored.passed, null);

  const unscoredExam = examCommon.normalizeDefinition({
    examId: 'bez-punktow', metadata: { name: 'Bez punktów' },
    questions: [{ questionId: 'note', type: 'open_answer', prompt: 'Refleksja', points: 5, gradingMode: 'ungraded' }]
  });
  const examAttempt = { questions: unscoredExam.questions, answers: { note: 'Treść' } };
  const examResult = examCommon.gradeAttempt(examAttempt, unscoredExam);
  assert.equal(examResult.gradingStatus, 'not_scored');
  assert.equal(examResult.scorePercent, null);
  assert.equal(examResult.passed, null);
});

test('exam result stays pending until a reviewer awards points and excludes ungraded questions', () => {
  const definition = examModel.createExam({
    examId: 'egzamin-otwarty',
    metadata: { name: 'Egzamin otwarty', passThreshold: 50 },
    scoring: { equalPoints: false },
    resultVisibility: { feedbackMode: 'after_submit', studentResultVisible: true, scorePercent: true, points: true, passFail: true, ownAnswers: true },
    questions: [
      { questionId: 'manual-one', type: 'open_answer', prompt: 'Uzasadnij.', points: 4, gradingMode: 'manual', answerKey: '' },
      { questionId: 'ungraded-one', type: 'open_answer', prompt: 'Refleksja.', points: 20, gradingMode: 'ungraded', answerKey: '' }
    ]
  });
  const checked = examCommon.validateDefinition(definition, definition.examId);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  const questions = examCommon.selectAttemptQuestions(checked.definition, { questions: [] });
  assert.equal(questions.find((question) => question.questionId === 'ungraded-one').points, 20);
  const attempt = {
    attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'submitted', submittedAt: new Date().toISOString(),
    questions, answers: { 'manual-one': 'Odpowiedź ucznia', 'ungraded-one': 'Refleksja' }, durationSeconds: 10
  };
  attempt.result = examCommon.gradeAttempt(attempt, checked.definition);
  assert.equal(attempt.result.gradingStatus, 'pending_review');
  assert.equal(attempt.result.scorePercent, null);
  assert.equal(attempt.result.maxPoints, 4);

  attempt.result = examCommon.gradeAttempt(attempt, checked.definition, {
    manualGrades: { 'manual-one': { points: 3, feedback: 'Brakuje jednego elementu.' } }
  });
  assert.equal(attempt.result.gradingStatus, 'graded');
  assert.equal(attempt.result.scorePercent, 75);
  assert.equal(attempt.result.passed, true);
  const student = examCommon.resultForStudent(attempt, checked.definition);
  const reviewed = student.questions.find((question) => question.questionId === 'manual-one');
  assert.equal(reviewed.feedback, 'Brakuje jednego elementu.');
  assert.deepEqual(reviewed.answerDisplay, ['Odpowiedź ucznia']);
  assert.equal(Object.hasOwn(reviewed, 'correctAnswerDisplay'), false);
});

test('exam open answers survive sanitization and point visibility remains private when disabled', () => {
  assert.equal(examFunction._test.sanitizeAnswer({ type: 'open_answer' }, '  długi\0 tekst  '), '  długi tekst  ');
  const definition = examCommon.normalizeDefinition({
    examId: 'ukryte-punkty', metadata: { name: 'Ukryte punkty' },
    resultVisibility: { feedbackMode: 'after_submit', points: false, ownAnswers: true },
    questions: [{ questionId: 'open', type: 'open_answer', prompt: 'Odpowiedz', points: 4, gradingMode: 'manual' }]
  });
  const attempt = { attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'submitted', questions: definition.questions, answers: { open: 'Treść' } };
  attempt.result = examCommon.gradeAttempt(attempt, definition, { manualGrades: { open: { points: 3 } } });
  const student = examCommon.resultForStudent(attempt, definition);
  assert.equal(Object.hasOwn(student.questions[0], 'points'), false);
  assert.equal(Object.hasOwn(student.questions[0], 'maxPoints'), false);
});

test('special question IDs cannot inherit fake answers or grades from Object.prototype', async () => {
  let calls = 0;
  openAnswerGrader.setSendRequest(async () => { calls += 1; return { text: '{}' }; });
  const question = { questionId: 'constructor', type: 'open_answer', prompt: 'Treść', points: 2, gradingMode: 'ai', answerKey: 'Klucz' };
  const evaluated = await openAnswerGrader.evaluateAiQuestions([question], {}, { userId: 'student' });
  assert.equal(calls, 0);
  assert.deepEqual(evaluated.failedQuestionIds, []);
  assert.equal(openAnswerGrader.gradeOpenQuestion({ ...question, gradingMode: 'manual' }, 'odpowiedź', { manualGrades: {} }).reviewStatus, 'pending');
});

test('admin grading recomputes pending exam and quiz attempts', () => {
  const examDefinition = examCommon.normalizeDefinition({
    version: 1, examId: 'manualny', metadata: { name: 'Manualny', passThreshold: 50 }, status: 'published',
    scoring: { equalPoints: false },
    questions: [{ questionId: 'exam-open', type: 'open_answer', prompt: 'Odpowiedz.', points: 2, gradingMode: 'manual' }]
  }, 'manualny');
  const examAttempt = {
    status: 'submitted', questions: examDefinition.questions, answers: { 'exam-open': 'Treść' },
    definitionSnapshot: examDefinition
  };
  examAttempt.result = examCommon.gradeAttempt(examAttempt, examDefinition);
  assert.equal(adminExams._test.applyManualGrades(examAttempt, [{ questionId: 'exam-open', points: 2, feedback: 'OK' }], { userId: 'admin' }).gradingStatus, 'graded');
  assert.equal(examAttempt.result.scorePercent, 100);

  const quizDefinition = quizModel.createQuiz({
    quizId: 'manualny-quiz', metadata: { title: 'Manualny quiz', status: 'published' },
    questions: [{ questionId: 'quiz-open', type: 'open', prompt: 'Odpowiedz.', points: 3, gradingMode: 'manual' }]
  });
  const quizAttempt = {
    kind: 'quiz', status: 'submitted', questions: quizDefinition.questions,
    answers: { 'quiz-open': 'Treść' }, definitionSnapshot: quizDefinition
  };
  quizAttempt.result = quizCommon.gradeQuiz(quizDefinition, quizAttempt.answers);
  assert.equal(adminQuizzes._test.applyGrades(quizAttempt, [{ questionId: 'quiz-open', points: 2, feedback: 'Prawie.' }], 'admin').gradingStatus, 'graded');
  assert.equal(quizAttempt.result.percent, 66.67);
  assert.equal(adminExams._test.validateGrades([{ questionId: 'exam-open', points: null }]).ok, false);
  assert.equal(adminQuizzes._test.validateGrades([{ questionId: 'quiz-open', points: null }]).ok, false);
});

test('exam AI grading is deferred until the author explicitly triggers it', () => {
  const definition = examCommon.normalizeDefinition({
    examId: 'ai-na-zadanie', metadata: { name: 'AI na żądanie', passThreshold: 50 },
    questions: [{ questionId: 'exam-ai', type: 'open_answer', prompt: 'Wyjaśnij', points: 4, gradingMode: 'ai', answerKey: 'Klucz' }]
  });
  const attempt = {
    status: 'submitted', questions: definition.questions, answers: { 'exam-ai': 'Odpowiedź ucznia' },
    definitionSnapshot: definition
  };
  attempt.result = examCommon.gradeAttempt(attempt, definition);
  assert.equal(attempt.result.gradingStatus, 'pending_review');
  assert.deepEqual(adminExams._test.pendingAiReviewQuestions(attempt).map((question) => question.questionId), ['exam-ai']);
  const applied = adminExams._test.applyAiGrades(attempt, {
    'exam-ai': { ratio: 0.75, feedback: 'Częściowo poprawnie.', gradedBy: 'ai' }
  }, { userId: 'author-admin' });
  assert.equal(applied.gradingStatus, 'graded');
  assert.equal(attempt.result.points, 3);
  assert.equal(attempt.result.scorePercent, 75);
  assert.equal(attempt.result.questionResults[0].gradedBy, 'ai');
  assert.equal(examFunction._test.attemptIndexNeedsSync({ attempts: [] }, {
    attemptId: 'missing', status: 'submitted', lastActivityAt: '2026-01-01T00:00:00.000Z', result: attempt.result
  }), true);
  assert.equal(examFunction._test.attemptIndexNeedsSync({ attempts: [{
    attemptId: 'current', status: 'submitted', lastActivityAt: '2026-01-01T00:00:00.000Z', gradingStatus: 'graded'
  }] }, {
    attemptId: 'current', status: 'submitted', lastActivityAt: '2026-01-01T00:00:00.000Z', result: { gradingStatus: 'graded' }
  }), false);
});

test('a stale author report is rejected before any paid AI request', async (t) => {
  const store = new MemoryStore();
  adminExams._test.setExamStoreFactory(() => store);
  const definition = examCommon.normalizeDefinition({
    examId: 'ai-konflikt', metadata: { name: 'AI konflikt' },
    questions: [{
      questionId: 'exam-ai', type: 'open_answer', prompt: 'Wyjaśnij.',
      points: 2, gradingMode: 'ai', answerKey: 'Klucz'
    }]
  });
  const attempt = {
    version: 1, revision: 3, attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', number: 1,
    repositoryId: 'default', examId: definition.examId, userId: 'student-123',
    profile: { email: 'student@example.com', name: 'Uczeń' }, status: 'submitted',
    definitionSnapshot: definition, questions: definition.questions, answers: { 'exam-ai': 'Odpowiedź' },
    result: null, operationIds: [], lastActivityAt: new Date().toISOString()
  };
  attempt.result = examCommon.gradeAttempt(attempt, definition);
  await examStorage.createAttempt(store, attempt);
  let calls = 0;
  openAnswerGrader.setSendRequest(async () => { calls += 1; return { text: '{"grades":[]}' }; });
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    id: 'admin-1234', email: 'admin@example.com', app_metadata: { roles: ['admin'] }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });
  const response = await adminExams.handler({
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer test-token', accept: 'application/json', 'content-type': 'application/json',
      origin: 'https://course.example', host: 'course.example', 'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({
      action: 'ai-grade', repositoryId: 'default', examId: definition.examId,
      targetUserId: attempt.userId, attemptId: attempt.attemptId, revision: 2,
      operationId: 'admin-ai-grade:stale-request'
    })
  }, {
    clientContext: {
      user: { id: 'admin-1234', app_metadata: { roles: ['admin'] } },
      identity: { url: 'https://course.example/.netlify/identity' }
    }
  });
  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).error, 'ATTEMPT_VERSION_CONFLICT');
  assert.equal(calls, 0);
});

test('open quiz attempts are stored before grading and completed results can be recovered', async () => {
  const store = new MemoryStore();
  quizFunction._test.setStoreFactory(() => store);
  const definition = quizModel.createQuiz({
    quizId: 'trwaly-quiz', metadata: { title: 'Trwały quiz', status: 'published' }, settings: { allowRetry: false },
    questions: [{ questionId: 'open', type: 'open', prompt: 'Odpowiedz', points: 2, gradingMode: 'manual' }]
  });
  const input = {
    repositoryId: 'default', quizId: definition.quizId, definition, answers: { open: 'Treść' },
    materialId: 'quiz-card', auth: { userId: 'student-123', user: { email: 'student@example.com', user_metadata: {} } }
  };
  const started = await quizFunction._test.beginStoredAttempt(input);
  assert.equal(started.attempt.status, 'active');
  const result = quizCommon.gradeQuiz(definition, input.answers);
  const finished = await quizFunction._test.finishStoredAttempt(started, { definition, answers: input.answers, result, materialId: input.materialId });
  assert.equal(finished.attempt.status, 'submitted');
  assert.equal(finished.attempt.result.gradingStatus, 'pending_review');
  const recovered = await quizFunction._test.beginStoredAttempt(input);
  assert.equal(recovered.attempt.attemptId, finished.attempt.attemptId);
  assert.equal(recovered.attempt.status, 'submitted');
});

test('Studio does not save a fake answer key for a new AI question', () => {
  const quiz = quizModel.createQuiz({
    quizId: 'nowe-ai', metadata: { title: 'Nowe AI' },
    questions: [{ type: 'open', questionId: 'open-ai', gradingMode: 'ai' }]
  });
  assert.equal(quiz.questions[0].answerKey, '');
  assert.equal(quizModel.validate(quiz).valid, false);
  const examQuestion = examModel.createQuestion({ type: 'open_answer', gradingMode: 'ai' });
  assert.equal(examQuestion.answerKey, '');
  assert.equal(examModel.validateExam(examModel.createExam({ questions: [examQuestion] })).valid, false);
});

test('Studio and learner interfaces expose open questions, AI mode and manual score controls', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'public/members/module/studio/index.html',
    'public/members/module/studio/quiz-builder.js',
    'public/members/module/studio/exam-builder.js',
    'public/members/module/quiz/script.js',
    'public/members/module/exam/script.js'
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.match(files, /Pytanie otwarte/);
  assert.match(files, /Sprawdź oczekujące odpowiedzi za pomocą AI/);
  assert.match(files, /Sprawdź odpowiedzi za pomocą AI/);
  assert.match(files, /Sprawdzający przyznaje punkty/);
  assert.match(files, /Bez punktów/);
  assert.match(files, /data-exam-grade-points/);
  assert.match(files, /data-quiz-grade-points/);
  assert.match(files, /exam-open-answer/);
  assert.match(files, /quiz-player-open-answer/);
  const examEndpoint = fs.readFileSync(path.join(root, 'netlify/functions/exam.js'), 'utf8');
  const adminExamEndpoint = fs.readFileSync(path.join(root, 'netlify/functions/admin-exams.js'), 'utf8');
  assert.doesNotMatch(examEndpoint, /evaluateAiQuestions/);
  assert.match(adminExamEndpoint, /body\.action === 'ai-grade'/);
  assert.ok(adminExamEndpoint.indexOf("error: 'ATTEMPT_VERSION_CONFLICT'")
    < adminExamEndpoint.indexOf('openAnswerGrader.evaluateAiQuestions('));
});
