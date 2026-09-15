'use strict';

const lessonNavigation = require('../public/assets/js/lesson-navigation.js');

const TRACKING_STATES = Object.freeze(['ON', 'OFF', 'INHERIT']);
const MATERIAL_TYPES = Object.freeze([
  'lesson', 'lesson_step', 'presentation', 'video', 'pdf', 'quiz', 'exam',
  'script', 'embed', 'iframe', 'section', 'subsection', 'department', 'course', 'other'
]);
const STATUS_VALUES = Object.freeze(['not_started', 'opened', 'in_progress', 'completed']);
const MATERIAL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DOES_NOT_COMPLETE_ON_OPEN = new Set(['lesson', 'lesson_step', 'section', 'subsection', 'department', 'course', 'exam']);
// Lekcja jest liściem katalogu Dashboardu. Jej kroki są przechowywane w
// settings.steps, a nie jako osobne dzieci, dlatego musi uczestniczyć w
// agregacji kursu tak samo jak egzamin lub prezentacja.
const NON_AGGREGATED_LEAF_TYPES = new Set(['lesson_step', 'section', 'subsection', 'department', 'course']);
const MAX_RECORDS = 5_000;
const MAX_VISITED = 1_000;
const MAX_INVALIDATIONS = 10_000;
const MAX_LESSON_ANSWERS = 100;
const MAX_LESSON_ANSWER_CHARS = 6_000;
const MAX_LESSON_AI_RESPONSE_CHARS = 8_000;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, minimum = 0, maximum = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function isoDate(value, fallback = null) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function oneLine(value, maximum = 180) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function trackingState(value, fallback = 'INHERIT') {
  const normalized = String(value || '').toUpperCase();
  return TRACKING_STATES.includes(normalized) ? normalized : fallback;
}

function materialType(value) {
  const normalized = String(value || '').toLowerCase();
  return MATERIAL_TYPES.includes(normalized) ? normalized : 'other';
}

function defaultGlobalSettings() {
  return {
    tracking: 'ON',
    recordOpens: true,
    showProgress: 'ON'
  };
}

function defaultNodeProgress() {
  return {
    tracking: 'INHERIT',
    showProgress: 'INHERIT',
    includeInSection: true,
    includeInDepartment: true,
    includeInCourse: true,
    weight: 1
  };
}

function normalizeStep(step, index) {
  const source = plainObject(step) ? step : {};
  const id = validMaterialId(source.id) ? source.id : `step-${index + 1}`;
  const condition = plainObject(source.condition) ? source.condition : {};
  return {
    id,
    title: oneLine(source.title || `Krok ${index + 1}`),
    includeInLesson: source.includeInLesson !== false,
    requiredToAdvance: source.requiredToAdvance !== false,
    condition: {
      type: ['next_click', 'previous_completed', 'material_completed', 'quiz_completed', 'correct_answer', 'exam_completed', 'exam_passed', 'minimum_score']
        .includes(condition.type) ? condition.type : 'next_click',
      materialId: validMaterialId(condition.materialId) ? condition.materialId : null,
      minimumScore: clamp(condition.minimumScore, 0, 100)
    }
  };
}

function normalizeNode(input, index = 0) {
  const source = plainObject(input) ? input : {};
  if (!validMaterialId(source.id)) return null;
  const progress = plainObject(source.progress) ? source.progress : source;
  const settings = plainObject(source.settings) ? source.settings : {};
  const steps = Array.isArray(settings.steps)
    ? settings.steps.slice(0, 1_000).map(normalizeStep)
    : [];
  return {
    id: source.id,
    parentId: validMaterialId(source.parentId) ? source.parentId : null,
    type: materialType(source.type),
    title: oneLine(source.title || source.id),
    order: Number.isSafeInteger(source.order) ? source.order : index,
    progress: {
      tracking: trackingState(progress.tracking),
      showProgress: trackingState(progress.showProgress),
      includeInSection: true,
      includeInDepartment: true,
      includeInCourse: true,
      weight: clamp(progress.weight || 1, 0.01, 10_000)
    },
    settings: {
      navigation: settings.navigation === 'sequential' ? 'sequential' : 'free',
      manualCompletion: settings.manualCompletion === true,
      presentationMode: ['highest', 'visited', 'required'].includes(settings.presentationMode)
        ? settings.presentationMode : 'highest',
      requiredSlideIds: Array.isArray(settings.requiredSlideIds)
        ? settings.requiredSlideIds.map((value) => oneLine(value, 128)).filter(Boolean).slice(0, MAX_VISITED)
        : [],
      videoCompletionThreshold: clamp(settings.videoCompletionThreshold == null ? 90 : settings.videoCompletionThreshold, 1, 100),
      contentFile: oneLine(settings.contentFile, 120),
      repositoryId: oneLine(settings.repositoryId, 40).toLowerCase(),
      ...(settings.quizId ? { quizId: oneLine(settings.quizId, 80).toLowerCase() } : {}),
      examId: oneLine(settings.examId, 80).toLowerCase(),
      steps
    }
  };
}

