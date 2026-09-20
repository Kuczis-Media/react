'use strict';
const repository = require('./content-repository');
const storage = require('./progress-storage');
const progress = require('./progress-common');
const quiz = require('./quiz-common');
const access = require('./study-access');
const PAGE_SIZE = 12, metadataCache = new Map();
function failure(code, status = 400) { const error = new Error(code); error.code = code; error.status = status; throw error; }
async function metadata(repo, id) {
  const key = `${repo}:${id}`, cached = metadataCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const asset = await repository.readAsset('quiz', id, { repositoryId: repo });
  let definition; try { definition = JSON.parse(asset.content); } catch { return null; }
  const value = quiz.validateDefinition(definition, id).valid && definition.mode === 'deck'
    && definition.metadata.status === 'published' && definition.metadata.active !== false
    ? { quizId: definition.quizId, metadata: definition.metadata } : null;
  metadataCache.delete(key); metadataCache.set(key, { value, expiresAt: Date.now() + 60_000 });
  while (metadataCache.size > 240) metadataCache.delete(metadataCache.keys().next().value);
  return value;
}
async function readPage(store, auth, query) {
  if (Object.keys(query).some((key) => !['view', 'repo', 'cursor', 'search'].includes(key))) failure('UNEXPECTED_QUERY');
  const repositories = repository.publicConfigurations().filter((repo) => repo.configured).map(({ id, label }) => ({ id, label }));
  const requested = query.repo || '';
  if (requested && !repositories.some((repo) => repo.id === requested)) failure('INVALID_CONTENT_REPOSITORY');
  const search = String(query.search || '').trim().toLocaleLowerCase('pl');
  if (search.length > 120) failure('INVALID_SEARCH');
  const sources = requested ? repositories.filter((repo) => repo.id === requested) : repositories;
  const cursor = query.cursor || 'catalog:0:0';
  if (!/^catalog:\d{1,4}:\d{1,6}$/.test(cursor)) failure('INVALID_CURSOR');
  const [, r, n] = cursor.split(':'), repoIndex = Number(r), offset = Number(n);
  if (repoIndex >= sources.length) {
    if (!sources.length && !query.cursor) return { decks: [], repositories, cursor: null, scanned: 0 };
    failure('INVALID_CURSOR');
  }
  const repo = sources[repoIndex];
  // Folder names/catalog metadata only: never verify every quiz.json on list.
  const [candidates, catalog, user] = await Promise.all([
    repository.listAssets('quiz', { repositoryId: repo.id, verifyNested: false }),
    storage.readCatalog(store), storage.readUser(store, auth.userId)
  ]);
  const active = progress.activeUserDocument(user.document, catalog);
  const selected = candidates.filter((item) => !search || `${item.title} ${item.filename}`.toLocaleLowerCase('pl').includes(search));
  if (offset > selected.length) failure('INVALID_CURSOR');
  const page = selected.slice(offset, offset + PAGE_SIZE), decks = [];
  // Three concurrent reads, at most twelve definitions per explicit page.
  for (let start = 0; start < page.length; start += 3) {
    const batch = await Promise.all(page.slice(start, start + 3).map(async (item) => {
      let value;
      try { value = await metadata(repo.id, item.filename); }
      catch (error) { if (error.status === 404) return null; throw error; }
      if (!value) return null;
      try { access.check(auth, value, repo.id, catalog, active); }
      catch (error) { if (error.code === 'SEQUENCE_LOCKED') return null; throw error; }
      return { repositoryId: repo.id, repositoryLabel: repo.label, deckId: value.quizId, title: value.metadata.title };
    }));
    decks.push(...batch.filter(Boolean));
  }
  const next = offset + PAGE_SIZE < selected.length ? `catalog:${repoIndex}:${offset + PAGE_SIZE}`
    : repoIndex + 1 < sources.length ? `catalog:${repoIndex + 1}:0` : null;
  return { decks, repositories, cursor: next, scanned: page.length, repositoryLabel: repo.label };
}
module.exports = { readPage, _test: { clearCache: () => metadataCache.clear() } };
