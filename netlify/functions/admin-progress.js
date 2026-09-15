'use strict';

const lessonNavigation = require('../../public/assets/js/lesson-navigation.js');

const {
  activeUserDocument,
  aggregateUser,
  globalReport,
  normalizeCatalog,
  normalizePreferences,
  plainObject,
  studyResetIds,
  validMaterialId
} = require('../progress-common.js');
const {
  appendAudit,
  getProgressStore,
  listEntries,
  readCatalog,
  readUser,
  setStoreFactory,
  storageConfig,
  updateUser,
  writeCatalog
} = require('../progress-storage.js');
const {
  json,
  mutationGuard,
  parseJsonBody,
  requireAdmin,
  responseForFailure
} = require('../admin-common.js');

const MAX_BODY_BYTES = 1024 * 1024;
const ADMIN_ACTIONS = new Set([
  'catalog', 'lesson_manifest', 'preference', 'mark_completed', 'mark_incomplete', 'set_step', 'unlock_step', 'lock_step'
]);

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') return emptyOptions();
  if (!['GET', 'PUT', 'DELETE'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, DELETE, OPTIONS' });
  }
  if (method !== 'GET') {
    const guard = mutationGuard(event, { maxBodyBytes: MAX_BODY_BYTES });
    if (!guard.ok) return responseForFailure(guard);
  }
  const auth = await requireAdmin(event, context);
  if (!auth.ok) return responseForFailure(auth);

  let store;
  try { store = getProgressStore(); }
  catch (error) {
    console.error('Admin progress Blob store initialization failed', safeErrorName(error));
    return json({ error: 'PROGRESS_STORAGE_UNAVAILABLE' }, 503);
  }
  try {
    if (method === 'GET') return await handleGet(event, store);
    if (method === 'PUT') return await handlePut(event, store, auth);
    return await handleReset(event, store, auth);
  } catch (error) {
    console.error('admin-progress failed', safeErrorName(error));
    if (error?.code === 'PROGRESS_CONFLICT') return json({ error: 'PROGRESS_CONFLICT' }, 409);
    return json({ error: 'PROGRESS_STORAGE_UNAVAILABLE' }, 503);
  }
};

async function handleGet(event, store) {
  const query = event.queryStringParameters || {};
  const view = String(query.view || 'users');
  const catalog = await readCatalog(store);
  if (view === 'config') return json({ catalog });
  if (view === 'user') {
    const targetUserId = validateTargetUserId(query.userId);
    if (!targetUserId.ok) return json({ error: targetUserId.code }, 400);
    const stored = await readUser(store, targetUserId.value);
    const user = activeUserDocument(stored.document, catalog);
    return json({ user, aggregate: aggregateUser(user, catalog), catalog });
  }
  if (view === 'audit') {
    const page = await listEntries(store, {
      prefix: 'audit/', cursor: safeCursor(query.cursor), limit: safeLimit(query.limit, 50)
    });
    return json({ audit: page.entries.map((entry) => entry.value), cursor: page.cursor });
  }
  if (!['users', 'global'].includes(view)) return json({ error: 'INVALID_VIEW' }, 400);

  const page = await listEntries(store, {
    prefix: 'users/', cursor: safeCursor(query.cursor), limit: safeLimit(query.limit, view === 'global' ? 200 : 100)
  });
  const documents = page.entries.map((entry) => entry.value).filter((entry) => plainObject(entry));
  if (view === 'global') return json({ report: globalReport(documents, catalog), cursor: page.cursor });
  let rows = documents.map((user) => {
    const aggregate = aggregateUser(user, catalog);
    return {
      id: user.userId,
      name: user.profile?.name || '',
      email: user.profile?.email || '',
      progressPercent: aggregate.course.progressPercent,
      completed: aggregate.counts.completed,
      started: aggregate.counts.started,
      notOpened: aggregate.counts.notOpened,
      lastActivityAt: aggregate.lastActivityAt
    };
  });
  const search = String(query.search || '').trim().toLocaleLowerCase('pl').slice(0, 120);
  if (search) rows = rows.filter((row) => `${row.name} ${row.email} ${row.id}`.toLocaleLowerCase('pl').includes(search));
  const filter = String(query.filter || 'all');
  if (filter === 'completed') rows = rows.filter((row) => row.progressPercent >= 100);
  if (filter === 'started') rows = rows.filter((row) => row.progressPercent > 0 && row.progressPercent < 100);
  if (filter === 'not_started') rows = rows.filter((row) => row.progressPercent <= 0);
  const direction = query.direction === 'asc' ? 1 : -1;
  const sort = ['name', 'email', 'progressPercent', 'lastActivityAt'].includes(query.sort) ? query.sort : 'lastActivityAt';
  rows.sort((left, right) => compare(left[sort], right[sort]) * direction);
  return json({ users: rows, cursor: page.cursor, catalog });
}