function normalizeCatalog(input) {
  const source = plainObject(input) ? input : {};
  const global = plainObject(source.global) ? source.global : {};
  const seen = new Set();
  const nodes = [];
  (Array.isArray(source.nodes) ? source.nodes : []).slice(0, 10_000).forEach((node, index) => {
    const normalized = normalizeNode(node, index);
    if (!normalized || seen.has(normalized.id)) return;
    seen.add(normalized.id);
    nodes.push(normalized);
  });
  // A missing or circular parent must never make effective settings ambiguous.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  nodes.forEach((node) => {
    if (node.parentId && (!byId.has(node.parentId) || node.parentId === node.id)) node.parentId = null;
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        node.parentId = null;
        break;
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId || null;
    }
  });
  const invalidatedAt = {};
  if (plainObject(source.invalidatedAt)) {
    Object.entries(source.invalidatedAt)
      .map(([id, timestamp]) => [id, isoDate(timestamp)])
      .filter(([id, timestamp]) => validMaterialId(id) && timestamp)
      .sort((left, right) => String(right[1]).localeCompare(String(left[1])))
      .slice(0, MAX_INVALIDATIONS)
      .forEach(([id, timestamp]) => { invalidatedAt[id] = timestamp; });
  }
  const lessonManifests = {};
  if (plainObject(source.lessonManifests)) {
    Object.values(source.lessonManifests).slice(0, 1000).forEach((value) => {
      const node = normalizeNode(value);
      if (node?.type === 'lesson' && node.settings.contentFile && node.settings.repositoryId) {
        const id = lessonNavigation.materialId(node.settings.repositoryId, node.settings.contentFile);
        lessonManifests[id] = { ...node, id, parentId: null };
      }
    });
  }
  return {
    version: 1,
    updatedAt: isoDate(source.updatedAt),
    global: {
      tracking: trackingState(global.tracking, 'ON') === 'OFF' ? 'OFF' : 'ON',
      recordOpens: global.recordOpens !== false,
      showProgress: trackingState(global.showProgress, 'ON') === 'OFF' ? 'OFF' : 'ON'
    },
    invalidatedAt,
    lessonManifests,
    nodes
  };
}

function validMaterialId(value) {
  return typeof value === 'string' && MATERIAL_ID.test(value);
}

function effectiveSettings(catalogInput) {
  const catalog = normalizeCatalog(catalogInput);
  const byId = new Map(catalog.nodes.map((node) => [node.id, node]));
  const cache = new Map();
  const resolve = (node) => {
    if (cache.has(node.id)) return cache.get(node.id);
    const parent = node.parentId && byId.get(node.parentId);
    const parentEffective = parent ? resolve(parent) : {
      tracking: catalog.global.tracking === 'ON',
      showProgress: catalog.global.showProgress === 'ON'
    };
    const value = {
      ...node.progress,
      tracking: node.progress.tracking === 'INHERIT'
        ? parentEffective.tracking : node.progress.tracking === 'ON',
      showProgress: node.progress.showProgress === 'INHERIT'
        ? parentEffective.showProgress : node.progress.showProgress === 'ON'
    };
    cache.set(node.id, value);
    return value;
  };
  catalog.nodes.forEach(resolve);
  return { catalog, byId, effective: cache };
}

function emptyUserDocument(userId, profile = {}) {
  return {
    version: 1,
    revision: 0,
    userId,
    profile: {
      email: oneLine(profile.email, 254).toLowerCase(),
      name: oneLine(profile.name || profile.full_name || profile.fullName, 180)
    },
    preferences: {
      skipMode: 'DEFAULT',
      unlockedStepIds: [],
      lockedStepIds: []
    },
    records: {},
    createdAt: null,
    updatedAt: null,
    lastActivityAt: null
  };
}

function normalizePreferences(input) {
  const source = plainObject(input) ? input : {};
  const skipMode = ['DEFAULT', 'ALLOW', 'DENY'].includes(source.skipMode) ? source.skipMode : 'DEFAULT';
  return {
    skipMode,
    unlockedStepIds: uniqueIds(source.unlockedStepIds),
    lockedStepIds: uniqueIds(source.lockedStepIds)
  };
}

function normalizeUserDocument(input, userId, profile = {}) {
  const source = plainObject(input) ? input : {};
  const result = emptyUserDocument(userId, {
    email: profile.email || source.profile?.email,
    name: profile.name || source.profile?.name
  });
  result.revision = Number.isSafeInteger(source.revision) ? source.revision : 0;
  result.preferences = normalizePreferences(source.preferences);
  result.createdAt = isoDate(source.createdAt);
  result.updatedAt = isoDate(source.updatedAt);
  result.lastActivityAt = isoDate(source.lastActivityAt);
  if (plainObject(source.records)) {
    Object.entries(source.records).slice(0, MAX_RECORDS).forEach(([id, record]) => {
      if (!validMaterialId(id) || !plainObject(record)) return;
      result.records[id] = normalizeRecord(record, userId, id);
    });
  }
  return result;
}

function normalizeRecord(input, userId, id) {
  const source = plainObject(input) ? input : {};
  const progressPercent = clamp(source.progressPercent);
  const completed = source.status === 'completed' || Boolean(source.completedAt) || progressPercent >= 100;
  const opened = Boolean(source.firstOpenedAt) || Number(source.openCount) > 0;
  const status = completed ? 'completed'
    : progressPercent > 0 ? 'in_progress'
      : opened ? 'opened' : 'not_started';
  const details = plainObject(source.details) ? safeObject(source.details) : {};
  if (plainObject(source.details?.lessonAnswers)) {
    details.lessonAnswers = normalizeLessonAnswers(source.details.lessonAnswers);
  }
  return {
    userId,
    materialId: id,
    materialType: materialType(source.materialType),
    status,
    opened,
    firstOpenedAt: isoDate(source.firstOpenedAt),
    lastOpenedAt: isoDate(source.lastOpenedAt),
    openCount: Math.max(0, Math.min(1_000_000, Math.floor(Number(source.openCount) || 0))),
    progressPercent: completed ? 100 : progressPercent,
    lastPosition: plainObject(source.lastPosition) ? safeObject(source.lastPosition) : null,
    completedAt: completed ? isoDate(source.completedAt) : null,
    lastActivityAt: isoDate(source.lastActivityAt),
    details
  };
}

