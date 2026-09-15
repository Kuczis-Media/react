'use strict';

const {
  gradeAttempt,
  displayAnswer,
  displayCorrectAnswer,
  normalizeDefinition,
  SAFE_EXAM_ID,
  SAFE_REPOSITORY_ID
} = require('../exam-common.js');
const contentRepository = require('../content-repository.js');
const examStorage = require('../exam-storage.js');
const openAnswerGrader = require('../open-answer-grader.js');
const progressStorage = require('../progress-storage.js');
const { resetExamProgress, setProgressStoreFactory, updateExamProgress } = require('../exam-progress.js');
const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');

exports.handler = async function adminExamsHandler(event = {}, context = {}) {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') return emptyOptions();
  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, DELETE, OPTIONS' });
  }
  if (['POST', 'DELETE'].includes(method)) {
    const guard = mutationGuard(event, { maxBodyBytes: 32 * 1024 });
    if (!guard.ok) return responseForFailure(guard);
  }
  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);
  try {
    if (method === 'GET') return await handleGet(event);
    if (method === 'POST') return await handlePost(event, auth);
    return await handleDelete(event, auth);
  } catch (error) {
    console.error('admin-exams failed', error?.name || 'Error');
    if (error instanceof contentRepository.ContentRepositoryError) return json({ error: error.code }, error.status);
    if (error?.code === 'EXAM_CONFLICT') return json({ error: 'EXAM_CONFLICT' }, 409);
    if (error?.code === 'INVALID_REPORT_CURSOR') return json({ error: error.code }, 400);
    return json({ error: 'EXAM_STORAGE_UNAVAILABLE' }, 503);
  }
};

