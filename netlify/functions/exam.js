'use strict';

const crypto = require('node:crypto');
const {
  answerIsPresent,
  availabilityState,
  gradeAttempt,
  immediateQuestionFeedback,
  normalizeDefinition,
  plainObject,
  publicMetadata,
  resolveExamQuestions,
  resultForStudent,
  safeQuestion,
  selectAttemptQuestions,
  validateDefinition,
  validateQuestionBank,
  SAFE_EXAM_ID,
  SAFE_REPOSITORY_ID
} = require('../exam-common.js');
const contentRepository = require('../content-repository.js');
const {
  createAttempt,
  getExamStore,
  readAttempt,
  readUserExamIndex,
  reserveAttempt,
  setStoreFactory,
  syncAttemptIndexes,
  updateAttempt
} = require('../exam-storage.js');
const {
  assertExamSequenceAccess,
  profileFrom,
  setProgressStoreFactory,
  updateExamProgress
} = require('../exam-progress.js');
const {
  json,
  mutationGuard,
  parseJsonBody,
  requireCourseAccess,
  responseForFailure
} = require('../admin-common.js');

const MAX_BODY_BYTES = 512 * 1024;
const MAX_BATCH_ANSWERS = 500;
const MUTATIONS = new Set(['bootstrap', 'open', 'start', 'autosave', 'autosave-batch', 'confirm-answer', 'navigate', 'event', 'submit']);
const EVENT_TYPES = new Set([
  'refresh', 'leave', 'resume', 'visibility_hidden', 'visibility_visible',
  'cursor_leave', 'copy', 'paste', 'context_menu'
]);