function activeUserDocument(input, catalogInput) {
  const catalog = normalizeCatalog(catalogInput);
  const sourceUserId = input?.userId || 'unknown';
  const user = normalizeUserDocument(input, sourceUserId);
  const activeIds = new Set(catalog.nodes.map((node) => node.id));
  let removed = false;
  Object.entries(user.records).forEach(([id, record]) => {
    const invalidated = catalog.invalidatedAt[id];
    if (!invalidated) return;
    const activity = record.lastActivityAt || record.completedAt || record.lastOpenedAt || record.firstOpenedAt;
    // A progress request may start against the previous catalog and finish just
    // after an administrator removes its material. While the ID is retired,
    // never expose that racing write. If the same ID is deliberately added
    // again, only records created after its invalidation belong to the new node.
    if (!activeIds.has(id) || !activity || Date.parse(activity) <= Date.parse(invalidated)) {
      delete user.records[id];
      removed = true;
    }
  });
  if (removed) {
    user.lastActivityAt = Object.values(user.records)
      .map((record) => record.lastActivityAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  }
  return user;
}

function safeObject(input, depth = 0) {
  if (!plainObject(input) || depth > 2) return {};
  const result = {};
  Object.entries(input).slice(0, 50).forEach(([rawKey, rawValue]) => {
    const key = oneLine(rawKey, 64).replace(/[^A-Za-z0-9_.-]/g, '');
    if (!key) return;
    if (rawValue === null) result[key] = null;
    else if (typeof rawValue === 'boolean') result[key] = rawValue;
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) result[key] = rawValue;
    else if (typeof rawValue === 'string') result[key] = oneLine(rawValue, 500);
    else if (Array.isArray(rawValue)) {
      result[key] = rawValue.slice(0, MAX_VISITED).map((value) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (Array.isArray(value)) {
          return value.slice(0, 2).map((item) => Number.isFinite(Number(item)) ? Number(item) : 0);
        }
        return oneLine(value, 128);
      });
    } else if (plainObject(rawValue)) result[key] = safeObject(rawValue, depth + 1);
  });
  return result;
}

function multiline(value, maximum) {
  return String(value == null ? '' : value)
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maximum);
}

function normalizeLessonAnswer(input, previousInput = {}, now = null) {
  const source = plainObject(input) ? input : {};
  const previous = plainObject(previousInput) ? previousInput : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
  const answer = multiline(has('answer') ? source.answer : previous.answer, MAX_LESSON_ANSWER_CHARS);
  const answeredAt = isoDate(
    has('answeredAt') ? source.answeredAt : previous.answeredAt,
    answer ? isoDate(now || Date.now()) : null
  );
  const updatedAt = isoDate(
    has('updatedAt') ? source.updatedAt : null,
    isoDate(now || Date.now(), answeredAt)
  );
  const aiUsed = has('aiUsed') ? source.aiUsed === true : previous.aiUsed === true;
  const aiResponse = multiline(
    has('aiResponse') ? source.aiResponse : previous.aiResponse,
    MAX_LESSON_AI_RESPONSE_CHARS
  );
  const numericVersion = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 1_000_000_000) : 0;
  };
  return {
    answer,
    answeredAt,
    updatedAt,
    version: numericVersion(has('version') ? source.version : previous.version),
    aiUsed,
    aiCheckedAnswerVersion: numericVersion(
      has('aiCheckedAnswerVersion') ? source.aiCheckedAnswerVersion : previous.aiCheckedAnswerVersion
    ),
    aiResponse,
    aiCheckedAt: isoDate(
      has('aiCheckedAt') ? source.aiCheckedAt : previous.aiCheckedAt,
      null
    )
  };
}

function normalizeLessonAnswers(input, previousInput = {}, now = null) {
  const source = plainObject(input) ? input : {};
  const previous = plainObject(previousInput) ? previousInput : {};
  const result = {};
  Object.entries(source).slice(0, MAX_LESSON_ANSWERS).forEach(([questionId, answer]) => {
    if (!validMaterialId(questionId) || !plainObject(answer)) return;
    result[questionId] = normalizeLessonAnswer(answer, previous[questionId], now);
  });
  return result;
}

function mergeLessonAnswers(existingInput, incomingInput, now) {
  const result = normalizeLessonAnswers(existingInput);
  if (!plainObject(incomingInput)) return result;
  Object.entries(incomingInput).slice(0, MAX_LESSON_ANSWERS).forEach(([questionId, incoming]) => {
    if (!validMaterialId(questionId) || !plainObject(incoming)) return;
    const previous = result[questionId] || {};
    const incomingUpdatedAt = isoDate(incoming.updatedAt);
    const previousUpdatedAt = isoDate(previous.updatedAt);
    const incomingVersion = Number(incoming.version) || 0;
    const previousVersion = Number(previous.version) || 0;
    if (
      incomingVersion < previousVersion
      || (
        incomingUpdatedAt
        && previousUpdatedAt
        && Date.parse(incomingUpdatedAt) < Date.parse(previousUpdatedAt)
      )
    ) return;
    result[questionId] = normalizeLessonAnswer(incoming, previous, now);
  });
  return Object.fromEntries(Object.entries(result).slice(-MAX_LESSON_ANSWERS));
}

function uniqueIds(values) {
  const result = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const id = oneLine(value, 128);
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  });
  return result.slice(0, MAX_VISITED);
}