async function handleGet(event) {
  const query = event.queryStringParameters || {};
  const allowed = new Set(['view', 'repo', 'exam', 'attemptId', 'userId', 'limit', 'cursor']);
  if (Object.keys(query).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_QUERY' }, 400);
  const reference = validateReference(query);
  if (!reference.ok) return json({ error: reference.error }, 400);
  const view = String(query.view || 'overview');
  if (view === 'references') return json(await examReferences(reference));
  const store = examStorage.getExamStore();
  if (view === 'attempt') {
    if (!safeIdentityId(query.userId) || !safeAttemptId(query.attemptId)) return json({ error: 'INVALID_ATTEMPT_REFERENCE' }, 400);
    const entry = await examStorage.readAttempt(store, reference.repositoryId, reference.examId, query.userId, query.attemptId);
    if (!entry) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
    return json({ attempt: adminAttempt(entry.value) });
  }
  if (view === 'user') {
    if (!safeIdentityId(query.userId)) return json({ error: 'INVALID_USER_ID' }, 400);
    const index = await examStorage.readUserExamIndex(store, reference.repositoryId, reference.examId, query.userId);
    return json({ user: index });
  }
  if (!['overview', 'review'].includes(view)) return json({ error: 'INVALID_VIEW' }, 400);
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 25));
  const report = await examStorage.readReport(store, reference.repositoryId, reference.examId, { limit, cursor: query.cursor });
  const summaries = Object.values(report.attempts || {})
    .filter((attempt) => attempt.status !== 'reset')
    .sort((left, right) => Date.parse(right.lastActivityAt || 0) - Date.parse(left.lastActivityAt || 0));
  // The examiner's queue needs only summaries. Do not fetch the definition,
  // full answers or question analysis until a specific student is opened.
  if (view === 'review') return json({ attempts: summaries, cursor: report.cursor, updatedAt: report.updatedAt });
  const definition = await readDefinition(reference);
  const details = [];
  const selectedSummaries = summaries.slice(0, limit);
  for (let offset = 0; offset < selectedSummaries.length; offset += 4) {
    const batch = await Promise.all(selectedSummaries.slice(offset, offset + 4).map((summary) => (
      examStorage.readAttempt(store, reference.repositoryId, reference.examId, summary.userId, summary.attemptId)
    )));
    // Keep only bounded analysis fields, not every answer, event and full
    // question snapshot from all attempts in this page at once.
    batch.forEach((entry) => { if (entry) details.push({
      questions: (entry.value.questions || []).map((question) => ({
        questionId: question.questionId, type: question.type, prompt: String(question.prompt || '').slice(0, 500)
      })),
      result: { questionResults: (entry.value.result?.questionResults || []).map((result) => ({
        questionId: result.questionId, reviewStatus: result.reviewStatus, correct: result.correct, answerLabel: answerLabel(result.answer)
      })) }
    }); });
  }
  return json({
    exam: { examId: definition.examId, name: definition.metadata.name, status: definition.status },
    metrics: reportMetrics(summaries),
    participants: Object.values(report.participants || {}),
    attempts: summaries,
    questionAnalysis: analyzeQuestions(details),
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
  const allowed = new Set([
    'action', 'repositoryId', 'examId', 'targetUserId', 'attemptId',
    'operationId', 'revision', 'grades'
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_FIELDS' }, 400);
  if (!['grade', 'ai-grade'].includes(body.action)) return json({ error: 'INVALID_EXAM_ACTION' }, 400);
  const reference = validateReference(body);
  if (!reference.ok) return json({ error: reference.error }, 400);
  if (!safeIdentityId(body.targetUserId) || !safeAttemptId(body.attemptId)) {
    return json({ error: 'INVALID_ATTEMPT_REFERENCE' }, 400);
  }
  const store = examStorage.getExamStore();
  let outcome;
  let aiEvaluation = null;
  if (body.action === 'ai-grade') {
    const operationId = safeOperationId(body.operationId) || `admin-ai-grade:${Date.now()}`;
    const expectedRevision = Number.isSafeInteger(body.revision) ? body.revision : null;
    const entry = await examStorage.readAttempt(
      store, reference.repositoryId, reference.examId, body.targetUserId, body.attemptId
    );
    if (!entry) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
    if (Array.isArray(entry.value.operationIds) && entry.value.operationIds.includes(operationId)) {
      const warnings = await syncGradeSideEffects(store, entry.value, reference, auth, body.action, { audit: false });
      return json({
        graded: true,
        duplicate: true,
        attempt: adminAttempt(entry.value),
        aiGradedCount: 0,
        aiPendingCount: entry.value.result?.pendingQuestionIds?.length || 0,
        ...(warnings.length ? { warnings } : {})
      });
    }
    if (!['submitted', 'timed_out'].includes(entry.value.status)) {
      return json({ error: 'ATTEMPT_NOT_FINISHED' }, 409);
    }
    // Reject a stale report before contacting the provider. This avoids paying
    // for an AI evaluation that could not be committed afterwards anyway.
    if (expectedRevision != null && Number(entry.value.revision || 0) !== expectedRevision) {
      return json({ error: 'ATTEMPT_VERSION_CONFLICT', attempt: adminAttempt(entry.value) }, 409);
    }
    const pendingAiQuestions = pendingAiReviewQuestions(entry.value);
    if (!pendingAiQuestions.length) return json({ error: 'NO_AI_ANSWERS_TO_GRADE' }, 409);
    aiEvaluation = await openAnswerGrader.evaluateAiQuestions(
      pendingAiQuestions,
      entry.value.answers,
      { userId: auth.userId }
    );
    if (!Object.keys(aiEvaluation.grades).length) {
      return json({
        error: aiEvaluation.errorCode || 'AI_GRADING_INVALID_RESPONSE',
        pendingQuestionCount: pendingAiQuestions.length
      }, 503);
    }
    outcome = await examStorage.updateAttempt(store, {
      repositoryId: reference.repositoryId,
      examId: reference.examId,
      userId: body.targetUserId,
      attemptId: body.attemptId,
      operationId,
      expectedRevision,
      now: Date.now()
    }, (attempt) => applyAiGrades(attempt, aiEvaluation.grades, auth));
  } else {
    const grades = validateGrades(body.grades);
    if (!grades.ok) return json({ error: grades.error }, 400);
    outcome = await examStorage.updateAttempt(store, {
      repositoryId: reference.repositoryId,
      examId: reference.examId,
      userId: body.targetUserId,
      attemptId: body.attemptId,
      operationId: safeOperationId(body.operationId) || `admin-grade:${Date.now()}`,
      expectedRevision: Number.isSafeInteger(body.revision) ? body.revision : null,
      now: Date.now()
    }, (attempt) => applyManualGrades(attempt, grades.value, auth));
  }
  if (outcome.result?.error) {
    const notFound = outcome.result.error === 'ATTEMPT_NOT_FOUND';
    return json({ error: outcome.result.error, attempt: outcome.result.attempt }, notFound ? 404 : 409);
  }
  const attempt = outcome.result?.attempt;
  const warnings = await syncGradeSideEffects(store, attempt, reference, auth, body.action);
  return json({
    graded: true,
    attempt: adminAttempt(attempt),
    ...(aiEvaluation ? {
      aiGradedCount: Object.keys(aiEvaluation.grades).length,
      aiPendingCount: attempt.result?.pendingQuestionIds?.length || 0
    } : {}),
    ...(warnings.length ? { warnings } : {})
  });
}

async function syncGradeSideEffects(store, attempt, reference, auth, action, options = {}) {
  const warnings = [];
  try {
    await examStorage.syncAttemptIndexes(store, attempt, attempt.profile);
    const index = await examStorage.readUserExamIndex(
      store, reference.repositoryId, reference.examId, attempt.userId, attempt.profile
    );
    const finished = (index.attempts || [])
      .filter((entry) => ['submitted', 'timed_out'].includes(entry.status) && hasNumericScore(entry.scorePercent))
      .sort((left, right) => Date.parse(left.submittedAt || 0) - Date.parse(right.submittedAt || 0));
    const selectedScore = selectedScorePercent(finished, attempt.definitionSnapshot.attempts.resultStrategy);
    await updateExamProgress({
      userId: attempt.userId,
      user: { email: attempt.profile?.email || '', user_metadata: { full_name: attempt.profile?.name || '' } },
      repositoryId: reference.repositoryId,
      examId: reference.examId,
      materialId: attempt.materialId,
      action: 'exam',
      opened: true,
      details: {
        started: true,
        completed: true,
        attemptId: attempt.attemptId,
        attempts: (index.attempts || []).filter((entry) => entry.status !== 'reset' && !entry.resetAt).length,
        answeredQuestions: Object.keys(attempt.answers || {}).length,
        totalQuestions: attempt.questions.length,
        scorePercent: selectedScore,
        passed: selectedScore == null ? null : selectedScore >= attempt.definitionSnapshot.metadata.passThreshold,
        durationSeconds: attempt.durationSeconds,
        gradingStatus: attempt.result?.gradingStatus
      }
    });
  } catch (error) {
    console.error('exam grade index/progress sync failed', error?.name || 'Error');
    warnings.push('INDEX_OR_PROGRESS_SYNC_PENDING');
  }
  if (options.audit !== false) {
    try {
      await progressStorage.appendAudit(progressStorage.getProgressStore(), {
        adminId: auth.userId,
        targetUserId: attempt.userId,
        action: action === 'ai-grade' ? 'exam.attempt.ai-grade' : 'exam.attempt.grade',
        materialId: attempt.materialId || `exam:${reference.repositoryId}:${reference.examId}`,
        previousValue: null,
        newValue: {
          attemptId: attempt.attemptId,
          gradingStatus: attempt.result?.gradingStatus,
          points: attempt.result?.points,
          maxPoints: attempt.result?.maxPoints
        }
      });
    } catch (error) {
      console.error('exam grade audit sync failed', error?.name || 'Error');
      warnings.push('AUDIT_SYNC_PENDING');
    }
  }
  return warnings;
}

function applyManualGrades(attempt, grades, auth) {
  if (!attempt || !['submitted', 'timed_out'].includes(attempt.status)) return { error: 'ATTEMPT_NOT_FINISHED' };
  const questions = new Map((attempt.questions || []).map((question) => [question.questionId, question]));
  const { aiGrades, manualGrades } = resolvedGradeMaps(attempt);
  const reviewedAt = new Date().toISOString();
  for (const grade of grades) {
    const question = questions.get(grade.questionId);
    if (!reviewableOpenQuestion(question)) {
      return { error: 'QUESTION_NOT_REVIEWABLE' };
    }
    const target = question.gradingMode === 'manual' ? manualGrades : aiGrades;
    target[grade.questionId] = {
      points: grade.points,
      feedback: grade.feedback,
      gradedBy: auth.userId,
      gradedAt: reviewedAt
    };
  }
  attempt.result = gradeAttempt(attempt, attempt.definitionSnapshot, { aiGrades, manualGrades });
  attempt.reviewedAt = reviewedAt;
  attempt.reviewedBy = auth.userId;
  attempt.reviewRevision = Number(attempt.reviewRevision || 0) + 1;
  return { gradingStatus: attempt.result.gradingStatus };
}

function applyAiGrades(attempt, grades, auth) {
  if (!attempt || !['submitted', 'timed_out'].includes(attempt.status)) return { error: 'ATTEMPT_NOT_FINISHED' };
  const questions = new Map((attempt.questions || []).map((question) => [question.questionId, question]));
  const { aiGrades, manualGrades } = resolvedGradeMaps(attempt);
  let applied = 0;
  for (const [questionId, grade] of Object.entries(grades || {})) {
    const question = questions.get(questionId);
    if (!reviewableOpenQuestion(question) || question.gradingMode !== 'ai') continue;
    aiGrades[questionId] = grade;
    applied += 1;
  }
  if (!applied) return { error: 'NO_AI_ANSWERS_TO_GRADE' };
  const reviewedAt = new Date().toISOString();
  attempt.result = gradeAttempt(attempt, attempt.definitionSnapshot, { aiGrades, manualGrades });
  attempt.reviewedAt = reviewedAt;
  attempt.reviewedBy = auth.userId;
  attempt.reviewRevision = Number(attempt.reviewRevision || 0) + 1;
  return { gradingStatus: attempt.result.gradingStatus, aiGradedCount: applied };
}

function resolvedGradeMaps(attempt) {
  const existing = new Map((attempt.result?.questionResults || []).map((entry) => [entry.questionId, entry]));
  const aiGrades = Object.create(null);
  const manualGrades = Object.create(null);
  for (const question of attempt.questions || []) {
    if (!reviewableOpenQuestion(question)) continue;
    const grade = existing.get(question.questionId);
    if (!grade || grade.reviewStatus !== 'graded') continue;
    (question.gradingMode === 'manual' ? manualGrades : aiGrades)[question.questionId] = grade;
  }
  return { aiGrades, manualGrades };
}

function pendingAiReviewQuestions(attempt) {
  const results = new Map((attempt?.result?.questionResults || []).map((entry) => [entry.questionId, entry]));
  return (attempt?.questions || []).filter((question) => {
    if (!reviewableOpenQuestion(question) || question.gradingMode !== 'ai') return false;
    if (!openAnswerGrader.answerPresent(
      attempt.answers && Object.hasOwn(attempt.answers, question.questionId) ? attempt.answers[question.questionId] : null
    )) return false;
    return results.get(question.questionId)?.reviewStatus !== 'graded';
  });
}

function validateGrades(value) {
  if (!Array.isArray(value) || !value.length || value.length > 500) return { ok: false, error: 'INVALID_GRADES' };
  const result = [];
  const seen = new Set();
  for (const grade of value) {
    const questionId = typeof grade?.questionId === 'string' ? grade.questionId.trim() : '';
    const points = grade?.points;
    const feedback = typeof grade?.feedback === 'string' ? grade.feedback.replace(/\0/g, '').trim().slice(0, 2_000) : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(questionId) || seen.has(questionId)
      || typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > 10_000) {
      return { ok: false, error: 'INVALID_GRADES' };
    }
    seen.add(questionId);
    result.push({ questionId, points: Math.round(points * 100) / 100, feedback });
  }
  return { ok: true, value: result };
}

async function handleDelete(event, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const body = parsed.value;
  const allowed = new Set(['repositoryId', 'examId', 'targetUserId', 'attemptId', 'operationId']);
  if (Object.keys(body).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_FIELDS' }, 400);
  const reference = validateReference(body);
  if (!reference.ok) return json({ error: reference.error }, 400);
  if (!safeIdentityId(body.targetUserId) || !safeAttemptId(body.attemptId)) {
    return json({ error: 'INVALID_ATTEMPT_REFERENCE' }, 400);
  }
  const store = examStorage.getExamStore();
  const outcome = await examStorage.softResetAttempt(store, {
    repositoryId: reference.repositoryId,
    examId: reference.examId,
    userId: body.targetUserId,
    attemptId: body.attemptId,
    operationId: safeOperationId(body.operationId) || `admin-reset:${Date.now()}`,
    adminId: auth.userId,
    now: Date.now()
  });
  if (outcome.result?.error) {
    return json({ error: outcome.result.error }, outcome.result.error === 'ATTEMPT_NOT_FOUND' ? 404 : 409);
  }
  const reset = await resetExamProgress({
    repositoryId: reference.repositoryId,
    examId: reference.examId,
    userId: body.targetUserId
  });
  const [index, definition] = await Promise.all([
    examStorage.readUserExamIndex(store, reference.repositoryId, reference.examId, body.targetUserId),
    readDefinition(reference)
  ]);
  const remaining = (index.attempts || []).filter((entry) => entry.status !== 'reset' && !entry.resetAt);
  const finished = remaining
    .filter((entry) => ['submitted', 'timed_out'].includes(entry.status) && hasNumericScore(entry.scorePercent))
    .sort((left, right) => Date.parse(left.submittedAt || 0) - Date.parse(right.submittedAt || 0));
  if (remaining.length) {
    const latest = remaining.slice().sort((left, right) => Date.parse(right.lastActivityAt || 0) - Date.parse(left.lastActivityAt || 0))[0];
    const selectedScore = selectedScorePercent(finished, definition.attempts.resultStrategy);
    await updateExamProgress({
      userId: body.targetUserId,
      user: { email: index.profile?.email || '', user_metadata: { full_name: index.profile?.name || '' } },
      repositoryId: reference.repositoryId,
      examId: reference.examId,
      action: 'exam',
      opened: true,
      details: {
        started: true,
        completed: finished.length > 0,
        attemptId: latest.attemptId,
        attempts: remaining.length,
        answeredQuestions: latest.answeredCount,
        totalQuestions: latest.totalQuestions,
        scorePercent: selectedScore,
        passed: selectedScore == null ? undefined : selectedScore >= definition.metadata.passThreshold,
        durationSeconds: latest.durationSeconds
      }
    });
  }
  const progressStore = progressStorage.getProgressStore();
  await progressStorage.appendAudit(progressStore, {
    adminId: auth.userId,
    targetUserId: body.targetUserId,
    action: 'exam.attempt.reset',
    materialId: `exam:${reference.repositoryId}:${reference.examId}`,
    previousValue: outcome.result?.previous || null,
    newValue: { attemptId: body.attemptId, status: 'reset', progressRecordsRemoved: reset.materialIds }
  });
  return json({ reset: true, attemptId: body.attemptId, progress: reset });
}

async function readDefinition(reference) {
  const asset = await contentRepository.readAsset('exam', reference.examId, { repositoryId: reference.repositoryId });
  return normalizeDefinition(JSON.parse(asset.content), reference.examId);
}

async function examReferences(reference) {
  const catalog = await progressStorage.readCatalog(progressStorage.getProgressStore());
  const places = catalog.nodes
    .filter((node) => node.type === 'exam'
      && node.settings.examId === reference.examId
      && (node.settings.repositoryId || 'default') === reference.repositoryId)
    .map((node) => ({ materialId: node.id, title: node.title, parentId: node.parentId, source: 'dashboard' }));
  let lessonScanComplete = true;
  try {
    const lessons = await contentRepository.listAssets('lesson', { repositoryId: reference.repositoryId });
    for (let offset = 0; offset < lessons.length; offset += 10) {
      const batch = await Promise.all(lessons.slice(offset, offset + 10).map(async (lesson) => {
        try {
          const asset = await contentRepository.readAsset('lesson', lesson.filename, { repositoryId: reference.repositoryId });
          return lessonExamReferences(asset.content).some((entry) => (
            entry.examId === reference.examId && entry.repositoryId === reference.repositoryId
          )) ? lesson : null;
        } catch (_) {
          lessonScanComplete = false;
          return null;
        }
      }));
      batch.filter(Boolean).forEach((lesson) => places.push({
        materialId: `lesson:${lesson.filename}`,
        title: lesson.title || lesson.filename,
        filename: lesson.filename,
        source: 'lesson'
      }));
    }
  } catch (_) {
    lessonScanComplete = false;
  }
  return {
    references: places,
    count: places.length,
    note: lessonScanComplete
      ? 'Sprawdzono opublikowany Dashboard i wszystkie lekcje w wybranym repozytorium.'
      : 'Sprawdzono Dashboard, ale co najmniej jednego pliku lekcji nie udało się odczytać. Przed usunięciem sprawdź jego odwołania ręcznie.'
  };
}

function lessonExamReferences(markdown) {
  const result = [];
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  let fence = '';
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = '';
      continue;
    }
    if (fence || !/^\s*:::exam\s*$/i.test(lines[index])) continue;
    const values = {};
    for (index += 1; index < lines.length && !/^\s*:::\s*$/.test(lines[index]); index += 1) {
      const field = lines[index].match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/i);
      if (field) values[field[1].toLowerCase()] = field[2];
    }
    const repositoryId = SAFE_REPOSITORY_ID.test(values.repository || '') ? values.repository : 'default';
    if (SAFE_EXAM_ID.test(values.exam || '')) result.push({ repositoryId, examId: values.exam });
  }
  return result;
}

