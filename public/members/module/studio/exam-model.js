(function exposeExamStudioModel(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemExamStudioModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createExamStudioModel() {
  'use strict';

  const QUESTION_TYPES = Object.freeze([
    'single_choice', 'multiple_choice', 'true_false', 'short_text',
    'number', 'matching', 'ordering', 'fill_blanks', 'open_answer'
  ]);
  const SAFE_EXAM_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  let sequence = 0;

  function id(prefix) {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
  }

  function text(value, maximum = 10_000) {
    return String(value == null ? '' : value).replace(/\0/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maximum);
  }

  function line(value, maximum = 500) {
    return text(value, maximum * 2).replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').slice(0, maximum);
  }

  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function list(value) {
    return Array.isArray(value)
      ? [...new Set(value.map((entry) => line(entry, 120)).filter(Boolean))]
      : String(value || '').split(/[,\n]/).map((entry) => line(entry, 120)).filter(Boolean);
  }

  function normalizeImages(value) {
    return (Array.isArray(value) ? value : value ? [value] : []).map((image) => ({
      ref: line(typeof image === 'string' ? image : image?.ref, 240),
      alt: line(typeof image === 'object' ? image?.alt : '', 300) || 'Ilustracja do pytania'
    })).filter((image) => /^(?:photos\/|assets\/shared\/)(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_./-]{0,220}$/.test(image.ref)).slice(0, 12);
  }

  function answerOption(source, index, questionId) {
    const input = typeof source === 'string' ? { text: source } : source || {};
    return {
      answerId: SAFE_ID.test(input.answerId || '') ? input.answerId : `${questionId}-answer-${index + 1}`,
      text: line(input.text, 1_000),
      images: normalizeImages(input.images || input.image)
    };
  }

  function createQuestion(seed) {
    const source = seed && typeof seed === 'object' ? seed : {};
    const type = QUESTION_TYPES.includes(source.type) ? source.type : 'single_choice';
    const questionId = SAFE_ID.test(source.questionId || '') ? source.questionId : id('question');
    const base = {
      questionId,
      type,
      prompt: text(source.prompt || 'Wpisz treść pytania.'),
      promptFormat: (typeof module === 'object' && module.exports ? require('../../../assets/js/assessment-text.js') : globalThis.ChemAssessmentText).normalizeFormat(source.promptFormat),
      images: normalizeImages(source.images || source.image),
      tags: list(source.tags).slice(0, 20),
      categories: list(source.categories || source.category).slice(0, 12),
      points: clamp(source.points, 0, 10_000, 1),
      negativePoints: clamp(source.negativePoints, 0, 10_000, 0),
      explanation: text(source.explanation),
      sourceText: text(source.sourceText || source.passage || ''),
      splitScreen: Boolean(source.splitScreen || source.sourceText || source.passage)
    };
    if (['single_choice', 'multiple_choice', 'true_false'].includes(type)) {
      const defaults = type === 'true_false'
        ? [{ answerId: 'true', text: 'Prawda' }, { answerId: 'false', text: 'Fałsz' }]
        : ['Odpowiedź A', 'Odpowiedź B', 'Odpowiedź C', 'Odpowiedź D'];
      base.options = (Array.isArray(source.options) && source.options.length ? source.options : defaults)
        .map((option, index) => answerOption(option, index, questionId));
      const requested = Array.isArray(source.correctAnswerIds) ? source.correctAnswerIds : [];
      base.correctAnswerIds = requested.filter((answerId) => base.options.some((option) => option.answerId === answerId));
      if (!Array.isArray(source.correctAnswerIds) && !base.correctAnswerIds.length && base.options[0]) base.correctAnswerIds = [base.options[0].answerId];
      if (type !== 'multiple_choice') base.correctAnswerIds = base.correctAnswerIds.slice(0, 1);
    } else if (type === 'short_text') {
      base.acceptedAnswers = Array.isArray(source.acceptedAnswers) ? source.acceptedAnswers.map((answer) => line(answer, 2000)) : ['poprawna odpowiedź'];
      base.caseInsensitive = source.caseInsensitive !== false;
    } else if (type === 'number') {
      base.correctNumber = Number.isFinite(Number(source.correctNumber)) ? Number(source.correctNumber) : 0;
      base.tolerance = clamp(source.tolerance, 0, Number.MAX_SAFE_INTEGER, 0);
    } else if (type === 'matching') {
      base.pairs = (Array.isArray(source.pairs) && source.pairs.length ? source.pairs : [
        { left: 'Pierwszy element', right: 'Pierwsze dopasowanie' },
        { left: 'Drugi element', right: 'Drugie dopasowanie' }
      ]).map((pair, index) => ({
        pairId: SAFE_ID.test(pair.pairId || '') ? pair.pairId : `${questionId}-pair-${index + 1}`,
        left: line(pair.left, 1_000),
        right: line(pair.right, 1_000),
        leftImages: normalizeImages(pair.leftImages),
        rightImages: normalizeImages(pair.rightImages)
      }));
    } else if (type === 'ordering') {
      base.items = (Array.isArray(source.items) && source.items.length ? source.items : ['Pierwszy element', 'Drugi element'])
        .map((item, index) => {
          const itemSource = typeof item === 'string' ? { text: item } : item || {};
          return {
            itemId: SAFE_ID.test(itemSource.itemId || '') ? itemSource.itemId : `${questionId}-item-${index + 1}`,
            text: line(itemSource.text, 1_000),
            images: normalizeImages(itemSource.images)
          };
        });
      base.correctOrder = Array.isArray(source.correctOrder) && source.correctOrder.length === base.items.length
        ? source.correctOrder : base.items.map((item) => item.itemId);
    } else if (type === 'fill_blanks') {
      base.template = text(source.template || 'Uzupełnij: {{luka}}.');
      base.blanks = (Array.isArray(source.blanks) && source.blanks.length ? source.blanks : [{ acceptedAnswers: ['odpowiedź'] }])
        .map((blank, index) => ({
          blankId: SAFE_ID.test(blank.blankId || '') ? blank.blankId : `${questionId}-blank-${index + 1}`,
          acceptedAnswers: Array.isArray(blank.acceptedAnswers) ? blank.acceptedAnswers.map((answer) => line(answer, 1000)) : ['odpowiedź'],
          caseInsensitive: blank.caseInsensitive !== false
        }));
    } else if (type === 'open_answer') {
      base.gradingMode = ['ai', 'manual', 'ungraded'].includes(source.gradingMode) ? source.gradingMode : 'ai';
      base.answerKey = text(source.answerKey || source.modelAnswer, 10_000);
      base.aiInstruction = text(source.aiInstruction || source.rubric, 2_000);
      base.multiline = source.multiline !== false;
    }
    return base;
  }

  function createExam(seed) {
    const source = seed && typeof seed === 'object' ? seed : {};
    const metadata = source.metadata || {};
    const availabilitySource = source.availability && typeof source.availability === 'object' ? source.availability : {};
    const availabilityUserIds = list(availabilitySource.userIds);
    const audienceMode = ['all', 'selected'].includes(availabilitySource.audienceMode)
      ? availabilitySource.audienceMode : availabilityUserIds.length ? 'selected' : 'all';
    const visibilitySource = source.resultVisibility && typeof source.resultVisibility === 'object'
      ? source.resultVisibility : null;
    const feedbackMode = ['immediate', 'after_submit', 'never'].includes(visibilitySource?.feedbackMode)
      ? visibilitySource.feedbackMode
      : visibilitySource
        ? (visibilitySource.correctAnswers === true ? 'after_submit' : 'never')
        : 'after_submit';
    return {
      version: 1,
      examId: SAFE_EXAM_ID.test(String(source.examId || '').toLowerCase()) ? String(source.examId).toLowerCase() : 'nowy-egzamin',
      metadata: {
        name: line(metadata.name || source.name || 'Nowy egzamin', 180),
        description: text(metadata.description),
        instruction: text(metadata.instruction),
        cover: normalizeImages(metadata.cover)[0] || null,
        beforeStartMessage: text(metadata.beforeStartMessage || 'Przeczytaj instrukcję i rozpocznij, gdy będziesz gotowy.'),
        afterFinishMessage: text(metadata.afterFinishMessage || 'Egzamin został zapisany.'),
        passThreshold: clamp(metadata.passThreshold, 0, 100, 60),
        tags: list(metadata.tags),
        categories: list(metadata.categories)
      },
      status: source.status === 'published' ? 'published' : 'draft',
      availability: {
        mode: ['always', 'from', 'until', 'range'].includes(availabilitySource.mode) ? availabilitySource.mode : 'always',
        from: availabilitySource.from || null,
        until: availabilitySource.until || null,
        audienceMode,
        userIds: audienceMode === 'selected' ? availabilityUserIds : []
      },
      display: {
        mode: ['one', 'page', 'all'].includes(source.display?.mode) ? source.display.mode : 'one',
        questionsPerPage: Math.round(clamp(source.display?.questionsPerPage, 1, 100, 1))
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
        limitSeconds: Math.round(clamp(source.timing?.limitSeconds, 1, 2592000, 3600)),
        questionLimitSeconds: Math.round(clamp(source.timing?.questionLimitSeconds, 1, 86400, 120)),
        display: ['countdown', 'countup', 'hidden'].includes(source.timing?.display) ? source.timing.display : 'countdown'
      },
      randomization: {
        questionOrder: source.randomization?.questionOrder === true,
        answerOrder: source.randomization?.answerOrder === true,
        totalQuestions: source.randomization?.totalQuestions == null ? null : Math.round(clamp(source.randomization.totalQuestions, 1, 500, 1)),
        categoryQuotas: Array.isArray(source.randomization?.categoryQuotas) ? source.randomization.categoryQuotas.map((quota) => ({ category: line(quota.category, 80), count: Math.round(clamp(quota.count, 1, 500, 1)) })).filter((quota) => quota.category) : []
      },
      scoring: {
        equalPoints: source.scoring?.equalPoints !== false,
        defaultPoints: clamp(source.scoring?.defaultPoints, 0, 10_000, 1),
        partialPoints: source.scoring?.partialPoints === true,
        negativePointsEnabled: source.scoring?.negativePointsEnabled === true,
        defaultNegativePoints: clamp(source.scoring?.defaultNegativePoints, 0, 10_000, 0),
        multipleChoiceStrategy: ['all_or_nothing', 'per_option', 'correct_minus_incorrect'].includes(source.scoring?.multipleChoiceStrategy) ? source.scoring.multipleChoiceStrategy : 'all_or_nothing'
      },
      attempts: {
        mode: ['one', 'limited', 'unlimited'].includes(source.attempts?.mode) ? source.attempts.mode : 'one',
        maxAttempts: Math.round(clamp(source.attempts?.maxAttempts, 1, 1_000, 1)),
        cooldownSeconds: Math.round(clamp(source.attempts?.cooldownSeconds, 0, 31536000, 0)),
        resultStrategy: ['best', 'first', 'last', 'average'].includes(source.attempts?.resultStrategy) ? source.attempts.resultStrategy : 'best'
      },
      security: {
        leavePolicy: ['allow_resume', 'end_attempt', 'warn', 'log'].includes(source.security?.leavePolicy) ? source.security.leavePolicy : 'allow_resume'
      },
      resultVisibility: {
        feedbackMode,
        studentResultVisible: visibilitySource?.studentResultVisible !== false,
        scorePercent: visibilitySource?.scorePercent !== false,
        points: visibilitySource?.points === true,
        passFail: visibilitySource?.passFail !== false,
        ownAnswers: visibilitySource?.ownAnswers === true,
        correctAnswers: feedbackMode !== 'never' || visibilitySource?.correctAnswers === true,
        errors: feedbackMode !== 'never' || visibilitySource?.errors === true,
        explanations: visibilitySource?.explanations === true,
        time: visibilitySource?.time !== false
      },
      questions: (Array.isArray(source.questions)
        ? source.questions
        : Array.isArray(source.questionRefs) ? [] : [createQuestion()]).map(createQuestion),
      questionRefs: Array.isArray(source.questionRefs) ? source.questionRefs.filter((questionId) => SAFE_ID.test(questionId)) : []
    };
  }

  function createQuestionBank(seed) {
    const source = seed && typeof seed === 'object' ? seed : {};
    return { version: 1, questions: (Array.isArray(source.questions) ? source.questions : []).map(createQuestion) };
  }

  function validateExam(input) {
    const exam = createExam(input);
    const errors = [];
    if (!SAFE_EXAM_ID.test(exam.examId)) errors.push({ code: 'INVALID_EXAM_ID', message: 'ID egzaminu może zawierać małe litery, cyfry i myślniki.' });
    if (!exam.metadata.name) errors.push({ code: 'EXAM_NAME_REQUIRED', message: 'Wpisz nazwę egzaminu.' });
    if (!exam.questions.length && !exam.questionRefs.length) errors.push({ code: 'EXAM_QUESTIONS_REQUIRED', message: 'Dodaj co najmniej jedno pytanie.' });
    if (exam.availability.audienceMode === 'selected' && !exam.availability.userIds.length) {
      errors.push({ code: 'AVAILABILITY_USERS_REQUIRED', message: 'Wybierz co najmniej jednego użytkownika albo ustaw dostęp dla wszystkich.' });
    }
    const seen = new Set();
    exam.questions.forEach((question, index) => {
      if (seen.has(question.questionId)) errors.push({ code: 'DUPLICATE_QUESTION_ID', message: `Pytanie ${index + 1} ma powtórzone ID.` });
      seen.add(question.questionId);
      if (!question.prompt && question.type !== 'fill_blanks') errors.push({ code: 'QUESTION_PROMPT_REQUIRED', message: `Pytanie ${index + 1} wymaga treści.` });
      if (Array.isArray(question.options) && (question.options.length < 2 || !question.correctAnswerIds.length)) errors.push({ code: 'QUESTION_OPTIONS_REQUIRED', message: `Pytanie ${index + 1} wymaga odpowiedzi i klucza.` });
      if (question.options?.some((option) => !option.text && !option.images.length)) errors.push({ code: 'QUESTION_OPTION_EMPTY', message: `Pytanie ${index + 1}: wpisz treść każdej odpowiedzi albo dodaj obraz.` });
      if (question.type === 'short_text' && !question.acceptedAnswers.some((answer) => answer.trim())) errors.push({ code: 'QUESTION_ANSWER_REQUIRED', message: `Pytanie ${index + 1}: wpisz co najmniej jedną poprawną odpowiedź.` });
      if (question.type === 'matching' && question.pairs.length < 2) errors.push({ code: 'QUESTION_PAIRS_REQUIRED', message: `Pytanie ${index + 1} wymaga co najmniej dwóch par.` });
      if (question.pairs?.some((pair) => (!pair.left && !pair.leftImages.length) || (!pair.right && !pair.rightImages.length))) errors.push({ code: 'QUESTION_PAIR_EMPTY', message: `Pytanie ${index + 1}: uzupełnij obie strony każdej pary.` });
      if (question.type === 'ordering' && question.items.length < 2) errors.push({ code: 'QUESTION_ITEMS_REQUIRED', message: `Pytanie ${index + 1} wymaga co najmniej dwóch elementów.` });
      if (question.items?.some((item) => !item.text && !item.images.length)) errors.push({ code: 'QUESTION_ITEM_EMPTY', message: `Pytanie ${index + 1}: uzupełnij każdy element kolejności.` });
      if (question.type === 'fill_blanks') {
        const count = (question.template.match(/\{\{[^{}]*\}\}/g) || []).length;
        if (!count || count !== question.blanks.length) errors.push({ code: 'QUESTION_BLANK_COUNT', message: `Pytanie ${index + 1}: liczba luk w zdaniu musi odpowiadać liczbie pól odpowiedzi.` });
        if (question.blanks.some((blank) => !blank.acceptedAnswers.some((answer) => answer.trim()))) errors.push({ code: 'QUESTION_BLANK_ANSWER_REQUIRED', message: `Pytanie ${index + 1}: wpisz poprawną odpowiedź do każdej luki.` });
      }
      if (question.type === 'open_answer' && question.gradingMode === 'ai' && !question.answerKey) {
        errors.push({ code: 'QUESTION_ANSWER_KEY_REQUIRED', message: `Pytanie ${index + 1}: dodaj klucz odpowiedzi dla oceny AI.` });
      }
    });
    return { valid: errors.length === 0, errors, exam };
  }

  function serializeExam(input) {
    const validation = validateExam(input);
    if (!validation.valid) throw new Error(validation.errors[0].message);
    return `${JSON.stringify(validation.exam, null, 2)}\n`;
  }

  function serializeQuestionBank(input) {
    const bank = createQuestionBank(input);
    if (bank.questions.length) {
      const validation = validateExam({ examId: 'question-bank', questions: bank.questions });
      if (!validation.valid) throw new Error(validation.errors[0].message);
    }
    return `${JSON.stringify(bank, null, 2)}\n`;
  }

  function canonicalMaterialId(repositoryId, examId) {
    return `exam:${repositoryId || 'default'}:${examId}`.slice(0, 128);
  }

  return Object.freeze({
    QUESTION_TYPES,
    SAFE_EXAM_ID,
    canonicalMaterialId,
    createExam,
    createQuestion,
    createQuestionBank,
    serializeExam,
    serializeQuestionBank,
    validateExam
  });
});
