'use strict';

const examStorage = require('./exam-storage.js');

function storageQuizId(quizId) {
  return `quiz:${String(quizId || '')}`;
}

function withStorageId(input) {
  return { ...input, examId: storageQuizId(input.quizId || input.examId) };
}

function getQuizStore() {
  return examStorage.getExamStore();
}

function reserveAttempt(store, input) {
  return examStorage.reserveAttempt(store, withStorageId(input));
}

function createAttempt(store, attempt) {
  return examStorage.createAttempt(store, withStorageId(attempt));
}

function readAttempt(store, repositoryId, quizId, userId, attemptId) {
  return examStorage.readAttempt(store, repositoryId, storageQuizId(quizId), userId, attemptId);
}

function updateAttempt(store, input, updater) {
  return examStorage.updateAttempt(store, withStorageId(input), updater);
}

function readUserQuizIndex(store, repositoryId, quizId, userId, profile = {}) {
  return examStorage.readUserExamIndex(store, repositoryId, storageQuizId(quizId), userId, profile);
}

function readReport(store, repositoryId, quizId, options) {
  return examStorage.readReport(store, repositoryId, storageQuizId(quizId), options);
}

function syncAttemptIndexes(store, attempt, profile = {}) {
  return examStorage.syncAttemptIndexes(store, attempt, profile);
}

function setStoreFactory(factory) {
  examStorage.setStoreFactory(factory);
}

module.exports = {
  createAttempt,
  getQuizStore,
  readAttempt,
  readReport,
  readUserQuizIndex,
  reserveAttempt,
  setStoreFactory,
  storageQuizId,
  syncAttemptIndexes,
  updateAttempt
};