function reportMetrics(summaries) {
  const finished = summaries.filter((attempt) => ['submitted', 'timed_out'].includes(attempt.status) && hasNumericScore(attempt.scorePercent));
  const scores = finished.map((attempt) => Number(attempt.scorePercent)).sort((a, b) => a - b);
  const durations = finished.map((attempt) => Number(attempt.durationSeconds)).filter(Number.isFinite);
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const median = scores.length ? (scores[Math.floor((scores.length - 1) / 2)] + scores[Math.ceil((scores.length - 1) / 2)]) / 2 : 0;
  const distribution = { '0-25': 0, '25-50': 0, '50-75': 0, '75-100': 0 };
  scores.forEach((score) => {
    const key = score < 25 ? '0-25' : score < 50 ? '25-50' : score < 75 ? '50-75' : '75-100';
    distribution[key] += 1;
  });
  return {
    participants: new Set(summaries.map((attempt) => attempt.userId)).size,
    attempts: summaries.length,
    completedAttempts: finished.length,
    pendingReview: summaries.filter((attempt) => attempt.gradingStatus === 'pending_review').length,
    average: round(average(scores)),
    median: round(median),
    minimum: scores.length ? round(scores[0]) : 0,
    maximum: scores.length ? round(scores.at(-1)) : 0,
    averageTimeSeconds: round(average(durations)),
    passRate: finished.length ? round((finished.filter((attempt) => attempt.passed).length / finished.length) * 100) : 0,
    distribution
  };
}

