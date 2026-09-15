'use strict';

const openAnswerGrader = require('./open-answer-grader.js');
const practice = require('../public/assets/js/quiz-practice.js');
const occlusion = require('../public/assets/js/quiz-occlusion-model.js');

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_MEDIA_REF = /^(?:photos\/|assets\/shared\/)[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/i;
const QUESTION_TYPES = new Set(['single', 'multiple', 'true_false', 'text', 'open', 'flashcard', 'image_occlusion']);

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function string(value, max, required = false) {
  return typeof value === 'string'
    && value.length <= max
    && (!required || Boolean(value.trim()))
    && !/[\u0000]/.test(value);
}

function validImage(value) {
  if (!object(value)) return false;
  if (!string(value.ref, 240) || !string(value.alt, 300)) return false;
  return !value.ref || SAFE_MEDIA_REF.test(value.ref);
}

function validateDefinition(value, expectedQuizId = '') {
  const invalid = () => ({ valid: false, errors: [{ code: 'QUIZ_FILE_INVALID' }] });
  if (!object(value) || value.version !== 1 || !SAFE_ID.test(value.quizId || '')) return invalid();
  if (expectedQuizId && value.quizId !== expectedQuizId) return invalid();
  if (value.mode !== undefined && !['quiz', 'deck'].includes(value.mode)) return invalid();
  if (!object(value.metadata) || !string(value.metadata.title, 180, true) || !string(value.metadata.description, 1200)) return invalid();
  if (!['draft', 'published'].includes(value.metadata.status) || !Array.isArray(value.metadata.tags) || value.metadata.tags.length > 20) return invalid();
  if (value.metadata.tags.some((tag) => !string(tag, 60, true)) || !validImage(value.metadata.cover)) return invalid();
  if (value.mode === 'deck') {
    if (typeof value.metadata.active !== 'boolean' || !string(value.metadata.courseId, 128)) return invalid();
    if (value.metadata.status === 'published' && !SAFE_STABLE_ID.test(value.metadata.courseId)) return invalid();
  }
  if (!object(value.settings)) return invalid();
  if (!Number.isInteger(value.settings.passingScore) || value.settings.passingScore < 0 || value.settings.passingScore > 100) return invalid();
  if (typeof value.settings.shuffleQuestions !== 'boolean' || typeof value.settings.showFeedback !== 'boolean' || typeof value.settings.allowRetry !== 'boolean') return invalid();
  if (!Array.isArray(value.questions) || !value.questions.length || value.questions.length > 200) return invalid();

  const ids = new Set();
  for (const question of value.questions) {
    if (!object(question) || !SAFE_STABLE_ID.test(question.questionId || '') || ids.has(question.questionId)) return invalid();
    ids.add(question.questionId);
    if (question.tags !== undefined && (!Array.isArray(question.tags) || question.tags.length > 20 || question.tags.some((tag) => !string(tag, 60, true)))) return invalid();
    if (!QUESTION_TYPES.has(question.type) || !string(question.prompt, 3000, question.type !== 'flashcard')) return invalid();
    if (value.mode === 'deck' && !practice.DECK_TYPES.includes(question.type)) return invalid();
    if (!Number.isFinite(question.points) || question.points < 0 || question.points > 10_000 || typeof question.required !== 'boolean') return invalid();
    if (!validImage(question.image) || !string(question.explanation, 3000)) return invalid();
    if (!Array.isArray(question.options) || question.options.length > 12 || !Array.isArray(question.acceptedAnswers) || question.acceptedAnswers.length > 20) return invalid();
    if (question.acceptedAnswers.some((answer) => !string(answer, 500, true))) return invalid();
    if (question.type === 'image_occlusion') {
      if (question.points !== 0 || question.required !== false || question.options.length || question.acceptedAnswers.length || !occlusion.valid(question.occlusion, value.metadata.status === 'published')) return invalid();
      if (value.metadata.status === 'published' && !question.image.ref) return invalid();
    }
    if (value.mode === 'deck' && question.options.length > 6) return invalid();
    if (question.textCompare !== undefined) {
      const config = question.textCompare;
      if (question.type !== 'text' || !object(config)) return invalid();
      if (['ignoreCase', 'collapseWhitespace', 'ignoreFinalPeriod'].some((key) => typeof config[key] !== 'boolean')) return invalid();
      if (!Number.isInteger(config.maxTypos) || config.maxTypos < 0 || config.maxTypos > 2) return invalid();
    }
    if (question.type === 'flashcard') {
      if (question.points !== 0 || question.required !== false || question.options.length || question.acceptedAnswers.length) return invalid();
      for (const side of ['front', 'back']) {
        const face = question[side];
        if (!object(face) || !string(face.text, 10000) || !Array.isArray(face.images) || face.images.length > 8) return invalid();
        if (face.images.some((image) => !validImage(image) || !image.ref)) return invalid();
        if (value.metadata.status === 'published' && !face.text.trim() && !face.images.length) return invalid();
      }
    }

    for (const option of question.options) {
      if (!object(option) || !SAFE_STABLE_ID.test(option.optionId || '') || ids.has(option.optionId)) return invalid();
      ids.add(option.optionId);
      if (!string(option.text, 500, true) || typeof option.correct !== 'boolean') return invalid();
      if (option.image !== undefined && !validImage(option.image)) return invalid();
    }
    const correctCount = question.options.filter((option) => option.correct).length;
    if (question.type === 'single' && (question.options.length < 2 || correctCount !== 1)) return invalid();
    if (question.type === 'multiple' && (question.options.length < 2 || correctCount < 1)) return invalid();
    if (question.type === 'true_false' && (question.options.length !== 2 || correctCount !== 1)) return invalid();
    if (question.type === 'text' && (question.options.length !== 0 || question.acceptedAnswers.length < 1)) return invalid();
    if (question.type === 'open') {
      if (question.options.length !== 0 || question.acceptedAnswers.length !== 0) return invalid();
      if (!openAnswerGrader.GRADING_MODES.includes(question.gradingMode)) return invalid();
      if (!string(question.answerKey, 10_000) || !string(question.aiInstruction, 2_000) || typeof question.multiline !== 'boolean') return invalid();
      if (value.metadata.status === 'published' && question.points > 0 && question.gradingMode === 'ai' && !question.answerKey.trim()) return invalid();
    }
    if (!['text', 'open'].includes(question.type) && question.acceptedAnswers.length !== 0) return invalid();
  }
  return { valid: true, errors: [] };
}

function objectiveGrade(question, answer) {
  const { correct } = practice.evaluate(question, answer);
  return {
    questionId: question.questionId,
    answer: answer ?? null,
    correct,
    points: correct ? question.points : 0,
    maxPoints: question.points,
    gradingMode: 'automatic',
    reviewStatus: 'graded',
    feedback: ''
  };
}

function gradeQuiz(definition, answers = {}, gradingOptions = {}) {
  const results = definition.questions.map((question) => {
    const answer = answers && Object.hasOwn(answers, question.questionId) ? answers[question.questionId] : null;
    if (['flashcard', 'image_occlusion'].includes(question.type)) return { questionId: question.questionId, answer: null, correct: null, points: 0, maxPoints: 0, gradingMode: 'ungraded', reviewStatus: 'not_scored', feedback: '' };
    if (question.type !== 'open') return objectiveGrade(question, answer);
    return {
      answer,
      ...openAnswerGrader.gradeOpenQuestion(question, answer, gradingOptions)
    };
  });
  const pendingQuestionIds = results.filter((entry) => entry.reviewStatus === 'pending').map((entry) => entry.questionId);
  const earned = results.reduce((sum, entry) => sum + (Number.isFinite(Number(entry.points)) ? Number(entry.points) : 0), 0);
  const maximum = results.reduce((sum, entry) => sum + (Number(entry.maxPoints) || 0), 0);
  const percent = pendingQuestionIds.length ? null : maximum ? Math.round((earned / maximum) * 10_000) / 100 : null;
  return {
    earned: Math.round(earned * 100) / 100,
    maximum: Math.round(maximum * 100) / 100,
    percent,
    passed: percent == null ? null : percent >= definition.settings.passingScore,
    gradingStatus: pendingQuestionIds.length ? 'pending_review' : maximum > 0 ? 'graded' : 'not_scored',
    pendingQuestionIds,
    results
  };
}

function publicDefinition(definition) {
  // Objective quizzes are practice materials: the browser receives their full
  // key and grades locally. Only open-answer rubrics remain server-side.
  // Do not reuse this contract for exams, which have a separate safeQuestion.
  const result = structuredClone(definition);
  result.questions.forEach((question) => {
    if (question.type !== 'open') return;
    delete question.answerKey;
    delete question.aiInstruction;
    delete question.explanation;
  });
  return result;
}

module.exports = {
  gradeQuiz,
  objectiveGrade,
  publicDefinition,
  validateDefinition
};