function unionIds(first, second) {
  return uniqueIds([...(Array.isArray(first) ? first : []), ...(Array.isArray(second) ? second : [])]);
}

function normalizeRanges(values, duration) {
  const max = Number.isFinite(duration) && duration > 0 ? duration : 24 * 60 * 60;
  const ranges = (Array.isArray(values) ? values : [])
    .map((range) => Array.isArray(range) ? [clamp(range[0], 0, max), clamp(range[1], 0, max)] : null)
    .filter((range) => range && range[1] > range[0])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((range) => {
    const previous = merged[merged.length - 1];
    if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
  });
  return merged.slice(0, 500).map((range) => range.map((value) => Math.round(value * 10) / 10));
}

function transitionConditionSatisfied(previous, completed, records) {
  if (previous.requiredToAdvance === false) return true;
  const condition = previous.condition || { type: 'next_click' };
  if (['next_click', 'previous_completed', 'correct_answer'].includes(condition.type)) {
    return completed.has(previous.id);
  }
  const related = condition.materialId ? records?.[condition.materialId] : null;
  if (['material_completed', 'quiz_completed', 'exam_completed'].includes(condition.type)) {
    return related?.status === 'completed';
  }
  const rawScore = related?.details?.scorePercent;
  const score = rawScore !== null && rawScore !== '' && Number.isFinite(Number(rawScore))
    ? Number(rawScore) : null;
  if (condition.type === 'exam_passed') {
    return related?.status === 'completed'
      && related?.details?.passed === true
      && (!Number(condition.minimumScore || 0) || score >= Number(condition.minimumScore));
  }
  if (condition.type === 'minimum_score') {
    return score !== null && score >= Number(condition.minimumScore || 0);
  }
  return false;
}

function validateLessonNavigation(existing, event, node, preferences, records, isAdmin = false) {
  if (!node || node.type !== 'lesson' || event.action !== 'lesson_step') return { ok: true };
  const steps = node.settings.steps;
  if (!steps.length) return { ok: true };
  const targetId = oneLine(event.details?.currentStepId, 128);
  const targetIndex = steps.findIndex((step) => step.id === targetId);
  if (targetIndex < 0) return { ok: false, code: 'UNKNOWN_STEP', status: 400 };
  const override = normalizePreferences(preferences);
  const stepAccess = lessonNavigation.stepOverride(targetId, override, isAdmin);
  if (stepAccess === 'deny') return { ok: false, code: 'STEP_LOCKED', status: 409 };
  if (stepAccess === 'allow') return { ok: true };
  const { sequential } = lessonNavigation.policy(node.settings.navigation, override, isAdmin);
  if (!sequential || targetIndex === 0) return { ok: true };
  const completed = new Set(unionIds(
    existing?.details?.completedStepIds,
    event.details?.completedStepIds
  ));
  const currentIndex = steps.findIndex((step) => step.id === existing?.details?.currentStepId);
  const highestIndex = steps.findIndex((step) => step.id === existing?.details?.highestReachedStepId);
  const furthestKnown = Math.max(0, currentIndex, highestIndex);
  if (targetIndex > furthestKnown + 1) {
    return { ok: false, code: 'STEP_NOT_UNLOCKED', status: 409 };
  }
  const previous = steps[targetIndex - 1];
  if (transitionConditionSatisfied(previous, completed, records)) return { ok: true };
  return { ok: false, code: 'STEP_NOT_UNLOCKED', status: 409 };
}

function mergeProgressEvent(existingInput, eventInput, context) {
  const event = plainObject(eventInput) ? eventInput : {};
  const userId = context.userId;
  const now = isoDate(context.now || Date.now(), new Date().toISOString());
  const node = context.node || null;
  const settings = context.effective || defaultNodeProgress();
  const global = context.global || defaultGlobalSettings();
  const id = event.materialId;
  const existing = existingInput ? normalizeRecord(existingInput, userId, id) : normalizeRecord({}, userId, id);
  const navigation = validateLessonNavigation(existingInput, event, node, context.preferences, context.records, context.isAdmin === true);
  if (!navigation.ok) return navigation;

  const allowedActions = new Set(['open', 'progress', 'complete', 'lesson_step', 'presentation', 'video', 'pdf', 'quiz', 'exam']);
  if (!allowedActions.has(event.action)) return { ok: false, code: 'INVALID_ACTION', status: 400 };
  const typedActions = {
    lesson: new Set(['open', 'lesson_step', 'complete']),
    presentation: new Set(['open', 'presentation', 'complete']),
    video: new Set(['open', 'video', 'complete']),
    pdf: new Set(['open', 'pdf', 'complete']),
    quiz: new Set(['open', 'quiz', 'complete']),
    exam: new Set(['open', 'exam', 'complete'])
  };
  if (node && typedActions[node.type] && !typedActions[node.type].has(event.action)) {
    return { ok: false, code: 'INVALID_ACTION_FOR_MATERIAL', status: 400 };
  }
  if (node?.type === 'lesson' && event.action === 'complete' && node.settings.steps.length) {
    const completed = new Set(unionIds(existing.details.completedStepIds, event.details?.completedStepIds));
    const required = node.settings.steps.filter((step) => step.requiredToAdvance !== false);
    if (required.some((step) => !transitionConditionSatisfied(step, completed, context.records))) {
      return { ok: false, code: 'LESSON_INCOMPLETE', status: 409 };
    }
  }
  const shouldOpen = event.action === 'open' || event.opened === true;
  const canTrack = global.tracking !== 'OFF' && settings.tracking !== false;
  const canOpen = global.recordOpens !== false;
  const openedType = materialType(node?.type || event.materialType || existing.materialType);
  const completesOnOpen = event.action === 'open'
    && canTrack
    && context.isLeaf !== false
    && (openedType === 'presentation' || node?.settings?.manualCompletion !== true)
    && !DOES_NOT_COMPLETE_ON_OPEN.has(openedType);
  if (event.action === 'open' && !canOpen && !completesOnOpen) {
    return { ok: true, record: existingInput || null, changed: false };
  }
  if (!canTrack && !(canOpen && shouldOpen)) return { ok: true, record: existingInput || null, changed: false };

  const record = { ...existing, details: { ...existing.details } };
  record.materialType = materialType(node?.type || event.materialType || record.materialType);
  if (shouldOpen && canOpen) {
    record.opened = true;
    record.firstOpenedAt = record.firstOpenedAt || now;
    record.lastOpenedAt = now;
    record.openCount += 1;
  }
  if (canTrack && event.action !== 'open') {
    const typedEvent = node?.type === 'lesson' && event.action === 'complete'
      ? { ...event, action: 'lesson_step' }
      : event;
    applyTypedProgress(record, typedEvent, node, now);
  }
  if (completesOnOpen) {
    record.progressPercent = 100;
    record.completedAt = record.completedAt || now;
  }
  if (event.action === 'complete' && canTrack) {
    record.progressPercent = 100;
    record.completedAt = record.completedAt || now;
  }
  record.progressPercent = record.completedAt ? 100 : clamp(record.progressPercent);
  if (record.progressPercent >= 100) record.completedAt = record.completedAt || now;
  record.status = record.completedAt || record.progressPercent >= 100 ? 'completed'
    : record.progressPercent > 0 ? 'in_progress'
      : record.opened ? 'opened' : 'not_started';
  record.lastActivityAt = now;
  return { ok: true, record, changed: JSON.stringify(existingInput || null) !== JSON.stringify(record) };
}

