(function (root) {
  'use strict';
  // One handoff slot and one slot per preview tab: no accumulating drafts or server writes.
  const KEY = 'chemdisk.presentation.preview.v1';
  const TTL = 60 * 60 * 1000;
  function write(storage, { userId, repositoryId, definition }, now = Date.now()) {
    if (!userId || !repositoryId || !definition?.presentationId) throw new Error('INVALID_PREVIEW');
    const token = root.crypto.randomUUID();
    const raw = JSON.stringify({ token, userId, repositoryId, definition, createdAt: now });
    if (raw.length > 3_000_000) throw new Error('PREVIEW_TOO_LARGE');
    storage.setItem(KEY, raw);
    return token;
  }
  function read(storage, session, expected, now = Date.now()) {
    for (const source of [session, storage]) {
      try {
        const raw = source.getItem(KEY);
        if (!raw || raw.length > 3_000_000) continue;
        const value = JSON.parse(raw);
        if (!value.createdAt || now < value.createdAt || now - value.createdAt > TTL) {
          source.removeItem(KEY); continue;
        }
        if (!expected.userId || value.userId !== expected.userId || value.token !== expected.token
          || value.repositoryId !== expected.repositoryId || value.definition?.presentationId !== expected.presentationId) continue;
        session.setItem(KEY, raw);
        return value.definition;
      } catch (_) {}
    }
    return null;
  }
  const api = { write, read };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChemPresentationPreview = api;
})(typeof window !== 'undefined' ? window : globalThis);
