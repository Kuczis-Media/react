(function exposeQuizModel(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../../../assets/js/quiz-practice.js') : root.ChemQuizPractice,
    typeof module === 'object' && module.exports ? require('../../../assets/js/quiz-occlusion-model.js') : root.ChemQuizOcclusionModel,
    typeof module === 'object' && module.exports ? require('./quiz-csv.js') : root.ChemQuizCsv);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemQuizStudioModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createQuizModel(practice, occlusion, csv) {
  'use strict';

  const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
  const SAFE_STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  const SAFE_MEDIA_REF = /^(?:photos\/|assets\/shared\/)[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(?:png|jpe?g|webp|gif|svg)$/i;
  const QUESTION_TYPES = Object.freeze(['single', 'multiple', 'true_false', 'text', 'open', 'flashcard', 'image_occlusion']);
  // Persist the established lower-case quiz types. Future types can extend this
  // discriminator without a second question store or changing existing IDs.
  const CARD_TYPES = Object.freeze({ FLASHCARD: 'flashcard', SINGLE_CHOICE: 'single', MULTIPLE_CHOICE: 'multiple', TEXT_COMPARE: 'text', IMAGE_OCCLUSION: 'image_occlusion' });
  let sequence = 0;

  function id(prefix) {
    sequence += 1;
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 10) || sequence.toString(36);
    return `${prefix}-${random}`;
  }

  function line(value, limit = 500) {
    return String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  function text(value, limit = 5000) {
    return String(value ?? '').replace(/\0/g, '').trim().slice(0, limit);
  }

  function clamp(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }

  function stable(value, prefix) {
    const candidate = line(value, 128);
    return SAFE_STABLE_ID.test(candidate) ? candidate : id(prefix);
  }

  function image(seed) {
    const source = seed && typeof seed === 'object' && !Array.isArray(seed) ? seed : {};
    const ref = line(source.ref, 240);
    return {
      ref: SAFE_MEDIA_REF.test(ref) ? ref : '',
      alt: line(source.alt, 300),
      ...(/^[a-z0-9][a-z0-9-]{0,39}$/.test(source.repositoryId || '') ? { repositoryId: source.repositoryId } : {})
    };
  }

  function createOption(seed = {}, index = 0) {
    return {
      optionId: stable(seed.optionId, 'option'),
      text: text(seed.text, 500) || `Odpowiedź ${index + 1}`,
      correct: seed.correct === true,
      ...(seed.image ? { image: image(seed.image) } : {})
    };
  }

  function defaultOptions() {
    return [
      createOption({ text: 'Poprawna odpowiedź', correct: true }, 0),
      createOption({ text: 'Odpowiedź B' }, 1),
      createOption({ text: 'Odpowiedź C' }, 2),
      createOption({ text: 'Odpowiedź D' }, 3)
    ];
  }

  function createQuestion(seed = {}) {
    const tags = Array.isArray(seed.tags) ? { tags: seed.tags.map((tag) => line(tag, 60)).filter(Boolean).slice(0, 20) } : {};
    const type = QUESTION_TYPES.includes(seed.type) ? seed.type : 'single';
    if (type === 'image_occlusion') return {
      questionId: stable(seed.questionId, 'question'), ...tags, type, prompt: text(seed.prompt, 3000) || 'Co kryje zaznaczony fragment?',
      points: 0, required: false, image: image(seed.image), options: [], acceptedAnswers: [],
      explanation: text(seed.explanation, 3000), occlusion: occlusion.normalize(seed.occlusion, (value) => stable(value, 'mask'))
    };
    if (type === 'flashcard') {
      const face = (value = {}) => ({
        text: text(value?.text, 10000),
        images: (Array.isArray(value?.images) ? value.images : []).slice(0, 8).map(image).filter((entry) => entry.ref)
      });
      const front = face(seed.front || { text: seed.prompt, images: seed.image?.ref ? [seed.image] : [] });
      return {
        questionId: stable(seed.questionId, 'question'), ...tags, type, prompt: front.text.slice(0, 3000),
        points: 0, required: false, image: image(), options: [], acceptedAnswers: [],
        front, back: face(seed.back), explanation: text(seed.explanation, 3000)
      };
    }
    let options = (Array.isArray(seed.options) ? seed.options : defaultOptions())
      .slice(0, 12)
      .map(createOption);
    if (type === 'true_false') {
      const correctIndex = options.findIndex((option) => option.correct);
      options = [
        createOption({ optionId: options[0]?.optionId, text: 'Prawda', correct: correctIndex !== 1 }, 0),
        createOption({ optionId: options[1]?.optionId, text: 'Fałsz', correct: correctIndex === 1 }, 1)
      ];
    } else if (type === 'single') {
      if (options.length < 2) options = defaultOptions();
      const firstCorrect = options.findIndex((option) => option.correct);
      options.forEach((option, index) => { option.correct = index === (firstCorrect < 0 ? 0 : firstCorrect); });
    } else if (type === 'multiple') {
      if (options.length < 2) options = defaultOptions();
      if (!options.some((option) => option.correct)) options[0].correct = true;
    } else {
      options = [];
    }
    const acceptedAnswers = (Array.isArray(seed.acceptedAnswers) ? seed.acceptedAnswers : [])
      .map((answer) => text(answer, 500))
      .filter(Boolean)
      .slice(0, 20);
    const gradingMode = ['ai', 'manual', 'ungraded'].includes(seed.gradingMode) ? seed.gradingMode : 'manual';
    return {
      questionId: stable(seed.questionId, 'question'),
      ...tags, type,
      prompt: text(seed.prompt, 3000) || 'Wpisz treść pytania.',
      points: Math.round(clamp(seed.points, 1, 0, 10_000) * 100) / 100,
      required: seed.required !== false,
      image: image(seed.image),
      options,
      acceptedAnswers: type === 'text' ? (acceptedAnswers.length ? acceptedAnswers : ['Poprawna odpowiedź']) : [],
      ...(type === 'text' && seed.textCompare ? { textCompare: practice.settings(seed.textCompare) } : {}),
      ...(type === 'open' ? {
        gradingMode,
        answerKey: text(seed.answerKey || seed.modelAnswer, 10_000),
        aiInstruction: text(seed.aiInstruction || seed.rubric, 2_000),
        multiline: seed.multiline !== false
      } : {}),
      explanation: text(seed.explanation, 3000)
    };
  }

  function createQuiz(seed = {}) {
    const metadata = seed.metadata && typeof seed.metadata === 'object' ? seed.metadata : {};
    const settings = seed.settings && typeof seed.settings === 'object' ? seed.settings : {};
    const questions = Array.isArray(seed.questions) && seed.questions.length
      ? seed.questions.slice(0, 200).map(createQuestion)
      : [createQuestion(seed.mode === 'deck' ? { type: 'flashcard' } : {})];
    return {
      version: 1,
      ...(seed.mode === 'deck' ? { mode: 'deck' } : {}),
      quizId: line(seed.quizId || 'nowy-quiz', 80).toLowerCase(),
      metadata: {
        title: line(metadata.title, 180) || 'Nowy quiz',
        description: text(metadata.description, 1200),
        status: metadata.status === 'published' ? 'published' : 'draft',
        ...(seed.mode === 'deck' ? {
          active: metadata.active !== false,
          courseId: line(metadata.courseId, 128)
        } : {}),
        tags: (Array.isArray(metadata.tags) ? metadata.tags : [])
          .map((tag) => line(tag, 60))
          .filter(Boolean)
          .slice(0, 20),
        cover: image(metadata.cover)
      },
      settings: {
        passingScore: Math.round(clamp(settings.passingScore, 60, 0, 100)),
        shuffleQuestions: settings.shuffleQuestions === true,
        showFeedback: settings.showFeedback !== false,
        allowRetry: settings.allowRetry !== false
      },
      questions
    };
  }

  function validate(value) {
    const quiz = createQuiz(value);
    const errors = [];
    if (!Array.isArray(value?.questions) || !value.questions.length || value.questions.length > 200) errors.push({ code: 'QUIZ_QUESTIONS_LIMIT', message: 'Pula wymaga od 1 do 200 pytań.' });
    for (const question of value?.questions || []) if (question.type === 'image_occlusion' && !occlusion.valid(question.occlusion, value.metadata?.status === 'published')) {
      errors.push({ code: 'QUIZ_OCCLUSION_INVALID', message: 'Sprawdź maski: położenie musi mieścić się na obrazie, a publikacja wymaga co najmniej jednej maski.' });
    }
    if (value?.mode && !['quiz', 'deck'].includes(value.mode)) errors.push({ code: 'QUIZ_MODE_INVALID', message: 'Nieobsługiwany tryb quizu.' });
    if (Array.isArray(value?.questions) && value.questions.some((question) => !QUESTION_TYPES.includes(question.type))) {
      errors.push({ code: 'QUIZ_TYPE_INVALID', message: 'Nieobsługiwany rodzaj pytania. Nie zapisano zmian.' });
    }
    if (quiz.mode === 'deck' && quiz.metadata.status === 'published' && !SAFE_STABLE_ID.test(quiz.metadata.courseId)) {
      errors.push({ code: 'QUIZ_COURSE_REQUIRED', message: 'Wybierz kurs dla puli fiszek.' });
    }
    if (quiz.mode === 'deck' && quiz.questions.some((question) => !practice.DECK_TYPES.includes(question.type))) {
      errors.push({ code: 'QUIZ_DECK_TYPE_INVALID', message: 'Pula nauki obsługuje fiszki, obrazy z maskami, pojedynczy i wielokrotny wybór oraz porównywanie tekstu.' });
    }
    if (!SAFE_ID.test(quiz.quizId)) {
      errors.push({ code: 'QUIZ_ID_INVALID', message: 'ID quizu może zawierać tylko małe litery, cyfry i myślniki.' });
    }
    if (!quiz.metadata.title) errors.push({ code: 'QUIZ_TITLE_REQUIRED', message: 'Wpisz tytuł quizu.' });
    if (!quiz.questions.length) errors.push({ code: 'QUIZ_QUESTIONS_REQUIRED', message: 'Dodaj co najmniej jedno pytanie.' });
    const ids = new Set();
    quiz.questions.forEach((question, index) => {
      const label = `Pytanie ${index + 1}`;
      if (ids.has(question.questionId)) errors.push({ code: 'QUIZ_QUESTION_ID_DUPLICATE', message: `${label} ma powtórzony identyfikator.` });
      ids.add(question.questionId);
      if (question.type === 'image_occlusion') {
        if (quiz.metadata.status === 'published' && !question.image.ref) errors.push({ code: 'QUIZ_OCCLUSION_IMAGE_REQUIRED', message: `${label}: wybierz obraz źródłowy.` });
        return;
      }
      if (question.type === 'flashcard') {
        if (quiz.metadata.status === 'published') {
          for (const [side, name] of [['front', 'przód'], ['back', 'tył']]) {
            if (!question[side].text && !question[side].images.length) errors.push({ code: 'QUIZ_FLASHCARD_EMPTY', message: `${label}: uzupełnij ${name} fiszki tekstem lub obrazem.` });
          }
        }
        return;
      }
      if (!question.prompt || question.prompt === 'Wpisz treść pytania.') {
        errors.push({ code: 'QUIZ_QUESTION_PROMPT_REQUIRED', message: `${label}: wpisz właściwą treść pytania.` });
      }
      question.options.forEach((option) => {
        if (ids.has(option.optionId)) errors.push({ code: 'QUIZ_OPTION_ID_DUPLICATE', message: `${label} ma powtórzony identyfikator odpowiedzi.` });
        ids.add(option.optionId);
      });
      if (quiz.mode === 'deck' && question.options.length > 6) errors.push({ code: 'QUIZ_OPTIONS_LIMIT', message: `${label}: w puli nauki użyj od 2 do 6 odpowiedzi.` });
      if (question.type === 'single' && question.options.filter((option) => option.correct).length !== 1) {
        errors.push({ code: 'QUIZ_SINGLE_ANSWER_INVALID', message: `${label}: wybierz dokładnie jedną poprawną odpowiedź.` });
      }
      if (question.type === 'multiple' && !question.options.some((option) => option.correct)) {
        errors.push({ code: 'QUIZ_MULTIPLE_ANSWER_INVALID', message: `${label}: zaznacz co najmniej jedną poprawną odpowiedź.` });
      }
      if (question.type === 'text' && !question.acceptedAnswers.length) {
        errors.push({ code: 'QUIZ_TEXT_ANSWER_REQUIRED', message: `${label}: podaj co najmniej jedną akceptowaną odpowiedź.` });
      }
      if (quiz.metadata.status === 'published' && question.type === 'open' && question.points > 0 && question.gradingMode === 'ai' && !question.answerKey.trim()) {
        errors.push({ code: 'QUIZ_OPEN_ANSWER_KEY_REQUIRED', message: `${label}: dodaj klucz odpowiedzi dla oceny AI albo wybierz ocenianie ręczne / bez punktów.` });
      }
    });
    return { valid: errors.length === 0, errors, quiz };
  }

  function serialize(value) {
    const result = validate(value);
    if (!result.valid) throw new Error(result.errors[0].message);
    return `${JSON.stringify(result.quiz, null, 2)}\n`;
  }

  function parse(source, quizId = '') {
    const parsed = typeof source === 'string' ? JSON.parse(source) : source;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1) {
      throw new Error('Nieobsługiwany format quizu.');
    }
    const quiz = createQuiz(parsed);
    if (parsed.questions?.some((question) => !QUESTION_TYPES.includes(question.type))) throw new Error('Nieobsługiwany rodzaj pytania. Zaktualizuj aplikację przed edycją.');
    if (parsed.questions?.some((q) => q.type === 'image_occlusion' && !occlusion.valid(q.occlusion))) throw new Error('Nieprawidłowe współrzędne lub dane masek.');
    if (quizId && quiz.quizId !== quizId) throw new Error('ID quizu nie pasuje do folderu.');
    return quiz;
  }

  function duplicateQuestion(question) {
    const copy = createQuestion(JSON.parse(JSON.stringify(question)));
    copy.questionId = id('question');
    copy.options.forEach((option) => { option.optionId = id('option'); });
    if (copy.type !== 'flashcard') copy.prompt = `${question.prompt} — kopia`;
    return copy;
  }

  function normalizeAnswer(value) {
    return line(value, 500).toLocaleLowerCase('pl');
  }

  function score(value, rawAnswers = {}) {
    const quiz = createQuiz(value);
    let earned = 0;
    const maximum = quiz.questions.reduce((sum, question) => (
      sum + (question.type === 'open' && question.gradingMode === 'ungraded' ? 0 : question.points)
    ), 0);
    const results = quiz.questions.map((question) => {
      const raw = rawAnswers[question.questionId];
      if (['flashcard', 'image_occlusion'].includes(question.type)) return { questionId: question.questionId, correct: null, points: 0, maximum: 0, reviewStatus: 'not_scored' };
      if (question.type === 'open') {
        if (question.gradingMode === 'ungraded') {
          return { questionId: question.questionId, correct: null, points: 0, maximum: 0, reviewStatus: 'not_scored' };
        }
        return { questionId: question.questionId, correct: null, points: null, maximum: question.points, reviewStatus: 'pending' };
      }
      const { correct } = practice.evaluate(question, raw);
      if (correct) earned += question.points;
      return { questionId: question.questionId, correct, points: correct ? question.points : 0, maximum: question.points, reviewStatus: 'graded' };
    });
    const pending = results.some((result) => result.reviewStatus === 'pending');
    const percent = pending ? null : maximum ? Math.round((earned / maximum) * 100) : null;
    return {
      earned,
      maximum,
      percent,
      passed: percent == null ? null : percent >= quiz.settings.passingScore,
      gradingStatus: pending ? 'pending_review' : maximum > 0 ? 'graded' : 'not_scored',
      results
    };
  }

  function parseCsv(content, options = {}) { return csv.parseCsv(content, options); }

  function importCardsFromCsv(quiz, content, options = {}) {
    return csv.importCardsFromCsv(quiz, content, options, { createQuestion, validate });
  }

  return Object.freeze({
    QUESTION_TYPES,
    CARD_TYPES,
    SAFE_ID,
    SAFE_MEDIA_REF,
    createOption,
    createQuestion,
    createQuiz,
    duplicateQuestion,
    importCardsFromCsv,
    parse,
    parseCsv,
    score,
    serialize,
    validate
  });
});
