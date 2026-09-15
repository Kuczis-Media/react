(function exposeLessonNavigation(root) {
  'use strict';
  // Shared by the player and the server. Role information on the server comes
  // exclusively from the authenticated account, never a progress-event payload.
  function policy(navigation, preferences = {}, isAdmin = false) {
    if (isAdmin) return { sequential: false, source: 'admin' };
    if (preferences.skipMode === 'ALLOW') return { sequential: false, source: 'user' };
    if (preferences.skipMode === 'DENY') return { sequential: true, source: 'user' };
    return { sequential: navigation !== 'free', source: 'lesson' };
  }
  function stepOverride(stepId, preferences = {}, isAdmin = false) {
    if (isAdmin) return 'allow';
    if (preferences.lockedStepIds?.includes(stepId)) return 'deny';
    if (preferences.unlockedStepIds?.includes(stepId)) return 'allow';
    return 'default';
  }
  function materialId(repositoryId, filename) {
    const source = `lesson:${repositoryId || 'default'}:${filename}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `lesson-${(hash >>> 0).toString(36)}`;
  }
  const api = { policy, stepOverride, materialId };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChemLessonNavigation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
