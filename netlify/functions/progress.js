'use strict';

const {
  activeUserDocument,
  aggregateUser,
  effectiveSettings,
  mergeProgressEvent,
  plainObject,
  sequenceAccessMap,
  studyResetIds,
  validMaterialId
} = require('../progress-common.js');
const {
  getProgressStore,
  readCatalog,
  readUser,
  setStoreFactory,
  storageConfig,
  updateUser
} = require('../progress-storage.js');
const {
  json,
  mutationGuard,
  parseJsonBody,
  requireCourseAccess,
  responseForFailure
} = require('../admin-common.js');

const MAX_BODY_BYTES = 128 * 1024;
const ALLOWED_EVENT_FIELDS = new Set([
  'materialId', 'materialType', 'action', 'opened', 'progressPercent', 'lastPosition', 'details'
]);

exports.handler = async (event = {}, context = {}) => {
  const method = String(event.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') return emptyOptions();
  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, DELETE, OPTIONS' });
  }
  if (method !== 'GET') {
    const guard = mutationGuard(event, { maxBodyBytes: MAX_BODY_BYTES });
    if (!guard.ok) return responseForFailure(guard);
  }
  const auth = await requireCourseAccess(event, context);
  if (!auth.ok) return responseForFailure(auth);

  let store;
  try { store = getProgressStore(); }
  catch (error) {
    console.error('Progress Blob store initialization failed', safeErrorName(error));
    return json({ error: 'PROGRESS_STORAGE_UNAVAILABLE' }, 503);
  }

  try {
    if (['study', 'study-summary', 'study-catalog'].includes(event.queryStringParameters?.view)) return await require('../study-progress').handle(event, store, auth);
    if (method === 'GET') return await handleGet(event, store, auth);
    if (method === 'POST') return await handleEvent(event, store, auth);
    return await handleReset(event, store, auth);
  } catch (error) {
    console.error('progress function failed', safeErrorName(error));
    if (error && error.code === 'PROGRESS_CONFLICT') return json({ error: 'PROGRESS_CONFLICT' }, 409);
    return json({ error: 'PROGRESS_STORAGE_UNAVAILABLE' }, 503);
  }
};

async function handleGet(event, store, auth) {
  const query = event.queryStringParameters || {};
  if (Object.keys(query).some((key) => key !== 'materialId')) {
    return json({ error: 'UNEXPECTED_QUERY' }, 400);
  }
  const [catalog, stored] = await Promise.all([
    readCatalog(store),
    readUser(store, auth.userId, profileFrom(auth.user))
  ]);
  const materialId = String(query.materialId || '');
  if (materialId && !validMaterialId(materialId)) return json({ error: 'INVALID_MATERIAL_ID' }, 400);
  const user = activeUserDocument(stored.document, catalog);
  const aggregate = aggregateUser(user, catalog);
  const access = isAdminAccount(auth) ? {} : sequenceAccessMap(catalog, aggregate, user.preferences);
  return json({
    version: 1,
    userId: auth.userId,
    catalog,
    preferences: user.preferences,
    records: materialId ? { [materialId]: user.records[materialId] || null } : user.records,
    aggregate,
    access: materialId ? { [materialId]: access[materialId] || null } : access,
    revision: user.revision
  });
}

