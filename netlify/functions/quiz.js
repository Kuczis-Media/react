'use strict';

const crypto = require('node:crypto');
const contentRepository = require('../content-repository.js');
const openAnswerGrader = require('../open-answer-grader.js');
const quizStorage = require('../quiz-storage.js');
const { updateQuizProgress } = require('../quiz-progress.js');
const { gradeQuiz, publicDefinition, validateDefinition } = require('../quiz-common.js');
const practice = require('../../public/assets/js/quiz-practice.js');
const {
  json,
  mutationGuard,
  parseJsonBody,
  requireCourseAccess,
  responseForFailure
} = require('../admin-common.js');

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

exports.handler = async function quizHandler(event = {}, context = {}) {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        Vary: 'Origin'
      },
      body: ''
    };
  }
  if (!['GET', 'POST'].includes(method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, OPTIONS' });
  if (method === 'POST') {
    const guard = mutationGuard(event, { maxBodyBytes: 512 * 1024 });
    if (!guard.ok) return responseForFailure(guard);
  }
  const auth = await requireCourseAccess(event, context);
  if (!auth.ok) return responseForFailure(auth);
  if (method === 'POST') return handleSubmit(event, auth);
  const query = event.queryStringParameters || {};
  const allowed = new Set(['repo', 'quiz', 'preview', 'action', 'attemptId']);
  if (Object.keys(query).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_QUERY' }, 400);
  const quizId = String(query.quiz || '').trim().toLowerCase();
  const repositoryId = String(query.repo || 'default').trim().toLowerCase() || 'default';
  const preview = query.preview === '1';
  if (!SAFE_ID.test(quizId) || !SAFE_REPOSITORY_ID.test(repositoryId)) {
    return json({ error: 'INVALID_QUIZ_REFERENCE' }, 400);
  }
  if (preview && !auth.roles.includes('admin')) return json({ error: 'ADMIN_REQUIRED' }, 403);
  try {
    if (query.action === 'result') {
      if (!safeAttemptId(query.attemptId)) return json({ error: 'INVALID_ATTEMPT_ID' }, 400);
      const entry = await quizStorage.readAttempt(
        quizStorage.getQuizStore(), repositoryId, quizId, auth.userId, query.attemptId
      );
      if (!entry) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
      return json({ result: studentResult(entry.value.result, entry.value.definitionSnapshot) });
    }
    if (query.action && query.action !== 'definition') return json({ error: 'INVALID_QUIZ_ACTION' }, 400);
    const { asset, definition } = await readQuiz(repositoryId, quizId);
    if (definition.metadata.status !== 'published' && !preview) return json({ error: 'QUIZ_NOT_PUBLISHED' }, 404);
    if (definition.mode === 'deck' && definition.metadata.active === false && !preview) return json({ error: 'QUIZ_NOT_ACTIVE' }, 404);
    if (definition.mode === 'deck' && !preview) await require('../study-access').assertAccess(auth, definition, asset.repositoryId || repositoryId);
    let latestAttempt = null;
    if (!preview && definition.questions.some((question) => question.type === 'open')) {
      try {
        const store = quizStorage.getQuizStore();
        const index = await quizStorage.readUserQuizIndex(
          store, repositoryId, quizId, auth.userId,
          { email: String(auth.user?.email || ''), name: String(auth.user?.user_metadata?.full_name || '') }
        );
        let latest = (index.attempts || [])
          .filter((attempt) => attempt.status !== 'reset' && !attempt.resetAt)
          .sort((left, right) => Date.parse(right.lastActivityAt || 0) - Date.parse(left.lastActivityAt || 0))[0];
        // A submission is authoritative even if its secondary-index update
        // failed. Repair only the stale active marker, avoiding writes during
        // ordinary definition reads.
        if (latest?.status === 'active') {
          const stored = await quizStorage.readAttempt(
            store, repositoryId, quizId, auth.userId, latest.attemptId
          );
          if (stored?.value && stored.value.status !== 'active') {
            await syncStoredAttempt(store, stored.value, auth);
            latest = {
              ...latest,
              attemptId: stored.value.attemptId,
              number: stored.value.number,
              status: stored.value.status,
              gradingStatus: stored.value.result?.gradingStatus || null,
              lastActivityAt: stored.value.lastActivityAt
            };
          }
        }
        if (latest) latestAttempt = {
          attemptId: latest.attemptId,
          number: latest.number,
          status: latest.status,
          gradingStatus: latest.gradingStatus || null
        };
      } catch (error) {
        console.error('quiz latest attempt lookup failed', error?.name || 'Error');
      }
    }
    return json({
      quiz: publicDefinition(definition), repositoryId: asset.repositoryId || repositoryId,
      sha: preview ? asset.sha : undefined,
      ...(latestAttempt ? { latestAttempt } : {})
    });
  } catch (error) {
    const status = error instanceof contentRepository.ContentRepositoryError ? error.status : error?.code === 'SEQUENCE_LOCKED' ? 409 : 503;
    const code = error instanceof contentRepository.ContentRepositoryError
      ? error.code
      : error?.code === 'SEQUENCE_LOCKED' ? 'SEQUENCE_LOCKED' : error instanceof SyntaxError ? 'QUIZ_FILE_INVALID' : 'CONTENT_REPOSITORY_UNAVAILABLE';
    return json({ error: code }, code === 'QUIZ_FILE_INVALID' ? 422 : status);
  }
};

async function handleSubmit(event, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const body = parsed.value;
  const allowed = new Set(['action', 'repositoryId', 'quizId', 'answers', 'materialId', 'preview']);
  if (Object.keys(body).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_FIELDS' }, 400);
  if (body.action !== 'submit') return json({ error: 'INVALID_QUIZ_ACTION' }, 400);
  const quizId = String(body.quizId || '').trim().toLowerCase();
  const repositoryId = String(body.repositoryId || 'default').trim().toLowerCase() || 'default';
  if (!SAFE_ID.test(quizId) || !SAFE_REPOSITORY_ID.test(repositoryId)) return json({ error: 'INVALID_QUIZ_REFERENCE' }, 400);
  if (!plainObject(body.answers) || Object.keys(body.answers).length > 200) return json({ error: 'INVALID_QUIZ_ANSWERS' }, 400);
  const preview = body.preview === true;
  if (preview && !auth.roles.includes('admin')) return json({ error: 'ADMIN_REQUIRED' }, 403);
  try {
    const { definition } = await readQuiz(repositoryId, quizId);
    if (definition.metadata.status !== 'published' && !preview) return json({ error: 'QUIZ_NOT_PUBLISHED' }, 404);
    if (definition.mode === 'deck' && definition.metadata.active === false && !preview) return json({ error: 'QUIZ_NOT_ACTIVE' }, 404);
    const answers = sanitizeAnswers(definition, body.answers);
    if (!answers.ok) return json({ error: answers.error }, 400);
    const missing = definition.questions.filter((question) => question.required
      && !answerPresent(Object.hasOwn(answers.value, question.questionId) ? answers.value[question.questionId] : null));
    if (missing.length) return json({ error: 'QUIZ_ANSWERS_REQUIRED', count: missing.length }, 400);
    const hasOpenQuestions = definition.questions.some((question) => question.type === 'open');
    let stored = null;
    if (!preview && hasOpenQuestions) {
      stored = await beginStoredAttempt({
        repositoryId, quizId, definition, answers: answers.value,
        materialId: safeMaterialId(body.materialId), auth
      });
      if (stored.error) return json({ error: stored.error }, stored.error === 'ATTEMPT_LIMIT_REACHED' ? 409 : 503);
      if (stored.attempt.status === 'submitted') {
        const progressSaved = await syncStoredAttempt(stored.store, stored.attempt, auth);
        return json({
          result: studentResult(stored.attempt.result, stored.attempt.definitionSnapshot),
          attemptId: stored.attempt.attemptId,
          attemptNumber: stored.attempt.number,
          progressSaved
        });
      }
    }
    const aiEvaluation = await openAnswerGrader.evaluateAiQuestions(
      definition.questions,
      answers.value,
      { userId: auth.userId }
    );
    const result = gradeQuiz(definition, answers.value, { aiGrades: aiEvaluation.grades });
    let attempt = null;
    let progressSaved = false;
    if (stored) {
      const finished = await finishStoredAttempt(stored, {
        definition, answers: answers.value, result,
        materialId: safeMaterialId(body.materialId)
      });
      if (finished.error) return json({ error: finished.error }, 409);
      attempt = finished.attempt;
      progressSaved = await syncStoredAttempt(stored.store, attempt, auth);
    }
    return json({
      result: studentResult(result, definition, {
        aiDeferredCount: aiEvaluation.failedQuestionIds.length
      }),
      ...(attempt ? { attemptId: attempt.attemptId, attemptNumber: attempt.number, progressSaved } : {})
    });
  } catch (error) {
    const status = error instanceof contentRepository.ContentRepositoryError
      ? error.status : error?.code === 'EXAM_CONFLICT' ? 409 : 503;
    const code = error instanceof contentRepository.ContentRepositoryError
      ? error.code
      : error instanceof SyntaxError ? 'QUIZ_FILE_INVALID'
        : error?.code === 'EXAM_CONFLICT' ? 'QUIZ_CONFLICT' : 'QUIZ_STORAGE_UNAVAILABLE';
    return json({ error: code }, code === 'QUIZ_FILE_INVALID' ? 422 : status);
  }
}

async function readQuiz(repositoryId, quizId) {
  const asset = await contentRepository.readAsset('quiz', quizId, { repositoryId });
  const definition = JSON.parse(asset.content);
  if (!validateDefinition(definition, quizId).valid) {
    throw new contentRepository.ContentRepositoryError('QUIZ_FILE_INVALID', 422);
  }
  return { asset, definition };
}

async function beginStoredAttempt(input) {
  const store = quizStorage.getQuizStore();
  const requestedAttemptId = crypto.randomUUID();
  const now = new Date().toISOString();
  const profile = {
    email: String(input.auth.user?.email || '').slice(0, 320),
    name: String(input.auth.user?.user_metadata?.full_name || input.auth.user?.user_metadata?.name || '').slice(0, 200)
  };
  const reservation = await quizStorage.reserveAttempt(store, {
    repositoryId: input.repositoryId,
    quizId: input.quizId,
    userId: input.auth.userId,
    profile,
    attemptId: requestedAttemptId,
    startedAt: now,
    expiresAt: null,
    totalQuestions: input.definition.questions.length,
    allowResume: true,
    attemptsConfig: input.definition.settings.allowRetry
      ? { mode: 'unlimited', cooldownSeconds: 0 }
      : { mode: 'one', cooldownSeconds: 0 },
    now: Date.now()
  });
  if (reservation.result?.error) return { error: reservation.result.error };
  const attemptId = reservation.result.attemptId;
  const existing = await quizStorage.readAttempt(store, input.repositoryId, input.quizId, input.auth.userId, attemptId);
  if (existing?.value) return { store, attempt: existing.value };
  const attempt = {
    version: 1,
    revision: 0,
    attemptId,
    number: reservation.result.number || 1,
    repositoryId: input.repositoryId,
    examId: quizStorage.storageQuizId(input.quizId),
    quizId: input.quizId,
    kind: 'quiz',
    userId: input.auth.userId,
    profile,
    materialId: input.materialId,
    status: 'active',
    definitionSnapshot: input.definition,
    questions: structuredClone(input.definition.questions),
    answers: input.answers,
    result: null,
    startedAt: now,
    submittedAt: null,
    durationSeconds: null,
    lastActivityAt: now,
    events: [{ type: 'grading_started', timestamp: now }],
    operationIds: []
  };
  try {
    await quizStorage.createAttempt(store, attempt);
    return { store, attempt };
  } catch (error) {
    if (error?.code !== 'EXAM_CONFLICT') throw error;
    const raced = await quizStorage.readAttempt(store, input.repositoryId, input.quizId, input.auth.userId, attemptId);
    if (!raced?.value) throw error;
    return { store, attempt: raced.value };
  }
}

async function finishStoredAttempt(stored, input) {
  const now = new Date().toISOString();
  const outcome = await quizStorage.updateAttempt(stored.store, {
    repositoryId: stored.attempt.repositoryId,
    quizId: stored.attempt.quizId,
    userId: stored.attempt.userId,
    attemptId: stored.attempt.attemptId,
    expectedRevision: stored.attempt.revision,
    operationId: `quiz-submit:${stored.attempt.attemptId}`,
    now: Date.now()
  }, (attempt) => {
    if (attempt.kind !== 'quiz' || attempt.status !== 'active') return { error: 'ATTEMPT_NOT_ACTIVE' };
    attempt.definitionSnapshot = input.definition;
    attempt.questions = structuredClone(input.definition.questions);
    attempt.answers = input.answers;
    attempt.result = input.result;
    attempt.materialId = input.materialId || attempt.materialId;
    attempt.status = 'submitted';
    attempt.submittedAt = now;
    attempt.events = [...(Array.isArray(attempt.events) ? attempt.events : []), { type: 'submit', timestamp: now }];
    return {};
  });
  if (outcome.result?.error) return { error: outcome.result.error };
  return { attempt: outcome.result.attempt };
}

async function syncStoredAttempt(store, attempt, auth) {
  try {
    await quizStorage.syncAttemptIndexes(store, attempt, attempt.profile);
  } catch (error) {
    // The attempt itself is authoritative. A transient secondary-index outage
    // must not hide a finished result from the student. Do not turn ordinary
    // result reads into repeated writes; the attempt remains authoritative.
    console.error('quiz index sync failed', error?.name || 'Error');
  }
  try {
    await updateQuizProgress({
      userId: attempt.userId,
      user: auth.user,
      repositoryId: attempt.repositoryId,
      quizId: attempt.quizId,
      materialId: attempt.materialId,
      details: {
        started: true,
        completed: true,
        scorePercent: attempt.result?.percent ?? null,
        passed: attempt.result?.passed ?? null,
        attempts: attempt.number,
        gradingStatus: attempt.result?.gradingStatus,
        attemptId: attempt.attemptId
      }
    });
    return true;
  } catch (error) {
    console.error('quiz progress sync failed', error?.name || 'Error');
    return false;
  }
}

function sanitizeAnswers(definition, raw) {
  const questions = new Map(definition.questions.map((question) => [question.questionId, question]));
  const answers = Object.create(null);
  for (const [questionId, answer] of Object.entries(raw)) {
    const question = questions.get(questionId);
    if (!question) return { ok: false, error: 'INVALID_QUIZ_ANSWERS' };
    if (['text', 'open'].includes(question.type)) {
      if (typeof answer !== 'string' || answer.length > (question.type === 'open' ? 8_000 : 500)) return { ok: false, error: 'INVALID_QUIZ_ANSWERS' };
      answers[questionId] = answer.replace(/\0/g, '');
    } else {
      if (!Array.isArray(answer) || answer.length > 12 || answer.some((value) => typeof value !== 'string' || value.length > 128)) {
        return { ok: false, error: 'INVALID_QUIZ_ANSWERS' };
      }
      answers[questionId] = [...new Set(answer)];
    }
  }
  return { ok: true, value: answers };
}

function studentResult(result, definition, options = {}) {
  const aiDeferredCount = Math.max(0, Number(options.aiDeferredCount) || 0);
  return {
    earned: result.earned,
    maximum: result.maximum,
    percent: result.percent,
    passed: result.passed,
    gradingStatus: result.gradingStatus,
    pendingQuestionCount: result.pendingQuestionIds.length,
    ...(aiDeferredCount ? { aiDeferredCount } : {}),
    results: result.results.map((entry) => {
      const question = definition.questions.find((item) => item.questionId === entry.questionId);
      return {
        questionId: entry.questionId,
        ...(['single', 'multiple', 'true_false', 'text'].includes(question?.type) ? {
          answer: entry.answer, practice: practice.evaluate(question, entry.answer)
        } : {}),
        correct: entry.correct,
        points: entry.points,
        maximum: entry.maxPoints,
        reviewStatus: entry.reviewStatus,
        feedback: definition.settings.showFeedback && entry.reviewStatus !== 'pending'
          ? entry.feedback || '' : '',
        explanation: definition.settings.showFeedback && entry.reviewStatus !== 'pending'
          ? question?.explanation || '' : ''
      };
    })
  };
}

function answerPresent(value) {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && Boolean(value.trim());
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeMaterialId(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(candidate) ? candidate : '';
}

function safeAttemptId(value) {
  return typeof value === 'string' && /^[a-f0-9-]{20,64}$/i.test(value);
}

exports._test = {
  beginStoredAttempt,
  finishStoredAttempt,
  readQuiz,
  sanitizeAnswers,
  setStoreFactory: quizStorage.setStoreFactory,
  studentResult,
  syncStoredAttempt
};
