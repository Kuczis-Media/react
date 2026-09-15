'use strict';
const storage = require('./progress-storage');
const progress = require('./progress-common');

function check(auth, definition, repo, catalog, active) {
  const id = `quiz:${repo}:${definition.quizId}`;
  const related = catalog.nodes.filter((n) => n.id === id || (n.type === 'quiz'
    && (n.settings.repositoryId || 'default') === repo
    && (n.settings.contentFile === definition.quizId || n.settings.quizId === definition.quizId)));
  if (!auth.roles.includes('admin')) {
    const access = progress.sequenceAccessMap(catalog, progress.aggregateUser(active, catalog), active.preferences);
    const byId = new Map(catalog.nodes.map((n) => [n.id, n]));
    const candidates = new Set([...related.map((n) => n.id), definition.metadata.courseId].filter(Boolean));
    // Check ancestors too: a deck cannot bypass its locked parent section/course.
    for (const candidate of candidates) {
      let nodeId = candidate; const visited = new Set();
      while (nodeId && !visited.has(nodeId)) {
        visited.add(nodeId);
        if (access[nodeId]?.allowed === false || active.preferences.lockedStepIds.includes(nodeId)) {
          const error = new Error('SEQUENCE_LOCKED'); error.code = 'SEQUENCE_LOCKED'; error.status = 409; throw error;
        }
        nodeId = byId.get(nodeId)?.parentId;
      }
    }
  }
  return related;
}

async function assertAccess(auth, definition, repo) {
  if (auth.roles.includes('admin')) return;
  const store = storage.getProgressStore();
  const [catalog, user] = await Promise.all([storage.readCatalog(store), storage.readUser(store, auth.userId)]);
  check(auth, definition, repo, catalog, progress.activeUserDocument(user.document, catalog));
}
module.exports = { check, assertAccess };