function analyzeQuestions(attempts) {
  const stats = new Map();
  for (const attempt of attempts) {
    const resultById = new Map((attempt.result?.questionResults || []).map((result) => [result.questionId, result]));
    for (const question of attempt.questions || []) {
      const result = resultById.get(question.questionId);
      if (!result || ['pending', 'not_scored'].includes(result.reviewStatus)) continue;
      const entry = stats.get(question.questionId) || {
        questionId: question.questionId,
        prompt: question.prompt,
        type: question.type,
        answerCount: 0,
        correct: 0,
        incorrect: 0,
        distribution: {},
        wrongDistribution: {}
      };
      entry.answerCount += 1;
      if (result.correct) entry.correct += 1;
      else entry.incorrect += 1;
      const key = result.answerLabel ?? answerLabel(result.answer);
      entry.distribution[key] = (entry.distribution[key] || 0) + 1;
      if (!result.correct && key !== 'Brak odpowiedzi') {
        entry.wrongDistribution[key] = (entry.wrongDistribution[key] || 0) + 1;
      }
      stats.set(question.questionId, entry);
    }
  }
  const items = [...stats.values()].map((entry) => {
    const wrong = Object.entries(entry.wrongDistribution).sort((a, b) => b[1] - a[1])[0] || null;
    delete entry.wrongDistribution;
    return {
      ...entry,
      correctPercent: entry.answerCount ? round((entry.correct / entry.answerCount) * 100) : 0,
      incorrectPercent: entry.answerCount ? round((entry.incorrect / entry.answerCount) * 100) : 0,
      commonDistractor: wrong ? { answer: wrong[0], count: wrong[1] } : null
    };
  });
  return {
    questions: items,
    easiest: [...items].sort((a, b) => b.correctPercent - a.correctPercent).slice(0, 10),
    hardest: [...items].sort((a, b) => a.correctPercent - b.correctPercent).slice(0, 10)
  };
}

