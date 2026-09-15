'use strict';
const storage = require('./progress-storage');
const progress = require('./progress-common');
const study = require('./study-progress');
const repository = require('./content-repository');
const quiz = require('./quiz-common');
const percent = (correct, attempts) => attempts ? Math.round(correct / attempts * 10000) / 100 : null;

async function readReport(store, repo, deck, cursor) {
  const asset = await repository.readAsset('quiz', deck, { repositoryId: repo });
  const definition = JSON.parse(asset.content);
  if (!quiz.validateDefinition(definition, deck).valid || definition.mode !== 'deck') {
    throw new repository.ContentRepositoryError('STUDY_DECK_REQUIRED', 422);
  }
  repo = asset.repositoryId || repo;
  const [catalog, page] = await Promise.all([
    storage.readCatalog(store), storage.listEntries(store, { prefix: 'users/', limit: 25, cursor })
  ]);
  const metrics = { participants: 0, attempts: 0, correct: 0, incorrect: 0, hard: 0, hardMarks: 0, learnerPercentSum: 0, learnersWithAnswers: 0, missingQuestionStats: 0 };
  const questionMap = new Map(definition.questions.map((q) => [q.questionId, {
    questionId: q.questionId, prompt: (q.type === 'flashcard' ? q.front.text : q.prompt).slice(0, 500),
    attempts: 0, correct: 0, incorrect: 0, hardMarks: 0
  }]));
  // Bounded pages; use existing per-user summaries, never scan review shards/history.
  for (let offset = 0; offset < page.entries.length; offset += 8) {
    const indexes = await Promise.all(page.entries.slice(offset, offset + 8).map(async ({ value }) => {
      if (!value?.userId) return null;
      const active = progress.activeUserDocument(value, catalog);
      const generation = active.records[`quiz:${repo}:${deck}`]?.details?.studyGeneration;
      if (!generation) return null;
      const entry = await storage.readEntry(store, study.indexKey(value.userId, repo, deck));
      return entry?.value?.generation === generation && entry.value.participantRole !== 'admin' ? entry.value : null;
    }));
    for (const index of indexes.filter(Boolean)) {
      const totals = study.summary(index);
      metrics.participants++;
      for (const key of ['attempts', 'correct', 'incorrect', 'hard', 'hardMarks']) metrics[key] += totals[key];
      if (totals.attempts) { metrics.learnerPercentSum += totals.correct / totals.attempts * 100; metrics.learnersWithAnswers++; }
      if (index.questionStatsVersion !== 1) metrics.missingQuestionStats++;
      for (const bucket of Object.values(index.buckets || {})) {
        for (const [id, values] of Object.entries(bucket.questions || {})) {
          const question = questionMap.get(id); if (!question) continue;
          for (const key of ['attempts', 'correct', 'incorrect', 'hardMarks']) question[key] += Number(values[key]) || 0;
        }
      }
    }
  }
  return { kind: 'study', metrics: { ...metrics, average: metrics.learnersWithAnswers ? Math.round(metrics.learnerPercentSum / metrics.learnersWithAnswers * 100) / 100 : null,
    correctPercent: percent(metrics.correct, metrics.attempts) },
    questions: [...questionMap.values()].map((q) => ({ ...q, correctPercent: percent(q.correct, q.attempts) })),
    cursor: page.cursor, scannedUsers: page.entries.length, metricsScope: 'page', updatedAt: new Date().toISOString() };
}
module.exports = { readReport };
