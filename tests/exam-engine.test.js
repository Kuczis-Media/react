const test = require('node:test');
const assert = require('node:assert/strict');

const examCommon = require('../netlify/exam-common.js');
const examStorage = require('../netlify/exam-storage.js');
const examFunction = require('../netlify/functions/exam.js');
const adminExamsFunction = require('../netlify/functions/admin-exams.js');
const contentRepository = require('../netlify/content-repository.js');
const progressCommon = require('../netlify/progress-common.js');
const { CATALOG_KEY } = require('../netlify/progress-storage.js');
const examStudioModel = require('../public/members/module/studio/exam-model.js');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDENTITY_URL = 'https://course.example/.netlify/identity';

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
  async list(options = {}) {
    const prefix = options.prefix || '';
    return { blobs: [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })), cursor: null };
  }
}

function question(type, suffix, extra = {}) {
  const base = { questionId: `question-${suffix}`, type, prompt: `Pytanie ${suffix}`, points: 2, ...extra };
  if (type === 'single_choice') return { ...base, options: [{ answerId: `a-${suffix}`, text: 'A' }, { answerId: `b-${suffix}`, text: 'B' }], correctAnswerIds: [`a-${suffix}`] };
  if (type === 'multiple_choice') return { ...base, options: [{ answerId: `a-${suffix}`, text: 'A' }, { answerId: `b-${suffix}`, text: 'B' }, { answerId: `c-${suffix}`, text: 'C' }], correctAnswerIds: [`a-${suffix}`, `b-${suffix}`] };
  if (type === 'true_false') return { ...base, correctAnswerIds: ['true'] };
  if (type === 'short_text') return { ...base, acceptedAnswers: ['Etanol'], caseInsensitive: true };
  if (type === 'number') return { ...base, correctNumber: 10, tolerance: .5 };
  if (type === 'matching') return { ...base, pairs: [{ pairId: `pair-a-${suffix}`, left: 'H', right: 'Wodór' }, { pairId: `pair-b-${suffix}`, left: 'O', right: 'Tlen' }] };
  if (type === 'ordering') return { ...base, items: [{ itemId: `item-a-${suffix}`, text: 'A' }, { itemId: `item-b-${suffix}`, text: 'B' }], correctOrder: [`item-a-${suffix}`, `item-b-${suffix}`] };
  return { ...base, template: 'Wzór wody to {{wzór}}.', blanks: [{ blankId: `blank-${suffix}`, acceptedAnswers: ['H2O'], caseInsensitive: true }] };
}

function definition(overrides = {}) {
  return {
    version: 1,
    examId: overrides.examId || 'egzamin-testowy',
    metadata: { name: 'Egzamin testowy', passThreshold: 60, ...overrides.metadata },
    status: overrides.status || 'published',
    questions: overrides.questions || [question('single_choice', 'one')],
    questionRefs: overrides.questionRefs || [],
    scoring: { equalPoints: false, partialPoints: true, negativePointsEnabled: true, multipleChoiceStrategy: 'correct_minus_incorrect', ...overrides.scoring },
    attempts: { mode: 'one', maxAttempts: 1, cooldownSeconds: 0, resultStrategy: 'best', ...overrides.attempts },
    navigation: { allowBack: true, allowFreeNavigation: true, allowSkip: true, requireAnswerBeforeNext: false, allowFlagging: true, ...overrides.navigation },
    timing: { mode: 'none', limitSeconds: 3600, questionLimitSeconds: 120, display: 'countdown', ...overrides.timing },
    display: { mode: 'one', questionsPerPage: 1, ...overrides.display },
    security: { leavePolicy: 'allow_resume', ...overrides.security },
    availability: { mode: 'always', userIds: [], ...overrides.availability },
    randomization: { questionOrder: false, answerOrder: false, totalQuestions: null, categoryQuotas: [], ...overrides.randomization },
    resultVisibility: { scorePercent: true, points: false, passFail: true, ownAnswers: false, correctAnswers: false, errors: false, explanations: false, time: true, ...overrides.resultVisibility }
  };
}

function contextFor(user) {
  return { clientContext: { user, identity: { url: IDENTITY_URL } } };
}

