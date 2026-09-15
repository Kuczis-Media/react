'use strict';
const assessmentText = require('../public/assets/js/assessment-text.js');

const crypto = require('node:crypto');
const openAnswerGrader = require('./open-answer-grader.js');

const EXAM_VERSION = 1;
const QUESTION_TYPES = Object.freeze([
  'single_choice',
  'multiple_choice',
  'true_false',
  'short_text',
  'number',
  'matching',
  'ordering',
  'fill_blanks',
  'open_answer'
]);
const QUESTION_TYPE_SET = new Set(QUESTION_TYPES);
const SAFE_EXAM_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SAFE_QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_MEDIA_REF = /^(?:photos\/|assets\/shared\/)(?!.*\.\.)(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const MAX_QUESTIONS = 500;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clean(value, max = 10_000) {
  return typeof value === 'string'
    ? value.replace(/\0/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max)
    : '';
}

function oneLine(value, max = 500) {
  return clean(value, max * 2).replace(/\s*\n+\s*/g, ' ').replace(/[ \t]+/g, ' ').slice(0, max);
}

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function integer(value, minimum, maximum, fallback = minimum) {
  return Math.round(clamp(value, minimum, maximum, fallback));
}

function uniqueStrings(values, limit = 50, maxLength = 120) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = oneLine(value, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeImage(value) {
  const source = typeof value === 'string' ? { ref: value } : plainObject(value) ? value : {};
  const ref = oneLine(source.ref || source.path, 240);
  if (!SAFE_MEDIA_REF.test(ref)) return null;
  return { ref, alt: oneLine(source.alt, 300) || 'Ilustracja do pytania' };
}

function normalizeImages(values, limit = 12) {
  return (Array.isArray(values) ? values : values ? [values] : [])
    .map(normalizeImage)
    .filter(Boolean)
    .slice(0, limit);
}

function stableId(value, prefix, seed) {
  const candidate = oneLine(value, 128);
  if (SAFE_QUESTION_ID.test(candidate)) return candidate;
  const hash = crypto.createHash('sha256').update(String(seed || crypto.randomUUID())).digest('hex').slice(0, 16);
  return `${prefix}-${hash}`;
}

function canonicalQuestionType(value) {
  const aliases = {
    single: 'single_choice',
    choice: 'single_choice',
    multiple: 'multiple_choice',
    boolean: 'true_false',
    text: 'short_text',
    open: 'open_answer',
    essay: 'open_answer',
    numeric: 'number',
    blanks: 'fill_blanks'
  };
  const requested = oneLine(value, 40).toLowerCase().replace(/[ -]+/g, '_');
  return QUESTION_TYPE_SET.has(requested) ? requested : aliases[requested] || 'single_choice';
}

function normalizeAnswerOption(value, index, questionId) {
  const source = typeof value === 'string' ? { text: value } : plainObject(value) ? value : {};
  return {
    answerId: stableId(source.answerId || source.id, 'answer', `${questionId}:${index}:${source.text || ''}`),
    text: oneLine(source.text || source.label, 1_000),
    images: normalizeImages(source.images || source.image, 4)
  };
}

function normalizeQuestion(value, index = 0) {
  const source = plainObject(value) ? value : {};
  const type = canonicalQuestionType(source.type);
  const questionId = stableId(source.questionId || source.id, 'question', `${index}:${source.prompt || source.text || ''}`);
  const question = {
    questionId,
    type,
    prompt: clean(source.prompt || source.text, 20_000),
    promptFormat: assessmentText.normalizeFormat(source.promptFormat),
    images: normalizeImages(source.images || source.image),
    tags: uniqueStrings(source.tags, 20, 80),
    categories: uniqueStrings(source.categories || (source.category ? [source.category] : []), 12, 80),
    points: clamp(source.points, 0, 10_000, 1),
    negativePoints: clamp(source.negativePoints, 0, 10_000, 0),
    explanation: clean(source.explanation, 10_000)
  };

  if (['single_choice', 'multiple_choice', 'true_false'].includes(type)) {
    const rawOptions = type === 'true_false' && !Array.isArray(source.options)
      ? [{ answerId: 'true', text: 'Prawda' }, { answerId: 'false', text: 'Fałsz' }]
      : source.options;
    question.options = (Array.isArray(rawOptions) ? rawOptions : [])
      .map((option, optionIndex) => normalizeAnswerOption(option, optionIndex, questionId))
      .filter((option) => option.text || option.images.length)
      .slice(0, 30);
    const requested = Array.isArray(source.correctAnswerIds)
      ? source.correctAnswerIds
      : source.correctAnswerId != null ? [source.correctAnswerId]
        : Array.isArray(source.correct) ? source.correct : source.correct != null ? [source.correct] : [];
    const byIndex = requested.map((entry) => {
      if (Number.isInteger(entry) && question.options[entry]) return question.options[entry].answerId;
      return oneLine(entry, 128);
    });
    question.correctAnswerIds = uniqueStrings(byIndex, question.options.length, 128)
      .filter((id) => question.options.some((option) => option.answerId === id));
    if (type !== 'multiple_choice') question.correctAnswerIds = question.correctAnswerIds.slice(0, 1);
  } else if (type === 'short_text') {
    question.acceptedAnswers = uniqueStrings(
      source.acceptedAnswers || source.answers || (source.correctAnswer != null ? [source.correctAnswer] : []),
      100,
      2_000
    );
    question.caseInsensitive = source.caseInsensitive !== false;
  } else if (type === 'number') {
    const correct = Number(source.correctNumber ?? source.correctAnswer);
    question.correctNumber = Number.isFinite(correct) ? correct : 0;
    question.tolerance = clamp(source.tolerance, 0, Number.MAX_SAFE_INTEGER, 0);
  } else if (type === 'matching') {
    question.pairs = (Array.isArray(source.pairs) ? source.pairs : [])
      .map((pair, pairIndex) => {
        const pairSource = plainObject(pair) ? pair : {};
        const pairId = stableId(pairSource.pairId || pairSource.id, 'pair', `${questionId}:${pairIndex}`);
        return {
          pairId,
          left: oneLine(pairSource.left, 1_000),
          right: oneLine(pairSource.right, 1_000),
          leftImages: normalizeImages(pairSource.leftImages || pairSource.leftImage, 4),
          rightImages: normalizeImages(pairSource.rightImages || pairSource.rightImage, 4)
        };
      })
      .filter((pair) => (pair.left || pair.leftImages.length) && (pair.right || pair.rightImages.length))
      .slice(0, 30);
  } else if (type === 'ordering') {
    question.items = (Array.isArray(source.items) ? source.items : [])
      .map((item, itemIndex) => {
        const itemSource = typeof item === 'string' ? { text: item } : plainObject(item) ? item : {};
        return {
          itemId: stableId(itemSource.itemId || itemSource.id, 'item', `${questionId}:${itemIndex}:${itemSource.text || ''}`),
          text: oneLine(itemSource.text, 1_000),
          images: normalizeImages(itemSource.images || itemSource.image, 4)
        };
      })
      .filter((item) => item.text || item.images.length)
      .slice(0, 40);
    const validIds = new Set(question.items.map((item) => item.itemId));
    const requestedOrder = Array.isArray(source.correctOrder) ? source.correctOrder.map((entry) => oneLine(entry, 128)) : [];
    question.correctOrder = requestedOrder.length === question.items.length && requestedOrder.every((id) => validIds.has(id))
      ? requestedOrder
      : question.items.map((item) => item.itemId);
  } else if (type === 'fill_blanks') {
    question.template = clean(source.template || source.prompt || source.text, 20_000);
    question.blanks = (Array.isArray(source.blanks) ? source.blanks : [])
      .map((blank, blankIndex) => {
        const blankSource = plainObject(blank) ? blank : { acceptedAnswers: [blank] };
        return {
          blankId: stableId(blankSource.blankId || blankSource.id, 'blank', `${questionId}:${blankIndex}`),
          acceptedAnswers: uniqueStrings(blankSource.acceptedAnswers || blankSource.answers, 50, 1_000),
          caseInsensitive: blankSource.caseInsensitive !== false
        };
      })
      .slice(0, 50);
  } else if (type === 'open_answer') {
    Object.assign(question, openAnswerGrader.normalizeOpenFields(source));
  }
  return question;
}

function normalizeAvailability(value) {
  const source = plainObject(value) ? value : {};
  const mode = ['always', 'from', 'until', 'range'].includes(source.mode) ? source.mode : 'always';
  const userIds = uniqueStrings(source.userIds, 5_000, 128);
  const audienceMode = ['all', 'selected'].includes(source.audienceMode)
    ? source.audienceMode : userIds.length ? 'selected' : 'all';
  const iso = (raw) => {
    const timestamp = Date.parse(raw || '');
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  };
  return {
    mode,
    from: iso(source.from),
    until: iso(source.until),
    audienceMode,
    userIds: audienceMode === 'selected' ? userIds : []
  };
}

function normalizeDefinition(value, expectedExamId = '') {
  const source = plainObject(value) ? value : {};
  const metadataSource = plainObject(source.metadata) ? source.metadata : source;
  const visibilitySource = plainObject(source.resultVisibility) ? source.resultVisibility : {};
  const feedbackMode = ['immediate', 'after_submit', 'never'].includes(visibilitySource.feedbackMode)
    ? visibilitySource.feedbackMode
    : visibilitySource.correctAnswers === true ? 'after_submit' : 'never';
  const candidateId = oneLine(source.examId || metadataSource.examId || expectedExamId, 80).toLowerCase();
  const examId = SAFE_EXAM_ID.test(candidateId) ? candidateId : '';
  const status = ['draft', 'published'].includes(source.status || metadataSource.status)
    ? (source.status || metadataSource.status)
    : 'draft';
  const definition = {
    version: EXAM_VERSION,
    examId,
    metadata: {
      name: oneLine(metadataSource.name || metadataSource.title, 180),
      description: clean(metadataSource.description, 5_000),
      instruction: clean(metadataSource.instruction || metadataSource.instructions, 20_000),
      cover: normalizeImage(metadataSource.cover),
      beforeStartMessage: clean(metadataSource.beforeStartMessage, 5_000),
      afterFinishMessage: clean(metadataSource.afterFinishMessage, 5_000),
      passThreshold: clamp(metadataSource.passThreshold ?? source.passThreshold, 0, 100, 60),
      tags: uniqueStrings(metadataSource.tags, 30, 80),
      categories: uniqueStrings(metadataSource.categories, 30, 80)
    },
    status,
    availability: normalizeAvailability(source.availability),
    display: {
      mode: ['one', 'page', 'all'].includes(source.display?.mode) ? source.display.mode : 'one',
      questionsPerPage: integer(source.display?.questionsPerPage, 1, 100, 1)
    },
    navigation: {
      allowBack: source.navigation?.allowBack !== false,
      allowFreeNavigation: source.navigation?.allowFreeNavigation !== false,
      allowSkip: source.navigation?.allowSkip !== false,
      requireAnswerBeforeNext: source.navigation?.requireAnswerBeforeNext === true,
      allowFlagging: source.navigation?.allowFlagging !== false
    },
    timing: {
      mode: ['none', 'exam', 'question'].includes(source.timing?.mode) ? source.timing.mode : 'none',
      limitSeconds: integer(source.timing?.limitSeconds, 1, 30 * 24 * 60 * 60, 3600),
      questionLimitSeconds: integer(source.timing?.questionLimitSeconds, 1, 24 * 60 * 60, 120),
      display: ['countdown', 'countup', 'hidden'].includes(source.timing?.display)
        ? source.timing.display : 'countdown'
    },
    randomization: {
      questionOrder: source.randomization?.questionOrder === true,
      answerOrder: source.randomization?.answerOrder === true,
      totalQuestions: source.randomization?.totalQuestions == null || source.randomization?.totalQuestions === ''
        ? null : integer(source.randomization.totalQuestions, 1, MAX_QUESTIONS, 1),
      categoryQuotas: (Array.isArray(source.randomization?.categoryQuotas) ? source.randomization.categoryQuotas : [])
        .map((quota) => ({ category: oneLine(quota?.category, 80), count: integer(quota?.count, 1, MAX_QUESTIONS, 1) }))
        .filter((quota) => quota.category)
        .slice(0, 50)
    },
    scoring: {
      equalPoints: source.scoring?.equalPoints !== false,
      defaultPoints: clamp(source.scoring?.defaultPoints, 0, 10_000, 1),
      partialPoints: source.scoring?.partialPoints === true,
      negativePointsEnabled: source.scoring?.negativePointsEnabled === true,
      defaultNegativePoints: clamp(source.scoring?.defaultNegativePoints, 0, 10_000, 0),
      multipleChoiceStrategy: ['all_or_nothing', 'per_option', 'correct_minus_incorrect']
        .includes(source.scoring?.multipleChoiceStrategy)
        ? source.scoring.multipleChoiceStrategy : 'all_or_nothing'
    },
    attempts: {
      mode: ['one', 'limited', 'unlimited'].includes(source.attempts?.mode) ? source.attempts.mode : 'one',
      maxAttempts: integer(source.attempts?.maxAttempts, 1, 1_000, 1),
      cooldownSeconds: integer(source.attempts?.cooldownSeconds, 0, 365 * 24 * 60 * 60, 0),
      resultStrategy: ['best', 'first', 'last', 'average'].includes(source.attempts?.resultStrategy)
        ? source.attempts.resultStrategy : 'best'
    },
    security: {
      leavePolicy: ['allow_resume', 'end_attempt', 'warn', 'log'].includes(source.security?.leavePolicy)
        ? source.security.leavePolicy : 'allow_resume'
    },
    resultVisibility: {
      feedbackMode,
      studentResultVisible: visibilitySource.studentResultVisible !== false,
      scorePercent: visibilitySource.scorePercent !== false,
      points: visibilitySource.points === true,
      passFail: visibilitySource.passFail !== false,
      ownAnswers: visibilitySource.ownAnswers === true,
      correctAnswers: feedbackMode !== 'never' || visibilitySource.correctAnswers === true,
      errors: feedbackMode !== 'never' || visibilitySource.errors === true,
      explanations: visibilitySource.explanations === true,
      time: visibilitySource.time !== false
    },
    questions: (Array.isArray(source.questions) ? source.questions : [])
      .slice(0, MAX_QUESTIONS)
      .map((question, index) => normalizeQuestion(question, index)),
    questionRefs: (Array.isArray(source.questionRefs) ? source.questionRefs : [])
      .map((reference) => oneLine(plainObject(reference) ? reference.questionId : reference, 128))
      .filter((id) => SAFE_QUESTION_ID.test(id))
      .slice(0, MAX_QUESTIONS)
  };
  return definition;
}

function validateQuestion(question, path, errors) {
  if (!SAFE_QUESTION_ID.test(question.questionId)) errors.push({ code: 'INVALID_QUESTION_ID', path });
  if (!question.prompt && question.type !== 'fill_blanks') errors.push({ code: 'QUESTION_PROMPT_REQUIRED', path });
  if (['single_choice', 'multiple_choice', 'true_false'].includes(question.type)) {
    if (question.options.length < 2) errors.push({ code: 'QUESTION_OPTIONS_REQUIRED', path });
    if (!question.correctAnswerIds.length) errors.push({ code: 'QUESTION_ANSWER_REQUIRED', path });
  }
  if (question.type === 'short_text' && !question.acceptedAnswers.length) errors.push({ code: 'QUESTION_ANSWER_REQUIRED', path });
  if (question.type === 'matching' && question.pairs.length < 2) errors.push({ code: 'QUESTION_PAIRS_REQUIRED', path });
  if (question.type === 'ordering' && question.items.length < 2) errors.push({ code: 'QUESTION_ITEMS_REQUIRED', path });
  if (question.type === 'fill_blanks' && (!question.template || !question.blanks.length)) {
    errors.push({ code: 'QUESTION_BLANKS_REQUIRED', path });
  }
  if (question.type === 'fill_blanks' && (question.template.match(/\{\{[^{}]*\}\}/g) || []).length !== question.blanks.length) {
    errors.push({ code: 'QUESTION_BLANK_COUNT', path });
  }
  if (question.type === 'fill_blanks' && question.blanks.some((blank) => !blank.acceptedAnswers.length)) {
    errors.push({ code: 'QUESTION_BLANK_ANSWER_REQUIRED', path });
  }
  if (question.type === 'open_answer' && question.gradingMode === 'ai' && !question.answerKey) {
    errors.push({ code: 'QUESTION_ANSWER_KEY_REQUIRED', path });
  }
}

function validateDefinition(value, expectedExamId = '') {
  const definition = normalizeDefinition(value, expectedExamId);
  const errors = [];
  if (!definition.examId || (expectedExamId && definition.examId !== expectedExamId)) {
    errors.push({ code: 'INVALID_EXAM_ID', path: 'examId' });
  }
  if (!definition.metadata.name) errors.push({ code: 'EXAM_NAME_REQUIRED', path: 'metadata.name' });
  if (definition.availability.audienceMode === 'selected' && !definition.availability.userIds.length) {
    errors.push({ code: 'AVAILABILITY_USERS_REQUIRED', path: 'availability.userIds' });
  }
  const ids = new Set();
  definition.questions.forEach((question, index) => {
    validateQuestion(question, `questions[${index}]`, errors);
    if (ids.has(question.questionId)) errors.push({ code: 'DUPLICATE_QUESTION_ID', path: `questions[${index}].questionId` });
    ids.add(question.questionId);
  });
  definition.questionRefs.forEach((questionId, index) => {
    if (ids.has(questionId)) errors.push({ code: 'DUPLICATE_QUESTION_ID', path: `questionRefs[${index}]` });
    ids.add(questionId);
  });
  const quotaCategories = new Set();
  let quotaTotal = 0;
  definition.randomization.categoryQuotas.forEach((quota, index) => {
    if (quotaCategories.has(quota.category)) {
      errors.push({ code: 'DUPLICATE_CATEGORY_QUOTA', path: `randomization.categoryQuotas[${index}]` });
    }
    quotaCategories.add(quota.category);
    quotaTotal += quota.count;
  });
  if (definition.randomization.totalQuestions && quotaTotal > definition.randomization.totalQuestions) {
    errors.push({ code: 'CATEGORY_QUOTAS_EXCEED_TOTAL', path: 'randomization.categoryQuotas' });
  }
  if (!ids.size) errors.push({ code: 'EXAM_QUESTIONS_REQUIRED', path: 'questions' });
  return { valid: errors.length === 0, errors, definition };
}

function normalizeQuestionBank(value) {
  const source = plainObject(value) ? value : {};
  const seen = new Set();
  const questions = [];
  (Array.isArray(source.questions) ? source.questions : []).slice(0, 5_000).forEach((question, index) => {
    const normalized = normalizeQuestion(question, index);
    if (seen.has(normalized.questionId)) return;
    seen.add(normalized.questionId);
    questions.push(normalized);
  });
  return { version: 1, questions, updatedAt: clean(source.updatedAt, 40) || null };
}

function validateQuestionBank(value) {
  const source = plainObject(value) ? value : {};
  const rawQuestions = Array.isArray(source.questions) ? source.questions.slice(0, 5_000) : [];
  const bank = { version: 1, questions: rawQuestions.map((question, index) => normalizeQuestion(question, index)), updatedAt: clean(source.updatedAt, 40) || null };
  const errors = [];
  const ids = new Set();
  bank.questions.forEach((question, index) => {
    validateQuestion(question, `questions[${index}]`, errors);
    if (ids.has(question.questionId)) {
      errors.push({ code: 'DUPLICATE_QUESTION_ID', path: `questions[${index}].questionId` });
    }
    ids.add(question.questionId);
  });
  return { valid: errors.length === 0, errors, bank };
}

function resolveExamQuestions(definition, bank) {
  const direct = definition.questions.map((question) => structuredClone(question));
  const byId = new Map(normalizeQuestionBank(bank).questions.map((question) => [question.questionId, question]));
  for (const questionId of definition.questionRefs) {
    const question = byId.get(questionId);
    if (question) direct.push(structuredClone(question));
  }
  return direct;
}

function shuffle(values, randomInt) {
  const result = values.slice();
  const pick = typeof randomInt === 'function'
    ? randomInt
    : (maximum) => crypto.randomInt(0, maximum);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.max(0, Math.min(index, Number(pick(index + 1)) || 0));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function selectAttemptQuestions(definitionInput, bank, options = {}) {
  const definition = normalizeDefinition(definitionInput, definitionInput?.examId);
  const all = resolveExamQuestions(definition, bank);
  const selected = [];
  const selectedIds = new Set();
  for (const quota of definition.randomization.categoryQuotas) {
    const pool = all.filter((question) => !selectedIds.has(question.questionId) && question.categories.includes(quota.category));
    for (const question of shuffle(pool, options.randomInt).slice(0, quota.count)) {
      selected.push(question);
      selectedIds.add(question.questionId);
    }
  }
  const requestedTotal = definition.randomization.totalQuestions || all.length;
  if (selected.length < requestedTotal) {
    const remaining = all.filter((question) => !selectedIds.has(question.questionId));
    for (const question of shuffle(remaining, options.randomInt).slice(0, requestedTotal - selected.length)) {
      selected.push(question);
      selectedIds.add(question.questionId);
    }
  }
  const ordered = definition.randomization.questionOrder ? shuffle(selected, options.randomInt) : selected;
  return ordered.map((question) => {
    const snapshot = structuredClone(question);
    if (definition.scoring.equalPoints && !(snapshot.type === 'open_answer' && snapshot.gradingMode === 'ungraded')) {
      snapshot.points = definition.scoring.defaultPoints;
    }
    if (definition.scoring.negativePointsEnabled && !snapshot.negativePoints) {
      snapshot.negativePoints = definition.scoring.defaultNegativePoints;
    }
    snapshot.answerOrder = [];
    if (Array.isArray(snapshot.options)) {
      const ids = snapshot.options.map((option) => option.answerId);
      snapshot.answerOrder = definition.randomization.answerOrder ? shuffle(ids, options.randomInt) : ids;
    }
    if (snapshot.type === 'matching') {
      snapshot.leftOrder = snapshot.pairs.map((pair) => pair.pairId);
      snapshot.rightOrder = definition.randomization.answerOrder
        ? shuffle(snapshot.leftOrder, options.randomInt) : snapshot.leftOrder.slice();
      snapshot.matchingRightIds = Object.fromEntries(snapshot.pairs.map((pair) => [
        pair.pairId,
        `match-${crypto.randomBytes(12).toString('hex')}`
      ]));
    }
    if (snapshot.type === 'ordering') {
      snapshot.itemOrder = shuffle(snapshot.items.map((item) => item.itemId), options.randomInt);
    }
    return snapshot;
  });
}

function publicMetadata(definitionInput) {
  const definition = normalizeDefinition(definitionInput, definitionInput?.examId);
  return {
    version: definition.version,
    examId: definition.examId,
    metadata: definition.metadata,
    status: definition.status,
    availability: {
      mode: definition.availability.mode,
      from: definition.availability.from,
      until: definition.availability.until,
      restrictedToSelectedUsers: definition.availability.audienceMode === 'selected'
    },
    display: definition.display,
    navigation: definition.navigation,
    timing: definition.timing,
    attempts: definition.attempts,
    security: definition.security,
    resultVisibility: {
      feedbackMode: definition.resultVisibility.feedbackMode,
      studentResultVisible: definition.resultVisibility.studentResultVisible
    }
  };
}

function safeQuestion(question) {
  const common = {
    questionId: question.questionId,
    type: question.type,
    prompt: question.prompt,
    promptFormat: assessmentText.normalizeFormat(question.promptFormat),
    images: question.images,
    points: question.points
  };
  if (Array.isArray(question.options)) {
    const byId = new Map(question.options.map((option) => [option.answerId, option]));
    common.options = (question.answerOrder || question.options.map((option) => option.answerId))
      .map((id) => byId.get(id)).filter(Boolean);
  }
  if (question.type === 'matching') {
    const byId = new Map(question.pairs.map((pair) => [pair.pairId, pair]));
    common.left = (question.leftOrder || question.pairs.map((pair) => pair.pairId)).map((id) => {
      const pair = byId.get(id);
      return { pairId: id, text: pair.left, images: pair.leftImages };
    });
    common.right = (question.rightOrder || question.pairs.map((pair) => pair.pairId)).map((id) => {
      const pair = byId.get(id);
      return { answerId: question.matchingRightIds?.[id] || id, text: pair.right, images: pair.rightImages };
    });
  }
  if (question.type === 'ordering') {
    const byId = new Map(question.items.map((item) => [item.itemId, item]));
    common.items = (question.itemOrder || question.items.map((item) => item.itemId)).map((id) => byId.get(id)).filter(Boolean);
  }
  if (question.type === 'fill_blanks') {
    common.template = question.template;
    common.blanks = question.blanks.map((blank) => ({ blankId: blank.blankId }));
  }
  if (question.type === 'open_answer') {
    common.gradingMode = question.gradingMode;
    common.multiline = question.multiline !== false;
  }
  return common;
}

function normalizeTextAnswer(value, caseInsensitive) {
  let result = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (caseInsensitive) result = result.toLocaleLowerCase('pl');
  return result;
}

function answerIsPresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (plainObject(value)) return Object.values(value).some((entry) => (
    entry !== null && entry !== undefined && String(entry).trim() !== ''
  ));
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function gradeQuestion(question, rawAnswer, scoringInput = {}, gradingOptions = {}) {
  const scoring = normalizeDefinition({ examId: 'grade', metadata: { name: 'grade' }, questions: [], scoring: scoringInput }).scoring;
  const maxPoints = clamp(question.points, 0, 10_000, scoring.defaultPoints);
  const negative = scoring.negativePointsEnabled ? clamp(question.negativePoints, 0, 10_000, scoring.defaultNegativePoints) : 0;
  if (question.type === 'open_answer') {
    return openAnswerGrader.gradeOpenQuestion(question, rawAnswer, gradingOptions);
  }
  let ratio = 0;
  let correct = false;
  if (['single_choice', 'true_false'].includes(question.type)) {
    correct = oneLine(rawAnswer, 128) === question.correctAnswerIds[0];
    ratio = correct ? 1 : 0;
  } else if (question.type === 'multiple_choice') {
    const selected = new Set(uniqueStrings(Array.isArray(rawAnswer) ? rawAnswer : [], 100, 128));
    const expected = new Set(question.correctAnswerIds);
    const correctSelected = [...selected].filter((id) => expected.has(id)).length;
    const incorrectSelected = [...selected].filter((id) => !expected.has(id)).length;
    correct = selected.size === expected.size && correctSelected === expected.size;
    if (correct) ratio = 1;
    else if (scoring.partialPoints) {
      if (scoring.multipleChoiceStrategy === 'per_option') {
        const allIds = new Set(question.options.map((option) => option.answerId));
        const decisions = [...allIds].filter((id) => selected.has(id) === expected.has(id)).length;
        ratio = allIds.size ? decisions / allIds.size : 0;
      } else if (scoring.multipleChoiceStrategy === 'correct_minus_incorrect') {
        ratio = expected.size ? Math.max(0, (correctSelected - incorrectSelected) / expected.size) : 0;
      }
    }
  } else if (question.type === 'short_text') {
    const candidate = normalizeTextAnswer(rawAnswer, question.caseInsensitive);
    correct = question.acceptedAnswers.some((answer) => normalizeTextAnswer(answer, question.caseInsensitive) === candidate);
    ratio = correct ? 1 : 0;
  } else if (question.type === 'number') {
    const candidate = Number(String(rawAnswer ?? '').replace(',', '.'));
    correct = Number.isFinite(candidate) && Math.abs(candidate - question.correctNumber) <= question.tolerance;
    ratio = correct ? 1 : 0;
  } else if (question.type === 'matching') {
    const answer = plainObject(rawAnswer) ? rawAnswer : {};
    const hits = question.pairs.filter((pair) => (
      oneLine(answer[pair.pairId], 128) === (question.matchingRightIds?.[pair.pairId] || pair.pairId)
    )).length;
    correct = hits === question.pairs.length;
    ratio = correct ? 1 : scoring.partialPoints && question.pairs.length ? hits / question.pairs.length : 0;
  } else if (question.type === 'ordering') {
    const answer = Array.isArray(rawAnswer) ? rawAnswer.map((item) => oneLine(item, 128)) : [];
    const hits = question.correctOrder.filter((id, index) => answer[index] === id).length;
    correct = hits === question.correctOrder.length && answer.length === question.correctOrder.length;
    ratio = correct ? 1 : scoring.partialPoints && question.correctOrder.length ? hits / question.correctOrder.length : 0;
  } else if (question.type === 'fill_blanks') {
    const answer = plainObject(rawAnswer) ? rawAnswer : {};
    const hits = question.blanks.filter((blank) => {
      const candidate = normalizeTextAnswer(answer[blank.blankId], blank.caseInsensitive);
      return blank.acceptedAnswers.some((accepted) => normalizeTextAnswer(accepted, blank.caseInsensitive) === candidate);
    }).length;
    correct = hits === question.blanks.length;
    ratio = correct ? 1 : scoring.partialPoints && question.blanks.length ? hits / question.blanks.length : 0;
  }
  let points = maxPoints * ratio;
  if (!correct && ratio === 0 && negative > 0 && answerIsPresent(rawAnswer)) points = -negative;
  return {
    correct,
    points: Math.round(points * 10000) / 10000,
    maxPoints,
    ratio: Math.round(ratio * 10000) / 10000,
    gradingMode: 'automatic',
    reviewStatus: 'graded',
    feedback: ''
  };
}

function gradeAttempt(attempt, definitionInput, gradingOptions = {}) {
  const definition = normalizeDefinition(definitionInput, definitionInput?.examId);
  const answers = plainObject(attempt.answers) ? attempt.answers : {};
  const questionResults = attempt.questions.map((question) => {
    const answer = Object.hasOwn(answers, question.questionId) ? answers[question.questionId] : null;
    return {
      questionId: question.questionId,
      answer,
      ...gradeQuestion(question, answer, definition.scoring, gradingOptions)
    };
  });
  const pendingQuestionIds = questionResults
    .filter((result) => result.reviewStatus === 'pending')
    .map((result) => result.questionId);
  const points = questionResults.reduce((sum, result) => sum + (Number.isFinite(Number(result.points)) ? Number(result.points) : 0), 0);
  const maxPoints = questionResults.reduce((sum, result) => sum + result.maxPoints, 0);
  const scorePercent = pendingQuestionIds.length
    ? null
    : maxPoints > 0 ? clamp((points / maxPoints) * 100, 0, 100, 0) : null;
  return {
    questionResults,
    points: Math.round(points * 10000) / 10000,
    maxPoints: Math.round(maxPoints * 10000) / 10000,
    scorePercent: scorePercent == null ? null : Math.round(scorePercent * 100) / 100,
    passed: scorePercent == null ? null : scorePercent >= definition.metadata.passThreshold,
    gradingStatus: pendingQuestionIds.length ? 'pending_review' : maxPoints > 0 ? 'graded' : 'not_scored',
    pendingQuestionIds
  };
}

function availabilityState(definitionInput, userId, now = Date.now()) {
  const definition = normalizeDefinition(definitionInput, definitionInput?.examId);
  const config = definition.availability;
  if (config.audienceMode === 'selected' && !config.userIds.includes(String(userId || ''))) {
    return { available: false, reason: 'USER_NOT_ALLOWED' };
  }
  const from = Date.parse(config.from || '');
  const until = Date.parse(config.until || '');
  if (['from', 'range'].includes(config.mode) && Number.isFinite(from) && now < from) {
    return { available: false, reason: 'EXAM_NOT_OPEN_YET', availableAt: config.from };
  }
  if (['until', 'range'].includes(config.mode) && Number.isFinite(until) && now > until) {
    return { available: false, reason: 'EXAM_CLOSED', closedAt: config.until };
  }
  return { available: true, reason: null };
}

function resultForStudent(attempt, definitionInput) {
  const definition = normalizeDefinition(definitionInput, definitionInput?.examId);
  const visibility = definition.resultVisibility;
  const result = {
    attemptId: attempt.attemptId,
    status: attempt.status,
    submittedAt: attempt.submittedAt || null,
    timedOut: attempt.status === 'timed_out',
    gradingStatus: attempt.result?.gradingStatus || 'graded',
    pendingQuestionCount: Array.isArray(attempt.result?.pendingQuestionIds) ? attempt.result.pendingQuestionIds.length : 0
  };
  if (!visibility.studentResultVisible) return result;
  if (visibility.scorePercent) result.scorePercent = attempt.result?.scorePercent ?? null;
  if (visibility.points) {
    result.points = attempt.result?.points ?? null;
    result.maxPoints = attempt.result?.maxPoints ?? null;
  }
  if (visibility.passFail) result.passed = attempt.result?.passed ?? null;
  if (visibility.time) result.durationSeconds = attempt.durationSeconds ?? null;
  const answerFeedback = ['immediate', 'after_submit'].includes(visibility.feedbackMode);
  if (visibility.ownAnswers || answerFeedback || visibility.explanations) {
    const byId = new Map((attempt.result?.questionResults || []).map((entry) => [entry.questionId, entry]));
    result.questions = attempt.questions.map((question) => {
      const graded = byId.get(question.questionId) || {};
      const item = { questionId: question.questionId, prompt: question.prompt, promptFormat: assessmentText.normalizeFormat(question.promptFormat), type: question.type };
      if (visibility.ownAnswers) {
        item.answer = attempt.answers && Object.hasOwn(attempt.answers, question.questionId)
          ? attempt.answers[question.questionId] : null;
        item.answerDisplay = displayAnswer(question, item.answer);
      }
      if (answerFeedback && graded.correct != null) item.correct = graded.correct === true;
      if (question.type === 'open_answer') {
        item.reviewStatus = graded.reviewStatus || 'pending';
        if (visibility.points) {
          item.points = graded.points ?? null;
          item.maxPoints = graded.maxPoints ?? openAnswerGrader.effectiveMaxPoints(question);
        }
        if (answerFeedback && graded.feedback) item.feedback = graded.feedback;
      }
      if (visibility.explanations && !(question.type === 'open_answer' && graded.reviewStatus === 'pending')) {
        item.explanation = question.explanation || '';
      }
      if (answerFeedback) {
        if (question.type !== 'open_answer') item.correctAnswerDisplay = displayCorrectAnswer(question);
        if (question.correctAnswerIds) item.correctAnswerIds = question.correctAnswerIds;
        if (question.acceptedAnswers) item.acceptedAnswers = question.acceptedAnswers;
        if (question.type === 'number') item.correctNumber = question.correctNumber;
        if (question.correctOrder) item.correctOrder = question.correctOrder;
        if (question.type === 'matching') item.correctMatches = Object.fromEntries(question.pairs.map((pair) => [pair.pairId, pair.pairId]));
        if (question.type === 'fill_blanks') item.correctBlanks = Object.fromEntries(question.blanks.map((blank) => [blank.blankId, blank.acceptedAnswers]));
      }
      return item;
    });
  }
  return result;
}

function immediateQuestionFeedback(question, rawAnswer, definitionInput) {
  const definition = normalizeDefinition(definitionInput, definitionInput?.examId);
  if (definition.resultVisibility.feedbackMode !== 'immediate') return null;
  if (question.type === 'open_answer') {
    return {
      questionId: question.questionId,
      deferred: true,
      message: question.gradingMode === 'ungraded'
        ? 'Odpowiedź zapisana. To pytanie nie wpływa na wynik.'
        : 'Odpowiedź zapisana. Ocena pojawi się po zakończeniu egzaminu.'
    };
  }
  const graded = gradeQuestion(question, rawAnswer, definition.scoring);
  return {
    questionId: question.questionId,
    correct: graded.correct === true,
    correctAnswerDisplay: displayCorrectAnswer(question),
    ...(definition.resultVisibility.explanations && question.explanation
      ? { explanation: question.explanation } : {})
  };
}

function displayAnswer(question, answer) {
  if (answer == null || answer === '') return [];
  if (Array.isArray(question.options)) {
    const selected = Array.isArray(answer) ? answer : [answer];
    const labels = new Map(question.options.map((option) => [option.answerId, option.text || option.answerId]));
    return selected.map((value) => labels.get(String(value)) || String(value));
  }
  if (question.type === 'matching') {
    const values = plainObject(answer) ? answer : {};
    const byPair = new Map(question.pairs.map((pair) => [pair.pairId, pair]));
    const byToken = new Map(Object.entries(question.matchingRightIds || {}).map(([pairId, token]) => [token, byPair.get(pairId)]));
    return Object.entries(values).map(([leftId, rightToken]) => {
      const left = byPair.get(leftId);
      const right = byToken.get(String(rightToken));
      return `${left?.left || leftId} → ${right?.right || 'brak dopasowania'}`;
    });
  }
  if (question.type === 'ordering') {
    const labels = new Map(question.items.map((item) => [item.itemId, item.text || item.itemId]));
    return (Array.isArray(answer) ? answer : []).map((value, index) => `${index + 1}. ${labels.get(String(value)) || value}`);
  }
  if (question.type === 'fill_blanks') {
    const values = plainObject(answer) ? answer : {};
    return question.blanks.map((blank, index) => `Luka ${index + 1}: ${String(values[blank.blankId] ?? '')}`);
  }
  return [String(answer)];
}

function displayCorrectAnswer(question) {
  if (Array.isArray(question.options)) return displayAnswer(question, question.correctAnswerIds || []);
  if (question.type === 'short_text') return question.acceptedAnswers.slice();
  if (question.type === 'number') {
    return [`${question.correctNumber}${question.tolerance ? ` (tolerancja ±${question.tolerance})` : ''}`];
  }
  if (question.type === 'matching') return question.pairs.map((pair) => `${pair.left} → ${pair.right}`);
  if (question.type === 'ordering') return displayAnswer(question, question.correctOrder || []);
  if (question.type === 'fill_blanks') {
    return question.blanks.map((blank, index) => `Luka ${index + 1}: ${blank.acceptedAnswers.join(' / ')}`);
  }
  return [];
}

function canonicalMaterialId(repositoryId, examId) {
  const repo = SAFE_REPOSITORY_ID.test(repositoryId || '') ? repositoryId : 'default';
  return `exam:${repo}:${examId}`.slice(0, 128);
}

module.exports = {
  EXAM_VERSION,
  MAX_QUESTIONS,
  QUESTION_TYPES,
  SAFE_EXAM_ID,
  SAFE_MEDIA_REF,
  SAFE_QUESTION_ID,
  SAFE_REPOSITORY_ID,
  answerIsPresent,
  availabilityState,
  canonicalMaterialId,
  canonicalQuestionType,
  displayAnswer,
  displayCorrectAnswer,
  gradeAttempt,
  gradeQuestion,
  immediateQuestionFeedback,
  normalizeDefinition,
  normalizeImage,
  normalizeQuestion,
  normalizeQuestionBank,
  plainObject,
  publicMetadata,
  resolveExamQuestions,
  resultForStudent,
  safeQuestion,
  selectAttemptQuestions,
  validateDefinition,
  validateQuestionBank
};