exports.handler = async function examHandler(event = {}, context = {}) {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') return emptyOptions();
  if (!['GET', 'POST'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, OPTIONS' });
  }
  if (method === 'POST') {
    const guard = mutationGuard(event, { maxBodyBytes: MAX_BODY_BYTES });
    if (!guard.ok) return responseForFailure(guard);
  }
  const auth = await requireCourseAccess(event, context);
  if (!auth.ok) return responseForFailure(auth);

  try {
    return method === 'GET'
      ? await handleGet(event, auth)
      : await handlePost(event, auth);
  } catch (error) {
    const status = error instanceof contentRepository.ContentRepositoryError ? error.status : 503;
    const code = error instanceof contentRepository.ContentRepositoryError
      ? error.code
      : error?.code === 'EXAM_CONFLICT'
        ? 'EXAM_CONFLICT'
        : error?.code === 'SEQUENCE_LOCKED' ? 'SEQUENCE_LOCKED' : 'EXAM_STORAGE_UNAVAILABLE';
    console.error('exam function failed', error?.name || 'Error');
    return json({ error: code }, ['EXAM_CONFLICT', 'SEQUENCE_LOCKED'].includes(code) ? 409 : status);
  }
};

async function handleGet(event, auth) {
  const query = event.queryStringParameters || {};
  const allowed = new Set(['action', 'repo', 'exam', 'attemptId', 'preview', 'ref', 'material']);
  if (Object.keys(query).some((key) => !allowed.has(key))) return json({ error: 'UNEXPECTED_QUERY' }, 400);
  const reference = validateReference(query);
  if (!reference.ok) return json({ error: reference.error }, 400);
  const action = String(query.action || 'definition');
  const preview = query.preview === '1';
  if (preview && !auth.roles.includes('admin')) return json({ error: 'ADMIN_REQUIRED' }, 403);
  if (action === 'image') return imageResponse(reference, query.ref, auth, preview);
  if (!preview && validMaterialId(query.material)) {
    await assertExamSequenceAccess({
      userId: auth.userId,
      user: auth.user,
      repositoryId: reference.repositoryId,
      examId: reference.examId,
      materialId: validMaterialId(query.material)
    });
  }

  const loaded = await loadDefinition(reference.repositoryId, reference.examId);
  const access = definitionAccess(loaded.definition, auth, preview);
  if (!access.ok) return json({ error: access.error, ...access.details }, access.status);
  const store = getExamStore();
  const profile = profileFrom(auth.user);
  const index = await readUserExamIndex(store, reference.repositoryId, reference.examId, auth.userId, profile);

  if (action === 'definition' || action === 'status') {
    return json({
      exam: publicMetadata(loaded.definition),
      attempts: studentAttemptSummaries(index.attempts, loaded.definition),
      serverNow: new Date().toISOString(),
      available: access.availability
    });
  }
  if (!['attempt', 'result'].includes(action) || !safeAttemptId(query.attemptId)) {
    return json({ error: 'INVALID_EXAM_ACTION' }, 400);
  }
  let entry = await readAttempt(store, reference.repositoryId, reference.examId, auth.userId, query.attemptId);
  if (!entry) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
  let attempt = entry.value;
  attempt = await finalizeExpiredAttempt(store, attempt, profile);
  if (!preview && attemptIndexNeedsSync(index, attempt)) {
    await syncAttemptState(store, attempt, auth);
  }
  if (action === 'result') {
    if (attempt.status === 'active') return json({ error: 'ATTEMPT_ACTIVE' }, 409);
    return json({ result: resultForStudent(attempt, attempt.definitionSnapshot), serverNow: new Date().toISOString() });
  }
  return json({ attempt: safeAttempt(attempt), serverNow: new Date().toISOString() });
}

async function handlePost(event, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const body = parsed.value;
  if (!MUTATIONS.has(body.action)) return json({ error: 'INVALID_EXAM_ACTION' }, 400);
  const bodyFields = validateBodyFields(body);
  if (!bodyFields.ok) return json({ error: bodyFields.error }, 400);
  const reference = validateReference(body);
  if (!reference.ok) return json({ error: reference.error }, 400);
  const loaded = await loadDefinition(reference.repositoryId, reference.examId);
  const preview = body.preview === true;
  if (preview && !auth.roles.includes('admin')) return json({ error: 'ADMIN_REQUIRED' }, 403);
  const access = definitionAccess(loaded.definition, auth, preview);
  if (!access.ok) return json({ error: access.error, ...access.details }, access.status);

  if (!preview && ['bootstrap', 'open', 'start'].includes(body.action) && validMaterialId(body.materialId)) {
    await assertExamSequenceAccess({
      userId: auth.userId,
      user: auth.user,
      repositoryId: reference.repositoryId,
      examId: reference.examId,
      materialId: validMaterialId(body.materialId)
    });
  }

  if (['bootstrap', 'open'].includes(body.action)) {
    if (!preview) {
      await updateExamProgress({
        userId: auth.userId,
        user: auth.user,
        repositoryId: reference.repositoryId,
        examId: reference.examId,
        materialId: validMaterialId(body.materialId),
        action: 'open',
        opened: true
      });
    }
    if (body.action === 'open') return json({ opened: true, exam: publicMetadata(loaded.definition) });
    const store = getExamStore();
    const profile = profileFrom(auth.user);
    const index = await readUserExamIndex(
      store,
      reference.repositoryId,
      reference.examId,
      auth.userId,
      profile
    );
    return json({
      opened: true,
      exam: publicMetadata(loaded.definition),
      attempts: studentAttemptSummaries(index.attempts, loaded.definition),
      serverNow: new Date().toISOString(),
      available: access.availability
    });
  }
  const store = getExamStore();
  if (body.action === 'start') return startAttempt(store, loaded, reference, body, auth);
  if (!safeAttemptId(body.attemptId)) return json({ error: 'INVALID_ATTEMPT_ID' }, 400);
  const existing = await readAttempt(store, reference.repositoryId, reference.examId, auth.userId, body.attemptId);
  if (!existing) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
  let attempt = await finalizeExpiredAttempt(store, existing.value, profileFrom(auth.user));
  if (attempt.status !== 'active') {
    return json({ error: 'ATTEMPT_FINISHED', result: resultForStudent(attempt, attempt.definitionSnapshot) }, 409);
  }
  if (body.action === 'autosave') return autosave(store, attempt, body, auth);
  if (body.action === 'autosave-batch') return autosaveBatch(store, attempt, body, auth);
  if (body.action === 'confirm-answer') return confirmAnswer(store, attempt, body, auth);
  if (body.action === 'navigate') return navigate(store, attempt, body, auth);
  if (body.action === 'event') return logEvent(store, attempt, body, auth);
  return submit(store, attempt, body, auth, 'submitted');
}

async function loadDefinition(repositoryId, examId) {
  const asset = await contentRepository.readAsset('exam', examId, { repositoryId });
  let parsed;
  try { parsed = JSON.parse(asset.content); }
  catch { throw new contentRepository.ContentRepositoryError('EXAM_FILE_INVALID', 422); }
  const validated = validateDefinition(parsed, examId);
  if (!validated.valid) {
    throw new contentRepository.ContentRepositoryError('EXAM_FILE_INVALID', 422);
  }
  const definition = validated.definition;
  let bank = { version: 1, questions: [] };
  if (definition.questionRefs.length) {
    try {
      const bankAsset = await contentRepository.readAsset('question_bank', 'question-bank.json', { repositoryId });
      const validatedBank = validateQuestionBank(JSON.parse(bankAsset.content));
      if (!validatedBank.valid) throw new contentRepository.ContentRepositoryError('EXAM_FILE_INVALID', 422);
      bank = validatedBank.bank;
    } catch (error) {
      if (!(error instanceof contentRepository.ContentRepositoryError) || error.code !== 'CONTENT_FILE_NOT_FOUND') throw error;
    }
  }
  if (resolveExamQuestions(definition, bank).length !== definition.questions.length + definition.questionRefs.length) {
    throw new contentRepository.ContentRepositoryError('EXAM_QUESTION_REFERENCE_MISSING', 422);
  }
  return { definition, bank, sha: asset.sha };
}

function definitionAccess(definition, auth, preview) {
  if (definition.status !== 'published' && !(preview && auth.roles.includes('admin'))) {
    return { ok: false, error: 'EXAM_NOT_PUBLISHED', status: 404 };
  }
  const availability = availabilityState(definition, auth.userId);
  if (!availability.available && !(preview && auth.roles.includes('admin'))) {
    return { ok: false, error: availability.reason, status: 403, details: availability };
  }
  return { ok: true, availability };
}

async function startAttempt(store, loaded, reference, body, auth) {
  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const questions = selectAttemptQuestions(loaded.definition, loaded.bank);
  if (!questions.length) return json({ error: 'EXAM_QUESTIONS_UNAVAILABLE' }, 422);
  const attemptId = crypto.randomUUID();
  const expiresAt = loaded.definition.timing.mode === 'exam'
    ? new Date(now + loaded.definition.timing.limitSeconds * 1000).toISOString()
    : null;
  const reservation = body.preview === true ? { result: { resumed: false, attemptId, number: 0 } } : await reserveAttempt(store, {
    repositoryId: reference.repositoryId,
    examId: reference.examId,
    userId: auth.userId,
    profile: profileFrom(auth.user),
    attemptsConfig: loaded.definition.attempts,
    allowResume: loaded.definition.security.leavePolicy !== 'end_attempt',
    attemptId,
    startedAt,
    expiresAt,
    totalQuestions: questions.length,
    now
  });
  if (reservation.result?.error) {
    return json({ error: reservation.result.error, availableAt: reservation.result.availableAt || null }, 409);
  }
  if (reservation.result?.resumed) {
    const entry = await readAttempt(store, reference.repositoryId, reference.examId, auth.userId, reservation.result.attemptId);
    if (!entry) return json({ error: 'ATTEMPT_NOT_FOUND' }, 409);
    const resumed = await appendAttemptEvent(store, entry.value, auth, 'resume', {}, null, null);
    return json({ attempt: safeAttempt(resumed), resumed: true });
  }
  const number = reservation.result?.number || 1;
  const initialVisibleEnd = visibleEndIndex(loaded.definition.display, 0, questions.length);
  const initialQuestionIds = questions.slice(0, initialVisibleEnd + 1).map((question) => question.questionId);
  const questionExpiresAt = loaded.definition.timing.mode === 'question'
    ? new Date(now + loaded.definition.timing.questionLimitSeconds * 1000).toISOString()
    : null;
  const attempt = {
    version: 1,
    revision: 1,
    attemptId,
    number,
    repositoryId: reference.repositoryId,
    examId: reference.examId,
    userId: auth.userId,
    profile: profileFrom(auth.user),
    status: 'active',
    preview: body.preview === true,
    materialId: validMaterialId(body.materialId),
    definitionSha: loaded.sha,
    definitionSnapshot: loaded.definition,
    questions,
    answers: Object.create(null),
    confirmedQuestionIds: [],
    flags: [],
    currentIndex: 0,
    highestReachedIndex: initialVisibleEnd,
    startedAt,
    expiresAt,
    questionStartedAt: Object.fromEntries(initialQuestionIds.map((questionId) => [questionId, startedAt])),
    questionExpiresAt: questionExpiresAt
      ? Object.fromEntries(initialQuestionIds.map((questionId) => [questionId, questionExpiresAt])) : {},
    timedOutQuestionIds: [],
    submittedAt: null,
    durationSeconds: null,
    result: null,
    lastActivityAt: startedAt,
    events: [{ type: 'start', timestamp: startedAt, questionId: questions[0].questionId, index: 0 }],
    operationIds: []
  };
  await createAttempt(store, attempt);
  if (!attempt.preview) await syncAttemptIndexes(store, attempt, attempt.profile);
  if (!attempt.preview) await updateExamProgress({
    userId: auth.userId,
    user: auth.user,
    repositoryId: reference.repositoryId,
    examId: reference.examId,
    materialId: attempt.materialId,
    action: 'exam',
    opened: true,
    details: {
      started: true,
      completed: false,
      attemptId,
      attempts: number,
      answeredQuestions: 0,
      totalQuestions: questions.length,
      currentQuestionIndex: 0,
      studentResultVisible: loaded.definition.resultVisibility.studentResultVisible
    }
  });
  return json({ attempt: safeAttempt(attempt), resumed: false }, 201);
}

async function autosave(store, attempt, body, auth) {
  const questionId = String(body.questionId || '');
  if (!questionId) return json({ error: 'QUESTION_NOT_FOUND' }, 404);
  return saveAnswerBatch(store, attempt, {
    ...body,
    answers: { [questionId]: body.answer }
  }, auth);
}

async function autosaveBatch(store, attempt, body, auth) {
  return saveAnswerBatch(store, attempt, body, auth);
}

async function saveAnswerBatch(store, attempt, body, auth) {
  const operation = operationInput(attempt, body);
  const outcome = await updateAttempt(store, operation, (draft) => {
    const applied = applyAnswerBatch(draft, body.answers);
    return applied.error ? applied : { savedCount: applied.count };
  });
  if (outcome.result?.error) return updateError(outcome.result);
  const saved = outcome.result?.attempt;
  await syncAttemptState(store, saved, auth);
  return json({
    attempt: safeAttempt(saved),
    saved: true,
    savedCount: Number(outcome.result?.savedCount) || 0,
    duplicate: Boolean(outcome.result?.duplicate)
  });
}

async function confirmAnswer(store, attempt, body, auth) {
  if (attempt.definitionSnapshot.resultVisibility.feedbackMode !== 'immediate') {
    return json({ error: 'IMMEDIATE_FEEDBACK_DISABLED' }, 409);
  }
  const questionId = String(body.questionId || '');
  const index = attempt.questions.findIndex((question) => question.questionId === questionId);
  if (index < 0) return json({ error: 'QUESTION_NOT_FOUND' }, 404);
  if (!attempt.definitionSnapshot.navigation.allowFreeNavigation && index > attempt.highestReachedIndex) {
    return json({ error: 'QUESTION_NOT_UNLOCKED' }, 409);
  }
  if (!attempt.definitionSnapshot.navigation.allowBack && index < attempt.currentIndex) {
    return json({ error: 'BACK_NAVIGATION_DISABLED' }, 409);
  }
  if (questionTimedOut(attempt, questionId)) return json({ error: 'QUESTION_TIME_EXPIRED' }, 409);
  const outcome = await updateAttempt(store, operationInput(attempt, body), (draft) => {
    const applied = applyAnswerBatch(draft, body.answers);
    if (applied.error) return applied;
    if (!answerIsComplete(draft.questions[index], draft.answers?.[questionId])) return { error: 'ANSWER_REQUIRED' };
    draft.confirmedQuestionIds = Array.isArray(draft.confirmedQuestionIds) ? draft.confirmedQuestionIds : [];
    if (!draft.confirmedQuestionIds.includes(questionId)) {
      draft.confirmedQuestionIds.push(questionId);
      addEvent(draft, 'confirm_answer', { questionId, index });
    }
    return {};
  });
  if (outcome.result?.error) return updateError(outcome.result);
  const saved = outcome.result?.attempt;
  await syncAttemptState(store, saved, auth);
  return json({
    attempt: safeAttempt(saved),
    feedback: immediateQuestionFeedback(saved.questions[index], answerFor(saved.answers, questionId), saved.definitionSnapshot),
    confirmed: true,
    duplicate: Boolean(outcome.result?.duplicate)
  });
}

async function navigate(store, attempt, body, auth) {
  const targetIndex = Number(body.targetIndex);
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= attempt.questions.length) {
    return json({ error: 'INVALID_QUESTION_INDEX' }, 400);
  }
  const operation = operationInput(attempt, body);
  const outcome = await updateAttempt(store, operation, (draft) => {
    const applied = applyAnswerBatch(draft, body.answers);
    if (applied.error) return applied;
    expireCurrentQuestionIfNeeded(draft);
    const navigation = draft.definitionSnapshot.navigation;
    if (!navigation.allowBack && targetIndex < draft.currentIndex) return { error: 'BACK_NAVIGATION_DISABLED' };
    const nextSequentialIndex = visibleEndIndex(
      draft.definitionSnapshot.display,
      draft.currentIndex,
      draft.questions.length
    ) + 1;
    if (!navigation.allowFreeNavigation && targetIndex > nextSequentialIndex) {
      return { error: 'QUESTION_NOT_UNLOCKED' };
    }
    const advancing = targetIndex > draft.currentIndex;
    const crossed = advancing ? draft.questions.slice(draft.currentIndex, targetIndex) : [];
    const unanswered = crossed.filter((question) => (
      !answerIsPresent(answerFor(draft.answers, question.questionId)) && !questionTimedOut(draft, question.questionId)
    ));
    if (advancing && navigation.requireAnswerBeforeNext && unanswered.length) return { error: 'ANSWER_REQUIRED' };
    if (advancing && !navigation.allowSkip && unanswered.length) return { error: 'SKIPPING_DISABLED' };
    draft.currentIndex = targetIndex;
    draft.highestReachedIndex = Math.max(
      draft.highestReachedIndex,
      visibleEndIndex(draft.definitionSnapshot.display, targetIndex, draft.questions.length)
    );
    const target = draft.questions[targetIndex];
    const visibleStart = visibleStartIndex(draft.definitionSnapshot.display, targetIndex);
    const visibleEnd = visibleEndIndex(draft.definitionSnapshot.display, targetIndex, draft.questions.length);
    draft.questions.slice(visibleStart, visibleEnd + 1).forEach((question) => startQuestionTimer(draft, question.questionId));
    if (body.flagged === true && draft.definitionSnapshot.navigation.allowFlagging) {
      draft.flags = [...new Set([...draft.flags, target.questionId])];
    } else if (body.flagged === false) {
      draft.flags = draft.flags.filter((id) => id !== target.questionId);
    }
    return { savedCount: applied.count };
  });
  if (outcome.result?.error) return updateError(outcome.result);
  const saved = outcome.result?.attempt;
  await syncAttemptState(store, saved, auth);
  return json({ attempt: safeAttempt(saved) });
}