function applyTypedProgress(record, event, node, now) {
  const details = plainObject(event.details) ? event.details : {};
  if (plainObject(event.lastPosition)) record.lastPosition = safeObject(event.lastPosition);
  if (Number.isFinite(Number(event.progressPercent))) record.progressPercent = clamp(event.progressPercent);

  if (event.action === 'lesson_step') {
    const completed = unionIds(record.details.completedStepIds, details.completedStepIds);
    if (details.completedStepId) completed.push(oneLine(details.completedStepId, 128));
    record.details.completedStepIds = uniqueIds(completed);
    const steps = node?.settings?.steps || [];
    const currentId = oneLine(details.currentStepId, 128);
    const currentIndex = steps.length
      ? steps.findIndex((step) => step.id === currentId)
      : Math.max(0, Math.floor(Number(details.currentStepIndex) || 0));
    const tracked = steps.length ? steps.filter((step) => step.includeInLesson) : [];
    const completedTracked = steps.length
      ? tracked.filter((step) => record.details.completedStepIds.includes(step.id)).length
      : Math.max(0, Number(details.completedTrackedSteps) || record.details.completedStepIds.length);
    record.details.currentStepId = currentId;
    record.details.currentStepIndex = Math.max(0, currentIndex);
    record.details.lastOpenedStepId = currentId;
    record.details.totalTrackedSteps = tracked.length || Math.max(0, Number(details.totalTrackedSteps) || 0);
    if (plainObject(details.lessonAnswers)) {
      record.details.lessonAnswers = mergeLessonAnswers(
        record.details.lessonAnswers,
        details.lessonAnswers,
        now
      );
    }
    const previousHighest = Math.max(-1, Number(record.details.highestReachedStepIndex) || -1);
    if (currentIndex >= previousHighest) {
      record.details.highestReachedStepIndex = currentIndex;
      record.details.highestReachedStepId = currentId;
    }
    if (record.details.totalTrackedSteps > 0) {
      record.progressPercent = clamp((completedTracked / record.details.totalTrackedSteps) * 100);
    }
    record.lastPosition = { stepId: currentId, stepIndex: Math.max(0, currentIndex) };
  }

  if (event.action === 'presentation') {
    const visited = unionIds(record.details.visitedSlides, details.visitedSlides);
    if (details.lastSlideId != null) visited.push(oneLine(details.lastSlideId, 128));
    record.details.visitedSlides = uniqueIds(visited);
    record.details.lastSlideId = oneLine(details.lastSlideId, 128);
    record.details.lastSlideIndex = Math.max(0, Math.floor(Number(details.lastSlideIndex) || 0));
    record.details.highestReachedSlide = Math.max(
      Number(record.details.highestReachedSlide) || 0,
      Number(details.highestReachedSlide) || record.details.lastSlideIndex + 1
    );
    record.details.totalSlides = Math.max(0, Math.floor(Number(details.totalSlides) || Number(record.details.totalSlides) || 0));
    const total = record.details.totalSlides;
    const mode = node?.settings?.presentationMode || 'highest';
    if (total > 0) {
      if (mode === 'visited') record.progressPercent = clamp((record.details.visitedSlides.length / total) * 100);
      else if (mode === 'required' && node?.settings?.requiredSlideIds?.length) {
        const required = node.settings.requiredSlideIds;
        record.progressPercent = clamp((required.filter((id) => record.details.visitedSlides.includes(id)).length / required.length) * 100);
      } else record.progressPercent = clamp((record.details.highestReachedSlide / total) * 100);
    }
    record.lastPosition = { slideId: record.details.lastSlideId, slideIndex: record.details.lastSlideIndex };
  }

  if (event.action === 'video') {
    const duration = Math.max(0, Number(details.duration) || Number(record.details.duration) || 0);
    const ranges = normalizeRanges([
      ...(Array.isArray(record.details.watchedRanges) ? record.details.watchedRanges : []),
      ...(Array.isArray(details.watchedRanges) ? details.watchedRanges : [])
    ], duration);
    const watched = ranges.reduce((sum, range) => sum + (range[1] - range[0]), 0);
    record.details.playbackStarted = Boolean(record.details.playbackStarted || details.playbackStarted);
    record.details.duration = duration;
    record.details.lastPlaybackPosition = clamp(details.lastPlaybackPosition, 0, duration || 24 * 60 * 60);
    record.details.watchedRanges = ranges;
    record.details.watchedSeconds = Math.round(watched * 10) / 10;
    if (duration > 0) record.progressPercent = clamp((watched / duration) * 100);
    const threshold = node?.settings?.videoCompletionThreshold || 90;
    if (record.progressPercent >= threshold) {
      record.progressPercent = 100;
      record.completedAt = record.completedAt || now;
    }
    record.lastPosition = { seconds: record.details.lastPlaybackPosition, duration };
  }

  if (event.action === 'pdf') {
    record.details.lastPage = Math.max(1, Math.floor(Number(details.lastPage) || 1));
    record.details.highestVisitedPage = Math.max(
      Number(record.details.highestVisitedPage) || 0,
      Math.floor(Number(details.highestVisitedPage) || record.details.lastPage)
    );
    record.details.totalPages = Math.max(0, Math.floor(Number(details.totalPages) || Number(record.details.totalPages) || 0));
    if (record.details.totalPages > 0) {
      record.progressPercent = clamp((record.details.highestVisitedPage / record.details.totalPages) * 100);
    }
    record.details.navigationOnly = true;
    record.lastPosition = { page: record.details.lastPage, totalPages: record.details.totalPages };
  }

  if (event.action === 'quiz') {
    record.details.started = Boolean(record.details.started || details.started);
    const previousAttempts = Math.max(0, Math.floor(Number(record.details.attempts) || 0));
    const incomingAttempts = Object.hasOwn(details, 'attempts') && Number.isFinite(Number(details.attempts))
      ? Math.max(0, Math.floor(Number(details.attempts))) : previousAttempts;
    const isLatestAttempt = incomingAttempts >= previousAttempts;
    if (isLatestAttempt && Object.hasOwn(details, 'scorePercent')) {
      if (details.scorePercent == null) record.details.scorePercent = null;
      else if (details.scorePercent !== '' && Number.isFinite(Number(details.scorePercent))) {
        record.details.scorePercent = clamp(details.scorePercent);
      }
    } else if (!Object.hasOwn(record.details, 'scorePercent')) record.details.scorePercent = null;
    record.details.attempts = Math.max(previousAttempts, incomingAttempts);
    if (isLatestAttempt && (typeof details.passed === 'boolean' || details.passed === null)) record.details.passed = details.passed;
    if (isLatestAttempt && ['graded', 'pending_review', 'not_scored'].includes(details.gradingStatus)) {
      record.details.gradingStatus = details.gradingStatus;
    }
    if (isLatestAttempt && typeof details.attemptId === 'string') record.details.attemptId = oneLine(details.attemptId, 128);
    if (details.completed === true) {
      record.progressPercent = 100;
      record.completedAt = record.completedAt || now;
    }
  }

  if (event.action === 'exam') {
    const totalQuestions = Math.max(0, Math.floor(Number(details.totalQuestions) || Number(record.details.totalQuestions) || 0));
    const answeredQuestions = Math.max(0, Math.min(totalQuestions || Number.MAX_SAFE_INTEGER,
      Math.floor(Number(details.answeredQuestions) || Number(record.details.answeredQuestions) || 0)));
    record.details.started = Boolean(record.details.started || details.started);
    record.details.completed = details.completed === true || record.details.completed === true;
    record.details.answeredQuestions = answeredQuestions;
    record.details.totalQuestions = totalQuestions;
    record.details.currentQuestionIndex = Math.max(0, Math.floor(Number(details.currentQuestionIndex) || 0));
    record.details.attemptId = oneLine(details.attemptId || record.details.attemptId, 128);
    record.details.attempts = Math.max(0, Math.floor(Number(details.attempts) || Number(record.details.attempts) || 0));
    if (typeof details.studentResultVisible === 'boolean') {
      record.details.studentResultVisible = details.studentResultVisible;
    }
    if (Object.hasOwn(details, 'scorePercent')) {
      if (details.scorePercent === null) record.details.scorePercent = null;
      else if (details.scorePercent !== '' && Number.isFinite(Number(details.scorePercent))) {
        record.details.scorePercent = clamp(details.scorePercent);
      }
    } else if (!Object.hasOwn(record.details, 'scorePercent')) record.details.scorePercent = null;
    if (typeof details.passed === 'boolean' || details.passed === null) record.details.passed = details.passed;
    if (['graded', 'pending_review', 'not_scored'].includes(details.gradingStatus)) record.details.gradingStatus = details.gradingStatus;
    if (Number.isFinite(Number(details.durationSeconds))) {
      record.details.durationSeconds = Math.max(0, Math.floor(Number(details.durationSeconds)));
    }
    if (details.completed === true) {
      record.progressPercent = 100;
      record.completedAt = record.completedAt || now;
    } else if (totalQuestions > 0) {
      record.progressPercent = clamp((answeredQuestions / totalQuestions) * 100);
    }
    record.lastPosition = {
      questionIndex: record.details.currentQuestionIndex,
      answeredQuestions,
      totalQuestions
    };
  }
}