function selectedScorePercent(finished, strategy) {
  if (!finished.length) return null;
  if (strategy === 'first') return Number(finished[0].scorePercent);
  if (strategy === 'last') return Number(finished.at(-1).scorePercent);
  if (strategy === 'average') {
    return round(finished.reduce((sum, entry) => sum + Number(entry.scorePercent), 0) / finished.length);
  }
  return Math.max(...finished.map((entry) => Number(entry.scorePercent)));
}

function adminAttempt(attempt) {
  return {
    attemptId: attempt.attemptId,
    revision: attempt.revision,
    number: attempt.number,
    repositoryId: attempt.repositoryId,
    examId: attempt.examId,
    userId: attempt.userId,
    profile: attempt.profile,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    durationSeconds: attempt.durationSeconds,
    questions: attempt.questions.map((question) => ({
      ...question,
      answerDisplay: displayAnswer(question, attempt.answers?.[question.questionId]),
      correctAnswerDisplay: question.type === 'open_answer'
        ? (question.answerKey ? [question.answerKey] : []) : displayCorrectAnswer(question)
    })),
    answers: attempt.answers,
    result: attempt.result,
    order: attempt.questions.map((question) => question.questionId),
    events: attempt.events
  };
}

function answerLabel(answer) {
  if (answer == null || answer === '') return 'Brak odpowiedzi';
  if (typeof answer === 'string' || typeof answer === 'number') return String(answer).slice(0, 160);
  try { return JSON.stringify(answer).slice(0, 300); } catch { return 'Odpowiedź złożona'; }
}