async function logEvent(store, attempt, body, auth) {
  const eventType = String(body.eventType || '');
  if (!EVENT_TYPES.has(eventType)) return json({ error: 'INVALID_EVENT_TYPE' }, 400);
  if (eventType === 'leave' && attempt.definitionSnapshot.security.leavePolicy === 'end_attempt') {
    return submit(store, attempt, { ...body, force: true }, auth, 'left');
  }
  const outcome = await updateAttempt(store, operationInput(attempt, body), (draft) => {
    const applied = applyAnswerBatch(draft, body.answers);
    if (applied.error) return applied;
    expireCurrentQuestionIfNeeded(draft);
    addEvent(draft, eventType, safeEventDetails(body.details));
    return {};
  });
  if (outcome.result?.error) return updateError(outcome.result);
  const saved = outcome.result?.attempt;
  if (!saved.preview) await syncAttemptIndexes(store, saved, saved.profile);
  return json({ attempt: safeAttempt(saved), logged: true });
}

async function submit(store, attempt, body, auth, reason) {
  const status = reason === 'timeout' ? 'timed_out' : 'submitted';
  const outcome = await updateAttempt(store, operationInput(attempt, body), (draft) => {
    const applied = applyAnswerBatch(draft, body.answers);
    if (applied.error) return applied;
    const missing = draft.questions.filter((question) => !answerIsPresent(answerFor(draft.answers, question.questionId)));
    if (!body.force && draft.definitionSnapshot.navigation.requireAnswerBeforeNext && missing.length) {
      return { error: 'UNANSWERED_QUESTIONS', count: missing.length };
    }
    finishAttempt(draft, status, reason);
    return { savedCount: applied.count };
  });
  if (outcome.result?.error) return updateError(outcome.result);
  const saved = outcome.result?.attempt;
  const warnings = await syncAttemptState(store, saved, auth);
  return json({
    result: resultForStudent(saved, saved.definitionSnapshot),
    attempt: safeAttempt(saved),
    ...(warnings.length ? { warnings } : {})
  });
}