function recordProgress(record) {
  return record ? clamp(record.progressPercent) : 0;
}

function aggregateRecordForNode(user, node) {
  const direct = user.records[node.id] || null;
  if (node.type !== 'exam' || !node.settings.examId) return direct;
  const repositoryId = node.settings.repositoryId || 'default';
  const canonicalId = `exam:${repositoryId}:${node.settings.examId}`.slice(0, 128);
  const canonical = validMaterialId(canonicalId) ? user.records[canonicalId] || null : null;
  if (!canonical) return direct;
  if (!direct) return { ...canonical, materialId: node.id };
  const directPercent = recordProgress(direct);
  const canonicalPercent = recordProgress(canonical);
  if (canonicalPercent < directPercent) return direct;
  if (canonicalPercent === directPercent) {
    const directActivity = Date.parse(direct.lastActivityAt || direct.completedAt || 0) || 0;
    const canonicalActivity = Date.parse(canonical.lastActivityAt || canonical.completedAt || 0) || 0;
    if (directActivity >= canonicalActivity) return direct;
  }
  return { ...canonical, materialId: node.id };
}

function aggregateUser(userInput, catalogInput) {
  const { catalog, byId, effective } = effectiveSettings(catalogInput);
  const user = activeUserDocument(userInput, catalog);
  const children = new Map();
  catalog.nodes.forEach((node) => {
    const parent = node.parentId || '__root__';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  });
  const result = {};
  const calculate = (node) => {
    if (result[node.id]) return result[node.id];
    const nested = children.get(node.id) || [];
    if (!nested.length) {
      const record = aggregateRecordForNode(user, node);
      const tracked = effective.get(node.id)?.tracking !== false && !NON_AGGREGATED_LEAF_TYPES.has(node.type);
      result[node.id] = {
        materialId: node.id,
        title: node.title,
        materialType: node.type,
        progressPercent: recordProgress(record),
        status: record?.status || 'not_started',
        opened: Boolean(record?.opened),
        tracked,
        showProgress: effective.get(node.id)?.showProgress !== false,
        completedCount: tracked && record?.status === 'completed' ? 1 : 0,
        trackedCount: tracked ? 1 : 0,
        record
      };
      return result[node.id];
    }
    const contributions = nested
      .map((child) => ({ node: child, aggregate: calculate(child) }))
      .filter((item) => item.aggregate.trackedCount > 0);
    const denominator = contributions.reduce((sum, item) => sum + item.node.progress.weight, 0);
    const numerator = contributions.reduce(
      (sum, item) => sum + item.aggregate.progressPercent * item.node.progress.weight,
      0
    );
    const percent = denominator > 0 ? clamp(numerator / denominator) : 0;
    result[node.id] = {
      materialId: node.id,
      title: node.title,
      materialType: node.type,
      progressPercent: percent,
      status: percent >= 100 ? 'completed' : percent > 0 ? 'in_progress' : 'not_started',
      opened: contributions.some((item) => item.aggregate.opened),
      tracked: effective.get(node.id)?.tracking !== false,
      showProgress: effective.get(node.id)?.showProgress !== false,
      completedCount: contributions.reduce((sum, item) => sum + item.aggregate.completedCount, 0),
      trackedCount: contributions.reduce((sum, item) => sum + item.aggregate.trackedCount, 0),
      record: null
    };
    return result[node.id];
  };
  catalog.nodes.forEach(calculate);
  const courseNode = catalog.nodes.find((node) => node.type === 'course' && !node.parentId);
  let course = courseNode ? result[courseNode.id] : null;
  if (!course) {
    const roots = (children.get('__root__') || [])
      .map((node) => ({ node, aggregate: calculate(node) }))
      .filter((item) => item.aggregate.trackedCount > 0);
    const denominator = roots.reduce((sum, item) => sum + item.node.progress.weight, 0);
    const numerator = roots.reduce((sum, item) => sum + item.aggregate.progressPercent * item.node.progress.weight, 0);
    const percent = denominator > 0 ? clamp(numerator / denominator) : 0;
    course = {
      materialId: 'course', title: 'Kurs', materialType: 'course', progressPercent: percent,
      status: percent >= 100 ? 'completed' : percent > 0 ? 'in_progress' : 'not_started',
      opened: roots.some((item) => item.aggregate.opened), tracked: catalog.global.tracking === 'ON',
      showProgress: catalog.global.showProgress === 'ON',
      completedCount: roots.reduce((sum, item) => sum + item.aggregate.completedCount, 0),
      trackedCount: roots.reduce((sum, item) => sum + item.aggregate.trackedCount, 0), record: null
    };
    result.course = course;
  }
  const trackedLeaves = catalog.nodes
    .filter((node) => (
      !(children.get(node.id) || []).length
      && effective.get(node.id)?.tracking !== false
      && !NON_AGGREGATED_LEAF_TYPES.has(node.type)
    ))
    .map((node) => result[node.id]);
  return {
    course,
    nodes: result,
    counts: {
      completed: trackedLeaves.filter((leaf) => leaf.status === 'completed').length,
      started: trackedLeaves.filter((leaf) => ['opened', 'in_progress'].includes(leaf.status)).length,
      opened: trackedLeaves.filter((leaf) => leaf.opened).length,
      notOpened: Math.max(0, course.trackedCount - trackedLeaves.filter((leaf) => leaf.opened).length)
    },
    lastActivityAt: user.lastActivityAt
  };
}