function validateReference(value) {
  const examId = String(value.exam || value.examId || '').trim().toLowerCase();
  const repositoryId = String(value.repo || value.repositoryId || 'default').trim().toLowerCase() || 'default';
  if (!SAFE_EXAM_ID.test(examId)) return { ok: false, error: 'INVALID_EXAM_ID' };
  if (!SAFE_REPOSITORY_ID.test(repositoryId)) return { ok: false, error: 'INVALID_CONTENT_REPOSITORY' };
  return { ok: true, examId, repositoryId };
}

function safeIdentityId(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 && !/[\s/\\]/.test(value);
}

function safeAttemptId(value) {
  return typeof value === 'string' && /^[a-f0-9-]{20,64}$/i.test(value);
}

function safeOperationId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(value) ? value : '';
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function hasNumericScore(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}

function reviewableOpenQuestion(question) {
  return Boolean(question) && question.type === 'open_answer'
    && question.gradingMode !== 'ungraded' && Number(question.points) > 0;
}

function emptyOptions() {
  return { statusCode: 204, headers: { Allow: 'GET, POST, DELETE, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }, body: '' };
}

exports._test = {
  adminAttempt,
  applyAiGrades,
  applyManualGrades,
  analyzeQuestions,
  lessonExamReferences,
  reportMetrics,
  pendingAiReviewQuestions,
  selectedScorePercent,
  syncGradeSideEffects,
  validateGrades,
  setExamStoreFactory: examStorage.setStoreFactory,
  setProgressStoreFactory: (factory) => {
    progressStorage.setStoreFactory(factory);
    setProgressStoreFactory(factory);
  },
  validateReference
};
