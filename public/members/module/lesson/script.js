(async () => {
  'use strict';

  const authState = await window.ChemAuth.ready;
  if (!authState?.authenticated || !authState.session?.ok) return;

  const parser = window.ChemLesson;
  const progressApi = window.ChemProgress;
  const navigationApi = window.ChemLessonNavigation;
  const elements = {
    app: document.getElementById('app'),
    lessonTitle: document.getElementById('lesson-title'),
    lessonPosition: document.getElementById('lesson-position'),
    progressBar: document.getElementById('progress-bar'),
    outlineList: document.getElementById('outline-list'),
    loading: document.getElementById('loading-state'),
    error: document.getElementById('error-state'),
    errorTitle: document.getElementById('error-title'),
    errorMessage: document.getElementById('error-message'),
    retry: document.getElementById('retry-button'),
    slideCard: document.getElementById('slide-card'),
    slideNumber: document.getElementById('slide-number'),
    slideStatus: document.getElementById('slide-status'),
    slideContent: document.getElementById('slide-content'),
    taskHost: document.getElementById('task-host'),
    completion: document.getElementById('completion-state'),
    navigation: document.getElementById('lesson-navigation'),
    navigationHint: document.getElementById('navigation-hint'),
    previous: document.getElementById('previous-button'),
    next: document.getElementById('next-button'),
    restart: document.getElementById('restart-button'),
    themeToggle: document.getElementById('theme-toggle'),
    topbarToggle: document.getElementById('topbar-toggle'),
    outlineToggle: document.getElementById('outline-toggle'),
    sequenceToggle: document.getElementById('sequence-toggle'),
    sequenceToggleHint: document.getElementById('sequence-toggle-hint'),
    outlineTipCopy: document.getElementById('outline-tip-copy'),
    resetProgress: document.getElementById('reset-progress-button'),
    libraryButton: document.getElementById('lesson-library-button'),
    libraryDialog: document.getElementById('lesson-library-dialog'),
    libraryClose: document.getElementById('lesson-library-close'),
    librarySearch: document.getElementById('lesson-library-search'),
    libraryRepository: document.getElementById('lesson-library-repository'),
    libraryStatus: document.getElementById('lesson-library-status'),
    libraryList: document.getElementById('lesson-library-list'),
    completionMessage: document.getElementById('completion-message')
  };

  const state = {
    filename: '',
    repositoryId: '',
    lesson: null,
    index: 0,
    maxReached: 0,
    solved: new Set(),
    completedStepIds: new Set(),
    completed: false,
    sequential: true,
    attempts: new Map(),
    studentAnswers: new Map(),
    answerPersistence: new Map(),
    answerQuestions: new Map(),
    libraryAssets: [],
    repositories: [],
    mediaObjectUrls: [],
    isAdmin: false,
    topbarCollapsed: false,
    outlineCollapsed: false,
    loadRequestId: 0,
    examProgressRefreshAt: 0,
    examProgressPromise: null
  };

  const UI_PREFERENCES_KEY = 'chemdisk.lesson.ui.v1';
  const EXAM_PROGRESS_FOCUS_COOLDOWN_MS = 15_000;

  function isAdminUser(user) {
    const roles = user?.app_metadata?.roles;
    return Array.isArray(roles) && roles.includes('admin');
  }

  function initializePermissions() {
    const user = typeof window.ChemAuth.getUser === 'function'
      ? window.ChemAuth.getUser()
      : null;
    state.isAdmin = isAdminUser(user);
    elements.libraryButton.hidden = !state.isAdmin;
    elements.libraryDialog.setAttribute('aria-hidden', String(!state.isAdmin));
  }

  function loadUiPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return;
      state.topbarCollapsed = saved.topbarCollapsed === true;
      state.outlineCollapsed = saved.outlineCollapsed === true;
    } catch {}
  }

  function saveUiPreferences() {
    try {
      localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify({
        topbarCollapsed: state.topbarCollapsed,
        outlineCollapsed: state.outlineCollapsed
      }));
    } catch {}
  }

  function applyUiState() {
    elements.app.classList.toggle('is-topbar-collapsed', state.topbarCollapsed);
    elements.app.classList.toggle('is-outline-collapsed', state.outlineCollapsed);

    const topbarLabel = state.topbarCollapsed ? 'Rozwiń górny pasek' : 'Zwiń górny pasek';
    elements.topbarToggle.setAttribute('aria-expanded', String(!state.topbarCollapsed));
    elements.topbarToggle.setAttribute('aria-label', topbarLabel);
    elements.topbarToggle.title = topbarLabel;

    const outlineLabel = state.outlineCollapsed ? 'Rozwiń plan lekcji' : 'Zwiń plan lekcji';
    elements.outlineToggle.setAttribute('aria-expanded', String(!state.outlineCollapsed));
    elements.outlineToggle.setAttribute('aria-label', outlineLabel);
    elements.outlineToggle.title = outlineLabel;
  }

  function toggleTopbar() {
    state.topbarCollapsed = !state.topbarCollapsed;
    applyUiState();
    saveUiPreferences();
  }

  function toggleOutline() {
    state.outlineCollapsed = !state.outlineCollapsed;
    applyUiState();
    saveUiPreferences();
  }

  function readFilename() {
    const params = new URLSearchParams(window.location.search);
    const files = params.getAll('file');
    if (files.length !== 1) return '';
    return parser.validateFilename(files[0]);
  }

  function readRepositoryId() {
    const params = new URLSearchParams(window.location.search);
    const values = params.getAll('repo');
    if (values.length > 1) return '';
    const value = values[0] ? values[0].trim().toLowerCase() : '';
    return !value || /^[a-z0-9][a-z0-9-]{0,39}$/.test(value) ? value : '';
  }

  function progressKey() {
    return `chemdisk.lesson.v1:${state.repositoryId || 'default'}:${state.filename}`;
  }

  function lessonMaterialId() {
    if (state.materialId) return state.materialId;
    const params = new URLSearchParams(window.location.search);
    state.materialId = progressApi
      ? progressApi.materialId('lesson', `${state.repositoryId || 'default'}:${state.filename}`, params.get('material') || '')
      : '';
    return state.materialId;
  }

  function lessonReturnUrl() {
    if (!state.filename) return '';
    const url = new URL('/members/module/lesson/', window.location.origin);
    url.searchParams.set('file', state.filename);
    if (state.repositoryId) url.searchParams.set('repo', state.repositoryId);
    const material = new URLSearchParams(window.location.search).get('material');
    if (material && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(material)) url.searchParams.set('material', material);
    return `${url.pathname}${url.search}`;
  }

  function decorateLessonModuleLinks(root) {
    const returnUrl = lessonReturnUrl();
    if (!returnUrl || !root?.querySelectorAll) return;
    root.querySelectorAll('a[href]').forEach((link) => {
      try {
        const target = new URL(link.getAttribute('href'), window.location.origin);
        if (target.origin !== window.location.origin) return;
        if (!/^\/members\/module\/[^/]+\/?$/.test(target.pathname)) return;
        if (/^\/members\/module\/lesson\/?$/.test(target.pathname)) return;
        target.searchParams.set('lesson_return', returnUrl);
        link.href = `${target.pathname}${target.search}${target.hash}`;
      } catch (_) {}
    });
  }

  const LESSON_ANSWER_LIMIT = 6_000;
  const LESSON_AI_RESPONSE_LIMIT = 8_000;
  const QUESTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

  function booleanData(element, names, fallback = false) {
    for (const name of names) {
      const value = element?.dataset?.[name];
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    return fallback;
  }

  function validQuestionId(value) {
    const questionId = String(value || '').trim();
    return QUESTION_ID_PATTERN.test(questionId) ? questionId : '';
  }

  function validIsoTimestamp(value) {
    const timestamp = String(value || '');
    return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : '';
  }

  function normalizeStudentAnswerRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const answer = String(value.answer || '').slice(0, LESSON_ANSWER_LIMIT);
    const version = Math.max(1, Math.floor(Number(value.version) || 1));
    const aiCheckedAnswerVersion = Math.max(0, Math.floor(Number(value.aiCheckedAnswerVersion) || 0));
    return {
      answer,
      answeredAt: validIsoTimestamp(value.answeredAt),
      updatedAt: validIsoTimestamp(value.updatedAt),
      version,
      aiUsed: value.aiUsed === true,
      aiCheckedAnswerVersion,
      aiResponse: String(value.aiResponse || '').slice(0, LESSON_AI_RESPONSE_LIMIT),
      aiCheckedAt: validIsoTimestamp(value.aiCheckedAt)
    };
  }

  function answerRecordRecency(record) {
    return Math.max(
      Date.parse(record?.updatedAt || '') || 0,
      Date.parse(record?.aiCheckedAt || '') || 0
    );
  }

  function mergeStudentAnswers(source, options = {}) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    Object.entries(source).slice(0, 500).forEach(([rawId, rawRecord]) => {
      const questionId = validQuestionId(rawId);
      const record = normalizeStudentAnswerRecord(rawRecord);
      if (!questionId || !record) return;
      if (options.respectPersistence && state.answerPersistence.get(questionId) !== true) return;
      const current = state.studentAnswers.get(questionId);
      if (
        !current
        || record.version > current.version
        || (record.version === current.version && answerRecordRecency(record) >= answerRecordRecency(current))
      ) {
        state.studentAnswers.set(questionId, record);
      }
    });
  }

  function collectOpenAnswerMetadata() {
    state.answerPersistence = new Map();
    state.answerQuestions = new Map();
    state.lesson?.slides?.forEach((slide) => {
      if (!slide?.html?.includes('data-question-id')) return;
      const template = document.createElement('template');
      template.innerHTML = slide.html;
      template.content.querySelectorAll('.lesson-student-answer[data-question-id]').forEach((card) => {
        const questionId = validQuestionId(card.dataset.questionId);
        if (!questionId) return;
        state.answerPersistence.set(
          questionId,
          booleanData(card, ['persist', 'saveToProgress'], true)
        );
        const question = String(card.dataset.question || '').trim();
        if (question) state.answerQuestions.set(questionId, question);
      });
      template.content.querySelectorAll('.lesson-answer-review[data-question-id]').forEach((card) => {
        const questionId = validQuestionId(card.dataset.questionId);
        const question = String(card.dataset.question || '').trim();
        if (questionId && question && !state.answerQuestions.has(questionId)) {
          state.answerQuestions.set(questionId, question);
        }
      });
    });
  }

  function serializedStudentAnswers(persistentOnly = false) {
    const output = {};
    state.studentAnswers.forEach((record, questionId) => {
      if (persistentOnly && state.answerPersistence.get(questionId) === false) return;
      output[questionId] = {
        answer: record.answer,
        answeredAt: record.answeredAt,
        updatedAt: record.updatedAt,
        version: record.version,
        aiUsed: record.aiUsed,
        aiCheckedAnswerVersion: record.aiCheckedAnswerVersion,
        aiResponse: record.aiResponse,
        aiCheckedAt: record.aiCheckedAt
      };
    });
    return output;
  }

  function isCurrentLessonLoad(requestId) {
    return requestId === state.loadRequestId;
  }

  async function loadProgress(requestId) {
    if (!isCurrentLessonLoad(requestId)) return false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(progressKey()) || 'null');
      if (saved && state.lesson && saved.signature === state.lesson.signature) {
        const lastIndex = state.lesson.slides.length - 1;
        state.index = Math.min(lastIndex, Math.max(0, Number(saved.index) || 0));
        state.maxReached = Math.min(lastIndex, Math.max(state.index, Number(saved.maxReached) || 0));
        state.solved = new Set(
          Array.isArray(saved.solved)
            ? saved.solved.filter((index) => Number.isSafeInteger(index) && index >= 0 && index <= lastIndex)
            : []
        );
        state.completedStepIds = new Set(Array.isArray(saved.completedStepIds) ? saved.completedStepIds : []);
        state.completed = Boolean(saved.completed);
        state.sequential = saved.sequential !== false;
        mergeStudentAnswers(saved.lessonAnswers);
      }
    } catch {}
    applyNavigationPolicy();
    if (!progressApi) return isCurrentLessonLoad(requestId);
    try {
      await progressApi.load();
      if (!isCurrentLessonLoad(requestId)) return false;
      state.examProgressRefreshAt = Date.now();
      const record = progressApi.record(lessonMaterialId());
      const details = record?.details || {};
      mergeStudentAnswers(details.lessonAnswers, { respectPersistence: true });
      const currentIndex = state.lesson.slides.findIndex((slide) => slide.id === details.currentStepId);
      const highestIndex = state.lesson.slides.findIndex((slide) => slide.id === details.highestReachedStepId);
      if (currentIndex >= 0) state.index = currentIndex;
      if (highestIndex >= 0) state.maxReached = Math.max(state.index, highestIndex);
      state.completedStepIds = new Set(Array.isArray(details.completedStepIds) ? details.completedStepIds : []);
      state.solved = new Set(state.lesson.slides
        .map((slide, index) => slide.task && state.completedStepIds.has(slide.id) ? index : -1)
        .filter((index) => index >= 0));
      state.completed = record?.status === 'completed';
      applyNavigationPolicy();
    } catch (_) {
      // sessionStorage pozostaje wyłącznie awaryjnym cache'em interfejsu.
    }
    return isCurrentLessonLoad(requestId);
  }

  function applyNavigationPolicy() {
    const catalog = progressApi?.state?.catalog;
    const published = catalog?.nodes?.find((node) => node.id === lessonMaterialId())
      || catalog?.lessonManifests?.[navigationApi.materialId(state.repositoryId, state.filename)];
    const navigation = published?.settings?.steps?.length ? published.settings.navigation : state.lesson?.navigation;
    const result = navigationApi.policy(navigation, progressApi?.state?.preferences, state.isAdmin);
    state.sequential = result.sequential;
    state.navigationSource = result.source;
  }

  function stepAccess(index) {
    return navigationApi.stepOverride(state.lesson?.slides[index]?.id, progressApi?.state?.preferences, state.isAdmin);
  }

  function maySkipCurrent() {
    return !state.sequential || state.lesson?.slides[state.index]?.requiredToAdvance === false
      || stepAccess(state.index + 1) === 'allow';
  }

  function trackedSlides() {
    return state.lesson.slides.filter((slide) => slide.includeInLesson !== 'OFF');
  }

  function saveProgress(immediate = false, throwOnError = false) {
    if (!state.lesson) return Promise.resolve(null);
    try {
      sessionStorage.setItem(progressKey(), JSON.stringify({
        index: state.index,
        maxReached: state.maxReached,
        solved: [...state.solved],
        completedStepIds: [...state.completedStepIds],
        completed: state.completed,
        sequential: state.sequential,
        lessonAnswers: serializedStudentAnswers(),
        signature: state.lesson.signature
      }));
    } catch {}
    if (progressApi && lessonMaterialId()) {
      const slide = state.lesson.slides[state.index];
      const tracked = trackedSlides();
      const completedTrackedSteps = tracked.filter((step) => state.completedStepIds.has(step.id)).length;
      return progressApi.update({
        materialId: lessonMaterialId(),
        materialType: 'lesson',
        action: state.completed ? 'complete' : 'lesson_step',
        lastPosition: { stepId: slide?.id || '', stepIndex: state.index },
        details: {
          currentStepId: slide?.id || '',
          currentStepIndex: state.index,
          completedStepIds: [...state.completedStepIds],
          completedTrackedSteps,
          totalTrackedSteps: tracked.length,
          lessonAnswers: serializedStudentAnswers(true)
        }
      }, { immediate, debounceMs: 5_000, throwOnError });
    }
    return Promise.resolve(null);
  }

  function initializeTheme() {
    let theme = '';
    try { theme = localStorage.getItem('chem.theme') || ''; } catch {}
    if (!theme) {
      theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(theme);
  }

  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    elements.themeToggle.setAttribute('aria-pressed', String(dark));
    elements.themeToggle.setAttribute('aria-label', dark ? 'Włącz jasny motyw' : 'Włącz ciemny motyw');
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('chem.theme', next); } catch {}
  }

  function showError(title, message, canRetry = true) {
    elements.loading.hidden = true;
    elements.slideCard.hidden = true;
    elements.completion.hidden = true;
    elements.navigation.hidden = true;
    elements.error.hidden = false;
    elements.errorTitle.textContent = title;
    elements.errorMessage.textContent = message;
    elements.retry.hidden = !canRetry;
    elements.resetProgress.disabled = true;
    elements.lessonPosition.textContent = 'Błąd wczytywania';
    elements.app.removeAttribute('aria-busy');
  }

  function friendlyLoadError(error) {
    if (error?.code || error?.name === 'LessonFormatError') return error.message;
    if (error?.message === 'NOT_FOUND') return `Nie znaleziono lekcji „${state.filename}” w prywatnej bibliotece.`;
    if (error?.message === 'TOO_LARGE') return 'Plik lekcji jest zbyt duży.';
    return 'Sprawdź połączenie, nazwę pliku i spróbuj ponownie.';
  }

  async function loadLesson() {
    const requestId = ++state.loadRequestId;
    elements.app.setAttribute('aria-busy', 'true');
    elements.resetProgress.disabled = true;
    elements.loading.hidden = false;
    elements.error.hidden = true;
    elements.slideCard.hidden = true;
    elements.completion.hidden = true;
    elements.navigation.hidden = true;

    const filename = readFilename();
    const repositoryId = readRepositoryId();
    state.filename = filename;
    state.repositoryId = repositoryId;
    state.materialId = '';
    if (!filename) {
      if (state.isAdmin) {
        showError(
          'Wybierz lekcję z biblioteki',
          'Otwórz bibliotekę u góry i wybierz lekcję.',
          false
        );
        openLessonLibrary();
      } else {
        showError(
          'Nie wskazano lekcji',
          'Wróć do panelu kursu i otwórz przypisaną lekcję.',
          false
        );
      }
      return;
    }

    try {
      const markdown = await fetchLessonMarkdown(filename, repositoryId);
      if (!isCurrentLessonLoad(requestId)) return;
      state.lesson = parser.parseLesson(markdown, filename);
      state.index = 0;
      state.maxReached = 0;
      state.solved = new Set();
      state.completedStepIds = new Set();
      state.completed = false;
      state.sequential = true;
      state.attempts = new Map();
      state.studentAnswers = new Map();
      collectOpenAnswerMetadata();
      const progressLoaded = await loadProgress(requestId);
      if (!progressLoaded || !isCurrentLessonLoad(requestId)) return;
      updateSequenceControl();

      window.NextMedBrand ? window.NextMedBrand.setTitle(state.lesson.title) : (document.title = state.lesson.title + " — NextMed");
      elements.lessonTitle.textContent = state.lesson.title;
      buildOutline();
      elements.loading.hidden = true;
      elements.resetProgress.disabled = false;
      elements.app.removeAttribute('aria-busy');
      if (state.completed) showCompletion(false);
      else renderSlide();
    } catch (error) {
      if (!isCurrentLessonLoad(requestId)) return;
      console.error('Nie udało się wczytać lekcji', error);
      showError('Nie udało się wczytać lekcji', friendlyLoadError(error));
    }
  }

  async function fetchLessonMarkdown(filename, repositoryId) {
    const library = window.ChemContentLibrary;
    if (library && typeof library.readLesson === 'function') {
      try {
        const asset = await library.readLesson(filename, { repositoryId });
        return asset.content;
      } catch (error) {
        if (repositoryId) throw error;
        const mayUseBundledFallback = [
          'CONTENT_REPOSITORY_NOT_CONFIGURED',
          'CONTENT_DIRECTORY_NOT_FOUND',
          'CONTENT_FILE_NOT_FOUND'
        ].includes(error && error.code);
        if (!mayUseBundledFallback) throw error;
      }
    }
    const response = await fetch(`./${encodeURIComponent(filename)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/markdown,text/plain;q=0.9' }
    });
    if (response.status === 404) throw new Error('NOT_FOUND');
    if (!response.ok) throw new Error('FETCH_FAILED');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 512 * 1024) throw new Error('TOO_LARGE');
    return response.text();
  }

  async function openLessonLibrary() {
    if (!state.isAdmin) return;
    if (!elements.libraryDialog.open) {
      if (typeof elements.libraryDialog.showModal === 'function') elements.libraryDialog.showModal();
      else elements.libraryDialog.setAttribute('open', '');
    }
    elements.librarySearch.value = '';
    elements.librarySearch.focus();
    try {
      await loadRepositoryOptions();
    } catch (error) {
      elements.libraryStatus.className = 'lesson-library-status is-error';
      elements.libraryStatus.textContent = error && error.message
        ? error.message
        : 'Nie udało się wczytać bibliotek.';
      return;
    }
    if (state.libraryAssets.length) {
      renderLessonLibrary();
      return;
    }
    elements.libraryStatus.className = 'lesson-library-status is-loading';
    elements.libraryStatus.textContent = 'Pobieranie listy lekcji…';
    elements.libraryList.replaceChildren();
    try {
      state.libraryAssets = await window.ChemContentLibrary.list('lesson', {
        repositoryId: state.repositoryId
      });
      elements.libraryStatus.className = 'lesson-library-status';
      elements.libraryStatus.textContent = state.libraryAssets.length
        ? `${state.libraryAssets.length} lekcji w wybranej bibliotece.`
        : 'Repozytorium nie zawiera jeszcze lekcji.';
      renderLessonLibrary();
    } catch (error) {
      elements.libraryStatus.className = 'lesson-library-status is-error';
      elements.libraryStatus.textContent = error && error.message
        ? error.message
        : 'Nie udało się pobrać biblioteki.';
    }
  }

  async function loadRepositoryOptions() {
    if (!state.repositories.length) {
      state.repositories = await window.ChemContentLibrary.repositories();
    }
    if (!state.repositories.length) throw new Error('Biblioteka lekcji nie jest jeszcze dostępna. Skontaktuj się z prowadzącym.');
    const selected = state.repositories.find((repository) => repository.id === state.repositoryId)
      || state.repositories.find((repository) => repository.default)
      || state.repositories[0];
    state.repositoryId = selected.id;
    elements.libraryRepository.replaceChildren(
      ...state.repositories.map((repository) => {
        const option = document.createElement('option');
        option.value = repository.id;
        option.textContent = repository.label || repository.repository;
        return option;
      })
    );
    elements.libraryRepository.value = state.repositoryId;
  }

  function closeLessonLibrary() {
    if (typeof elements.libraryDialog.close === 'function') elements.libraryDialog.close();
    else elements.libraryDialog.removeAttribute('open');
  }

  function renderLessonLibrary() {
    const library = window.ChemContentLibrary;
    const assets = library.search(state.libraryAssets, elements.librarySearch.value);
    const fragment = document.createDocumentFragment();
    assets.forEach((asset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lesson-library-item';
      const icon = document.createElement('span');
      icon.className = 'lesson-library-icon';
      icon.textContent = 'L';
      icon.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = asset.title || asset.filename;
      const description = document.createElement('small');
      description.textContent = asset.description || asset.filename;
      copy.append(title, description);
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');
      button.append(icon, copy, arrow);
      button.addEventListener('click', () => selectLibraryLesson(asset));
      fragment.append(button);
    });
    if (!assets.length && state.libraryAssets.length) {
      const empty = document.createElement('p');
      empty.className = 'lesson-library-empty';
      empty.textContent = 'Nie znaleziono lekcji pasującej do wyszukiwania.';
      fragment.append(empty);
    }
    elements.libraryList.replaceChildren(fragment);
  }

  function selectLibraryLesson(asset) {
    if (!asset || !asset.filename) return;
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('file', asset.filename);
    if (asset.repositoryId) url.searchParams.set('repo', asset.repositoryId);
    window.history.pushState({}, '', url);
    closeLessonLibrary();
    loadLesson();
  }

  function buildOutline() {
    elements.outlineList.replaceChildren();
    state.lesson.slides.forEach((slide, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const marker = document.createElement('span');
      const label = document.createElement('span');
      marker.className = 'outline-marker';
      marker.textContent = String(index + 1);
      label.className = 'outline-label';
      label.textContent = slide.title;
      button.type = 'button';
      button.dataset.slideIndex = String(index);
      button.append(marker, label);
      button.addEventListener('click', () => {
        if (stepAccess(index) === 'deny' || (stepAccess(index) !== 'allow' && state.sequential && index > state.maxReached) || state.completed) return;
        if (index === state.index) return;
        const answerCommit = commitCurrentStudentAnswers({ focusInvalid: index > state.index });
        if (index > state.index && !answerCommit.valid && state.sequential && stepAccess(index) !== 'allow') {
          const current = state.lesson.slides[state.index];
          updateNavigationAccess(current, state.solved.has(state.index));
          return;
        }
        const completed = completeCurrentStepForNavigation();
        if (!completed && index > state.index && state.sequential && stepAccess(index) !== 'allow' && !maySkipCurrent()) return;
        state.index = index;
        state.maxReached = Math.max(state.maxReached, index);
        renderSlide();
      });
      item.appendChild(button);
      elements.outlineList.appendChild(item);
    });
  }

  function updateOutline() {
    elements.outlineList.querySelectorAll('button').forEach((button, index) => {
      const slide = state.lesson.slides[index];
      const accessible = stepAccess(index) !== 'deny' && (stepAccess(index) === 'allow' || !state.sequential || index <= state.maxReached) && !state.completed;
      const current = index === state.index && !state.completed;
      const complete = state.completedStepIds.has(slide.id) || state.solved.has(index);
      button.disabled = !accessible;
      button.classList.toggle('is-current', current);
      button.classList.toggle('is-complete', complete);
      if (current) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      const marker = button.querySelector('.outline-marker');
      if (marker) marker.textContent = complete ? '✓' : String(index + 1);
    });
  }

  function updateSequenceControl() {
    elements.sequenceToggle.checked = state.sequential;
    elements.sequenceToggle.disabled = !state.isAdmin;
    elements.sequenceToggleHint.textContent = state.isAdmin
      ? 'Administrator może pomijać kroki. Przełącznik służy tylko do podglądu trybu nauki.'
      : `${state.sequential ? 'Kroki odblokowują się po kolei.' : 'Możesz pomijać kroki; pominięcie nie zalicza zadania.'} ${state.navigationSource === 'user' ? 'Obowiązuje indywidualne ustawienie z panelu Postępy.' : 'Obowiązuje ustawienie autora lekcji.'}`;
    elements.outlineTipCopy.textContent = state.sequential
      ? 'Zadanie trzeba rozwiązać, aby odblokować kolejny krok.'
      : 'Możesz przejść dalej i wrócić do trudnego zadania później.';
  }

  function updateNavigationAccess(slide, isSolved) {
    const examGate = currentExamGate();
    const answerGate = studentAnswerGate();
    const taskBlocked = Boolean(slide.task && !isSolved);
    const nextLocked = state.index < state.lesson.slides.length - 1 && stepAccess(state.index + 1) === 'deny';
    const blocked = nextLocked || (!maySkipCurrent() && (!answerGate.satisfied || (state.sequential && (taskBlocked || !examGate.satisfied))));
    elements.next.disabled = blocked;
    elements.navigationHint.textContent = blocked
      ? (nextLocked ? 'Następny krok jest zablokowany przez administratora.' : !answerGate.satisfied
        ? answerGate.message
        : (!examGate.satisfied
          ? examGate.message
          : 'Najpierw rozwiąż zadanie, aby odblokować następny krok.'))
      : slide.task && !isSolved
        ? 'Możesz pominąć to zadanie i wrócić do niego później.'
        : '';
    if (!slide.task && elements.slideContent.querySelector('.lesson-student-answer')) {
      elements.slideStatus.textContent = answerGate.satisfied ? 'Odpowiedź gotowa' : 'Odpowiedź wymagana';
      elements.slideStatus.dataset.state = answerGate.satisfied ? 'complete' : 'task';
    } else if (!slide.task && elements.slideContent.querySelector('.lesson-answer-review')) {
      elements.slideStatus.textContent = 'Omówienie odpowiedzi';
      elements.slideStatus.dataset.state = 'content';
    }
    if (!blocked && isSolved) {
      elements.next.classList.add('is-unlocked-pulse');
      setTimeout(() => elements.next.classList.remove('is-unlocked-pulse'), 1000);
    }
    updateOutline();
  }

  function triggerLockShake() {
    const target = elements.taskHost || elements.slideContent || elements.next;
    if (!target) return;
    target.classList.remove('is-locked-shake');
    void target.offsetWidth;
    target.classList.add('is-locked-shake');
    setTimeout(() => target.classList.remove('is-locked-shake'), 600);
  }

  function toggleSequentialLearning() {
    if (!state.isAdmin) { updateSequenceControl(); return; }
    state.sequential = elements.sequenceToggle.checked;
    if (state.sequential) state.maxReached = Math.max(state.maxReached, state.index);
    updateSequenceControl();
    const slide = state.lesson && state.lesson.slides[state.index];
    if (slide) updateNavigationAccess(slide, state.solved.has(state.index));
    saveProgress();
  }

  function completeCurrentStepForNavigation() {
    const slide = state.lesson?.slides?.[state.index];
    if (!slide) return false;
    if (!studentAnswerGate().satisfied) return false;
    if (!currentExamGate().satisfied) return false;
    if (slide.task && !state.solved.has(state.index)) return false;
    state.completedStepIds.add(slide.id);
    return true;
  }

  function renderSlide() {
    const slide = state.lesson.slides[state.index];
    const isSolved = state.solved.has(state.index);
    const tracked = trackedSlides();
    const completedTracked = tracked.filter((step) => state.completedStepIds.has(step.id)).length;
    const progress = tracked.length ? (completedTracked / tracked.length) * 100 : 0;

    elements.error.hidden = true;
    elements.completion.hidden = true;
    elements.slideCard.hidden = false;
    elements.navigation.hidden = false;
    elements.slideNumber.textContent = `Krok ${state.index + 1} z ${state.lesson.slides.length}`;
    elements.lessonPosition.textContent = `Krok ${state.index + 1} z ${state.lesson.slides.length}`;
    elements.progressBar.style.width = `${progress}%`;
    elements.slideCard.dataset.lessonBackground = [
      'default', 'paper', 'grid', 'dots', 'mint', 'sky', 'lavender', 'sand', 'gradient', 'night', 'custom'
    ].includes(slide.background) ? slide.background : 'default';
    elements.slideCard.dataset.lessonDecoration = ['none', 'molecules', 'bubbles', 'glow'].includes(slide.decoration)
      ? slide.decoration
      : 'none';
    elements.slideCard.dataset.lessonTone = ['auto', 'dark', 'light'].includes(slide.textTone)
      ? slide.textTone
      : 'auto';
    elements.slideCard.style.setProperty('--lesson-slide-color', slide.backgroundColor || '#f8fafc');
    clearTypesetMath(elements.slideContent);
    state.mediaObjectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    elements.slideContent.classList.toggle('is-canvas-layout', slide.layout === 'canvas');
    elements.slideContent.innerHTML = slide.html;
    decorateLessonModuleLinks(elements.slideContent);
    initializeInteractiveBlocks(elements.slideContent);
    void hydrateManagedImages(elements.slideContent);
    scheduleLessonImagePrefetch();
    typesetMath(elements.slideContent);
    elements.slideStatus.textContent = slide.task
      ? (isSolved ? 'Zadanie rozwiązane' : 'Zadanie do wykonania')
      : 'Materiał';
    elements.slideStatus.dataset.state = isSolved ? 'complete' : (slide.task ? 'task' : 'content');

    renderTask(slide.task, isSolved);
    playSlideTransition(slide.transition);
    elements.previous.disabled = state.index === 0;
    elements.next.querySelector('span').textContent =
      state.index === state.lesson.slides.length - 1 ? 'Zakończ lekcję' : 'Dalej';
    updateNavigationAccess(slide, isSolved);
    saveProgress();
    elements.slideCard.focus?.({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function hydrateManagedImages(root) {
    const library = window.ChemContentLibrary;
    const figures = Array.from(root.querySelectorAll('[data-lesson-media-ref]'));
    const showError = (figure, error) => {
      if (!figure.isConnected) return;
      figure.classList.add('is-error');
      const placeholder = document.createElement('div');
      const message = document.createElement('small');
      const retry = document.createElement('button');
      placeholder.className = 'lesson-managed-image-placeholder';
      message.textContent = error?.code === 'CONTENT_FILE_NOT_FOUND'
        ? 'Nie znaleziono pliku obrazu w folderze tej lekcji.'
        : 'Nie udało się wczytać obrazu.';
      retry.className = 'lesson-image-retry';
      retry.type = 'button';
      retry.textContent = 'Spróbuj ponownie';
      retry.addEventListener('click', () => {
        retry.disabled = true;
        message.textContent = 'Ponowne wczytywanie…';
        void loadFigure(figure, true);
      });
      placeholder.append(message, retry);
      figure.replaceChildren(placeholder);
    };
    const loadFigure = async (figure, bypassCache = false, position = 0) => {
      const reference = figure.dataset.lessonMediaRef || '';
      try {
        const blob = await library.readMediaBlob({
          scope: figure.dataset.lessonMediaScope === 'shared' ? 'shared' : 'local',
          materialKind: figure.dataset.lessonMediaScope === 'shared' ? '' : 'lesson',
          materialId: figure.dataset.lessonMediaScope === 'shared'
            ? ''
            : (figure.dataset.lessonMediaOwner || state.filename),
          reference,
          repositoryId: figure.dataset.lessonMediaRepository || state.repositoryId
        }, { bypassCache });
        if (!figure.isConnected) return;
        const objectUrl = URL.createObjectURL(blob);
        const image = document.createElement('img');
        image.src = objectUrl;
        image.alt = figure.dataset.lessonMediaAlt || 'Ilustracja';
        image.loading = position < 2 ? 'eager' : 'lazy';
        image.decoding = 'async';
        image.fetchPriority = position === 0 ? 'high' : 'auto';
        try { void image.decode?.().catch(() => undefined); } catch { /* dekodowanie dokończy się przy malowaniu */ }
        if (!figure.isConnected) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        state.mediaObjectUrls.push(objectUrl);
        figure.classList.remove('is-error');
        figure.replaceChildren(image);
      } catch (error) {
        showError(figure, error);
      }
    };
    if (!library?.readMediaBlob) {
      figures.forEach((figure) => showError(figure, { code: 'MEDIA_CLIENT_UNAVAILABLE' }));
      return;
    }
    let nextFigure = 0;
    const worker = async () => {
      while (nextFigure < figures.length) {
        const position = nextFigure;
        nextFigure += 1;
        if (!figures[position].isConnected) continue;
        await loadFigure(figures[position], false, position);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, figures.length) }, worker));
  }

  function scheduleLessonImagePrefetch() {
    const library = window.ChemContentLibrary;
    if (!library?.readMediaBlob || !state.lesson?.slides?.length) return;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection?.saveData || /(?:^|-)2g$/i.test(connection?.effectiveType || '')) return;
    const unique = new Map();
    // The current slide is already loading. Warm only the next one so
    // prefetch cannot compete with visible images or spend dozens of calls.
    const orderedSlides = state.lesson.slides.slice(state.index + 1, state.index + 2);
    orderedSlides.forEach((slide) => {
      if (unique.size >= 4 || !slide?.html?.includes('data-lesson-media-ref')) return;
      const template = document.createElement('template');
      template.innerHTML = slide.html;
      template.content.querySelectorAll('[data-lesson-media-ref]').forEach((figure) => {
        if (unique.size >= 4) return;
        const shared = figure.dataset.lessonMediaScope === 'shared';
        const input = {
          scope: shared ? 'shared' : 'local',
          materialKind: shared ? '' : 'lesson',
          materialId: shared ? '' : (figure.dataset.lessonMediaOwner || state.filename),
          reference: figure.dataset.lessonMediaRef || '',
          repositoryId: figure.dataset.lessonMediaRepository || state.repositoryId
        };
        unique.set([
          input.repositoryId, input.scope, input.materialId, input.reference
        ].join(':'), input);
      });
    });
    if (!unique.size) return;
    const preload = async () => {
      const images = [...unique.values()];
      for (let index = 0; index < images.length; index += 4) {
        await Promise.allSettled(images.slice(index, index + 4).map((input) => library.readMediaBlob(input)));
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => { void preload(); }, { timeout: 1_500 });
    } else {
      window.setTimeout(() => { void preload(); }, 250);
    }
  }

  function playSlideTransition(value) {
    const transition = ['none', 'fade', 'rise', 'slide', 'zoom'].includes(value)
      ? value
      : 'fade';
    elements.slideCard.dataset.transition = transition;
    elements.slideCard.classList.remove('is-entering');
    if (transition === 'none') return;
    void elements.slideCard.offsetWidth;
    elements.slideCard.classList.add('is-entering');
  }

  function clearTypesetMath(root) {
    const formulas = root
      ? Array.from(root.querySelectorAll('.lesson-formula-display'))
      : [];
    if (!formulas.length) return;
    try {
      window.MathJax?.typesetClear?.(formulas);
    } catch (_) {
      // Wzory są dodatkiem i nie mogą zablokować całej lekcji.
    }
  }

  function typesetMath(root) {
    const mathJax = window.MathJax;
    const formulas = root
      ? Array.from(root.querySelectorAll('.lesson-formula-display'))
      : [];
    if (!formulas.length || !mathJax || typeof mathJax.typesetPromise !== 'function') return;
    const startup = mathJax.startup?.promise || Promise.resolve();
    const previous = window.__chemDiskMathPromise || startup;
    window.__chemDiskMathPromise = previous
      .catch(() => undefined)
      .then(() => mathJax.typesetPromise(formulas))
      .catch(() => undefined);
  }

  function currentTaskAiResponse(task, root = elements.taskHost) {
    if (!task || !root) return '';
    if (task.type === 'gaps' || task.type === 'gaps-text') {
      return Array.from(root.querySelectorAll('.gap-exercise select, .gap-exercise input'))
        .map((field) => field.value || '');
    }
    if (task.type === 'choice') {
      const selected = root.querySelector('input[type="radio"]:checked');
      if (!selected) return '';
      const copy = selected.closest('label')?.querySelector('.choice-copy')?.textContent?.trim() || '';
      return copy && copy !== selected.value ? `${selected.value} — ${copy}` : selected.value;
    }
    return root.querySelector('.task-controls input')?.value || '';
  }

  function aiAuthorContext(card) {
    const raw = card?.dataset.aiAuthorContext || '';
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : '';
    } catch (_) {
      return raw;
    }
  }

  function slideAiContext(root, card) {
    const task = state.lesson?.slides?.[state.index]?.task || null;
    if (typeof window.ChemLesson?.buildLessonAiContext === 'function') {
      return window.ChemLesson.buildLessonAiContext({
        root,
        task,
        currentResponse: currentTaskAiResponse(task),
        authorContext: aiAuthorContext(card),
        includeSlide: card?.dataset.aiIncludeSlide !== 'false',
        includeTask: card?.dataset.aiIncludeTask !== 'false'
      });
    }
    return String(root?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
  }

  function openSlideAiHelp(button, root) {
    const card = button.closest('.lesson-ai-help');
    if (!card) return;

    const url = new URL('/members/module/chat/', window.location.origin);
    const prompt = card.dataset.aiPrompt || '';
    const repository = card.dataset.aiRepository || '';
    const point = card.dataset.aiPoint || '1';
    if (/\.json$/i.test(prompt)) url.searchParams.set('prompt', prompt);
    if (/\.txt$/i.test(prompt)) {
      url.searchParams.set('plik', prompt);
      url.searchParams.set('punkt', point);
    }
    if (repository) url.searchParams.set('repo', repository);
    const returnUrl = lessonReturnUrl();
    if (returnUrl) url.searchParams.set('lesson_return', returnUrl);

    try {
      const contextId = typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const context = slideAiContext(root, card);
      if (context) {
        const slideTitle = root.querySelector('h1, h2, h3')?.textContent?.trim()
          || state.lesson?.title
          || state.filename
          || 'Lekcja';
        localStorage.setItem(`chem.lesson-ai-context.${contextId}`, JSON.stringify({
          context,
          title: slideTitle.slice(0, 180),
          createdAt: Date.now()
        }));
        url.searchParams.set('lesson_context', contextId);
      }
    } catch (_) {
      // Czat nadal może zostać otwarty bez automatycznego kontekstu.
    }

    window.open(url.toString(), '_blank', 'noopener');
  }

  function answerField(card) {
    return card?.querySelector('[data-student-answer-input], textarea, input[type="text"]') || null;
  }

  function setStudentAnswerStatus(card, status, message) {
    const element = card?.querySelector('[data-student-answer-status]');
    if (!element) return;
    element.dataset.state = status || '';
    element.textContent = message || '';
    element.hidden = !message;
  }

  function updateStudentAnswerCount(card) {
    const field = answerField(card);
    const counter = card?.querySelector('[data-student-answer-count]');
    if (!field || !counter) return;
    const maximum = Math.max(0, Math.floor(Number(card.dataset.maxLength) || 0));
    counter.textContent = maximum
      ? `${field.value.length} / ${maximum}`
      : `${field.value.length} znaków`;
  }

  function studentAnswerGate(root = elements.slideContent) {
    const cards = Array.from(root?.querySelectorAll?.('.lesson-student-answer[data-question-id]') || []);
    for (const card of cards) {
      if (!booleanData(card, ['required'], false)) continue;
      const questionId = validQuestionId(card.dataset.questionId);
      const field = answerField(card);
      const answer = field ? field.value : (state.studentAnswers.get(questionId)?.answer || '');
      if (!String(answer).trim()) {
        return {
          satisfied: false,
          card,
          field,
          message: 'Wpisz i zapisz odpowiedź, aby przejść dalej.'
        };
      }
    }
    return { satisfied: true, card: null, field: null, message: '' };
  }

  function reviewResultPanel(card) {
    let panel = card.querySelector('[data-answer-review-result]');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.className = 'lesson-answer-ai-result';
    panel.dataset.answerReviewResult = '';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.hidden = true;
    const status = card.querySelector('[data-answer-review-status]');
    if (status) status.insertAdjacentElement('afterend', panel);
    else card.appendChild(panel);
    return panel;
  }

  function setReviewStatus(card, status, message) {
    const element = card.querySelector('[data-answer-review-status]');
    if (!element) return;
    element.dataset.state = status || '';
    element.textContent = message || '';
    element.hidden = !message;
  }

  function renderReviewAiResult(card, response) {
    const panel = reviewResultPanel(card);
    const heading = document.createElement('h4');
    const copy = document.createElement('div');
    heading.textContent = 'Analiza AI';
    copy.className = 'lesson-answer-ai-copy';
    copy.textContent = response;
    panel.replaceChildren(heading, copy);
    panel.hidden = false;
  }

  function clearReviewAiResult(card) {
    const panel = card.querySelector('[data-answer-review-result]');
    if (!panel) return;
    panel.replaceChildren();
    panel.hidden = true;
  }

  function updateAnswerReviewBlock(card) {
    const questionId = validQuestionId(card.dataset.questionId);
    if (!questionId) return;
    const record = state.studentAnswers.get(questionId) || null;
    const answer = record?.answer || '';
    const hasAnswer = Boolean(answer.trim());
    const display = card.querySelector('[data-student-answer-display]');
    const showAnswer = booleanData(card, ['showStudentAnswer'], true);
    if (display) {
      display.textContent = hasAnswer ? answer : 'Nie zapisano jeszcze odpowiedzi.';
      display.dataset.state = hasAnswer ? 'answered' : 'empty';
      const section = display.closest('[data-student-answer-section], .lesson-answer-review-student');
      if (section) section.hidden = !showAnswer;
      else display.hidden = !showAnswer;
    }

    const aiEnabled = booleanData(card, ['aiEnabled'], false);
    const button = card.querySelector('[data-answer-review-ai]');
    if (button) {
      button.hidden = !aiEnabled;
      button.disabled = !hasAnswer || card.dataset.aiState === 'loading';
      button.textContent = record?.aiUsed && record.aiCheckedAnswerVersion === record.version
        ? '✨ Zapytaj AI ponownie'
        : '✨ Zapytaj AI';
    }
    if (!aiEnabled || card.dataset.aiState === 'loading') return;

    const currentAnalysis = Boolean(
      hasAnswer
      && record?.aiUsed
      && record.aiCheckedAnswerVersion === record.version
      && record.aiResponse
    );
    if (currentAnalysis) {
      renderReviewAiResult(card, record.aiResponse);
      setReviewStatus(card, 'success', 'Analiza dotyczy najnowszej zapisanej odpowiedzi.');
      return;
    }
    clearReviewAiResult(card);
    if (!hasAnswer) {
      setReviewStatus(card, 'empty', 'Najpierw zapisz odpowiedź na powiązanym slajdzie.');
    } else if (record?.aiUsed || record?.aiResponse) {
      setReviewStatus(card, 'stale', 'Poprzednia analiza jest nieaktualna. Jeśli chcesz, uruchom AI ponownie.');
    } else {
      setReviewStatus(card, '', '');
    }
  }

  function updateAnswerReviewBlocks(root = elements.slideContent, questionId = '') {
    root?.querySelectorAll?.('.lesson-answer-review[data-question-id]').forEach((card) => {
      if (questionId && card.dataset.questionId !== questionId) return;
      updateAnswerReviewBlock(card);
    });
  }

  function markAnswerReviewDraftStale(questionId, hasDraft) {
    elements.slideContent.querySelectorAll('.lesson-answer-review[data-question-id]').forEach((card) => {
      if (card.dataset.questionId !== questionId || card.dataset.aiState === 'loading') return;
      clearReviewAiResult(card);
      if (hasDraft) {
        setReviewStatus(card, 'stale', 'Zapisz zmienioną odpowiedź, aby porównać jej najnowszą wersję.');
      } else {
        updateAnswerReviewBlock(card);
      }
    });
  }

  function commitStudentAnswerCard(card, options = {}) {
    const questionId = validQuestionId(card?.dataset.questionId);
    const field = answerField(card);
    if (!questionId || !field) return { valid: true, changed: false, persistent: false, record: null };
    const maximum = Math.max(0, Math.min(
      LESSON_ANSWER_LIMIT,
      Math.floor(Number(card.dataset.maxLength) || 0) || LESSON_ANSWER_LIMIT
    ));
    const answer = String(field.value || '').slice(0, maximum);
    if (field.value !== answer) field.value = answer;
    const required = booleanData(card, ['required'], false);
    if (required && !answer.trim()) {
      field.setAttribute('aria-invalid', 'true');
      setStudentAnswerStatus(card, 'error', 'To pytanie wymaga odpowiedzi przed przejściem dalej.');
      if (options.focusInvalid) field.focus();
      return { valid: false, changed: false, persistent: false, record: null };
    }

    const previous = state.studentAnswers.get(questionId) || null;
    const persistent = state.answerPersistence.get(questionId) !== false;
    if (!previous && !answer) {
      setStudentAnswerStatus(card, '', '');
      return { valid: true, changed: false, persistent, record: null };
    }
    if (previous?.answer === answer) {
      field.removeAttribute('aria-invalid');
      setStudentAnswerStatus(
        card,
        'saved',
        persistent ? 'Odpowiedź jest zapisana.' : 'Odpowiedź jest zachowana w tej karcie przeglądarki.'
      );
      return { valid: true, changed: false, persistent, record: previous };
    }

    const now = new Date().toISOString();
    const record = {
      answer,
      answeredAt: previous?.answeredAt || (answer.trim() ? now : ''),
      updatedAt: now,
      version: Math.max(0, Number(previous?.version) || 0) + 1,
      aiUsed: false,
      aiCheckedAnswerVersion: 0,
      aiResponse: '',
      aiCheckedAt: ''
    };
    state.studentAnswers.set(questionId, record);
    field.removeAttribute('aria-invalid');
    card.dataset.answerState = answer.trim() ? 'saved' : 'empty';
    setStudentAnswerStatus(
      card,
      'saved',
      persistent ? 'Odpowiedź zapisana.' : 'Odpowiedź zachowana w tej karcie przeglądarki.'
    );
    if (!booleanData(card, ['allowEdit'], true) && answer.trim()) {
      field.readOnly = true;
      const saveButton = card.querySelector('[data-student-answer-save]');
      if (saveButton) saveButton.disabled = true;
    }
    updateStudentAnswerCount(card);
    updateAnswerReviewBlocks(elements.slideContent, questionId);
    return { valid: true, changed: true, persistent, record };
  }

  function commitCurrentStudentAnswers(options = {}) {
    const cards = Array.from(elements.slideContent.querySelectorAll('.lesson-student-answer[data-question-id]'));
    let valid = true;
    let changed = false;
    let persistentChange = false;
    for (const card of cards) {
      const result = commitStudentAnswerCard(card, { focusInvalid: options.focusInvalid && valid });
      if (!result.valid) valid = false;
      changed = changed || result.changed;
      persistentChange = persistentChange || (result.changed && result.persistent);
    }
    return { valid, changed, persistentChange };
  }

  function initializeStudentAnswerBlocks(root) {
    root.querySelectorAll('.lesson-student-answer[data-question-id]').forEach((card) => {
      const questionId = validQuestionId(card.dataset.questionId);
      const field = answerField(card);
      if (!questionId || !field) return;
      state.answerPersistence.set(questionId, booleanData(card, ['persist', 'saveToProgress'], true));
      const question = String(card.dataset.question || '').trim();
      if (question) state.answerQuestions.set(questionId, question);

      const maximum = Math.max(0, Math.min(LESSON_ANSWER_LIMIT, Math.floor(Number(card.dataset.maxLength) || 0)));
      if (maximum) field.maxLength = maximum;
      else field.maxLength = LESSON_ANSWER_LIMIT;
      if (field.tagName === 'TEXTAREA') {
        const minimumHeight = Math.max(80, Math.min(800, Math.floor(Number(card.dataset.minHeight) || 180)));
        field.style.minHeight = `${minimumHeight}px`;
      }

      const record = state.studentAnswers.get(questionId) || null;
      field.value = record?.answer || '';
      const editable = booleanData(card, ['allowEdit'], true);
      const saveButton = card.querySelector('[data-student-answer-save]');
      if (record?.answer?.trim() && !editable) {
        field.readOnly = true;
        if (saveButton) saveButton.disabled = true;
      }
      card.dataset.answerState = record?.answer?.trim() ? 'saved' : 'empty';
      if (record?.answer?.trim()) {
        setStudentAnswerStatus(
          card,
          'saved',
          state.answerPersistence.get(questionId) === false
            ? 'Przywrócono odpowiedź z tej sesji.'
            : 'Przywrócono zapisaną odpowiedź.'
        );
      } else {
        setStudentAnswerStatus(card, '', '');
      }
      updateStudentAnswerCount(card);

      field.addEventListener('input', () => {
        const stored = state.studentAnswers.get(questionId)?.answer || '';
        const changed = field.value !== stored;
        field.removeAttribute('aria-invalid');
        card.dataset.answerState = changed ? 'dirty' : (stored ? 'saved' : 'empty');
        setStudentAnswerStatus(card, changed ? 'dirty' : 'saved', changed ? 'Niezapisane zmiany.' : 'Odpowiedź jest zapisana.');
        updateStudentAnswerCount(card);
        markAnswerReviewDraftStale(questionId, changed);
        const slide = state.lesson?.slides?.[state.index];
        if (slide) updateNavigationAccess(slide, state.solved.has(state.index));
      });

      if (!booleanData(card, ['multiline'], true)) {
        field.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          saveButton?.click();
        });
      }

      saveButton?.addEventListener('click', async () => {
        const result = commitStudentAnswerCard(card, { focusInvalid: true });
        const slide = state.lesson?.slides?.[state.index];
        if (slide) updateNavigationAccess(slide, state.solved.has(state.index));
        if (!result.valid || !result.changed) return;
        if (!result.persistent) {
          saveProgress();
          return;
        }
        saveButton.disabled = true;
        setStudentAnswerStatus(card, 'saving', 'Zapisywanie odpowiedzi…');
        try {
          await saveProgress(true, true);
          setStudentAnswerStatus(card, 'saved', 'Odpowiedź zapisana w postępie lekcji.');
        } catch (_) {
          setStudentAnswerStatus(card, 'error', 'Odpowiedź jest zapisana na tym urządzeniu. Synchronizacja zostanie ponowiona.');
        } finally {
          if (booleanData(card, ['allowEdit'], true)) saveButton.disabled = false;
        }
      });
    });
  }

  function answerKeyAiText(card) {
    const key = card.querySelector('.lesson-answer-key');
    if (!key) return '';
    if (typeof window.ChemLesson?.buildLessonAiContext === 'function') {
      const context = window.ChemLesson.buildLessonAiContext({
        root: key,
        task: null,
        currentResponse: '',
        authorContext: '',
        includeSlide: true,
        includeTask: false
      });
      if (context) return String(context).slice(0, 10_000);
    }
    return String(key.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 10_000);
  }

  function friendlyAnswerReviewAiError(status, code) {
    if (status === 401) return 'Sesja wygasła. Zaloguj się ponownie i spróbuj jeszcze raz.';
    if (status === 403 && code === 'AI_DISABLED_FOR_USER') return 'Administrator wyłączył dostęp do AI dla tego konta.';
    if (status === 403 && code === 'AI_PERMISSION_DENIED') return 'Klucz API nie ma uprawnień do wybranego modelu lub projektu.';
    if (status === 403) return 'To konto nie ma dostępu do AI.';
    if (status === 429) {
      if (code === 'AI_RATE_LIMITED') return 'Dostawca AI chwilowo ogranicza ruch. Spróbuj ponownie później.';
      if (code === 'AI_CONCURRENT_REQUEST_LIMIT_REACHED') return 'Trwa zbyt wiele równoległych analiz. Spróbuj ponownie za chwilę.';
      if (/_LIMIT_REACHED$/.test(code)) return 'Wykorzystano dostępny limit AI na platformie.';
      return 'Przekroczono chwilowy limit AI. Spróbuj ponownie później.';
    }
    const messages = {
      AI_NOT_CONFIGURED: 'AI nie zostało jeszcze skonfigurowane przez administratora.',
      SERVICE_UNAVAILABLE: 'AI nie zostało jeszcze skonfigurowane przez administratora.',
      AI_INVALID_KEY: 'Klucz dostawcy AI wymaga poprawienia przez administratora.',
      AI_MODEL_UNAVAILABLE: 'Wybrany model AI jest obecnie niedostępny.',
      AI_CREDIT_BALANCE_EXHAUSTED: 'Na koncie OpenAI zabrakło środków API.',
      AI_ORGANIZATION_SPEND_LIMIT_REACHED: 'Organizacja OpenAI osiągnęła ustawiony limit wydatków.',
      AI_PROJECT_SPEND_LIMIT_REACHED: 'Projekt OpenAI osiągnął ustawiony limit wydatków.',
      AI_ORGANIZATION_USAGE_LIMIT_REACHED: 'Organizacja OpenAI osiągnęła przyznany limit użycia API.',
      AI_QUOTA_EXHAUSTED: 'Konto OpenAI nie ma dostępnego limitu API.',
      AI_PERMISSION_DENIED: 'Klucz API nie ma uprawnień do wybranego modelu lub projektu.',
      AI_PROVIDER_TIMEOUT: 'Dostawca AI nie odpowiedział w ciągu 45 sekund.',
      AI_PROVIDER_ERROR: 'Dostawca AI jest chwilowo niedostępny.',
      AI_LIMIT_STORAGE_UNAVAILABLE: 'Nie można teraz bezpiecznie sprawdzić limitu AI.',
      AI_USAGE_RECORD_FAILED: 'Nie udało się bezpiecznie zapisać użycia AI.',
      INVALID_LESSON_ANSWER_REVIEW: 'Nie udało się przygotować danych odpowiedzi do analizy.',
      LESSON_ANSWER_REVIEW_INVALID: 'Nie udało się przygotować danych odpowiedzi do analizy.',
      EMPTY_MODEL_RESPONSE: 'AI nie zwróciło odpowiedzi. Spróbuj ponownie.'
    };
    return messages[code] || `Nie udało się przeprowadzić analizy AI${status ? ` (błąd ${status})` : ''}.`;
  }

  async function requestAnswerReviewAi(card, record) {
    const auth = window.ChemAuth;
    if (!auth || typeof auth.getAccessToken !== 'function') {
      throw new Error('Sesja wygasła. Zaloguj się ponownie.');
    }
    let token = '';
    try {
      token = await auth.getAccessToken({ forceRefresh: true });
    } catch (_) {
      throw new Error('Nie udało się odświeżyć sesji. Zaloguj się ponownie.');
    }
    const questionId = validQuestionId(card.dataset.questionId);
    const payload = {
      messages: [{ role: 'user', content: 'Oceń moją odpowiedź względem klucza odpowiedzi.' }],
      promptConfig: null,
      attachmentInline: null,
      options: { temperature: 0.1 },
      lessonAnswerReview: {
        questionId,
        question: String(card.dataset.question || state.answerQuestions.get(questionId) || '').slice(0, 8_000),
        studentAnswer: record.answer.slice(0, LESSON_ANSWER_LIMIT),
        answerKey: answerKeyAiText(card),
        aiInstruction: String(card.dataset.aiInstruction || '').slice(0, 2_000)
      }
    };
    const response = await fetch('/.netlify/functions/chat', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    let body = null;
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) {
      const code = typeof body?.error === 'string' ? body.error : '';
      const error = new Error(friendlyAnswerReviewAiError(response.status, code));
      error.code = code;
      error.status = response.status;
      throw error;
    }
    const text = String(body?.text || '').trim();
    if (!text) throw new Error('AI nie zwróciło odpowiedzi. Spróbuj ponownie.');
    return text.slice(0, LESSON_AI_RESPONSE_LIMIT);
  }

  async function analyzeAnswerReview(card) {
    if (card.dataset.aiState === 'loading' || !booleanData(card, ['aiEnabled'], false)) return;
    commitCurrentStudentAnswers();
    const questionId = validQuestionId(card.dataset.questionId);
    const record = state.studentAnswers.get(questionId);
    if (!questionId || !record?.answer.trim()) {
      updateAnswerReviewBlock(card);
      return;
    }
    const button = card.querySelector('[data-answer-review-ai]');
    const version = record.version;
    card.dataset.aiState = 'loading';
    if (button) button.disabled = true;
    clearReviewAiResult(card);
    setReviewStatus(card, 'loading', 'AI analizuje Twoją odpowiedź…');
    try {
      const response = await requestAnswerReviewAi(card, record);
      const latest = state.studentAnswers.get(questionId);
      if (!latest || latest.version !== version || latest.answer !== record.answer) {
        setReviewStatus(card, 'stale', 'Odpowiedź zmieniła się podczas analizy. Wynik nie został zapisany.');
        return;
      }
      const updated = {
        ...latest,
        aiUsed: true,
        aiCheckedAnswerVersion: latest.version,
        aiResponse: response,
        aiCheckedAt: new Date().toISOString()
      };
      state.studentAnswers.set(questionId, updated);
      renderReviewAiResult(card, response);
      setReviewStatus(card, 'success', 'Analiza dotyczy najnowszej zapisanej odpowiedzi.');
      try {
        await saveProgress(true, true);
      } catch (_) {
        setReviewStatus(card, 'error', 'Analiza jest widoczna, ale nie udało się zsynchronizować jej z postępem.');
      }
    } catch (error) {
      clearReviewAiResult(card);
      setReviewStatus(card, 'error', error?.message || 'Nie udało się przeprowadzić analizy AI.');
    } finally {
      card.dataset.aiState = '';
      if (button) {
        const latest = state.studentAnswers.get(questionId);
        button.disabled = !(latest?.answer || '').trim();
        button.textContent = latest?.aiUsed && latest.aiCheckedAnswerVersion === latest.version
          ? '✨ Zapytaj AI ponownie'
          : '✨ Zapytaj AI';
      }
    }
  }

  function initializeAnswerReviewBlocks(root) {
    root.querySelectorAll('.lesson-answer-review[data-question-id]').forEach((card) => {
      updateAnswerReviewBlock(card);
      const button = card.querySelector('[data-answer-review-ai]');
      button?.addEventListener('click', () => { void analyzeAnswerReview(card); });
    });
  }

  function initializeInteractiveBlocks(root) {
    initializeExamBlocks(root);
    initializeStudentAnswerBlocks(root);
    initializeAnswerReviewBlocks(root);
    root.querySelectorAll('.lesson-flashcard').forEach((card) => {
      card.addEventListener('click', () => {
        const flipped = card.getAttribute('aria-pressed') !== 'true';
        card.setAttribute('aria-pressed', String(flipped));
        card.classList.toggle('is-flipped', flipped);
      });
    });
    root.querySelectorAll('.lesson-atonom-open').forEach((button) => {
      button.addEventListener('click', () => {
        const figure = button.closest('.lesson-atonom');
        const frameHost = figure?.querySelector('.lesson-atonom-frame');
        if (!frameHost) return;
        const expanded = button.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          frameHost.replaceChildren();
          frameHost.hidden = true;
          button.setAttribute('aria-expanded', 'false');
          button.textContent = 'Pokaż związek';
          return;
        }
        const iframe = frameHost.ownerDocument.createElement('iframe');
        iframe.src = button.dataset.atonomSrc;
        iframe.title = button.dataset.atonomTitle || 'Interaktywny model cząsteczki';
        iframe.loading = 'lazy';
        iframe.setAttribute('allow', 'fullscreen');
        frameHost.replaceChildren(iframe);
        frameHost.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        button.textContent = 'Ukryj model';
      });
    });
    root.querySelectorAll('[data-lesson-ai-open]').forEach((button) => {
      button.addEventListener('click', () => openSlideAiHelp(button, root));
    });
  }

  function examGateFor(card) {
    const requirement = card?.dataset.examRequirement || 'optional';
    if (requirement === 'optional') return { satisfied: true, message: '' };
    const record = progressApi?.record(card.dataset.examMaterial) || null;
    const score = Number(record?.details?.scorePercent);
    if (requirement === 'completed' && record?.status === 'completed') {
      return { satisfied: true, message: 'Egzamin ukończony.' };
    }
    if (requirement === 'passed' && record?.status === 'completed' && record?.details?.passed === true) {
      return { satisfied: true, message: 'Egzamin zaliczony.' };
    }
    const minimum = Math.max(0, Math.min(100, Number(card?.dataset.examMinimumScore) || 0));
    if (requirement === 'minimum_score' && Number.isFinite(score) && score >= minimum) {
      return { satisfied: true, message: `Osiągnięto wymagane ${minimum}%.` };
    }
    if (requirement === 'passed') {
      return { satisfied: false, message: 'Aby przejść dalej, zalicz egzamin.' };
    }
    if (requirement === 'minimum_score') {
      return { satisfied: false, message: `Aby przejść dalej, uzyskaj z egzaminu co najmniej ${minimum}%.` };
    }
    return { satisfied: false, message: 'Aby przejść dalej, ukończ egzamin.' };
  }

  function initializeExamBlocks(root) {
    root.querySelectorAll('.lesson-exam-card').forEach((card) => {
      const gate = examGateFor(card);
      const record = progressApi?.record(card.dataset.examMaterial) || null;
      const status = card.querySelector('[data-exam-state]');
      card.dataset.gate = gate.satisfied ? 'open' : 'locked';
      if (!status) return;
      if (!record) status.textContent = card.dataset.examRequirement === 'optional'
        ? 'Egzamin opcjonalny'
        : gate.message;
      else if (record.status === 'completed') {
        if (record.details?.studentResultVisible === false) {
          status.textContent = 'Egzamin ukończony · wynik dostępny administratorowi';
          return;
        }
        const score = Number(record.details?.scorePercent);
        status.textContent = `${record.details?.passed === true ? 'Zaliczono' : 'Ukończono'}${Number.isFinite(score) ? ` · wynik ${Math.round(score)}%` : ''}`;
      } else {
        status.textContent = `${progressApi.statusLabel(record)} · postęp ${progressApi.percentLabel(record.progressPercent)}`;
      }
    });
  }

  function currentExamGate() {
    const cards = Array.from(elements.slideContent.querySelectorAll('.lesson-exam-card'));
    return cards.map(examGateFor).find((gate) => !gate.satisfied) || { satisfied: true, message: '' };
  }

  async function refreshExamProgress(force = false) {
    if (!progressApi || !elements.slideContent.querySelector('.lesson-exam-card')) return;
    if (state.examProgressPromise) return state.examProgressPromise;
    const now = Date.now();
    if (force && now - state.examProgressRefreshAt < EXAM_PROGRESS_FOCUS_COOLDOWN_MS) return;
    if (force) state.examProgressRefreshAt = now;
    const operation = (async () => {
      try { await progressApi.load({ force }); } catch (_) {}
      initializeExamBlocks(elements.slideContent);
      const slide = state.lesson?.slides[state.index];
      if (slide) updateNavigationAccess(slide, state.solved.has(state.index));
    })();
    state.examProgressPromise = operation;
    try { await operation; } finally {
      if (state.examProgressPromise === operation) state.examProgressPromise = null;
    }
  }

  function renderTask(task, solved) {
    elements.taskHost.replaceChildren();
    elements.taskHost.hidden = !task;
    if (!task) return;

    const form = document.createElement('form');
    const heading = document.createElement('h2');
    const label = document.createElement('label');
    const controls = document.createElement('div');
    const submit = document.createElement('button');
    const feedback = document.createElement('p');
    const fieldId = `lesson-answer-${state.index}`;

    form.className = 'task-card';
    form.noValidate = true;
    heading.textContent = 'Sprawdź, czy rozumiesz';
    label.className = 'task-label';
    label.textContent = task.label;
    label.htmlFor = fieldId;
    controls.className = 'task-controls';
    feedback.className = 'task-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    submit.className = 'button task-submit';
    submit.type = 'submit';
    submit.textContent = solved ? 'Odpowiedź zaliczona' : 'Sprawdź odpowiedź';
    submit.disabled = solved;

    let readValue;
    let perGapMode = false;
    const gapFields = [];
    const checkedGaps = new Set();
    if (task.type === 'gaps' || task.type === 'gaps-text') {
      const exercise = document.createElement('p');
      exercise.className = 'gap-exercise';
      String(task.text || '').split('\n').forEach((sourceLine) => {
        const line = document.createElement('span');
        line.className = 'gap-exercise-line';
        sourceLine.split(/(\{\{[^{}]*\}\})/).forEach((part) => {
          const gap = /^\{\{([^{}]*)\}\}$/.exec(part);
          if (!gap) {
            line.appendChild(document.createTextNode(part));
            return;
          }
          const gapIndex = gapFields.length;
          const gapLabel = gap[1].trim() || `luka ${gapIndex + 1}`;
          if (task.type === 'gaps') {
            const select = document.createElement('select');
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = gapLabel;
            select.id = `${fieldId}-${gapIndex}`;
            select.name = `${fieldId}-${gapIndex}`;
            select.setAttribute('aria-label', `Luka ${gapIndex + 1}: ${gapLabel}`);
            select.disabled = solved;
            select.appendChild(blank);
            task.options.forEach((option) => {
              const item = document.createElement('option');
              item.value = option;
              item.textContent = option;
              select.appendChild(item);
            });
            gapFields.push(select);
            line.appendChild(select);
            return;
          }

          const wrapper = document.createElement('span');
          const input = document.createElement('input');
          wrapper.className = 'text-gap-control';
          wrapper.dataset.state = solved ? 'success' : '';
          input.type = 'text';
          input.id = `${fieldId}-${gapIndex}`;
          input.name = `${fieldId}-${gapIndex}`;
          input.autocomplete = 'off';
          input.spellcheck = false;
          input.placeholder = gapLabel;
          input.setAttribute('aria-label', `Luka ${gapIndex + 1}: ${gapLabel}`);
          input.setAttribute('aria-describedby', `${fieldId}-feedback`);
          input.disabled = solved;
          wrapper.appendChild(input);
          if (task.checkMode === 'each') {
            const check = document.createElement('button');
            check.type = 'button';
            check.className = 'gap-check-one';
            check.dataset.gapIndex = String(gapIndex);
            check.textContent = '✓';
            check.setAttribute('aria-label', `Sprawdź lukę ${gapIndex + 1}`);
            check.disabled = solved;
            wrapper.appendChild(check);
            perGapMode = true;
          }
          gapFields.push(input);
          line.appendChild(wrapper);
        });
        if (!line.childNodes.length) line.appendChild(document.createElement('br'));
        exercise.appendChild(line);
      });
      controls.classList.add('gap-controls');
      controls.appendChild(exercise);
      label.hidden = true;
      readValue = () => gapFields.map((field) => field.value);
    } else if (task.type === 'choice') {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = task.label;
      fieldset.id = fieldId;
      fieldset.className = 'choice-grid';
      fieldset.classList.toggle('is-abcd', task.choiceStyle === 'abcd');
      fieldset.disabled = solved;
      task.options.forEach((option, optionIndex) => {
        const optionLabel = document.createElement('label');
        const input = document.createElement('input');
        const marker = document.createElement('span');
        const copy = document.createElement('span');
        input.type = 'radio';
        input.name = fieldId;
        input.value = task.choiceStyle === 'abcd' ? String.fromCharCode(65 + optionIndex) : option;
        input.id = `${fieldId}-${optionIndex}`;
        marker.className = 'choice-letter';
        marker.textContent = String.fromCharCode(65 + optionIndex);
        marker.setAttribute('aria-hidden', 'true');
        copy.className = 'choice-copy';
        copy.textContent = option;
        optionLabel.htmlFor = input.id;
        optionLabel.append(input);
        if (task.choiceStyle === 'abcd') optionLabel.append(marker);
        optionLabel.append(copy);
        fieldset.appendChild(optionLabel);
      });
      controls.appendChild(fieldset);
      label.hidden = true;
      readValue = () => form.elements[fieldId]?.value || '';
    } else {
      const input = document.createElement('input');
      input.id = fieldId;
      input.name = fieldId;
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = task.placeholder;
      input.inputMode = task.type === 'number' ? 'decimal' : 'text';
      input.disabled = solved;
      input.setAttribute('aria-describedby', `${fieldId}-feedback`);
      controls.appendChild(input);
      readValue = () => input.value;
    }

    feedback.id = `${fieldId}-feedback`;
    if (solved) {
      feedback.dataset.state = 'success';
      feedback.textContent = task.success;
    }

    form.append(heading, label, controls, submit, feedback);
    submit.hidden = perGapMode;

    const completeTask = () => {
      state.solved.add(state.index);
      state.completedStepIds.add(state.lesson.slides[state.index].id);
      feedback.dataset.state = 'success';
      feedback.textContent = task.success;
      submit.disabled = true;
      submit.textContent = 'Odpowiedź zaliczona';
      form.querySelectorAll('input, select, fieldset, .gap-check-one').forEach((field) => {
        field.disabled = true;
      });
      elements.next.disabled = false;
      elements.navigationHint.textContent = '';
      elements.slideStatus.textContent = 'Zadanie rozwiązane';
      elements.slideStatus.dataset.state = 'complete';
      updateOutline();
      saveProgress(true);
      elements.next.focus();
    };

    const showWrongAnswer = (field, prefix = 'Jeszcze nie') => {
      feedback.dataset.state = 'error';
      feedback.textContent = task.hint
        ? `${prefix}. Podpowiedź: ${task.hint}`
        : `${prefix} — popraw odpowiedź i spróbuj ponownie.`;
      field?.setAttribute('aria-invalid', 'true');
      field?.focus();
    };

    const setAnswerFieldState = (field, result) => {
      if (!field) return;
      field.dataset.state = result;
      if (result === 'error') field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
      field.closest('.text-gap-control')?.setAttribute('data-state', result);
      field.closest('.choice-grid label')?.setAttribute('data-state', result);
    };

    const clearAnswerFieldState = (field) => {
      if (!field || field.disabled) return;
      field.removeAttribute('data-state');
      field.removeAttribute('aria-invalid');
      field.closest('.text-gap-control')?.removeAttribute('data-state');
      if (field.type === 'radio') {
        form.querySelectorAll('.choice-grid label[data-state]').forEach((option) => {
          option.removeAttribute('data-state');
        });
      } else {
        field.closest('.choice-grid label')?.removeAttribute('data-state');
      }
      if (!state.solved.has(state.index)) {
        feedback.removeAttribute('data-state');
        feedback.textContent = '';
      }
    };

    const markTaskAnswerStates = (answer) => {
      if (task.type === 'gaps' || task.type === 'gaps-text') {
        let correctCount = 0;
        let firstWrong = null;
        gapFields.forEach((field, index) => {
          const correct = parser.checkGapAnswer(task, answer[index], index);
          setAnswerFieldState(field, correct ? 'success' : 'error');
          if (correct) correctCount += 1;
          else if (!firstWrong) firstWrong = field;
        });
        return { correctCount, total: gapFields.length, firstWrong };
      }
      if (task.type === 'choice') {
        const selected = form.querySelector('input[type="radio"]:checked');
        const correct = parser.checkAnswer(task, answer);
        setAnswerFieldState(selected, correct ? 'success' : 'error');
        return { correctCount: correct ? 1 : 0, total: 1, firstWrong: correct ? null : selected };
      }
      const field = form.querySelector('.task-controls input');
      const correct = parser.checkAnswer(task, answer);
      setAnswerFieldState(field, correct ? 'success' : 'error');
      return { correctCount: correct ? 1 : 0, total: 1, firstWrong: correct ? null : field };
    };

    form.querySelectorAll('input, select').forEach((field) => {
      field.addEventListener('input', () => clearAnswerFieldState(field));
    });

    if (perGapMode) {
      form.querySelectorAll('.gap-check-one').forEach((button) => {
        button.addEventListener('click', () => {
          if (state.solved.has(state.index)) return;
          const gapIndex = Number(button.dataset.gapIndex);
          const input = gapFields[gapIndex];
          const attempts = (state.attempts.get(state.index) || 0) + 1;
          state.attempts.set(state.index, attempts);
          if (parser.checkGapAnswer(task, input.value, gapIndex)) {
            checkedGaps.add(gapIndex);
            setAnswerFieldState(input, 'success');
            input.disabled = true;
            button.disabled = true;
            feedback.dataset.state = 'success';
            feedback.textContent = `Luka ${gapIndex + 1} jest poprawna.`;
            if (checkedGaps.size === gapFields.length) completeTask();
            else gapFields.find((field, index) => !checkedGaps.has(index))?.focus();
          } else {
            setAnswerFieldState(input, 'error');
            showWrongAnswer(input, `Luka ${gapIndex + 1} jest niepoprawna`);
          }
        });
      });
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (state.solved.has(state.index) || perGapMode) return;
      const answer = readValue();
      const attempts = (state.attempts.get(state.index) || 0) + 1;
      state.attempts.set(state.index, attempts);
      const result = markTaskAnswerStates(answer);

      if (parser.checkAnswer(task, answer)) {
        completeTask();
      } else {
        const prefix = result.total > 1
          ? `${result.correctCount} z ${result.total} odpowiedzi jest poprawnych`
          : 'Ta odpowiedź jest niepoprawna';
        showWrongAnswer(result.firstWrong, prefix);
      }
    });
    elements.taskHost.appendChild(form);
  }

  async function goNext() {
    const slide = state.lesson.slides[state.index];
    if (state.index < state.lesson.slides.length - 1 && stepAccess(state.index + 1) === 'deny') return;
    const answerCommit = commitCurrentStudentAnswers({ focusInvalid: !maySkipCurrent() });
    if (!answerCommit.valid && !maySkipCurrent()) {
      updateNavigationAccess(slide, state.solved.has(state.index));
      return;
    }
    if (!maySkipCurrent()) {
      await refreshExamProgress(true);
      if ((slide.task && !state.solved.has(state.index)) || !currentExamGate().satisfied) {
        triggerLockShake();
        return;
      }
    }
    const previousIndex = state.index;
    const wasCompleted = state.completed;
    completeCurrentStepForNavigation();
    if (state.index === state.lesson.slides.length - 1) {
      const remaining = state.lesson.slides.filter((step) => (
        step.includeInLesson !== 'OFF' || step.requiredToAdvance !== false
      ) && !state.completedStepIds.has(step.id));
      if (remaining.length) {
        elements.navigationHint.textContent = remaining.length === 1
          ? 'Odwiedź jeszcze jeden liczony krok, aby ukończyć lekcję.'
          : `Odwiedź jeszcze ${remaining.length} liczone kroki, aby ukończyć lekcję.`;
        updateOutline();
        saveProgress();
        return;
      }
      state.completed = true;
      if (!state.sequential) {
        showCompletion(false);
        void saveProgress(true, true).catch((error) => {
          state.completed = wasCompleted;
          renderSlide();
          elements.navigationHint.textContent = error?.code === 'LESSON_INCOMPLETE'
            ? 'Nie wszystkie wymagane kroki i egzaminy są ukończone.'
            : 'Postęp jest zapisany lokalnie, ale synchronizacja nie powiodła się. Spróbuj zakończyć ponownie.';
        });
        return;
      }
      try {
        await saveProgress(true, true);
        showCompletion(false);
      } catch (error) {
        state.completed = wasCompleted;
        elements.navigationHint.textContent = error?.code === 'LESSON_INCOMPLETE'
          ? 'Nie wszystkie wymagane kroki i egzaminy są ukończone.'
          : 'Nie udało się potwierdzić ukończenia. Spróbuj ponownie.';
        updateNavigationAccess(slide, state.solved.has(state.index));
      }
      return;
    }
    state.index += 1;
    state.maxReached = Math.max(state.maxReached, state.index);
    if (!state.sequential) {
      renderSlide();
      return;
    }
    try {
      await saveProgress(true, true);
      renderSlide();
    } catch (error) {
      state.index = previousIndex;
      elements.navigationHint.textContent = error?.code === 'STEP_NOT_UNLOCKED'
        ? 'Warunek tego kroku nie został jeszcze spełniony.'
        : 'Nie udało się potwierdzić przejścia. Spróbuj ponownie.';
      updateNavigationAccess(slide, state.solved.has(state.index));
    }
  }

  function goPrevious() {
    if (state.index === 0 || stepAccess(state.index - 1) === 'deny') return;
    commitCurrentStudentAnswers();
    completeCurrentStepForNavigation();
    state.index -= 1;
    renderSlide();
  }

  function showCompletion(persist = true) {
    state.completed = true;
    const unresolvedTasks = state.lesson.slides.filter(
      (slide, index) => slide.task && !state.solved.has(index)
    ).length;
    elements.slideCard.hidden = true;
    elements.navigation.hidden = true;
    elements.error.hidden = true;
    elements.completion.hidden = false;
    elements.progressBar.style.width = '100%';
    elements.lessonPosition.textContent = 'Lekcja ukończona';
    elements.completionMessage.textContent = unresolvedTasks
      ? `Przejrzano wszystkie kroki. Pominięte zadania: ${unresolvedTasks}. Możesz powtórzyć lekcję i wrócić do nich później.`
      : 'Wszystkie kroki zostały przejrzane, a zadania rozwiązane poprawnie.';
    updateOutline();
    if (persist) saveProgress(true);
    elements.restart.focus();
  }

  async function restartLesson() {
    try { sessionStorage.removeItem(progressKey()); } catch {}
    state.index = 0;
    state.maxReached = 0;
    state.solved = new Set();
    state.completedStepIds = new Set();
    state.completed = false;
    applyNavigationPolicy();
    state.attempts = new Map();
    state.studentAnswers = new Map();
    elements.restart.disabled = true;
    elements.resetProgress.disabled = true;
    let resetFailed = false;
    if (progressApi && lessonMaterialId()) {
      try { await progressApi.reset(lessonMaterialId()); }
      catch (_) { resetFailed = true; }
    }
    updateSequenceControl();
    renderSlide();
    elements.restart.disabled = false;
    elements.resetProgress.disabled = false;
    if (resetFailed) {
      elements.navigationHint.textContent = 'Postęp wyzerowano lokalnie, ale nie udało się jeszcze usunąć jego kopii z serwera.';
    }
  }

  function confirmResetProgress() {
    if (!state.lesson) return;
    const confirmed = window.confirm(
      'Zresetować postęp tej lekcji? Zapisane odpowiedzi, analizy AI, rozwiązane zadania i zapamiętany krok zostaną usunięte.'
    );
    if (!confirmed) return;
    void restartLesson();
  }

  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.topbarToggle.addEventListener('click', toggleTopbar);
  elements.outlineToggle.addEventListener('click', toggleOutline);
  elements.libraryButton.addEventListener('click', openLessonLibrary);
  elements.libraryClose.addEventListener('click', closeLessonLibrary);
  elements.librarySearch.addEventListener('input', renderLessonLibrary);
  elements.libraryRepository.addEventListener('change', async () => {
    state.repositoryId = elements.libraryRepository.value;
    state.libraryAssets = [];
    await openLessonLibrary();
  });
  elements.libraryDialog.addEventListener('click', (event) => {
    if (event.target === elements.libraryDialog) closeLessonLibrary();
  });
  window.addEventListener('popstate', loadLesson);
  window.addEventListener('chemdisk-progress-ready', () => {
    if (!state.lesson) return;
    applyNavigationPolicy();
    updateSequenceControl();
    const slide = state.lesson.slides[state.index];
    if (slide) updateNavigationAccess(slide, state.solved.has(state.index));
  });
  window.addEventListener('focus', () => { void refreshExamProgress(true); });
  elements.retry.addEventListener('click', loadLesson);
  elements.previous.addEventListener('click', goPrevious);
  elements.next.addEventListener('click', goNext);
  elements.sequenceToggle.addEventListener('change', toggleSequentialLearning);
  elements.resetProgress.addEventListener('click', confirmResetProgress);
  elements.restart.addEventListener('click', () => { void restartLesson(); });
  document.addEventListener('chemdisk-mathjax-ready', () => typesetMath(elements.slideContent));
  document.addEventListener('keydown', (event) => {
    if (elements.navigation.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowLeft') goPrevious();
    if (event.key === 'ArrowRight' && !elements.next.disabled) goNext();
  });

  initializePermissions();
  initializeTheme();
  loadUiPreferences();
  applyUiState();
  await loadLesson();
})();