async function handlePut(event, store, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const body = parsed.value;
  if (!ADMIN_ACTIONS.has(body.action)) return json({ error: 'INVALID_ACTION' }, 400);
  if (body.action === 'catalog') return updateCatalog(body, store, auth);
  if (body.action === 'lesson_manifest') return updateLessonManifest(body, store, auth);
  const target = validateTargetUserId(body.targetUserId);
  if (!target.ok) return json({ error: target.code }, 400);
  return updateTarget(body, store, auth, target.value);
}

async function updateLessonManifest(body, store, auth) {
  const filename = typeof body.filename === 'string' && /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.md$/i.test(body.filename)
    ? body.filename : '';
  const repositoryId = typeof body.repositoryId === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(body.repositoryId)
    ? body.repositoryId : '';
  if (!filename || !repositoryId || !plainObject(body.manifest)) return json({ error: 'INVALID_LESSON_MANIFEST' }, 400);
  const previous = await readCatalog(store);
  const steps = Array.isArray(body.manifest.steps) ? body.manifest.steps : [];
  const nodes = previous.nodes.map((node) => {
    if (
      node.type !== 'lesson'
      || node.settings.contentFile !== filename
      || (node.settings.repositoryId || 'default') !== repositoryId
    ) return node;
    return {
      ...node,
      settings: {
        ...node.settings,
        navigation: body.manifest.navigation === 'free' ? 'free' : 'sequential',
        steps
      }
    };
  });
  const changed = nodes.filter((node, index) => node !== previous.nodes[index]).length;
  // Keep a manifest even when a lesson has not been placed on the Dashboard yet.
  const manifestId = lessonNavigation.materialId(repositoryId, filename);
  const lessonManifests = {
    ...previous.lessonManifests,
    [manifestId]: {
      id: manifestId, type: 'lesson', title: filename,
      settings: { contentFile: filename, repositoryId, navigation: body.manifest.navigation === 'free' ? 'free' : 'sequential', steps }
    }
  };
  const catalog = normalizeCatalog({ ...previous, nodes, lessonManifests });
  await writeCatalog(store, catalog, auth.userId);
  await appendAudit(store, {
    adminId: auth.userId,
    targetUserId: null,
    action: 'progress.lesson_manifest.update',
    materialId: null,
    previousValue: { filename, repositoryId, matchedMaterials: changed },
    newValue: { filename, repositoryId, navigation: body.manifest.navigation, stepCount: steps.length }
  });
  return json({ saved: true, matchedMaterials: changed });
}

