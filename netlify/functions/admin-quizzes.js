'use strict';

const contentRepository = require('../content-repository.js');
const progressStorage = require('../progress-storage.js');
const quizStorage = require('../quiz-storage.js');
const { updateQuizProgress, setProgressStoreFactory } = require('../quiz-progress.js');
const { gradeQuiz } = require('../quiz-common.js');
const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

exports.handler = async function adminQuizzesHandler(event = {}, context = {}) {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: { Allow: 'GET, POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }, body: '' };
  if (!['GET', 'POST'].includes(method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, OPTIONS' });
  if (method === 'POST') {
    const guard = mutationGuard(event, { maxBodyBytes: 256 * 1024 });
    if (!guard.ok) return responseForFailure(guard);
  }
  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);
  try {
    return method === 'GET' ? await handleGet(event) : await handlePost(event, auth);
  } catch (error) {
    console.error('admin-quizzes failed', error?.name || 'Error');
    if (error instanceof contentRepository.ContentRepositoryError) return json({ error: error.code }, error.status);
    if (error?.code === 'EXAM_CONFLICT') return json({ error: 'QUIZ_CONFLICT' }, 409);
    return json({ error: 'QUIZ_REPORT_UNAVAILABLE' }, 503);
  }
};

async function handleGet(event) {
  const query = event.queryStringParameters || {};
  const allowed = new Set(['view', 'repo', 'quiz', 'attemptId', 'userId', 'limit', 'cursor']);
  if (Object.keys(query).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_QUERY' }, 400);
  const reference = validateReference(query);
  if (!reference.ok) return json({ error: reference.error }, 400);
  if (query.view === 'study') {
    if (query.cursor && !/^offset:\d{1,9}$/.test(query.cursor)) return json({ error: 'INVALID_REPORT_CURSOR' }, 400);
    return json(await require('../study-report').readReport(progressStorage.getProgressStore(), reference.repositoryId, reference.quizId, query.cursor));
  }
  const store = quizStorage.getQuizStore();
  if (query.view === 'attempt') {
    if (!safeIdentityId(query.userId) || !safeAttemptId(query.attemptId)) return json({ error: 'INVALID_ATTEMPT_REFERENCE' }, 400);
    const entry = await quizStorage.readAttempt(store, reference.repositoryId, reference.quizId, query.userId, query.attemptId);
    if (!entry) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
    return json({ attempt: adminAttempt(entry.value) });
  }
  if (query.view && query.view !== 'overview') return json({ error: 'INVALID_VIEW' }, 400);
  if (query.cursor && !/^offset:\d{1,9}$/.test(query.cursor)) return json({ error: 'INVALID_REPORT_CURSOR' }, 400);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 25));
  const report = await quizStorage.readReport(store, reference.repositoryId, reference.quizId, { limit, cursor: query.cursor });
  const attempts = Object.values(report.attempts || {})
    .filter((attempt) => attempt.status !== 'reset')
    .sort((left, right) => Date.parse(right.lastActivityAt || 0) - Date.parse(left.lastActivityAt || 0));
  return json({
    metrics: reportMetrics(attempts),
    attempts: attempts.slice(0, limit),
    cursor: report.cursor,
    metricsScope: report.metricsScope,
    truncated: Boolean(report.cursor),
    updatedAt: report.updatedAt
  });
}

async function handlePost(event, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const body = parsed.value;
  const allowed = new Set(['action', 'repositoryId', 'quizId', 'targetUserId', 'attemptId', 'operationId', 'revision', 'grades']);
  if (Object.keys(body).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_FIELDS' }, 400);
  if (body.action !== 'grade') return json({ error: 'INVALID_QUIZ_ACTION' }, 400);
  const reference = validateReference(body);
  if (!reference.ok) return json({ error: reference.error }, 400);
  if (!safeIdentityId(body.targetUserId) || !safeAttemptId(body.attemptId)) return json({ error: 'INVALID_ATTEMPT_REFERENCE' }, 400);
  const grades = validateGrades(body.grades);
  if (!grades.ok) return json({ error: grades.error }, 400);
  const store = quizStorage.getQuizStore();
  const outcome = await quizStorage.updateAttempt(store, {
    repositoryId: reference.repositoryId,
    quizId: reference.quizId,
    userId: body.targetUserId,
    attemptId: body.attemptId,
    expectedRevision: Number.isSafeInteger(body.revision) ? body.revision : null,
    operationId: safeOperationId(body.operationId) || `quiz-grade:${Date.now()}`,
    now: Date.now()
  }, (attempt) => applyGrades(attempt, grades.value, auth.userId));
  if (outcome.result?.error) return json({ error: outcome.result.error }, outcome.result.error === 'ATTEMPT_NOT_FOUND' ? 404 : 409);
  const attempt = outcome.result.attempt;
  const warnings = await syncGradeSideEffects(store, attempt, reference, auth);
  return json({ graded: true, attempt: adminAttempt(attempt), ...(warnings.length ? { warnings } : {}) });
}

async function syncGradeSideEffects(store, attempt, reference, auth) {
  const warnings = [];
  try {
    await quizStorage.syncAttemptIndexes(store, attempt, attempt.profile);
  } catch (error) {
    console.error('quiz grade index sync failed', error?.name || 'Error');
    warnings.push('INDEX_SYNC_PENDING');
  }
  try {
    await updateQuizProgress({
      userId: attempt.userId,
      user: { email: attempt.profile?.email || '', user_metadata: { full_name: attempt.profile?.name || '' } },
      repositoryId: reference.repositoryId,
      quizId: reference.quizId,
      materialId: attempt.materialId,
      details: {
        started: true,
        completed: true,
        scorePercent: attempt.result.percent ?? null,
        passed: attempt.result.passed ?? null,
        attempts: attempt.number,
        gradingStatus: attempt.result.gradingStatus,
        attemptId: attempt.attemptId
      }
    });
  } catch (error) {
    console.error('quiz grade progress sync failed', error?.name || 'Error');
    warnings.push('PROGRESS_SYNC_PENDING');
  }
  try {
    await progressStorage.appendAudit(progressStorage.getProgressStore(), {
      adminId: auth.userId,
      targetUserId: attempt.userId,
      action: 'quiz.attempt.grade',
      materialId: attempt.materialId || `quiz:${reference.repositoryId}:${reference.quizId}`,
      previousValue: null,
      newValue: { attemptId: attempt.attemptId, points: attempt.result.earned, maximum: attempt.result.maximum }
    });
  } catch (error) {
    console.error('quiz grade audit sync failed', error?.name || 'Error');
    warnings.push('AUDIT_SYNC_PENDING');
  }
  return warnings;
}

function applyGrades(attempt, grades, adminId) {
  if (!attempt || attempt.kind !== 'quiz' || attempt.status !== 'submitted') return { error: 'ATTEMPT_NOT_FINISHED' };
  const questions = new Map((attempt.questions || []).map((question) => [question.questionId, question]));
  const existing = new Map((attempt.result?.results || []).map((entry) => [entry.questionId, entry]));
  const aiGrades = Object.create(null);
  const manualGrades = Object.create(null);
  for (const question of attempt.questions || []) {
    if (!reviewableOpenQuestion(question)) continue;
    const grade = existing.get(question.questionId);
    if (!grade || grade.reviewStatus !== 'graded') continue;
    (question.gradingMode === 'manual' ? manualGrades : aiGrades)[question.questionId] = grade;
  }
  const gradedAt = new Date().toISOString();
  for (const grade of grades) {
    const question = questions.get(grade.questionId);
    if (!reviewableOpenQuestion(question)) return { error: 'QUESTION_NOT_REVIEWABLE' };
    (question.gradingMode === 'manual' ? manualGrades : aiGrades)[question.questionId] = {
      points: grade.points,
      feedback: grade.feedback,
      gradedBy: adminId,
      gradedAt
    };
  }
  attempt.result = gradeQuiz(attempt.definitionSnapshot, attempt.answers, { aiGrades, manualGrades });
  attempt.reviewedAt = gradedAt;
  attempt.reviewedBy = adminId;
  return { gradingStatus: attempt.result.gradingStatus };
}

function reportMetrics(attempts) {
  const graded = attempts.filter((attempt) => (
    attempt.scorePercent !== null && attempt.scorePercent !== '' && Number.isFinite(Number(attempt.scorePercent))
  ));
  const scores = graded.map((attempt) => Number(attempt.scorePercent));
  return {
    attempts: attempts.length,
    participants: new Set(attempts.map((attempt) => attempt.userId)).size,
    pendingReview: attempts.filter((attempt) => attempt.gradingStatus === 'pending_review').length,
    graded: graded.length,
    average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length * 100) / 100 : 0
  };
}

function adminAttempt(attempt) {
  return {
    attemptId: attempt.attemptId,
    revision: attempt.revision,
    number: attempt.number,
    repositoryId: attempt.repositoryId,
    quizId: attempt.quizId,
    userId: attempt.userId,
    profile: attempt.profile,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
    questions: attempt.questions,
    answers: attempt.answers,
    result: attempt.result
  };
}

function validateReference(value) {
  const quizId = String(value.quiz || value.quizId || '').trim().toLowerCase();
  const repositoryId = String(value.repo || value.repositoryId || 'default').trim().toLowerCase() || 'default';
  if (!SAFE_ID.test(quizId)) return { ok: false, error: 'INVALID_QUIZ_ID' };
  if (!SAFE_REPOSITORY_ID.test(repositoryId)) return { ok: false, error: 'INVALID_CONTENT_REPOSITORY' };
  return { ok: true, quizId, repositoryId };
}

function validateGrades(value) {
  if (!Array.isArray(value) || !value.length || value.length > 200) return { ok: false, error: 'INVALID_GRADES' };
  const result = [];
  const seen = new Set();
  for (const grade of value) {
    const questionId = typeof grade?.questionId === 'string' ? grade.questionId.trim() : '';
    const points = grade?.points;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(questionId) || seen.has(questionId)
      || typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > 10_000) return { ok: false, error: 'INVALID_GRADES' };
    seen.add(questionId);
    result.push({
      questionId,
      points: Math.round(points * 100) / 100,
      feedback: typeof grade.feedback === 'string' ? grade.feedback.replace(/\0/g, '').trim().slice(0, 2_000) : ''
    });
  }
  return { ok: true, value: result };
}

function safeIdentityId(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 128 && !/[\s/\\]/.test(value); }
function reviewableOpenQuestion(question) {
  return Boolean(question) && question.type === 'open'
    && question.gradingMode !== 'ungraded' && Number(question.points) > 0;
}
function safeAttemptId(value) { return typeof value === 'string' && /^[a-f0-9-]{20,64}$/i.test(value); }
function safeOperationId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(value) ? value : ''; }

exports._test = {
  adminAttempt,
  applyGrades,
  reportMetrics,
  syncGradeSideEffects,
  setProgressStoreFactory: (factory) => {
    progressStorage.setStoreFactory(factory);
    setProgressStoreFactory(factory);
  },
  setStoreFactory: quizStorage.setStoreFactory,
  validateGrades,
  validateReference
};