function finishAttempt(attempt, status, reason, gradingOptions = {}) {
  if (attempt.status !== 'active') return attempt;
  const now = new Date().toISOString();
  attempt.status = status;
  attempt.submittedAt = now;
  attempt.durationSeconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(attempt.startedAt)) / 1000));
  attempt.result = gradeAttempt(attempt, attempt.definitionSnapshot, gradingOptions);
  addEvent(attempt, reason === 'timeout' ? 'timeout' : 'submit', { reason });
  return attempt;
}

async function finalizeExpiredAttempt(store, attempt, profile) {
  if (attempt.status !== 'active' || !attempt.expiresAt || Date.now() < Date.parse(attempt.expiresAt)) return attempt;
  const outcome = await updateAttempt(store, {
    repositoryId: attempt.repositoryId,
    examId: attempt.examId,
    userId: attempt.userId,
    attemptId: attempt.attemptId,
    expectedRevision: null,
    operationId: `timeout:${attempt.expiresAt}`,
    now: Date.now()
  }, (draft) => {
    finishAttempt(draft, 'timed_out', 'timeout');
    return {};
  });
  const saved = outcome.result?.attempt || attempt;
  if (saved.status !== 'active') {
    await syncAttemptState(store, saved, {
      userId: saved.userId,
      user: { email: saved.profile?.email, user_metadata: { full_name: (profile || saved.profile)?.name } }
    });
  }
  return saved;
}

