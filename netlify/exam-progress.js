'use strict';

const { canonicalMaterialId } = require('./exam-common.js');
const {
  activeUserDocument,
  aggregateUser,
  effectiveSettings,
  mergeProgressEvent,
  sequenceAccessMap,
  validMaterialId
} = require('./progress-common.js');
const { getProgressStore, readCatalog, readUser, updateUser } = require('./progress-storage.js');
let injectedProgressStoreFactory = null;

function profileFrom(user) {
  const metadata = user?.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  return {
    email: typeof user?.email === 'string' ? user.email : '',
    name: String(metadata.full_name || metadata.fullName || `${metadata.first_name || ''} ${metadata.last_name || ''}`).trim()
  };
}

async function updateExamProgress(input) {
  const store = input.store || (injectedProgressStoreFactory ? injectedProgressStoreFactory() : getProgressStore());
  const catalog = await readCatalog(store);
  const resolved = effectiveSettings(catalog);
  const canonical = canonicalMaterialId(input.repositoryId, input.examId);
  const ids = new Set([canonical]);
  for (const node of catalog.nodes) {
    if (
      node.type === 'exam'
      && node.settings.examId === input.examId
      && (node.settings.repositoryId || 'default') === (input.repositoryId || 'default')
    ) ids.add(node.id);
  }
  if (validMaterialId(input.materialId)) {
    const node = resolved.byId.get(input.materialId);
    const legacyExplicitExamCard = node?.type === 'exam' && !node.settings.examId;
    if (
      node?.type === 'exam'
      && (legacyExplicitExamCard || (
        node.settings.examId === input.examId
        && (node.settings.repositoryId || 'default') === (input.repositoryId || 'default')
      ))
    ) ids.add(node.id);
  }

  const records = {};
  await updateUser(store, input.userId, profileFrom(input.user), (document) => {
    const active = activeUserDocument(document, catalog);
    document.records = active.records;
    document.lastActivityAt = active.lastActivityAt;
    const requestedNode = validMaterialId(input.materialId) ? resolved.byId.get(input.materialId) : null;
    const requestedAccess = requestedNode
      ? sequenceAccessMap(catalog, aggregateUser(active, catalog), active.preferences)[requestedNode.id]
      : null;
    if (requestedAccess?.allowed === false) throw sequenceLockedError();
    let changed = false;
    for (const materialId of ids) {
      if (catalog.invalidatedAt[materialId] && !resolved.byId.has(materialId)) continue;
      const node = resolved.byId.get(materialId) || null;
      const effective = node ? resolved.effective.get(materialId) : { tracking: true, showProgress: true };
      const merged = mergeProgressEvent(document.records[materialId] || null, {
        materialId,
        materialType: 'exam',
        action: input.action,
        opened: input.opened,
        progressPercent: input.progressPercent,
        details: input.details || {}
      }, {
        userId: input.userId,
        node,
        effective,
        global: catalog.global,
        preferences: document.preferences,
        records: document.records,
        isLeaf: true,
        now: input.now || Date.now()
      });
      if (!merged.ok || !merged.changed) continue;
      changed = true;
      if (merged.record) {
        document.records[materialId] = merged.record;
        records[materialId] = merged.record;
        document.lastActivityAt = merged.record.lastActivityAt || document.lastActivityAt;
      }
    }
    return changed ? { document } : { abort: true, result: { records } };
  });
  return { materialId: canonical, records };
}

async function assertExamSequenceAccess(input) {
  if (!validMaterialId(input.materialId)) return { allowed: true };
  const store = input.store || (injectedProgressStoreFactory ? injectedProgressStoreFactory() : getProgressStore());
  const catalog = await readCatalog(store);
  const resolved = effectiveSettings(catalog);
  const node = resolved.byId.get(input.materialId);
  if (!node || node.type !== 'exam') return { allowed: true };
  if (
    node.settings.examId
    && (
      node.settings.examId !== input.examId
      || (node.settings.repositoryId || 'default') !== (input.repositoryId || 'default')
    )
  ) return { allowed: true };
  const stored = await readUser(store, input.userId, profileFrom(input.user));
  const user = activeUserDocument(stored.document, catalog);
  const access = sequenceAccessMap(catalog, aggregateUser(user, catalog), user.preferences)[node.id];
  if (access?.allowed === false) throw sequenceLockedError();
  return access || { allowed: true };
}

function sequenceLockedError() {
  const error = new Error('SEQUENCE_LOCKED');
  error.code = 'SEQUENCE_LOCKED';
  error.status = 409;
  return error;
}

async function resetExamProgress(input) {
  const store = input.store || (injectedProgressStoreFactory ? injectedProgressStoreFactory() : getProgressStore());
  const catalog = await readCatalog(store);
  const ids = new Set([canonicalMaterialId(input.repositoryId, input.examId)]);
  for (const node of catalog.nodes) {
    if (
      node.type === 'exam'
      && node.settings.examId === input.examId
      && (node.settings.repositoryId || 'default') === (input.repositoryId || 'default')
    ) ids.add(node.id);
  }
  let previous = {};
  const outcome = await updateUser(store, input.userId, {}, (document) => {
    previous = Object.fromEntries([...ids].filter((id) => document.records[id]).map((id) => [id, document.records[id]]));
    ids.forEach((id) => { delete document.records[id]; });
    return Object.keys(previous).length ? { document } : { abort: true };
  });
  return { modified: outcome.modified, materialIds: [...ids], previous };
}

function setProgressStoreFactory(factory) {
  injectedProgressStoreFactory = typeof factory === 'function' ? factory : null;
}

module.exports = {
  assertExamSequenceAccess,
  profileFrom,
  resetExamProgress,
  setProgressStoreFactory,
  updateExamProgress
};
