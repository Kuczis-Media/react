'use strict';
// Extension of chemdisk-progress, not a second database or attempt history.
const crypto = require('node:crypto');
const storage = require('./progress-storage');
const progress = require('./progress-common');
const repository = require('./content-repository');
const quiz = require('./quiz-common');
const access = require('./study-access');
const scheduler = require('../public/assets/js/study-scheduler');
const practice = require('../public/assets/js/quiz-practice');
const { json, parseJsonBody } = require('./admin-common');
const SHARDS = 16;
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const shardId = (id) => parseInt(hash(id).slice(0, 2), 16) % SHARDS;
const indexPrefix = (userId) => `study-index/${storage.encodeId(userId)}/`;
const indexKey = (userId, repo, deck) => `${indexPrefix(userId)}${hash(`${repo}:${deck}`)}.json`;
const shardKey = (userId, repo, deck, generation, n) => `study/${storage.encodeId(userId)}/${hash(`${repo}:${deck}`)}/${generation}/${n}.json`;
const materialKey = (repo, deck) => `quiz:${repo}:${deck}`;
function failure(code, status = 400) { const e = new Error(code); e.code = code; e.status = status; throw e; }
function bucketSummary(cards, records) {
  const s = scheduler.stats(cards, records, 0), due = {}, questions = Object.create(null);
  for (const q of cards) {
    const r = records[q.studyKey];
    if (!r?.attempts) continue;
    const entry = questions[q.questionId] ||= { attempts: 0, correct: 0, incorrect: 0, hardMarks: 0 };
    for (const key of Object.keys(entry)) entry[key] += Number(r[key]) || 0;
  }
  for (const q of cards) { const value = records[q.studyKey]; if (value?.dueAt) { const at = Date.parse(value.dueAt); due[at] = (due[at] || 0) + 1; } }
  return { ...s, questions, due: Object.entries(due).map(([at, count]) => [Number(at), count]) };
}
function summary(index, now = Date.now()) {
  const value = { total: 0, new: 0, due: 0, failed: 0, hard: 0, hardMarks: 0, attempts: 0, correct: 0, incorrect: 0 };
  Object.values(index.buckets || {}).forEach((bucket) => {
    for (const k of Object.keys(value)) if (k !== 'due') value[k] += Number(bucket[k]) || 0;
    value.due += (bucket.due || []).reduce((sum, [at, count]) => sum + (at <= now ? count : 0), 0);
  }); return value;
}
async function context(store, auth, repo, deck, create = true) {
  const asset = await repository.readAsset('quiz', deck, { repositoryId: repo });
  repo = asset.repositoryId || repo;
  let definition; try { definition = JSON.parse(asset.content); } catch { failure('QUIZ_FILE_INVALID', 422); }
  if (!quiz.validateDefinition(definition, deck).valid || definition.mode !== 'deck') failure('STUDY_DECK_REQUIRED', 422);
  if (definition.metadata.status !== 'published' || definition.metadata.active === false) failure('QUIZ_NOT_ACTIVE', 404);
  const [catalog, user] = await Promise.all([storage.readCatalog(store), storage.readUser(store, auth.userId)]);
  const active = progress.activeUserDocument(user.document, catalog), id = materialKey(repo, deck);
  const resolved = progress.effectiveSettings(catalog);
  const related = access.check(auth, definition, repo, catalog, active);
  const enabled = catalog.global.tracking === 'ON' && related.every((n) => resolved.effective.get(n.id)?.tracking !== false);
  let generation = active.records[id]?.details?.studyGeneration;
  if (!generation && enabled && create) {
    const proposed = crypto.randomUUID();
    const result = await storage.updateUser(store, auth.userId, {}, (document) => {
      document = progress.activeUserDocument(document, catalog);
      const record = document.records[id] || progress.normalizeRecord({ materialType: 'quiz' }, auth.userId, id);
      if (record.details.studyGeneration) return { abort: true, result: record.details.studyGeneration };
      record.details.studyGeneration = proposed; document.records[id] = record;
      return { document, result: proposed };
    }); generation = result.result;
  }
  return { participantRole: auth.roles.includes('admin') ? 'admin' : 'student', definition, cards: scheduler.cards(definition.questions), generation, enabled, id, repo, related, catalog };
}
async function indexUpdate(store, userId, repo, deck, ctx, buckets) {
  if (!ctx.generation) return null;
  const result = await storage.updateJson(store, indexKey(userId, repo, deck), {}, async (old) => {
    const user = await storage.readUser(store, userId);
    if (progress.activeUserDocument(user.document, ctx.catalog).records[ctx.id]?.details?.studyGeneration !== ctx.generation) failure('STUDY_RESET', 409);
    const current = old.generation === ctx.generation ? old.buckets || {} : {};
    const merged = { ...current };
    for (const [key, b] of Object.entries(buckets)) if (!merged[key] || b.revision >= merged[key].revision) merged[key] = b;
    return { value: { version: 1, questionStatsVersion: 1, participantRole: ctx.participantRole, repositoryId: repo, deckId: deck, title: ctx.definition.metadata.title,
      courseId: ctx.definition.metadata.courseId, generation: ctx.generation, buckets: merged, updatedAt: new Date().toISOString() } };
  }); return result.value;
}
async function load(store, auth, repo, deck) {
  const ctx = await context(store, auth, repo, deck), records = {}, buckets = {};
  repo = ctx.repo;
  await Promise.all(Array.from({ length: SHARDS }, async (_, n) => {
    const entry = ctx.generation ? await storage.readEntry(store, shardKey(auth.userId, repo, deck, ctx.generation, n)) : null;
    const value = entry?.value || {}, cards = ctx.cards.filter((q) => shardId(q.studyKey) === n);
    for (const q of cards) if (value.records?.[q.studyKey]) records[q.studyKey] = value.records[q.studyKey];
    buckets[n] = { ...bucketSummary(cards, value.records || {}), revision: value.revision || 0 };
  }));
  const old = await storage.readEntry(store, indexKey(auth.userId, repo, deck));
  // Repair secondary summaries after a interrupted batch without reading history.
  if (ctx.enabled && (old?.value?.generation !== ctx.generation || JSON.stringify(old?.value?.buckets) !== JSON.stringify(buckets) || old?.value?.title !== ctx.definition.metadata.title || old?.value?.participantRole !== ctx.participantRole || old?.value?.questionStatsVersion !== 1)) await indexUpdate(store, auth.userId, repo, deck, ctx, buckets);
  return { records, repositoryId: repo, enabled: ctx.enabled, generation: ctx.generation || '', summary: scheduler.stats(ctx.cards, records), serverNow: new Date().toISOString() };
}
async function save(store, auth, repo, deck, body) {
  if (!Array.isArray(body.reviews) || !body.reviews.length || body.reviews.length > 20 || typeof body.generation !== 'string') failure('INVALID_REVIEWS');
  const ctx = await context(store, auth, repo, deck, false);
  repo = ctx.repo;
  if (!ctx.enabled) return { saved: false, disabled: true };
  if (!ctx.generation || ctx.generation !== body.generation) failure('STUDY_RESET', 409);
  const byId = new Map(ctx.cards.map((q) => [q.studyKey, q])), events = body.reviews;
  for (const e of events) {
    if (!e || Object.keys(e).some((k) => !['eventId', 'cardId', 'grade', 'answer', 'action'].includes(k)) || !/^[A-Za-z0-9-]{16,80}$/.test(e.eventId || '') || !byId.has(e.cardId)) failure('INVALID_REVIEW');
    if (e.action === 'reset' || e.grade === 0) {
      // Valid individual card reset
    } else if (![1, 2, 3, 4].includes(e.grade)) {
      failure('INVALID_REVIEW');
    }
    if (e.answer != null && !(typeof e.answer === 'string' && e.answer.length <= 500) && !(Array.isArray(e.answer) && e.answer.length <= 6 && e.answer.every((s) => typeof s === 'string' && s.length <= 128))) failure('INVALID_ANSWER');
  }
  const records = {}, buckets = {}, now = Date.now();
  await Promise.all([...new Set(events.map((e) => shardId(e.cardId)))].map(async (n) => {
    const allowed = ctx.cards.filter((q) => shardId(q.studyKey) === n), ids = new Set(allowed.map((q) => q.studyKey));
    const result = await storage.updateJson(store, shardKey(auth.userId, repo, deck, ctx.generation, n), {}, (old) => {
      if (events.filter((e) => shardId(e.cardId) === n).every((e) => (old.receipts || []).includes(e.eventId))) return { abort: true, value: old };
      const next = Object.fromEntries(Object.entries(old.records || {}).filter(([id]) => ids.has(id)));
      const receipts = new Set(old.receipts || []);
      for (const event of events.filter((e) => shardId(e.cardId) === n)) {
        if (receipts.has(event.eventId)) continue;
        if (event.action === 'reset' || event.grade === 0) {
          delete next[event.cardId];
          receipts.add(event.eventId);
          continue;
        }
        const q = byId.get(event.cardId), objective = ['single', 'multiple', 'text'].includes(q.type);
        const correct = objective ? practice.evaluate(q, event.answer).correct : null;
        next[event.cardId] = scheduler.review(next[event.cardId], correct === false ? 1 : event.grade, now, event.answer, correct);
        receipts.add(event.eventId);
      }
      if (Object.keys(next).length > 1200) failure('STUDY_SHARD_FULL', 413);
      const value = { version: 1, revision: (old.revision || 0) + 1, records: next, receipts: [...receipts].slice(-512) };
      if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) failure('STUDY_SHARD_FULL', 413);
      return { value };
    });
    for (const e of events.filter((e) => shardId(e.cardId) === n)) {
      if (e.action === 'reset' || e.grade === 0) {
        delete records[e.cardId];
      } else {
        records[e.cardId] = result.value.records[e.cardId];
      }
    }
    buckets[n] = { ...bucketSummary(allowed, result.value.records), revision: result.value.revision };
  }));
  await indexUpdate(store, auth.userId, repo, deck, ctx, buckets);
  const synced = await storage.updateUser(store, auth.userId, {}, async (document) => {
    document = progress.activeUserDocument(document, ctx.catalog);
    if (document.records[ctx.id]?.details?.studyGeneration !== ctx.generation) return { abort: true, result: false };
    // Read the latest summary on every CAS retry; an older simultaneous batch
    // must not replace counters already synchronized by a newer one.
    const index = await storage.readEntry(store, indexKey(auth.userId, repo, deck));
    if (index?.value?.generation !== ctx.generation) return { abort: true, result: false };
    const totals = summary(index.value);
    for (const id of new Set([ctx.id, ...ctx.related.map((n) => n.id)])) {
      const record = document.records[id] || progress.normalizeRecord({ materialType: 'quiz' }, auth.userId, id);
      Object.assign(record.details, { studyAttempts: totals.attempts, studyCorrect: totals.correct, studyIncorrect: totals.incorrect });
      record.progressPercent = Math.max(record.progressPercent || 0, totals.total ? (totals.total - totals.new) / totals.total * 100 : 0);
      record.status = record.progressPercent >= 100 ? 'completed' : 'in_progress';
      if (record.status === 'completed') record.completedAt ||= new Date(now).toISOString();
      record.lastActivityAt = new Date(now).toISOString(); document.records[id] = record;
    }
    document.lastActivityAt = new Date(now).toISOString(); return { document, result: true };
  });
  if (!synced.result) failure('STUDY_RESET', 409);
  return { saved: true, records };
}
async function list(store, auth, cursor) {
  if (cursor && !/^offset:\d{1,9}$/.test(cursor)) failure('INVALID_CURSOR');
  const [page, user, catalog] = await Promise.all([storage.listEntries(store, { prefix: indexPrefix(auth.userId), limit: 12, cursor }), storage.readUser(store, auth.userId), storage.readCatalog(store)]);
  const active = progress.activeUserDocument(user.document, catalog);
  return { decks: page.entries.filter(({value}) => active.records[materialKey(value.repositoryId, value.deckId)]?.details?.studyGeneration === value.generation)
    .map(({value}) => ({ repositoryId: value.repositoryId, deckId: value.deckId, title: value.title, ...summary(value) })), cursor: page.cursor };
}
async function handle(event, store, auth) {
  try {
    const query = event.queryStringParameters || {};
    if (Object.keys(query).some((k) => !['view', 'repo', 'deck', 'cursor'].includes(k))) failure('UNEXPECTED_QUERY');
    if (query.view === 'study-summary' && event.httpMethod === 'GET') return json(await list(store, auth, query.cursor));
    const repo = String(query.repo || 'default'), deck = String(query.deck || '');
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(repo) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(deck)) failure('INVALID_QUIZ_REFERENCE');
    if (event.httpMethod === 'GET') return json(await load(store, auth, repo, deck));
    if (event.httpMethod !== 'POST') failure('METHOD_NOT_ALLOWED', 405);
    const parsed = parseJsonBody(event); if (!parsed.ok) failure('INVALID_BODY');
    if (!parsed.value || Object.keys(parsed.value).some((k) => !['generation', 'reviews'].includes(k))) failure('UNEXPECTED_FIELDS');
    return json(await save(store, auth, repo, deck, parsed.value));
  } catch (error) { if (error.status) return json({ error: error.code || 'STUDY_UNAVAILABLE' }, error.status); throw error; }
}
module.exports = { handle, load, save, summary, indexKey, shardKey, shardId };