function eventFor(method, body, query = {}) {
  return {
    httpMethod: method,
    headers: {
      authorization: 'Bearer exam-client-token', accept: 'application/json', 'content-type': 'application/json',
      origin: 'https://course.example', host: 'course.example', 'x-forwarded-proto': 'https'
    },
    queryStringParameters: query,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

function bodyOf(response) { return JSON.parse(response.body); }
function identityResponse(user) { return new Response(JSON.stringify(user), { status: 200, headers: { 'content-type': 'application/json' } }); }

test('question model supports all types, safe media and server-side scoring strategies', () => {
  const questions = examCommon.QUESTION_TYPES.map((type, index) => question(type, String(index), {
    images: [{ ref: 'photos/question.webp', alt: 'Schemat cząsteczki' }],
    explanation: 'Ukryte wyjaśnienie'
  }));
  const checked = examCommon.validateDefinition(definition({ questions }));
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(checked.definition.questions.length, examCommon.QUESTION_TYPES.length);
  assert.deepEqual(checked.definition.questions[0].images[0], { ref: 'photos/question.webp', alt: 'Schemat cząsteczki' });
  assert.equal(examCommon.normalizeImage({ ref: '../secret.png', alt: 'x' }), null);

  const multiple = checked.definition.questions.find((entry) => entry.type === 'multiple_choice');
  multiple.negativePoints = 1;
  assert.equal(examCommon.gradeQuestion(multiple, [multiple.correctAnswerIds[0]], checked.definition.scoring).points, 1);
  assert.equal(examCommon.gradeQuestion(multiple, ['unknown'], checked.definition.scoring).points, -1);
  const numeric = checked.definition.questions.find((entry) => entry.type === 'number');
  assert.equal(examCommon.gradeQuestion(numeric, '10,4', checked.definition.scoring).correct, true);
  const textQuestion = checked.definition.questions.find((entry) => entry.type === 'short_text');
  assert.equal(examCommon.gradeQuestion(textQuestion, '  ETANOL ', checked.definition.scoring).correct, true);

  const selected = examCommon.selectAttemptQuestions(checked.definition, { questions: [] }, { randomInt: (maximum) => maximum - 1 });
  const matching = selected.find((entry) => entry.type === 'matching');
  const studentMatching = examCommon.safeQuestion(matching);
  assert.ok(studentMatching.right.every((entry) => entry.answerId.startsWith('match-')));
  assert.ok(studentMatching.right.every((entry) => !matching.pairs.some((pair) => pair.pairId === entry.answerId)));
  const matchingAnswer = Object.fromEntries(matching.pairs.map((pair) => [pair.pairId, matching.matchingRightIds[pair.pairId]]));
  assert.equal(examCommon.gradeQuestion(matching, matchingAnswer, checked.definition.scoring).correct, true);

  const safe = JSON.stringify(selected.map(examCommon.safeQuestion));
  assert.doesNotMatch(safe, /correctAnswer|acceptedAnswers|correctNumber|correctOrder|explanation/);
  const publicExam = examCommon.publicMetadata(definition({ availability: { mode: 'always', userIds: [USER_A] } }));
  assert.equal(publicExam.availability.restrictedToSelectedUsers, true);
  assert.doesNotMatch(JSON.stringify(publicExam), new RegExp(USER_A));

  const visibleDefinition = definition({
    questions: [question('matching', 'visible')],
    resultVisibility: { ownAnswers: true, correctAnswers: true, errors: true, explanations: true }
  });
  const visibleQuestion = examCommon.selectAttemptQuestions(visibleDefinition, { questions: [] })[0];
  const visibleAnswer = Object.fromEntries(visibleQuestion.pairs.map((pair) => [pair.pairId, visibleQuestion.matchingRightIds[pair.pairId]]));
  const visibleAttempt = {
    attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff', status: 'submitted', submittedAt: new Date().toISOString(),
    questions: [visibleQuestion], answers: { [visibleQuestion.questionId]: visibleAnswer }, durationSeconds: 12
  };
  visibleAttempt.result = examCommon.gradeAttempt(visibleAttempt, visibleDefinition);
  const studentResult = examCommon.resultForStudent(visibleAttempt, visibleDefinition);
  assert.deepEqual(studentResult.questions[0].answerDisplay, ['H → Wodór', 'O → Tlen']);
  assert.deepEqual(studentResult.questions[0].correctAnswerDisplay, ['H → Wodór', 'O → Tlen']);
  assert.doesNotMatch(JSON.stringify(studentResult.questions[0].answerDisplay), /match-[a-f0-9]+/);

  const hiddenDefinition = definition({
    resultVisibility: { feedbackMode: 'never', studentResultVisible: false, scorePercent: true, passFail: true, correctAnswers: true }
  });
  const hiddenQuestion = examCommon.selectAttemptQuestions(hiddenDefinition, { questions: [] })[0];
  const hiddenAttempt = {
    attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'submitted', submittedAt: new Date().toISOString(),
    questions: [hiddenQuestion], answers: { [hiddenQuestion.questionId]: hiddenQuestion.correctAnswerIds[0] }, durationSeconds: 8
  };
  hiddenAttempt.result = examCommon.gradeAttempt(hiddenAttempt, hiddenDefinition);
  const hiddenStudentResult = examCommon.resultForStudent(hiddenAttempt, hiddenDefinition);
  assert.equal(Object.hasOwn(hiddenStudentResult, 'scorePercent'), false);
  assert.equal(Object.hasOwn(hiddenStudentResult, 'passed'), false);
  assert.equal(Object.hasOwn(hiddenStudentResult, 'questions'), false);

  const selectedAudience = examCommon.normalizeDefinition(definition({
    availability: { audienceMode: 'selected', userIds: [USER_A] }
  }));
  assert.equal(examCommon.availabilityState(selectedAudience, USER_A).available, true);
  assert.equal(examCommon.availabilityState(selectedAudience, USER_B).reason, 'USER_NOT_ALLOWED');
  const allAudience = examCommon.normalizeDefinition(definition({
    availability: { audienceMode: 'all', userIds: [USER_A] }
  }));
  assert.equal(examCommon.availabilityState(allAudience, USER_B).available, true);
});

test('randomization preserves exact attempt order, quotas and validates impossible totals', () => {
  const questions = [
    question('single_choice', 'o1', { categories: ['organiczna'] }),
    question('single_choice', 'o2', { categories: ['organiczna'] }),
    question('single_choice', 'n1', { categories: ['nieorganiczna'] }),
    question('single_choice', 'g1', { categories: ['ogólna'] })
  ];
  const exam = definition({
    questions,
    randomization: { questionOrder: true, answerOrder: true, totalQuestions: 3, categoryQuotas: [{ category: 'organiczna', count: 2 }, { category: 'nieorganiczna', count: 1 }] }
  });
  const selected = examCommon.selectAttemptQuestions(exam, { questions: [] }, { randomInt: (maximum) => maximum - 1 });
  assert.equal(selected.length, 3);
  assert.equal(selected.filter((entry) => entry.categories.includes('organiczna')).length, 2);
  assert.equal(selected.filter((entry) => entry.categories.includes('nieorganiczna')).length, 1);
  assert.ok(selected.every((entry) => entry.answerOrder.length === entry.options.length));
  const invalid = examCommon.validateDefinition({ ...exam, randomization: { ...exam.randomization, totalQuestions: 2 } });
  assert.ok(invalid.errors.some((error) => error.code === 'CATEGORY_QUOTAS_EXCEED_TOTAL'));
});

test('Exam Builder preserves bank-only definitions and every extensible question type', () => {
  const bankOnly = examStudioModel.createExam({
    examId: 'egzamin-z-banku', metadata: { name: 'Egzamin z banku' }, questions: [], questionRefs: ['question-from-bank']
  });
  assert.equal(bankOnly.questions.length, 0);
  assert.deepEqual(bankOnly.questionRefs, ['question-from-bank']);
  assert.equal(examStudioModel.validateExam(bankOnly).valid, true);
  const allTypes = examStudioModel.QUESTION_TYPES.map((type, index) => examStudioModel.createQuestion({
    type,
    questionId: `builder-question-${index}`,
    ...(type === 'open_answer' ? { answerKey: 'Wzorcowa odpowiedź do testu.' } : {})
  }));
  const serialized = examStudioModel.serializeExam({ examId: 'wszystkie-typy', metadata: { name: 'Wszystkie typy' }, questions: allTypes });
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed.questions.map((entry) => entry.type), examStudioModel.QUESTION_TYPES);
  assert.deepEqual(parsed.questions.map((entry) => entry.questionId), allTypes.map((entry) => entry.questionId));
  const selectedWithoutUsers = examStudioModel.createExam({ availability: { audienceMode: 'selected', userIds: [] } });
  assert.equal(examStudioModel.validateExam(selectedWithoutUsers).valid, false);
  assert.ok(examStudioModel.validateExam(selectedWithoutUsers).errors.some((error) => error.code === 'AVAILABILITY_USERS_REQUIRED'));
  const newExam = examStudioModel.createExam();
  assert.equal(newExam.resultVisibility.feedbackMode, 'after_submit');
  assert.equal(newExam.resultVisibility.studentResultVisible, true);
});

test('Exam Function provides autosave, resume, timer-safe result and blocks IDOR and answer-key leakage', async (t) => {
  const examStore = new MemoryStore();
  const progressStore = new MemoryStore();
  await progressStore.set(CATALOG_KEY, JSON.stringify(progressCommon.normalizeCatalog({
    global: { tracking: 'ON', showProgress: 'ON', recordOpens: true },
    nodes: [
      { id: 'exam-card', type: 'exam', title: 'Egzamin', progress: { tracking: 'ON', showProgress: 'ON', weight: 1 }, settings: { repositoryId: 'default', examId: 'egzamin-testowy' } },
      { id: 'legacy-exam-card', type: 'exam', title: 'Starszy kafelek egzaminu', progress: { tracking: 'ON', showProgress: 'ON', weight: 1 }, settings: {} }
    ]
  })));
  examFunction._test.setStoreFactory(() => examStore);
  examFunction._test.setProgressStoreFactory(() => progressStore);
  adminExamsFunction._test.setExamStoreFactory(() => examStore);
  adminExamsFunction._test.setProgressStoreFactory(() => progressStore);

  let currentDefinition = definition();
  const originalReadAsset = contentRepository.readAsset;
  contentRepository.readAsset = async (kind, filename) => {
    if (kind === 'exam') return { content: JSON.stringify({ ...currentDefinition, examId: filename }), sha: 'a'.repeat(40) };
    if (kind === 'question_bank') return { content: JSON.stringify({ version: 1, questions: [] }), sha: 'b'.repeat(40) };
    throw new contentRepository.ContentRepositoryError('CONTENT_FILE_NOT_FOUND', 404);
  };
  let canonical = { id: USER_A, email: 'uczen@example.com', user_metadata: { full_name: 'Uczeń A' }, app_metadata: { roles: ['active'] } };
  const originalFetch = global.fetch;
  global.fetch = async () => identityResponse(canonical);
  t.after(() => {
    global.fetch = originalFetch;
    contentRepository.readAsset = originalReadAsset;
    examFunction._test.setStoreFactory(null);
    examFunction._test.setProgressStoreFactory(null);
    adminExamsFunction._test.setExamStoreFactory(null);
    adminExamsFunction._test.setProgressStoreFactory(null);
  });

  const studentContext = () => contextFor(canonical);
  const opened = await examFunction.handler(eventFor('POST', { action: 'bootstrap', repositoryId: 'default', examId: 'egzamin-testowy', materialId: 'exam-card' }), studentContext());
  assert.equal(opened.statusCode, 200);
  assert.equal(bodyOf(opened).opened, true);
  assert.equal(bodyOf(opened).exam.examId, 'egzamin-testowy');
  assert.deepEqual(bodyOf(opened).attempts, []);
  assert.equal(bodyOf(opened).available.available, true);
  assert.match(bodyOf(opened).serverNow, /^\d{4}-\d{2}-\d{2}T/);
  currentDefinition = definition({
    questions: [{
      questionId: 'open-without-key', type: 'open_answer', prompt: 'Wyjaśnij.',
      points: 2, gradingMode: 'ai', answerKey: ''
    }]
  });
  const invalidAiExam = await examFunction.handler(eventFor('GET', undefined, {
    repo: 'default', exam: 'egzamin-testowy'
  }), studentContext());
  assert.equal(invalidAiExam.statusCode, 422);
  assert.equal(bodyOf(invalidAiExam).error, 'EXAM_FILE_INVALID');
  currentDefinition = definition();
  const forged = await examFunction.handler(eventFor('POST', { action: 'start', repositoryId: 'default', examId: 'egzamin-testowy', materialId: 'exam-card', userId: USER_B }), studentContext());
  assert.equal(forged.statusCode, 400);
  assert.equal(bodyOf(forged).error, 'UNEXPECTED_FIELDS');

  const startedResponse = await examFunction.handler(eventFor('POST', { action: 'start', repositoryId: 'default', examId: 'egzamin-testowy', materialId: 'legacy-exam-card' }), studentContext());
  assert.equal(startedResponse.statusCode, 201);
  let attempt = bodyOf(startedResponse).attempt;
  const serializedActive = JSON.stringify(attempt);
  assert.doesNotMatch(serializedActive, /correctAnswerIds|explanation|acceptedAnswers/);
  assert.equal(attempt.answers[attempt.questions[0].questionId], undefined);

  const resumed = await examFunction.handler(eventFor('POST', { action: 'start', repositoryId: 'default', examId: 'egzamin-testowy', materialId: 'exam-card' }), studentContext());
  assert.equal(bodyOf(resumed).resumed, true);
  assert.equal(bodyOf(resumed).attempt.attemptId, attempt.attemptId);
  attempt = bodyOf(resumed).attempt;

  const operationId = 'operation-save-0001';
  const saved = await examFunction.handler(eventFor('POST', {
    action: 'autosave', repositoryId: 'default', examId: 'egzamin-testowy', attemptId: attempt.attemptId,
    revision: attempt.revision, operationId, questionId: attempt.questions[0].questionId, answer: attempt.questions[0].options[0].answerId
  }), studentContext());
  assert.equal(saved.statusCode, 200);
  attempt = bodyOf(saved).attempt;
  assert.equal(attempt.answeredCount, 1);

  const duplicate = await examFunction.handler(eventFor('POST', {
    action: 'autosave', repositoryId: 'default', examId: 'egzamin-testowy', attemptId: attempt.attemptId,
    revision: 1, operationId, questionId: attempt.questions[0].questionId, answer: 'forged-answer'
  }), studentContext());
  assert.equal(duplicate.statusCode, 200);
  assert.equal(bodyOf(duplicate).duplicate, true);
  assert.equal(bodyOf(duplicate).attempt.answers[attempt.questions[0].questionId], attempt.questions[0].options[0].answerId);
  attempt = bodyOf(duplicate).attempt;

  const conflict = await examFunction.handler(eventFor('POST', {
    action: 'autosave', repositoryId: 'default', examId: 'egzamin-testowy', attemptId: attempt.attemptId,
    revision: 1, operationId: 'operation-save-0002', questionId: attempt.questions[0].questionId, answer: 'forged-answer'
  }), studentContext());
  assert.equal(conflict.statusCode, 409);
  assert.equal(bodyOf(conflict).error, 'ATTEMPT_VERSION_CONFLICT');

  canonical = { id: USER_B, email: 'inny@example.com', app_metadata: { roles: ['active'] } };
  const foreign = await examFunction.handler(eventFor('GET', undefined, { action: 'attempt', repo: 'default', exam: 'egzamin-testowy', attemptId: attempt.attemptId }), studentContext());
  assert.equal(foreign.statusCode, 404);
  canonical = { id: USER_A, email: 'uczen@example.com', user_metadata: { full_name: 'Uczeń A' }, app_metadata: { roles: ['active'] } };

  const submitted = await examFunction.handler(eventFor('POST', {
    action: 'submit', repositoryId: 'default', examId: 'egzamin-testowy', attemptId: attempt.attemptId,
    revision: attempt.revision, operationId: 'operation-submit-1', force: false
  }), studentContext());
  assert.equal(submitted.statusCode, 200);
  assert.equal(bodyOf(submitted).result.scorePercent, 100);
  assert.equal(bodyOf(submitted).result.passed, true);
  assert.equal(Object.hasOwn(bodyOf(submitted).result, 'questions'), false);

  const limited = await examFunction.handler(eventFor('POST', { action: 'start', repositoryId: 'default', examId: 'egzamin-testowy', materialId: 'exam-card' }), studentContext());
  assert.equal(limited.statusCode, 409);
  assert.equal(bodyOf(limited).error, 'ATTEMPT_LIMIT_REACHED');

  currentDefinition = definition({ status: 'draft' });
  const draftStudent = await examFunction.handler(eventFor('GET', undefined, { repo: 'default', exam: 'egzamin-testowy' }), studentContext());
  assert.equal(draftStudent.statusCode, 404);
  canonical = { id: ADMIN, email: 'admin@example.com', app_metadata: { roles: ['admin'] } };
  const draftPreview = await examFunction.handler(eventFor('GET', undefined, { repo: 'default', exam: 'egzamin-testowy', preview: '1' }), studentContext());
  assert.equal(draftPreview.statusCode, 200);
  const progressBeforePreviewOpen = await progressStore.list({ prefix: 'users/' });
  const previewOpen = await examFunction.handler(eventFor('POST', {
    action: 'open', repositoryId: 'default', examId: 'egzamin-testowy', materialId: 'preview-only', preview: true
  }), studentContext());
  assert.equal(previewOpen.statusCode, 200);
  const progressAfterPreviewOpen = await progressStore.list({ prefix: 'users/' });
  assert.equal(progressAfterPreviewOpen.blobs.length, progressBeforePreviewOpen.blobs.length);

  currentDefinition = definition();
  canonical = { id: USER_A, email: 'uczen@example.com', app_metadata: { roles: ['active'] } };
  const progressEntry = await progressStore.getWithMetadata('users/MTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTEx.json');
  assert.ok(progressEntry);
  const progressDocument = JSON.parse(progressEntry.data);
  assert.equal(progressDocument.records['exam-card'].details.scorePercent, 100);
  assert.equal(progressDocument.records['exam-card'].status, 'completed');
  assert.equal(progressDocument.records['legacy-exam-card'].details.scorePercent, 100);
  assert.equal(progressDocument.records['legacy-exam-card'].status, 'completed');

  const legacyProgress = await examFunction.handler(eventFor('POST', {
    action: 'open', repositoryId: 'default', examId: 'egzamin-testowy', materialId: 'legacy-exam-card'
  }), studentContext());
  assert.equal(legacyProgress.statusCode, 200);
  const legacyProgressEntry = await progressStore.getWithMetadata('users/MTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTEx.json');
  assert.equal(JSON.parse(legacyProgressEntry.data).records['legacy-exam-card'].materialType, 'exam');

  canonical = { id: USER_B, email: 'feedback@example.com', app_metadata: { roles: ['active'] } };
  currentDefinition = definition({
    examId: 'feedback-test', attempts: { mode: 'unlimited' },
    resultVisibility: {
      feedbackMode: 'immediate', studentResultVisible: true, scorePercent: true, passFail: true,
      ownAnswers: true, correctAnswers: true, errors: true, explanations: true
    },
    questions: [question('single_choice', 'feedback', { explanation: 'Wyjaśnienie dostępne po zatwierdzeniu.' })]
  });
  const feedbackStart = await examFunction.handler(eventFor('POST', {
    action: 'start', repositoryId: 'default', examId: 'feedback-test'
  }), studentContext());
  let feedbackAttempt = bodyOf(feedbackStart).attempt;
  assert.deepEqual(feedbackAttempt.immediateFeedback, {});
  const feedbackQuestion = feedbackAttempt.questions[0];
  const confirmed = await examFunction.handler(eventFor('POST', {
    action: 'confirm-answer', repositoryId: 'default', examId: 'feedback-test', attemptId: feedbackAttempt.attemptId,
    revision: feedbackAttempt.revision, operationId: 'feedback-confirm-operation', questionId: feedbackQuestion.questionId,
    answers: { [feedbackQuestion.questionId]: feedbackQuestion.options[0].answerId }
  }), studentContext());
  assert.equal(confirmed.statusCode, 200);
  feedbackAttempt = bodyOf(confirmed).attempt;
  assert.deepEqual(feedbackAttempt.confirmedQuestionIds, [feedbackQuestion.questionId]);
  assert.equal(bodyOf(confirmed).feedback.correct, true);
  assert.deepEqual(bodyOf(confirmed).feedback.correctAnswerDisplay, ['A']);
  assert.equal(bodyOf(confirmed).feedback.explanation, 'Wyjaśnienie dostępne po zatwierdzeniu.');
  assert.doesNotMatch(JSON.stringify(bodyOf(confirmed).feedback), /correctAnswerIds|acceptedAnswers|correctNumber|correctOrder/);
  const overwriteConfirmed = await examFunction.handler(eventFor('POST', {
    action: 'autosave', repositoryId: 'default', examId: 'feedback-test', attemptId: feedbackAttempt.attemptId,
    revision: feedbackAttempt.revision, operationId: 'feedback-overwrite-operation', questionId: feedbackQuestion.questionId,
    answer: feedbackQuestion.options[1].answerId
  }), studentContext());
  assert.equal(overwriteConfirmed.statusCode, 409);
  assert.equal(bodyOf(overwriteConfirmed).error, 'ANSWER_ALREADY_CONFIRMED');

  canonical = { id: USER_B, email: 'inny@example.com', app_metadata: { roles: ['active'] } };
  currentDefinition = definition({ examId: 'timer-test', attempts: { mode: 'unlimited' }, timing: { mode: 'exam', limitSeconds: 60, display: 'hidden' } });
  const timerStart = await examFunction.handler(eventFor('POST', { action: 'start', repositoryId: 'default', examId: 'timer-test' }), studentContext());
  const timerAttempt = bodyOf(timerStart).attempt;
  const timerKey = examStorage.attemptKey('default', 'timer-test', USER_B, timerAttempt.attemptId);
  const timerEntry = await examStore.getWithMetadata(timerKey);
  const expired = JSON.parse(timerEntry.data); expired.expiresAt = '2020-01-01T00:00:00.000Z';
  await examStore.set(timerKey, JSON.stringify(expired), { onlyIfMatch: timerEntry.etag });
  const timedOut = await examFunction.handler(eventFor('GET', undefined, { action: 'attempt', repo: 'default', exam: 'timer-test', attemptId: timerAttempt.attemptId }), studentContext());
  assert.equal(bodyOf(timedOut).attempt.status, 'timed_out');

  currentDefinition = definition({
    examId: 'question-timer', attempts: { mode: 'unlimited' },
    questions: [question('single_choice', 'timer-1'), question('single_choice', 'timer-2'), question('single_choice', 'timer-3')],
    display: { mode: 'page', questionsPerPage: 2 }, navigation: { allowFreeNavigation: false },
    timing: { mode: 'question', questionLimitSeconds: 60, display: 'countdown' }
  });
  const questionTimerStart = await examFunction.handler(eventFor('POST', { action: 'start', repositoryId: 'default', examId: 'question-timer' }), studentContext());
  const questionTimerAttempt = bodyOf(questionTimerStart).attempt;
  const questionTimerKey = examStorage.attemptKey('default', 'question-timer', USER_B, questionTimerAttempt.attemptId);
  const questionTimerEntry = await examStore.getWithMetadata(questionTimerKey);
  const questionExpired = JSON.parse(questionTimerEntry.data);
  assert.equal(Object.keys(questionExpired.questionExpiresAt).length, 2);
  questionExpired.questionExpiresAt[questionExpired.questions[0].questionId] = '2020-01-01T00:00:00.000Z';
  await examStore.set(questionTimerKey, JSON.stringify(questionExpired), { onlyIfMatch: questionTimerEntry.etag });
  const lateAnswer = await examFunction.handler(eventFor('POST', {
    action: 'autosave', repositoryId: 'default', examId: 'question-timer', attemptId: questionTimerAttempt.attemptId,
    revision: questionTimerAttempt.revision, operationId: 'late-answer-operation', questionId: questionTimerAttempt.questions[0].questionId,
    answer: questionTimerAttempt.questions[0].options[0].answerId
  }), studentContext());
  assert.equal(lateAnswer.statusCode, 409);
  assert.equal(bodyOf(lateAnswer).error, 'QUESTION_TIME_EXPIRED');
  const nextTimedPage = await examFunction.handler(eventFor('POST', {
    action: 'navigate', repositoryId: 'default', examId: 'question-timer', attemptId: questionTimerAttempt.attemptId,
    revision: questionTimerAttempt.revision, operationId: 'next-timed-page', targetIndex: 2
  }), studentContext());
  assert.equal(nextTimedPage.statusCode, 200);
  assert.equal(bodyOf(nextTimedPage).attempt.currentIndex, 2);

  currentDefinition = definition({
    examId: 'batch-navigation', attempts: { mode: 'unlimited' },
    questions: [question('single_choice', 'batch-1'), question('single_choice', 'batch-2')],
    navigation: { allowFreeNavigation: false, allowSkip: false, requireAnswerBeforeNext: true }
  });
  const batchStart = await examFunction.handler(eventFor('POST', {
    action: 'start', repositoryId: 'default', examId: 'batch-navigation'
  }), studentContext());
  let batchAttempt = bodyOf(batchStart).attempt;
  const [batchFirst, batchSecond] = batchAttempt.questions;
  const lockedBatch = await examFunction.handler(eventFor('POST', {
    action: 'autosave-batch', repositoryId: 'default', examId: 'batch-navigation', attemptId: batchAttempt.attemptId,
    revision: batchAttempt.revision, operationId: 'batch-locked-operation',
    answers: {
      [batchFirst.questionId]: batchFirst.options[0].answerId,
      [batchSecond.questionId]: batchSecond.options[0].answerId
    }
  }), studentContext());
  assert.equal(lockedBatch.statusCode, 409);
  assert.equal(bodyOf(lockedBatch).error, 'QUESTION_NOT_UNLOCKED');
  const unchangedAfterRejectedBatch = await examStorage.readAttempt(
    examStore, 'default', 'batch-navigation', USER_B, batchAttempt.attemptId
  );
  assert.equal(unchangedAfterRejectedBatch.value.answers[batchFirst.questionId], undefined);
  const batchedNavigate = await examFunction.handler(eventFor('POST', {
    action: 'navigate', repositoryId: 'default', examId: 'batch-navigation', attemptId: batchAttempt.attemptId,
    revision: batchAttempt.revision, operationId: 'batch-navigate-operation', targetIndex: 1,
    answers: { [batchFirst.questionId]: batchFirst.options[0].answerId }
  }), studentContext());
  assert.equal(batchedNavigate.statusCode, 200);
  batchAttempt = bodyOf(batchedNavigate).attempt;
  assert.equal(batchAttempt.currentIndex, 1);
  assert.equal(batchAttempt.answers[batchFirst.questionId], batchFirst.options[0].answerId);
  const signal = await examFunction.handler(eventFor('POST', {
    action: 'event', repositoryId: 'default', examId: 'batch-navigation', attemptId: batchAttempt.attemptId,
    revision: batchAttempt.revision, operationId: 'batch-copy-signal', eventType: 'copy',
    details: { source: 'student_exam' }
  }), studentContext());
  assert.equal(signal.statusCode, 200);
  batchAttempt = bodyOf(signal).attempt;
  const batchSubmit = await examFunction.handler(eventFor('POST', {
    action: 'submit', repositoryId: 'default', examId: 'batch-navigation', attemptId: batchAttempt.attemptId,
    revision: batchAttempt.revision, operationId: 'batch-submit-operation', force: false,
    answers: { [batchSecond.questionId]: batchSecond.options[0].answerId }
  }), studentContext());
  assert.equal(batchSubmit.statusCode, 200);
  assert.equal(bodyOf(batchSubmit).result.scorePercent, 100);
  const storedBatch = await examStorage.readAttempt(examStore, 'default', 'batch-navigation', USER_B, batchAttempt.attemptId);
  assert.ok(storedBatch.value.events.some((entry) => entry.type === 'copy'));
  assert.ok(storedBatch.value.events.every((entry) => !['save_answer', 'change_question'].includes(entry.type)));
});

test('attempt strategies, display pages, cooldown and lesson references remain deterministic', async () => {
  const attempts = [
    { status: 'submitted', scorePercent: 40, submittedAt: '2026-01-01T10:00:00.000Z' },
    { status: 'submitted', scorePercent: 80, submittedAt: '2026-01-02T10:00:00.000Z' }
  ];
  assert.equal(examFunction._test.selectedAttemptResult(attempts, definition({ attempts: { resultStrategy: 'best' } })).scorePercent, 80);
  assert.equal(examFunction._test.selectedAttemptResult(attempts, definition({ attempts: { resultStrategy: 'first' } })).scorePercent, 40);
  assert.equal(examFunction._test.selectedAttemptResult(attempts, definition({ attempts: { resultStrategy: 'last' } })).scorePercent, 80);
  assert.equal(examFunction._test.selectedAttemptResult(attempts, definition({ attempts: { resultStrategy: 'average' } })).scorePercent, 60);
  assert.equal(examFunction._test.visibleEndIndex({ mode: 'one' }, 2, 9), 2);
  assert.equal(examFunction._test.visibleEndIndex({ mode: 'page', questionsPerPage: 3 }, 4, 9), 5);
  assert.equal(examFunction._test.visibleEndIndex({ mode: 'all' }, 0, 9), 8);
  assert.equal(examFunction._test.visibleStartIndex({ mode: 'page', questionsPerPage: 3 }, 4), 3);

  const store = new MemoryStore();
  const base = {
    repositoryId: 'default', examId: 'cooldown-test', userId: USER_A, profile: {},
    attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111', startedAt: '2026-01-01T10:00:00.000Z',
    expiresAt: null, totalQuestions: 1, allowResume: true, attemptsConfig: { mode: 'unlimited', cooldownSeconds: 3600 },
    now: Date.parse('2026-01-01T10:00:00.000Z')
  };
  await examStorage.reserveAttempt(store, base);
  const indexKey = examStorage.userExamKey('default', 'cooldown-test', USER_A);
  const entry = await store.getWithMetadata(indexKey);
  const index = JSON.parse(entry.data);
  index.attempts[0].status = 'submitted';
  index.attempts[0].submittedAt = '2026-01-01T10:10:00.000Z';
  await store.set(indexKey, JSON.stringify(index), { onlyIfMatch: entry.etag });
  const blocked = await examStorage.reserveAttempt(store, {
    ...base, attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-222222222222', startedAt: '2026-01-01T10:20:00.000Z', now: Date.parse('2026-01-01T10:20:00.000Z')
  });
  assert.equal(blocked.result.error, 'ATTEMPT_COOLDOWN');

  const refs = adminExamsFunction._test.lessonExamReferences([
    '```', ':::exam', 'repository: default', 'exam: ignored', ':::', '```',
    ':::exam', 'repository: chemia-2026', 'exam: alkohole-test', ':::'
  ].join('\n'));
  assert.deepEqual(refs, [{ repositoryId: 'chemia-2026', examId: 'alkohole-test' }]);
});

test('admin exam reports require fresh admin role and expose answer keys only to administrators', async (t) => {
  const examStore = new MemoryStore();
  const progressStore = new MemoryStore();
  await progressStore.set(CATALOG_KEY, JSON.stringify(progressCommon.normalizeCatalog({ nodes: [] })));
  adminExamsFunction._test.setExamStoreFactory(() => examStore);
  adminExamsFunction._test.setProgressStoreFactory(() => progressStore);
  const storedDefinition = examCommon.normalizeDefinition(definition(), 'egzamin-testowy');
  const now = new Date().toISOString();
  const rawQuestion = storedDefinition.questions[0];
  const attempt = {
    version: 1, revision: 1, attemptId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', number: 1,
    repositoryId: 'default', examId: 'egzamin-testowy', userId: USER_A, profile: { name: 'Uczeń A', email: 'a@example.com' },
    status: 'submitted', definitionSnapshot: storedDefinition, questions: [rawQuestion], answers: { [rawQuestion.questionId]: rawQuestion.correctAnswerIds[0] },
    flags: [], currentIndex: 0, highestReachedIndex: 0, startedAt: now, submittedAt: now, lastActivityAt: now,
    expiresAt: null, questionStartedAt: {}, questionExpiresAt: {}, timedOutQuestionIds: [], durationSeconds: 25,
    result: examCommon.gradeAttempt({ questions: [rawQuestion], answers: { [rawQuestion.questionId]: rawQuestion.correctAnswerIds[0] } }, storedDefinition),
    events: [
      { type: 'start', timestamp: now, index: 0 },
      { type: 'copy', timestamp: now, index: 0, details: { source: 'student_exam' } },
      { type: 'submit', timestamp: now, index: 0 }
    ], operationIds: []
  };
  await examStorage.createAttempt(examStore, attempt);
  await examStorage.syncAttemptIndexes(examStore, attempt, attempt.profile);

  const originalReadAsset = contentRepository.readAsset;
  contentRepository.readAsset = async () => ({ content: JSON.stringify(storedDefinition), sha: 'a'.repeat(40) });
  let canonical = { id: USER_A, email: 'a@example.com', app_metadata: { roles: ['active'] } };
  const originalFetch = global.fetch;
  global.fetch = async () => identityResponse(canonical);
  t.after(() => {
    global.fetch = originalFetch;
    contentRepository.readAsset = originalReadAsset;
    adminExamsFunction._test.setExamStoreFactory(null);
    adminExamsFunction._test.setProgressStoreFactory(null);
  });

  const denied = await adminExamsFunction.handler(eventFor('GET', undefined, { view: 'overview', repo: 'default', exam: 'egzamin-testowy' }), contextFor(canonical));
  assert.equal(denied.statusCode, 403);
  const deniedReview = await adminExamsFunction.handler(eventFor('GET', undefined, { view: 'review', repo: 'default', exam: 'egzamin-testowy' }), contextFor(canonical));
  assert.equal(deniedReview.statusCode, 403);
  canonical = { id: ADMIN, email: 'admin@example.com', app_metadata: { roles: ['admin'] } };
  const readKeys = [];
  const originalGet = examStore.getWithMetadata.bind(examStore);
  examStore.getWithMetadata = async (key, ...rest) => { readKeys.push(key); return originalGet(key, ...rest); };
  contentRepository.readAsset = async () => { throw new Error('Review must not read repository definitions'); };
  const review = await adminExamsFunction.handler(eventFor('GET', undefined, { view: 'review', repo: 'default', exam: 'egzamin-testowy' }), contextFor(canonical));
  assert.equal(review.statusCode, 200);
  assert.equal(bodyOf(review).attempts[0].userId, USER_A);
  assert.doesNotMatch(JSON.stringify(bodyOf(review)), /correctAnswer|answerKey|questionAnalysis|definitionSnapshot/);
  assert.ok(!readKeys.some((key) => key.startsWith('attempts/')), 'The queue reads only paged summaries, not full attempts');
  contentRepository.readAsset = async () => ({ content: JSON.stringify(storedDefinition), sha: 'a'.repeat(40) });
  const overview = await adminExamsFunction.handler(eventFor('GET', undefined, { view: 'overview', repo: 'default', exam: 'egzamin-testowy' }), contextFor(canonical));
  assert.equal(overview.statusCode, 200);
  assert.equal(bodyOf(overview).metrics.average, 100);
  assert.equal(bodyOf(overview).metrics.passRate, 100);
  assert.equal(bodyOf(overview).questionAnalysis.questions[0].correctPercent, 100);

  const detailed = await adminExamsFunction.handler(eventFor('GET', undefined, {
    view: 'attempt', repo: 'default', exam: 'egzamin-testowy', userId: USER_A, attemptId: attempt.attemptId
  }), contextFor(canonical));
  assert.equal(detailed.statusCode, 200);
  assert.deepEqual(bodyOf(detailed).attempt.questions[0].correctAnswerIds, rawQuestion.correctAnswerIds);
  assert.ok(bodyOf(detailed).attempt.events.some((entry) => entry.type === 'copy'));

  const reset = await adminExamsFunction.handler(eventFor('DELETE', {
    repositoryId: 'default', examId: 'egzamin-testowy', targetUserId: USER_A,
    attemptId: attempt.attemptId, operationId: 'admin-reset-operation-1'
  }), contextFor(canonical));
  assert.equal(reset.statusCode, 200);
  const after = await examStorage.readUserExamIndex(examStore, 'default', 'egzamin-testowy', USER_A);
  assert.equal(after.attempts[0].status, 'reset');
  const auditEntries = await progressStore.list({ prefix: 'audit/' });
  assert.equal(auditEntries.blobs.length, 1);
});

test('exam paths and GitHub media references reject traversal and unsafe extensions', () => {
  assert.throws(() => contentRepository.validateFilename('exam', '../sekret'), (error) => error.code === 'INVALID_CONTENT_FILENAME');
  assert.throws(() => contentRepository.validateFilename('exam', 'Exam-Z-Dużymi'), (error) => error.code === 'INVALID_CONTENT_FILENAME');
  assert.equal(examFunction._test.validateReference({ repositoryId: '../repo', examId: 'test' }).ok, false);
  assert.equal(examCommon.normalizeImage({ ref: 'photos/../../secret.png', alt: 'x' }), null);
  assert.equal(examCommon.normalizeImage({ ref: 'https://example.com/key.png', alt: 'x' }), null);
});

test('exam definitions use the existing GitHub client and a nested allowlisted path', async () => {
  const config = {
    id: 'default', label: 'Treści', default: true, configured: true,
    token: 'github_pat_test', repository: 'Kuczis-Media/content-private', ref: 'main', root: ''
  };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === 'PUT') {
      return new Response(JSON.stringify({ content: { sha: 'b'.repeat(40) }, commit: { sha: 'c'.repeat(40) } }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    if (String(url).includes('catalog.json')) {
      return new Response(JSON.stringify({ assets: { 'exams/egzamin-testowy/exam.json': { title: 'Próba działowa' } } }), { status: 200 });
    }
    if (/\/contents\/exams\/egzamin-testowy\/exam\.json(?:\?|$)/.test(String(url))) {
      return new Response(JSON.stringify({ type: 'file', name: 'exam.json', size: 2048, sha: 'd'.repeat(40) }), { status: 200 });
    }
    return new Response(JSON.stringify([
      { type: 'dir', name: 'egzamin-testowy', sha: 'a'.repeat(40) },
      { type: 'dir', name: 'folder-po-usunietym-egzaminie', sha: 'e'.repeat(40) },
      { type: 'file', name: 'sekret', size: 2 }
    ]), { status: 200 });
  };
  contentRepository._test.clearCache();
  const listed = await contentRepository.listAssets('exam', { config, fetchImpl });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].path, 'exams/egzamin-testowy/exam.json');
  assert.equal(listed[0].title, 'Próba działowa');
  assert.equal(listed[0].sha, 'd'.repeat(40));

  const saved = await contentRepository.saveAsset('exam', 'egzamin-testowy', JSON.stringify(definition()), { config, fetchImpl });
  assert.equal(saved.sha, 'b'.repeat(40));
  const mutation = requests.find((request) => request.options.method === 'PUT');
  assert.match(mutation.url, /\/contents\/exams\/egzamin-testowy\/exam\.json$/);
  const payload = JSON.parse(mutation.options.body);
  assert.equal(JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')).examId, 'egzamin-testowy');
  assert.doesNotMatch(mutation.options.body, /github_pat_test/);

  const duplicateBank = examCommon.validateQuestionBank({ questions: [question('single_choice', 'same'), question('single_choice', 'same')] });
  assert.ok(duplicateBank.errors.some((error) => error.code === 'DUPLICATE_QUESTION_ID'));
});
