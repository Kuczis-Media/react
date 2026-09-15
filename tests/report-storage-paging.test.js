'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../netlify/exam-storage');
const quizStorage = require('../netlify/quiz-storage');

class Store {
  constructor() { this.entries = new Map(); this.revision = 0; this.reads = []; this.writes = []; }
  async getWithMetadata(key) { this.reads.push(key); return this.entries.get(key) || null; }
  async set(key, data, options = {}) {
    if (this.beforeWrite) await this.beforeWrite(key, data, options);
    const current = this.entries.get(key);
    if ((options.onlyIfNew && current) || (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)) return { modified: false };
    this.entries.set(key, { data, etag: `v${++this.revision}`, metadata: options.metadata || {} });
    this.writes.push({ key, size: Buffer.byteLength(data) });
    return { modified: true };
  }
  async *list({ prefix }) {
    const blobs = [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key }));
    for (let index = 0; index < blobs.length; index += 7) yield { blobs: blobs.slice(index, index + 7) };
  }
}

function attempt(i, examId = 'test') {
  const date = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
  return { repositoryId: 'glowne', examId, userId: `user-${i}`, attemptId: `attempt-${i}`, number: 1, revision: 1, status: 'submitted',
    startedAt: date, lastActivityAt: date, submittedAt: date, questions: [{ questionId: 'open', type: 'open_answer', prompt: 'Wyjaśnij' }],
    answers: { open: 'Odpowiedź ucznia' }, profile: { name: `Uczeń ${i}` }, result: { scorePercent: 80, points: 4, maxPoints: 5, passed: true, gradingStatus: 'graded' } };
}

function legacyReport(count) {
  const attempts = Array.from({ length: count }, (_, i) => attempt(i));
  return { version: 1, revision: 1, attempts: Object.fromEntries(attempts.map((a) => [a.attemptId, { ...storage.attemptSummary(a), userId: a.userId, profile: a.profile }])), participants: {} };
}

test('paged reports read only requested summaries across SDK pages, never full attempts', async () => {
  const store = new Store();
  for (let i = 0; i < 73; i++) { const a = attempt(i); await storage.createAttempt(store, a); await storage.syncAttemptIndexes(store, a, a.profile); }
  const seen = new Set();
  let cursor, pages = 0;
  do {
    store.reads = [];
    const report = await storage.readReport(store, 'glowne', 'test', { limit: 25, cursor });
    const rows = Object.values(report.attempts);
    assert.ok(rows.length <= 25);
    assert.equal(store.reads.filter((key) => key.startsWith('report-entries/')).length, rows.length);
    assert.equal(store.reads.some((key) => key.startsWith('attempts/')), false);
    for (const row of rows) { assert.equal(seen.has(row.attemptId), false); seen.add(row.attemptId); }
    assert.equal(report.metricsScope, 'page');
    cursor = report.cursor; pages++;
  } while (cursor);
  assert.equal(seen.size, 73); assert.equal(pages, 3);
  assert.ok(store.writes.filter((entry) => entry.key.startsWith('reports/')).every((entry) => entry.size < 500));
  assert.ok(store.writes.filter((entry) => entry.key.startsWith('report-entries/')).every((entry) => entry.size < 1500));
  await assert.rejects(storage.readReport(store, 'glowne', 'test', { cursor: '../other' }), { code: 'INVALID_REPORT_CURSOR' });
});

test('legacy report remains readable; write migrates all summaries without deleting full answers', async () => {
  const store = new Store(); const key = storage.reportKey('glowne', 'test');
  await store.set(key, JSON.stringify(legacyReport(61)));
  await storage.createAttempt(store, attempt(0));
  const count = store.writes.length;
  const oldPage = await storage.readReport(store, 'glowne', 'test', { limit: 25 });
  assert.equal(Object.keys(oldPage.attempts).length, 25); assert.equal(oldPage.cursor, 'offset:25');
  assert.equal(store.writes.length, count, 'GET does not migrate or write');
  const updated = attempt(0); updated.result.scorePercent = 100; updated.revision = 2;
  await storage.syncAttemptIndexes(store, updated, updated.profile);
  const report = await storage.readReport(store, 'glowne', 'test', { limit: 100 });
  assert.equal(Object.keys(report.attempts).length, 61);
  assert.equal(report.attempts['attempt-0'].scorePercent, 100);
  assert.deepEqual((await storage.readAttempt(store, 'glowne', 'test', 'user-0', 'attempt-0')).value.answers, { open: 'Odpowiedź ucznia' });
  assert.equal(JSON.parse(store.entries.get(key).data).storage, 'entries-v2');
  store.writes = [];
  await storage.syncAttemptIndexes(store, updated, updated.profile);
  assert.equal(store.writes.filter((entry) => entry.key.startsWith('report-entries/')).length, 1);
  assert.equal(store.writes.some((entry) => entry.key === key), false);
});

test('migration resumes after interruption and concurrent legacy edits are copied on retry', async () => {
  const store = new Store(); const key = storage.reportKey('glowne', 'test');
  const legacy = legacyReport(28); await store.set(key, JSON.stringify(legacy));
  let interrupted = false;
  store.beforeWrite = async (name) => {
    if (!interrupted && name.startsWith('report-entries/')) { interrupted = true; throw new Error('Interrupted copy'); }
  };
  await assert.rejects(storage.syncAttemptIndexes(store, attempt(29)), /Interrupted copy/);
  assert.equal(JSON.parse(store.entries.get(key).data).version, 1);
  let changed = false;
  store.beforeWrite = async (name, data) => {
    if (name === key && !changed && JSON.parse(data).storage === 'entries-v2') {
      changed = true; legacy.revision++; legacy.attempts['attempt-1'].scorePercent = 99;
      // Simulate a CAS-winning legacy writer, forcing the migration to retry.
      store.entries.set(key, { data: JSON.stringify(legacy), etag: 'concurrent-revision', metadata: {} });
    }
  };
  await storage.syncAttemptIndexes(store, attempt(29));
  const report = await storage.readReport(store, 'glowne', 'test', { limit: 100 });
  assert.equal(Object.keys(report.attempts).length, 29);
  assert.equal(report.attempts['attempt-1'].scorePercent, 99);
});

test('older synchronization cannot replace a newer grade and quiz/exam report namespaces stay isolated', async () => {
  const store = new Store();
  const a = attempt(0); const latest = { ...a, revision: 3, result: { ...a.result, scorePercent: 100 } };
  await storage.syncAttemptIndexes(store, latest);
  await storage.syncAttemptIndexes(store, a);
  assert.equal((await storage.readReport(store, 'glowne', 'test')).attempts[a.attemptId].scorePercent, 100);
  assert.equal((await storage.readUserExamIndex(store, 'glowne', 'test', a.userId)).attempts[0].scorePercent, 100);
  await storage.syncAttemptIndexes(store, attempt(1, quizStorage.storageQuizId('test')));
  const quiz = await quizStorage.readReport(store, 'glowne', 'test', { limit: 1 });
  assert.deepEqual(Object.keys(quiz.attempts), ['attempt-1']);
  assert.deepEqual(Object.keys((await storage.readReport(store, 'glowne', 'test')).attempts), ['attempt-0']);
});
