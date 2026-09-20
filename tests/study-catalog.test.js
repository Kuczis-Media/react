'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const repository = require('../netlify/content-repository');
const catalog = require('../netlify/study-catalog');
const storage = require('../netlify/progress-storage');
const endpoint = require('../netlify/functions/progress');
const model = require('../public/members/module/studio/quiz-model');
function setup(t, count = 200) {
  catalog._test.clearCache(); t.after(() => catalog._test.clearCache());
  const entries = new Map(), reads = [], lists = [], store = {
    async getWithMetadata(key) { return entries.has(key) ? { data: entries.get(key), etag: '1' } : null; },
    async set(key, value) { entries.set(key, value); return { modified: true }; }
  };
  t.mock.method(repository, 'publicConfigurations', () => [{ id: 'first', label: 'Pierwsza', configured: true }, { id: 'second', label: 'Druga', configured: true }]);
  t.mock.method(repository, 'listAssets', async (kind, options) => {
    assert.equal(kind, 'quiz'); assert.equal(options.verifyNested, false); lists.push(options.repositoryId);
    return Array.from({ length: count }, (_, i) => ({ filename: `deck-${i}`, title: `Pula ${i}` }));
  });
  t.mock.method(repository, 'readAsset', async (_kind, id, options) => {
    reads.push(`${options.repositoryId}:${id}`);
    return { content: model.serialize(model.createQuiz({ mode: 'deck', quizId: id, metadata: { title: `${options.repositoryId} ${id}`, courseId: 'course', status: 'published' }, questions: [{ type: 'flashcard', front: { text: 'Przód' }, back: { text: 'Tył' } }] })) };
  });
  return { store, entries, reads, lists, auth: { userId: 'student', roles: ['active'] } };
}
test('all-repository discovery reads one bounded page, preserves repository identity and caches metadata', async (t) => {
  const h = setup(t);
  const first = await catalog.readPage(h.store, h.auth, {});
  assert.equal(first.decks.length, 12); assert.equal(h.reads.length, 12); assert.deepEqual(h.lists, ['first']);
  assert.equal(first.cursor, 'catalog:0:12');
  await catalog.readPage(h.store, h.auth, {}); assert.equal(h.reads.length, 12, 'Repeated catalog page uses a bounded short-lived metadata cache');
  const secondRepo = await catalog.readPage(h.store, h.auth, { repo: 'second' });
  assert.equal(secondRepo.decks[0].deckId, first.decks[0].deckId);
  assert.notEqual(secondRepo.decks[0].repositoryId, first.decks[0].repositoryId);
  const end = await catalog.readPage(h.store, h.auth, { cursor: 'catalog:0:192' });
  assert.equal(end.decks.length, 8); assert.equal(end.cursor, 'catalog:1:0');
  const next = await catalog.readPage(h.store, h.auth, { cursor: end.cursor });
  assert.equal(next.decks[0].repositoryId, 'second');
  assert.equal(h.entries.size, 0, 'Discovery never starts study or writes Blobs');
});
test('catalog applies current course locks even to cached results and rejects forged cursors/repositories', async (t) => {
  const h = setup(t, 2);
  await catalog.readPage(h.store, h.auth, {});
  await storage.updateUser(h.store, h.auth.userId, {}, (document) => { document.preferences.lockedStepIds = ['course']; return { document }; });
  assert.equal((await catalog.readPage(h.store, h.auth, {})).decks.length, 0);
  assert.equal((await catalog.readPage(h.store, { ...h.auth, roles: ['admin'] }, {})).decks.length, 2);
  for (const query of [{ repo: 'foreign' }, { cursor: 'offset:200' }, { cursor: 'catalog:999:0' }, { cursor: 'catalog:0:999999' }, { inspect: '1' }]) await assert.rejects(catalog.readPage(h.store, h.auth, query));
});
test('catalog excludes normal quizzes, drafts and inactive pools; unauthenticated discovery is denied', async (t) => {
  const h = setup(t, 4);
  t.mock.method(repository, 'readAsset', async (_kind, id) => {
    const i = Number(id.split('-')[1]);
    return { content: model.serialize(model.createQuiz({ mode: i === 0 ? 'quiz' : 'deck', quizId: id, metadata: { title: id, courseId: 'course', status: i === 1 ? 'draft' : 'published', active: i !== 2 }, questions: [{ type: 'flashcard', front: { text: 'P' }, back: { text: 'O' } }] })) };
  });
  assert.deepEqual((await catalog.readPage(h.store, h.auth, {})).decks.map((d) => d.deckId), ['deck-3']);
  endpoint._test.setStoreFactory(() => h.store); t.after(() => endpoint._test.setStoreFactory(null));
  const response = await endpoint.handler({ httpMethod: 'GET', queryStringParameters: { view: 'study-catalog' }, headers: {} }, {});
  assert.equal(response.statusCode, 401);
});