async function appendAttemptEvent(store, attempt, auth, type, details, expectedRevision, operationId) {
  const outcome = await updateAttempt(store, {
    repositoryId: attempt.repositoryId,
    examId: attempt.examId,
    userId: attempt.userId,
    attemptId: attempt.attemptId,
    expectedRevision,
    operationId: operationId || crypto.randomUUID(),
    now: Date.now()
  }, (draft) => {
    addEvent(draft, type, details);
    return {};
  });
  const saved = outcome.result?.attempt || attempt;
  if (!saved.preview) await syncAttemptIndexes(store, saved, profileFrom(auth.user));
  return saved;
}

async function syncAttemptState(store, attempt, auth) {
  if (attempt.preview) return [];
  const warnings = [];
  try {
    await syncAttemptIndexes(store, attempt, attempt.profile);
  } catch (error) {
    console.error('exam attempt index sync failed', error?.name || 'Error');
    warnings.push('INDEX_SYNC_PENDING');
    return warnings;
  }
  try {
    await progressForAttempt(store, attempt, auth);
  } catch (error) {
    console.error('exam attempt progress sync failed', error?.name || 'Error');
    warnings.push('PROGRESS_SYNC_PENDING');
  }
  return warnings;
}

function attemptIndexNeedsSync(index, attempt) {
  const summary = (index?.attempts || []).find((entry) => entry.attemptId === attempt.attemptId);
  return !summary
    || summary.status !== attempt.status
    || summary.lastActivityAt !== attempt.lastActivityAt
    || summary.gradingStatus !== (attempt.result?.gradingStatus || (attempt.status === 'active' ? 'active' : 'graded'));
}