async function updateCatalog(body, store, auth) {
  if (!plainObject(body.catalog)) return json({ error: 'INVALID_CATALOG' }, 400);
  const previous = await readCatalog(store);
  const incoming = normalizeCatalog(body.catalog);
  // Dashboard editors do not own step-level lesson settings. Publishing the
  // Dashboard must not silently reset an already published lesson to free mode.
  incoming.lessonManifests = previous.lessonManifests;
  incoming.nodes = incoming.nodes.map((node) => {
    if (node.type !== 'lesson') return node;
    const repositoryId = node.settings.repositoryId || 'default';
    const filename = node.settings.contentFile;
    const manifest = previous.lessonManifests[lessonNavigation.materialId(repositoryId, filename)]
      || previous.nodes.find((entry) => entry.type === 'lesson' && entry.settings.contentFile === filename
        && (entry.settings.repositoryId || 'default') === repositoryId && entry.settings.steps.length);
    if (!manifest) return node;
    return { ...node, settings: { ...node.settings, navigation: manifest.settings.navigation, steps: manifest.settings.steps } };
  });
  const nextIds = new Set(incoming.nodes.map((node) => node.id));
  const removedIds = previous.nodes.map((node) => node.id).filter((id) => !nextIds.has(id));
  const invalidatedAt = { ...previous.invalidatedAt, ...incoming.invalidatedAt };
  const removedAt = new Date().toISOString();
  removedIds.forEach((id) => { invalidatedAt[id] = removedAt; });
  const catalog = normalizeCatalog({ ...incoming, invalidatedAt });
  if (catalog.nodes.length > 10_000) return json({ error: 'CATALOG_TOO_LARGE' }, 400);
  await writeCatalog(store, catalog, auth.userId);
  await appendAudit(store, {
    adminId: auth.userId,
    targetUserId: null,
    action: 'progress.catalog.update',
    materialId: null,
    previousValue: { global: previous.global, nodeCount: previous.nodes.length },
    newValue: { global: catalog.global, nodeCount: catalog.nodes.length, removedCount: removedIds.length }
  });
  return json({ saved: true, catalog, removedCount: removedIds.length });
}

async function updateTarget(body, store, auth, targetUserId) {
  const catalog = await readCatalog(store);
  let audit = null;
  let validationError = null;
  const outcome = await updateUser(store, targetUserId, {}, (document) => {
    const active = activeUserDocument(document, catalog);
    document.records = active.records;
    document.lastActivityAt = active.lastActivityAt;
    const result = applyAdminAction(document, body, catalog);
    if (!result.ok) {
      validationError = result;
      return { abort: true, result };
    }
    audit = result.audit;
    document.lastActivityAt = new Date().toISOString();
    return { document, result: { record: result.record, preferences: document.preferences } };
  });
  if (validationError) return json({ error: validationError.code }, validationError.status || 400);
  await appendAudit(store, { adminId: auth.userId, targetUserId, ...audit });
  return json({ saved: outcome.modified, ...outcome.result });
}

function applyAdminAction(document, body, catalog) {
  if (body.action === 'preference') {
    if (!plainObject(body.preferences)) return { ok: false, code: 'INVALID_PREFERENCES' };
    const previous = document.preferences;
    document.preferences = normalizePreferences({ ...previous, ...body.preferences });
    return {
      ok: true,
      record: null,
      audit: { action: 'progress.preference.update', materialId: null, previousValue: previous, newValue: document.preferences }
    };
  }
  if (!validMaterialId(body.materialId)) return { ok: false, code: 'INVALID_MATERIAL_ID' };
  const materialId = body.materialId;
  const previous = document.records[materialId] ? structuredClone(document.records[materialId]) : null;
  const now = new Date().toISOString();
  const node = catalog.nodes.find((candidate) => candidate.id === materialId);
  const record = document.records[materialId] || {
    userId: document.userId,
    materialId,
    materialType: node?.type || 'other',
    status: 'not_started', opened: false, firstOpenedAt: null, lastOpenedAt: null, openCount: 0,
    progressPercent: 0, lastPosition: null, completedAt: null, lastActivityAt: now, details: {}
  };

  if (body.action === 'mark_completed') {
    record.progressPercent = 100;
    record.status = 'completed';
    record.completedAt = record.completedAt || now;
  } else if (body.action === 'mark_incomplete') {
    record.progressPercent = Math.min(99, Math.max(0, Number(body.progressPercent) || 0));
    record.status = record.progressPercent > 0 ? 'in_progress' : record.opened ? 'opened' : 'not_started';
    record.completedAt = null;
  } else if (body.action === 'set_step') {
    const stepId = String(body.stepId || '').trim();
    const steps = node?.settings?.steps || [];
    const index = steps.findIndex((step) => step.id === stepId);
    if (!stepId || (steps.length && index < 0)) return { ok: false, code: 'UNKNOWN_STEP' };
    record.details = { ...record.details, currentStepId: stepId, currentStepIndex: Math.max(0, index) };
    record.lastPosition = { stepId, stepIndex: Math.max(0, index) };
  } else if (body.action === 'unlock_step' || body.action === 'lock_step') {
    const stepId = String(body.stepId || '').trim();
    if (!stepId || stepId.length > 128) return { ok: false, code: 'UNKNOWN_STEP' };
    const unlock = new Set(document.preferences.unlockedStepIds);
    const lock = new Set(document.preferences.lockedStepIds);
    if (body.action === 'unlock_step') { unlock.add(stepId); lock.delete(stepId); }
    else { lock.add(stepId); unlock.delete(stepId); }
    document.preferences.unlockedStepIds = [...unlock].slice(0, 1_000);
    document.preferences.lockedStepIds = [...lock].slice(0, 1_000);
  }
  record.lastActivityAt = now;
  document.records[materialId] = record;
  return {
    ok: true,
    record,
    audit: {
      action: `progress.${body.action}`,
      materialId,
      previousValue: previous,
      newValue: body.action === 'unlock_step' || body.action === 'lock_step'
        ? document.preferences : record
    }
  };
}