async function handleEvent(event, store, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const validation = validateEvent(parsed.value);
  if (!validation.ok) return json({ error: validation.code }, validation.status || 400);
  const progressEvent = validation.value;
  const catalog = await readCatalog(store);
  const resolved = effectiveSettings(catalog);
  const node = resolved.byId.get(progressEvent.materialId) || catalog.lessonManifests[progressEvent.materialId] || null;
  if (!node && catalog.invalidatedAt[progressEvent.materialId]) {
    return json({
      saved: false,
      record: null,
      effective: { tracking: false, showProgress: false, recordOpens: catalog.global.recordOpens }
    });
  }
  const effective = resolved.effective.get(node?.id) || { tracking: true, showProgress: true };
  const isLeaf = !node || !catalog.nodes.some((candidate) => candidate.parentId === node.id);
  let rejected = null;
  const outcome = await updateUser(store, auth.userId, profileFrom(auth.user), (document) => {
    const active = activeUserDocument(document, catalog);
    document.records = active.records;
    document.lastActivityAt = active.lastActivityAt;
    const access = node
      ? sequenceAccessMap(catalog, aggregateUser(active, catalog), active.preferences)[node.id]
      : null;
    if (access?.allowed === false && !isAdminAccount(auth)) {
      rejected = { ok: false, code: 'SEQUENCE_LOCKED', status: 409 };
      return { abort: true, result: rejected };
    }
    const merged = mergeProgressEvent(document.records[progressEvent.materialId] || null, progressEvent, {
      userId: auth.userId,
      isAdmin: isAdminAccount(auth),
      node,
      effective,
      global: catalog.global,
      preferences: document.preferences,
      records: document.records,
      isLeaf,
      now: Date.now()
    });
    if (!merged.ok) {
      rejected = merged;
      return { abort: true, result: merged };
    }
    if (!merged.changed) return { abort: true, result: { record: merged.record, changed: false } };
    if (!merged.record) delete document.records[progressEvent.materialId];
    else document.records[progressEvent.materialId] = merged.record;
    document.lastActivityAt = merged.record?.lastActivityAt || document.lastActivityAt;
    return { document, result: { record: merged.record, changed: true } };
  });
  if (rejected) return json({ error: rejected.code }, rejected.status || 409);
  const record = outcome.result?.record || null;
  return json({
    saved: outcome.modified,
    record,
    effective: {
      tracking: catalog.global.tracking === 'ON' && effective.tracking !== false,
      showProgress: catalog.global.showProgress === 'ON' && effective.showProgress !== false,
      recordOpens: catalog.global.recordOpens
    },
    completion: {
      manualRequired: node?.settings?.manualCompletion === true && record?.materialType !== 'presentation',
      completed: record?.status === 'completed'
    }
  });
}

async function handleReset(event, store, auth) {
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return responseForFailure(parsed);
  const body = parsed.value;
  if (!plainObject(body)) return json({ error: 'INVALID_BODY' }, 400);
  if (body.scope === 'course') {
    if (Object.keys(body).some((key) => key !== 'scope')) return json({ error: 'UNEXPECTED_FIELDS' }, 400);
    const outcome = await updateUser(store, auth.userId, profileFrom(auth.user), (document) => {
      const removed = Object.keys(document.records).length;
      document.records = {};
      document.lastActivityAt = null;
      return removed ? { document, result: { removed } } : { abort: true, result: { removed } };
    });
    return json({ reset: true, scope: 'course', removed: Number(outcome.result?.removed) || 0 });
  }
  if (Object.keys(body).some((key) => key !== 'materialId')) return json({ error: 'UNEXPECTED_FIELDS' }, 400);
  if (!validMaterialId(body.materialId)) return json({ error: 'INVALID_MATERIAL_ID' }, 400);
  const catalog = await readCatalog(store);
  const outcome = await updateUser(store, auth.userId, profileFrom(auth.user), (document) => {
    const ids = studyResetIds(catalog, [body.materialId], document.records);
    const existed = ids.some((id) => Boolean(document.records[id]));
    ids.forEach((id) => { delete document.records[id]; });
    return existed ? { document, result: { existed } } : { abort: true, result: { existed } };
  });
  return json({ reset: true, existed: Boolean(outcome.result?.existed) });
}

function validateEvent(body) {
  if (!plainObject(body)) return { ok: false, code: 'INVALID_BODY' };
  if (Object.keys(body).some((key) => !ALLOWED_EVENT_FIELDS.has(key))) {
    return { ok: false, code: 'UNEXPECTED_FIELDS' };
  }
  if (!validMaterialId(body.materialId)) return { ok: false, code: 'INVALID_MATERIAL_ID' };
  if (typeof body.action !== 'string') return { ok: false, code: 'INVALID_ACTION' };
  if (body.lastPosition != null && !plainObject(body.lastPosition)) return { ok: false, code: 'INVALID_POSITION' };
  if (body.details != null && !plainObject(body.details)) return { ok: false, code: 'INVALID_DETAILS' };
  return { ok: true, value: body };
}

function isAdminAccount(auth) {
  return Array.isArray(auth.user?.app_metadata?.roles) && auth.user.app_metadata.roles.includes('admin');
}

function profileFrom(user) {
  const metadata = plainObject(user?.user_metadata) ? user.user_metadata : {};
  const first = String(metadata.first_name || metadata.firstName || '').trim();
  const last = String(metadata.last_name || metadata.lastName || '').trim();
  return {
    email: typeof user?.email === 'string' ? user.email : '',
    name: String(metadata.full_name || metadata.fullName || `${first} ${last}`).trim()
  };
}

function emptyOptions() {
  return {
    statusCode: 204,
    headers: { Allow: 'GET, POST, DELETE, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' },
    body: ''
  };
}

function safeErrorName(error) {
  return error && error.name ? String(error.name) : 'Error';
}

exports._test = {
  profileFrom,
  setStoreFactory,
  storageConfig,
  validateEvent
};