async function progressForAttempt(store, attempt, auth) {
  const answered = Object.values(attempt.answers || {}).filter(answerIsPresent).length;
  const index = await readUserExamIndex(store, attempt.repositoryId, attempt.examId, attempt.userId, attempt.profile);
  const selected = selectedAttemptResult(index.attempts, attempt.definitionSnapshot);
  return updateExamProgress({
    userId: attempt.userId,
    user: auth.user,
    repositoryId: attempt.repositoryId,
    examId: attempt.examId,
    materialId: attempt.materialId,
    action: 'exam',
    opened: true,
    details: {
      started: true,
      completed: attempt.status !== 'active',
      attemptId: attempt.attemptId,
      attempts: (index.attempts || []).filter((entry) => entry.status !== 'reset' && !entry.resetAt).length,
      answeredQuestions: answered,
      totalQuestions: attempt.questions.length,
      currentQuestionIndex: attempt.currentIndex,
      studentResultVisible: attempt.definitionSnapshot.resultVisibility.studentResultVisible,
      scorePercent: attempt.status === 'active' ? undefined : selected.scorePercent,
      passed: attempt.status === 'active' ? undefined : selected.passed,
      durationSeconds: attempt.durationSeconds,
      gradingStatus: attempt.status === 'active' ? undefined : attempt.result?.gradingStatus
    }
  });
}

function safeAttempt(attempt) {
  const current = attempt.questions[attempt.currentIndex];
  const confirmedQuestionIds = Array.isArray(attempt.confirmedQuestionIds)
    ? attempt.confirmedQuestionIds.filter((questionId) => attempt.questions.some((question) => question.questionId === questionId))
    : [];
  const immediateFeedback = attempt.definitionSnapshot.resultVisibility.feedbackMode === 'immediate'
    ? Object.fromEntries(confirmedQuestionIds.map((questionId) => {
      const question = attempt.questions.find((candidate) => candidate.questionId === questionId);
      return [questionId, immediateQuestionFeedback(question, attempt.answers?.[questionId], attempt.definitionSnapshot)];
    }))
    : {};
  return {
    attemptId: attempt.attemptId,
    number: attempt.number,
    repositoryId: attempt.repositoryId,
    examId: attempt.examId,
    status: attempt.status,
    revision: attempt.revision,
    exam: publicMetadata(attempt.definitionSnapshot),
    questions: attempt.questions.map(safeQuestion),
    answers: attempt.answers,
    confirmedQuestionIds,
    immediateFeedback,
    flags: attempt.flags,
    currentIndex: attempt.currentIndex,
    highestReachedIndex: attempt.highestReachedIndex,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    currentQuestionExpiresAt: current ? attempt.questionExpiresAt?.[current.questionId] || null : null,
    currentQuestionStartedAt: current ? attempt.questionStartedAt?.[current.questionId] || null : null,
    timedOutQuestionIds: attempt.timedOutQuestionIds,
    answeredCount: Object.values(attempt.answers || {}).filter(answerIsPresent).length,
    totalQuestions: attempt.questions.length,
    result: attempt.status === 'active' ? null : resultForStudent(attempt, attempt.definitionSnapshot)
  };
}

function visibleEndIndex(display, targetIndex, totalQuestions) {
  if (!totalQuestions) return 0;
  if (display?.mode === 'all') return totalQuestions - 1;
  if (display?.mode === 'page') {
    const size = Math.max(1, Number(display.questionsPerPage) || 1);
    const first = Math.floor(targetIndex / size) * size;
    return Math.min(totalQuestions - 1, first + size - 1);
  }
  return Math.min(totalQuestions - 1, Math.max(0, targetIndex));
}

function visibleStartIndex(display, targetIndex) {
  if (display?.mode === 'all') return 0;
  if (display?.mode === 'page') {
    const size = Math.max(1, Number(display.questionsPerPage) || 1);
    return Math.floor(Math.max(0, targetIndex) / size) * size;
  }
  return Math.max(0, targetIndex);
}

function selectedAttemptResult(attempts, definition) {
  const finished = (Array.isArray(attempts) ? attempts : [])
    .filter((entry) => !entry.resetAt && ['submitted', 'timed_out'].includes(entry.status) && hasNumericScore(entry.scorePercent))
    .sort((left, right) => Date.parse(left.submittedAt || 0) - Date.parse(right.submittedAt || 0));
  if (!finished.length) return { scorePercent: null, passed: null };
  const strategy = definition.attempts.resultStrategy;
  let scorePercent;
  if (strategy === 'first') scorePercent = Number(finished[0].scorePercent);
  else if (strategy === 'last') scorePercent = Number(finished.at(-1).scorePercent);
  else if (strategy === 'average') scorePercent = finished.reduce((sum, entry) => sum + Number(entry.scorePercent), 0) / finished.length;
  else scorePercent = Math.max(...finished.map((entry) => Number(entry.scorePercent)));
  scorePercent = Math.round(scorePercent * 100) / 100;
  return { scorePercent, passed: scorePercent >= definition.metadata.passThreshold };
}

