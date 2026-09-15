(function initializeExamPlayer() {
  'use strict';

  const client = window.ChemExamClient;
  const ANSWER_SAVE_INTERVAL_MS = 15_000;
  const SIGNAL_THROTTLE_MS = 10_000;
  const byId = (id) => document.getElementById(id);
  const elements = {
    loading: byId('exam-loading'), start: byId('exam-start'), attempt: byId('exam-attempt'), result: byId('exam-result'),
    title: byId('exam-title'), description: byId('exam-description'), instruction: byId('exam-instruction'), facts: byId('exam-facts'),
    before: byId('exam-before-message'), cover: byId('exam-cover'), history: byId('exam-attempt-history'), startButton: byId('exam-start-button'),
    startMessage: byId('exam-start-message'), saveState: byId('exam-save-state'), timer: byId('exam-timer'), theme: byId('exam-theme'),
    navigator: byId('exam-navigator'), navigatorGrid: byId('exam-navigator-grid'), progressCopy: byId('exam-progress-copy'), progressBar: byId('exam-progress-bar'),
    questionPosition: byId('exam-question-position'), attemptTitle: byId('exam-attempt-title'), flag: byId('exam-flag-button'),
    questionList: byId('exam-question-list'), attemptMessage: byId('exam-attempt-message'), previous: byId('exam-previous-button'),
    save: byId('exam-save-button'), next: byId('exam-next-button'), submit: byId('exam-submit-button'),
    resultIcon: byId('exam-result-icon'), resultTitle: byId('exam-result-title'), resultMessage: byId('exam-result-message'),
    resultMetrics: byId('exam-result-metrics'), resultQuestions: byId('exam-result-questions'),
    refreshResult: byId('exam-refresh-result'), another: byId('exam-another-attempt'),
    splitScreenBtn: byId('exam-splitscreen-btn')
  };
  const state = {
    reference: null,
    definition: null,
    attempts: [],
    attempt: null,
    resultAttemptId: '',
    preview: false,
    materialId: '',
    serverOffset: 0,
    timerId: 0,
    dirtyQuestions: new Set(),
    answerVersions: new Map(),
    saveTimer: 0,
    signalTimes: new Map(),
    transitioning: false,
    pendingNavigationIndex: null,
    navigationTask: null,
    navigatorAttemptId: null,
    deadlineSaveFor: '',
    mutationQueue: Promise.resolve(),
    imageCache: new Map(),
    imageCacheGeneration: 0,
    imageObserver: null,
    submitting: false,
    questionDomCache: new Map(),
    questionDomCacheAttemptId: null,
    splitScreen: false
  };

  const ChemExamOfflineStore = {
    DB_NAME: 'chemdisk_exam_offline_v1',
    STORE_NAME: 'attempts',
    DB_VERSION: 1,
    _dbPromise: null,
    _memory: new Map(),

    open() {
      if (this._dbPromise) return this._dbPromise;
      if (typeof indexedDB === 'undefined') return Promise.resolve(null);
      this._dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(this.STORE_NAME)) {
              db.createObjectStore(this.STORE_NAME, { keyPath: 'attemptId' });
            }
          };
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
      return this._dbPromise;
    },

    save(attemptId, record) {
      if (!attemptId) return;
      const data = { attemptId, ...record, savedAt: Date.now() };
      this._memory.set(attemptId, data);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`chemdisk.idb_fallback.${attemptId}`, JSON.stringify(data));
        }
      } catch (_) {}
      this.open().then((db) => {
        if (!db) return;
        try {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          tx.objectStore(this.STORE_NAME).put(data);
        } catch (_) {}
      }).catch(() => {});
    },

    async load(attemptId) {
      if (!attemptId) return null;
      if (this._memory.has(attemptId)) return this._memory.get(attemptId);
      const db = await this.open().catch(() => null);
      if (!db) {
        try {
          const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`chemdisk.idb_fallback.${attemptId}`) : null;
          return raw ? JSON.parse(raw) : null;
        } catch (_) {
          return null;
        }
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.STORE_NAME, 'readonly');
          const req = tx.objectStore(this.STORE_NAME).get(attemptId);
          req.onsuccess = () => {
            const res = req.result || null;
            if (res) this._memory.set(attemptId, res);
            resolve(res);
          };
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    },

    remove(attemptId) {
      if (!attemptId) return;
      this._memory.delete(attemptId);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(`chemdisk.idb_fallback.${attemptId}`);
        }
      } catch (_) {}
      this.open().then((db) => {
        if (!db) return;
        try {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          tx.objectStore(this.STORE_NAME).delete(attemptId);
        } catch (_) {}
      }).catch(() => {});
    }
  };
  if (typeof window !== 'undefined') window.ChemExamOfflineStore = ChemExamOfflineStore;

  const ERROR_MESSAGES = {
    AUTH_REQUIRED: 'Sesja wygasła. Zaloguj się ponownie.',
    EXAM_NOT_PUBLISHED: 'Ten egzamin nie jest jeszcze opublikowany.',
    EXAM_NOT_OPEN_YET: 'Egzamin nie jest jeszcze dostępny.',
    EXAM_CLOSED: 'Okno dostępności egzaminu zostało zamknięte.',
    USER_NOT_ALLOWED: 'Ten egzamin nie jest przypisany do Twojego konta.',
    ATTEMPT_LIMIT_REACHED: 'Wykorzystano wszystkie dozwolone próby.',
    ATTEMPT_COOLDOWN: 'Następna próba będzie dostępna po zakończeniu cooldownu.',
    ANSWER_REQUIRED: 'Najpierw odpowiedz na bieżące pytanie.',
    INVALID_QUESTION_INDEX: 'Nie można przejść do tego pytania.',
    QUESTION_NOT_UNLOCKED: 'To pytanie nie jest jeszcze odblokowane.',
    ANSWER_ALREADY_CONFIRMED: 'Ta odpowiedź została już zatwierdzona i nie można jej zmienić.',
    IMMEDIATE_FEEDBACK_DISABLED: 'Natychmiastowe sprawdzanie nie jest włączone dla tego egzaminu.',
    SKIPPING_DISABLED: 'Konfiguracja egzaminu nie pozwala pominąć pytania.',
    BACK_NAVIGATION_DISABLED: 'Cofanie zostało wyłączone dla tego egzaminu.',
    QUESTION_TIME_EXPIRED: 'Czas na to pytanie minął.',
    ANSWER_BATCH_INVALID: 'Nie udało się przygotować paczki odpowiedzi do zapisu.',
    UNANSWERED_QUESTIONS: 'Odpowiedz na wszystkie wymagane pytania przed zakończeniem.',
    EXAM_UNAVAILABLE: 'Egzamin jest chwilowo niedostępny.',
    SEQUENCE_LOCKED: 'Najpierw ukończ poprzedni moduł organizera.'
  };

  function parseReference() {
    const params = new URLSearchParams(window.location.search);
    const examId = params.get('exam') || '';
    const repositoryId = (params.get('repo') || 'default').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(examId) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(repositoryId)) return null;
    state.preview = params.get('preview') === '1';
    state.materialId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(params.get('material') || '') ? params.get('material') : '';
    return { examId, repositoryId };
  }

  function setView(view) {
    elements.loading.hidden = view !== 'loading';
    elements.start.hidden = view !== 'start';
    elements.attempt.hidden = view !== 'attempt';
    elements.result.hidden = view !== 'result';
  }

  function setMessage(target, message, error = true) {
    target.textContent = message || '';
    target.dataset.state = error ? 'error' : 'success';
  }

  function errorMessage(error) {
    return ERROR_MESSAGES[error?.code || error?.message] || error?.message || ERROR_MESSAGES.EXAM_UNAVAILABLE;
  }

  async function start() {
    state.reference = parseReference();
    if (!state.reference || !client) return fatal('Nieprawidłowe odwołanie do egzaminu.');
    initializeTheme();
    bind();
    let auth;
    try { auth = await window.ChemAuth.ready; } catch (_) { auth = null; }
    if (!auth?.authenticated || !auth.session?.ok) return fatal('Sesja nie jest aktywna. Zaloguj się ponownie.');
    try {
      const payload = await client.bootstrap({ ...state.reference, materialId: state.materialId, preview: state.preview });
      state.definition = payload.exam;
      state.attempts = payload.attempts || [];
      syncServerTime(payload.serverNow);
      renderStart();
    } catch (error) { fatal(errorMessage(error)); }
  }

  function bind() {
    elements.startButton.addEventListener('click', beginAttempt);
    elements.refreshResult.addEventListener('click', refreshFinishedResult);
    elements.another.addEventListener('click', async () => {
      elements.another.disabled = true;
      await reloadAttemptHistory();
      elements.another.disabled = false;
      setView('start');
      renderStart();
    });
    elements.previous.addEventListener('click', () => navigatePage(-1));
    elements.next.addEventListener('click', () => navigatePage(1));
    elements.save.addEventListener('click', () => flushPendingAnswers(true));
    elements.submit.addEventListener('click', submitAttempt);
    elements.flag.addEventListener('click', toggleFlag);
    elements.navigatorGrid.addEventListener('click', (event) => {
      if (elements.navigatorGrid.dataset.reactView) return;
      const button = event.target.closest('[data-question-index]');
      if (button && !button.disabled) void navigateTo(Number(button.dataset.questionIndex));
    });
    elements.questionList.addEventListener('input', answerChanged);
    elements.questionList.addEventListener('change', answerChanged);
    elements.questionList.addEventListener('click', questionAction);
    elements.theme.addEventListener('click', toggleTheme);
    elements.splitScreenBtn?.addEventListener('click', toggleSplitScreen);
    window.addEventListener('pagehide', () => logLifecycle('leave', true));
    window.addEventListener('chem-auth-user-changed', clearImageCache);
    document.documentElement.addEventListener('mouseleave', () => logSignal('cursor_leave'));
    document.addEventListener('copy', () => logSignal('copy'));
    document.addEventListener('paste', () => logSignal('paste'));
    document.addEventListener('contextmenu', () => logSignal('context_menu'));
    document.addEventListener('keydown', handleKeyNavigation);
    window.addEventListener('online', () => {
      elements.saveState.textContent = 'Połączenie przywrócone · synchronizacja…';
      if (state.dirtyQuestions.size > 0 && state.attempt?.status === 'active') {
        void flushPendingAnswers(false);
      }
    });
    window.addEventListener('offline', () => {
      elements.saveState.textContent = 'Tryb offline · odpowiedzi bezpieczne w pamięci';
    });
    window.addEventListener('beforeunload', (event) => {
      if (state.attempt?.status !== 'active') return;
      const policy = state.attempt.exam.security.leavePolicy;
      if (policy === 'warn' || policy === 'end_attempt') {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  function handleKeyNavigation(event) {
    if (!state.attempt || state.attempt.status !== 'active') return;
    const isInput = event.target.matches('input, textarea, select, [contenteditable="true"]');
    const isAltNav = event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
    const isPlainNav = !isInput && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
    if (isAltNav || isPlainNav) {
      if (event.key === 'ArrowLeft' && !elements.previous.disabled && !elements.previous.hidden) {
        event.preventDefault();
        void navigatePage(-1);
      } else if (event.key === 'ArrowRight' && !elements.next.disabled && !elements.next.hidden) {
        event.preventDefault();
        void navigatePage(1);
      }
    }
  }

  function renderStart() {
    clearTimer();
    setView('start');
    const metadata = state.definition.metadata;
    window.NextMedBrand ? window.NextMedBrand.setTitle(metadata.name) : (document.title = metadata.name + " — NextMed");
    elements.title.textContent = metadata.name;
    elements.description.textContent = metadata.description;
    elements.description.hidden = !metadata.description;
    elements.instruction.textContent = metadata.instruction;
    elements.instruction.hidden = !metadata.instruction;
    elements.before.textContent = metadata.beforeStartMessage;
    elements.before.hidden = !metadata.beforeStartMessage;
    elements.facts.replaceChildren();
    const timing = state.definition.timing.mode === 'none'
      ? 'Bez limitu czasu'
      : state.definition.timing.mode === 'exam'
        ? `${Math.round(state.definition.timing.limitSeconds / 60)} min na egzamin`
        : `${state.definition.timing.questionLimitSeconds} s na pytanie`;
    [timing, `Próg ${metadata.passThreshold}%`, attemptLimitLabel()].forEach((label) => elements.facts.append(tag(label)));
    elements.cover.hidden = true;
    if (metadata.cover?.ref) void setBackgroundImage(elements.cover, metadata.cover.ref);
    const reactHistory = window.NextMedUI?.render('exam-history', elements.history, { attempts: state.attempts, onResume: resumeAttempt, onResult: showStoredResult });
    if (!reactHistory) {
    elements.history.replaceChildren();
    state.attempts.slice().reverse().forEach((attempt) => {
      const button = document.createElement('button');
      button.type = 'button';
      const active = attempt.status === 'active';
      button.append(
        Object.assign(document.createElement('strong'), { textContent: `Próba ${attempt.number}` }),
        Object.assign(document.createElement('span'), {
          textContent: active ? 'Wznów'
            : attempt.gradingStatus === 'pending_review' ? 'Oczekuje na ocenę'
              : attempt.gradingStatus === 'not_scored' ? 'Bez punktacji'
              : attempt.scorePercent == null ? 'Wynik ukryty'
              : `${attempt.scorePercent}%${attempt.passed == null ? '' : attempt.passed ? ' · zaliczona' : ' · niezaliczona'}`
        })
      );
      button.addEventListener('click', () => active ? resumeAttempt(attempt.attemptId) : showStoredResult(attempt.attemptId));
      elements.history.append(button);
    });
    }
    const active = state.attempts.find((attempt) => attempt.status === 'active');
    elements.startButton.textContent = active ? 'Wznów aktywną próbę' : 'Rozpocznij egzamin';
    elements.startButton.dataset.attemptId = active?.attemptId || '';
    setMessage(elements.startMessage, '', false);
  }

  async function beginAttempt() {
    const activeId = elements.startButton.dataset.attemptId;
    if (activeId) return resumeAttempt(activeId);
    elements.startButton.disabled = true;
    setMessage(elements.startMessage, 'Tworzę bezpieczną próbę…', false);
    try {
      const payload = await client.mutate('start', {
        ...state.reference,
        preview: state.preview,
        body: { materialId: state.materialId }
      });
      initializeAttempt(payload.attempt, false);
      renderAttempt();
    } catch (error) { setMessage(elements.startMessage, errorMessage(error)); }
    finally { elements.startButton.disabled = false; }
  }

  async function resumeAttempt(attemptId) {
    try {
      const payload = await client.attempt({ ...state.reference, materialId: state.materialId, attemptId, preview: state.preview });
      syncServerTime(payload.serverNow);
      initializeAttempt(payload.attempt, true);
      if (state.attempt.status === 'active') {
        renderAttempt();
        const navigation = performance.getEntriesByType?.('navigation')?.[0];
        await logLifecycle(navigation?.type === 'reload' ? 'refresh' : 'resume');
      }
      else renderResult(state.attempt.result);
    } catch (error) { setMessage(elements.startMessage, errorMessage(error)); }
  }

  async function showStoredResult(attemptId) {
    try {
      const payload = await client.result({ ...state.reference, materialId: state.materialId, attemptId, preview: state.preview });
      state.resultAttemptId = attemptId;
      renderResult(payload.result);
    } catch (error) { setMessage(elements.startMessage, errorMessage(error)); }
  }

  function renderAttempt() {
    setView('attempt');
    elements.attemptTitle.textContent = state.attempt.exam.metadata.name;
    renderQuestions();
    renderNavigator();
    updateControls();
    startTimer();
    setMessage(elements.attemptMessage, '', false);
  }

  function pendingStorageKey(attemptId = state.attempt?.attemptId) {
    return attemptId ? `chemdisk.exam.pending.${attemptId}` : '';
  }

  function cloneAnswer(value) {
    if (value == null || typeof value !== 'object') return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function initializeAttempt(attempt, restoreLocal) {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    state.dirtyQuestions.clear();
    state.answerVersions.clear();
    state.signalTimes.clear();
    state.transitioning = false;
    state.pendingNavigationIndex = null;
    state.navigationTask = null;
    state.navigatorAttemptId = null;
    state.deadlineSaveFor = '';
    clearQuestionDomCache();
    state.attempt = attempt;
    state.questionDomCacheAttemptId = attempt?.attemptId || '';
    state.resultAttemptId = attempt?.attemptId || '';
    if (restoreLocal && attempt?.status === 'active') restorePendingAnswers();
    else if (attempt?.status && attempt.status !== 'active') clearPendingAnswers(attempt.attemptId);
    if (attempt?.status === 'active') schedulePreRenderQuestions();
  }

  function clearPendingAnswers(attemptId = state.attempt?.attemptId) {
    const key = pendingStorageKey(attemptId);
    if (key) {
      try { sessionStorage.removeItem(key); } catch (_) {}
    }
    if (attemptId) {
      ChemExamOfflineStore.remove(attemptId);
    }
  }

  function capturePendingAnswers() {
    const answers = {};
    const versions = {};
    if (!state.attempt) return { answers, versions, count: 0 };
    const confirmed = new Set(state.attempt.confirmedQuestionIds || []);
    for (const questionId of state.dirtyQuestions) {
      if (confirmed.has(questionId) || !state.attempt.questions.some((question) => question.questionId === questionId)) continue;
      answers[questionId] = cloneAnswer(state.attempt.answers?.[questionId]);
      versions[questionId] = state.answerVersions.get(questionId) || 0;
    }
    return { answers, versions, count: Object.keys(answers).length };
  }

  function persistPendingAnswers() {
    const key = pendingStorageKey();
    if (!key || !state.attempt) return;
    const pending = capturePendingAnswers();
    try {
      if (!pending.count) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify({ answers: pending.answers, updatedAt: new Date().toISOString() }));
    } catch (_) {}

    ChemExamOfflineStore.save(state.attempt.attemptId, {
      examId: state.reference?.examId || '',
      repositoryId: state.reference?.repositoryId || 'default',
      answers: cloneAnswer(state.attempt.answers),
      answerVersions: Object.fromEntries(state.answerVersions),
      dirtyQuestions: Array.from(state.dirtyQuestions),
      currentIndex: state.attempt.currentIndex,
      highestReachedIndex: state.attempt.highestReachedIndex,
      expiresAt: state.attempt.expiresAt,
      currentQuestionExpiresAt: state.attempt.currentQuestionExpiresAt,
      currentQuestionStartedAt: state.attempt.currentQuestionStartedAt,
      startedAt: state.attempt.startedAt,
      serverOffset: state.serverOffset,
      updatedAt: new Date().toISOString()
    });
  }

  function restorePendingAnswers() {
    const key = pendingStorageKey();
    if (!key || !state.attempt) return;
    let stored;
    try { stored = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) { stored = null; }
    if (stored?.answers && typeof stored.answers === 'object' && !Array.isArray(stored.answers)) {
      const confirmed = new Set(state.attempt.confirmedQuestionIds || []);
      Object.entries(stored.answers).forEach(([questionId, answer]) => {
        if (confirmed.has(questionId) || !state.attempt.questions.some((question) => question.questionId === questionId)) return;
        state.attempt.answers[questionId] = cloneAnswer(answer);
        state.dirtyQuestions.add(questionId);
        state.answerVersions.set(questionId, 1);
      });
      if (state.dirtyQuestions.size) scheduleAnswerSave();
    }

    const currentAttemptId = state.attempt.attemptId;
    ChemExamOfflineStore.load(currentAttemptId).then((offline) => {
      if (!offline || state.attempt?.attemptId !== currentAttemptId || state.attempt?.status !== 'active') return;
      const confirmed = new Set(state.attempt.confirmedQuestionIds || []);
      let restoredCount = 0;
      if (offline.answers && typeof offline.answers === 'object') {
        Object.entries(offline.answers).forEach(([qId, ans]) => {
          if (confirmed.has(qId) || !state.attempt.questions.some((q) => q.questionId === qId)) return;
          if (state.attempt.answers[qId] === undefined || state.attempt.answers[qId] === '' || offline.dirtyQuestions?.includes(qId)) {
            state.attempt.answers[qId] = cloneAnswer(ans);
            if (offline.dirtyQuestions?.includes(qId)) {
              state.dirtyQuestions.add(qId);
              state.answerVersions.set(qId, (offline.answerVersions?.[qId] || 1));
            }
            restoredCount++;
          }
        });
      }
      if (Number.isInteger(offline.currentIndex) && offline.currentIndex >= 0 && offline.currentIndex < state.attempt.totalQuestions) {
        state.attempt.currentIndex = offline.currentIndex;
      }
      if (Number.isInteger(offline.highestReachedIndex)) {
        state.attempt.highestReachedIndex = Math.max(state.attempt.highestReachedIndex, offline.highestReachedIndex);
      }
      if (restoredCount > 0) {
        renderQuestions();
        renderNavigator();
        updateControls();
        elements.saveState.textContent = 'Odpowiedzi przywrócone z pamięci offline';
        if (state.dirtyQuestions.size) scheduleAnswerSave();
      }
    }).catch(() => {});
  }

  function acceptServerAttempt(serverAttempt, sent = null) {
    if (!serverAttempt) return;
    if (serverAttempt.status !== 'active') {
      state.attempt = serverAttempt;
      state.dirtyQuestions.clear();
      state.answerVersions.clear();
      clearPendingAnswers(serverAttempt.attemptId);
      clearQuestionDomCache();
      return;
    }
    const local = capturePendingAnswers();
    const optimisticIndex = state.transitioning && Number.isSafeInteger(state.pendingNavigationIndex)
      ? state.pendingNavigationIndex : null;
    if (sent) {
      Object.keys(sent.answers || {}).forEach((questionId) => {
        if ((state.answerVersions.get(questionId) || 0) !== sent.versions[questionId]) return;
        state.dirtyQuestions.delete(questionId);
        state.answerVersions.delete(questionId);
        delete local.answers[questionId];
      });
    }
    state.attempt = serverAttempt;
    if (optimisticIndex != null && serverAttempt.questions[optimisticIndex]) {
      serverAttempt.currentIndex = optimisticIndex;
      serverAttempt.highestReachedIndex = Math.max(serverAttempt.highestReachedIndex, optimisticIndex);
    }
    const confirmed = new Set(serverAttempt.confirmedQuestionIds || []);
    for (const questionId of [...state.dirtyQuestions]) {
      if (confirmed.has(questionId) || !serverAttempt.questions.some((question) => question.questionId === questionId)) {
        state.dirtyQuestions.delete(questionId);
        state.answerVersions.delete(questionId);
        continue;
      }
      if (Object.hasOwn(local.answers, questionId)) serverAttempt.answers[questionId] = local.answers[questionId];
    }
    persistPendingAnswers();
    if (state.dirtyQuestions.size) scheduleAnswerSave();
  }

  function visibleIndices() {
    const display = state.attempt.exam.display;
    if (display.mode === 'all') return state.attempt.questions.map((_, index) => index);
    if (display.mode === 'page') {
      const size = display.questionsPerPage;
      const first = Math.floor(state.attempt.currentIndex / size) * size;
      return state.attempt.questions.map((_, index) => index).slice(first, first + size);
    }
    return [state.attempt.currentIndex];
  }

  function clearQuestionDomCache() {
    state.questionDomCache.clear();
    state.questionDomCacheAttemptId = null;
  }

  function syncAnswerValues(article, question, value) {
    if (!article || !question) return;
    if (question.options) {
      const multiple = question.type === 'multiple_choice';
      const inputs = article.querySelectorAll ? article.querySelectorAll('input[data-answer-input]') : [];
      if (inputs.forEach) {
        inputs.forEach((input) => {
          const checked = multiple ? Array.isArray(value) && value.includes(input.value) : value === input.value;
          if (input.checked !== checked) input.checked = checked;
        });
      }
      return;
    }
    if (['short_text', 'number', 'open_answer'].includes(question.type)) {
      const input = article.querySelector ? article.querySelector('[data-answer-input]') : null;
      if (input && typeof document !== 'undefined' && document.activeElement !== input) {
        const strVal = value == null ? '' : String(value);
        if (input.value !== strVal) input.value = strVal;
      }
      return;
    }
    if (question.type === 'matching') {
      const selects = article.querySelectorAll ? article.querySelectorAll('[data-match-left]') : [];
      if (selects.forEach) {
        selects.forEach((select) => {
          const targetVal = value?.[select.dataset.matchLeft] || '';
          if (select.value !== targetVal) select.value = targetVal;
        });
      }
      return;
    }
    if (question.type === 'fill_blanks') {
      const inputs = article.querySelectorAll ? article.querySelectorAll('[data-blank-id]') : [];
      if (inputs.forEach) {
        inputs.forEach((input) => {
          if (typeof document !== 'undefined' && document.activeElement !== input) {
            const blankVal = value?.[input.dataset.blankId] || '';
            if (input.value !== blankVal) input.value = blankVal;
          }
        });
      }
    }
  }

  function syncQuestionStatus(article, question) {
    if (!article || !question || !state.attempt) return;
    const confirmed = state.attempt.confirmedQuestionIds?.includes(question.questionId);
    const timedOut = state.attempt.timedOutQuestionIds?.includes(question.questionId);
    if (confirmed || timedOut) {
      const controls = article.querySelectorAll ? article.querySelectorAll('[data-answer-input], [data-order-action], [data-confirm-question]') : [];
      if (controls.forEach) {
        controls.forEach((control) => { control.disabled = true; });
      }
    }
    const immediate = state.attempt.exam.resultVisibility?.feedbackMode === 'immediate';
    if (immediate && confirmed) {
      const feedback = state.attempt.immediateFeedback?.[question.questionId];
      if (feedback && article.querySelector && !article.querySelector('.exam-immediate-feedback')) {
        article.append(immediateFeedbackView(feedback));
      }
    }
  }

  function getCachedQuestionView(question, index) {
    if (!state.attempt) return questionView(question, index);
    if (state.questionDomCacheAttemptId !== state.attempt.attemptId) {
      state.questionDomCache.clear();
      state.questionDomCacheAttemptId = state.attempt.attemptId;
    }
    let article = state.questionDomCache.get(question.questionId);
    if (!article) {
      article = questionView(question, index);
      state.questionDomCache.set(question.questionId, article);
    } else {
      article.dataset.questionIndex = String(index);
      const smallTag = article.querySelector ? article.querySelector('small') : null;
      if (smallTag) smallTag.textContent = `${index + 1}. ${typeLabel(question.type)}`;
      syncAnswerValues(article, question, state.attempt.answers[question.questionId]);
      syncQuestionStatus(article, question);
    }
    return article;
  }

  function schedulePreRenderQuestions() {
    if (!state.attempt || !state.attempt.questions?.length) return;
    const questions = state.attempt.questions;
    let nextIndex = 0;
    const CHUNK_SIZE = 5;

    function processChunk() {
      if (!state.attempt || state.attempt.status !== 'active') return;
      const end = Math.min(nextIndex + CHUNK_SIZE, questions.length);
      for (let i = nextIndex; i < end; i++) {
        const q = questions[i];
        if (!state.questionDomCache.has(q.questionId)) {
          const node = questionView(q, i);
          state.questionDomCache.set(q.questionId, node);
        }
      }
      nextIndex = end;
      if (nextIndex < questions.length) {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(processChunk, { timeout: 200 });
        } else {
          setTimeout(processChunk, 10);
        }
      }
    }

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(processChunk, { timeout: 200 });
    } else {
      setTimeout(processChunk, 0);
    }
  }

  function renderQuestions() {
    disconnectImageObserver();
    const indices = visibleIndices();
    const reactQuestions = window.NextMedUI?.render('exam-questions', elements.questionList, {
      indices, attempt: state.attempt, getUrl: protectedImageUrl, onAnswer: recordAnswer,
      onConfirm: confirmQuestion, typeLabel
    });
    if (!reactQuestions) elements.questionList.replaceChildren(...indices.map((index) => getCachedQuestionView(state.attempt.questions[index], index)));
    schedulePreRenderQuestions();
    updateSplitScreenBtn();
    const first = indices[0] + 1;
    const last = indices.at(-1) + 1;
    elements.questionPosition.textContent = first === last ? `Pytanie ${first} z ${state.attempt.totalQuestions}` : `Pytania ${first}–${last} z ${state.attempt.totalQuestions}`;
    elements.flag.hidden = state.attempt.exam.display.mode !== 'one' || !state.attempt.exam.navigation.allowFlagging;
    const currentQuestion = state.attempt.questions[state.attempt.currentIndex];
    const flagged = state.attempt.flags.includes(currentQuestion.questionId);
    elements.flag.textContent = flagged ? '★ Oznaczone' : '☆ Oznacz';
    elements.flag.setAttribute('aria-pressed', String(flagged));
  }

  function toggleSplitScreen() {
    state.splitScreen = !state.splitScreen;
    clearQuestionDomCache();
    renderQuestions();
    updateSplitScreenBtn();
  }

  function updateSplitScreenBtn() {
    if (!elements.splitScreenBtn) return;
    const currentQ = state.attempt?.questions?.[state.attempt?.currentIndex];
    const isSplit = Boolean(state.splitScreen || currentQ?.sourceText || currentQ?.splitScreen);
    if (elements.splitScreenBtn.classList?.toggle) {
      elements.splitScreenBtn.classList.toggle('is-active', isSplit);
    }
    if (elements.splitScreenBtn.setAttribute) {
      elements.splitScreenBtn.setAttribute('aria-pressed', String(isSplit));
    }
  }

  function appendImmediateCheck(parent, question) {
    const immediate = state.attempt?.exam?.resultVisibility?.feedbackMode === 'immediate';
    const confirmed = state.attempt?.confirmedQuestionIds?.includes(question.questionId);
    if (immediate) {
      const actions = document.createElement('div'); actions.className = 'exam-question-check';
      const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'exam-button is-primary';
      confirm.dataset.confirmQuestion = question.questionId;
      confirm.textContent = confirmed ? 'Odpowiedź zatwierdzona' : 'Zatwierdź i sprawdź odpowiedź';
      confirm.disabled = confirmed; actions.append(confirm); parent.append(actions);
      const feedback = state.attempt?.immediateFeedback?.[question.questionId];
      if (confirmed && feedback) parent.append(immediateFeedbackView(feedback));
      if (confirmed && parent.querySelectorAll) parent.querySelectorAll('[data-answer-input], [data-order-action]').forEach((control) => { control.disabled = true; });
    }
  }

  function appendTimeoutWarning(parent, question) {
    if (state.attempt?.timedOutQuestionIds?.includes(question.questionId)) {
      const warning = tag('Czas na to pytanie minął. Odpowiedź jest zablokowana.', 'p'); warning.className = 'exam-message'; parent.append(warning);
      if (parent.querySelectorAll) parent.querySelectorAll('input,textarea,select,button').forEach((control) => { control.disabled = true; });
    }
  }

  function questionView(question, index) {
    const article = document.createElement('article');
    article.className = 'exam-question';
    article.dataset.questionId = question.questionId;
    article.dataset.questionIndex = String(index);

    const hasSource = Boolean(question.sourceText);
    const useSplit = hasSource || state.splitScreen || Boolean(question.splitScreen);

    if (useSplit) {
      if (article.classList?.toggle) article.classList.toggle('is-splitscreen', true);
      const splitLayout = document.createElement('div');
      splitLayout.className = 'exam-splitscreen-layout';

      if (hasSource) {
        const leftCol = document.createElement('aside');
        leftCol.className = 'exam-splitscreen-col is-source';
        const sourceBadge = tag('Tekst źródłowy / Doświadczenie CKE', 'small');
        sourceBadge.className = 'exam-source-eyebrow';
        const sourceBody = document.createElement('div');
        sourceBody.className = 'exam-source-content';
        window.ChemAssessmentText.render(sourceBody, question.sourceText, question.promptFormat);
        leftCol.append(sourceBadge, sourceBody);

        const rightCol = document.createElement('div');
        rightCol.className = 'exam-splitscreen-col is-interactive';
        rightCol.append(tag(`${index + 1}. ${typeLabel(question.type)}`, 'small'));
        const heading = document.createElement('h2');
        window.ChemAssessmentText.render(heading, question.prompt || question.template, question.promptFormat);
        rightCol.append(heading);
        if (question.images?.length) rightCol.append(imageGrid(question.images));
        rightCol.append(answerControl(question, state.attempt?.answers?.[question.questionId]));
        appendImmediateCheck(rightCol, question);
        appendTimeoutWarning(rightCol, question);

        splitLayout.append(leftCol, rightCol);
      } else {
        const leftCol = document.createElement('aside');
        leftCol.className = 'exam-splitscreen-col is-source is-prompt-col';
        leftCol.append(tag(`${index + 1}. ${typeLabel(question.type)}`, 'small'));
        const heading = document.createElement('h2');
        window.ChemAssessmentText.render(heading, question.prompt || question.template, question.promptFormat);
        leftCol.append(heading);
        if (question.images?.length) leftCol.append(imageGrid(question.images));

        const rightCol = document.createElement('div');
        rightCol.className = 'exam-splitscreen-col is-interactive';
        rightCol.append(answerControl(question, state.attempt?.answers?.[question.questionId]));
        appendImmediateCheck(rightCol, question);
        appendTimeoutWarning(rightCol, question);

        splitLayout.append(leftCol, rightCol);
      }

      article.append(splitLayout);
      return article;
    }

    article.append(tag(`${index + 1}. ${typeLabel(question.type)}`, 'small'));
    const heading = document.createElement('h2'); window.ChemAssessmentText.render(heading, question.prompt || question.template, question.promptFormat); article.append(heading);
    if (question.images?.length) article.append(imageGrid(question.images));
    article.append(answerControl(question, state.attempt?.answers?.[question.questionId]));
    appendImmediateCheck(article, question);
    appendTimeoutWarning(article, question);
    return article;
  }

  function immediateFeedbackView(feedback) {
    const card = document.createElement('div');
    if (feedback.deferred) {
      card.className = 'exam-immediate-feedback is-deferred';
      card.append(tag(feedback.message || 'Odpowiedź zapisana. Ocena pojawi się po zakończeniu.', 'strong'));
      return card;
    }
    card.className = `exam-immediate-feedback ${feedback.correct ? 'is-correct' : 'is-incorrect'}`;
    card.append(tag(feedback.correct ? 'Odpowiedź poprawna' : 'Odpowiedź niepoprawna', 'strong'));
    appendResultAnswer(card, 'Prawidłowa odpowiedź', feedback.correctAnswerDisplay);
    if (feedback.explanation) card.append(formattedAnswer(feedback.explanation, 'p'));
    return card;
  }

  function answerControl(question, value) {
    if (question.options) {
      const fieldset = document.createElement('fieldset'); fieldset.className = 'exam-options';
      const multiple = question.type === 'multiple_choice';
      question.options.forEach((option) => {
        const label = document.createElement('label'); label.className = 'exam-option';
        const control = document.createElement('input'); control.type = multiple ? 'checkbox' : 'radio'; control.name = `answer-${question.questionId}`; control.value = option.answerId;
        control.checked = multiple ? Array.isArray(value) && value.includes(option.answerId) : value === option.answerId;
        control.dataset.answerInput = '1';
        const copy = document.createElement('div'); copy.textContent = option.text;
        label.append(control, copy);
        if (option.images?.length) label.append(imageGrid(option.images, 'exam-answer-images'));
        fieldset.append(label);
      });
      return fieldset;
    }
    if (question.type === 'short_text' || question.type === 'number') {
      const control = document.createElement('input'); control.className = 'exam-text-answer'; control.type = question.type === 'number' ? 'text' : 'text'; control.inputMode = question.type === 'number' ? 'decimal' : 'text'; control.value = value ?? ''; control.dataset.answerInput = '1'; control.autocomplete = 'off';
      return control;
    }
    if (question.type === 'open_answer') {
      const control = document.createElement(question.multiline === false ? 'input' : 'textarea');
      control.className = 'exam-text-answer exam-open-answer';
      if (control.tagName === 'TEXTAREA') control.rows = 7;
      else control.type = 'text';
      control.value = value ?? '';
      control.dataset.answerInput = '1';
      control.maxLength = 8000;
      control.autocomplete = 'off';
      control.placeholder = 'Wpisz własną odpowiedź…';
      return control;
    }
    if (question.type === 'matching') {
      const host = document.createElement('div'); host.className = 'exam-matching';
      const illustratedAnswers = question.right.filter((right) => right.images?.length);
      if (illustratedAnswers.length) {
        const legend = document.createElement('div'); legend.className = 'exam-matching-answer-legend';
        illustratedAnswers.forEach((right) => {
          const item = document.createElement('div');
          item.append(tag(right.text || 'Odpowiedź', 'strong'), imageGrid(right.images, 'exam-answer-images'));
          legend.append(item);
        });
        host.append(legend);
      }
      question.left.forEach((left) => {
        const label = document.createElement('label');
        const copy = document.createElement('div'); copy.textContent = left.text;
        if (left.images?.length) copy.append(imageGrid(left.images, 'exam-answer-images'));
        const select = document.createElement('select'); select.dataset.answerInput = '1'; select.dataset.matchLeft = left.pairId;
        select.append(new Option('Wybierz dopasowanie…', ''));
        question.right.forEach((right) => select.append(new Option(right.text, right.answerId)));
        select.value = value?.[left.pairId] || '';
        label.append(copy, select); host.append(label);
      });
      return host;
    }
    if (question.type === 'ordering') {
      const host = document.createElement('div'); host.className = 'exam-ordering';
      host.dataset.answerInput = '1';
      const requested = Array.isArray(value) && value.length === question.items.length ? value : question.items.map((item) => item.itemId);
      const byId = new Map(question.items.map((item) => [item.itemId, item]));
      requested.forEach((itemId, index) => {
        const item = byId.get(itemId); if (!item) return;
        const line = document.createElement('div'); line.className = 'exam-order-item'; line.dataset.itemId = itemId;
        const copy = document.createElement('div'); copy.textContent = item.text;
        if (item.images?.length) copy.append(imageGrid(item.images, 'exam-answer-images'));
        line.append(tag(index + 1, 'strong'), copy);
        const actions = document.createElement('span');
        for (const [direction, label] of [['up', '↑'], ['down', '↓']]) {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.orderAction = direction; button.textContent = label; button.setAttribute('aria-label', direction === 'up' ? 'Przesuń wyżej' : 'Przesuń niżej'); actions.append(button);
        }
        line.append(actions); host.append(line);
      });
      return host;
    }
    const host = document.createElement('div'); host.className = 'exam-blanks';
    const sentence = document.createElement('p'); sentence.className = 'exam-blank-sentence';
    let blankIndex = 0;
    String(question.template || '').split(/(\{\{[^{}]*\}\})/).forEach((part) => {
      if (!/^\{\{[^{}]*\}\}$/.test(part)) {
        sentence.append(document.createTextNode(part));
        return;
      }
      const blank = question.blanks[blankIndex];
      if (!blank) return;
      const control = document.createElement('input');
      control.className = 'exam-text-answer';
      control.dataset.answerInput = '1';
      control.dataset.blankId = blank.blankId;
      control.value = value?.[blank.blankId] || '';
      control.placeholder = part.slice(2, -2).trim() || `Luka ${blankIndex + 1}`;
      control.setAttribute('aria-label', `Luka ${blankIndex + 1}: ${control.placeholder}`);
      sentence.append(control);
      blankIndex += 1;
    });
    host.append(sentence);
    return host;
  }

  function answerChanged(event) {
    if (elements.questionList.dataset.reactView) return;
    const article = event.target.closest('[data-question-id]');
    if (!article) return;
    const questionId = article.dataset.questionId;
    const question = state.attempt.questions.find((candidate) => candidate.questionId === questionId);
    if (!question || state.attempt.confirmedQuestionIds?.includes(questionId)) return;
    recordAnswer(questionId, readAnswer(article, question));
  }

  function recordAnswer(questionId, answer) {
    if (!state.attempt || state.attempt.status !== 'active' || state.attempt.confirmedQuestionIds?.includes(questionId)
      || state.attempt.timedOutQuestionIds?.includes(questionId)) return;
    state.attempt.answers[questionId] = answer;
    state.dirtyQuestions.add(questionId);
    state.answerVersions.set(questionId, (state.answerVersions.get(questionId) || 0) + 1);
    elements.saveState.textContent = 'Odpowiedź zapisana lokalnie';
    persistPendingAnswers();
    scheduleAnswerSave();
    renderNavigator();
  }

  function readAnswer(article, question) {
    if (question.options) {
      const selected = Array.from(article.querySelectorAll('input:checked')).map((input) => input.value);
      return question.type === 'multiple_choice' ? selected : selected[0] || '';
    }
    if (['short_text', 'number', 'open_answer'].includes(question.type)) return article.querySelector('[data-answer-input]')?.value || '';
    if (question.type === 'matching') return Object.fromEntries(Array.from(article.querySelectorAll('[data-match-left]')).map((select) => [select.dataset.matchLeft, select.value]));
    if (question.type === 'ordering') return Array.from(article.querySelectorAll('[data-item-id]')).map((item) => item.dataset.itemId);
    return Object.fromEntries(Array.from(article.querySelectorAll('[data-blank-id]')).map((input) => [input.dataset.blankId, input.value]));
  }

  function scheduleAnswerSave() {
    if (state.saveTimer || !state.dirtyQuestions.size || state.attempt?.status !== 'active') return;
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = 0;
      void flushPendingAnswers(false);
    }, ANSWER_SAVE_INTERVAL_MS);
  }

  async function flushPendingAnswers(explicit) {
    if (state.navigationTask) await state.navigationTask;
    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    const pending = capturePendingAnswers();
    if (!pending.count) {
      if (explicit) elements.saveState.textContent = 'Wszystkie odpowiedzi zapisane';
      return true;
    }
    elements.saveState.textContent = `Zapisywanie odpowiedzi (${pending.count})…`;
    try {
      const payload = await mutate('autosave-batch', { answers: pending.answers });
      acceptServerAttempt(payload.attempt, pending);
      elements.saveState.textContent = state.dirtyQuestions.size ? 'Nowsze zmiany czekają na zapis' : 'Odpowiedzi zapisane';
      renderNavigator();
      return true;
    } catch (error) {
      if (error.code === 'ATTEMPT_VERSION_CONFLICT' && error.payload?.attempt) {
        acceptServerAttempt(error.payload.attempt);
        renderAttempt();
      }
      setMessage(elements.attemptMessage, errorMessage(error));
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      elements.saveState.textContent = isOffline
        ? 'Tryb offline: odpowiedzi zapisane lokalnie w pamięci urządzenia (0 utraty danych)'
        : 'Zapis chwilowo nieudany — ponowię automatycznie';
      scheduleAnswerSave();
      return false;
    }
  }

  async function navigatePage(direction) {
    const indices = visibleIndices();
    const target = direction < 0 ? indices[0] - 1 : indices.at(-1) + 1;
    if (target < 0 || target >= state.attempt.totalQuestions) return;
    await navigateTo(target);
  }

  async function navigateTo(targetIndex) {
    if (!state.attempt || state.attempt.status !== 'active') return;
    if (targetIndex === state.attempt.currentIndex) return;
    if (canBrowseWhileSaving()) return navigateFreely(targetIndex);
    if (state.transitioning) return;
    const previousIndex = state.attempt.currentIndex;
    const previousHighestReachedIndex = state.attempt.highestReachedIndex;
    const localError = localNavigationError(targetIndex);
    if (localError) {
      setMessage(elements.attemptMessage, ERROR_MESSAGES[localError] || ERROR_MESSAGES.EXAM_UNAVAILABLE);
      return;
    }
    state.transitioning = true;
    state.pendingNavigationIndex = targetIndex;
    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    const pending = capturePendingAnswers();
    state.attempt.currentIndex = targetIndex;
    state.attempt.highestReachedIndex = Math.max(state.attempt.highestReachedIndex, targetIndex);
    if (state.attempt.exam.timing.mode === 'question') clearTimer();
    renderQuestions();
    renderNavigator();
    updateControls();
    setMessage(elements.attemptMessage, '', false);
    try {
      const payload = await mutate('navigate', {
        targetIndex,
        ...(pending.count ? { answers: pending.answers } : {})
      });
      acceptServerAttempt(payload.attempt, pending);
      elements.saveState.textContent = state.dirtyQuestions.size ? 'Nowsze zmiany czekają na zapis' : 'Odpowiedzi zapisane';
      renderNavigator();
      updateControls();
      startTimer();
    } catch (error) {
      state.pendingNavigationIndex = null;
      if (error.payload?.attempt) acceptServerAttempt(error.payload.attempt);
      else {
        state.attempt.currentIndex = previousIndex;
        state.attempt.highestReachedIndex = previousHighestReachedIndex;
      }
      scheduleAnswerSave();
      renderAttempt();
      setMessage(elements.attemptMessage, errorMessage(error));
    } finally {
      state.transitioning = false;
      state.pendingNavigationIndex = null;
      renderNavigator();
      updateControls();
    }
  }

  function canBrowseWhileSaving() {
    const navigation = state.attempt?.exam.navigation;
    return state.attempt?.status === 'active' && state.attempt.exam.timing.mode !== 'question'
      && navigation?.allowFreeNavigation && navigation.allowBack && navigation.allowSkip
      && !navigation.requireAnswerBeforeNext;
  }

  function navigationBlocked() {
    return state.transitioning && !canBrowseWhileSaving();
  }

  function navigateFreely(targetIndex) {
    const error = localNavigationError(targetIndex);
    if (error) { setMessage(elements.attemptMessage, ERROR_MESSAGES[error] || ERROR_MESSAGES.EXAM_UNAVAILABLE); return; }
    const previousIndex = state.attempt.currentIndex;
    const previousHighest = state.attempt.highestReachedIndex;
    state.transitioning = true;
    state.pendingNavigationIndex = targetIndex;
    state.attempt.currentIndex = targetIndex;
    state.attempt.highestReachedIndex = Math.max(previousHighest, targetIndex);
    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    renderQuestions();
    renderNavigator();
    updateControls();
    elements.saveState.textContent = 'Zapisywanie w tle…';
    setMessage(elements.attemptMessage, '', false);
    // Only one navigation writer. Rapid clicks update the desired destination
    // immediately and coalesce into the latest index, not a request per click.
    if (!state.navigationTask) state.navigationTask = syncFreeNavigation(previousIndex, previousHighest);
    return state.navigationTask;
  }

  async function syncFreeNavigation(acknowledgedIndex, acknowledgedHighest) {
    const attemptId = state.attempt.attemptId;
    try {
      while (state.pendingNavigationIndex != null && state.attempt.status === 'active') {
        const targetIndex = state.pendingNavigationIndex;
        const pending = capturePendingAnswers();
        const payload = await mutate('navigate', { targetIndex, ...(pending.count ? { answers: pending.answers } : {}) });
        if (state.attempt.attemptId !== attemptId) return;
        acknowledgedIndex = payload.attempt.currentIndex;
        acknowledgedHighest = payload.attempt.highestReachedIndex;
        if (state.pendingNavigationIndex === targetIndex) state.pendingNavigationIndex = null;
        acceptServerAttempt(payload.attempt, pending);
        if (state.attempt.status !== 'active') { renderResult(state.attempt.result); break; }
      }
      elements.saveState.textContent = state.dirtyQuestions.size ? 'Nowsze zmiany czekają na zapis' : 'Odpowiedzi zapisane';
    } catch (error) {
      if (state.attempt.attemptId !== attemptId) return;
      state.pendingNavigationIndex = null;
      if (error.payload?.attempt) acceptServerAttempt(error.payload.attempt);
      else {
        state.attempt.currentIndex = acknowledgedIndex;
        state.attempt.highestReachedIndex = acknowledgedHighest;
      }
      if (state.attempt.status === 'active') {
        renderAttempt();
        scheduleAnswerSave();
        elements.saveState.textContent = 'Zmiany lokalne zachowane — zapis nie został potwierdzony';
        setMessage(elements.attemptMessage, errorMessage(error));
      } else renderResult(state.attempt.result);
    } finally {
      if (state.attempt.attemptId === attemptId) {
        state.transitioning = false;
        state.pendingNavigationIndex = null;
        state.navigationTask = null;
        if (state.attempt.status === 'active') { renderNavigator(); updateControls(); }
      }
    }
  }

  function localNavigationError(targetIndex) {
    if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= state.attempt.totalQuestions) {
      return 'INVALID_QUESTION_INDEX';
    }
    const currentIndex = state.attempt.currentIndex;
    const navigation = state.attempt.exam.navigation;
    if (!navigation.allowBack && targetIndex < currentIndex) return 'BACK_NAVIGATION_DISABLED';
    const nextSequentialIndex = visibleIndices().at(-1) + 1;
    if (!navigation.allowFreeNavigation && targetIndex > nextSequentialIndex) return 'QUESTION_NOT_UNLOCKED';
    if (targetIndex <= currentIndex) return '';
    const timedOut = new Set(state.attempt.timedOutQuestionIds || []);
    const unanswered = state.attempt.questions.slice(currentIndex, targetIndex).some((question) => (
      !answerPresent(state.attempt.answers?.[question.questionId]) && !timedOut.has(question.questionId)
    ));
    if (unanswered && navigation.requireAnswerBeforeNext) return 'ANSWER_REQUIRED';
    if (unanswered && !navigation.allowSkip) return 'SKIPPING_DISABLED';
    return '';
  }

  async function toggleFlag() {
    if (state.transitioning) return;
    const question = state.attempt.questions[state.attempt.currentIndex];
    const flagged = !state.attempt.flags.includes(question.questionId);
    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    const pending = capturePendingAnswers();
    try {
      const payload = await mutate('navigate', {
        targetIndex: state.attempt.currentIndex,
        flagged,
        ...(pending.count ? { answers: pending.answers } : {})
      });
      acceptServerAttempt(payload.attempt, pending);
      renderAttempt();
    } catch (error) {
      if (error.payload?.attempt) acceptServerAttempt(error.payload.attempt);
      scheduleAnswerSave();
      setMessage(elements.attemptMessage, errorMessage(error));
    }
  }

  function orderingAction(event) {
    const button = event.target.closest('[data-order-action]');
    if (!button) return;
    const item = button.closest('[data-item-id]');
    const sibling = button.dataset.orderAction === 'up' ? item.previousElementSibling : item.nextElementSibling;
    if (!sibling) return;
    if (button.dataset.orderAction === 'up') item.parentNode.insertBefore(item, sibling);
    else item.parentNode.insertBefore(sibling, item);
    renderOrderNumbers(item.parentNode);
    answerChanged({ target: button });
  }

  function questionAction(event) {
    if (elements.questionList.dataset.reactView) return;
    const confirm = event.target.closest('[data-confirm-question]');
    if (confirm) { void confirmQuestion(confirm.dataset.confirmQuestion); return; }
    orderingAction(event);
  }

  async function confirmQuestion(questionId) {
    if (state.transitioning) return;
    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    const pending = capturePendingAnswers();
    const button = elements.questionList.querySelector(`[data-confirm-question="${CSS.escape(questionId)}"]`);
    if (button) button.disabled = true;
    try {
      const payload = await mutate('confirm-answer', {
        questionId,
        ...(pending.count ? { answers: pending.answers } : {})
      });
      acceptServerAttempt(payload.attempt, pending);
      renderAttempt();
    } catch (error) {
      if (error.payload?.attempt) acceptServerAttempt(error.payload.attempt);
      if (button) button.disabled = false;
      scheduleAnswerSave();
      setMessage(elements.attemptMessage, errorMessage(error));
    }
  }

  function renderOrderNumbers(host) {
    host.querySelectorAll('[data-item-id]').forEach((item, index) => { item.querySelector('strong').textContent = String(index + 1); });
  }

  async function submitAttempt() {
    if (state.submitting) return;
    if (state.navigationTask) await state.navigationTask;
    if (state.attempt?.status !== 'active') return;
    const answered = Object.values(state.attempt.answers || {}).filter(answerPresent).length;
    const unanswered = state.attempt.totalQuestions - answered;
    if (unanswered > 0 && !window.confirm(`Pozostało ${unanswered} pytań bez odpowiedzi. Zakończyć próbę?`)) return;
    state.submitting = true;
    window.clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    const pending = capturePendingAnswers();
    elements.submit.disabled = true;
    try {
      const payload = await mutate('submit', {
        force: unanswered > 0,
        ...(pending.count ? { answers: pending.answers } : {})
      });
      acceptServerAttempt(payload.attempt, pending);
      try { sessionStorage.removeItem(pendingStorageKey()); } catch (_) {}
      renderResult(payload.result);
    } catch (error) {
      scheduleAnswerSave();
      setMessage(elements.attemptMessage, errorMessage(error));
    } finally {
      state.submitting = false;
      if (state.attempt?.status === 'active') elements.submit.disabled = false;
    }
  }

  function mutate(action, body) {
    const attemptId = state.attempt.attemptId;
    const operation = () => {
      if (state.attempt?.attemptId !== attemptId) throw new Error('ATTEMPT_CHANGED');
      return client.mutate(action, {
        ...state.reference,
        preview: state.preview,
        body: {
          attemptId,
          revision: state.attempt.revision,
          operationId: operationId(),
          ...body
        }
      });
    };
    const result = state.mutationQueue.then(operation, operation);
    state.mutationQueue = result.catch(() => undefined);
    return result;
  }

  async function logLifecycle(eventType, keepalive, details = {}) {
    if (state.attempt?.status !== 'active') return;
    const attemptId = state.attempt.attemptId;
    const pending = capturePendingAnswers();
    try {
      const payload = keepalive
        ? await client.mutate('event', {
          ...state.reference,
          preview: state.preview,
          body: {
            attemptId, revision: state.attempt.revision, operationId: operationId(), eventType, details,
            ...(pending.count ? { answers: pending.answers } : {})
          }
        }, { keepalive: true })
        : await mutate('event', {
          eventType,
          details,
          ...(pending.count ? { answers: pending.answers } : {})
        });
      if (payload?.attempt?.attemptId === attemptId
        && state.attempt?.attemptId === attemptId
        && Number(payload.attempt.revision) >= Number(state.attempt.revision)) {
        acceptServerAttempt(payload.attempt, pending);
      }
    } catch (_) {}
  }

  function logSignal(eventType) {
    if (state.attempt?.status !== 'active') return;
    const now = Date.now();
    if (now - (state.signalTimes.get(eventType) || 0) < SIGNAL_THROTTLE_MS) return;
    state.signalTimes.set(eventType, now);
    void logLifecycle(eventType, false, { source: 'student_exam' });
  }

  function renderNavigator() {
    const answered = Object.values(state.attempt.answers || {}).filter(answerPresent).length;
    elements.progressCopy.textContent = `${answered}/${state.attempt.totalQuestions}`;
    elements.progressBar.style.width = `${state.attempt.totalQuestions ? (answered / state.attempt.totalQuestions) * 100 : 0}%`;
    elements.navigator.hidden = !state.attempt.exam.navigation.allowFreeNavigation && state.attempt.exam.display.mode !== 'all';
    if (window.NextMedUI?.render('exam-navigator', elements.navigatorGrid, {
      attempt: state.attempt, visible: visibleIndices(), blocked: navigationBlocked(), answerPresent, onNavigate: navigateTo
    })) return;
    if (state.navigatorAttemptId !== state.attempt.attemptId || elements.navigatorGrid.children.length !== state.attempt.questions.length) {
      elements.navigatorGrid.replaceChildren(...state.attempt.questions.map((question, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = String(index + 1); button.dataset.questionIndex = String(index);
        return button;
      }));
      state.navigatorAttemptId = state.attempt.attemptId;
    }
    const visible = new Set(visibleIndices());
    const flagged = new Set(state.attempt.flags);
    Array.from(elements.navigatorGrid.children).forEach((button, index) => {
      const question = state.attempt.questions[index];
      button.classList.toggle('is-current', visible.has(index));
      button.setAttribute('aria-current', visible.has(index) ? 'step' : 'false');
      button.classList.toggle('is-answered', answerPresent(state.attempt.answers[question.questionId]));
      button.classList.toggle('is-flagged', flagged.has(question.questionId));
      button.disabled = navigationBlocked()
        || (!state.attempt.exam.navigation.allowFreeNavigation && index > state.attempt.highestReachedIndex + 1);
    });
  }

  function updateControls() {
    const indices = visibleIndices();
    elements.flag.disabled = state.transitioning;
    elements.save.disabled = state.transitioning;
    elements.submit.disabled = state.transitioning;
    elements.questionList.querySelectorAll('[data-confirm-question]').forEach((button) => {
      button.disabled = Boolean(state.transitioning || state.attempt.confirmedQuestionIds?.includes(button.dataset.confirmQuestion)
        || state.attempt.timedOutQuestionIds?.includes(button.dataset.confirmQuestion));
    });
    elements.previous.disabled = navigationBlocked() || indices[0] === 0 || !state.attempt.exam.navigation.allowBack;
    elements.next.disabled = navigationBlocked() || indices.at(-1) >= state.attempt.totalQuestions - 1;
    elements.next.hidden = state.attempt.exam.display.mode === 'all';
    elements.previous.hidden = state.attempt.exam.display.mode === 'all';
    elements.submit.hidden = state.attempt.exam.display.mode !== 'all' && indices.at(-1) < state.attempt.totalQuestions - 1;
  }

  function startTimer() {
    clearTimer();
    if (state.attempt.exam.timing.mode === 'none') return;
    elements.timer.hidden = state.attempt.exam.timing.display === 'hidden';
    updateTimer();
    state.timerId = window.setInterval(updateTimer, 500);
  }

  function updateTimer() {
    if (!state.attempt || state.attempt.status !== 'active') return clearTimer();
    const now = Date.now() + state.serverOffset;
    const timing = state.attempt.exam.timing;
    const expiresAt = timing.mode === 'exam' ? state.attempt.expiresAt : state.attempt.currentQuestionExpiresAt;
    const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
    const startedAt = timing.mode === 'question'
      ? state.attempt.currentQuestionStartedAt
      : state.attempt.startedAt;
    const displayed = timing.display === 'countup'
      ? Math.max(0, Math.floor((now - Date.parse(startedAt || state.attempt.startedAt)) / 1000))
      : remaining;
    elements.timer.textContent = formatClock(displayed);
    if (remaining > 0 && remaining <= 5 && state.dirtyQuestions.size && state.deadlineSaveFor !== expiresAt) {
      state.deadlineSaveFor = expiresAt;
      void flushPendingAnswers(false);
    }
    if (remaining <= 0) void timerExpired(timing.mode);
  }

  async function timerExpired(mode) {
    clearTimer();
    if (mode === 'exam') {
      try {
        const payload = await client.attempt({
          ...state.reference,
          materialId: state.materialId,
          attemptId: state.attempt.attemptId,
          preview: state.preview
        });
        acceptServerAttempt(payload.attempt);
        if (state.attempt.status !== 'active') renderResult(state.attempt.result);
      } catch (error) { setMessage(elements.attemptMessage, errorMessage(error)); }
      return;
    }
    setMessage(elements.attemptMessage, 'Czas na bieżące pytanie minął. Przejdź dalej.');
    const target = Math.min(state.attempt.totalQuestions - 1, state.attempt.currentIndex + 1);
    await navigateTo(target);
  }

  function clearTimer() {
    window.clearInterval(state.timerId); state.timerId = 0; elements.timer.hidden = true;
  }

  function renderResult(result) {
    clearTimer();
    if (state.attempt?.status && state.attempt.status !== 'active') clearPendingAnswers(state.attempt.attemptId);
    setView('result');
    const passed = result.passed;
    const pending = result.gradingStatus === 'pending_review';
    const unscored = result.gradingStatus === 'not_scored';
    elements.refreshResult.hidden = !pending;
    elements.resultIcon.textContent = pending ? '…' : unscored ? '—' : passed === false ? '×' : '✓';
    elements.resultIcon.dataset.state = pending || unscored ? 'pending' : passed === false ? 'failed' : 'passed';
    elements.resultTitle.textContent = pending ? 'Odpowiedzi czekają na ocenę' : passed == null ? 'Wynik zapisany' : passed ? 'Egzamin zaliczony' : 'Egzamin niezaliczony';
    elements.resultMessage.textContent = unscored
      ? 'Odpowiedzi zapisano. Ten egzamin nie ma punktowanych pytań i nie wyznacza wyniku.'
      : pending
      ? `Sprawdzający musi jeszcze ocenić ${result.pendingQuestionCount || 1} ${result.pendingQuestionCount === 1 ? 'pytanie otwarte' : 'pytań otwartych'}. Po sprawdzeniu kliknij „Odśwież wynik”.`
      : state.definition.metadata.afterFinishMessage || 'Twoja próba została bezpiecznie zapisana.';
    elements.resultMetrics.replaceChildren();
    if (result.scorePercent != null) metric('Wynik', `${result.scorePercent}%`);
    if (result.points != null) metric('Punkty', `${result.points}/${result.maxPoints}`);
    if (result.passed != null) metric('Status', result.passed ? 'Zaliczono' : 'Nie zaliczono');
    if (result.durationSeconds != null) metric('Czas', formatDuration(result.durationSeconds));
    const reactResults = window.NextMedUI?.render('exam-results', elements.resultQuestions, { questions: result.questions || [] });
    if (!reactResults) {
    elements.resultQuestions.replaceChildren();
    (result.questions || []).forEach((question, index) => {
      const item = document.createElement('article'); item.className = 'exam-result-question';
      const heading = tag('', 'strong');
      window.ChemAssessmentText.render(heading, `${index + 1}. ${question.prompt}`, question.promptFormat);
      item.append(heading);
      if (Object.hasOwn(question, 'correct')) item.append(tag(question.correct ? 'Odpowiedź poprawna' : 'Odpowiedź niepoprawna', 'small'));
      if (question.reviewStatus === 'pending') item.append(tag('Oczekuje na ocenę sprawdzającego', 'small'));
      if (question.reviewStatus === 'not_scored') item.append(tag('Pytanie nie wpływa na wynik', 'small'));
      if (question.points != null && question.maxPoints != null) item.append(tag(`${question.points}/${question.maxPoints} pkt`, 'small'));
      appendResultAnswer(item, 'Twoja odpowiedź', question.answerDisplay);
      appendResultAnswer(item, 'Prawidłowa odpowiedź', question.correctAnswerDisplay);
      if (question.feedback) item.append(formattedAnswer(question.feedback, 'div'));
      if (question.explanation) item.append(formattedAnswer(question.explanation, 'div'));
      elements.resultQuestions.append(item);
    });
    }
    void reloadAttemptHistory();
  }

  async function refreshFinishedResult() {
    const attemptId = state.resultAttemptId || state.attempt?.attemptId;
    if (!attemptId) return;
    elements.refreshResult.disabled = true;
    elements.refreshResult.textContent = 'Odświeżanie…';
    try {
      const payload = await client.result({
        ...state.reference,
        materialId: state.materialId,
        attemptId,
        preview: state.preview
      });
      if (state.attempt?.attemptId === attemptId) state.attempt.result = payload.result;
      renderResult(payload.result);
    } catch (error) {
      elements.resultMessage.textContent = errorMessage(error);
    } finally {
      elements.refreshResult.disabled = false;
      elements.refreshResult.textContent = 'Odśwież wynik';
    }
  }

  function appendResultAnswer(item, label, values) {
    if (!Array.isArray(values)) return;
    const row = document.createElement('div');
    row.className = 'exam-result-answer';
    row.append(tag(label, 'small'));
    row.append(formattedAnswer(values.length ? values.join('\n') : 'Brak odpowiedzi', 'div'));
    item.append(row);
  }

  function formattedAnswer(value, tagName) {
    const content = document.createElement(tagName);
    window.ChemAssessmentText.render(content, value, { size: 'small' });
    return content;
  }

  async function reloadAttemptHistory() {
    try {
      const payload = await client.definition({
        ...state.reference,
        materialId: state.materialId,
        preview: state.preview
      });
      state.definition = payload.exam;
      state.attempts = payload.attempts || [];
      syncServerTime(payload.serverNow);
    } catch (_) {}
  }

  function metric(label, value) {
    const item = document.createElement('div'); item.append(tag(label, 'small'), tag(value, 'strong')); elements.resultMetrics.append(item);
  }

  async function setBackgroundImage(node, ref) {
    try {
      const objectUrl = await protectedImageUrl(ref);
      node.style.backgroundImage = `url("${objectUrl}")`; node.hidden = false;
    } catch (_) { node.hidden = true; }
  }

  function imageGrid(images, className = 'exam-question-images') {
    const grid = document.createElement('div'); grid.className = className;
    images.forEach((image) => {
      const img = document.createElement('img');
      img.alt = image.alt || 'Ilustracja';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.className = 'is-loading';
      img.dataset.examImageRef = image.ref;
      img.setAttribute('aria-busy', 'true');
      grid.append(img);
      queueProtectedImage(img);
    });
    return grid;
  }

  function queueProtectedImage(image) {
    if (typeof window.IntersectionObserver !== 'function') return void hydrateProtectedImage(image);
    if (!state.imageObserver) {
      state.imageObserver = new window.IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          state.imageObserver?.unobserve(entry.target);
          void hydrateProtectedImage(entry.target);
        });
      }, { rootMargin: '400px 0px' });
    }
    state.imageObserver.observe(image);
  }

  async function hydrateProtectedImage(image) {
    try {
      const url = await protectedImageUrl(image.dataset.examImageRef);
      if (!image.isConnected) {
        return;
      }
      image.src = url;
      image.classList.remove('is-loading');
      image.removeAttribute('aria-busy');
    } catch (_) { image.remove(); }
  }

  async function protectedImageUrl(ref) {
    const key = JSON.stringify([state.reference, state.preview, ref]);
    const cached = state.imageCache.get(key);
    if (cached && (cached.pending || cached.expiresAt > Date.now())) {
      state.imageCache.delete(key);
      state.imageCache.set(key, cached);
      return cached.promise;
    }
    if (cached?.url) URL.revokeObjectURL(cached.url);
    const generation = state.imageCacheGeneration;
    const entry = { pending: true, size: 0, url: '', expiresAt: 0 };
    entry.promise = fetchProtectedImageBlob(ref).then((blob) => {
      if (generation !== state.imageCacheGeneration) throw new Error('AUTH_EXPIRED');
      entry.url = URL.createObjectURL(blob);
      entry.size = blob.size;
      entry.pending = false;
      entry.expiresAt = Date.now() + 15 * 60 * 1000;
      let bytes = Array.from(state.imageCache.values()).reduce((sum, item) => sum + item.size, 0);
      for (const [oldKey, old] of state.imageCache) {
        if (state.imageCache.size <= 96 && bytes <= 64 * 1024 * 1024) break;
        if (old.pending || old === entry) continue;
        URL.revokeObjectURL(old.url);
        state.imageCache.delete(oldKey);
        bytes -= old.size;
      }
      return entry.url;
    }).catch((error) => {
      if (state.imageCache.get(key) === entry) state.imageCache.delete(key);
      throw error;
    });
    state.imageCache.set(key, entry);
    return entry.promise;
  }

  async function fetchProtectedImageBlob(ref) {
    const library = window.ChemContentLibrary;
    if (library?.readMediaBlob) {
      const shared = String(ref || '').startsWith('assets/shared/');
      const blob = await library.readMediaBlob({
        scope: shared ? 'shared' : 'local',
        materialKind: shared ? '' : 'exam',
        materialId: shared ? '' : state.reference.examId,
        reference: ref,
        repositoryId: state.reference.repositoryId
      });
      return blob;
    }
    const token = await window.ChemAuth.getAccessToken();
    const response = await fetch(client.imageUrl({ ...state.reference, preview: state.preview }, ref), { headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin' });
    if (!response.ok) throw new Error('IMAGE_UNAVAILABLE');
    return response.blob();
  }

  function disconnectImageObserver() {
    state.imageObserver?.disconnect();
    state.imageObserver = null;
  }

  function clearImageCache() {
    state.imageCacheGeneration++;
    state.imageCache.forEach((entry) => { if (entry.url) URL.revokeObjectURL(entry.url); });
    state.imageCache.clear();
  }

  function initializeTheme() {
    let theme = ''; try { theme = localStorage.getItem('chem.theme') || ''; } catch (_) {}
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  function toggleTheme() {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme; try { localStorage.setItem('chem.theme', theme); } catch (_) {}
  }

  function syncServerTime(serverNow) {
    const value = Date.parse(serverNow || ''); state.serverOffset = Number.isFinite(value) ? value - Date.now() : 0;
  }

  function fatal(message) {
    setView('loading'); elements.loading.querySelector('.exam-spinner').hidden = true; elements.loading.querySelector('h1').textContent = 'Nie można otworzyć egzaminu'; elements.loading.querySelector('p').textContent = message;
  }

  function tag(value, tagName = 'span') { const node = document.createElement(tagName); node.textContent = String(value); return node; }
  function typeLabel(type) { return ({ single_choice: 'Jedna odpowiedź', multiple_choice: 'Wiele odpowiedzi', true_false: 'Prawda / fałsz', short_text: 'Krótka odpowiedź', number: 'Liczba', matching: 'Dopasowywanie', ordering: 'Kolejność', fill_blanks: 'Uzupełnianie luk', open_answer: 'Pytanie otwarte' })[type] || 'Pytanie'; }
  function attemptLimitLabel() { const config = state.definition.attempts; return config.mode === 'unlimited' ? 'Próby bez limitu' : config.mode === 'one' ? 'Jedna próba' : `${config.maxAttempts} prób`; }
  function answerPresent(value) { return Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.values(value).some((entry) => String(entry).trim()) : value != null && String(value).trim() !== ''; }
  function operationId() { return `op:${cryptoId()}`; }
  function cryptoId() { return window.crypto?.randomUUID?.() || `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
  function formatClock(seconds) { const value = Math.max(0, Math.floor(seconds)); const hours = Math.floor(value / 3600); const minutes = Math.floor((value % 3600) / 60); const rest = value % 60; return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`; }
  function formatDuration(seconds) { const value = Math.max(0, Math.round(Number(seconds) || 0)); const minutes = Math.floor(value / 60); return minutes ? `${minutes} min ${value % 60} s` : `${value} s`; }

  document.addEventListener('DOMContentLoaded', start);
})();