function sequenceAccessMap(catalogInput, aggregateInput, preferencesInput) {
  const catalog = normalizeCatalog(catalogInput);
  const nodes = aggregateInput?.nodes && plainObject(aggregateInput.nodes)
    ? aggregateInput.nodes
    : {};
  const preferences = normalizePreferences(preferencesInput);
  const unlocked = new Set(preferences.unlockedStepIds);
  const explicitlyLocked = new Set(preferences.lockedStepIds);
  const byId = new Map(catalog.nodes.map((node) => [node.id, node]));
  const children = new Map();
  catalog.nodes.forEach((node, sourceIndex) => {
    if (!node.parentId) return;
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push({ node, sourceIndex });
  });
  children.forEach((entries) => entries.sort((left, right) => (
    left.node.order - right.node.order || left.sourceIndex - right.sourceIndex
  )));

  const access = {};
  catalog.nodes.forEach((node) => {
    const parent = node.parentId && byId.get(node.parentId);
    if (!parent || parent.settings.navigation !== 'sequential') return;
    const siblings = children.get(parent.id) || [];
    const index = siblings.findIndex((entry) => entry.node.id === node.id);
    const unmet = siblings.slice(0, Math.max(0, index)).find((entry) => {
      const progress = nodes[entry.node.id];
      return !progress || (progress.tracked !== false && progress.status !== 'completed');
    });
    const manuallyUnlocked = preferences.skipMode === 'ALLOW' || unlocked.has(node.id);
    const locked = explicitlyLocked.has(node.id) || (!manuallyUnlocked && Boolean(unmet));
    access[node.id] = {
      allowed: !locked,
      locked,
      sequenceId: parent.id,
      step: index + 1,
      totalSteps: siblings.length,
      prerequisiteId: unmet?.node.id || null,
      prerequisiteTitle: unmet?.node.title || null
    };
  });
  return access;
}