function studentAttemptSummaries(attempts, definition) {
  return (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => attempt.status !== 'reset')
    .map((attempt) => {
      const summary = {
        attemptId: attempt.attemptId,
        number: attempt.number,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        answeredCount: attempt.answeredCount,
        totalQuestions: attempt.totalQuestions,
        gradingStatus: attempt.gradingStatus || (attempt.scorePercent == null && attempt.status !== 'active' ? 'pending_review' : 'graded'),
        pendingQuestionCount: Number(attempt.pendingQuestionCount) || 0
      };
      if (definition.resultVisibility.studentResultVisible) {
        if (definition.resultVisibility.scorePercent) summary.scorePercent = attempt.scorePercent;
        if (definition.resultVisibility.passFail) summary.passed = attempt.passed;
        if (definition.resultVisibility.time) summary.durationSeconds = attempt.durationSeconds;
      }
      return summary;
    });
}

function operationInput(attempt, body) {
  return {
    repositoryId: attempt.repositoryId,
    examId: attempt.examId,
    userId: attempt.userId,
    attemptId: attempt.attemptId,
    expectedRevision: Number.isSafeInteger(body.revision) ? body.revision : null,
    operationId: safeOperationId(body.operationId) || crypto.randomUUID(),
    now: Date.now()
  };
}

function startQuestionTimer(attempt, questionId) {
  if (attempt.definitionSnapshot.timing.mode !== 'question' || attempt.questionStartedAt[questionId]) return;
  const now = Date.now();
  attempt.questionStartedAt[questionId] = new Date(now).toISOString();
  attempt.questionExpiresAt[questionId] = new Date(
    now + attempt.definitionSnapshot.timing.questionLimitSeconds * 1000
  ).toISOString();
}

function questionTimedOut(attempt, questionId) {
  const expiresAt = attempt.questionExpiresAt?.[questionId];
  return attempt.timedOutQuestionIds?.includes(questionId)
    || Boolean(expiresAt && Date.now() >= Date.parse(expiresAt));
}

function expireCurrentQuestionIfNeeded(attempt) {
  const question = attempt.questions[attempt.currentIndex];
  if (!question || !questionTimedOut(attempt, question.questionId)) return;
  if (!attempt.timedOutQuestionIds.includes(question.questionId)) {
    attempt.timedOutQuestionIds.push(question.questionId);
    addEvent(attempt, 'timeout', { scope: 'question', questionId: question.questionId, index: attempt.currentIndex });
  }
}

function sanitizeAnswer(question, raw) {
  if (['single_choice', 'true_false'].includes(question.type)) return String(raw || '').slice(0, 128);
  if (question.type === 'multiple_choice' || question.type === 'ordering') {
    return [...new Set((Array.isArray(raw) ? raw : []).map((value) => String(value).slice(0, 128)))].slice(0, 100);
  }
  if (question.type === 'short_text' || question.type === 'number') return String(raw ?? '').slice(0, 10_000);
  if (question.type === 'open_answer') return String(raw ?? '').replace(/\0/g, '').slice(0, 8_000);
  if (question.type === 'matching' || question.type === 'fill_blanks') {
    if (!plainObject(raw)) return {};
    return Object.fromEntries(Object.entries(raw).slice(0, 100).map(([key, value]) => [String(key).slice(0, 128), String(value ?? '').slice(0, 2_000)]));
  }
  return null;
}

function hasNumericScore(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}

function answerFor(answers, questionId) {
  return answers && Object.hasOwn(answers, questionId) ? answers[questionId] : null;
}

function applyAnswerBatch(attempt, rawAnswers) {
  if (rawAnswers == null) return { count: 0 };
  if (!plainObject(rawAnswers)) return { error: 'ANSWER_BATCH_INVALID' };
  const entries = Object.entries(rawAnswers);
  if (!entries.length || entries.length > MAX_BATCH_ANSWERS) return { error: 'ANSWER_BATCH_INVALID' };
  const navigation = attempt.definitionSnapshot.navigation;
  const confirmed = new Set(attempt.confirmedQuestionIds || []);
  const updates = [];
  for (const [questionId, rawAnswer] of entries) {
    const index = attempt.questions.findIndex((question) => question.questionId === questionId);
    if (index < 0) return { error: 'QUESTION_NOT_FOUND' };
    if (!navigation.allowFreeNavigation && index > attempt.highestReachedIndex) {
      return { error: 'QUESTION_NOT_UNLOCKED' };
    }
    if (!navigation.allowBack && index < attempt.currentIndex) return { error: 'BACK_NAVIGATION_DISABLED' };
    if (questionTimedOut(attempt, questionId)) return { error: 'QUESTION_TIME_EXPIRED' };
    if (confirmed.has(questionId)) return { error: 'ANSWER_ALREADY_CONFIRMED' };
    updates.push([questionId, sanitizeAnswer(attempt.questions[index], rawAnswer)]);
  }
  updates.forEach(([questionId, answer]) => { attempt.answers[questionId] = answer; });
  return { count: updates.length };
}

function answerIsComplete(question, answer) {
  if (!answerIsPresent(answer)) return false;
  if (question.type === 'matching') {
    return plainObject(answer) && question.pairs.every((pair) => String(answer[pair.pairId] || '').trim());
  }
  if (question.type === 'fill_blanks') {
    return plainObject(answer) && question.blanks.every((blank) => String(answer[blank.blankId] || '').trim());
  }
  if (question.type === 'ordering') {
    const expected = new Set(question.items.map((item) => item.itemId));
    return Array.isArray(answer) && answer.length === expected.size && answer.every((itemId) => expected.has(itemId));
  }
  return true;
}