async function handleReset(event, store, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const body = parsed.value;
  const target = validateTargetUserId(body.targetUserId);
  if (!target.ok) return json({ error: target.code }, 400);
  const scope = ['material', 'section', 'department', 'course'].includes(body.scope) ? body.scope : '';
  if (!scope) return json({ error: 'INVALID_SCOPE' }, 400);
  if (scope !== 'course' && !validMaterialId(body.materialId)) return json({ error: 'INVALID_MATERIAL_ID' }, 400);
  const catalog = await readCatalog(store);
  const ids = resetIds(catalog, scope, body.materialId);
  let previous = null;
  const outcome = await updateUser(store, target.value, {}, (document) => {
    previous = {};
    const requested = scope === 'course' ? [...ids, ...Object.keys(document.records).filter((id) => document.records[id]?.details?.studyGeneration)] : ids;
    studyResetIds(catalog, requested, document.records).forEach((id) => {
      if (document.records[id]) previous[id] = document.records[id];
      delete document.records[id];
    });
    const changed = Object.keys(previous).length > 0;
    return changed ? { document, result: { removed: Object.keys(previous).length } } : { abort: true, result: { removed: 0 } };
  });
  await appendAudit(store, {
    adminId: auth.userId,
    targetUserId: target.value,
    action: `progress.reset.${scope}`,
    materialId: scope === 'course' ? null : body.materialId,
    previousValue: previous,
    newValue: null
  });
  return json({ reset: true, removed: outcome.result?.removed || 0 });
}

function resetIds(catalog, scope, materialId) {
  if (scope === 'course') return catalog.nodes.map((node) => node.id);
  if (scope === 'material') return [materialId];
  const ids = new Set([materialId]);
  let changed = true;
  while (changed) {
    changed = false;
    catalog.nodes.forEach((node) => {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    });
  }
  return [...ids];
}

function validateTargetUserId(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, code: 'INVALID_TARGET_USER' };
  }
  return { ok: true, value };
}

function safeCursor(value) {
  return typeof value === 'string' && value.length <= 2_048 && !/[\u0000-\u001f\u007f]/.test(value) ? value : '';
}

function safeLimit(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(1, Math.min(200, number)) : fallback;
}

function compare(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left || '').localeCompare(String(right || ''), 'pl', { sensitivity: 'base' });
}

function emptyOptions() {
  return {
    statusCode: 204,
    headers: { Allow: 'GET, PUT, DELETE, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' },
    body: ''
  };
}

function safeErrorName(error) {
  return error && error.name ? String(error.name) : 'Error';
}

exports._test = {
  applyAdminAction,
  resetIds,
  setStoreFactory,
  storageConfig,
  validateTargetUserId
};