function distributionBucket(percent) {
  const value = clamp(percent);
  if (value < 25) return '0-25';
  if (value < 50) return '25-50';
  if (value < 75) return '50-75';
  return '75-100';
}

function globalReport(users, catalog) {
  const reports = (Array.isArray(users) ? users : []).map((input) => {
    const user = activeUserDocument(input, catalog);
    return { user, aggregate: aggregateUser(user, catalog) };
  });
  const distribution = { '0-25': 0, '25-50': 0, '50-75': 0, '75-100': 0 };
  reports.forEach(({ aggregate }) => { distribution[distributionBucket(aggregate.course.progressPercent)] += 1; });
  const total = reports.length;
  const materialStats = new Map();
  const parentIds = new Set(catalog.nodes.map((node) => node.parentId).filter(Boolean));
  reports.forEach(({ user }) => {
    catalog.nodes.forEach((node) => {
      if (parentIds.has(node.id)) return;
      const stats = materialStats.get(node.id) || { materialId: node.id, title: node.title, opened: 0, completed: 0, abandoned: 0, stops: {} };
      const record = user.records[node.id];
      if (record?.opened) stats.opened += 1;
      if (record?.status === 'completed') stats.completed += 1;
      if (record?.opened && record.status !== 'completed') stats.abandoned += 1;
      const stop = record?.details?.currentStepId || record?.details?.lastSlideId || record?.details?.lastPlaybackPosition;
      if (stop != null && stop !== '') stats.stops[String(stop)] = (stats.stops[String(stop)] || 0) + 1;
      materialStats.set(node.id, stats);
    });
  });
  const materials = [...materialStats.values()].map((stats) => ({
    ...stats,
    notOpened: Math.max(0, total - stats.opened),
    commonStop: Object.entries(stats.stops).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  }));
  return {
    users: total,
    averageProgress: total ? reports.reduce((sum, item) => sum + item.aggregate.course.progressPercent, 0) / total : 0,
    starts: reports.filter((item) => item.aggregate.counts.opened > 0).length,
    completions: reports.filter((item) => item.aggregate.course.status === 'completed').length,
    distribution,
    mostUnopened: materials.sort((a, b) => b.notOpened - a.notOpened).slice(0, 10),
    mostAbandoned: [...materials].sort((a, b) => b.abandoned - a.abandoned).slice(0, 10)
  };
}

// A pool can appear under a dashboard tile ID as well as its canonical quiz ID.
// Reset the shared learning state together; legacy quizzes are unaffected.
function studyResetIds(catalog, ids, records) {
  const result = new Set(ids), canonical = (node) => node?.type === 'quiz' && node.settings?.quizId
    ? `quiz:${node.settings.repositoryId || 'default'}:${node.settings.quizId}` : null;
  for (const id of ids) {
    const key = records[id]?.details?.studyGeneration ? id : canonical(catalog.nodes.find((node) => node.id === id));
    if (!key || !records[key]?.details?.studyGeneration) continue;
    result.add(key);
    catalog.nodes.forEach((node) => { if (canonical(node) === key) result.add(node.id); });
  }
  return [...result];
}

module.exports = {
  MATERIAL_TYPES,
  MAX_RECORDS,
  MAX_LESSON_ANSWERS,
  STATUS_VALUES,
  TRACKING_STATES,
  aggregateUser,
  activeUserDocument,
  clamp,
  defaultGlobalSettings,
  defaultNodeProgress,
  distributionBucket,
  effectiveSettings,
  emptyUserDocument,
  globalReport,
  mergeProgressEvent,
  normalizeLessonAnswers,
  normalizeCatalog,
  normalizePreferences,
  normalizeRanges,
  normalizeRecord,
  normalizeUserDocument,
  plainObject,
  sequenceAccessMap,
  studyResetIds,
  validMaterialId
};