function addEvent(attempt, type, details = {}) {
  const question = attempt.questions[attempt.currentIndex];
  attempt.events = Array.isArray(attempt.events) ? attempt.events : [];
  attempt.events.push({
    type,
    timestamp: new Date().toISOString(),
    questionId: details.questionId || question?.questionId || null,
    index: Number.isSafeInteger(details.index) ? details.index : attempt.currentIndex,
    details: safeEventDetails(details)
  });
  attempt.events = attempt.events.slice(-500);
}

function safeEventDetails(value) {
  if (!plainObject(value)) return {};
  const safe = {};
  for (const [key, entry] of Object.entries(value).slice(0, 20)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof entry === 'boolean' || Number.isFinite(entry)) safe[key] = entry;
    else if (typeof entry === 'string') safe[key] = entry.slice(0, 500);
  }
  return safe;
}

async function imageResponse(reference, rawRef, auth, preview) {
  const loaded = await loadDefinition(reference.repositoryId, reference.examId);
  const access = definitionAccess(loaded.definition, auth, preview);
  if (!access.ok) return json({ error: access.error }, access.status);
  const shared = String(rawRef || '').startsWith('assets/shared/');
  const media = await contentRepository.readMedia(
    shared ? 'shared' : 'local',
    shared ? '' : 'exam',
    shared ? '' : reference.examId,
    rawRef,
    { repositoryId: reference.repositoryId }
  );
  return {
    statusCode: 200,
    headers: {
      'Content-Type': media.mimeType,
      'Cache-Control': 'private, max-age=300',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff'
    },
    isBase64Encoded: true,
    body: media.buffer.toString('base64')
  };
}

function validateReference(value) {
  const examId = String(value.exam || value.examId || '').trim().toLowerCase();
  const repositoryId = String(value.repo || value.repositoryId || 'default').trim().toLowerCase() || 'default';
  if (!SAFE_EXAM_ID.test(examId)) return { ok: false, error: 'INVALID_EXAM_ID' };
  if (!SAFE_REPOSITORY_ID.test(repositoryId)) return { ok: false, error: 'INVALID_CONTENT_REPOSITORY' };
  return { ok: true, examId, repositoryId };
}

function validMaterialId(value) {
  const materialId = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(materialId) ? materialId : '';
}

function validateBodyFields(body) {
  const common = ['action', 'repositoryId', 'repo', 'examId', 'exam', 'preview'];
  const byAction = {
    bootstrap: ['materialId'],
    open: ['materialId'],
    start: ['materialId'],
    autosave: ['attemptId', 'revision', 'operationId', 'questionId', 'answer'],
    'autosave-batch': ['attemptId', 'revision', 'operationId', 'answers'],
    'confirm-answer': ['attemptId', 'revision', 'operationId', 'questionId', 'answers'],
    navigate: ['attemptId', 'revision', 'operationId', 'targetIndex', 'flagged', 'answers'],
    event: ['attemptId', 'revision', 'operationId', 'eventType', 'details', 'force', 'answers'],
    submit: ['attemptId', 'revision', 'operationId', 'force', 'answers']
  };
  const allowed = new Set([...common, ...(byAction[body.action] || [])]);
  return Object.keys(body).some((key) => !allowed.has(key))
    ? { ok: false, error: 'UNEXPECTED_FIELDS' }
    : { ok: true };
}

function safeAttemptId(value) {
  return typeof value === 'string' && /^[a-f0-9-]{20,64}$/i.test(value);
}

function safeOperationId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(value) ? value : '';
}

function updateError(result) {
  const conflictErrors = new Set([
    'ATTEMPT_VERSION_CONFLICT', 'ANSWER_ALREADY_CONFIRMED', 'QUESTION_TIME_EXPIRED',
    'QUESTION_NOT_UNLOCKED', 'BACK_NAVIGATION_DISABLED', 'ANSWER_REQUIRED',
    'SKIPPING_DISABLED', 'UNANSWERED_QUESTIONS'
  ]);
  const status = conflictErrors.has(result.error)
    ? 409 : result.error === 'ATTEMPT_NOT_FOUND' || result.error === 'QUESTION_NOT_FOUND' ? 404 : 400;
  return json({
    error: result.error,
    count: Number.isSafeInteger(result.count) ? result.count : undefined,
    attempt: result.attempt ? safeAttempt(result.attempt) : undefined
  }, status);
}

function emptyOptions() {
  return { statusCode: 204, headers: { Allow: 'GET, POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }, body: '' };
}

exports._test = {
  attemptIndexNeedsSync,
  definitionAccess,
  finalizeExpiredAttempt,
  loadDefinition,
  safeAttempt,
  applyAnswerBatch,
  sanitizeAnswer,
  setProgressStoreFactory,
  setStoreFactory,
  studentAttemptSummaries,
  selectedAttemptResult,
  visibleEndIndex,
  visibleStartIndex,
  validateBodyFields,
  validateReference
};
