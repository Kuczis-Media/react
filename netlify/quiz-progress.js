'use strict';

const {
  activeUserDocument,
  effectiveSettings,
  mergeProgressEvent,
  validMaterialId
} = require('./progress-common.js');
const { getProgressStore, readCatalog, updateUser } = require('./progress-storage.js');
let injectedProgressStoreFactory = null;

function canonicalMaterialId(repositoryId, quizId) {
  return `quiz:${repositoryId || 'default'}:${quizId}`.slice(0, 128);
}

async function updateQuizProgress(input) {
  const store = input.store || (injectedProgressStoreFactory ? injectedProgressStoreFactory() : getProgressStore());
  const catalog = await readCatalog(store);
  const resolved = effectiveSettings(catalog);
  const ids = new Set([canonicalMaterialId(input.repositoryId, input.quizId)]);
  for (const node of catalog.nodes) {
    if (node.type === 'quiz'
      && node.settings.quizId === input.quizId
      && (node.settings.repositoryId || 'default') === (input.repositoryId || 'default')) ids.add(node.id);
  }
  if (validMaterialId(input.materialId)) {
    const node = resolved.byId.get(input.materialId);
    if (node?.type === 'quiz') ids.add(node.id);
  }
  const records = {};
  await updateUser(store, input.userId, profileFrom(input.user), (document) => {
    const active = activeUserDocument(document, catalog);
    document.records = active.records;
    document.lastActivityAt = active.lastActivityAt;
    let changed = false;
    for (const materialId of ids) {
      if (catalog.invalidatedAt[materialId] && !resolved.byId.has(materialId)) continue;
      const node = resolved.byId.get(materialId) || null;
      const effective = node ? resolved.effective.get(materialId) : { tracking: true, showProgress: true };
      const merged = mergeProgressEvent(document.records[materialId] || null, {
        materialId,
        materialType: 'quiz',
        action: 'quiz',
        opened: true,
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
  return { materialId: canonicalMaterialId(input.repositoryId, input.quizId), records };
}

function profileFrom(user) {
  const metadata = user?.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  return {
    email: typeof user?.email === 'string' ? user.email : '',
    name: String(metadata.full_name || metadata.fullName || metadata.name || '').trim()
  };
}

function setProgressStoreFactory(factory) {
  injectedProgressStoreFactory = typeof factory === 'function' ? factory : null;
}

module.exports = { canonicalMaterialId, setProgressStoreFactory, updateQuizProgress };
