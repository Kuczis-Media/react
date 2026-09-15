(function initializeChemDiskStudio() {
  'use strict';

  const DASHBOARD_DRAFT_KEY = 'chemdisk.studio.dashboard.v1';
  const DASHBOARD_CATALOG_PENDING_KEY = 'chemdisk.studio.dashboard-catalog-pending.v1';
  const LESSON_DRAFT_KEY = 'chemdisk.studio.lesson.v1';
  const LESSON_MANIFEST_PENDING_KEY = 'chemdisk.studio.lesson-manifest-pending.v1';
  const PROMPT_DRAFT_KEY = 'chemdisk.studio.prompt.v1';
  const STUDIO_LAYOUT_KEY = 'chemdisk.studio.layout.v1';
  const THEME_KEY = 'chem.theme';
  const HISTORY_LIMIT = 60;
  const fullPreviewMedia = new WeakMap();
  const MAX_IMPORT_BYTES = 512 * 1024;
  const ADMIN_PROGRESS_URL = '/.netlify/functions/admin-progress';
  const dashboardModelApi = window.ChemDashboardStudioModel;
  const lessonModelApi = window.ChemLessonStudioModel;
  const promptModelApi = window.ChemPromptStudioModel;
  const pagedListApi = window.ChemStudioPagedList;

  const byId = (id) => document.getElementById(id);
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  const elements = {
    accessState: byId('access-state'),
    app: byId('studio-app'),
    home: byId('home-view'),
    contentExplorer: byId('content-explorer'),
    contentExplorerRepository: byId('content-explorer-repository'),
    contentExplorerSearch: byId('content-explorer-search'),
    contentExplorerRefresh: byId('content-explorer-refresh'),
    contentExplorerStatus: byId('content-explorer-status'),
    contentExplorerFolders: byId('content-explorer-folders'),
    modeSwitch: byId('mode-switch'),
    saveIndicator: byId('save-indicator'),
    saveIndicatorLabel: byId('save-indicator-label'),
    undo: byId('undo-button'),
    redo: byId('redo-button'),
    themeToggle: byId('theme-toggle'),
    themeColor: byId('theme-color'),
    dashboardWorkspace: byId('dashboard-workspace'),
    dashboardCanvas: byId('dashboard-canvas'),
    dashboardEmpty: byId('dashboard-empty'),
    dashboardInspector: byId('dashboard-inspector'),
    dashboardPreview: byId('dashboard-preview'),
    dashboardTitle: byId('dashboard-title-input'),
    dashboardIntro: byId('dashboard-intro-input'),
    dashboardBlockCount: byId('dashboard-block-count'),
    dashboardPaletteSearch: byId('dashboard-palette-search'),
    dashboardRepository: byId('dashboard-repository-select'),
    dashboardAssetSearch: byId('dashboard-asset-search'),
    dashboardAssetStatus: byId('dashboard-asset-status'),
    dashboardAssetList: byId('dashboard-asset-list'),
    dashboardLoad: byId('dashboard-load-button'),
    dashboardPublish: byId('dashboard-publish-button'),
    dashboardSource: byId('dashboard-source-button'),
    dashboardImport: byId('dashboard-import-button'),
    dashboardFile: byId('dashboard-file-input'),
    lessonWorkspace: byId('lesson-workspace'),
    lessonCanvas: byId('lesson-canvas'),
    lessonInspector: byId('lesson-inspector'),
    lessonPreview: byId('lesson-preview'),
    lessonFilename: byId('lesson-filename-input'),
    lessonTitle: byId('lesson-title-input'),
    lessonAllowSkip: byId('lesson-allow-skip'),
    lessonSlideCount: byId('lesson-slide-count'),
    lessonPaletteSearch: byId('lesson-palette-search'),
    lessonRepository: byId('lesson-repository-select'),
    lessonAssetSearch: byId('lesson-asset-search'),
    lessonAssetStatus: byId('lesson-asset-status'),
    lessonAssetList: byId('lesson-asset-list'),
    lessonSource: byId('lesson-source-button'),
    lessonCopy: byId('lesson-copy-button'),
    lessonDownload: byId('lesson-download-button'),
    lessonNew: byId('lesson-new-button'),
    lessonImport: byId('lesson-import-button'),
    lessonFile: byId('lesson-file-input'),
    lessonRepositorySave: byId('lesson-repository-save-button'),
    lessonRepositoryDelete: byId('lesson-repository-delete-button'),
    promptWorkspace: byId('prompt-workspace'),
    quizWorkspace: byId('quiz-workspace'),
    examWorkspace: byId('exam-workspace'),
    presentationWorkspace: byId('presentation-workspace'),
    promptFilename: byId('prompt-filename-input'),
    promptFormat: byId('prompt-format-select'),
    promptInstruction: byId('prompt-instruction-input'),
    promptJsonEditor: byId('prompt-json-editor'),
    promptPointsEditor: byId('prompt-points-editor'),
    promptPointsList: byId('prompt-points-list'),
    promptPointCount: byId('prompt-point-count'),
    promptAddPoint: byId('prompt-add-point-button'),
    promptRepository: byId('prompt-repository-select'),
    promptAssetSearch: byId('prompt-asset-search'),
    promptAssetStatus: byId('prompt-asset-status'),
    promptAssetList: byId('prompt-asset-list'),
    promptValidationStatus: byId('prompt-validation-status'),
    promptSourcePreview: byId('prompt-source-preview'),
    promptSource: byId('prompt-source-button'),
    promptCopy: byId('prompt-copy-button'),
    promptDownload: byId('prompt-download-button'),
    promptImport: byId('prompt-import-button'),
    promptFile: byId('prompt-file-input'),
    promptRepositorySave: byId('prompt-repository-save-button'),
    promptRepositoryDelete: byId('prompt-repository-delete-button'),
    sourceDialog: byId('source-dialog'),
    sourceDialogEyebrow: byId('source-dialog-eyebrow'),
    sourceDialogTitle: byId('source-dialog-title'),
    sourceDialogHelp: byId('source-dialog-help'),
    sourceTextarea: byId('source-textarea'),
    sourceStatus: byId('source-dialog-status'),
    sourceCopy: byId('source-copy-button'),
    sourceApply: byId('source-apply-button'),
    publishDialog: byId('publish-dialog'),
    publishSummary: byId('publish-summary'),
    publishConfirm: byId('publish-confirm-button'),
    toastRegion: byId('toast-region')
  };

  const history = {
    dashboard: { undo: [], redo: [] },
    lesson: { undo: [], redo: [] },
    prompt: { undo: [], redo: [] }
  };

  const state = {
    mode: 'home',
    currentUser: null,
    editSession: null,
    saveTimers: { dashboard: 0, lesson: 0, prompt: 0 },
    previewWindows: { dashboard: null, lesson: null },
    contentLibrary: {
      repositories: [],
      selectedRepositoryId: '',
      studioBootstrapCapability: null,
      lessons: [],
      prompts: [],
      exams: [],
      presentations: [],
      quizzes: [],
      mediaByOwner: new Map(),
      mediaLoading: new Set(),
      explorerOpen: new Set(['lesson', 'exam', 'presentation', 'quiz', 'prompt']),
      paging: pagedListApi.createState(),
      loaded: false,
      loading: false,
      loadPromise: null,
      loadRepositoryId: '',
      error: '',
      requestId: 0
    },
    sourceMode: 'dashboard',
    dashboard: {
      model: null,
      selectedUid: '',
      collapsedNodes: new Set(),
      expectedEtag: null,
      remoteLoaded: false,
      remoteSource: 'draft',
      remoteUpdatedAt: null,
      baseline: '',
      catalogPending: false,
      loading: false,
      publishing: false
    },
    lesson: {
      model: null,
      selectedId: '',
      previewSlideId: '',
      previewTransitionKey: '',
      previewOpenAnswers: new Map(),
      formulaField: 'left',
      remoteFilename: '',
      remoteSha: '',
      remoteRepositoryId: '',
      mediaObjectUrls: [],
      manifestPending: null,
      saving: false
    },
    prompt: {
      model: null,
      remoteFilename: '',
      remoteSha: '',
      remoteRepositoryId: '',
      saving: false
    }
  };

  function isAdmin(user) {
    const metadata = user && user.app_metadata ? user.app_metadata : {};
    return Array.isArray(metadata.roles) && metadata.roles.includes('admin');
  }

  function setAccessState(title, message, denied) {
    elements.accessState.replaceChildren();
    const icon = create('span', 'spinner');
    icon.setAttribute('aria-hidden', 'true');
    const heading = create('h1', '', title);
    const copy = create('p', '', message);
    elements.accessState.append(icon, heading, copy);
    elements.accessState.classList.toggle('is-denied', Boolean(denied));
    if (denied) {
      const back = create('a', 'button button-soft', 'Wróć do dashboardu');
      back.href = '/members/';
      back.style.marginTop = '22px';
      elements.accessState.append(back);
    }
  }

  function toast(title, message, type) {
    const needsAttention = type === 'error' || type === 'warning';
    const item = create('div', `toast${needsAttention ? ' is-error' : ''}`);
    const icon = create('span', '', needsAttention ? '!' : '✓');
    icon.setAttribute('aria-hidden', 'true');
    const copy = create('span');
    copy.append(create('strong', '', title), create('small', '', message || ''));
    item.append(icon, copy);
    elements.toastRegion.append(item);
    window.setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(8px)';
      window.setTimeout(() => item.remove(), 180);
    }, needsAttention ? 5200 : 3400);
  }

  function setSaveIndicator(label, status) {
    elements.saveIndicatorLabel.textContent = label;
    elements.saveIndicator.classList.toggle('is-saving', status === 'saving');
    elements.saveIndicator.classList.toggle('is-error', status === 'error');
  }

  function readStorage(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeStorage(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function readPendingLessonManifest() {
    const pending = readStorage(LESSON_MANIFEST_PENDING_KEY);
    const valid = pending
      && typeof pending.filename === 'string'
      && typeof pending.repositoryId === 'string'
      && typeof pending.sha === 'string'
      && typeof pending.content === 'string'
      && ['free', 'sequential'].includes(pending.navigation)
      && Array.isArray(pending.steps);
    if (valid) return pending;
    if (pending) removeStorage(LESSON_MANIFEST_PENDING_KEY);
    return null;
  }

  function setPendingLessonManifest(manifest) {
    state.lesson.manifestPending = manifest || null;
    if (manifest) writeStorage(LESSON_MANIFEST_PENDING_KEY, manifest);
    else removeStorage(LESSON_MANIFEST_PENDING_KEY);
  }

  function pendingLessonManifestMatches(model, pending, repositoryId) {
    if (!pending || pending.repositoryId !== repositoryId) return false;
    try {
      const validation = lessonModelApi.validateLesson(model);
      if (!validation.valid || validation.lesson.filename !== pending.filename) return false;
      validation.lesson.navigationConfigured = true;
      validation.lesson.slides.forEach((slide) => { slide.progressConfigured = true; });
      return lessonModelApi.serializeLesson(validation.lesson) === pending.content;
    } catch (_) {
      return false;
    }
  }

  const STUDIO_LAYOUT_LABELS = {
    palette: ['Zwiń bibliotekę', 'Rozwiń bibliotekę'],
    inspector: ['Zwiń panel narzędzi i podglądu', 'Rozwiń panel narzędzi i podglądu'],
    toolbar: ['Zwiń narzędzia', 'Rozwiń narzędzia']
  };

  function applyStudioLayoutPart(workspace, part, collapsed) {
    if (!workspace || !STUDIO_LAYOUT_LABELS[part]) return;
    workspace.classList.toggle(`is-${part}-collapsed`, Boolean(collapsed));
    const button = workspace.querySelector(`[data-studio-toggle="${part}"]`);
    if (!button) return;
    const label = STUDIO_LAYOUT_LABELS[part][collapsed ? 1 : 0];
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function saveStudioLayout() {
    const preferences = {};
    all('.workspace-view[data-workspace]').forEach((workspace) => {
      preferences[workspace.dataset.workspace] = {
        palette: workspace.classList.contains('is-palette-collapsed'),
        inspector: workspace.classList.contains('is-inspector-collapsed'),
        toolbar: workspace.classList.contains('is-toolbar-collapsed')
      };
    });
    writeStorage(STUDIO_LAYOUT_KEY, preferences);
  }

  function loadStudioLayout() {
    const preferences = readStorage(STUDIO_LAYOUT_KEY) || {};
    all('.workspace-view[data-workspace]').forEach((workspace) => {
      const saved = preferences[workspace.dataset.workspace] || {};
      ['palette', 'inspector', 'toolbar'].forEach((part) => {
        applyStudioLayoutPart(workspace, part, saved[part] === true);
      });
    });
  }

  function toggleStudioLayout(event) {
    const button = event.currentTarget;
    const workspace = button.closest('.workspace-view[data-workspace]');
    const part = button.dataset.studioToggle;
    if (!workspace || !STUDIO_LAYOUT_LABELS[part]) return;
    const collapsed = !workspace.classList.contains(`is-${part}-collapsed`);
    applyStudioLayoutPart(workspace, part, collapsed);
    saveStudioLayout();
  }

  function scheduleDraftSave(mode) {
    if (state.saveTimers[mode]) window.clearTimeout(state.saveTimers[mode]);
    setSaveIndicator('Zapisywanie szkicu…', 'saving');
    state.saveTimers[mode] = window.setTimeout(() => {
      state.saveTimers[mode] = 0;
      const ok = mode === 'dashboard'
        ? writeStorage(DASHBOARD_DRAFT_KEY, state.dashboard.model)
        : mode === 'lesson'
          ? writeStorage(LESSON_DRAFT_KEY, state.lesson.model)
          : writeStorage(PROMPT_DRAFT_KEY, state.prompt.model);
      let synchronized = false;
      if (ok && mode === 'dashboard' && state.dashboard.remoteLoaded) {
        try {
          synchronized = dashboardModelApi.serialize(
            state.dashboard.model,
            { ensureRequiredHelp: true }
          ).trim() === state.dashboard.baseline;
        } catch (_) {}
      }
      setSaveIndicator(
        ok
          ? synchronized ? 'Zgodny z aktywną wersją' : 'Szkic zapisany na tym urządzeniu'
          : 'Nie udało się zapisać',
        ok ? 'saved' : 'error'
      );
    }, 260);
  }

  function flushDrafts() {
    finishEdit();
    ['dashboard', 'lesson', 'prompt'].forEach((mode) => {
      if (state.saveTimers[mode]) {
        window.clearTimeout(state.saveTimers[mode]);
        state.saveTimers[mode] = 0;
      }
    });
    if (state.dashboard.model) writeStorage(DASHBOARD_DRAFT_KEY, state.dashboard.model);
    if (state.lesson.model) writeStorage(LESSON_DRAFT_KEY, state.lesson.model);
    if (state.prompt.model) writeStorage(PROMPT_DRAFT_KEY, state.prompt.model);
    window.ChemExamBuilder?.flush?.();
    window.ChemQuizBuilder?.flush?.();
  }

  function snapshot(mode) {
    const model = mode === 'dashboard'
      ? state.dashboard.model
      : mode === 'lesson'
        ? state.lesson.model
        : state.prompt.model;
    return JSON.stringify(model);
  }

  function restoreSnapshot(mode, value) {
    const parsed = JSON.parse(value);
    if (mode === 'dashboard') {
      state.dashboard.model = dashboardModelApi.normalizeModel(parsed);
      state.dashboard.selectedUid = '';
      renderDashboard();
      updateDashboardDirtyState();
    } else if (mode === 'lesson') {
      state.lesson.model = lessonModelApi.createLesson(parsed);
      state.lesson.selectedId = '';
      state.lesson.previewSlideId = state.lesson.model.slides[0] ? state.lesson.model.slides[0].id : '';
      renderLesson();
    } else {
      state.prompt.model = promptModelApi.createPrompt(parsed);
      renderPrompt();
    }
    scheduleDraftSave(mode);
  }

  function pushHistory(mode, value) {
    const stack = history[mode].undo;
    if (stack[stack.length - 1] === value) return;
    stack.push(value);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    history[mode].redo = [];
    updateHistoryButtons();
  }

  function beginEdit(mode) {
    if (state.editSession && state.editSession.mode === mode) return;
    finishEdit();
    state.editSession = { mode, before: snapshot(mode) };
  }

  function finishEdit() {
    const edit = state.editSession;
    state.editSession = null;
    if (!edit) return;
    const after = snapshot(edit.mode);
    if (after !== edit.before) pushHistory(edit.mode, edit.before);
  }

  function commitMutation(mode, mutate) {
    finishEdit();
    const before = snapshot(mode);
    const result = mutate();
    const after = snapshot(mode);
    if (after === before) return result;
    pushHistory(mode, before);
    scheduleDraftSave(mode);
    if (mode === 'dashboard') {
      renderDashboard();
      updateDashboardDirtyState();
    } else if (mode === 'lesson') {
      renderLesson();
    } else {
      renderPrompt();
    }
    return result;
  }

  function undo() {
    if (!['dashboard', 'lesson', 'prompt'].includes(state.mode)) return;
    finishEdit();
    const stack = history[state.mode];
    const previous = stack.undo.pop();
    if (!previous) return;
    stack.redo.push(snapshot(state.mode));
    restoreSnapshot(state.mode, previous);
    updateHistoryButtons();
  }

  function redo() {
    if (!['dashboard', 'lesson', 'prompt'].includes(state.mode)) return;
    finishEdit();
    const stack = history[state.mode];
    const next = stack.redo.pop();
    if (!next) return;
    stack.undo.push(snapshot(state.mode));
    restoreSnapshot(state.mode, next);
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const available = ['dashboard', 'lesson', 'prompt'].includes(state.mode);
    elements.undo.disabled = !available || history[state.mode].undo.length === 0;
    elements.redo.disabled = !available || history[state.mode].redo.length === 0;
  }

  function defaultDashboard() {
    return dashboardModelApi.createModel({
      title: 'Twoja przestrzeń do nauki',
      blocks: [
        dashboardModelApi.createText('Wszystkie materiały, ćwiczenia i narzędzia kursu w jednym miejscu.')
      ],
      sections: [{
        title: 'Materiały kursowe',
        blocks: [
          dashboardModelApi.createText('Przeciągnij tutaj prezentację, lekcję, dokument albo inne narzędzie.')
        ]
      }]
    });
  }

  function defaultLesson() {
    return lessonModelApi.createStarterLesson('nowa-lekcja.md');
  }

  function lessonModelFromSource(source, filename) {
    return lessonModelApi.parseEditableLesson(source, filename);
  }

  function createNewLessonDraft() {
    if (!window.confirm('Rozpocząć nową lekcję? Bieżący szkic w edytorze zostanie zastąpiony. Zapisz go najpierw, jeśli chcesz zachować zmiany.')) {
      return;
    }
    finishEdit();
    const model = defaultLesson();
    state.lesson.model = model;
    state.lesson.previewOpenAnswers.clear();
    state.lesson.selectedId = model.slides[0] ? model.slides[0].id : '';
    state.lesson.previewSlideId = model.slides[0] ? model.slides[0].id : '';
    state.lesson.remoteFilename = '';
    state.lesson.remoteSha = '';
    state.lesson.remoteRepositoryId = '';
    setPendingLessonManifest(null);
    history.lesson.undo = [];
    history.lesson.redo = [];
    scheduleDraftSave('lesson');
    renderLesson();
    updateHistoryButtons();
    toast(
      'Nowa lekcja jest gotowa',
      'Nadaj nazwę pliku i kliknij „Opublikuj”, kiedy lekcja będzie gotowa.'
    );
    window.requestAnimationFrame(() => {
      elements.lessonFilename.focus();
      elements.lessonFilename.select();
    });
  }

  function defaultPrompt() {
    return promptModelApi.createPrompt({
      filename: 'nowy-prompt.json',
      format: 'json',
      instruction: [
        'Jesteś cierpliwym korepetytorem chemii przygotowującym ucznia do matury.',
        'Najpierw zadaj krótkie pytanie naprowadzające, a pełne rozwiązanie pokaż dopiero na prośbę.',
        'Odpowiadaj po polsku i sprawdzaj jednostki oraz zapis równań reakcji.'
      ].join('\n')
    });
  }

  function loadDrafts() {
    const dashboardDraft = readStorage(DASHBOARD_DRAFT_KEY);
    const lessonDraft = readStorage(LESSON_DRAFT_KEY);
    const promptDraft = readStorage(PROMPT_DRAFT_KEY);
    try {
      state.dashboard.model = dashboardDraft
        ? dashboardModelApi.normalizeModel(dashboardDraft)
        : defaultDashboard();
    } catch (_) {
      state.dashboard.model = defaultDashboard();
    }
    try {
      state.lesson.model = lessonDraft
        ? lessonModelApi.createLesson(lessonDraft)
        : defaultLesson();
    } catch (_) {
      state.lesson.model = defaultLesson();
    }
    state.lesson.manifestPending = readPendingLessonManifest();
    if (pendingLessonManifestMatches(
      state.lesson.model,
      state.lesson.manifestPending,
      state.lesson.manifestPending?.repositoryId
    )) {
      state.lesson.remoteFilename = state.lesson.manifestPending.filename;
      state.lesson.remoteSha = state.lesson.manifestPending.sha;
      state.lesson.remoteRepositoryId = state.lesson.manifestPending.repositoryId;
    }
    try {
      state.prompt.model = promptDraft
        ? promptModelApi.createPrompt(promptDraft)
        : defaultPrompt();
    } catch (_) {
      state.prompt.model = defaultPrompt();
    }
    state.lesson.previewSlideId = state.lesson.model.slides[0] ? state.lesson.model.slides[0].id : '';
  }

  function applyTheme(theme, persist) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    if (elements.themeColor) {
      elements.themeColor.setAttribute('content', next === 'dark' ? '#090f18' : '#edf2f7');
    }
    if (persist) {
      try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    }
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  }

  function switchMode(mode) {
    finishEdit();
    const next = ['home', 'dashboard', 'lesson', 'quiz', 'exam', 'presentation', 'prompt'].includes(mode) ? mode : 'home';
    state.mode = next;
    const toolSelect = document.getElementById('studio-tool-select');
    if (toolSelect) toolSelect.value = next;
    elements.home.hidden = next !== 'home';
    elements.dashboardWorkspace.hidden = next !== 'dashboard';
    elements.lessonWorkspace.hidden = next !== 'lesson';
    elements.promptWorkspace.hidden = next !== 'prompt';
    elements.quizWorkspace.hidden = next !== 'quiz';
    elements.examWorkspace.hidden = next !== 'exam';
    elements.presentationWorkspace.hidden = next !== 'presentation';
    all('[data-switch-mode]').forEach((button) => {
      const active = button.dataset.switchMode === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    const repositoryReady = next === 'home'
      ? Promise.resolve()
      : loadRepositoryAssets(false);
    if (next === 'dashboard') renderDashboard();
    if (next === 'lesson') renderLesson();
    if (next === 'prompt') renderPrompt();
    if (next === 'quiz') void repositoryReady.then(() => {
      if (state.mode === 'quiz') return window.ChemQuizBuilder?.activate?.();
    });
    if (next === 'exam') void repositoryReady.then(() => {
      if (state.mode === 'exam') return window.ChemExamBuilder?.activate?.();
    });
    if (next === 'presentation') void repositoryReady.then(() => {
      if (state.mode === 'presentation') return window.ChemPresentationBuilder?.activate?.();
    });
    updateHistoryButtons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function initializeContentExplorerLoader() {
    if (!elements.contentExplorer) return;
    const load = () => { void loadRepositoryAssets(false); };
    if (typeof window.IntersectionObserver !== 'function') {
      load();
      return;
    }
    const observer = new window.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '320px 0px' });
    observer.observe(elements.contentExplorer);
  }

  function dashboardModuleDefaults(type) {
    const defaults = {
      presentation: ['Nowa prezentacja', 'Otwórz prezentację i kontynuuj naukę od ostatniego slajdu.'],
      slides: ['Nowa prezentacja', 'Otwórz prezentację do tego działu.'],
      google: ['Materiał Google', 'Otwórz plik lub nagranie w skalowalnym podglądzie.'],
      pdf: ['Dokument PDF', 'Materiał do czytania lub pobrania.'],
      film: ['Nagranie lekcji', 'Obejrzyj nagranie w odtwarzaczu kursowym.'],
      yt: ['Film YouTube', 'Nagranie z własnymi kontrolkami odtwarzacza.'],
      lesson: ['Lekcja interaktywna', 'Przejdź przez prezentację i zadania.'],
      forms: ['Test wiedzy', 'Sprawdź swoją wiedzę w formularzu.'],
      quiz: ['Quiz', 'Sprawdź swoją wiedzę. Wynik i postępy zostaną zapisane.'],
      exam: ['Egzamin', 'Rozwiąż egzamin i zapisz wynik na platformie.'],
      chat: ['Asystent AI', 'Skorzystaj z przygotowanej pomocy.'],
      kalkulator: ['Kalkulator naukowy', 'Wykonuj obliczenia potrzebne w zadaniach.'],
      classic: ['Kalkulator klasyczny', 'Szybkie podstawowe obliczenia.'],
      whiteboard: ['Biała tablica', 'Szkicuj wzory, reakcje i notatki.'],
      bitpaper: ['Tablica BitPaper', 'Wspólna przestrzeń do rozwiązywania zadań.'],
      atonom: ['ATONOM', 'Buduj modele cząsteczek z polskich nazw.'],
      contact: ['Formularz kontaktowy', 'Wyślij wiadomość do prowadzącego bez opuszczania platformy.'],
      external: ['Materiał zewnętrzny', 'Otwórz materiał w nowej karcie.']
    };
    return defaults[type] || ['Nowy materiał', 'Otwórz materiał kursowy.'];
  }

  function createDashboardNode(type) {
    if (type === 'section') return dashboardModelApi.createSection({ title: 'Nowy dział' });
    if (type === 'group') return dashboardModelApi.createGroup({ title: 'Nowa harmonijka' });
    if (type === 'organizer') return dashboardModelApi.createGroup({
      title: 'Ścieżka nauki',
      navigation: 'sequential'
    });
    if (type === 'text') return dashboardModelApi.createText('Nowy opis.');
    if (type === 'notice') return dashboardModelApi.createNotice('Ważna informacja dla kursantów.');
    const [title, description] = dashboardModuleDefaults(type);
    if (type === 'kalkulator' || type === 'classic') {
      return dashboardModelApi.createModule({
        module: 'calculator',
        variant: type,
        title,
        description
      });
    }
    if (type === 'whiteboard' || type === 'bitpaper') {
      return dashboardModelApi.createModule({
        module: 'whiteboard',
        variant: type,
        title,
        description
      });
    }
    if (type === 'external') {
      return dashboardModelApi.createModule({
        module: 'link',
        href: 'https://',
        title,
        description
      });
    }
    return dashboardModelApi.createModule({
      module: type,
      title,
      description,
      source: 'prompt',
      repositoryId: ['lesson', 'chat', 'exam', 'presentation', 'quiz'].includes(type)
        ? state.contentLibrary.selectedRepositoryId
        : '',
      formula: type === 'atonom' ? 'fenol' : ''
    });
  }

  function dashboardDefaultParent() {
    const selected = state.dashboard.selectedUid
      ? dashboardModelApi.findNode(state.dashboard.model, state.dashboard.selectedUid)
      : null;
    if (selected) {
      if (selected.node.kind === 'section' || selected.node.kind === 'group') return selected.node.uid;
      if (selected.parent && ['section', 'group'].includes(selected.parent.kind)) return selected.parent.uid;
    }
    const last = state.dashboard.model.sections[state.dashboard.model.sections.length - 1];
    return last ? last.uid : '';
  }

  function addDashboardNode(type, parentUid, index, preparedNode) {
    commitMutation('dashboard', () => {
      let node = preparedNode || createDashboardNode(type);
      if (node.kind === 'section') {
        const inserted = dashboardModelApi.insertNode(
          state.dashboard.model,
          state.dashboard.model.uid,
          node,
          index
        );
        if (inserted) state.dashboard.selectedUid = inserted.uid;
        return;
      }
      let target = parentUid || dashboardDefaultParent();
      if (!target) {
        const section = dashboardModelApi.insertNode(
          state.dashboard.model,
          state.dashboard.model.uid,
          dashboardModelApi.createSection({ title: 'Materiały kursowe' })
        );
        target = section && section.uid;
      }
      const inserted = target
        ? dashboardModelApi.insertNode(state.dashboard.model, target, node, index)
        : null;
      if (!inserted) {
        toast('Nie można dodać klocka', 'Harmonijki mogą mieć maksymalnie cztery poziomy.', 'error');
        return;
      }
      state.dashboard.selectedUid = inserted.uid;
    });
  }

  function insertDashboardAsset(asset) {
    if (!asset || !asset.filename) return;
    let node;
    if (asset.kind === 'lesson') {
      node = dashboardModelApi.createModule({
        module: 'lesson',
        repositoryId: asset.repositoryId,
        file: asset.filename,
        title: asset.title || asset.filename,
        description: asset.description || 'Interaktywna lekcja z prywatnej biblioteki kursu.'
      });
    } else if (asset.kind === 'exam') {
      node = dashboardModelApi.createModule({
        module: 'exam',
        repositoryId: asset.repositoryId,
        examId: asset.filename,
        title: asset.title || asset.filename,
        description: asset.description || 'Egzamin z bezpiecznym zapisem próby i wyniku.'
      });
    } else if (asset.kind === 'presentation') {
      node = dashboardModelApi.createModule({
        module: 'presentation',
        repositoryId: asset.repositoryId,
        presentationId: asset.filename,
        title: asset.title || asset.filename,
        description: asset.description || 'Otwórz prezentację i kontynuuj naukę od ostatniego slajdu.'
      });
    } else if (asset.kind === 'quiz') {
      node = dashboardModelApi.createModule({
        module: 'quiz',
        repositoryId: asset.repositoryId,
        quizId: asset.filename,
        title: asset.title || asset.filename,
        description: asset.description || 'Sprawdź swoją wiedzę. Wynik i postępy zostaną zapisane.'
      });
    } else {
      const isText = /\.txt$/i.test(asset.filename);
      node = dashboardModelApi.createModule({
        module: 'chat',
        repositoryId: asset.repositoryId,
        source: isText ? 'file' : 'prompt',
        file: isText ? asset.filename : '',
        point: isText ? 1 : null,
        prompt: isText ? '' : asset.filename,
        title: asset.title || asset.filename,
        description: asset.description || 'Asystent korzystający z Twoich zapisanych instrukcji.'
      });
    }
    addDashboardNode(node.module, null, undefined, node);
    toast(
      'Materiał dodany',
      asset.kind === 'lesson'
        ? 'Karta lekcji jest gotowa w dashboardzie.'
        : asset.kind === 'exam'
          ? 'Karta egzaminu jest gotowa w dashboardzie.'
          : asset.kind === 'presentation'
            ? 'Karta prezentacji jest gotowa w dashboardzie.'
            : asset.kind === 'quiz'
              ? 'Karta quizu jest gotowa w dashboardzie.'
            : 'Karta AI jest gotowa; dla pliku TXT sprawdź numer punktu.'
    );
  }

  function dashboardSymbol(node) {
    if (node.kind === 'section') return '§';
    if (node.kind === 'group') return node.navigation === 'sequential' ? '1→' : '⌄';
    if (node.kind === 'text') return 'T';
    if (node.kind === 'notice') return '!';
    const definition = dashboardModelApi.MODULE_DEFINITIONS[node.module];
    return definition ? definition.icon : '↗';
  }

  function dashboardNodeTitle(node) {
    if (node.kind === 'section' || node.kind === 'group' || node.kind === 'module') return node.title;
    return node.text || (node.kind === 'notice' ? 'Komunikat' : 'Pole tekstowe');
  }

  function dashboardNodeSubtitle(node) {
    if (node.kind === 'section') return `${node.blocks.length} elementów`;
    if (node.kind === 'group') return node.navigation === 'sequential'
      ? `Organizer · ${node.blocks.filter((block) => block.kind === 'module').length} kroków`
      : `Poziom ${node.level - 2} · ${node.blocks.length} elementów`;
    if (node.kind === 'text') return 'Pole tekstowe';
    if (node.kind === 'notice') return 'Komunikat';
    const definition = dashboardModelApi.MODULE_DEFINITIONS[node.module];
    return definition ? definition.label : 'Karta materiału';
  }

  function actionButton(action, label, text, danger) {
    const button = create('button', `node-action${danger ? ' is-danger' : ''}`, text);
    button.type = 'button';
    button.dataset.nodeAction = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  function nodeHeader(node, containerClass) {
    const header = create('header', containerClass || 'node-header');
    const drag = create('button', 'drag-handle', '⠿');
    drag.type = 'button';
    drag.title = 'Przeciągnij, aby zmienić kolejność';
    drag.setAttribute('aria-label', 'Przeciągnij, aby zmienić kolejność');
    const symbol = create('span', 'node-symbol', dashboardSymbol(node));
    symbol.setAttribute('aria-hidden', 'true');
    const copy = create('span', 'node-copy');
    copy.append(
      create('strong', '', dashboardNodeTitle(node) || 'Bez tytułu'),
      create('small', '', dashboardNodeSubtitle(node))
    );
    const actions = create('span', 'node-actions');
    if (node.kind === 'section' || node.kind === 'group') {
      if (node.kind === 'group' && node.navigation !== 'sequential') {
        actions.append(actionButton(
          'add-organizer-child',
          'Dodaj organizer po kolei do tej harmonijki',
          '+1→'
        ));
      }
      const collapsed = state.dashboard.collapsedNodes.has(node.uid);
      const noun = node.kind === 'section'
        ? 'sekcję'
        : node.navigation === 'sequential' ? 'organizer' : 'harmonijkę';
      const collapse = actionButton(
        'toggle-collapse',
        collapsed ? `Rozwiń ${noun} w edytorze` : `Zwiń ${noun} w edytorze`,
        collapsed ? '⌄' : '⌃'
      );
      collapse.classList.add('dashboard-collapse-action');
      collapse.setAttribute('aria-expanded', String(!collapsed));
      actions.append(collapse);
    }
    actions.append(
      actionButton('up', 'Przesuń wyżej', '↑'),
      actionButton('down', 'Przesuń niżej', '↓'),
      actionButton('duplicate', 'Duplikuj', '⧉'),
      actionButton('delete', 'Usuń', '×', true)
    );
    header.append(drag, symbol, copy, actions);
    return header;
  }

  function dashboardDropZone(parentUid, index, label) {
    const zone = create('div', 'drop-zone', label || 'Upuść tutaj');
    zone.dataset.dashboardDropParent = parentUid;
    zone.dataset.dashboardDropIndex = String(index);
    return zone;
  }

  function renderDashboardBlock(node, parentUid, index) {
    if (node.kind === 'group') {
      const group = create('article', 'builder-node group-node');
      group.dataset.nodeUid = node.uid;
      group.dataset.nodeKind = node.kind;
      group.dataset.parentUid = parentUid;
      group.dataset.nodeIndex = String(index);
      group.draggable = true;
      const collapsed = state.dashboard.collapsedNodes.has(node.uid);
      group.classList.toggle('is-selected', state.dashboard.selectedUid === node.uid);
      group.classList.toggle('is-editor-collapsed', collapsed);
      group.classList.toggle('is-sequential', node.navigation === 'sequential');
      group.append(nodeHeader(node));
      const body = create('div', 'group-body');
      node.blocks.forEach((block, blockIndex) => {
        body.append(dashboardDropZone(node.uid, blockIndex));
        body.append(renderDashboardBlock(block, node.uid, blockIndex));
      });
      body.append(dashboardDropZone(
        node.uid,
        node.blocks.length,
        node.navigation === 'sequential' ? 'Dodaj kolejny krok' : 'Dodaj do harmonijki'
      ));
      body.hidden = collapsed;
      group.append(body);
      return group;
    }
    const block = create('article', 'block-node');
    block.dataset.nodeUid = node.uid;
    block.dataset.nodeKind = node.kind;
    block.dataset.nodeType = node.kind === 'module' ? node.module : node.kind;
    block.dataset.parentUid = parentUid;
    block.dataset.nodeIndex = String(index);
    block.draggable = true;
    block.classList.toggle('is-selected', state.dashboard.selectedUid === node.uid);
    const drag = create('button', 'drag-handle', '⠿');
    drag.type = 'button';
    drag.setAttribute('aria-label', 'Przeciągnij klocek');
    const symbol = create('span', 'node-symbol', dashboardSymbol(node));
    symbol.setAttribute('aria-hidden', 'true');
    const copy = create('span', 'node-copy');
    copy.append(
      create('strong', '', dashboardNodeTitle(node) || 'Bez treści'),
      create('small', '', dashboardNodeSubtitle(node))
    );
    if (node.kind === 'module') {
      copy.append(create('span', 'module-chip', dashboardModelApi.moduleHref(node)));
    }
    const actions = create('span', 'node-actions');
    actions.append(
      actionButton('up', 'Przesuń wyżej', '↑'),
      actionButton('down', 'Przesuń niżej', '↓'),
      actionButton('duplicate', 'Duplikuj', '⧉'),
      actionButton('delete', 'Usuń', '×', true)
    );
    block.append(drag, symbol, copy, actions);
    return block;
  }

  function renderDashboardSection(section, index) {
    const article = create('article', 'builder-node section-node');
    article.dataset.nodeUid = section.uid;
    article.dataset.nodeKind = 'section';
    article.dataset.parentUid = state.dashboard.model.uid;
    article.dataset.nodeIndex = String(index);
    article.draggable = true;
    const collapsed = state.dashboard.collapsedNodes.has(section.uid);
    article.classList.toggle('is-selected', state.dashboard.selectedUid === section.uid);
    article.classList.toggle('is-editor-collapsed', collapsed);
    article.append(nodeHeader(section));
    const body = create('div', 'section-body');
    section.blocks.forEach((block, blockIndex) => {
      body.append(dashboardDropZone(section.uid, blockIndex));
      body.append(renderDashboardBlock(block, section.uid, blockIndex));
    });
    body.append(dashboardDropZone(section.uid, section.blocks.length, 'Dodaj do sekcji'));
    body.hidden = collapsed;
    article.append(body);
    return article;
  }

  function countDashboardBlocks() {
    let count = state.dashboard.model.sections.length;
    const visit = (blocks) => blocks.forEach((block) => {
      count += 1;
      if (block.kind === 'group') visit(block.blocks);
    });
    state.dashboard.model.sections.forEach((section) => visit(section.blocks));
    return count;
  }

  function renderDashboardCanvas() {
    if (window.NextMedUI?.render('studio-dashboard', elements.dashboardCanvas, {
      model: state.dashboard.model, selected: state.dashboard.selectedUid, collapsed: state.dashboard.collapsedNodes,
      adapters: { title: dashboardNodeTitle, subtitle: dashboardNodeSubtitle, symbol: dashboardSymbol, moduleHref: dashboardModelApi.moduleHref }
    })) {
      elements.dashboardBlockCount.textContent = String(countDashboardBlocks());
      return;
    }
    elements.dashboardCanvas.replaceChildren();
    const sections = state.dashboard.model.sections;
    if (!sections.length) {
      const empty = create('div', 'empty-canvas');
      empty.append(
        create('span', '', '↙'),
        create('strong', '', 'Przeciągnij tutaj pierwszą sekcję'),
        create('p', '', 'Możesz też kliknąć dowolny klocek w bibliotece.')
      );
      empty.dataset.dashboardDropParent = state.dashboard.model.uid;
      empty.dataset.dashboardDropIndex = '0';
      elements.dashboardCanvas.append(empty);
    } else {
      sections.forEach((section, index) => {
        elements.dashboardCanvas.append(
          dashboardDropZone(state.dashboard.model.uid, index, 'Upuść sekcję tutaj'),
          renderDashboardSection(section, index)
        );
      });
      elements.dashboardCanvas.append(
        dashboardDropZone(state.dashboard.model.uid, sections.length, 'Dodaj sekcję na końcu')
      );
    }
    elements.dashboardBlockCount.textContent = String(countDashboardBlocks());
  }

  function field(label, control, help) {
    const interactive = control?.classList?.contains('studio-material-picker');
    const wrapper = create(interactive ? 'div' : 'label', 'field');
    const caption = create('span', '', label);
    wrapper.append(caption, control);
    if (interactive) {
      const input = control.querySelector('input');
      if (input && !input.getAttribute('aria-label')) input.setAttribute('aria-label', label);
    }
    if (help) wrapper.append(create('small', 'field-help', help));
    return wrapper;
  }

  function textInput(value, fieldName, options) {
    const input = document.createElement('input');
    input.type = options && options.type ? options.type : 'text';
    input.value = value == null ? '' : String(value);
    input.dataset.dashboardField = fieldName;
    if (options && options.min !== undefined) input.min = options.min;
    if (options && options.max !== undefined) input.max = options.max;
    if (options && options.placeholder) input.placeholder = options.placeholder;
    if (options && options.maxLength) input.maxLength = options.maxLength;
    if (options && options.readOnly) input.readOnly = true;
    return input;
  }

  function repositoryOptions(includeDefault) {
    const repositories = state.contentLibrary.repositories;
    const options = repositories.map((repository) => ({
      value: repository.id,
      label: repository.label || repository.repository
    }));
    if (includeDefault) {
      const fallback = repositories.find((repository) => repository.default) || repositories[0];
      options.unshift({
        value: '',
        label: fallback
          ? `Domyślne — ${fallback.label || fallback.repository}`
          : 'Domyślna biblioteka'
      });
    }
    return options;
  }

  function defaultContentRepositoryId() {
    const repository = state.contentLibrary.repositories.find((item) => item.default)
      || state.contentLibrary.repositories[0];
    return repository ? repository.id : '';
  }

  function syncInspectorRepository(repositoryId) {
    const requestedId = repositoryId || defaultContentRepositoryId();
    if (
      requestedId
      && requestedId !== state.contentLibrary.selectedRepositoryId
      && state.contentLibrary.repositories.some((repository) => repository.id === requestedId)
    ) {
      void selectContentRepository(requestedId);
    }
  }

  function repositoryFilenameInput(value, fieldName, kind, extension, repositoryId) {
    const input = textInput(value, fieldName, {
      placeholder: kind === 'lesson' ? 'np. stechiometria.md' : `np. pomoc.${extension}`,
      maxLength: 80
    });
    const selectedRepositoryId = repositoryId || (
      state.contentLibrary.repositories.find((repository) => repository.default) || {}
    ).id || state.contentLibrary.selectedRepositoryId;
    const assets = (kind === 'lesson'
      ? state.contentLibrary.lessons
      : state.contentLibrary.prompts.filter((asset) => asset.filename.toLowerCase().endsWith(`.${extension}`)))
      .filter((asset) => !selectedRepositoryId || asset.repositoryId === selectedRepositoryId);
    return materialPicker(input, assets, {
      type: kind === 'lesson' ? 'Lekcja' : `Plik ${extension.toUpperCase()}`,
      empty: kind === 'lesson' ? 'Brak lekcji w tej bibliotece.' : `Brak plików .${extension}.`
    });
  }

  function lessonRepositoryFilenameInput(value, fieldName, extensions, repositoryId) {
    const allowedExtensions = (Array.isArray(extensions) ? extensions : [extensions])
      .map((extension) => String(extension || '').toLowerCase())
      .filter(Boolean);
    const input = lessonInput(value, fieldName, {
      placeholder: allowedExtensions.length > 1
        ? 'Wybierz plik JSON lub TXT'
        : `Wybierz plik .${allowedExtensions[0] || 'txt'}`,
      maxLength: 80
    });
    const selectedRepositoryId = repositoryId || (
      state.contentLibrary.repositories.find((repository) => repository.default) || {}
    ).id || state.contentLibrary.selectedRepositoryId;
    const assets = state.contentLibrary.prompts
      .filter((asset) => (
        (!selectedRepositoryId || asset.repositoryId === selectedRepositoryId)
        && allowedExtensions.some((extension) => asset.filename.toLowerCase().endsWith(`.${extension}`))
      ));
    return materialPicker(input, assets, {
      type: allowedExtensions.map((item) => item.toUpperCase()).join(' / '),
      empty: 'Brak pasujących plików w tej bibliotece.'
    });
  }

  function materialPicker(input, assets, options = {}) {
    const wrapper = create('div', 'studio-material-picker');
    const inputRow = create('div', 'studio-material-picker-input');
    const toggle = create('button', 'studio-material-picker-toggle', '⌄');
    const popup = create('div', 'studio-material-picker-popup');
    const list = create('div', 'studio-material-picker-list');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Pokaż listę materiałów');
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    popup.hidden = true;

    const source = (assets || []).map((asset) => ({
      ...asset,
      pickerValue: String(asset.pickerValue || asset.filename || asset.id || ''),
      pickerTitle: String(asset.title || asset.name || asset.filename || asset.id || 'Materiał')
    })).filter((asset) => asset.pickerValue);
    const close = () => {
      popup.hidden = true;
      wrapper.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      popup.hidden = false;
      wrapper.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
    };
    const render = (requestedQuery) => {
      const query = String(requestedQuery === undefined ? input.value : requestedQuery)
        .trim()
        .toLocaleLowerCase('pl');
      const matches = source.filter((asset) => (
        !query
        || `${asset.pickerTitle} ${asset.pickerValue} ${asset.description || ''}`
          .toLocaleLowerCase('pl')
          .includes(query)
      ));
      list.replaceChildren();
      matches.slice(0, 80).forEach((asset) => {
        const button = create('button', 'studio-material-picker-option');
        button.type = 'button';
        button.dataset.pickerValue = asset.pickerValue;
        const icon = create('span', 'studio-material-picker-icon', String(options.icon || options.type || 'M').slice(0, 1));
        const copy = create('span', 'studio-material-picker-copy');
        copy.append(
          create('strong', '', asset.pickerTitle),
          create('small', '', asset.pickerValue)
        );
        const badge = create('em', '', options.type || 'Materiał');
        button.append(icon, copy, badge);
        button.addEventListener('pointerdown', (event) => event.preventDefault());
        button.addEventListener('click', async () => {
          if (options.onPick) {
            button.disabled = true;
            try { if (!await options.onPick(asset)) return; }
            finally { button.disabled = false; }
          }
          input.value = asset.pickerValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          close();
          input.focus();
        });
        list.append(button);
      });
      if (!matches.length) {
        const empty = create('div', 'studio-material-picker-empty');
        empty.append(
          create('strong', '', options.empty || 'Nie znaleziono materiału.'),
          create('small', '', options.allowCustom === false ? 'Zmień wyszukiwanie.' : 'Możesz wpisać nazwę pliku ręcznie.')
        );
        list.append(empty);
      }
    };
    input.addEventListener('focus', () => {
      render('');
      open();
      input.select?.();
    });
    input.addEventListener('input', () => { render(); open(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowDown') {
        open();
        list.querySelector('button')?.focus();
        event.preventDefault();
      }
    });
    toggle.addEventListener('click', () => {
      if (popup.hidden) { render(''); open(); input.focus(); }
      else close();
    });
    wrapper.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) close();
      }, 0);
    });
    inputRow.append(input, toggle);
    popup.append(create('small', 'studio-material-picker-hint', 'Wpisz fragment nazwy lub wybierz z listy'), list);
    wrapper.append(inputRow, popup);
    return wrapper;
  }

  function textareaInput(value, fieldName, options) {
    const textarea = document.createElement('textarea');
    textarea.value = value == null ? '' : String(value);
    textarea.dataset.dashboardField = fieldName;
    textarea.rows = options && options.rows ? options.rows : 4;
    if (options && options.placeholder) textarea.placeholder = options.placeholder;
    if (options && options.maxLength) textarea.maxLength = options.maxLength;
    return textarea;
  }

  function selectInput(value, fieldName, options) {
    const select = document.createElement('select');
    select.dataset.dashboardField = fieldName;
    (options || []).forEach((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    });
    select.value = value == null ? '' : String(value);
    return select;
  }

  function inspectorHeader(symbol, title, description) {
    const header = document.createElement('header');
    header.append(
      create('span', 'node-symbol', symbol),
      create('h2', '', title),
      create('p', '', description)
    );
    return header;
  }

  function inspectorActions() {
    const footer = create('div', 'inspector-actions');
    const duplicate = create('button', 'button button-soft', 'Duplikuj');
    duplicate.type = 'button';
    duplicate.dataset.inspectorAction = 'duplicate';
    const remove = create('button', 'button button-danger', 'Usuń');
    remove.type = 'button';
    remove.dataset.inspectorAction = 'delete';
    footer.append(duplicate, remove);
    return footer;
  }

  function effectiveDashboardProgress(found, key) {
    let current = found && found.node;
    while (current) {
      const value = current.progress && current.progress[key];
      if (value === 'ON' || value === 'OFF') return value;
      const parent = current.uid === state.dashboard.model.uid
        ? null
        : dashboardModelApi.findNode(state.dashboard.model, current.uid)?.parent;
      current = parent;
    }
    return 'ON';
  }

  function dashboardProgressFields(form, found) {
    const node = found.node;
    const progress = node.progress || {};
    const isRoot = node.kind === 'dashboard';
    const group = create('section', 'inspector-progress-settings');
    group.append(create('h3', '', 'Postęp ucznia'));
    group.append(field(
      'Śledzenie postępu',
      selectInput(progress.tracking || (isRoot ? 'ON' : 'INHERIT'), 'progressTracking', [
        ...(!isRoot ? [{ value: 'INHERIT', label: 'Dziedzicz' }] : []),
        { value: 'ON', label: 'Włączone' },
        { value: 'OFF', label: 'Wyłączone' }
      ]),
      `Efektywnie: ${effectiveDashboardProgress(found, 'tracking') === 'ON' ? 'włączone' : 'wyłączone'}. Wyłączenie nie usuwa historii.`
    ));
    group.append(field(
      'Pokazuj pasek uczniowi',
      selectInput(progress.showProgress || (isRoot ? 'ON' : 'INHERIT'), 'progressShowProgress', [
        ...(!isRoot ? [{ value: 'INHERIT', label: 'Dziedzicz' }] : []),
        { value: 'ON', label: 'Tak' },
        { value: 'OFF', label: 'Nie' }
      ]),
      `Efektywnie: ${effectiveDashboardProgress(found, 'showProgress') === 'ON' ? 'widoczny' : 'ukryty'}. Ukrycie nie wyłącza raportowania.`
    ));
    if (isRoot) {
      const opens = create('label', 'check-field');
      const input = textInput('', 'progressRecordOpens', { type: 'checkbox' });
      input.checked = node.recordOpens !== false;
      opens.append(input, create('span', '', 'Rejestruj otwarcia materiałów'));
      group.append(opens);
      form.append(group);
      return;
    }
    group.append(field(
      'Waga',
      textInput(String(progress.weight || 1), 'progressWeight', { type: 'number' }),
      'Domyślna waga to 1. Element z włączonym śledzeniem automatycznie wpływa na postęp wszystkich swoich rodziców.'
    ));
    form.append(group);
  }

  function renderDashboardInspector() {
    elements.dashboardInspector.replaceChildren();
    const found = state.dashboard.selectedUid
      ? dashboardModelApi.findNode(state.dashboard.model, state.dashboard.selectedUid)
      : { node: state.dashboard.model, parent: null, container: null, index: -1 };
    const node = found.node;
    if (node.kind === 'module' && ['lesson', 'chat', 'exam', 'presentation', 'quiz'].includes(node.module)) {
      syncInspectorRepository(node.repositoryId);
    }
    const form = create('form', 'inspector-form');
    form.addEventListener('submit', (event) => event.preventDefault());
    form.append(inspectorHeader(
      dashboardSymbol(node),
      dashboardNodeSubtitle(node),
      node.kind === 'module'
        ? 'Skonfiguruj kartę dokładnie tak, jak ma otwierać się kursantowi.'
        : 'Zmień nazwę i treść zaznaczonego klocka.'
    ));

    if (node.kind === 'dashboard') {
      form.append(create('p', 'field-help', 'Ustawienia całej platformy. Wyłączenie postępu nie usuwa wcześniejszej historii.'));
    } else if (node.kind === 'section' || node.kind === 'group') {
      form.append(field(
        node.kind === 'section'
          ? 'Nazwa działu'
          : node.navigation === 'sequential' ? 'Tytuł organizera' : 'Tytuł harmonijki',
        textInput(node.title, 'title', { maxLength: 120 })
      ));
      if (node.kind === 'group') {
        form.append(field(
          'Sposób przechodzenia',
          selectInput(node.navigation || 'free', 'navigation', [
            { value: 'free', label: 'Dowolna kolejność (harmonijka)' },
            { value: 'sequential', label: 'Po kolei (organizer)' }
          ]),
          node.navigation === 'sequential'
            ? 'Kolejny moduł odblokuje się dopiero po ukończeniu wszystkich wcześniejszych kroków.'
            : 'Uczeń może otwierać materiały w dowolnej kolejności.'
        ));
        if (node.navigation !== 'sequential') {
          const tools = create('section', 'inspector-progress-settings organizer-insert-tools');
          tools.append(
            create('h3', '', 'Organizer wewnątrz tej harmonijki'),
            create('p', 'field-help', 'Dodaj osobny blok z kolejnością do już istniejącej harmonijki. Jej pozostałe materiały zachowają dowolną kolejność.'),
          );
          const addOrganizer = create('button', 'button button-primary', 'Dodaj organizer po kolei');
          addOrganizer.type = 'button';
          addOrganizer.dataset.inspectorAction = 'add-organizer-child';
          addOrganizer.disabled = node.level >= 6;
          if (node.level >= 6) addOrganizer.title = 'Osiągnięto maksymalny poziom zagnieżdżenia harmonijek.';
          tools.append(addOrganizer);
          form.append(tools);
        }
      }
    } else if (node.kind === 'text' || node.kind === 'notice') {
      form.append(field(
        node.kind === 'notice' ? 'Treść komunikatu' : 'Treść pola',
        textareaInput(node.text, 'text', { rows: 5, maxLength: 1000 }),
        'Dashboard wyświetla bezpieczny tekst — kod HTML nie zostanie wykonany.'
      ));
    } else if (node.kind === 'module') {
      form.append(
        field('Tytuł karty', textInput(node.title, 'title', { maxLength: 140 })),
        field('Krótki opis', textareaInput(node.description, 'description', { rows: 3, maxLength: 420 }))
      );
      const definition = dashboardModelApi.MODULE_DEFINITIONS[node.module] || dashboardModelApi.MODULE_DEFINITIONS.link;
      if (node.module === 'google') {
        form.append(
          field('Link do pliku lub notatnika Google', textInput(node.id, 'id', { maxLength: 2000, placeholder: 'https://drive.google.com/file/d/…/view' }), 'Pliki MP3, filmy, PDF, dokumenty i foldery. Plik musi być udostępniony uczestnikom. Notebook Google otwiera się w nowej karcie.'),
          field('Szerokość podglądu (%)', textInput(String(node.embedWidth), 'embedWidth', { type: 'number', min: 20, max: 100 })),
          field('Wysokość podglądu (% okna)', textInput(String(node.embedHeightPercent), 'embedHeightPercent', { type: 'number', min: 20, max: 150 }), 'Np. 25% dla audio, 60% dla wideo, 90% dla dokumentu. Podgląd otwiera się od razu po wejściu z kafelka.')
        );
      }
      if (['slides', 'pdf', 'film', 'yt', 'forms'].includes(node.module)) {
        const directWebMode = ['slides', 'pdf'].includes(node.module)
          && ['4', '5'].includes(String(node.protection));
        form.append(field(
          definition.idLabel || 'ID materiału',
          textInput(node.id, 'id', {
            placeholder: directWebMode ? 'https://…' : 'Wklej ID albo pełny link'
          }),
          node.module === 'film'
            ? 'Dla type=2 podaj ID lub link Google Drive; pozostałe tryby korzystają z YouTube.'
            : directWebMode
              ? node.protection === '4'
                ? 'Wklej pełny adres HTTPS. Strona zostanie osadzona w iframe, jeśli jej właściciel na to pozwala.'
                : 'Wklej pełny adres HTTPS. Po sprawdzeniu dostępu moduł otworzy go bezpośrednio w zwykłym widoku przeglądarki.'
              : 'Możesz wkleić samo ID lub obsługiwany link udostępniania.'
        ));
      }
      const protection = dashboardModelApi.PROTECTION_OPTIONS[node.module];
      if (protection) {
        form.append(field(
          'Tryb wyświetlania / ochrony',
          selectInput(node.protection, 'protection', protection),
          'Ochrona ogranicza interfejs i typowe pobieranie, ale nie jest zabezpieczeniem DRM.'
        ));
      }
      if (node.module === 'lesson') {
        form.append(field(
          'Repozytorium',
          selectInput(node.repositoryId, 'repositoryId', repositoryOptions(true))
        ));
        form.append(field(
          'Plik lekcji',
          repositoryFilenameInput(node.file, 'file', 'lesson', 'md', node.repositoryId),
          'Wybierz materiał z biblioteki albo wpisz nazwę jego pliku.'
        ));
      }
      if (node.module === 'exam') {
        form.append(field(
          'Repozytorium',
          selectInput(node.repositoryId, 'repositoryId', repositoryOptions(true))
        ));
        const exams = state.contentLibrary.exams
          .filter((asset) => !node.repositoryId || asset.repositoryId === node.repositoryId);
        form.append(field(
          'Egzamin',
          materialPicker(textInput(node.examId, 'examId', { placeholder: 'Wyszukaj egzamin…' }), exams, {
            type: 'Egzamin',
            icon: 'E',
            empty: 'Brak egzaminów w tej bibliotece.',
            allowCustom: false
          }),
          'Karta przechowuje tylko repositoryId i examId. Definicja pozostaje w jednym pliku exam.json.'
        ));
      }
      if (node.module === 'presentation') {
        form.append(field(
          'Repozytorium',
          selectInput(node.repositoryId, 'repositoryId', repositoryOptions(true))
        ));
        const presentations = state.contentLibrary.presentations
          .filter((asset) => !node.repositoryId || asset.repositoryId === node.repositoryId);
        form.append(field(
          'Prezentacja',
          materialPicker(textInput(node.presentationId, 'presentationId', { placeholder: 'Wyszukaj prezentację…' }), presentations, {
            type: 'Prezentacja',
            icon: 'S',
            empty: 'Brak prezentacji w tej bibliotece.',
            allowCustom: false
          }),
          'Karta wskazuje presentation.json. Stare moduły Google Slides nadal działają niezależnie.'
        ));
      }
      if (node.module === 'quiz') {
        form.append(field(
          'Repozytorium',
          selectInput(node.repositoryId, 'repositoryId', repositoryOptions(true))
        ));
        const quizzes = state.contentLibrary.quizzes
          .filter((asset) => !node.repositoryId || asset.repositoryId === node.repositoryId);
        form.append(field(
          'Quiz',
          materialPicker(textInput(node.quizId, 'quizId', { placeholder: 'Wyszukaj quiz…' }), quizzes, {
            type: 'Quiz',
            icon: 'Q',
            empty: 'Brak quizów w tej bibliotece.',
            allowCustom: false
          }),
          'Karta wskazuje quizzes/<quizId>/quiz.json i otwiera tylko opublikowaną definicję.'
        ));
      }
      if (node.module === 'chat') {
        form.append(field(
          'Repozytorium',
          selectInput(node.repositoryId, 'repositoryId', repositoryOptions(true))
        ));
        form.append(field(
          'Źródło promptu',
          selectInput(node.source, 'source', [
            { value: 'prompt', label: 'Plik JSON' },
            { value: 'file', label: 'Punkt z pliku TXT' }
          ])
        ));
        if (node.source === 'file') {
          const row = create('div', 'field-row');
          row.append(
            field('Plik TXT', repositoryFilenameInput(node.file, 'file', 'prompt', 'txt', node.repositoryId)),
            field('Numer punktu', textInput(node.point, 'point', { type: 'number', placeholder: '1' }))
          );
          form.append(row);
        } else {
          form.append(field(
            'Plik JSON',
            repositoryFilenameInput(node.prompt, 'prompt', 'prompt', 'json', node.repositoryId),
            'Lista zawiera materiały z Twojej biblioteki.'
          ));
        }
      }
      if (node.module === 'calculator' || node.module === 'whiteboard') {
        form.append(field(
          'Wariant narzędzia',
          selectInput(node.variant, 'variant', definition.variants)
        ));
      }
      if (node.module === 'contact') {
        form.append(field(
          'Wstępna treść wiadomości',
          textareaInput(node.internal, 'internal', { rows: 4, maxLength: 240 })
        ));
      }
      if (node.module === 'atonom') {
        form.append(field(
          definition.formulaLabel || 'Nazwa związku',
          textInput(node.formula, 'formula', {
            placeholder: 'np. kwas octowy, etanol, cis-but-2-en',
            maxLength: 140
          }),
          'Nazwa trafi do adresu jako parametr ?formula=… i ATONOM od razu otworzy wybrany model.'
        ));
      }
      if (node.module === 'link') {
        form.append(field(
          'Adres linku',
          textInput(node.href, 'href', { placeholder: 'https://…' }),
          'Dozwolony jest pełny adres HTTPS albo wewnętrzna ścieżka zaczynająca się od /.'
        ));
      }
      if (node.module === 'slides' || node.module === 'presentation') {
        form.append(field(
          'Sposób liczenia prezentacji',
          selectInput(node.presentationMode || 'highest', 'presentationMode', [
            { value: 'highest', label: 'Najwyższy osiągnięty slajd' },
            { value: 'visited', label: 'Odwiedzone slajdy' },
            { value: 'required', label: 'Wszystkie wymagane slajdy' }
          ]),
          'Dokładne dane wymagają playera przekazującego zdarzenia slajdów; osadzony Google Slides raportuje samo otwarcie.'
        ));
      }
      if (node.module === 'film' || node.module === 'yt') {
        form.append(field(
          'Próg ukończenia filmu (%)',
          textInput(String(node.videoCompletionThreshold || 90), 'videoCompletionThreshold', { type: 'number' }),
          'Zakres 1–100%. Przewinięcie bez odtworzenia nie zwiększa rzeczywiście obejrzanego zakresu.'
        ));
      }
    }

    if (['dashboard', 'section', 'group', 'module'].includes(node.kind)) dashboardProgressFields(form, found);

    if (node.kind !== 'dashboard') form.append(inspectorActions());
    elements.dashboardInspector.append(form);
  }

  function dashboardPreviewGroup(group) {
    const sequential = group.navigation === 'sequential';
    const wrapper = create('div', `preview-group${sequential ? ' is-sequential' : ''}`);
    wrapper.append(create('strong', '', group.title));
    if (sequential) wrapper.append(create('small', 'preview-sequence-label', 'Moduły odblokowywane po kolei'));
    const directCards = group.items || [];
    if (directCards.length) {
      const grid = create('div', 'preview-card-grid');
      directCards.forEach((item, index) => {
        const card = create('div', 'preview-card');
        if (sequential) card.append(create('span', 'preview-sequence-step', String(index + 1)));
        card.append(create('strong', '', item.title), create('small', '', item.description || item.href));
        grid.append(card);
      });
      wrapper.append(grid);
    }
    (group.groups || []).forEach((child) => wrapper.append(dashboardPreviewGroup(child)));
    return wrapper;
  }

  function previewToolbar(mode) {
    const toolbar = create('div', 'preview-toolbar');
    const copy = create('div');
    copy.append(
      create('strong', '', mode === 'dashboard' ? 'Podgląd dashboardu' : 'Podgląd slajdu'),
      create('small', '', mode === 'dashboard'
        ? 'Cały układ możesz otworzyć w osobnym oknie.'
        : 'Osobne okno pokaże wszystkie slajdy lekcji.')
    );
    const button = create('button', 'button button-soft preview-open-button', 'Otwórz pełny podgląd');
    button.type = 'button';
    button.dataset.fullPreview = mode;
    button.setAttribute('aria-label', mode === 'dashboard'
      ? 'Otwórz pełny podgląd dashboardu w nowym oknie'
      : 'Otwórz pełny podgląd lekcji w nowym oknie');
    toolbar.append(copy, button);
    return toolbar;
  }

  function buildDashboardPreviewShell() {
    const model = dashboardModelApi.toDashboardModel(state.dashboard.model);
    const shell = create('div', 'dashboard-preview-shell');
    const hero = create('div', 'preview-hero');
    hero.append(
      create('small', '', 'Panel kursanta'),
      create('h2', '', model.title),
      create('p', '', model.intro.join(' ') || 'Bez opisu powitalnego.')
    );
    shell.append(hero);
    model.sections.forEach((section) => {
      const card = create('section', 'preview-section');
      const header = document.createElement('header');
      const groupCount = (section.groups || []).length;
      header.append(
        create('h3', '', section.title),
        create('span', '', `${section.items.length} kart · ${groupCount} harmonijek`)
      );
      card.append(header);
      if (section.items.length) {
        const grid = create('div', 'preview-card-grid');
        section.items.forEach((item) => {
          const previewCard = create('div', 'preview-card');
          previewCard.append(
            create('strong', '', item.title),
            create('small', '', item.description || item.href)
          );
          grid.append(previewCard);
        });
        card.append(grid);
      }
      section.groups.forEach((group) => card.append(dashboardPreviewGroup(group)));
      shell.append(card);
    });
    return shell;
  }

  function renderDashboardPreview() {
    elements.dashboardPreview.replaceChildren(
      previewToolbar('dashboard'),
      buildDashboardPreviewShell()
    );
    syncFullPreview('dashboard');
  }

  function updateDashboardNodeSummary() {
    const found = state.dashboard.selectedUid
      ? dashboardModelApi.findNode(state.dashboard.model, state.dashboard.selectedUid)
      : null;
    if (!found) return;
    const target = all('[data-node-uid]', elements.dashboardCanvas)
      .find((node) => node.dataset.nodeUid === found.node.uid);
    if (target) {
      const title = target.querySelector('.node-copy strong');
      const subtitle = target.querySelector('.node-copy small');
      if (title) title.textContent = dashboardNodeTitle(found.node) || 'Bez treści';
      if (subtitle) subtitle.textContent = dashboardNodeSubtitle(found.node);
      const chip = target.querySelector('.module-chip');
      if (chip && found.node.kind === 'module') chip.textContent = dashboardModelApi.moduleHref(found.node);
    }
  }

  function updateDashboardDirtyState() {
    let current = '';
    try {
      current = dashboardModelApi.serialize(state.dashboard.model, { ensureRequiredHelp: true }).trim();
    } catch (_) {}
    const dirty = !state.dashboard.remoteLoaded
      || state.dashboard.catalogPending
      || current !== state.dashboard.baseline;
    elements.dashboardPublish.disabled = !state.dashboard.remoteLoaded
      || !dirty
      || state.dashboard.loading
      || state.dashboard.publishing;
    elements.dashboardPublish.title = !state.dashboard.remoteLoaded
      ? 'Najpierw wczytaj aktywną wersję dashboardu'
      : state.dashboard.catalogPending ? 'Ponów synchronizację katalogu postępu'
      : dirty ? 'Udostępnij nowy układ uczestnikom kursu' : 'Brak zmian do opublikowania';
    if (state.dashboard.remoteLoaded && !dirty && !state.dashboard.publishing) {
      setSaveIndicator('Zgodny z aktywną wersją', 'saved');
    }
  }

  function renderDashboard() {
    if (!state.dashboard.model) return;
    elements.dashboardTitle.value = state.dashboard.model.title;
    elements.dashboardIntro.value = state.dashboard.model.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n');
    renderDashboardCanvas();
    renderDashboardInspector();
    renderDashboardPreview();
    updateDashboardDirtyState();
  }

  function cloneDashboardNode(value) {
    const clone = JSON.parse(JSON.stringify(value));
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      delete node.uid;
      if (Array.isArray(node.blocks)) node.blocks.forEach(visit);
    };
    visit(clone);
    return clone;
  }

  function cloneLessonNode(value) {
    const clone = JSON.parse(JSON.stringify(value));
    const questionIds = new Map();
    const reservedQuestionIds = new Set();
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      delete node.id;
      if (node.type === 'student-answer' && node.questionId) {
        const nextQuestionId = nextLessonQuestionId(node.question, reservedQuestionIds);
        reservedQuestionIds.add(nextQuestionId);
        questionIds.set(node.questionId, nextQuestionId);
        node.questionId = nextQuestionId;
      }
      if (Array.isArray(node.blocks)) node.blocks.forEach(visit);
      if (Array.isArray(node.answerKeyBlocks)) node.answerKeyBlocks.forEach(visit);
      if (node.task) visit(node.task);
    };
    visit(clone);
    const relink = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'answer-review' && questionIds.has(node.questionId)) {
        node.questionId = questionIds.get(node.questionId);
      }
      if (Array.isArray(node.blocks)) node.blocks.forEach(relink);
      if (Array.isArray(node.answerKeyBlocks)) node.answerKeyBlocks.forEach(relink);
      if (node.task) relink(node.task);
    };
    relink(clone);
    return clone;
  }

  function dashboardNodeAction(action, uid) {
    const found = dashboardModelApi.findNode(state.dashboard.model, uid);
    if (!found || !found.container) return;
    if (action === 'add-organizer-child' && found.node.kind === 'group' && found.node.navigation !== 'sequential') {
      commitMutation('dashboard', () => {
        const inserted = dashboardModelApi.insertNode(
          state.dashboard.model,
          uid,
          createDashboardNode('organizer'),
          found.node.blocks.length
        );
        if (!inserted) {
          toast('Nie można dodać organizera', 'Ta harmonijka osiągnęła maksymalny poziom zagnieżdżenia.', 'error');
          return;
        }
        state.dashboard.selectedUid = inserted.uid;
        state.dashboard.collapsedNodes.delete(uid);
      });
      return;
    }
    if (
      action === 'toggle-collapse'
      && (found.node.kind === 'section' || found.node.kind === 'group')
    ) {
      if (state.dashboard.collapsedNodes.has(uid)) state.dashboard.collapsedNodes.delete(uid);
      else state.dashboard.collapsedNodes.add(uid);
      renderDashboardCanvas();
      return;
    }
    if (action === 'delete') {
      const needsConfirm = (found.node.kind === 'section' || found.node.kind === 'group')
        && Array.isArray(found.node.blocks)
        && found.node.blocks.length > 0;
      if (needsConfirm && !window.confirm(`Usunąć „${dashboardNodeTitle(found.node)}” razem z zawartością?`)) return;
      commitMutation('dashboard', () => {
        dashboardModelApi.removeNode(state.dashboard.model, uid);
        state.dashboard.selectedUid = '';
      });
      return;
    }
    if (action === 'duplicate') {
      commitMutation('dashboard', () => {
        const clone = cloneDashboardNode(found.node);
        const inserted = dashboardModelApi.insertNode(
          state.dashboard.model,
          found.parent.uid,
          clone,
          found.index + 1
        );
        if (inserted) state.dashboard.selectedUid = inserted.uid;
      });
      return;
    }
    if (action === 'up' || action === 'down') {
      const offset = action === 'up' ? -1 : 1;
      const nextIndex = found.index + offset;
      if (nextIndex < 0 || nextIndex >= found.container.length) return;
      commitMutation('dashboard', () => {
        dashboardModelApi.moveNode(state.dashboard.model, uid, found.parent.uid, nextIndex);
        state.dashboard.selectedUid = uid;
      });
    }
  }

  function dashboardDragPayload(event) {
    try {
      const raw = event.dataTransfer.getData('application/x-chemdisk-studio')
        || event.dataTransfer.getData('text/plain');
      return JSON.parse(raw || '');
    } catch (_) {
      return null;
    }
  }

  function setStudioDragPayload(dataTransfer, payload) {
    const raw = JSON.stringify(payload);
    dataTransfer.setData('application/x-chemdisk-studio', raw);
    dataTransfer.setData('text/plain', raw);
  }

  function clearDragClasses() {
    all('.is-dragover').forEach((node) => node.classList.remove('is-dragover'));
    all('.is-dragging').forEach((node) => node.classList.remove('is-dragging'));
  }

  function handleDashboardDrop(event) {
    const zone = event.target.closest('[data-dashboard-drop-parent]');
    if (!zone || !elements.dashboardCanvas.contains(zone)) return;
    event.preventDefault();
    const payload = dashboardDragPayload(event);
    const parentUid = zone.dataset.dashboardDropParent;
    const index = Number(zone.dataset.dashboardDropIndex);
    clearDragClasses();
    if (!payload) return;
    if (payload.source === 'dashboard-palette') {
      addDashboardNode(payload.type, parentUid, index);
      return;
    }
    if (payload.source === 'dashboard-node' && payload.uid) {
      commitMutation('dashboard', () => {
        const moved = dashboardModelApi.moveNode(state.dashboard.model, payload.uid, parentUid, index);
        if (!moved) {
          toast('Nie można przenieść klocka', 'Sprawdź poziom harmonijki i miejsce docelowe.', 'error');
          return;
        }
        state.dashboard.selectedUid = payload.uid;
      });
    }
  }

  async function responseJson(response) {
    try { return await response.json(); } catch (_) { return null; }
  }

  function dashboardServerError(response, payload) {
    const code = payload && payload.error;
    if (response.status === 409 || code === 'DASHBOARD_CONFLICT') {
      return 'Aktywna wersja zmieniła się w innej karcie. Szkic został zachowany — wczytaj aktualny układ panelu kursanta i porównaj zmiany.';
    }
    if (response.status === 401) return 'Sesja administratora wygasła. Zaloguj się ponownie.';
    if (response.status === 403) return 'Bieżące konto nie ma już uprawnień administratora.';
    if (code === 'DASHBOARD_STORAGE_UNAVAILABLE') return 'Zapisywanie jest chwilowo niedostępne. Twoje zmiany pozostały w edytorze.';
    if (code === 'MARKDOWN_TOO_LARGE') return 'Dashboard przekracza limit 256 KiB.';
    return `Nie udało się wykonać operacji (${response.status}).`;
  }

  async function adminToken() {
    const auth = window.ChemAuth;
    const user = auth && typeof auth.getUser === 'function' ? auth.getUser() : null;
    if (!isAdmin(user)) throw new Error('Ta funkcja jest dostępna tylko dla administratora.');
    if (!auth || typeof auth.getAccessToken !== 'function') throw new Error('Nie udało się odczytać sesji.');
    return auth.getAccessToken({ forceRefresh: true });
  }

  async function loadActiveDashboard() {
    if (state.dashboard.loading || state.dashboard.publishing) return;
    const localMarkdown = dashboardModelApi.serialize(state.dashboard.model, { ensureRequiredHelp: true }).trim();
    const localDirty = state.dashboard.remoteLoaded
      ? localMarkdown !== state.dashboard.baseline
      : Boolean(readStorage(DASHBOARD_DRAFT_KEY))
        || history.dashboard.undo.length > 0
        || Boolean(
          state.editSession
          && state.editSession.mode === 'dashboard'
          && snapshot('dashboard') !== state.editSession.before
        );
    if (localDirty && !window.confirm('Wczytanie aktywnej wersji zastąpi bieżący szkic na tym urządzeniu. Kontynuować?')) return;
    state.dashboard.loading = true;
    elements.dashboardLoad.disabled = true;
    elements.dashboardPublish.disabled = true;
    setSaveIndicator('Wczytywanie aktywnej wersji…', 'saving');
    try {
      const token = await adminToken();
      const response = await fetch(dashboardModelApi.ADMIN_DASHBOARD_URL, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      const payload = await responseJson(response);
      if (!response.ok) throw new Error(dashboardServerError(response, payload));
      let content;
      let etag = null;
      let source = payload && payload.source === 'blob' ? 'blob' : 'static';
      let updatedAt = payload && payload.updatedAt ? payload.updatedAt : null;
      if (source === 'blob') {
        if (!payload || typeof payload.content !== 'string') throw new Error('Serwer zwrócił nieprawidłową treść dashboardu.');
        content = payload.content;
        etag = typeof payload.etag === 'string' ? payload.etag : null;
      } else {
        const fallback = payload && typeof payload.fallbackUrl === 'string'
          ? payload.fallbackUrl
          : dashboardModelApi.STATIC_DASHBOARD_URL;
        if (!fallback.startsWith('/members/')) throw new Error('Nieprawidłowa ścieżka wersji statycznej.');
        const staticResponse = await fetch(fallback, { cache: 'no-store', credentials: 'same-origin' });
        if (!staticResponse.ok) throw new Error('Nie udało się pobrać dashboard.md z wdrożenia.');
        content = await staticResponse.text();
      }
      const model = dashboardModelApi.parseMarkdown(content);
      history.dashboard.undo = [];
      history.dashboard.redo = [];
      state.dashboard.model = model;
      state.dashboard.selectedUid = '';
      state.dashboard.expectedEtag = etag;
      state.dashboard.remoteLoaded = true;
      state.dashboard.remoteSource = source;
      state.dashboard.remoteUpdatedAt = updatedAt;
      state.dashboard.baseline = dashboardModelApi.serialize(model, { ensureRequiredHelp: true }).trim();
      const pendingCatalog = readStorage(DASHBOARD_CATALOG_PENDING_KEY);
      state.dashboard.catalogPending = Boolean(
        source === 'blob'
        && pendingCatalog
        && pendingCatalog.etag === etag
        && pendingCatalog.baseline === state.dashboard.baseline
      );
      if (!state.dashboard.catalogPending && pendingCatalog) removeStorage(DASHBOARD_CATALOG_PENDING_KEY);
      scheduleDraftSave('dashboard');
      renderDashboard();
      toast(
        'Dashboard wczytany',
        source === 'blob' ? 'Edytujesz obecnie opublikowany układ.' : 'Edytujesz początkowy układ panelu kursanta.'
      );
    } catch (error) {
      setSaveIndicator('Błąd wczytywania', 'error');
      toast('Nie udało się wczytać dashboardu', error && error.message ? error.message : 'Spróbuj ponownie.', 'error');
    } finally {
      state.dashboard.loading = false;
      elements.dashboardLoad.disabled = false;
      updateDashboardDirtyState();
    }
  }

  function prepareDashboardPublish() {
    if (!state.dashboard.remoteLoaded) {
      toast('Najpierw wczytaj dashboard', 'Publikowanie jest dostępne po pobraniu aktualnego ETagu.', 'error');
      return;
    }
    const current = dashboardModelApi.serialize(
      state.dashboard.model,
      { ensureRequiredHelp: true }
    ).trim();
    if (current === state.dashboard.baseline && !state.dashboard.catalogPending) {
      toast('Brak zmian do publikacji', 'Aktywna wersja dashboardu jest już aktualna.');
      return;
    }
    const validation = dashboardModelApi.validate(state.dashboard.model);
    if (!validation.valid) {
      const first = validation.errors[0];
      if (first && first.uid) {
        state.dashboard.selectedUid = first.uid;
        renderDashboard();
      }
      toast('Uzupełnij konfigurację', first ? first.message : 'Dashboard zawiera błędy.', 'error');
      return;
    }
    elements.publishSummary.textContent = `${validation.sectionCount} sekcji · ${validation.moduleCount} kart · ${Math.round(validation.bytes / 1024)} KiB.`;
    elements.publishDialog.showModal();
  }

  async function publishDashboard() {
    if (state.dashboard.publishing || !state.dashboard.remoteLoaded) return;
    state.dashboard.publishing = true;
    elements.dashboardPublish.disabled = true;
    elements.dashboardLoad.disabled = true;
    setSaveIndicator('Publikowanie…', 'saving');
    let retryCatalogOnly = false;
    let dashboardPublishedThisAttempt = false;
    try {
      const current = dashboardModelApi.serialize(state.dashboard.model, { ensureRequiredHelp: true }).trim();
      retryCatalogOnly = state.dashboard.catalogPending && current === state.dashboard.baseline;
      const token = await adminToken();
      if (!retryCatalogOnly) {
        const payload = dashboardModelApi.createPublishPayload(
          state.dashboard.model,
          state.dashboard.expectedEtag
        );
        const response = await fetch(dashboardModelApi.ADMIN_DASHBOARD_URL, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        const result = await responseJson(response);
        if (!response.ok) {
          if (response.status === 409) state.dashboard.remoteLoaded = false;
          throw new Error(dashboardServerError(response, result));
        }
        if (!result || typeof result.content !== 'string' || typeof result.etag !== 'string') {
          throw new Error('Serwer nie potwierdził zapisanej wersji.');
        }
        state.dashboard.model = dashboardModelApi.parseMarkdown(result.content);
        state.dashboard.expectedEtag = result.etag;
        state.dashboard.remoteLoaded = true;
        state.dashboard.remoteSource = 'blob';
        state.dashboard.remoteUpdatedAt = result.updatedAt || null;
        state.dashboard.baseline = dashboardModelApi.serialize(
          state.dashboard.model,
          { ensureRequiredHelp: true }
        ).trim();
        dashboardPublishedThisAttempt = true;
        state.dashboard.catalogPending = true;
        writeStorage(DASHBOARD_CATALOG_PENDING_KEY, {
          etag: state.dashboard.expectedEtag,
          baseline: state.dashboard.baseline
        });
      }
      setSaveIndicator(retryCatalogOnly ? 'Ponawianie katalogu postępu…' : 'Synchronizacja katalogu postępu…', 'saving');
      const progressResponse = await fetch(ADMIN_PROGRESS_URL, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'catalog',
          catalog: dashboardModelApi.toProgressCatalog(state.dashboard.model)
        })
      });
      if (!progressResponse.ok) {
        const progressError = await responseJson(progressResponse);
        throw new Error(`Dashboard zapisano, ale konfiguracja postępu wymaga ponowienia (${progressError?.error || progressResponse.status}).`);
      }
      state.dashboard.catalogPending = false;
      removeStorage(DASHBOARD_CATALOG_PENDING_KEY);
      scheduleDraftSave('dashboard');
      renderDashboard();
      toast(retryCatalogOnly ? 'Katalog postępu zsynchronizowany' : 'Dashboard opublikowany', 'Nowy układ i liczenie postępu są już zgodne.');
    } catch (error) {
      const dashboardSaved = retryCatalogOnly || dashboardPublishedThisAttempt;
      setSaveIndicator(dashboardSaved ? 'Dashboard zapisany — ponów katalog postępu' : 'Publikacja nieudana', 'error');
      toast(
        dashboardSaved ? 'Dashboard jest już opublikowany' : 'Nie udało się opublikować',
        error && error.message ? error.message : 'Spróbuj ponownie.',
        'error'
      );
    } finally {
      state.dashboard.publishing = false;
      elements.dashboardLoad.disabled = false;
      updateDashboardDirtyState();
    }
  }

  function findLessonNode(id) {
    if (!id || !state.lesson.model) return null;
    const visitBlocks = (blocks, slide, parent) => {
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (block.id === id) {
          return { kind: 'block', node: block, array: blocks, index, slide, parent };
        }
        const nestedBlocks = lessonNestedBlocks(block);
        if (nestedBlocks) {
          const nested = visitBlocks(nestedBlocks, slide, block);
          if (nested) return nested;
        }
      }
      return null;
    };
    for (let index = 0; index < state.lesson.model.slides.length; index += 1) {
      const slide = state.lesson.model.slides[index];
      if (slide.id === id) {
        return {
          kind: 'slide',
          node: slide,
          array: state.lesson.model.slides,
          index,
          slide,
          parent: state.lesson.model
        };
      }
      if (slide.task && slide.task.id === id) {
        return { kind: 'task', node: slide.task, array: null, index: -1, slide, parent: slide };
      }
      const block = visitBlocks(slide.blocks, slide, slide);
      if (block) return block;
    }
    return null;
  }

  function selectedLessonSlide() {
    const found = findLessonNode(state.lesson.selectedId);
    if (found) return found.slide;
    return state.lesson.model.slides.find((slide) => slide.id === state.lesson.previewSlideId)
      || state.lesson.model.slides[0]
      || null;
  }

  function lessonNestedBlocks(block) {
    if (!block || typeof block !== 'object') return null;
    if (block.type === 'answer-review') {
      return Array.isArray(block.answerKeyBlocks) ? block.answerKeyBlocks : [];
    }
    return Array.isArray(block.blocks) ? block.blocks : null;
  }

  function visitLessonBlocks(visitor) {
    if (!state.lesson.model) return;
    let stopped = false;
    const visit = (blocks, slide, slideIndex, parent, inheritedRootIndex) => {
      for (let index = 0; index < blocks.length && !stopped; index += 1) {
        const block = blocks[index];
        const rootIndex = parent === slide ? index : inheritedRootIndex;
        if (visitor(block, { slide, slideIndex, parent, index, rootIndex }) === false) {
          stopped = true;
          return;
        }
        const nested = lessonNestedBlocks(block);
        if (nested) visit(nested, slide, slideIndex, block, rootIndex);
      }
    };
    state.lesson.model.slides.forEach((slide, slideIndex) => {
      if (!stopped) visit(slide.blocks || [], slide, slideIndex, slide, -1);
    });
  }

  function lessonStudentAnswers(options = {}) {
    const answers = [];
    let questionNumber = 0;
    visitLessonBlocks((block, position) => {
      if (options.beforeBlockId && block.id === options.beforeBlockId) return false;
      if (block.type !== 'student-answer') return true;
      questionNumber += 1;
      const question = String(block.question || '').replace(/\s+/g, ' ').trim();
      answers.push({
        block,
        ...position,
        label: `Pytanie ${questionNumber} — ${question || block.questionId || 'bez treści'}`.slice(0, 150)
      });
      return true;
    });
    return answers;
  }

  function lessonStudentAnswerByQuestionId(questionId) {
    let match = null;
    visitLessonBlocks((block, position) => {
      if (block.type === 'student-answer' && block.questionId === questionId) {
        match = { block, ...position };
        return false;
      }
      return true;
    });
    return match;
  }

  function lessonAnswerReviews(questionId) {
    const matches = [];
    visitLessonBlocks((block, position) => {
      if (block.type === 'answer-review' && block.questionId === questionId) {
        matches.push({ block, ...position });
      }
      return true;
    });
    return matches;
  }

  function lessonStudentAnswersBeforePosition(slide) {
    const targetSlideIndex = state.lesson.model.slides.indexOf(slide);
    return lessonStudentAnswers().filter((item) => item.slideIndex < targetSlideIndex);
  }

  function questionIdSlug(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 42);
  }

  function nextLessonQuestionId(question, reserved) {
    const used = new Set(reserved || []);
    visitLessonBlocks((block) => {
      if (block.type === 'student-answer' && block.questionId) used.add(block.questionId);
      return true;
    });
    const stem = `q_${questionIdSlug(question) || 'pytanie'}`;
    let candidate = stem;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${stem}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function defaultAnswerReview(questionId, question) {
    return lessonModelApi.createBlock('answer-review', {
      questionId: questionId || '',
      question: question || '',
      showStudentAnswer: true,
      aiEnabled: true,
      aiInstruction: 'Oceń sens merytoryczny odpowiedzi. Nie wymagaj identycznego słownictwa jak w kluczu.',
      order: 'student-first',
      answerKeyBlocks: [lessonModelApi.createBlock('text', {
        text: 'Wpisz przygotowany przez autora klucz odpowiedzi.'
      })]
    });
  }

  function lessonBlockDefaults(type) {
    if (type === 'heading') return lessonModelApi.createBlock('heading', { level: 2, text: 'Nowy nagłówek' });
    if (type === 'text') return lessonModelApi.createBlock('text', { text: 'Nowy akapit tekstu.' });
    if (type === 'style') {
      return lessonModelApi.createBlock('style', {
        font: 'sans',
        color: '',
        background: '',
        size: 'normal',
        align: 'left',
        bold: false,
        blocks: [lessonModelApi.createBlock('text', { text: 'Wpisz tekst i ustaw jego wygląd.' })]
      });
    }
    if (type === 'image') {
      return lessonModelApi.createBlock('image', {
        url: 'https://',
        alt: 'Opis ilustracji'
      });
    }
    if (type === 'list') {
      return lessonModelApi.createBlock('list', {
        ordered: false,
        items: ['Pierwszy punkt', 'Drugi punkt']
      });
    }
    if (type === 'table') {
      return lessonModelApi.createBlock('table', {
        caption: 'Porównanie właściwości',
        align: 'left',
        headers: ['Substancja', 'Wzór', 'Właściwość'],
        rows: [
          ['Woda', 'H2O', 'ciecz'],
          ['Tlen', 'O2', 'gaz'],
          ['Chlorek sodu', 'NaCl', 'ciało stałe']
        ]
      });
    }
    if (type === 'quote') {
      return lessonModelApi.createBlock('quote', {
        text: 'Dodaj ważny cytat, definicję albo regułę do zapamiętania.'
      });
    }
    if (type === 'callout') {
      return lessonModelApi.createBlock('callout', {
        tone: 'tip',
        title: 'Wskazówka',
        text: 'Dodaj krótką, wyróżnioną informację.'
      });
    }
    if (type === 'code') {
      return lessonModelApi.createBlock('code', {
        language: '',
        code: 'Wpisz tutaj kod albo wzór tekstowy.'
      });
    }
    if (type === 'youtube') {
      return lessonModelApi.createBlock('youtube', {
        video: 'M7lc1UVf-VE',
        title: 'Film do lekcji'
      });
    }
    if (type === 'slides') {
      return lessonModelApi.createBlock('slides', {
        presentation: '',
        published: false,
        controls: true,
        title: 'Prezentacja Google Slides'
      });
    }
    if (type === 'google') return lessonModelApi.createBlock('google', { title: 'Materiał Google', url: '', width: 100, heightPercent: 60 });
    if (type === 'presentation') {
      const firstPresentation = state.contentLibrary.presentations[0];
      return lessonModelApi.createBlock('presentation', {
        title: firstPresentation?.title || 'Prezentacja',
        description: 'Otwórz prezentację przygotowaną do tej lekcji.',
        button: 'Otwórz prezentację',
        repositoryId: state.contentLibrary.selectedRepositoryId,
        presentationId: firstPresentation?.filename || ''
      });
    }
    if (type === 'quiz' || type === 'study') {
      const firstQuiz = state.contentLibrary.quizzes[0];
      return lessonModelApi.createBlock(type, {
        title: type === 'study' ? 'Powtórka / Fiszki' : firstQuiz?.title || 'Quiz',
        description: type === 'study' ? 'Utrwal materiał w puli nauki.' : 'Rozwiąż quiz przygotowany do tej lekcji.',
        button: type === 'study' ? 'Rozpocznij powtórkę' : 'Otwórz quiz',
        repositoryId: state.contentLibrary.selectedRepositoryId,
        quizId: type === 'study' ? '' : firstQuiz?.filename || ''
      });
    }
    if (type === 'pdf') {
      return lessonModelApi.createBlock('pdf', {
        title: 'Dokument PDF',
        description: 'Otwórz dokument PDF do tej lekcji.',
        button: 'Otwórz PDF',
        pdfId: '',
        protection: '1'
      });
    }
    if (type === 'exam') {
      const firstExam = state.contentLibrary.exams[0];
      return lessonModelApi.createBlock('exam', {
        title: firstExam?.title || 'Egzamin do lekcji',
        description: 'Ukończ egzamin, aby kontynuować naukę zgodnie z warunkiem tego kroku.',
        button: 'Otwórz egzamin',
        repositoryId: state.contentLibrary.selectedRepositoryId,
        examId: firstExam?.filename || '',
        requirement: 'optional',
        minimumScore: 75
      });
    }
    if (type === 'atonom') {
      return lessonModelApi.createBlock('atonom', {
        formula: 'fenol',
        title: 'Model cząsteczki w ATONOM'
      });
    }
    if (type === 'formula') {
      return lessonModelApi.createBlock('formula', {
        mode: 'chemistry',
        title: 'Spalanie wodoru',
        left: '2 H2 + O2',
        arrow: '->',
        above: '450 °C',
        below: 'kat. Pt',
        right: '2 H2O'
      });
    }
    if (type === 'ai') {
      return lessonModelApi.createBlock('ai', {
        title: 'Masz pytanie do tego slajdu?',
        description: 'Otwórz asystenta AI — treść slajdu zostanie dołączona jako kontekst.',
        button: 'Zapytaj AI',
        repositoryId: state.contentLibrary.selectedRepositoryId,
        promptFile: '',
        promptPoint: 1,
        authorContext: '',
        includeSlide: true,
        includeTask: true
      });
    }
    if (type === 'board') {
      return lessonModelApi.createBlock('board', {
        title: 'Otwórz białą tablicę',
        description: 'Rozpisz rozwiązanie, równanie albo schemat na interaktywnej tablicy.',
        button: 'Otwórz tablicę',
        variant: 'whiteboard',
        path: '',
        newTab: true
      });
    }
    if (type === 'contact') {
      return lessonModelApi.createBlock('contact', {
        title: 'Masz pytanie do prowadzącego?',
        description: 'Wyślij wiadomość przez formularz kontaktowy platformy.',
        button: 'Otwórz formularz',
        internal: 'Pytanie dotyczące bieżącej lekcji',
        newTab: false
      });
    }
    if (type === 'link') {
      return lessonModelApi.createBlock('link', {
        title: 'Otwórz materiał dodatkowy',
        description: 'Kliknij kafelek, aby przejść do wybranej strony lub modułu.',
        url: '/members/',
        icon: 'link',
        color: '#0e665a',
        newTab: false
      });
    }
    if (type === 'flashcards') {
      return lessonModelApi.createBlock('flashcards', {
        title: 'Fiszki do utrwalenia',
        color: '#7c3aed',
        cards: [
          { front: 'Alkohol', back: 'Związek zawierający grupę hydroksylową –OH.' },
          { front: 'Aldehyd', back: 'Związek zawierający końcową grupę –CHO.' },
          { front: 'Keton', back: 'Związek z grupą karbonylową wewnątrz łańcucha.' }
        ]
      });
    }
    if (type === 'student-answer') {
      const question = 'Dlaczego ten przykład spełnia warunki opisane na slajdzie?';
      return lessonModelApi.createBlock('student-answer', {
        questionId: nextLessonQuestionId(question),
        question,
        label: 'Twoja odpowiedź',
        placeholder: 'Napisz własnymi słowami…',
        minHeight: 160,
        multiline: true,
        maxLength: 2000,
        required: true,
        saveToProgress: true,
        allowEdit: true,
        button: 'Zapisz odpowiedź'
      });
    }
    if (type === 'answer-review') {
      const previous = lessonStudentAnswers().at(-1);
      return defaultAnswerReview(previous?.block.questionId || '', previous?.block.question || '');
    }
    if (type === 'accordion') {
      return lessonModelApi.createBlock('accordion', {
        title: 'Dodatkowe wyjaśnienie',
        open: false,
        blocks: [lessonModelApi.createBlock('text', { text: 'Treść widoczna po rozwinięciu harmonijki.' })]
      });
    }
    return lessonModelApi.createBlock('text', { text: 'Nowa treść.' });
  }

  function lessonTaskDefaults(type) {
    const taskType = type.replace(/^task-/, '');
    if (taskType === 'abcd') {
      return lessonModelApi.createTask({
        type: 'abcd',
        question: 'Wybierz poprawną odpowiedź.',
        label: 'Zaznacz jedną odpowiedź',
        options: ['Odpowiedź A', 'Odpowiedź B', 'Odpowiedź C', 'Odpowiedź D'],
        correctOption: 'A',
        hint: 'Dodaj podpowiedź.',
        feedback: 'Dobrze! Możesz przejść dalej.'
      });
    }
    if (taskType === 'true-false' || taskType === 'prawda-falsz') {
      return lessonModelApi.createTask({
        type: 'choice',
        question: 'Oceń, czy poniższe zdanie jest prawdziwe czy fałszywe.',
        label: 'Wybierz Prawda lub Fałsz',
        options: ['Prawda', 'Fałsz'],
        answers: ['Prawda'],
        hint: 'Zwróć uwagę na kluczowe pojęcia w zdaniu.',
        feedback: 'Znakomicie! Poprawna ocena.'
      });
    }
    if (taskType === 'choice') {
      return lessonModelApi.createTask({
        type: 'choice',
        question: 'Wybierz poprawną odpowiedź.',
        options: ['Pierwsza odpowiedź', 'Druga odpowiedź', 'Trzecia odpowiedź'],
        answers: ['Pierwsza odpowiedź'],
        hint: 'Dodaj podpowiedź.'
      });
    }
    if (taskType === 'number') {
      return lessonModelApi.createTask({
        type: 'number',
        question: 'Oblicz i wpisz wynik.',
        label: 'Wynik',
        placeholder: 'Wpisz liczbę',
        answers: ['0'],
        hint: 'Dodaj podpowiedź.'
      });
    }
    if (taskType === 'gaps') {
      return lessonModelApi.createTask({
        type: 'gaps',
        question: 'Uzupełnij zdanie, wybierając właściwe pojęcia.',
        text: 'Etanol należy do {{grupy związków}}, a jego grupą funkcyjną jest {{grupa funkcyjna}}.',
        label: 'Uzupełnij wszystkie luki',
        options: ['alkoholi', 'aldehydów', 'hydroksylowa', 'karboksylowa'],
        answers: ['alkoholi', 'hydroksylowa'],
        hint: 'Sprawdź końcówkę nazwy i wzór grupy funkcyjnej.'
      });
    }
    if (taskType === 'gaps-text') {
      return lessonModelApi.createTask({
        type: 'gaps-text',
        question: 'Uzupełnij zdanie własnymi odpowiedziami.',
        text: 'Woda ma wzór {{wzór sumaryczny}}, a jej masa molowa wynosi około {{masa molowa}} g/mol.',
        label: 'Wpisz odpowiedzi w luki',
        answers: ['H2O', '18'],
        checkMode: 'each',
        hint: 'Sprawdź symbole pierwiastków i obliczenie masy molowej.'
      });
    }
    return lessonModelApi.createTask({
      type: 'text',
      question: 'Wpisz poprawną odpowiedź.',
      label: 'Twoja odpowiedź',
      answers: ['odpowiedź'],
      hint: 'Dodaj podpowiedź.'
    });
  }

  function insertLessonBlock(slideId, parentBlockId, block, index) {
    const slide = state.lesson.model.slides.find((candidate) => candidate.id === slideId);
    if (!slide) return null;
    let target = slide.blocks;
    if (parentBlockId) {
      const parent = findLessonNode(parentBlockId);
      const nested = parent?.kind === 'block' ? lessonNestedBlocks(parent.node) : null;
      if (
        !parent
        || parent.kind !== 'block'
        || !nested
        || ['style', 'accordion', 'student-answer', 'answer-review'].includes(block.type)
      ) return null;
      target = nested;
    }
    const position = Number.isInteger(index)
      ? Math.max(0, Math.min(index, target.length))
      : target.length;
    target.splice(position, 0, block);
    return block;
  }

  function lessonDefaultTarget() {
    const selected = findLessonNode(state.lesson.selectedId);
    if (selected) {
      if (
        selected.kind === 'block'
        && ['style', 'accordion', 'answer-review'].includes(selected.node.type)
      ) {
        return { slideId: selected.slide.id, parentBlockId: selected.node.id };
      }
      if (selected.kind === 'block' && selected.parent?.type === 'answer-review') {
        return { slideId: selected.slide.id, parentBlockId: selected.parent.id };
      }
      return { slideId: selected.slide.id, parentBlockId: '' };
    }
    const slide = state.lesson.model.slides[state.lesson.model.slides.length - 1];
    return { slideId: slide ? slide.id : '', parentBlockId: '' };
  }

  function revealFeaturedLessonTool(type) {
    const labels = {
      formula: 'Kreator równań',
      ai: 'Ustawienia pomocy AI',
      board: 'Ustawienia tablicy',
      'student-answer': 'Pytanie otwarte',
      'answer-review': 'Omówienie odpowiedzi'
    };
    if (!labels[type]) return;

    applyStudioLayoutPart(elements.lessonWorkspace, 'inspector', false);
    activateInspectorPanel('lesson', 'inspector');
    saveStudioLayout();
    toast(`${labels[type]} — otwarte`, 'Ustawienia klocka znajdziesz w panelu Narzędzia i podgląd.');

    if (window.matchMedia?.('(max-width: 760px)').matches) {
      const panel = elements.lessonInspector.closest('.inspector-panel');
      window.requestAnimationFrame(() => {
        panel?.scrollIntoView({
          behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    }
  }

  function addLessonNode(type, target) {
    if (type === 'slide') {
      commitMutation('lesson', () => {
        const slide = lessonModelApi.createSlide({
          blocks: [
            lessonModelApi.createBlock('heading', { level: 2, text: `Krok ${state.lesson.model.slides.length + 1}` }),
            lessonModelApi.createBlock('text', { text: 'Treść nowego slajdu.' })
          ]
        });
        const index = target && Number.isInteger(target.index)
          ? Math.max(0, Math.min(target.index, state.lesson.model.slides.length))
          : state.lesson.model.slides.length;
        state.lesson.model.slides.splice(index, 0, slide);
        state.lesson.selectedId = slide.id;
        state.lesson.previewSlideId = slide.id;
      });
      return;
    }

    const insertion = target || lessonDefaultTarget();
    const slide = state.lesson.model.slides.find((candidate) => candidate.id === insertion.slideId)
      || state.lesson.model.slides[0];
    if (!slide) return;
    if (type.startsWith('task-')) {
      if (slide.task && !window.confirm('Ten slajd ma już pytanie. Zastąpić je nowym?')) return;
      commitMutation('lesson', () => {
        slide.task = lessonTaskDefaults(type);
        state.lesson.selectedId = slide.task.id;
        state.lesson.previewSlideId = slide.id;
      });
      return;
    }

    commitMutation('lesson', () => {
      const block = lessonBlockDefaults(type);
      if (type === 'answer-review') {
        const previous = lessonStudentAnswersBeforePosition(slide).at(-1);
        block.questionId = previous?.block.questionId || '';
        block.question = previous?.block.question || '';
      }
      const inserted = insertLessonBlock(
        slide.id,
        insertion.parentBlockId || '',
        block,
        insertion.index
      );
      if (!inserted) {
        toast(
          'Nie można zagnieździć klocka',
          'Kontenery oraz klocki pytania i omówienia muszą pozostać na poziomie slajdu.',
          'error'
        );
        return;
      }
      if (slide.layout === 'canvas' && !insertion.parentBlockId) {
        inserted.layout = defaultLessonCanvasLayout(Math.max(0, slide.blocks.indexOf(inserted)));
      }
      state.lesson.selectedId = inserted.id;
      state.lesson.previewSlideId = slide.id;
    });
    revealFeaturedLessonTool(type);
  }

  function createLinkedAnswerReview(studentAnswerId) {
    const found = findLessonNode(studentAnswerId);
    if (!found || found.kind !== 'block' || found.node.type !== 'student-answer') return;
    const existing = lessonAnswerReviews(found.node.questionId)[0];
    if (existing) {
      state.lesson.selectedId = existing.block.id;
      state.lesson.previewSlideId = existing.slide.id;
      renderLesson();
      toast('Omówienie już istnieje', 'Otworzyłem powiązany klocek z kluczem odpowiedzi.');
      return;
    }
    commitMutation('lesson', () => {
      const review = defaultAnswerReview(found.node.questionId, found.node.question);
      const slide = lessonModelApi.createSlide({
        blocks: [
          lessonModelApi.createBlock('heading', { level: 2, text: 'Omówienie odpowiedzi' }),
          review
        ]
      });
      const slideIndex = state.lesson.model.slides.indexOf(found.slide);
      state.lesson.model.slides.splice(slideIndex + 1, 0, slide);
      state.lesson.selectedId = review.id;
      state.lesson.previewSlideId = slide.id;
    });
    applyStudioLayoutPart(elements.lessonWorkspace, 'inspector', false);
    activateInspectorPanel('lesson', 'inspector');
    saveStudioLayout();
    toast('Slajd z omówieniem utworzony', 'Wpisz klucz odpowiedzi w zagnieżdżonych klockach. AI pozostaje opcjonalne.');
  }

  function regenerateLessonQuestionId(studentAnswerId) {
    const found = findLessonNode(studentAnswerId);
    if (!found || found.kind !== 'block' || found.node.type !== 'student-answer') return;
    commitMutation('lesson', () => {
      const previous = found.node.questionId;
      const next = nextLessonQuestionId(found.node.question);
      found.node.questionId = next;
      lessonAnswerReviews(previous).forEach(({ block }) => {
        block.questionId = next;
        block.question = found.node.question;
      });
      const previousPreviewKey = studioPreviewAnswerKey(previous);
      const nextPreviewKey = studioPreviewAnswerKey(next);
      if (state.lesson.previewOpenAnswers.has(previousPreviewKey)) {
        state.lesson.previewOpenAnswers.set(nextPreviewKey, state.lesson.previewOpenAnswers.get(previousPreviewKey));
        state.lesson.previewOpenAnswers.delete(previousPreviewKey);
      }
    });
    toast('Wygenerowano nowe questionId', 'Wszystkie powiązane omówienia zostały zaktualizowane.');
  }

  function addAnswerKeyBlock(type) {
    const found = findLessonNode(state.lesson.selectedId);
    if (!found || found.kind !== 'block' || found.node.type !== 'answer-review') return;
    if (['style', 'accordion', 'student-answer', 'answer-review'].includes(type)) return;
    commitMutation('lesson', () => {
      const block = lessonBlockDefaults(type);
      found.node.answerKeyBlocks.push(block);
      state.lesson.selectedId = block.id;
      state.lesson.previewSlideId = found.slide.id;
    });
  }

  function lessonBlockSymbol(block) {
    const symbols = {
      heading: 'H',
      text: 'T',
      list: '☷',
      table: '▦',
      image: '▧',
      quote: '❞',
      callout: '!',
      code: '</>',
      style: 'Aa',
      accordion: '⌄',
      youtube: 'YT',
      slides: 'GS',
      google: '▱',
      presentation: 'S',
      quiz: 'Q',
      pdf: 'PDF',
      exam: 'E',
      atonom: '⚛',
      formula: '∑',
      ai: '✦',
      board: '✎',
      contact: '✉',
      link: '↗',
      flashcards: '↻',
      'student-answer': 'Aa',
      'answer-review': '≋'
    };
    return symbols[block.type] || 'T';
  }

  function lessonBlockTitle(block) {
    if (block.type === 'heading') return block.text || 'Nagłówek';
    if (block.type === 'text') return block.text || 'Pusty akapit';
    if (block.type === 'list') return block.items.join(' · ') || 'Pusta lista';
    if (block.type === 'table') return block.caption || 'Tabela';
    if (block.type === 'image') return block.alt || 'Ilustracja';
    if (block.type === 'quote') return block.text || 'Cytat';
    if (block.type === 'callout') return block.title || 'Callout';
    if (block.type === 'code') return block.language ? `Kod: ${block.language}` : 'Blok kodu';
    if (block.type === 'style') return 'Stylowany tekst';
    if (block.type === 'accordion') return block.title || 'Harmonijka';
    if (block.type === 'youtube') return block.title || 'Film YouTube';
    if (block.type === 'slides') return block.title || 'Prezentacja Google Slides';
    if (block.type === 'google') return block.title || 'Materiał Google';
    if (block.type === 'presentation') return block.title || 'Prezentacja';
    if (['quiz', 'study'].includes(block.type)) return block.title || 'Quiz';
    if (block.type === 'pdf') return block.title || 'Dokument PDF';
    if (block.type === 'exam') return block.title || 'Egzamin';
    if (block.type === 'atonom') return block.title || `ATONOM: ${block.formula}`;
    if (block.type === 'formula') return block.title || (block.mode === 'math' ? 'Wzór matematyczny' : 'Równanie reakcji');
    if (block.type === 'ai') return block.title || 'Zapytaj AI o slajd';
    if (block.type === 'board') return block.title || 'Tablica interaktywna';
    if (block.type === 'contact') return block.title || 'Formularz kontaktowy';
    if (block.type === 'link') return block.title || 'Kafelek z linkiem';
    if (block.type === 'flashcards') return block.title || 'Fiszki';
    if (block.type === 'student-answer') return block.question || 'Pytanie otwarte';
    if (block.type === 'answer-review') return 'Omówienie odpowiedzi';
    return 'Klocek';
  }

  function lessonBlockSubtitle(block) {
    if (block.type === 'style') {
      return `${block.font} · ${block.size} · ${block.align}${block.bold ? ' · pogrubiony' : ''}${block.color ? ` · tekst ${block.color}` : ''}${block.background ? ` · tło ${block.background}` : ''}`;
    }
    if (block.type === 'accordion') return `${block.blocks.length} elementów · ${block.open ? 'otwarta' : 'zamknięta'}`;
    if (block.type === 'list') return `${block.items.length} punktów`;
    if (block.type === 'table') return `${block.headers.length} kolumn · ${block.rows.length} wierszy · ${block.align}`;
    if (block.type === 'image') return block.ref || block.url || 'Wybierz obraz';
    if (block.type === 'youtube') return block.video || 'Uzupełnij link lub ID filmu';
    if (block.type === 'slides') return block.presentation || 'Uzupełnij link lub ID prezentacji';
    if (block.type === 'google') return `${block.url || 'Wklej link do pliku Google'} · ${block.width}% / ${block.heightPercent}%`;
    if (block.type === 'presentation') return block.presentationId || 'Wybierz prezentację';
    if (['quiz', 'study'].includes(block.type)) return block.quizId || 'Wybierz quiz lub pulę';
    if (block.type === 'pdf') return `${block.pdfId || 'Uzupełnij ID lub adres PDF'} · tryb ${block.protection}`;
    if (block.type === 'exam') {
      const requirements = {
        optional: 'opcjonalny',
        completed: 'wymagane ukończenie',
        passed: 'wymagane zaliczenie',
        minimum_score: `minimum ${Math.max(0, Math.min(100, Number(block.minimumScore) || 0))}%`
      };
      return `${block.examId || 'wybierz egzamin'} · ${requirements[block.requirement] || requirements.optional}`;
    }
    if (block.type === 'atonom') return `Związek: ${block.formula || 'nieustawiony'}`;
    if (block.type === 'formula') {
      return block.mode === 'math'
        ? (block.expression || 'Uzupełnij wzór matematyczny')
        : `${block.left || '…'}${block.arrow ? ` ${block.arrow} ${block.right || '…'}` : ''}`;
    }
    if (block.type === 'ai') {
      const source = block.promptFile
        ? `AI · ${block.promptFile}${/\.txt$/i.test(block.promptFile) ? ` · punkt ${block.promptPoint}` : ''}`
        : 'AI · ogólny asystent';
      return `${source}${block.authorContext ? ' · opis autora' : ' · bez dodatkowego opisu'}`;
    }
    if (block.type === 'board') {
      return block.variant === 'bitpaper'
        ? `BitPaper${block.path ? ` · ${block.path}` : ''}`
        : 'Biała tablica';
    }
    if (block.type === 'contact') {
      return block.newTab ? 'Formularz · nowa karta' : 'Formularz · w module lekcji';
    }
    if (block.type === 'link') return block.url || 'Uzupełnij adres linku';
    if (block.type === 'flashcards') return `${block.cards.length} fiszki · ${block.color}`;
    if (block.type === 'student-answer') {
      return `${block.questionId || 'brak ID'} · ${block.required ? 'wymagane' : 'opcjonalne'} · ${block.saveToProgress ? 'zapis do postępu' : 'tylko lokalnie'}`;
    }
    if (block.type === 'answer-review') {
      const keyCount = Array.isArray(block.answerKeyBlocks) ? block.answerKeyBlocks.length : 0;
      return `${block.questionId || 'wybierz pytanie'} · ${keyCount} ${keyCount === 1 ? 'klocek klucza' : 'klocków klucza'} · ${block.aiEnabled ? 'AI na żądanie' : 'bez AI'}`;
    }
    const labels = {
      heading: `Nagłówek H${block.level}`,
      text: 'Akapit',
      quote: 'Cytat',
      callout: `Callout · ${block.tone}`,
      code: 'Kod'
    };
    return labels[block.type] || block.type;
  }

  function lessonActionButton(action, label, text, danger) {
    const button = create('button', `node-action${danger ? ' is-danger' : ''}`, text);
    button.type = 'button';
    button.dataset.lessonAction = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  function lessonDropZone(slideId, parentBlockId, index, label) {
    const zone = create('div', 'drop-zone', label || 'Upuść tutaj');
    zone.dataset.lessonDropKind = 'block';
    zone.dataset.lessonSlideId = slideId;
    zone.dataset.lessonParentBlockId = parentBlockId || '';
    zone.dataset.lessonDropIndex = String(index);
    return zone;
  }

  function renderLessonBlock(block, slide, parentBlock, index) {
    if (block.type === 'style' || block.type === 'accordion' || block.type === 'answer-review') {
      const container = create(
        'article',
        `builder-node group-node lesson-container${block.type === 'answer-review' ? ' answer-review-builder-node' : ''}`
      );
      container.dataset.lessonBlockId = block.id;
      container.dataset.lessonSlideId = slide.id;
      container.dataset.lessonParentBlockId = parentBlock ? parentBlock.id : '';
      container.dataset.lessonIndex = String(index);
      container.draggable = true;
      container.classList.toggle('is-selected', state.lesson.selectedId === block.id);
      const header = create('header', 'node-header');
      const drag = create('button', 'drag-handle drag-handle-notion', '::');
      drag.type = 'button';
      drag.setAttribute('aria-label', 'Przeciągnij klocek');
      drag.title = 'Przeciągnij klocek (::)';
      const symbol = create('span', 'node-symbol', lessonBlockSymbol(block));
      const copy = create('span', 'node-copy');
      copy.append(
        create('strong', '', lessonBlockTitle(block)),
        create('small', '', lessonBlockSubtitle(block))
      );
      const actions = create('span', 'node-actions');
      actions.append(
        lessonActionButton('up', 'Przesuń wyżej', '↑'),
        lessonActionButton('down', 'Przesuń niżej', '↓'),
        lessonActionButton('duplicate', 'Duplikuj', '⧉'),
        lessonActionButton('delete', 'Usuń', '×', true)
      );
      header.append(drag, symbol, copy, actions);
      const body = create('div', 'group-body');
      const nested = lessonNestedBlocks(block) || [];
      if (block.type === 'answer-review') {
        const keyHeader = create('div', 'answer-review-key-header');
        keyHeader.append(
          create('strong', '', 'Klucz odpowiedzi'),
          create('small', '', 'Zbuduj klucz z tych samych klocków co zwykły slajd. AI nie uruchamia się w kreatorze.')
        );
        body.append(keyHeader);
      }
      nested.forEach((child, childIndex) => {
        body.append(lessonDropZone(slide.id, block.id, childIndex));
        body.append(renderLessonBlock(child, slide, block, childIndex));
      });
      body.append(lessonDropZone(
        slide.id,
        block.id,
        nested.length,
        block.type === 'answer-review' ? 'Dodaj klocek do klucza odpowiedzi' : 'Dodaj do środka'
      ));
      container.append(header, body);
      return container;
    }

    const item = create('article', 'lesson-block');
    item.dataset.lessonBlockId = block.id;
    item.dataset.lessonSlideId = slide.id;
    item.dataset.lessonParentBlockId = parentBlock ? parentBlock.id : '';
    item.dataset.lessonIndex = String(index);
    item.dataset.blockType = block.type;
    item.draggable = true;
    item.classList.toggle('is-selected', state.lesson.selectedId === block.id);
    const drag = create('button', 'drag-handle drag-handle-notion', '::');
    drag.type = 'button';
    drag.setAttribute('aria-label', 'Przeciągnij klocek');
    drag.title = 'Przeciągnij klocek (::)';
    const symbol = create('span', 'node-symbol', lessonBlockSymbol(block));
    const copy = create('span', 'node-copy');
    copy.append(
      create('strong', '', lessonBlockTitle(block)),
      create('small', '', lessonBlockSubtitle(block))
    );
    const actions = create('span', 'node-actions');
    if (block.type === 'student-answer') {
      actions.append(lessonActionButton(
        'create-review',
        'Utwórz powiązany slajd z omówieniem',
        '↳'
      ));
    }
    actions.append(
      lessonActionButton('up', 'Przesuń wyżej', '↑'),
      lessonActionButton('down', 'Przesuń niżej', '↓'),
      lessonActionButton('duplicate', 'Duplikuj', '⧉'),
      lessonActionButton('delete', 'Usuń', '×', true)
    );
    item.append(drag, symbol, copy, actions);
    return item;
  }

  function slideTitle(slide, index) {
    const heading = slide.blocks.find((block) => block.type === 'heading');
    return heading && heading.text ? heading.text : `Slajd ${index + 1}`;
  }

  function slideTransitionLabel(value) {
    const labels = {
      none: 'bez przejścia',
      fade: 'łagodne zanikanie',
      rise: 'subtelnie w górę',
      slide: 'delikatnie z boku',
      zoom: 'miękkie przybliżenie'
    };
    return labels[value] || labels.fade;
  }

  function slideSummary(slide) {
    return `${slide.blocks.length} klocków${slide.task ? ' · 1 pytanie' : ''} · ${slideTransitionLabel(slide.transition)}`;
  }

  function gateConditionShortLabel(condition) {
    const type = condition?.type || 'next_click';
    const labels = {
      correct_answer: 'Zadanie',
      material_completed: 'Materiał',
      previous_completed: 'Poprzedni krok',
      exam_passed: 'Zaliczenie',
      quiz_completed: 'Quiz',
      minimum_score: `${condition?.minimumScore || 0}%`,
      next_click: 'Kliknięcie'
    };
    return labels[type] || type;
  }

  function renderLessonTask(task, slide) {
    const item = create('article', 'lesson-block task-block');
    item.dataset.lessonTaskId = task.id;
    item.dataset.lessonSlideId = slide.id;
    item.dataset.blockType = `task-${task.type}`;
    item.classList.toggle('is-selected', state.lesson.selectedId === task.id);
    const symbol = create(
      'span',
      'node-symbol',
      task.type === 'abcd'
        ? 'AB'
        : task.type === 'number'
          ? '#'
          : task.type === 'gaps'
            ? '□'
            : task.type === 'gaps-text' ? 'Aa' : '✓'
    );
    const copy = create('span', 'node-copy');
    copy.append(
      create('strong', '', task.question || 'Pytanie bez treści'),
      create(
        'small',
        '',
        task.type === 'abcd'
          ? 'Quiz ABCD'
          : task.type === 'gaps-text' ? 'Luki wpisywane ręcznie' : `Pytanie: ${task.type}`
      )
    );

    // 1-klik szybki wybór poprawnej odpowiedzi bezpośrednio na karcie zadania (Prompt 4.2)
    if ((task.type === 'abcd' || task.type === 'choice') && Array.isArray(task.options) && task.options.length) {
      const quickBar = create('div', 'task-quick-options');
      const correctIdx = taskCorrectOptionIndex(task);
      const isTrueFalse = task.options.length === 2 && task.options.includes('Prawda') && task.options.includes('Fałsz');
      task.options.forEach((opt, oIdx) => {
        const letter = String.fromCharCode(65 + oIdx);
        const isCorrect = oIdx === correctIdx;
        const text = isTrueFalse ? opt : (task.type === 'abcd' ? letter : (opt.length > 14 ? opt.slice(0, 12) + '…' : opt));
        const btn = create('button', `task-quick-option-btn${isCorrect ? ' is-correct' : ''}`, `${text}${isCorrect ? ' ✓' : ''}`);
        btn.type = 'button';
        btn.title = `Odpowiedź ${letter}: ${opt} (${isCorrect ? 'poprawna' : 'kliknij aby zaznaczyć jako poprawną'})`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          commitMutation('lesson', () => {
            task.correctOption = letter;
            task.answers = [task.type === 'abcd' ? letter : opt];
            state.lesson.selectedId = task.id;
          });
        });
        quickBar.append(btn);
      });
      copy.append(quickBar);
    }

    const actions = create('span', 'node-actions');
    actions.append(
      lessonActionButton('duplicate', 'Duplikuj pytanie na nowym slajdzie', '⧉'),
      lessonActionButton('delete', 'Usuń pytanie', '×', true)
    );
    item.append(symbol, copy, actions);
    return item;
  }

  function renderQuestionStarter(slide) {
    const starter = create('section', 'question-starter');
    starter.dataset.lessonSlideId = slide.id;
    const copy = create('div', 'question-starter-copy');
    copy.append(
      create('strong', '', 'Dodaj pytanie do tego slajdu'),
      create('small', '', 'Wybierz gotowy typ — odpowiedzi ustawisz w prostym formularzu.')
    );
    const actions = create('div', 'question-starter-actions');
    [
      ['task-abcd', 'Quiz ABCD'],
      ['task-true-false', 'Prawda / Fałsz'],
      ['task-choice', 'Wybór'],
      ['task-gaps', 'Luki z listy'],
      ['task-gaps-text', 'Luki tekstowe'],
      ['task-text', 'Krótka odpowiedź'],
      ['student-answer', 'Pytanie otwarte']
    ].forEach(([type, title]) => {
      const button = create('button', 'mini-button', title);
      button.type = 'button';
      button.dataset.lessonQuickTask = type;
      button.dataset.lessonSlideId = slide.id;
      actions.append(button);
    });
    starter.append(copy, actions);
    return starter;
  }

  function lessonSlideDropZone(index) {
    const zone = create('div', 'drop-zone', 'Upuść slajd tutaj');
    zone.dataset.lessonDropKind = 'slide';
    zone.dataset.lessonDropIndex = String(index);
    return zone;
  }

  const LESSON_SLASH_COMMANDS = [
    { type: 'text', cmd: '/tekst', title: 'Akapit tekstu', desc: 'Zwykły akapit z formatowaniem', icon: '¶', keywords: ['tekst', 'p', 'akapit', 'text'] },
    { type: 'heading', cmd: '/naglowek', title: 'Nagłówek', desc: 'Nagłówek H1 / H2 / H3', icon: 'H', keywords: ['naglowek', 'heading', 'h1', 'h2', 'h3', 'tytul'] },
    { type: 'task-abcd', cmd: '/zadanie', title: 'Quiz ABCD', desc: 'Pytanie z 4 opcjami i 1-klik kluczem', icon: '✓', keywords: ['zadanie', 'task', 'quiz', 'abcd', 'pytanie'] },
    { type: 'task-true-false', cmd: '/prawda-falsz', title: 'Prawda / Fałsz', desc: 'Szybkie pytanie 2-opcjowe', icon: '⚑', keywords: ['prawda', 'falsz', 'true', 'false', 'boolean'] },
    { type: 'image', cmd: '/obraz', title: 'Obraz / Grafika', desc: 'Z dysku, schowka lub biblioteki', icon: '🖼', keywords: ['obraz', 'image', 'zdjecie', 'grafika', 'foto', 'img'] },
    { type: 'formula', cmd: '/wzor', title: 'Wzór chemiczny / równanie', desc: 'KaTeX i reakcje chemiczne', icon: '⚗', keywords: ['wzor', 'formula', 'chemia', 'reakcja', 'math'] },
    { type: 'youtube', cmd: '/video', title: 'Wideo YouTube', desc: 'Film z YouTube z notatkami', icon: '▶', keywords: ['video', 'wideo', 'youtube', 'film', 'yt'] },
    { type: 'table', cmd: '/tabela', title: 'Tabela danych', desc: 'Tabela z nagłówkami i wierszami', icon: '▤', keywords: ['tabela', 'table', 'siatka'] },
    { type: 'study', cmd: '/fiszki', title: 'Mini-talia fiszek', desc: 'Talia powtórkowa wewnątrz lekcji', icon: '🗂', keywords: ['fiszki', 'flashcards', 'study', 'talia'] },
    { type: 'callout', cmd: '/wskazowka', title: 'Wskazówka / Uwaga', desc: 'Kolorowy box informacyjny', icon: '💡', keywords: ['wskazowka', 'uwaga', 'callout', 'info', 'tip', 'box'] },
    { type: 'code', cmd: '/kod', title: 'Blok kodu', desc: 'Formatowany kod lub zapis', icon: '</>', keywords: ['kod', 'code', 'program'] },
    { type: 'student-answer', cmd: '/pytanie-otwarte', title: 'Pytanie otwarte (matura)', desc: 'Zadanie dla ucznia z kluczem oceniania', icon: '✎', keywords: ['otwarte', 'student', 'answer', 'matura'] }
  ];

  function renderSlashMenu(slide, filterQuery, onSelect) {
    const menu = create('div', 'lesson-slash-menu');
    const header = create('div', 'slash-menu-header', 'Wstaw blok (Wybierz lub szukaj)');
    const list = create('div', 'slash-menu-list');

    const q = String(filterQuery || '').toLowerCase().trim();
    const filtered = LESSON_SLASH_COMMANDS.filter((cmd) => {
      if (!q) return true;
      return cmd.cmd.includes(q) || cmd.title.toLowerCase().includes(q) || cmd.keywords.some((k) => k.includes(q));
    });

    if (!filtered.length) {
      const empty = create('div', 'slash-menu-empty', 'Brak pasujących bloków');
      list.append(empty);
    } else {
      filtered.forEach((cmd, idx) => {
        const item = create('div', `slash-menu-item${idx === 0 ? ' is-active' : ''}`);
        item.dataset.cmdType = cmd.type;
        const icon = create('span', 'slash-menu-icon', cmd.icon);
        const details = create('div', 'slash-menu-details');
        const title = create('strong', '', cmd.title);
        const desc = create('small', '', `${cmd.cmd} · ${cmd.desc}`);
        details.append(title, desc);
        item.append(icon, details);
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelect(cmd.type);
        });
        list.append(item);
      });
    }

    menu.append(header, list);
    return menu;
  }

  function renderNotionPromptRow(slide) {
    const row = create('div', 'lesson-notion-prompt-row');
    row.dataset.lessonSlideId = slide.id;
    const handle = create('span', 'notion-prompt-icon', '::');
    handle.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'lesson-prompt-input';
    input.placeholder = "Wpisz tekst lub naciśnij '/' aby wstawić blok...";
    input.setAttribute('aria-label', "Wpisz tekst lub naciśnij '/' aby wstawić blok");
    input.dataset.lessonSlideId = slide.id;

    const triggerBtn = create('button', 'lesson-slash-trigger-btn', '＋');
    triggerBtn.type = 'button';
    triggerBtn.title = 'Wstaw blok (/)';
    triggerBtn.setAttribute('aria-label', 'Otwórz menu bloków (/)');

    row.append(handle, input, triggerBtn);

    let slashMenu = null;

    function closeSlashMenu() {
      if (slashMenu) {
        slashMenu.remove();
        slashMenu = null;
      }
    }

    function openSlashMenu(filterText) {
      closeSlashMenu();
      slashMenu = renderSlashMenu(slide, filterText || '', (chosenType) => {
        closeSlashMenu();
        input.value = '';
        addLessonNode(chosenType, { slideId: slide.id, index: slide.blocks.length });
      });
      row.append(slashMenu);
    }

    input.addEventListener('input', () => {
      const val = input.value;
      if (val.startsWith('/')) {
        openSlashMenu(val.slice(1).trim());
      } else if (slashMenu) {
        closeSlashMenu();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (slashMenu) {
          const activeItem = slashMenu.querySelector('.slash-menu-item.is-active');
          if (activeItem) {
            activeItem.click();
            return;
          }
        }
        const text = input.value.trim();
        if (text) {
          commitMutation('lesson', () => {
            const block = lessonModelApi.createBlock('text', { text });
            insertLessonBlock(slide.id, '', block, slide.blocks.length);
            state.lesson.selectedId = block.id;
            state.lesson.previewSlideId = slide.id;
          });
          input.value = '';
        }
      } else if (e.key === 'Escape') {
        closeSlashMenu();
        input.value = '';
      } else if (slashMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const items = Array.from(slashMenu.querySelectorAll('.slash-menu-item'));
        if (!items.length) return;
        const currentIdx = items.findIndex((it) => it.classList.contains('is-active'));
        let nextIdx = 0;
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
        }
        items.forEach((it, i) => it.classList.toggle('is-active', i === nextIdx));
        items[nextIdx].scrollIntoView({ block: 'nearest' });
      }
    });

    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (slashMenu) {
        closeSlashMenu();
      } else {
        openSlashMenu('');
        input.focus();
      }
    });

    document.addEventListener('click', (e) => {
      if (slashMenu && !row.contains(e.target)) {
        closeSlashMenu();
      }
    }, { passive: true });

    return row;
  }

  function renderLessonSlide(slide, index) {
    const article = create('article', 'lesson-slide');
    article.dataset.lessonSlideId = slide.id;
    article.dataset.lessonSlideIndex = String(index);
    article.draggable = true;
    article.classList.toggle('is-selected', state.lesson.selectedId === slide.id);
    const header = create('header', 'slide-header');
    const drag = create('button', 'drag-handle drag-handle-notion', '::');
    drag.type = 'button';
    drag.setAttribute('aria-label', 'Przeciągnij slajd');
    drag.title = 'Przeciągnij slajd (::)';
    const number = create('span', 'slide-index', String(index + 1).padStart(2, '0'));
    const copy = create('span', 'node-copy');
    copy.append(
      create('strong', '', slideTitle(slide, index)),
      create('small', '', slideSummary(slide))
    );

    // Gate Rule Badge & Quick Switch (Prompt 4.3)
    const gateRule = create('div', 'slide-gate-control');
    const isLocked = slide.requiredToAdvance !== false;
    const gateToggle = create('label', 'gate-switch-label');
    gateToggle.title = isLocked ? 'Krok zablokowany do ukończenia warunku' : 'Krok odblokowany (swobodne przejście)';
    const gateCheckbox = lessonInput('', 'slideRequiredToAdvance', { type: 'checkbox', checked: isLocked });
    gateCheckbox.dataset.lessonSlideId = slide.id;
    gateCheckbox.addEventListener('change', (e) => {
      e.stopPropagation();
      commitMutation('lesson', () => {
        slide.requiredToAdvance = gateCheckbox.checked;
        slide.progressConfigured = true;
      });
    });
    const gateSlider = create('span', 'gate-slider');
    const gateLabel = create('span', 'gate-label', isLocked ? '🔒 Wymagany' : '🔓 Swobodny');
    gateToggle.append(gateCheckbox, gateSlider, gateLabel);

    const conditionBadge = create('span', 'gate-condition-badge', gateConditionShortLabel(slide.condition));
    conditionBadge.title = `Warunek przejścia: ${slide.condition?.type || 'next_click'}`;
    gateRule.append(gateToggle, conditionBadge);

    const actions = create('span', 'node-actions');
    actions.append(
      lessonActionButton('up', 'Przesuń slajd wyżej', '↑'),
      lessonActionButton('down', 'Przesuń niżej', '↓'),
      lessonActionButton('duplicate', 'Duplikuj slajd', '⧉'),
      lessonActionButton('delete', 'Usuń slajd', '×', true)
    );
    header.append(drag, number, copy, gateRule, actions);
    const blocks = create('div', 'slide-blocks');
    slide.blocks.forEach((block, blockIndex) => {
      blocks.append(lessonDropZone(slide.id, '', blockIndex));
      blocks.append(renderLessonBlock(block, slide, null, blockIndex));
    });
    blocks.append(lessonDropZone(slide.id, '', slide.blocks.length, 'Dodaj klocek do slajdu'));

    // Prompt 4.1: Notion-like prompt row with Slash menu
    blocks.append(renderNotionPromptRow(slide));

    if (slide.task) blocks.append(renderLessonTask(slide.task, slide));
    else blocks.append(renderQuestionStarter(slide));
    article.append(header, blocks);
    return article;
  }

  function renderLessonCanvas() {
    if (window.NextMedUI?.render('studio-lesson', elements.lessonCanvas, {
      model: state.lesson.model, selected: state.lesson.selectedId,
      adapters: { title: lessonBlockTitle, subtitle: lessonBlockSubtitle, symbol: lessonBlockSymbol, nested: lessonNestedBlocks, slideTitle, slideSummary }
    })) { elements.lessonSlideCount.textContent = String(state.lesson.model.slides.length); return; }
    elements.lessonCanvas.replaceChildren();
    state.lesson.model.slides.forEach((slide, index) => {
      elements.lessonCanvas.append(
        lessonSlideDropZone(index),
        renderLessonSlide(slide, index)
      );
    });
    elements.lessonCanvas.append(lessonSlideDropZone(state.lesson.model.slides.length));
    elements.lessonSlideCount.textContent = String(state.lesson.model.slides.length);
  }

  function lessonInput(value, fieldName, options) {
    const input = document.createElement('input');
    input.type = options && options.type ? options.type : 'text';
    input.value = value == null ? '' : String(value);
    input.dataset.lessonField = fieldName;
    if (options && options.placeholder) input.placeholder = options.placeholder;
    if (options && options.maxLength) input.maxLength = options.maxLength;
    if (options && options.min !== undefined) input.min = options.min;
    if (options && options.max !== undefined) input.max = options.max;
    if (options && options.checked !== undefined) input.checked = Boolean(options.checked);
    return input;
  }

  function lessonTextarea(value, fieldName, options) {
    const textarea = document.createElement('textarea');
    textarea.value = value == null ? '' : String(value);
    textarea.dataset.lessonField = fieldName;
    textarea.rows = options && options.rows ? options.rows : 4;
    if (options && options.placeholder) textarea.placeholder = options.placeholder;
    if (options && options.maxLength) textarea.maxLength = options.maxLength;
    return textarea;
  }

  function lessonSelect(value, fieldName, options) {
    const select = document.createElement('select');
    select.dataset.lessonField = fieldName;
    (options || []).forEach((option) => {
      const item = document.createElement('option');
      item.value = typeof option === 'string' ? option : option.value;
      item.textContent = typeof option === 'string' ? option : option.label;
      select.append(item);
    });
    select.value = value == null ? '' : String(value);
    return select;
  }

  function defaultLessonCanvasLayout(index) {
    if (index === 0) return { mode: 'canvas', x: 4, y: 4, width: 92, height: 18 };
    const slot = index - 1;
    return {
      mode: 'canvas',
      x: slot % 2 === 0 ? 4 : 52,
      y: Math.min(66, 25 + Math.floor(slot / 2) * 32),
      width: 44,
      height: 27
    };
  }

  function ensureLessonCanvasLayout(slide) {
    (slide.blocks || []).forEach((block, index) => {
      if (!block.layout || block.layout.mode !== 'canvas') {
        block.layout = defaultLessonCanvasLayout(index);
      }
    });
  }

  function lessonInspectorActions(kind) {
    const footer = create('div', 'inspector-actions');
    const duplicate = create('button', 'button button-soft', 'Duplikuj');
    duplicate.type = 'button';
    duplicate.dataset.lessonInspectorAction = 'duplicate';
    const remove = create('button', 'button button-danger', kind === 'task' ? 'Usuń pytanie' : 'Usuń');
    remove.type = 'button';
    remove.dataset.lessonInspectorAction = 'delete';
    footer.append(duplicate, remove);
    return footer;
  }

  function studentAnswerWorkflowActions(block) {
    const section = create('section', 'open-answer-workflow-actions');
    const copy = create('div');
    const source = lessonStudentAnswerByQuestionId(block.questionId);
    const linked = lessonAnswerReviews(block.questionId);
    const linkedAfterQuestion = source
      ? linked.find((review) => review.slideIndex > source.slideIndex)
      : null;
    const hasInvalidReview = linked.length > 0 && !linkedAfterQuestion;
    copy.append(
      create(
        'strong',
        '',
        linkedAfterQuestion
          ? 'Powiązane omówienie jest gotowe'
          : hasInvalidReview ? 'Omówienie wymaga poprawienia kolejności' : 'Kolejny krok: omówienie'
      ),
      create(
        'small',
        '',
        linkedAfterQuestion
          ? 'Otwórz slajd z kluczem i uzupełnij jego treść.'
          : hasInvalidReview
            ? 'Otwórz omówienie i przenieś jego slajd za slajd z pytaniem.'
          : 'Studio utworzy następny slajd, zachowa questionId i doda edytowalny klucz odpowiedzi.'
      )
    );
    const button = create(
      'button',
      'button button-primary',
      linked.length ? 'Otwórz omówienie' : 'Utwórz slajd z omówieniem'
    );
    button.type = 'button';
    button.dataset.lessonInspectorAction = 'create-review';
    section.append(copy, button);
    return section;
  }

  function answerReviewQuestionOptions(block) {
    const review = findLessonNode(block.id);
    const reviewSlideIndex = review ? state.lesson.model.slides.indexOf(review.slide) : Number.MAX_SAFE_INTEGER;
    const previous = lessonStudentAnswers({ beforeBlockId: block.id })
      .filter((item) => item.slideIndex < reviewSlideIndex);
    const options = previous.map((item) => ({
      value: item.block.questionId,
      label: item.label
    }));
    if (!block.questionId && options.length) {
      options.unshift({ value: '', label: 'Wybierz wcześniejsze pytanie…' });
    }
    if (block.questionId && !options.some((option) => option.value === block.questionId)) {
      const linked = lessonStudentAnswerByQuestionId(block.questionId);
      options.push({
        value: block.questionId,
        label: linked
          ? `Powiązane pytanie jest później — ${String(linked.block.question || block.questionId).replace(/\s+/g, ' ').slice(0, 90)}`
          : `Brak pytania w lekcji — ${block.questionId}`
      });
    }
    if (!options.length) options.push({ value: '', label: 'Najpierw dodaj wcześniejsze pytanie otwarte' });
    return options;
  }

  function answerKeyQuickInsert() {
    const section = create('section', 'answer-key-builder-tools');
    const heading = create('div');
    heading.append(
      create('strong', '', 'Treść klucza odpowiedzi'),
      create('small', '', 'Każdy element pozostaje osobnym, edytowalnym klockiem. Możesz też przeciągać klocki z biblioteki po lewej.')
    );
    const actions = create('div', 'answer-key-builder-actions');
    [
      ['text', 'T', 'Tekst'],
      ['formula', '∑', 'Wzór'],
      ['image', '▧', 'Obraz'],
      ['table', '▦', 'Tabela'],
      ['list', '☷', 'Lista'],
      ['callout', '!', 'Wskazówka']
    ].forEach(([type, symbol, label]) => {
      const button = create('button', 'mini-button');
      button.type = 'button';
      button.dataset.answerKeyAdd = type;
      button.append(create('b', '', symbol), document.createTextNode(label));
      actions.append(button);
    });
    section.append(heading, actions);
    return section;
  }

  function taskCorrectOptionIndex(task) {
    if (task.type === 'abcd') {
      const answer = String(task.answers[0] || 'A').trim();
      const letter = answer.toUpperCase();
      if (/^[A-D]$/.test(letter)) return letter.charCodeAt(0) - 65;
      return Math.max(0, task.options.indexOf(answer));
    }
    return Math.max(0, task.options.indexOf(task.answers[0]));
  }

  function taskQuickOptionSelector(task) {
    const bar = create('div', 'task-quick-selector-bar');
    const label = create('strong', '', '1-klik szybki wybór poprawnej:');
    const pills = create('div', 'task-quick-pills');
    const correctIndex = taskCorrectOptionIndex(task);
    const isTrueFalse = task.options.length === 2 && task.options.includes('Prawda') && task.options.includes('Fałsz');
    task.options.forEach((opt, idx) => {
      const isCorrect = idx === correctIndex;
      const letter = String.fromCharCode(65 + idx);
      const text = isTrueFalse ? opt : (task.type === 'abcd' ? letter : (opt.length > 18 ? opt.slice(0, 16) + '…' : opt));
      const btn = create('button', `task-quick-pill${isCorrect ? ' is-correct' : ''}`, `${text}${isCorrect ? ' ✓' : ''}`);
      btn.type = 'button';
      btn.title = `Oznacz "${opt}" jako poprawną odpowiedź`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        commitMutation('lesson', () => {
          task.answers = [task.type === 'abcd' ? letter : task.options[idx]];
          if (task.type === 'abcd') task.correctOption = letter;
          renderLessonInspector();
        });
      });
      pills.append(btn);
    });
    bar.append(label, pills);
    return bar;
  }

  function taskOptionsEditor(task, withCorrectAnswer) {
    const editor = create('section', 'task-answer-editor');
    const header = create('header', 'task-answer-editor-header');
    const heading = create('div');
    heading.append(
      create('strong', '', withCorrectAnswer ? 'Odpowiedzi' : 'Lista odpowiedzi do wyboru'),
      create(
        'small',
        '',
        withCorrectAnswer
          ? 'Wpisz treść i zaznacz ptaszkiem jedną poprawną odpowiedź.'
          : 'Te odpowiedzi pojawią się przy każdej luce.'
      )
    );
    header.append(heading);
    editor.append(header);
    if (withCorrectAnswer && task.options?.length) {
      editor.append(taskQuickOptionSelector(task));
    }
    const list = create('div', 'task-option-editor-list');
    const correctIndex = taskCorrectOptionIndex(task);
    task.options.forEach((option, index) => {
      const row = create('div', 'task-option-editor-row');
      row.dataset.optionIndex = String(index);
      if (withCorrectAnswer) {
        const correct = create('label', 'task-correct-toggle');
        correct.title = 'Oznacz jako poprawną odpowiedź';
        const radio = lessonInput(String(index), 'correctOption', {
          type: 'radio',
          checked: index === correctIndex
        });
        radio.name = `task-correct-${task.id}`;
        radio.setAttribute('aria-label', `Odpowiedź ${String.fromCharCode(65 + index)} jest poprawna`);
        const mark = create('span', 'task-correct-mark', '✓');
        mark.setAttribute('aria-hidden', 'true');
        correct.append(radio, mark);
        row.append(correct);
      } else {
        row.append(create('span', 'task-option-letter', String.fromCharCode(65 + index)));
      }
      const input = lessonTextarea(option, 'optionItem', {
        rows: 2,
        maxLength: 240,
        placeholder: `Odpowiedź ${String.fromCharCode(65 + index)}`
      });
      input.dataset.optionIndex = String(index);
      row.append(input);
      const remove = create('button', 'task-row-remove', '×');
      remove.type = 'button';
      remove.dataset.lessonTaskEditorAction = 'remove-option';
      remove.dataset.optionIndex = String(index);
      remove.setAttribute('aria-label', `Usuń odpowiedź ${String.fromCharCode(65 + index)}`);
      remove.disabled = task.type === 'abcd' || task.options.length <= 2;
      row.append(remove);
      list.append(row);
    });
    const add = create('button', 'button button-soft task-editor-add', '＋ Dodaj odpowiedź');
    add.type = 'button';
    add.dataset.lessonTaskEditorAction = 'add-option';
    add.disabled = task.type === 'abcd' || task.options.length >= 8;
    editor.append(header, list, add);
    return editor;
  }

  function taskGapLabels(task) {
    return taskGapStructure(task).labels;
  }

  function taskGapStructure(task) {
    const text = String(task.text || '');
    const labels = [];
    const segments = [];
    const pattern = /\{\{([^{}]*)\}\}/g;
    let match;
    let offset = 0;
    while ((match = pattern.exec(text))) {
      segments.push(text.slice(offset, match.index));
      labels.push(match[1].trim() || `luka ${labels.length + 1}`);
      offset = match.index + match[0].length;
    }
    segments.push(text.slice(offset));
    return { labels, segments };
  }

  function applyTaskGapStructure(task, structure) {
    const labels = Array.isArray(structure && structure.labels) ? structure.labels : [];
    const segments = Array.isArray(structure && structure.segments) ? structure.segments : [''];
    task.text = labels.map((label, index) => (
      `${String(segments[index] || '')}{{${String(label || `luka ${index + 1}`).replace(/[{}|]/g, '').trim() || `luka ${index + 1}`}}}`
    )).join('') + String(segments[labels.length] || '');
  }

  function replaceTaskGapLabel(task, targetIndex, value) {
    let current = 0;
    const label = String(value || '').replace(/[{}|]/g, '').trim() || `luka ${targetIndex + 1}`;
    task.text = String(task.text || '').replace(/\{\{([^{}]*)\}\}/g, (match) => {
      const replacement = current === targetIndex ? `{{${label}}}` : match;
      current += 1;
      return replacement;
    });
  }

  function taskGapEditor(task) {
    const editor = create('section', 'task-answer-editor task-gap-editor');
    const header = create('header', 'task-answer-editor-header');
    const heading = create('div');
    heading.append(
      create('strong', '', 'Wizualny edytor zdania z lukami'),
      create('small', '', 'Wpisuj zwykły tekst. Enter tworzy nową linię w zadaniu kursanta, a przyciskiem dodasz lukę dokładnie w wybranym miejscu.')
    );
    header.append(heading);
    const structure = taskGapStructure(task);
    const sentence = create('div', 'task-gap-sentence-editor');
    structure.segments.forEach((segment, index) => {
      const row = create('div', 'task-gap-segment-row');
      const text = lessonTextarea(segment, 'gapSegment', {
        rows: 2,
        maxLength: 1600,
        placeholder: index === 0 ? 'Wpisz początek zdania…' : 'Wpisz dalszą część zdania…'
      });
      text.dataset.gapSegmentIndex = String(index);
      const insert = create('button', 'mini-button task-gap-insert', '＋ Dodaj lukę tutaj');
      insert.type = 'button';
      insert.dataset.lessonTaskEditorAction = 'insert-gap';
      insert.dataset.gapSegmentIndex = String(index);
      row.append(
        field(
          index < structure.labels.length ? `Tekst przed luką ${index + 1}` : 'Tekst po ostatniej luce',
          text
        ),
        insert
      );
      sentence.append(row);
      if (index < structure.labels.length) {
        const token = create('div', 'task-gap-token');
        token.append(
          create('span', 'task-gap-number', String(index + 1)),
          create('span', '', `Luka: ${structure.labels[index]}`)
        );
        sentence.append(token);
      }
    });

    const answersHeading = create('div', 'task-gap-answers-heading');
    answersHeading.append(
      create('strong', '', 'Ustawienia luk'),
      create('small', '', 'Nazwij każdą lukę i wybierz albo wpisz poprawną odpowiedź.')
    );
    const list = create('div', 'task-gap-editor-list');
    const labels = structure.labels;
    labels.forEach((gapLabel, index) => {
      const row = create('div', 'task-gap-editor-row');
      const number = create('span', 'task-gap-number', String(index + 1));
      const labelInput = lessonInput(gapLabel, 'gapLabel', {
        maxLength: 100,
        placeholder: `Opis luki ${index + 1}`
      });
      labelInput.dataset.gapIndex = String(index);
      let answerInput;
      if (task.type === 'gaps') {
        answerInput = lessonSelect(task.answers[index] || '', 'gapAnswer', task.options.map((option) => ({
          value: option,
          label: option
        })));
      } else {
        answerInput = lessonInput(task.answers[index] || '', 'gapAnswer', {
          maxLength: 160,
          placeholder: 'Poprawna odpowiedź'
        });
      }
      answerInput.dataset.gapIndex = String(index);
      const remove = create('button', 'task-row-remove', '×');
      remove.type = 'button';
      remove.dataset.lessonTaskEditorAction = 'remove-gap';
      remove.dataset.gapIndex = String(index);
      remove.setAttribute('aria-label', `Usuń lukę ${index + 1}`);
      row.append(
        number,
        field('Opis widoczny w luce', labelInput),
        field('Poprawna odpowiedź', answerInput),
        remove
      );
      list.append(row);
    });
    if (!labels.length) {
      list.append(create('p', 'task-editor-empty', 'Nie ma jeszcze żadnej luki. Kliknij „Dodaj lukę tutaj” przy wybranym fragmencie zdania.'));
    }
    editor.append(header, sentence, answersHeading, list);
    return editor;
  }

  function lessonTaskEditorAction(button) {
    const found = findLessonNode(state.lesson.selectedId);
    if (!found || found.kind !== 'task') return;
    const task = found.node;
    const action = button.dataset.lessonTaskEditorAction;
    if (action === 'add-option') {
      if (task.options.length >= 8 || task.type === 'abcd') return;
      commitMutation('lesson', () => {
        task.options.push(`Nowa odpowiedź ${task.options.length + 1}`);
      });
      return;
    }
    if (action === 'remove-option') {
      const index = Number(button.dataset.optionIndex);
      if (!Number.isSafeInteger(index) || task.options.length <= 2 || task.type === 'abcd') return;
      commitMutation('lesson', () => {
        const [removed] = task.options.splice(index, 1);
        const fallback = task.options[0] || '';
        if (task.type === 'choice') {
          task.answers = [task.answers[0] === removed ? fallback : task.answers[0]];
        } else if (task.type === 'gaps') {
          task.answers = task.answers.map((answer) => answer === removed ? fallback : answer);
        }
      });
      return;
    }
    if (action === 'insert-gap') {
      const structure = taskGapStructure(task);
      const requestedIndex = Number(button.dataset.gapSegmentIndex);
      const gapIndex = Number.isSafeInteger(requestedIndex)
        ? Math.max(0, Math.min(requestedIndex, structure.labels.length))
        : structure.labels.length;
      commitMutation('lesson', () => {
        structure.labels.splice(gapIndex, 0, `luka ${gapIndex + 1}`);
        structure.segments.splice(gapIndex + 1, 0, '');
        applyTaskGapStructure(task, structure);
        const answer = task.type === 'gaps' ? task.options[0] || '' : 'odpowiedź';
        task.answers.splice(gapIndex, 0, answer);
      });
      return;
    }
    if (action === 'remove-gap') {
      const targetIndex = Number(button.dataset.gapIndex);
      if (!Number.isSafeInteger(targetIndex)) return;
      commitMutation('lesson', () => {
        const structure = taskGapStructure(task);
        if (targetIndex < 0 || targetIndex >= structure.labels.length) return;
        const merged = `${structure.segments[targetIndex] || ''}${structure.labels[targetIndex] || ''}${structure.segments[targetIndex + 1] || ''}`;
        structure.labels.splice(targetIndex, 1);
        structure.segments.splice(targetIndex, 2, merged);
        applyTaskGapStructure(task, structure);
        task.answers.splice(targetIndex, 1);
      });
    }
  }

  function renderLessonTaskInspector(form, task) {
    form.append(field(
      'Rodzaj pytania',
      lessonSelect(task.type, 'type', [
        { value: 'abcd', label: 'Quiz ABCD' },
        { value: 'choice', label: 'Jedna odpowiedź z listy' },
        { value: 'gaps', label: 'Uzupełnianie luk z listy' },
        { value: 'gaps-text', label: 'Luki wpisywane ręcznie' },
        { value: 'text', label: 'Odpowiedź tekstowa' },
        { value: 'number', label: 'Odpowiedź liczbowa' }
      ])
    ));
    form.append(
      field('Treść pytania', lessonTextarea(task.question, 'question', { rows: 3, maxLength: 900 })),
      scientificNotationToolbar(),
      field('Etykieta pola', lessonTextarea(task.label, 'label', { rows: 2, maxLength: 160 }))
    );
    if (task.type !== 'gaps' && task.type !== 'gaps-text') {
      form.append(field('Placeholder', lessonInput(task.placeholder, 'placeholder', { maxLength: 160 })));
    }
    if (task.type === 'gaps' || task.type === 'gaps-text') {
      if (task.type === 'gaps') form.append(taskOptionsEditor(task, false));
      form.append(taskGapEditor(task));
      if (task.type === 'gaps-text') {
        form.append(field(
          'Sposób sprawdzania',
          lessonSelect(task.checkMode, 'checkMode', [
            { value: 'each', label: 'Każda luka osobno' },
            { value: 'all', label: 'Wszystkie luki naraz' }
          ]),
          'Uczeń może otrzymywać wynik po każdej luce albo dopiero po sprawdzeniu całego zadania.'
        ));
        const check = create('label', 'check-field');
        const input = lessonInput('', 'caseSensitive', {
          type: 'checkbox',
          checked: task.caseSensitive
        });
        check.append(input, create('span', '', 'Rozróżniaj wielkość liter w odpowiedziach'));
        form.append(check);
      }
    } else if (task.type === 'choice' || task.type === 'abcd') {
      form.append(taskOptionsEditor(task, true));
    } else {
      form.append(window.ChemAnswerFields.textList(task.answers, (values) => {
        beginEdit('lesson');
        task.answers = values;
        updateLessonNodeSummary();
        scheduleDraftSave('lesson');
      }, { title: task.type === 'number' ? 'Poprawny wynik / równoważne zapisy' : 'Poprawne odpowiedzi / aliasy' }));
      if (task.type === 'text') {
        const check = create('label', 'check-field');
        const input = lessonInput('', 'caseSensitive', { type: 'checkbox', checked: task.caseSensitive });
        check.append(input, create('span', '', 'Rozróżniaj wielkość liter'));
        form.append(check);
      }
    }
    form.append(
      field('Podpowiedź po błędzie', lessonTextarea(task.hint, 'hint', { rows: 3, maxLength: 500 })),
      field('Komunikat po dobrej odpowiedzi', lessonTextarea(task.feedback, 'feedback', { rows: 3, maxLength: 500 }))
    );
  }

  function scientificNotationToolbar() {
    const section = create('section', 'scientific-notation-toolbar');
    const header = create('header');
    header.append(
      create('strong', '', 'Wzory i indeksy'),
      create('small', '', 'Zaznacz fragment pytania i wybierz indeks albo wstaw gotowy wzór.')
    );
    const buttons = create('div', 'scientific-notation-buttons');
    [
      ['H₂O', 'H~2~O', 'Wstaw wzór wody'],
      ['CO₂', 'CO~2~', 'Wstaw wzór tlenku węgla(IV)'],
      ['H₂SO₄', 'H~2~SO~4~', 'Wstaw wzór kwasu siarkowego(VI)'],
      ['NH₄⁺', 'NH~4~^+^', 'Wstaw jon amonowy'],
      ['SO₄²⁻', 'SO~4~^2−^', 'Wstaw jon siarczanowy(VI)']
    ].forEach(([label, snippet, title]) => {
      const button = create('button', 'scientific-notation-button', label);
      button.type = 'button';
      button.dataset.lessonInlineSnippet = snippet;
      button.title = title;
      buttons.append(button);
    });
    [
      ['x₂', 'sub', 'Indeks dolny'],
      ['x²', 'sup', 'Indeks górny']
    ].forEach(([label, kind, title]) => {
      const button = create('button', 'scientific-notation-button is-format', label);
      button.type = 'button';
      button.dataset.lessonInlineWrap = kind;
      button.title = title;
      buttons.append(button);
    });
    section.append(header, buttons, create(
      'p',
      '',
      'Możesz też wpisać ręcznie H~2~O albo x^2^. Podgląd od razu pokaże prawidłowe indeksy.'
    ));
    return section;
  }

  function insertLessonInlineNotation(button) {
    const input = elements.lessonInspector.querySelector('[data-lesson-field="question"]');
    if (!input || typeof input.setRangeText !== 'function') return;
    const start = Number.isSafeInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isSafeInteger(input.selectionEnd) ? input.selectionEnd : start;
    const selected = input.value.slice(start, end);
    let snippet = button.dataset.lessonInlineSnippet || '';
    if (button.dataset.lessonInlineWrap) {
      const marker = button.dataset.lessonInlineWrap === 'sub' ? '~' : '^';
      snippet = `${marker}${selected || (marker === '~' ? '2' : '+')}${marker}`;
    }
    input.setRangeText(snippet, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  const LESSON_FORMULA_PRESETS = Object.freeze({
    'chem-water': {
      mode: 'chemistry',
      title: 'Wzór wody',
      left: 'H2O',
      arrow: '',
      above: '',
      below: '',
      right: ''
    },
    'chem-combustion': {
      mode: 'chemistry',
      title: 'Spalanie wodoru',
      left: '2 H2 + O2',
      arrow: '->',
      above: 'Δ',
      below: '',
      right: '2 H2O'
    },
    'chem-equilibrium': {
      mode: 'chemistry',
      title: 'Synteza amoniaku',
      left: 'N2 + 3 H2',
      arrow: '<=>',
      above: '450 °C',
      below: 'kat. Fe',
      right: '2 NH3'
    },
    'chem-dissociation': {
      mode: 'chemistry',
      title: 'Dysocjacja kwasu siarkowego(VI)',
      left: 'H2SO4',
      arrow: '->',
      above: 'H2O',
      below: '',
      right: '2 H+ + SO4^2-'
    },
    'chem-precipitate': {
      mode: 'chemistry',
      title: 'Reakcja strąceniowa',
      left: 'Ag+ + Cl-',
      arrow: '->',
      above: '',
      below: '',
      right: 'AgCl v'
    },
    'chem-isotope': {
      mode: 'chemistry',
      title: 'Izotop węgla',
      left: '^14C',
      arrow: '',
      above: '',
      below: '',
      right: ''
    },
    'math-energy': {
      mode: 'math',
      title: 'Równoważność masy i energii',
      expression: 'E = mc^{2}'
    },
    'math-quadratic': {
      mode: 'math',
      title: 'Wzór kwadratowy',
      expression: 'x_{1,2} = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}'
    },
    'math-concentration': {
      mode: 'math',
      title: 'Stężenie molowe',
      expression: 'c = \\frac{n}{V}'
    },
    'math-sum': {
      mode: 'math',
      title: 'Suma ciągu',
      expression: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}'
    },
    'math-integral': {
      mode: 'math',
      title: 'Całka oznaczona',
      expression: '\\int_{a}^{b} x^{2}'
    }
  });

  function formulaPresetPicker(mode) {
    const section = create('section', 'formula-builder-section formula-preset-section');
    const header = create('header');
    header.append(
      create('strong', '', 'Gotowe szablony'),
      create('small', '', 'Kliknij, aby wstawić kompletny wzór i dalej go edytować.')
    );
    const presets = mode === 'math'
      ? [
          ['math-energy', 'E = mc²'],
          ['math-quadratic', 'Wzór kwadratowy'],
          ['math-concentration', 'c = n/V'],
          ['math-sum', 'Suma Σ'],
          ['math-integral', 'Całka ∫']
        ]
      : [
          ['chem-water', 'H₂O'],
          ['chem-combustion', 'Spalanie'],
          ['chem-equilibrium', 'Równowaga'],
          ['chem-dissociation', 'Dysocjacja'],
          ['chem-precipitate', 'Osad ↓'],
          ['chem-isotope', 'Izotop ¹⁴C']
        ];
    const list = create('div', 'formula-preset-list');
    presets.forEach(([value, label]) => {
      const button = create('button', 'formula-preset-button', label);
      button.type = 'button';
      button.dataset.formulaPreset = value;
      list.append(button);
    });
    section.append(header, list);
    return section;
  }

  function formulaSymbolGroup(title, symbols) {
    const group = create('section', 'formula-symbol-group');
    group.append(create('strong', '', title));
    const toolbar = create('div', 'formula-symbol-toolbar');
    symbols.forEach(([label, snippet, target, help]) => {
      const button = create('button', 'formula-symbol-button', label);
      button.type = 'button';
      button.dataset.formulaSnippet = snippet;
      if (target) button.dataset.formulaTarget = target;
      button.title = help || `Wstaw ${snippet}`;
      toolbar.append(button);
    });
    group.append(toolbar);
    return group;
  }

  function formulaArrowPicker(value) {
    const section = create('section', 'formula-symbol-group formula-arrow-group');
    section.append(create('strong', '', 'Strzałka reakcji'));
    const list = create('div', 'formula-arrow-list');
    [
      ['', '∅', 'Bez strzałki — pojedynczy wzór'],
      ['->', '→', 'Reakcja w prawo'],
      ['<-', '←', 'Reakcja w lewo'],
      ['<->', '↔', 'Reakcja odwracalna'],
      ['<=>', '⇌', 'Równowaga'],
      ['<=>>', '⇌→', 'Równowaga przesunięta w prawo'],
      ['<<=>', '←⇌', 'Równowaga przesunięta w lewo']
    ].forEach(([arrow, symbol, label]) => {
      const button = create('button', 'formula-arrow-button');
      button.type = 'button';
      button.dataset.formulaArrow = arrow;
      button.classList.toggle('is-active', value === arrow);
      button.setAttribute('aria-pressed', String(value === arrow));
      button.title = label;
      button.append(create('strong', '', symbol), create('small', '', label));
      list.append(button);
    });
    section.append(list);
    return section;
  }

  function formulaComposerPreview() {
    const section = create('section', 'formula-builder-preview');
    const header = create('header');
    header.append(
      create('strong', '', 'Podgląd równania'),
      create('small', '', 'Tak wzór będzie wyglądał w lekcji.')
    );
    const canvas = create('div', 'formula-builder-preview-canvas');
    canvas.dataset.formulaComposerPreview = 'true';
    canvas.setAttribute('aria-live', 'polite');
    section.append(header, canvas);
    return section;
  }

  function updateFormulaComposerPreview(block) {
    const canvas = elements.lessonInspector.querySelector('[data-formula-composer-preview]');
    if (!canvas || !block || block.type !== 'formula') return;
    clearTypesetMath(canvas);
    try {
      canvas.innerHTML = window.ChemLesson.renderMarkdown(lessonModelApi.serializeBlock(block));
      canvas.dataset.state = canvas.querySelector('.lesson-interactive-error') ? 'error' : 'ready';
    } catch (_) {
      canvas.replaceChildren(create('p', 'lesson-interactive-error', 'Uzupełnij wzór, aby zobaczyć podgląd.'));
      canvas.dataset.state = 'error';
    }
    typesetMath(canvas);
  }

  function renderLessonInspector() {
    elements.lessonInspector.replaceChildren();
    const found = findLessonNode(state.lesson.selectedId);
    if (!found) {
      const empty = create('div', 'inspector-empty');
      empty.append(
        create('span', '', '◎'),
        create('strong', '', 'Zaznacz slajd lub klocek'),
        create('p', '', 'Edytuj treść, wygląd, odpowiedzi i komunikaty po rozwiązaniu.')
      );
      elements.lessonInspector.append(empty);
      return;
    }
    const form = create('form', 'inspector-form');
    form.addEventListener('submit', (event) => event.preventDefault());
    if (found.kind === 'slide') {
      form.append(inspectorHeader('▤', 'Ustawienia slajdu', 'Nazwa pochodzi z pierwszego nagłówka tego slajdu.'));
      form.append(field(
        'Nawigacja całej lekcji',
        lessonSelect(state.lesson.model.navigation || 'sequential', 'lessonNavigation', [
          { value: 'sequential', label: 'Sekwencyjna — kroki po kolei' },
          { value: 'free', label: 'Swobodna — można pomijać' }
        ]),
        'To ustawienie jest wspólne dla lekcji. Indywidualny wyjątek ucznia ustawia administrator w raporcie postępów.'
      ));
      form.append(field(
        'Nazwa slajdu',
        lessonInput(slideTitle(found.node, found.index), 'slideTitle', { maxLength: 140 })
      ));
      form.append(field(
        'Układ elementów',
        lessonSelect(found.node.layout || 'flow', 'slideLayout', [
          { value: 'flow', label: 'Automatyczny — elementy jeden pod drugim' },
          { value: 'canvas', label: 'Swobodny — przeciągaj i skaluj na slajdzie' }
        ]),
        found.node.layout === 'canvas'
          ? 'Zaznacz klocek i przeciągnij jego uchwyt w podglądzie. Rogami zmienisz szerokość i wysokość.'
          : 'Układ automatyczny zachowuje pełną zgodność ze starszymi lekcjami.'
      ));
      form.append(field(
        'Tło slajdu',
        lessonSelect(found.node.background || 'default', 'slideBackground', [
          { value: 'default', label: 'Domyślne — zgodne z motywem' },
          { value: 'paper', label: 'Papier w linie' },
          { value: 'grid', label: 'Kratka laboratoryjna' },
          { value: 'dots', label: 'Papier w kropki' },
          { value: 'mint', label: 'Miętowe' },
          { value: 'sky', label: 'Błękitne' },
          { value: 'lavender', label: 'Lawendowe' },
          { value: 'sand', label: 'Piaskowe' },
          { value: 'gradient', label: 'Gradient platformy' },
          { value: 'night', label: 'Nocne laboratorium' },
          { value: 'custom', label: 'Własny kolor' }
        ]),
        'Bezpieczny preset zapisuje się razem z tym slajdem i działa również w ciemnym motywie.'
      ));
      if (found.node.background === 'custom') {
        form.append(field(
          'Własny kolor tła',
          lessonInput(found.node.backgroundColor || '#f8fafc', 'slideBackgroundColor', { type: 'color' })
        ));
      }
      const visualRow = create('div', 'field-row');
      visualRow.append(
        field('Dekoracja', lessonSelect(found.node.decoration || 'none', 'slideDecoration', [
          { value: 'none', label: 'Brak' },
          { value: 'molecules', label: 'Cząsteczki' },
          { value: 'bubbles', label: 'Bąbelki' },
          { value: 'glow', label: 'Świetlna poświata' }
        ])),
        field('Kontrast tekstu', lessonSelect(found.node.textTone || 'auto', 'slideTextTone', [
          { value: 'auto', label: 'Automatyczny' },
          { value: 'dark', label: 'Ciemny tekst' },
          { value: 'light', label: 'Jasny tekst' }
        ]))
      );
      form.append(visualRow);
      form.append(field(
        'Uwzględniaj krok w procencie lekcji',
        lessonSelect(found.node.includeInLesson || 'INHERIT', 'includeInLesson', [
          { value: 'INHERIT', label: 'Dziedzicz (domyślnie: tak)' },
          { value: 'ON', label: 'Tak' },
          { value: 'OFF', label: 'Nie — materiał dodatkowy' }
        ]),
        'Wpływ na procent i wymóg przejścia dalej są niezależnymi ustawieniami.'
      ));
      const gateCard = create('section', 'slide-gate-card');
      const gateHeader = create('div', 'slide-gate-header');
      gateHeader.append(
        create('strong', '', 'Reguły przejścia dalej (Gate Rules)'),
        create('small', '', 'Określ, czy uczeń musi ukończyć zadanie / materiał, aby przejść do następnego kroku.')
      );
      const required = create('label', 'gate-switch-label');
      required.title = 'Zablokuj przejście dalej do czasu spełnienia warunku';
      const requiredInput = lessonInput('', 'requiredToAdvance', { type: 'checkbox', checked: found.node.requiredToAdvance !== false });
      const slider = create('span', 'gate-slider');
      const switchText = create('span', 'gate-label', found.node.requiredToAdvance !== false ? '🔒 Krok wymagany (zablokuj przejście)' : '🔓 Swobodne przejście (można pominąć)');
      required.append(requiredInput, slider, switchText);

      const conditionPills = create('div', 'gate-condition-pills');
      const currentCond = found.node.condition?.type || 'next_click';
      [
        { type: 'correct_answer', label: '🎯 Poprawna odpowiedź', desc: 'Wymaga poprawnego rozwiązania zadania na tym slajdzie' },
        { type: 'material_completed', label: '🎬 Obejrzenie materiału', desc: 'Wymaga obejrzenia wideo lub otwarcia zasobu' },
        { type: 'previous_completed', label: '⏭ Ukończenie poprzedniego', desc: 'Wymaga ukończenia wcześniejszego kroku' },
        { type: 'exam_passed', label: '🏆 Zaliczenie egzaminu', desc: 'Wymaga zaliczenia egzaminu przypisanego do slajdu' },
        { type: 'next_click', label: '🔘 Kliknięcie Dalej', desc: 'Swobodne przejście po kliknięciu Dalej' }
      ].forEach((pill) => {
        const btn = create('button', `gate-pill-btn${currentCond === pill.type ? ' is-selected' : ''}`, pill.label);
        btn.type = 'button';
        btn.title = pill.desc;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          commitMutation('lesson', () => {
            if (!found.node.condition) found.node.condition = { type: pill.type, materialId: '', minimumScore: 0 };
            found.node.condition.type = pill.type;
            if (pill.type !== 'next_click') found.node.requiredToAdvance = true;
            renderLessonInspector();
            renderLessonCanvas();
          });
        });
        conditionPills.append(btn);
      });
      gateCard.append(gateHeader, required, conditionPills);
      form.append(gateCard);

      form.append(field(
        'Warunek przejścia',
        lessonSelect(found.node.condition?.type || 'next_click', 'conditionType', [
          { value: 'next_click', label: 'Kliknięcie Dalej' },
          { value: 'previous_completed', label: 'Ukończenie poprzedniego kroku' },
          { value: 'material_completed', label: 'Obejrzenie / ukończenie materiału' },
          { value: 'quiz_completed', label: 'Ukończenie quizu' },
          { value: 'correct_answer', label: 'Poprawna odpowiedź' },
          { value: 'exam_completed', label: 'Ukończenie egzaminu' },
          { value: 'exam_passed', label: 'Zaliczenie egzaminu' },
          { value: 'minimum_score', label: 'Minimalny wynik' }
        ])
      ));
      if (found.node.condition?.type === 'minimum_score') {
        form.append(field(
          'Minimalny wynik (%)',
          lessonInput(String(found.node.condition.minimumScore || 0), 'minimumScore', { type: 'number', min: 0, max: 100 })
        ));
      }
      form.append(field(
        'Stabilny stepId',
        lessonInput(found.node.id, 'stepId', { maxLength: 128 }),
        'Identyfikator pozostaje z krokiem po zmianie kolejności. Zmieniaj go tylko przed publikacją.'
      ));
      form.append(field(
        'Przejście przy otwieraniu slajdu',
        lessonSelect(found.node.transition, 'transition', [
          { value: 'none', label: 'Brak przejścia' },
          { value: 'fade', label: 'Łagodne zanikanie' },
          { value: 'rise', label: 'Subtelnie w górę' },
          { value: 'slide', label: 'Delikatnie z boku' },
          { value: 'zoom', label: 'Miękkie przybliżenie' }
        ]),
        'Ustawienie dotyczy tylko tego slajdu. Systemowe ograniczenie animacji ma zawsze pierwszeństwo.'
      ));
      form.append(lessonInspectorActions('slide'));
      elements.lessonInspector.append(form);
      return;
    }
    if (found.kind === 'task') {
      form.append(inspectorHeader('✓', 'Pytanie interaktywne', 'Na jednym slajdzie może znajdować się jedno pytanie.'));
      renderLessonTaskInspector(form, found.node);
      form.append(lessonInspectorActions('task'));
      elements.lessonInspector.append(form);
      return;
    }
    const block = found.node;
    if (block.type === 'ai') syncInspectorRepository(block.repositoryId);
    form.append(inspectorHeader(
      lessonBlockSymbol(block),
      lessonBlockSubtitle(block),
      'Zmiany pojawią się od razu w podglądzie lekcji.'
    ));
    if (found.slide?.layout === 'canvas' && !found.parent?.type) {
      const layout = block.layout || defaultLessonCanvasLayout(found.index);
      const geometry = create('section', 'lesson-layout-inspector');
      geometry.append(
        create('strong', '', 'Położenie na slajdzie'),
        create('small', '', 'Możesz też przeciągać i skalować element bezpośrednio w podglądzie.')
      );
      const row = create('div', 'field-row');
      row.append(
        field('X (%)', lessonInput(layout.x, 'layoutX', { type: 'number', min: 0, max: 92 })),
        field('Y (%)', lessonInput(layout.y, 'layoutY', { type: 'number', min: 0, max: 92 })),
        field('Szerokość (%)', lessonInput(layout.width, 'layoutWidth', { type: 'number', min: 8, max: 100 })),
        field('Wysokość (%)', lessonInput(layout.height, 'layoutHeight', { type: 'number', min: 8, max: 100 }))
      );
      geometry.append(row);
      form.append(geometry);
    }
    if (block.type === 'heading') {
      const row = create('div', 'field-row');
      row.append(
        field('Poziom', lessonSelect(String(block.level), 'level', [
          { value: '1', label: 'H1 — główny' },
          { value: '2', label: 'H2 — slajd' },
          { value: '3', label: 'H3 — śródtytuł' }
        ])),
        field('Tekst nagłówka', lessonInput(block.text, 'text', { maxLength: 180 }))
      );
      form.append(row);
    } else if (block.type === 'text' || block.type === 'quote') {
      form.append(field(
        block.type === 'quote' ? 'Treść cytatu' : 'Treść akapitu',
        lessonTextarea(block.text, 'text', { rows: 7, maxLength: 4000 }),
        'Możesz używać **pogrubienia**, *kursywy*, ^indeksu górnego^ i ~dolnego~.'
      ));
    } else if (block.type === 'list') {
      const check = create('label', 'check-field');
      check.append(
        lessonInput('', 'ordered', { type: 'checkbox', checked: block.ordered }),
        create('span', '', 'Lista numerowana')
      );
      form.append(
        field('Punkty — jeden w wierszu', lessonTextarea(block.items.join('\n'), 'items', { rows: 7 })),
        check
      );
    } else if (block.type === 'table') {
      form.append(
        field(
          'Podpis tabeli — opcjonalnie',
          lessonInput(block.caption, 'caption', { maxLength: 180, placeholder: 'np. Porównanie właściwości' })
        ),
        field(
          'Nagłówki kolumn',
          lessonInput(block.headers.join(' | '), 'tableHeaders', {
            maxLength: 2000,
            placeholder: 'Substancja | Wzór | Właściwość'
          }),
          'Rozdziel nagłówki pionową kreską |. Tabela może mieć od 2 do 8 kolumn.'
        ),
        field(
          'Wiersze tabeli',
          lessonTextarea(
            block.rows.map((row) => row.join(' | ')).join('\n'),
            'tableRows',
            { rows: 10, maxLength: 12000, placeholder: 'Woda | H2O | ciecz\nTlen | O2 | gaz' }
          ),
          'Każdy wiersz wpisz w nowej linii, a komórki rozdziel znakiem |. Każdy wiersz musi mieć tyle komórek, ile jest nagłówków.'
        ),
        field('Wyrównanie zawartości', lessonSelect(block.align, 'align', [
          { value: 'left', label: 'Do lewej' },
          { value: 'center', label: 'Wyśrodkowane' },
          { value: 'right', label: 'Do prawej' }
        ]))
      );
    } else if (block.type === 'image') {
      const mediaCard = create('section', 'lesson-image-source-card');
      mediaCard.append(
        create('strong', '', block.ref ? 'Obraz z Media Managera' : 'Źródło obrazu'),
        create('code', '', block.ref || 'Nie wybrano pliku')
      );
      const mediaActions = create('div', 'lesson-image-source-actions');
      const choose = create('button', 'button button-primary', block.ref ? 'Zmień obraz' : 'Wybierz lub wgraj obraz');
      choose.type = 'button';
      choose.dataset.lessonMediaManager = '1';
      mediaActions.append(choose);
      if (block.ref) {
        const clear = create('button', 'button button-soft', 'Usuń z klocka');
        clear.type = 'button';
        clear.dataset.lessonMediaClear = '1';
        mediaActions.append(clear);
      }
      mediaCard.append(mediaActions);
      form.append(
        mediaCard,
        field('Zewnętrzny adres HTTPS — zgodność ze starymi lekcjami', lessonInput(block.url, 'url', { type: 'url', placeholder: 'https://…' }), 'Gdy wybierzesz plik z Media Managera, stabilna referencja ma pierwszeństwo przed tym adresem.'),
        field(
          'Opis alternatywny ALT',
          lessonInput(block.alt, 'alt', { maxLength: 220 }),
          'Opisz konkretnie, co przedstawia obraz. Ten tekst pomaga osobom korzystającym z czytnika ekranu i jest automatycznie przekazywany do AI.'
        ),
        field('Szerokość obrazu (%)', lessonInput(String(block.width || 100), 'width', { type: 'range', min: 20, max: 100 })),
        field('Wyrównanie', lessonSelect(block.align || 'center', 'align', [
          { value: 'left', label: 'Do lewej' },
          { value: 'center', label: 'Na środku' },
          { value: 'right', label: 'Do prawej' }
        ]))
      );
    } else if (block.type === 'callout') {
      form.append(
        field('Rodzaj', lessonSelect(block.tone, 'tone', [
          { value: 'info', label: 'Informacja' },
          { value: 'tip', label: 'Wskazówka' },
          { value: 'warning', label: 'Uwaga' },
          { value: 'success', label: 'Zapamiętaj' }
        ])),
        field('Tytuł', lessonInput(block.title, 'title', { maxLength: 120 })),
        field('Treść', lessonTextarea(block.text, 'text', { rows: 6, maxLength: 1800 }))
      );
    } else if (block.type === 'code') {
      form.append(
        field('Język / etykieta', lessonInput(block.language, 'language', { placeholder: 'np. text, js', maxLength: 24 })),
        field('Kod albo wzór', lessonTextarea(block.code, 'code', { rows: 9, maxLength: 6000 }))
      );
    } else if (block.type === 'youtube') {
      form.append(
        field(
          'Link lub ID filmu YouTube',
          lessonInput(block.video, 'video', { placeholder: 'https://youtu.be/… lub 11-znakowe ID', maxLength: 300 }),
          'Film zostanie osadzony w bezpiecznym iframe z domeny youtube-nocookie.com.'
        ),
        field('Tytuł filmu', lessonInput(block.title, 'title', { maxLength: 180 }))
      );
    } else if (block.type === 'slides') {
      const published = create('label', 'check-field');
      published.append(
        lessonInput('', 'published', { type: 'checkbox', checked: block.published }),
        create('span', '', 'Opublikowana prezentacja Google (/d/e/)')
      );
      const controls = create('label', 'check-field');
      controls.append(
        lessonInput('', 'controls', { type: 'checkbox', checked: block.controls !== false }),
        create('span', '', 'Pokaż pasek nawigacji i strzałki Google Slides')
      );
      form.append(
        field(
          'Link lub ID prezentacji Google Slides',
          lessonInput(block.presentation, 'presentation', {
            placeholder: 'https://docs.google.com/presentation/d/… lub ID',
            maxLength: 500
          }),
          'Prezentacja zostanie osadzona w lekcji. Plik musi być udostępniony odbiorcom kursu.'
        ),
        published,
        controls,
        field(
          'Tytuł prezentacji',
          lessonInput(block.title, 'title', { maxLength: 180 }),
          'AI rozpozna tytuł, ale nie może odczytać zawartości iframe Google. Treść slajdów możesz opisać w klocku „Zapytaj AI”.'
        )
      );
    } else if (block.type === 'google') {
      form.append(
        field('Tytuł materiału', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Link do pliku lub notatnika Google', lessonInput(block.url, 'url', { maxLength: 2000, placeholder: 'https://drive.google.com/file/d/…/view' }), 'Obsługuje podgląd plików MP3, filmów, PDF, dokumentów i folderów Google. Udostępnij plik uczestnikom. Notebook Google nie pozwala na iframe — kafelek otworzy go w nowej karcie.'),
        field('Szerokość (%)', lessonInput(block.width, 'width', { type: 'number', min: 20, max: 100 })),
        field('Wysokość (% okna)', lessonInput(block.heightPercent, 'heightPercent', { type: 'number', min: 20, max: 150 }), 'Audio: np. 25%; wideo: 60%; dokument: 90%. 100% oznacza wysokość okna przeglądarki. Podgląd można też otworzyć na pełnym ekranie.')
      );
    } else if (block.type === 'presentation') {
      syncInspectorRepository(block.repositoryId);
      const presentations = (state.contentLibrary.presentations || [])
        .filter((asset) => !block.repositoryId || asset.repositoryId === block.repositoryId);
      form.append(
        field(
          'Repozytorium prezentacji',
          lessonSelect(block.repositoryId, 'repositoryId', repositoryOptions(true)),
          'Lekcja przechowuje stabilną referencję. Edycja prezentacji w bibliotece automatycznie zaktualizuje materiał otwierany z lekcji.'
        ),
        field(
          'Prezentacja z biblioteki',
          materialPicker(lessonInput(block.presentationId, 'presentationId', { placeholder: 'Wyszukaj prezentację…' }), presentations, {
            type: 'Prezentacja',
            icon: 'S',
            empty: 'Brak prezentacji w tej bibliotece.',
            allowCustom: false
          })
        ),
        field('Tytuł kafelka', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Opis dla ucznia', lessonTextarea(block.description, 'description', { rows: 4, maxLength: 500 })),
        field('Tekst przycisku', lessonInput(block.button, 'button', { maxLength: 80 }))
      );
    } else if (block.type === 'quiz' || block.type === 'study') {
      syncInspectorRepository(block.repositoryId);
      const quizzes = (state.contentLibrary.quizzes || [])
        .filter((asset) => !block.repositoryId || asset.repositoryId === block.repositoryId);
      const pickerInput = lessonInput(block.quizId, 'quizId', { placeholder: block.type === 'study' ? 'Wyszukaj pulę…' : 'Wyszukaj quiz…' });
      // Searching does not overwrite the reference: commit only a verified pool.
      if (block.type === 'study') delete pickerInput.dataset.lessonField;
      form.append(
        field(
          'Repozytorium quizu',
          lessonSelect(block.repositoryId, 'repositoryId', repositoryOptions(true)),
          'Lekcja wskazuje opublikowaną definicję quizu z biblioteki i nie kopiuje pytań.'
        ),
        field(
          block.type === 'study' ? 'Pula nauki z biblioteki' : 'Quiz z biblioteki',
          materialPicker(pickerInput, quizzes, {
            type: 'Quiz',
            icon: 'Q',
            empty: 'Brak quizów w tej bibliotece.',
            allowCustom: false,
            ...(block.type === 'study' ? { onPick: async (asset) => {
              const repo = block.repositoryId || asset.repositoryId || state.contentLibrary.selectedRepositoryId;
              try {
                await requireStudyPool(asset.filename, repo);
                commitMutation('lesson', () => { block.quizId = asset.filename; block.repositoryId = repo; });
                return true;
              } catch (error) { toast('Nie wybrano puli', error.message, 'error'); return false; }
            } } : {})
          }),
          block.type === 'study' ? `Lista obejmuje quizy i pule. Przy wyborze sprawdzamy, czy materiał jest aktywną pulą nauki. Wybrana pula: ${block.quizId || 'brak'}.` : ''
        ),
        field('Tytuł kafelka', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Opis dla ucznia', lessonTextarea(block.description, 'description', { rows: 4, maxLength: 500 })),
        field('Tekst przycisku', lessonInput(block.button, 'button', { maxLength: 80 }))
      );
    } else if (block.type === 'pdf') {
      form.append(
        field(
          'ID, link Google Drive lub adres HTTPS',
          lessonInput(block.pdfId, 'pdfId', {
            placeholder: ['4', '5'].includes(block.protection) ? 'https://…/material.pdf' : 'ID lub link udostępniania Google Drive',
            maxLength: 500
          }),
          ['4', '5'].includes(block.protection)
            ? 'W tym trybie wymagany jest pełny, bezpieczny adres HTTPS.'
            : 'Możesz wkleić samo ID pliku albo link udostępniania z Dysku Google.'
        ),
        field('Tryb wyświetlania / ochrony', lessonSelect(block.protection, 'protection', [
          { value: '1', label: '1 — podgląd chroniony' },
          { value: '2', label: '2 — wymuszone pobranie' },
          { value: '3', label: '3 — zwykły podgląd' },
          { value: '4', label: '4 — osadź dowolny adres HTTPS' },
          { value: '5', label: '5 — otwórz adres w przeglądarce' }
        ]), 'To te same tryby PDF, które są dostępne w konfiguratorze dashboardu.'),
        field('Tytuł kafelka', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Opis dla ucznia', lessonTextarea(block.description, 'description', { rows: 4, maxLength: 500 })),
        field('Tekst przycisku', lessonInput(block.button, 'button', { maxLength: 80 }))
      );
    } else if (block.type === 'exam') {
      syncInspectorRepository(block.repositoryId);
      const exams = (state.contentLibrary.exams || [])
        .filter((asset) => !block.repositoryId || asset.repositoryId === block.repositoryId);
      form.append(
        field(
          'Repozytorium egzaminu',
          lessonSelect(block.repositoryId, 'repositoryId', repositoryOptions(true)),
          'Lekcja przechowuje wyłącznie stabilną referencję do egzaminu, nie kopiuje jego pytań.'
        ),
        field(
          'Egzamin z biblioteki',
          materialPicker(lessonInput(block.examId, 'examId', { placeholder: 'Wyszukaj egzamin…' }), exams, {
            type: 'Egzamin',
            icon: 'E',
            empty: 'Brak egzaminów w tej bibliotece.',
            allowCustom: false
          })
        ),
        field('Tytuł kafelka', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Opis dla ucznia', lessonTextarea(block.description, 'description', { rows: 4, maxLength: 500 })),
        field('Tekst przycisku', lessonInput(block.button, 'button', { maxLength: 80 })),
        field('Warunek tego użycia', lessonSelect(block.requirement, 'requirement', [
          { value: 'optional', label: 'Opcjonalny' },
          { value: 'completed', label: 'Wymagane ukończenie' },
          { value: 'passed', label: 'Wymagane zaliczenie' },
          { value: 'minimum_score', label: 'Wymagany minimalny wynik' }
        ]), 'Warunek dotyczy tylko tego kroku lekcji. Nie zmienia progu w globalnej definicji egzaminu.')
      );
      if (block.requirement === 'minimum_score') {
        form.append(field(
          'Minimalny wynik w tej lekcji (%)',
          lessonInput(String(block.minimumScore), 'minimumScore', { type: 'number', min: 0, max: 100 }),
          'Możesz wymagać tu np. 75%, nawet jeśli globalny próg egzaminu wynosi 60%.'
        ));
      }
      form.append(create(
        'p',
        'formula-builder-tip',
        'W trybie sekwencyjnym wynik jest ponownie sprawdzany po stronie serwera przed odblokowaniem kolejnego kroku.'
      ));
    } else if (block.type === 'atonom') {
      form.append(
        field(
          'Nazwa związku chemicznego',
          lessonInput(block.formula, 'formula', {
            placeholder: 'np. kwas octowy, etanol, cis-but-2-en',
            maxLength: 140
          }),
          'W lekcji pojawi się kafelek. Model /members/module/atonom/?formula=nazwa-związku zostanie załadowany dopiero po kliknięciu.'
        ),
        field('Tytuł modelu', lessonInput(block.title, 'title', { maxLength: 180 }))
      );
    } else if (block.type === 'formula') {
      form.append(
        field('Rodzaj zapisu', lessonSelect(block.mode, 'mode', [
          { value: 'chemistry', label: 'Chemia — wzór lub reakcja' },
          { value: 'math', label: 'Matematyka — równanie i symbole' }
        ])),
        formulaComposerPreview(),
        formulaPresetPicker(block.mode),
        field('Podpis pod wzorem', lessonInput(block.title, 'title', { maxLength: 180 }))
      );
      if (block.mode === 'math') {
        form.append(
          field(
            'Edytowane równanie',
            lessonTextarea(block.expression, 'expression', {
              rows: 6,
              maxLength: 500,
              placeholder: 'np. E = mc^{2} albo \\frac{n}{V}'
            }),
            'Kliknij miejsce w równaniu, a następnie wybierz strukturę lub symbol z palety.'
          ),
          formulaSymbolGroup('Struktury', [
            ['x²', '^{2}', 'expression', 'Potęga'],
            ['xₙ', '_{n}', 'expression', 'Indeks dolny'],
            ['a⁄b', '\\frac{a}{b}', 'expression', 'Ułamek'],
            ['√x', '\\sqrt{x}', 'expression', 'Pierwiastek'],
            ['Σ', '\\sum_{i=1}^{n}', 'expression', 'Suma'],
            ['∏', '\\prod_{i=1}^{n}', 'expression', 'Iloczyn'],
            ['∫', '\\int_{a}^{b}', 'expression', 'Całka'],
            ['lim', '\\lim_{x \\rightarrow 0}', 'expression', 'Granica'],
            ['v⃗', '\\vec{v}', 'expression', 'Wektor']
          ]),
          formulaSymbolGroup('Działania i relacje', [
            ['×', '\\times', 'expression'],
            ['÷', '\\div', 'expression'],
            ['±', '\\pm', 'expression'],
            ['≈', '\\approx', 'expression'],
            ['≠', '\\neq', 'expression'],
            ['≤', '\\le', 'expression'],
            ['≥', '\\ge', 'expression'],
            ['→', '\\rightarrow', 'expression'],
            ['↔', '\\leftrightarrow', 'expression'],
            ['∞', '\\infty', 'expression']
          ]),
          formulaSymbolGroup('Litery greckie i funkcje', [
            ['α', '\\alpha', 'expression'],
            ['β', '\\beta', 'expression'],
            ['γ', '\\gamma', 'expression'],
            ['Δ', '\\Delta', 'expression'],
            ['θ', '\\theta', 'expression'],
            ['λ', '\\lambda', 'expression'],
            ['μ', '\\mu', 'expression'],
            ['π', '\\pi', 'expression'],
            ['σ', '\\sigma', 'expression'],
            ['Ω', '\\Omega', 'expression'],
            ['∂', '\\partial', 'expression'],
            ['ln', '\\ln', 'expression']
          ])
        );
      } else {
        const composer = create('section', 'formula-chemistry-composer');
        const composerHeader = create('header');
        composerHeader.append(
          create('strong', '', 'Wizualny układ reakcji'),
          create('small', '', 'Edytuj równanie od lewej do prawej — jak w edytorze równań.')
        );
        const equation = create('div', 'formula-chemistry-equation');
        const arrowColumn = create('div', 'formula-chemistry-arrow-fields');
        arrowColumn.append(
          field(
            'Nad strzałką',
            lessonInput(block.above, 'above', { placeholder: '450 °C, Δ, hν', maxLength: 120 })
          ),
          field('Strzałka', lessonSelect(block.arrow, 'arrow', [
            { value: '', label: '∅' },
            { value: '->', label: '→' },
            { value: '<-', label: '←' },
            { value: '<->', label: '↔' },
            { value: '<=>', label: '⇌' },
            { value: '<=>>', label: '⇌→' },
            { value: '<<=>', label: '←⇌' }
          ])),
          field(
            'Pod strzałką',
            lessonInput(block.below, 'below', { placeholder: 'kat. Pt, 2 atm', maxLength: 120 })
          )
        );
        equation.append(
          field(
            'Substraty / wzór',
            lessonInput(block.left, 'left', { placeholder: '2 H2 + O2', maxLength: 300 }),
            'Kliknij to pole, a symbole z palety trafią tutaj.'
          ),
          arrowColumn,
          field(
            'Produkty',
            lessonInput(block.right, 'right', { placeholder: '2 H2O', maxLength: 300 }),
            'Kliknij to pole, aby wstawiać symbole po prawej stronie.'
          )
        );
        composer.append(composerHeader, equation);
        form.append(
          composer,
          formulaArrowPicker(block.arrow),
          formulaSymbolGroup('Wstaw do ostatnio wybranego pola substratów lub produktów', [
            ['＋', ' + ', 'active', 'Znak plus'],
            ['H₂O', 'H2O', 'active', 'Wzór wody'],
            ['CO₂', 'CO2', 'active', 'Tlenek węgla(IV)'],
            ['SO₄²⁻', 'SO4^2-', 'active', 'Jon siarczanowy(VI)'],
            ['NH₄⁺', 'NH4+', 'active', 'Jon amonowy'],
            ['¹⁴C', '^14C', 'active', 'Izotop'],
            ['Feᴵᴵᴵ', 'Fe^{III}', 'active', 'Stopień utlenienia'],
            ['(s)', '(s)', 'active', 'Ciało stałe'],
            ['(l)', '(l)', 'active', 'Ciecz'],
            ['(g)', '(g)', 'active', 'Gaz'],
            ['(aq)', '(aq)', 'active', 'Roztwór wodny'],
            ['↓ osad', ' v', 'active', 'Osad']
          ]),
          formulaSymbolGroup('Warunki reakcji', [
            ['Δ', 'Δ', 'above', 'Ogrzewanie nad strzałką'],
            ['hν', 'hν', 'above', 'Światło nad strzałką'],
            ['25 °C', '25 °C', 'above', 'Temperatura nad strzałką'],
            ['450 °C', '450 °C', 'above', 'Temperatura nad strzałką'],
            ['kat. Pt', 'kat. Pt', 'below', 'Katalizator pod strzałką'],
            ['kat. Fe', 'kat. Fe', 'below', 'Katalizator pod strzałką'],
            ['2 atm', '2 atm', 'below', 'Ciśnienie pod strzałką']
          ]),
          create(
            'p',
            'formula-builder-tip',
            'Cyfry są zamieniane na indeksy automatycznie. Ładunek zapisuj np. SO4^2-, izotop jako ^14C, a stopień utlenienia jako Fe^{III}.'
          )
        );
      }
    } else if (block.type === 'ai') {
      const includeSlide = create('label', 'check-field');
      includeSlide.append(
        lessonInput('', 'includeSlide', { type: 'checkbox', checked: block.includeSlide !== false }),
        create('span', '', 'Dołącz widoczną treść slajdu, ALT obrazów, tytuły osadzonych materiałów i fiszki')
      );
      const includeTask = create('label', 'check-field');
      includeTask.append(
        lessonInput('', 'includeTask', { type: 'checkbox', checked: block.includeTask !== false }),
        create('span', '', 'Dołącz zadanie, warianty odpowiedzi i bieżącą próbę ucznia')
      );
      form.append(
        field('Tytuł kafelka AI', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Opis dla ucznia', lessonTextarea(block.description, 'description', { rows: 4, maxLength: 500 })),
        field('Tekst przycisku', lessonInput(block.button, 'button', { maxLength: 80 })),
        field(
          'Dodatkowy kontekst autora dla AI',
          lessonTextarea(block.authorContext, 'authorContext', {
            rows: 10,
            maxLength: 6000,
            placeholder: 'Np. Na prezentacji Google: slajd 1 pokazuje…\nPo lewej stronie ilustracji znajduje się…\nWażne oznaczenia i relacje: …'
          }),
          'Tekst nie jest pokazywany kursantowi. Opisz tutaj obrazy, wykresy, rozmieszczenie elementów oraz treść slajdów Google, których AI nie może samodzielnie odczytać.'
        ),
        includeSlide,
        includeTask,
        field(
          'Repozytorium promptu',
          lessonSelect(block.repositoryId, 'repositoryId', repositoryOptions(true)),
          'Pozostaw domyślne, jeśli AI ma korzystać ze zwykłego trybu lub prompt znajduje się w głównym repozytorium.'
        ),
        field(
          'Plik promptu — opcjonalnie',
          lessonRepositoryFilenameInput(
            block.promptFile,
            'promptFile',
            ['json', 'txt'],
            block.repositoryId
          ),
          'Kliknij pole, aby wybrać plik JSON lub TXT z repozytorium. Nadal możesz wpisać nazwę ręcznie. Bez pliku otworzy się ogólny asystent.'
        )
      );
      if (/\.txt$/i.test(block.promptFile)) {
        form.append(field(
          'Numer punktu w pliku TXT',
          lessonInput(block.promptPoint, 'promptPoint', { type: 'number', min: 1, max: 9999 }),
          'Dla pliku JSON numer punktu nie jest używany.'
        ));
      }
      form.append(create(
        'p',
        'formula-builder-tip',
        'Kontekst jest jednorazowo dołączany do pierwszego pytania: najpierw opis autora, następnie zadanie, media i widoczna treść. Poprawne odpowiedzi nie są ujawniane AI.'
      ));
    } else if (block.type === 'board') {
      const newTab = create('label', 'check-field');
      newTab.append(
        lessonInput('', 'newTab', { type: 'checkbox', checked: block.newTab }),
        create('span', '', 'Otwieraj tablicę w nowej karcie')
      );
      form.append(
        field('Rodzaj tablicy', lessonSelect(block.variant, 'variant', [
          { value: 'whiteboard', label: 'Biała tablica — szybkie szkicowanie' },
          { value: 'bitpaper', label: 'BitPaper — rozbudowana plansza' }
        ])),
        field('Tytuł kafelka', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Krótki opis', lessonTextarea(block.description, 'description', { rows: 4, maxLength: 500 })),
        field('Tekst przycisku', lessonInput(block.button, 'button', { maxLength: 80 }))
      );
      if (block.variant === 'bitpaper') {
        form.append(field(
          'Plik gotowej planszy — opcjonalnie',
          lessonInput(block.path, 'path', { placeholder: 'np. stechiometria.json', maxLength: 100 }),
          'Pusta wartość otwiera nową tablicę. Nazwa pliku musi kończyć się .json i nie może zawierać ścieżki.'
        ));
      }
      form.append(newTab);
    } else if (block.type === 'contact') {
      const newTab = create('label', 'check-field');
      newTab.append(
        lessonInput('', 'newTab', { type: 'checkbox', checked: block.newTab }),
        create('span', '', 'Otwieraj formularz w nowej karcie')
      );
      form.append(
        field('Tytuł kafelka', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Krótki opis', lessonTextarea(block.description, 'description', { rows: 4, maxLength: 500 })),
        field('Tekst przycisku', lessonInput(block.button, 'button', { maxLength: 80 })),
        field(
          'Wstępna treść wiadomości — opcjonalnie',
          lessonTextarea(block.internal, 'internal', { rows: 4, maxLength: 240 }),
          'Ta treść pojawi się w formularzu jako podpowiedź dla ucznia. Adres e-mail oraz imię zostaną uzupełnione z zalogowanego konta.'
        ),
        newTab,
        create(
          'p',
          'formula-builder-tip',
          'Odpowiedzi znajdziesz w panelu administratora, w zakładce Formularze. Możesz je przeglądać, pobrać lub usunąć.'
        )
      );
    } else if (block.type === 'link') {
      const newTab = create('label', 'check-field');
      newTab.append(
        lessonInput('', 'newTab', { type: 'checkbox', checked: block.newTab }),
        create('span', '', 'Otwieraj w nowej karcie')
      );
      form.append(
        field('Tytuł kafelka', lessonInput(block.title, 'title', { maxLength: 180 })),
        field('Krótki opis', lessonTextarea(block.description, 'description', { rows: 4, maxLength: 500 })),
        field(
          'Adres linku',
          lessonInput(block.url, 'url', {
            placeholder: 'https://… albo /members/module/…',
            maxLength: 500
          }),
          'Dozwolone są adresy http/https, mailto:, kotwice # oraz wewnętrzne ścieżki zaczynające się od /.'
        ),
        field('Ikona', lessonSelect(block.icon, 'icon', [
          { value: 'link', label: '↗ Link' },
          { value: 'book', label: '▤ Książka / lekcja' },
          { value: 'video', label: '▶ Film' },
          { value: 'chemistry', label: '⚗ Chemia' },
          { value: 'math', label: '∑ Matematyka' },
          { value: 'file', label: '▧ Plik' },
          { value: 'external', label: '⤴ Strona zewnętrzna' }
        ])),
        field('Kolor akcentu', lessonInput(block.color, 'color', { type: 'color' })),
        newTab
      );
    } else if (block.type === 'flashcards') {
      form.append(
        field('Tytuł zestawu', lessonInput(block.title, 'title', { maxLength: 180 })),
        field(
          'Fiszki — jedna w wierszu',
          lessonTextarea(
            block.cards.map((card) => `${card.front} => ${card.back}`).join('\n'),
            'cards',
            { rows: 10, maxLength: 6000, placeholder: 'Pojęcie => Wyjaśnienie' }
          ),
          'Rozdziel przód i tył znakiem =>. Dodaj co najmniej dwie fiszki.'
        ),
        field('Kolor fiszek', lessonInput(block.color, 'flashcardColor', { type: 'color' }))
      );
    } else if (block.type === 'student-answer') {
      const questionIdRow = create('div', 'stable-question-id-row');
      const questionId = lessonInput(block.questionId, 'questionId', { maxLength: 96 });
      questionId.readOnly = true;
      questionId.setAttribute('aria-label', 'Stabilny identyfikator pytania');
      const regenerate = create('button', 'button button-soft', 'Wygeneruj nowe ID');
      regenerate.type = 'button';
      regenerate.dataset.lessonInspectorAction = 'regenerate-question-id';
      questionIdRow.append(questionId, regenerate);
      const multiline = create('label', 'check-field');
      multiline.append(
        lessonInput('', 'multiline', { type: 'checkbox', checked: block.multiline !== false }),
        create('span', '', 'Odpowiedź wieloliniowa (textarea)')
      );
      const required = create('label', 'check-field');
      required.append(
        lessonInput('', 'required', { type: 'checkbox', checked: block.required !== false }),
        create('span', '', 'Wymagaj odpowiedzi przed przejściem dalej')
      );
      const saveToProgress = create('label', 'check-field');
      saveToProgress.append(
        lessonInput('', 'saveToProgress', { type: 'checkbox', checked: block.saveToProgress !== false }),
        create('span', '', 'Zapisuj odpowiedź w postępie ucznia')
      );
      const allowEdit = create('label', 'check-field');
      allowEdit.append(
        lessonInput('', 'allowEdit', { type: 'checkbox', checked: block.allowEdit !== false }),
        create('span', '', 'Pozwól wrócić i poprawić zapisaną odpowiedź')
      );
      const dimensions = create('div', 'field-row');
      dimensions.append(
        field(
          'Minimalna wysokość pola (px)',
          lessonInput(String(block.minHeight || 160), 'minHeight', { type: 'number', min: 80, max: 800 })
        ),
        field(
          'Limit znaków',
          lessonInput(block.maxLength ? String(block.maxLength) : '', 'maxLength', {
            type: 'number',
            min: 0,
            max: 6000,
            placeholder: '0 = bez limitu'
          }),
          'Wartość 0 lub puste pole wyłącza limit.'
        )
      );
      form.append(
        field(
          'Stabilny questionId',
          questionIdRow,
          'Omówienie używa tego ID, więc przesuwanie slajdów nie rozłącza pary. Nowe ID automatycznie aktualizuje powiązane omówienia.'
        ),
        field('Treść pytania', lessonTextarea(block.question, 'question', { rows: 5, maxLength: 8000 })),
        scientificNotationToolbar(),
        field('Nagłówek pola', lessonInput(block.label, 'label', { maxLength: 160 })),
        field('Placeholder', lessonInput(block.placeholder, 'placeholder', { maxLength: 240 })),
        field('Tekst przycisku zapisu', lessonInput(block.button, 'button', { maxLength: 100 })),
        dimensions,
        multiline,
        required,
        saveToProgress,
        allowEdit,
        create(
          'p',
          'formula-builder-tip',
          'Zapisanie odpowiedzi nie uruchamia AI. AI może pojawić się dopiero w powiązanym klocku „Omówienie odpowiedzi” i tylko po świadomym kliknięciu ucznia.'
        ),
        studentAnswerWorkflowActions(block)
      );
    } else if (block.type === 'answer-review') {
      const questionOptions = answerReviewQuestionOptions(block);
      const questionSelect = lessonSelect(block.questionId, 'questionId', questionOptions);
      questionSelect.disabled = questionOptions.length === 1 && !questionOptions[0].value;
      const linkedQuestion = lessonStudentAnswerByQuestionId(block.questionId);
      const reviewSlideIndex = state.lesson.model.slides.indexOf(found.slide);
      const linkedEarlier = Boolean(linkedQuestion && linkedQuestion.slideIndex < reviewSlideIndex);
      const linkedSummary = create('div', `answer-review-link-summary${linkedEarlier ? '' : ' is-missing'}`);
      linkedSummary.append(
        create('span', '', linkedEarlier ? '✓' : '!'),
        create('div')
      );
      linkedSummary.lastElementChild.append(
        create(
          'strong',
          '',
          linkedEarlier
            ? 'Pytanie powiązane przez questionId'
            : linkedQuestion ? 'Pytanie musi być na wcześniejszym slajdzie' : 'Brakuje powiązanego pytania'
        ),
        create(
          'small',
          '',
          linkedEarlier
            ? String(linkedQuestion.block.question || block.question || block.questionId).replace(/\s+/g, ' ').slice(0, 260)
            : linkedQuestion
              ? 'Przenieś omówienie na slajd znajdujący się po pytaniu. Samo położenie klocka na tym samym slajdzie nie wystarcza.'
              : 'Wybierz wcześniejsze pytanie otwarte. Samo położenie slajdu nie jest używane do powiązania.'
        )
      );
      const questionSnapshot = lessonTextarea(block.question, 'questionSnapshot', { rows: 4, maxLength: 8000 });
      questionSnapshot.readOnly = true;
      const aiInstruction = lessonTextarea(block.aiInstruction, 'aiInstruction', {
        rows: 7,
        maxLength: 2000,
        placeholder: 'Np. oceń poprawność merytoryczną i nie wymagaj identycznego słownictwa.'
      });
      aiInstruction.disabled = block.aiEnabled === false;
      const showStudentAnswer = create('label', 'check-field');
      showStudentAnswer.append(
        lessonInput('', 'showStudentAnswer', { type: 'checkbox', checked: block.showStudentAnswer !== false }),
        create('span', '', 'Pokaż dokładną odpowiedź zapisaną przez ucznia')
      );
      const aiEnabled = create('label', 'check-field answer-review-ai-toggle');
      aiEnabled.append(
        lessonInput('', 'aiEnabled', { type: 'checkbox', checked: block.aiEnabled !== false }),
        create('span', '', 'Zezwól uczniowi na opcjonalne „Zapytaj AI”')
      );
      form.append(
        field(
          'Powiązane wcześniejsze pytanie',
          questionSelect,
          'Lista pokazuje wcześniejsze klocki „Pytanie otwarte”. Powiązanie pozostaje stabilne po zmianie kolejności slajdów.'
        ),
        linkedSummary,
        field(
          'Treść pytania przekazywana do omówienia',
          questionSnapshot,
          'Snapshot jest aktualizowany automatycznie, gdy autor zmienia treść powiązanego pytania.'
        ),
        field('Kolejność porównania', lessonSelect(block.order || 'student-first', 'order', [
          { value: 'student-first', label: 'Najpierw odpowiedź ucznia, potem klucz' },
          { value: 'key-first', label: 'Najpierw klucz, potem odpowiedź ucznia' }
        ])),
        showStudentAnswer,
        aiEnabled,
        field(
          'Instrukcja dla AI — opcjonalnie',
          aiInstruction,
          block.aiEnabled === false
            ? 'Włącz opcjonalne AI, aby edytować instrukcję. Zapisana treść nie jest usuwana.'
            : 'AI otrzyma pytanie, aktualną odpowiedź ucznia, klucz autora i tę instrukcję dopiero po kliknięciu „Zapytaj AI”. Maksymalnie 2000 znaków.'
        )
      );
      form.append(
        answerKeyQuickInsert(),
        create(
          'p',
          'formula-builder-tip answer-review-ai-note',
          'Podgląd Studio nigdy nie wykonuje zapytania AI. W lekcji samo otwarcie omówienia również nie zużywa tokenów ani limitu.'
        )
      );
    } else if (block.type === 'style') {
      const primaryText = block.blocks.find((child) => child.type === 'text');
      form.append(field(
        'Treść tekstu',
        lessonTextarea(primaryText ? primaryText.text : '', 'styledText', {
          rows: 7,
          maxLength: 4000,
          placeholder: 'Wpisz treść akapitu…'
        }),
        'Możesz też przeciągnąć do tego kontenera nagłówek, listę, obraz lub callout.'
      ));
      const row = create('div', 'field-row');
      const fontLabels = {
        sans: 'Systemowa (Inter)',
        arial: 'Arial',
        verdana: 'Verdana',
        serif: 'Szeryfowa',
        georgia: 'Georgia',
        times: 'Times New Roman',
        rounded: 'Zaokrąglona',
        mono: 'Monospace',
        courier: 'Courier New'
      };
      row.append(
        field('Czcionka', lessonSelect(block.font, 'font', lessonModelApi.STYLE_FONTS.map((value) => ({
          value,
          label: fontLabels[value] || value
        })))),
        field('Rozmiar', lessonSelect(block.size, 'size', [
          { value: 'small', label: 'Mały' },
          { value: 'normal', label: 'Normalny' },
          { value: 'large', label: 'Duży' },
          { value: 'xlarge', label: 'Bardzo duży' }
        ]))
      );
      const alignRow = create('div', 'field-row');
      alignRow.append(
        field('Wyrównanie', lessonSelect(block.align, 'align', [
          { value: 'left', label: 'Do lewej' },
          { value: 'center', label: 'Wyśrodkowane' },
          { value: 'right', label: 'Do prawej' }
        ])),
        field('Kolor tekstu', lessonInput(block.color || '#0e665a', 'color', { type: 'color' }))
      );
      const backgroundRow = create('div', 'field-row');
      backgroundRow.append(
        field('Kolor tła', lessonInput(block.background || '#e8f5ef', 'background', { type: 'color' }))
      );
      const useColor = create('label', 'check-field');
      useColor.append(
        lessonInput('', 'useColor', { type: 'checkbox', checked: Boolean(block.color) }),
        create('span', '', 'Użyj własnego koloru tekstu')
      );
      const useBold = create('label', 'check-field');
      useBold.append(
        lessonInput('', 'bold', { type: 'checkbox', checked: Boolean(block.bold) }),
        create('span', '', 'Pogrub cały tekst w tym bloku')
      );
      const useBackground = create('label', 'check-field');
      useBackground.append(
        lessonInput('', 'useBackground', { type: 'checkbox', checked: Boolean(block.background) }),
        create('span', '', 'Użyj kolorowego tła karty')
      );
      form.append(row, useBold, alignRow, useColor, backgroundRow, useBackground);
    } else if (block.type === 'accordion') {
      const open = create('label', 'check-field');
      open.append(
        lessonInput('', 'open', { type: 'checkbox', checked: block.open }),
        create('span', '', 'Domyślnie rozwinięta')
      );
      form.append(
        field('Tytuł harmonijki', lessonInput(block.title, 'title', { maxLength: 180 })),
        open
      );
    }
    form.append(lessonInspectorActions('block'));
    elements.lessonInspector.append(form);
    if (block.type === 'formula') updateFormulaComposerPreview(block);
  }

  function lessonPreviewMarkdown(slide) {
    const parts = slide.blocks.map((block) => lessonModelApi.serializeBlock(block)).filter(Boolean);
    if (slide.task && slide.task.question) parts.push(slide.task.question);
    return parts.join('\n\n');
  }

  function bindPreviewFlashcards(root) {
    all('.lesson-flashcard', root).forEach((card) => {
      card.addEventListener('click', () => {
        const flipped = card.getAttribute('aria-pressed') !== 'true';
        card.setAttribute('aria-pressed', String(flipped));
        card.classList.toggle('is-flipped', flipped);
      });
    });
  }

  function bindPreviewAtonom(root) {
    all('.lesson-atonom-open', root).forEach((button) => {
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
  }

  function studioPreviewAnswerKey(questionId) {
    return `${state.lesson.model?.filename || 'draft'}::${questionId || ''}`;
  }

  function bindPreviewOpenAnswers(root) {
    const refreshReviews = (questionId, answer) => {
      all('.lesson-answer-review[data-question-id]', root).forEach((review) => {
        if (review.dataset.questionId !== questionId) return;
        const display = review.querySelector('[data-student-answer-display]');
        if (display) {
          display.textContent = answer || 'Nie zapisano jeszcze odpowiedzi w tym podglądzie.';
          display.dataset.state = answer ? 'value' : 'empty';
          display.classList.toggle('is-empty', !answer);
        }
        const button = review.querySelector('[data-answer-review-ai]');
        const status = review.querySelector('[data-answer-review-status]');
        if (button) button.disabled = !answer.trim();
        if (status && !answer.trim()) {
          status.dataset.state = 'empty';
          status.textContent = 'Najpierw zapisz odpowiedź na powiązanym slajdzie.';
        } else if (status && status.dataset.state === 'empty') {
          status.dataset.state = '';
          status.textContent = '';
        }
      });
    };

    all('.lesson-student-answer[data-question-id]', root).forEach((card) => {
      const questionId = card.dataset.questionId || '';
      const field = card.querySelector('[data-student-answer-input]');
      const save = card.querySelector('[data-student-answer-save]');
      const status = card.querySelector('[data-student-answer-status]');
      const counter = card.querySelector('[data-student-answer-count]');
      if (!field || !questionId) return;
      const key = studioPreviewAnswerKey(questionId);
      const authorLimit = Math.max(0, Math.min(6000, Number(card.dataset.maxLength) || 0));
      const effectiveLimit = authorLimit || 6000;
      const required = card.dataset.required === 'true';
      const allowEdit = card.dataset.allowEdit !== 'false';
      let savedAnswer = (state.lesson.previewOpenAnswers.get(key) || '').slice(0, effectiveLimit);
      if (state.lesson.previewOpenAnswers.has(key)) {
        state.lesson.previewOpenAnswers.set(key, savedAnswer);
      }
      field.maxLength = effectiveLimit;
      if (!field.value && savedAnswer) field.value = savedAnswer;
      const updateCounter = () => {
        if (!counter) return;
        counter.textContent = authorLimit
          ? `${field.value.length} / ${authorLimit}`
          : `${field.value.length} znaków`;
      };
      const markDraft = () => {
        updateCounter();
        if (status) {
          const changed = field.value !== savedAnswer;
          status.dataset.state = changed ? 'dirty' : savedAnswer ? 'saved' : '';
          status.textContent = changed
            ? 'Niezapisana wersja robocza w podglądzie Studio — AI nie zostało użyte.'
            : savedAnswer ? 'Odpowiedź jest zapisana w podglądzie Studio.' : '';
        }
      };
      field.addEventListener('input', markDraft);
      save?.addEventListener('click', (event) => {
        event.preventDefault();
        const answer = field.value.slice(0, effectiveLimit);
        if (field.value !== answer) field.value = answer;
        if (required && !answer.trim()) {
          field.setAttribute('aria-invalid', 'true');
          if (status) {
            status.dataset.state = 'error';
            status.textContent = 'To pytanie wymaga odpowiedzi.';
          }
          field.focus();
          return;
        }
        field.removeAttribute('aria-invalid');
        savedAnswer = answer;
        state.lesson.previewOpenAnswers.set(key, answer);
        refreshReviews(questionId, answer);
        updateCounter();
        if (status) {
          status.dataset.state = 'saved';
          status.textContent = 'Zapisano tylko w podglądzie Studio. Nie wysłano żadnego zapytania AI.';
        }
        if (!allowEdit && answer.trim()) {
          field.readOnly = true;
          if (save) save.disabled = true;
        }
      });
      if (savedAnswer && !allowEdit) {
        field.readOnly = true;
        if (save) save.disabled = true;
      }
      updateCounter();
      refreshReviews(questionId, savedAnswer);
    });

    all('.lesson-answer-review[data-question-id]', root).forEach((review) => {
      const questionId = review.dataset.questionId || '';
      const answer = state.lesson.previewOpenAnswers.get(studioPreviewAnswerKey(questionId)) || '';
      refreshReviews(questionId, answer);
      const button = review.querySelector('[data-answer-review-ai]');
      const status = review.querySelector('[data-answer-review-status]');
      button?.addEventListener('click', (event) => {
        event.preventDefault();
        if (status) {
          status.dataset.state = 'preview';
          status.textContent = 'Podgląd Studio nie uruchamia AI. W opublikowanej lekcji request nastąpi dopiero po świadomym kliknięciu ucznia.';
        }
      });
    });
  }

  function previewTaskAiResponse(task, root) {
    const form = root?.querySelector('.preview-quiz');
    if (!task || !form) return '';
    if (task.type === 'gaps' || task.type === 'gaps-text') {
      return all('[data-preview-gap-index]', form).map((field) => field.value || '');
    }
    if (task.type === 'choice' || task.type === 'abcd') {
      const selected = form.querySelector('input[type="radio"]:checked');
      if (!selected) return '';
      const copy = selected.closest('label')?.querySelector('.preview-choice-copy')?.textContent?.trim() || '';
      return copy && copy !== selected.value ? `${selected.value} — ${copy}` : selected.value;
    }
    return form.querySelector('.preview-answer-field')?.value || '';
  }

  function previewAiAuthorContext(card) {
    const raw = card?.dataset.aiAuthorContext || '';
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : '';
    } catch (_) {
      return raw;
    }
  }

  function previewAiContext(root, card, task) {
    if (typeof window.ChemLesson?.buildLessonAiContext === 'function') {
      return window.ChemLesson.buildLessonAiContext({
        root,
        task,
        currentResponse: previewTaskAiResponse(task, root),
        authorContext: previewAiAuthorContext(card),
        includeSlide: card?.dataset.aiIncludeSlide !== 'false',
        includeTask: card?.dataset.aiIncludeTask !== 'false'
      });
    }
    return String(root?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
  }

  function openPreviewAiHelp(button, root) {
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

    try {
      const contextId = typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const slideRoot = button.closest('.lesson-preview-shell') || root;
      const slideId = slideRoot.dataset.lessonPreviewSlideId || '';
      const slide = state.lesson.model.slides.find((entry) => entry.id === slideId)
        || selectedLessonSlide();
      const context = previewAiContext(slideRoot, card, slide?.task || null);
      if (context) {
        localStorage.setItem(`chem.lesson-ai-context.${contextId}`, JSON.stringify({
          context,
          title: state.lesson.model.title,
          createdAt: Date.now()
        }));
        url.searchParams.set('lesson_context', contextId);
      }
    } catch (_) {
      // Czat nadal może zostać otwarty bez automatycznego kontekstu.
    }
    window.open(url.toString(), '_blank', 'noopener');
  }

  function bindPreviewAiHelp(root) {
    all('[data-lesson-ai-open]', root).forEach((button) => {
      button.addEventListener('click', () => openPreviewAiHelp(button, root));
    });
  }

  function clearTypesetMath(root, scope) {
    const targetWindow = scope || window;
    const formulas = root
      ? Array.from(root.querySelectorAll('.lesson-formula-display'))
      : [];
    if (!formulas.length) return;
    try {
      targetWindow.MathJax?.typesetClear?.(formulas);
    } catch (_) {
      // Brak MathJax nie może blokować podglądu pozostałej treści.
    }
  }

  function typesetMath(root, scope) {
    const targetWindow = scope || window;
    const mathJax = targetWindow.MathJax;
    const formulas = root
      ? Array.from(root.querySelectorAll('.lesson-formula-display'))
      : [];
    if (!formulas.length || !mathJax || typeof mathJax.typesetPromise !== 'function') return;
    const startup = mathJax.startup?.promise || Promise.resolve();
    const previous = targetWindow.__chemDiskMathPromise || startup;
    targetWindow.__chemDiskMathPromise = previous
      .catch(() => undefined)
      .then(() => mathJax.typesetPromise(formulas))
      .catch(() => undefined);
  }

  function preparePreviewYouTube(root) {
    if (!root) return;
    all('.lesson-youtube iframe', root).forEach((frame) => {
      try {
        const source = new URL(frame.getAttribute('src') || '', window.location.origin);
        source.searchParams.set('playsinline', '1');
        source.searchParams.set('rel', '0');
        source.searchParams.set('origin', window.location.origin);
        source.searchParams.set('widget_referrer', window.location.href);
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.removeAttribute('sandbox');
        frame.src = source.toString();
      } catch (_) {
        // Nieprawidłowe źródło jest już odrzucane przez parser lekcji.
      }
    });
  }

  function previewTaskById(taskId) {
    for (const slide of state.lesson.model.slides) {
      if (slide.task && slide.task.id === taskId) return slide.task;
    }
    return null;
  }

  function appendPreviewGapExercise(container, task, fieldId) {
    let gapIndex = 0;
    String(task.text || '').split('\n').forEach((sourceLine) => {
      const line = create('span', 'preview-gap-exercise-line');
      sourceLine.split(/(\{\{[^{}]*\}\})/).forEach((part) => {
        const gap = /^\{\{([^{}]*)\}\}$/.exec(part);
        if (!gap) {
          line.append(document.createTextNode(part));
          return;
        }
        const currentIndex = gapIndex;
        const gapLabel = gap[1].trim() || `luka ${currentIndex + 1}`;
        gapIndex += 1;
        if (task.type === 'gaps') {
          const select = create('select', 'preview-gap-field');
          select.name = `${fieldId}-${currentIndex}`;
          select.dataset.previewGapIndex = String(currentIndex);
          select.setAttribute('aria-label', `Luka ${currentIndex + 1}: ${gapLabel}`);
          const blank = create('option', '', gapLabel);
          blank.value = '';
          select.append(blank);
          task.options.forEach((option) => {
            const item = create('option', '', option);
            item.value = option;
            select.append(item);
          });
          line.append(select);
          return;
        }

        const wrapper = create('span', 'preview-text-gap');
        const input = create('input', 'preview-gap-field');
        input.type = 'text';
        input.name = `${fieldId}-${currentIndex}`;
        input.dataset.previewGapIndex = String(currentIndex);
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = gapLabel;
        input.setAttribute('aria-label', `Luka ${currentIndex + 1}: ${gapLabel}`);
        wrapper.append(input);
        if (task.checkMode === 'each') {
          const check = create('button', 'preview-gap-check', '✓');
          check.type = 'button';
          check.dataset.previewGapCheck = String(currentIndex);
          check.setAttribute('aria-label', `Sprawdź lukę ${currentIndex + 1}`);
          wrapper.append(check);
        }
        line.append(wrapper);
      });
      if (!line.childNodes.length) line.append(create('br'));
      container.append(line);
    });
  }

  function buildPreviewTask(task) {
    const form = create('form', 'preview-task preview-quiz');
    const fieldId = `preview-answer-${task.id}`;
    form.dataset.previewTaskId = task.id;
    form.noValidate = true;

    const eyebrow = create('span', 'preview-quiz-eyebrow', 'Sprawdź, czy rozumiesz');
    const heading = create('strong', 'preview-quiz-title', task.label || task.question || 'Odpowiedz na pytanie');
    const controls = create('div', 'preview-quiz-controls');
    if (task.type === 'choice' || task.type === 'abcd') {
      const fieldset = create('fieldset', `preview-choice-grid${task.type === 'abcd' ? ' is-abcd' : ''}`);
      const legend = create('legend', '', task.label || 'Wybierz odpowiedź');
      task.options.forEach((option, optionIndex) => {
        const optionLabel = create('label', 'preview-choice-option');
        const input = create('input');
        const marker = create('span', 'preview-choice-marker', String.fromCharCode(65 + optionIndex));
        const copy = create('span', 'preview-choice-copy', option);
        input.type = 'radio';
        input.name = fieldId;
        input.value = task.type === 'abcd' ? String.fromCharCode(65 + optionIndex) : option;
        optionLabel.append(input);
        if (task.type === 'abcd') optionLabel.append(marker);
        optionLabel.append(copy);
        fieldset.append(optionLabel);
      });
      fieldset.prepend(legend);
      controls.append(fieldset);
    } else if (task.type === 'gaps' || task.type === 'gaps-text') {
      const exercise = create('p', 'preview-gap-exercise');
      appendPreviewGapExercise(exercise, task, fieldId);
      controls.append(exercise);
    } else {
      const input = create('input', 'preview-answer-field');
      input.type = 'text';
      input.name = fieldId;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = task.placeholder || (task.type === 'number' ? 'Wpisz wynik' : 'Wpisz odpowiedź');
      input.inputMode = task.type === 'number' ? 'decimal' : 'text';
      input.setAttribute('aria-label', task.label || 'Twoja odpowiedź');
      controls.append(input);
    }

    const submit = create('button', 'button button-primary preview-quiz-submit', 'Sprawdź odpowiedź');
    submit.type = 'submit';
    submit.hidden = task.type === 'gaps-text' && task.checkMode === 'each';
    const feedback = create('p', 'preview-quiz-feedback');
    feedback.dataset.previewFeedback = '';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    form.append(eyebrow, heading, controls, submit, feedback);
    return form;
  }

  function bindPreviewTasks(root) {
    all('.preview-quiz[data-preview-task-id]', root).forEach((form) => {
      const task = previewTaskById(form.dataset.previewTaskId);
      if (!task || !window.ChemLesson) return;
      const feedback = form.querySelector('[data-preview-feedback]');
      const submit = form.querySelector('.preview-quiz-submit');
      const gapFields = Array.from(form.querySelectorAll('[data-preview-gap-index]'));
      const checkedGaps = new Set();
      const perGapMode = task.type === 'gaps-text' && task.checkMode === 'each';

      const showFeedback = (stateName, message) => {
        feedback.dataset.state = stateName;
        feedback.textContent = message;
      };
      const finish = () => {
        form.dataset.state = 'success';
        showFeedback('success', task.feedback || 'Dobrze! Odpowiedź jest poprawna.');
        all('input, select, button', form).forEach((control) => {
          control.disabled = true;
        });
        submit.textContent = 'Odpowiedź poprawna ✓';
      };
      const showError = (field, prefix = 'Jeszcze nie') => {
        form.dataset.state = 'error';
        field?.setAttribute('aria-invalid', 'true');
        showFeedback(
          'error',
          task.hint ? `${prefix}. Podpowiedź: ${task.hint}` : `${prefix} — popraw odpowiedź i spróbuj ponownie.`
        );
        field?.focus();
      };
      const readValue = () => {
        if (task.type === 'gaps' || task.type === 'gaps-text') {
          return gapFields.map((field) => field.value);
        }
        if (task.type === 'choice' || task.type === 'abcd') {
          return form.querySelector('input[type="radio"]:checked')?.value || '';
        }
        return form.querySelector('.preview-answer-field')?.value || '';
      };

      const setPreviewAnswerState = (field, result) => {
        if (!field) return;
        field.dataset.state = result;
        if (result === 'error') field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
        field.closest('.preview-text-gap')?.setAttribute('data-state', result);
        field.closest('.preview-choice-option')?.setAttribute('data-state', result);
      };

      const clearPreviewAnswerState = (field) => {
        if (!field || field.disabled) return;
        field.removeAttribute('data-state');
        field.removeAttribute('aria-invalid');
        field.closest('.preview-text-gap')?.removeAttribute('data-state');
        if (field.type === 'radio') {
          all('.preview-choice-option[data-state]', form).forEach((option) => {
            option.removeAttribute('data-state');
          });
        } else {
          field.closest('.preview-choice-option')?.removeAttribute('data-state');
        }
        if (form.dataset.state !== 'success') {
          form.removeAttribute('data-state');
          showFeedback('', '');
        }
      };

      const markPreviewAnswerStates = (answer) => {
        if (task.type === 'gaps' || task.type === 'gaps-text') {
          let correctCount = 0;
          let firstWrong = null;
          gapFields.forEach((field, index) => {
            const correct = window.ChemLesson.checkGapAnswer(task, answer[index], index);
            setPreviewAnswerState(field, correct ? 'success' : 'error');
            if (correct) correctCount += 1;
            else if (!firstWrong) firstWrong = field;
          });
          return { correctCount, total: gapFields.length, firstWrong };
        }
        if (task.type === 'choice' || task.type === 'abcd') {
          const selected = form.querySelector('input[type="radio"]:checked');
          const correct = window.ChemLesson.checkAnswer(task, answer);
          setPreviewAnswerState(selected, correct ? 'success' : 'error');
          return { correctCount: correct ? 1 : 0, total: 1, firstWrong: correct ? null : selected };
        }
        const field = form.querySelector('.preview-answer-field');
        const correct = window.ChemLesson.checkAnswer(task, answer);
        setPreviewAnswerState(field, correct ? 'success' : 'error');
        return { correctCount: correct ? 1 : 0, total: 1, firstWrong: correct ? null : field };
      };

      all('input, select', form).forEach((field) => {
        field.addEventListener('input', () => {
          clearPreviewAnswerState(field);
        });
      });

      all('[data-preview-gap-check]', form).forEach((button) => {
        button.addEventListener('click', () => {
          const gapIndex = Number(button.dataset.previewGapCheck);
          const input = gapFields[gapIndex];
          if (window.ChemLesson.checkGapAnswer(task, input.value, gapIndex)) {
            checkedGaps.add(gapIndex);
            setPreviewAnswerState(input, 'success');
            input.disabled = true;
            button.disabled = true;
            showFeedback('success', `Luka ${gapIndex + 1} jest poprawna.`);
            if (checkedGaps.size === gapFields.length) finish();
            else gapFields.find((field, index) => !checkedGaps.has(index))?.focus();
          } else {
            setPreviewAnswerState(input, 'error');
            showError(input, `Luka ${gapIndex + 1} jest niepoprawna`);
          }
        });
      });

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (form.dataset.state === 'success' || perGapMode) return;
        const answer = readValue();
        const result = markPreviewAnswerStates(answer);
        if (window.ChemLesson.checkAnswer(task, answer)) {
          finish();
          return;
        }
        const prefix = result.total > 1
          ? `${result.correctCount} z ${result.total} odpowiedzi jest poprawnych`
          : 'Ta odpowiedź jest niepoprawna';
        showError(result.firstWrong, prefix);
      });
    });
  }

  function buildLessonPreviewShell(slide, index, includeValidation, animateTransition) {
    const shell = create('div', 'lesson-preview-shell');
    shell.dataset.lessonPreviewSlideId = slide.id;
    const transition = lessonModelApi.SLIDE_TRANSITIONS.includes(slide.transition)
      ? slide.transition
      : 'fade';
    shell.dataset.transition = transition;
    shell.dataset.lessonBackground = lessonModelApi.SLIDE_BACKGROUNDS.includes(slide.background)
      ? slide.background
      : 'default';
    shell.dataset.lessonDecoration = lessonModelApi.SLIDE_DECORATIONS.includes(slide.decoration)
      ? slide.decoration
      : 'none';
    shell.dataset.lessonTone = lessonModelApi.SLIDE_TEXT_TONES.includes(slide.textTone)
      ? slide.textTone
      : 'auto';
    shell.style.setProperty('--lesson-slide-color', slide.backgroundColor || '#f8fafc');
    shell.classList.toggle('is-entering', Boolean(animateTransition) && transition !== 'none');
    const meta = create('div', 'lesson-preview-meta');
    meta.append(
      create('span', '', `Krok ${index + 1} z ${state.lesson.model.slides.length}`),
      create('span', '', state.lesson.model.filename)
    );
    const body = create('div', 'lesson-preview-body');
    body.classList.toggle('is-canvas-layout', slide.layout === 'canvas');
    try {
      body.innerHTML = window.ChemLesson.renderMarkdown(lessonPreviewMarkdown(slide));
    } catch (_) {
      body.append(create('p', '', 'Nie można teraz utworzyć podglądu tego slajdu.'));
    }
    shell.append(meta, body);
    if (slide.task) {
      shell.append(buildPreviewTask(slide.task));
    }
    const validation = includeValidation ? lessonModelApi.validateLesson(state.lesson.model) : null;
    if (validation && !validation.valid) {
      const warning = create('div', 'preview-task');
      warning.style.borderColor = 'var(--chem-danger)';
      warning.append(
        create('strong', '', 'Do poprawy przed eksportem'),
        create('span', '', validation.errors[0].message)
      );
      shell.append(warning);
    }
    return shell;
  }

  function renderLessonPreview() {
    clearTypesetMath(elements.lessonPreview);
    state.lesson.mediaObjectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    elements.lessonPreview.replaceChildren();
    const slide = selectedLessonSlide();
    if (!slide) return;
    state.lesson.previewSlideId = slide.id;
    const index = state.lesson.model.slides.indexOf(slide);
    const transitionKey = `${slide.id}:${slide.transition || 'fade'}`;
    const animateTransition = state.lesson.previewTransitionKey !== transitionKey;
    state.lesson.previewTransitionKey = transitionKey;
    elements.lessonPreview.append(
      previewToolbar('lesson'),
      buildLessonPreviewShell(slide, index, true, animateTransition)
    );
    preparePreviewYouTube(elements.lessonPreview);
    bindPreviewFlashcards(elements.lessonPreview);
    bindPreviewAtonom(elements.lessonPreview);
    bindPreviewOpenAnswers(elements.lessonPreview);
    bindPreviewAiHelp(elements.lessonPreview);
    bindPreviewTasks(elements.lessonPreview);
    void hydrateStudioLessonMedia(elements.lessonPreview).then(() => {
      bindLessonPreviewCanvasControls(elements.lessonPreview);
      bindLessonPreviewImageResize(elements.lessonPreview);
    });
    typesetMath(elements.lessonPreview);
    syncFullPreview('lesson');
  }

  async function hydrateStudioLessonMedia(root, objectUrls = state.lesson.mediaObjectUrls) {
    const library = window.ChemContentLibrary;
    const mediaDocument = root.ownerDocument || document;
    const isVisiblePreview = (figure) => figure.isConnected && !mediaDocument.defaultView?.closed;
    const mediaContext = {
      filename: state.lesson.remoteFilename || state.lesson.model.filename,
      repositoryId: state.lesson.remoteRepositoryId || state.contentLibrary.selectedRepositoryId
    };
    const figures = all('[data-lesson-media-ref]', root);
    const showError = (figure, error) => {
      if (!isVisiblePreview(figure)) return;
      figure.classList.add('is-error');
      const placeholder = create('div', 'lesson-managed-image-placeholder');
      const message = create(
        'small',
        '',
        error?.code === 'CONTENT_FILE_NOT_FOUND'
          ? 'Nie znaleziono pliku w folderze zdjęć tej lekcji.'
          : 'Nie udało się wczytać obrazu.'
      );
      const retry = create('button', 'lesson-image-retry', 'Spróbuj ponownie');
      retry.type = 'button';
      retry.addEventListener('click', () => {
        retry.disabled = true;
        message.textContent = 'Ponowne wczytywanie…';
        void loadFigure(figure, true);
      });
      placeholder.append(message, retry);
      figure.replaceChildren(placeholder);
    };
    const loadFigure = async (figure, bypassCache = false, position = 0) => {
      const shared = figure.dataset.lessonMediaScope === 'shared';
      let timer;
      try {
        const read = library.readMediaBlob({
          scope: shared ? 'shared' : 'local',
          materialKind: shared ? '' : 'lesson',
          materialId: shared
            ? ''
            : (figure.dataset.lessonMediaOwner || mediaContext.filename),
          reference: figure.dataset.lessonMediaRef,
          repositoryId: figure.dataset.lessonMediaRepository
            || mediaContext.repositoryId
        }, { bypassCache });
        const blob = await Promise.race([read, new Promise((_, reject) => {
          timer = window.setTimeout(() => reject(new Error('MEDIA_TIMEOUT')), 20_000);
        })]);
        if (!isVisiblePreview(figure)) return;
        const objectUrl = URL.createObjectURL(blob);
        const image = mediaDocument.createElement('img');
        image.addEventListener('error', () => {
          URL.revokeObjectURL(objectUrl);
          if (figure.contains(image)) showError(figure, new Error('IMAGE_DECODE_FAILED'));
        }, { once: true });
        image.src = objectUrl;
        image.alt = figure.dataset.lessonMediaAlt || 'Ilustracja';
        image.loading = position < 2 ? 'eager' : 'lazy';
        image.decoding = 'async';
        image.fetchPriority = position === 0 ? 'high' : 'auto';
        try { void image.decode?.().catch(() => undefined); } catch { /* dekodowanie dokończy się przy malowaniu */ }
        if (!isVisiblePreview(figure)) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        objectUrls.push(objectUrl);
        figure.classList.remove('is-error');
        figure.replaceChildren(image);
        if (bypassCache) bindLessonPreviewImageResize(root);
      } catch (error) {
        showError(figure, error);
      } finally { window.clearTimeout(timer); }
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
        if (!isVisiblePreview(figures[position])) continue;
        await loadFigure(figures[position], false, position);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, figures.length) }, worker));
  }

  function bindLessonPreviewCanvasControls(root) {
    const slide = selectedLessonSlide();
    if (!slide || slide.layout !== 'canvas') return;
    ensureLessonCanvasLayout(slide);
    all('.lesson-canvas-element[data-lesson-block-id]', root).forEach((element) => {
      const blockId = element.dataset.lessonBlockId;
      const block = slide.blocks.find((candidate) => candidate.id === blockId);
      if (!block) return;
      element.addEventListener('click', (event) => {
        if (event.target.closest('a, button, input, select, textarea, iframe')) return;
        if (state.lesson.selectedId === blockId) return;
        state.lesson.selectedId = blockId;
        renderLessonCanvas();
        renderLessonInspector();
        renderLessonPreview();
      });
      if (state.lesson.selectedId !== blockId) return;

      element.classList.add('is-selected');
      const moveHandle = create('button', 'lesson-canvas-move-handle', 'Przeciągnij');
      moveHandle.type = 'button';
      moveHandle.setAttribute('aria-label', 'Przeciągnij element po slajdzie');
      element.append(moveHandle);
      ['nw', 'ne', 'sw', 'se'].forEach((direction) => {
        const handle = create('button', `lesson-canvas-resize-handle is-${direction}`);
        handle.type = 'button';
        handle.dataset.canvasResize = direction;
        handle.setAttribute('aria-label', `Skaluj element od rogu ${direction.toUpperCase()}`);
        element.append(handle);
      });

      const beginGeometryEdit = (event, direction) => {
        if (event.button !== 0) return;
        const before = snapshot('lesson');
        const canvas = element.closest('.lesson-preview-body');
        const bounds = canvas.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const initial = { ...block.layout };
        const move = (moveEvent) => {
          const dx = (moveEvent.clientX - startX) / Math.max(bounds.width, 1) * 100;
          const dy = (moveEvent.clientY - startY) / Math.max(bounds.height, 1) * 100;
          let x = initial.x;
          let y = initial.y;
          let width = initial.width;
          let height = initial.height;
          if (!direction) {
            x += dx;
            y += dy;
          } else {
            if (direction.includes('e')) width += dx;
            if (direction.includes('s')) height += dy;
            if (direction.includes('w')) { x += dx; width -= dx; }
            if (direction.includes('n')) { y += dy; height -= dy; }
          }
          width = Math.max(8, Math.min(100 - x, width));
          height = Math.max(8, Math.min(100 - y, height));
          x = Math.max(0, Math.min(100 - width, x));
          y = Math.max(0, Math.min(100 - height, y));
          block.layout = {
            mode: 'canvas',
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            width: Math.round(width * 10) / 10,
            height: Math.round(height * 10) / 10
          };
          element.style.setProperty('--lesson-canvas-x', `${block.layout.x}%`);
          element.style.setProperty('--lesson-canvas-y', `${block.layout.y}%`);
          element.style.setProperty('--lesson-canvas-width', `${block.layout.width}%`);
          element.style.setProperty('--lesson-canvas-height', `${block.layout.height}%`);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          if (before !== snapshot('lesson')) pushHistory('lesson', before);
          scheduleDraftSave('lesson');
          renderLessonInspector();
          syncFullPreview('lesson');
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
        event.preventDefault();
        event.stopPropagation();
      };
      moveHandle.addEventListener('pointerdown', (event) => beginGeometryEdit(event, ''));
      all('[data-canvas-resize]', element).forEach((handle) => {
        handle.addEventListener('pointerdown', (event) => beginGeometryEdit(event, handle.dataset.canvasResize));
      });
    });
  }

  function bindLessonPreviewImageResize(root) {
    const found = findLessonNode(state.lesson.selectedId);
    if (!found || found.kind !== 'block' || found.node.type !== 'image') return;
    if (found.slide?.layout === 'canvas') return;
    const block = found.node;
    let shell = null;
    if (block.ref) {
      shell = all('[data-lesson-media-ref]', root).find((node) => node.dataset.lessonMediaRef === block.ref) || null;
    } else if (block.url) {
      const image = all('.lesson-preview-body img', root).find((node) => node.getAttribute('src') === block.url);
      if (image) {
        shell = create('span', 'lesson-preview-image-resizer');
        image.replaceWith(shell); shell.append(image);
      }
    }
    if (!shell) return;
    shell.classList.add('lesson-preview-image-resizer', 'is-selected');
    shell.style.setProperty('--lesson-image-width', `${block.width || 100}%`);
    shell.dataset.lessonResizeBlock = block.id;
    const badge = create('span', 'lesson-preview-image-size', `${Math.round(block.width || 100)}%`);
    const handle = create('button', 'lesson-preview-image-handle');
    handle.type = 'button'; handle.setAttribute('aria-label', 'Zmień szerokość obrazu przeciągając uchwyt'); handle.title = 'Przeciągnij, aby zmienić szerokość';
    shell.append(badge, handle);
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const before = snapshot('lesson');
      const body = shell.closest('.lesson-preview-body') || shell.parentElement;
      const rect = body.getBoundingClientRect();
      const startX = event.clientX;
      const startWidth = Number(block.width) || 100;
      const move = (moveEvent) => {
        const next = Math.max(20, Math.min(100, startWidth + (moveEvent.clientX - startX) / Math.max(rect.width, 1) * 100));
        block.width = Math.round(next * 10) / 10;
        shell.style.setProperty('--lesson-image-width', `${block.width}%`);
        badge.textContent = `${Math.round(block.width)}%`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (before !== snapshot('lesson')) pushHistory('lesson', before);
        scheduleDraftSave('lesson');
        renderLessonInspector();
        syncFullPreview('lesson');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      event.preventDefault();
    });
  }

  function addFullPreviewHead(doc, mode) {
    const existingMathJax = doc.getElementById('studio-preview-mathjax');
    const existingMathJaxStyles = mode === 'lesson'
      ? Array.from(doc.head.querySelectorAll('#MJX-CHTML-styles, style[id^="MJX-"]'))
      : [];
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    const viewport = doc.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    const theme = doc.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#edf2f7';
    const baseStyles = doc.createElement('link');
    baseStyles.rel = 'stylesheet';
    baseStyles.href = '/members/module/theme.css';
    const studioStyles = doc.createElement('link');
    studioStyles.rel = 'stylesheet';
    studioStyles.href = '/members/module/studio/style.css';
    doc.head.replaceChildren(
      charset,
      viewport,
      theme,
      baseStyles,
      studioStyles,
      ...existingMathJaxStyles,
      ...(mode === 'lesson' && existingMathJax ? [existingMathJax] : [])
    );
    const googleStyles = doc.createElement('link');
    googleStyles.rel = 'stylesheet'; googleStyles.href = '/assets/css/google-media.css'; doc.head.append(googleStyles);
    if (
      mode === 'lesson'
      && !existingMathJax
      && typeof doc.defaultView.MathJax?.typesetPromise !== 'function'
    ) {
      doc.defaultView.MathJax = {
        loader: { load: ['[tex]/mhchem'] },
        tex: { packages: { '[+]': ['mhchem'] } },
        startup: { typeset: false }
      };
      const mathJax = doc.createElement('script');
      mathJax.id = 'studio-preview-mathjax';
      mathJax.src = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-mml-chtml.js';
      mathJax.addEventListener('load', () => typesetMath(doc.body, doc.defaultView), { once: true });
      doc.head.append(mathJax);
    }
    doc.title = `${mode === 'dashboard' ? 'Pełny podgląd dashboardu' : 'Pełny podgląd lekcji'} — ${window.NextMedBrand?.name || 'NextMed'}`;
  }

  function renderFullPreviewWindow(mode, popup) {
    if (!popup || popup.closed) return;
    const doc = popup.document;
    const previousMedia = fullPreviewMedia.get(doc);
    if (!previousMedia) popup.addEventListener('pagehide', () => {
      fullPreviewMedia.get(doc)?.forEach((url) => URL.revokeObjectURL(url));
      fullPreviewMedia.delete(doc);
    }, { once: true });
    previousMedia?.forEach((url) => URL.revokeObjectURL(url));
    const previewUrls = [];
    fullPreviewMedia.set(doc, previewUrls);
    const previousScroll = popup.scrollY;
    clearTypesetMath(doc.body, popup);
    addFullPreviewHead(doc, mode);
    doc.documentElement.lang = 'pl';
    const activeTheme = document.documentElement.getAttribute('data-theme');
    if (activeTheme) doc.documentElement.setAttribute('data-theme', activeTheme);
    else doc.documentElement.removeAttribute('data-theme');
    doc.body.className = 'studio-preview-window';

    const header = doc.createElement('header');
    header.className = 'full-preview-header';
    const copy = doc.createElement('div');
    const eyebrow = doc.createElement('small');
    eyebrow.textContent = mode === 'dashboard' ? 'Dashboard kursanta' : 'Lekcja kursanta';
    const title = doc.createElement('strong');
    title.textContent = mode === 'dashboard'
      ? (state.dashboard.model.title || 'Podgląd dashboardu')
      : (state.lesson.model.title || state.lesson.model.filename || 'Podgląd lekcji');
    copy.append(eyebrow, title);
    const actions = doc.createElement('div');
    actions.className = 'full-preview-actions';
    const refresh = doc.createElement('button');
    refresh.type = 'button';
    refresh.className = 'button button-soft';
    refresh.textContent = 'Odśwież';
    refresh.addEventListener('click', () => renderFullPreviewWindow(mode, popup));
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'button button-primary';
    close.textContent = 'Zamknij';
    close.addEventListener('click', () => popup.close());
    actions.append(refresh, close);
    header.append(copy, actions);

    const main = doc.createElement('main');
    main.className = `full-preview-main full-preview-${mode}`;
    if (mode === 'dashboard') {
      main.append(doc.importNode(buildDashboardPreviewShell(), true));
    } else {
      const validation = lessonModelApi.validateLesson(state.lesson.model);
      if (!validation.valid) {
        const warning = doc.createElement('div');
        warning.className = 'full-preview-warning';
        warning.textContent = `Podgląd roboczy — ${validation.errors[0].message}`;
        main.append(warning);
      }
      const slides = doc.createElement('div');
      slides.className = 'full-lesson-list';
      state.lesson.model.slides.forEach((slide, index) => {
        const article = doc.createElement('article');
        article.className = 'full-lesson-slide';
        article.id = `slide-${index + 1}`;
        article.append(doc.importNode(buildLessonPreviewShell(slide, index, false, true), true));
        slides.append(article);
      });
      main.append(slides);
    }
    doc.body.replaceChildren(header, main);
    window.NextMedGoogleMedia?.bind(doc);
    if (mode === 'lesson') {
      void hydrateStudioLessonMedia(main, previewUrls);
      preparePreviewYouTube(main);
      bindPreviewFlashcards(main);
      bindPreviewAtonom(main);
      bindPreviewOpenAnswers(main);
      bindPreviewAiHelp(main);
      bindPreviewTasks(main);
      typesetMath(main, popup);
    }
    popup.requestAnimationFrame(() => popup.scrollTo(0, previousScroll));
  }

  function syncFullPreview(mode) {
    const popup = state.previewWindows[mode];
    if (!popup || popup.closed) {
      state.previewWindows[mode] = null;
      return;
    }
    renderFullPreviewWindow(mode, popup);
  }

  function openFullPreview(mode) {
    if (!['dashboard', 'lesson'].includes(mode)) return;
    flushDrafts();
    const previewUrl = new URL('/members/module/studio/', window.location.origin);
    previewUrl.searchParams.set('preview', mode);
    previewUrl.searchParams.set('draft', String(Date.now()));
    if (mode === 'lesson') {
      previewUrl.searchParams.set('previewRepo', state.lesson.remoteRepositoryId || state.contentLibrary.selectedRepositoryId || '');
      previewUrl.searchParams.set('previewOwner', state.lesson.remoteFilename || state.lesson.model.filename);
    }
    const popup = window.open(
      previewUrl.toString(),
      `chemdisk-${mode}-preview`,
      'width=1440,height=900,resizable=yes,scrollbars=yes'
    );
    if (!popup) {
      toast(
        'Przeglądarka zablokowała nowe okno',
        'Zezwól tej stronie na wyskakujące okna i spróbuj ponownie.',
        'error'
      );
      return;
    }
    state.previewWindows[mode] = popup;
    popup.focus();
  }

  function requestedFullPreviewMode() {
    try {
      const mode = new URL(window.location.href).searchParams.get('preview');
      return ['dashboard', 'lesson'].includes(mode) ? mode : '';
    } catch (_) {
      return '';
    }
  }

  function startStandalonePreview(mode) {
    const parameters = new URLSearchParams(window.location.search);
    const repository = parameters.get('previewRepo') || '';
    const owner = parameters.get('previewOwner') || '';
    if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(repository)) state.lesson.remoteRepositoryId = repository;
    if (/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.md$/i.test(owner)) state.lesson.remoteFilename = owner;
    renderFullPreviewWindow(mode, window);
    window.addEventListener('pagehide', () => {
      fullPreviewMedia.get(document)?.forEach((url) => URL.revokeObjectURL(url));
      fullPreviewMedia.delete(document);
    }, { once: true });
    window.addEventListener('storage', (event) => {
      const expectedKey = mode === 'dashboard' ? DASHBOARD_DRAFT_KEY : LESSON_DRAFT_KEY;
      if (event.key !== expectedKey || !event.newValue) return;
      loadDrafts();
      renderFullPreviewWindow(mode, window);
    });
  }

  function updateLessonNodeSummary() {
    const found = findLessonNode(state.lesson.selectedId);
    if (!found) return;
    if (found.kind === 'slide') {
      const target = all('[data-lesson-slide-id]', elements.lessonCanvas)
        .find((node) => node.dataset.lessonSlideId === found.node.id && node.classList.contains('lesson-slide'));
      if (target) {
        const title = target.querySelector('.slide-header .node-copy strong');
        const subtitle = target.querySelector('.slide-header .node-copy small');
        if (title) title.textContent = slideTitle(found.node, found.index);
        if (subtitle) subtitle.textContent = slideSummary(found.node);
      }
    } else if (found.kind === 'block') {
      const target = all('[data-lesson-block-id]', elements.lessonCanvas)
        .find((node) => node.dataset.lessonBlockId === found.node.id);
      if (target) {
        const title = target.querySelector('.node-copy strong');
        const subtitle = target.querySelector('.node-copy small');
        if (title) title.textContent = lessonBlockTitle(found.node);
        if (subtitle) subtitle.textContent = lessonBlockSubtitle(found.node);
      }
    } else if (found.kind === 'task') {
      const target = all('[data-lesson-task-id]', elements.lessonCanvas)
        .find((node) => node.dataset.lessonTaskId === found.node.id);
      if (target) {
        const title = target.querySelector('.node-copy strong');
        if (title) title.textContent = found.node.question || 'Pytanie bez treści';
      }
    }
    renderLessonPreview();
  }

  function renderLesson() {
    if (!state.lesson.model) return;
    elements.lessonFilename.value = state.lesson.model.filename;
    elements.lessonTitle.value = state.lesson.model.title;
    elements.lessonAllowSkip.checked = state.lesson.model.navigation === 'free';
    renderLessonCanvas();
    renderLessonInspector();
    renderLessonPreview();
    updateRepositoryButtons();
  }

  function lessonRemoveNode(found) {
    if (found.kind === 'task') {
      found.slide.task = null;
      return;
    }
    if (found.kind === 'slide') {
      found.array.splice(found.index, 1);
      if (!state.lesson.model.slides.length) {
        state.lesson.model.slides.push(lessonModelApi.createSlide({
          blocks: [lessonModelApi.createBlock('heading', { level: 2, text: 'Nowy slajd' })]
        }));
      }
      return;
    }
    found.array.splice(found.index, 1);
  }

  function lessonNodeAction(action, id) {
    const found = findLessonNode(id);
    if (!found) return;
    if (action === 'create-review' && found.kind === 'block' && found.node.type === 'student-answer') {
      createLinkedAnswerReview(id);
      return;
    }
    if (action === 'regenerate-question-id' && found.kind === 'block' && found.node.type === 'student-answer') {
      regenerateLessonQuestionId(id);
      return;
    }
    if (action === 'delete') {
      const linkedReviewCount = found.kind === 'block' && found.node.type === 'student-answer'
        ? lessonAnswerReviews(found.node.questionId).length
        : 0;
      const hasChildren = found.kind === 'slide'
        ? found.node.blocks.length || found.node.task
        : found.kind === 'block' && Boolean(lessonNestedBlocks(found.node)?.length);
      if (
        linkedReviewCount
        && !window.confirm(`To pytanie ma ${linkedReviewCount} powiązane omówienie. Usunięcie pytania pozostawi je bez źródła. Kontynuować?`)
      ) return;
      if (!linkedReviewCount && hasChildren && !window.confirm('Usunąć ten element razem z jego zawartością?')) return;
      commitMutation('lesson', () => {
        lessonRemoveNode(found);
        state.lesson.selectedId = '';
        const slide = found.kind === 'slide'
          ? state.lesson.model.slides[Math.min(found.index, state.lesson.model.slides.length - 1)]
            || state.lesson.model.slides[0]
          : found.slide;
        state.lesson.previewSlideId = slide ? slide.id : '';
      });
      return;
    }
    if (action === 'duplicate') {
      commitMutation('lesson', () => {
        const clone = cloneLessonNode(found.node);
        if (found.kind === 'slide') {
          const slide = lessonModelApi.createSlide(clone);
          state.lesson.model.slides.splice(found.index + 1, 0, slide);
          state.lesson.selectedId = slide.id;
          state.lesson.previewSlideId = slide.id;
        } else if (found.kind === 'task') {
          const slide = lessonModelApi.createSlide({
            blocks: [lessonModelApi.createBlock('heading', { level: 2, text: 'Nowe pytanie' })],
            task: clone
          });
          const slideIndex = state.lesson.model.slides.indexOf(found.slide);
          state.lesson.model.slides.splice(slideIndex + 1, 0, slide);
          state.lesson.selectedId = slide.task.id;
          state.lesson.previewSlideId = slide.id;
        } else {
          const block = lessonModelApi.createBlock(clone);
          found.array.splice(found.index + 1, 0, block);
          state.lesson.selectedId = block.id;
          state.lesson.previewSlideId = found.slide.id;
        }
      });
      return;
    }
    if (action === 'up' || action === 'down') {
      if (!found.array) return;
      const next = found.index + (action === 'up' ? -1 : 1);
      if (next < 0 || next >= found.array.length) return;
      commitMutation('lesson', () => {
        const [node] = found.array.splice(found.index, 1);
        found.array.splice(next, 0, node);
        state.lesson.selectedId = id;
      });
    }
  }

  function moveLessonBlock(blockId, slideId, parentBlockId, index) {
    const found = findLessonNode(blockId);
    if (!found || found.kind !== 'block' || !found.array) return false;
    const movingContainer = ['style', 'accordion', 'answer-review'].includes(found.node.type);
    if (parentBlockId && (movingContainer || found.node.type === 'student-answer')) return false;
    if (parentBlockId === blockId) return false;
    const originalArray = found.array;
    const originalIndex = found.index;
    const [block] = originalArray.splice(originalIndex, 1);
    const targetSlide = state.lesson.model.slides.find((slide) => slide.id === slideId);
    let target = targetSlide ? targetSlide.blocks : null;
    if (parentBlockId) {
      const parent = findLessonNode(parentBlockId);
      target = parent && parent.kind === 'block'
        ? lessonNestedBlocks(parent.node)
        : null;
    }
    if (!target) {
      originalArray.splice(originalIndex, 0, block);
      return false;
    }
    let position = Number.isInteger(index) ? Math.max(0, Math.min(index, target.length)) : target.length;
    if (target === originalArray && position > originalIndex) position -= 1;
    target.splice(position, 0, block);
    return true;
  }

  function handleLessonDrop(event) {
    const zone = event.target.closest('[data-lesson-drop-kind]');
    if (!zone || !elements.lessonCanvas.contains(zone)) return;
    event.preventDefault();
    const payload = dashboardDragPayload(event);
    clearDragClasses();
    if (!payload) return;
    const kind = zone.dataset.lessonDropKind;
    const index = Number(zone.dataset.lessonDropIndex);
    if (payload.source === 'lesson-palette') {
      addLessonNode(payload.type, kind === 'slide'
        ? { index }
        : {
            slideId: zone.dataset.lessonSlideId,
            parentBlockId: zone.dataset.lessonParentBlockId || '',
            index
          });
      return;
    }
    if (payload.source === 'lesson-slide' && kind === 'slide') {
      const found = findLessonNode(payload.id);
      if (!found || found.kind !== 'slide') return;
      commitMutation('lesson', () => {
        const [slide] = state.lesson.model.slides.splice(found.index, 1);
        const target = index > found.index ? index - 1 : index;
        state.lesson.model.slides.splice(Math.max(0, Math.min(target, state.lesson.model.slides.length)), 0, slide);
        state.lesson.selectedId = slide.id;
        state.lesson.previewSlideId = slide.id;
      });
      return;
    }
    if (payload.source === 'lesson-block' && kind === 'block') {
      commitMutation('lesson', () => {
        const moved = moveLessonBlock(
          payload.id,
          zone.dataset.lessonSlideId,
          zone.dataset.lessonParentBlockId || '',
          index
        );
        if (!moved) {
          toast(
            'Nie można przenieść klocka',
            'Kontenerów oraz klocków pytania i omówienia nie można zagnieżdżać. Klucz przyjmuje zwykłe klocki treści.',
            'error'
          );
          return;
        }
        state.lesson.selectedId = payload.id;
        state.lesson.previewSlideId = zone.dataset.lessonSlideId;
      });
    }
  }

  function normalizeDashboardIntro(value) {
    return String(value || '').replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function handleDashboardDocumentInput(event) {
    beginEdit('dashboard');
    if (event.target === elements.dashboardTitle) {
      state.dashboard.model.title = event.target.value;
    } else if (event.target === elements.dashboardIntro) {
      const textBlocks = state.dashboard.model.blocks.filter((block) => block.kind === 'text');
      const intro = normalizeDashboardIntro(event.target.value);
      if (textBlocks.length) {
        textBlocks[0].text = intro;
        state.dashboard.model.blocks = state.dashboard.model.blocks.filter(
          (block) => block.kind !== 'text' || block === textBlocks[0]
        );
      } else if (intro) {
        state.dashboard.model.blocks.unshift(dashboardModelApi.createText(intro));
      }
    }
    renderDashboardPreview();
    updateDashboardDirtyState();
    scheduleDraftSave('dashboard');
  }

  function handleDashboardInspectorInput(event) {
    const target = event.target.closest('[data-dashboard-field]');
    if (!target || target.readOnly) return;
    const found = state.dashboard.selectedUid
      ? dashboardModelApi.findNode(state.dashboard.model, state.dashboard.selectedUid)
      : { node: state.dashboard.model, parent: null, container: null, index: -1 };
    if (!found) return;
    beginEdit('dashboard');
    const fieldName = target.dataset.dashboardField;
    let value = target.type === 'checkbox' ? target.checked : target.value;
    if (fieldName.startsWith('progress')) {
      if (fieldName === 'progressRecordOpens') {
        found.node.recordOpens = Boolean(value);
        found.node.progressConfigured = true;
      } else {
      found.node.progress = found.node.progress || {};
      const mapping = {
        progressTracking: 'tracking',
        progressShowProgress: 'showProgress',
        progressWeight: 'weight'
      };
      const key = mapping[fieldName];
      if (key === 'weight') value = Math.max(.01, Math.min(10000, Number(value) || 1));
      if (found.node.kind === 'dashboard' && ['tracking', 'showProgress'].includes(key)) {
        value = value === 'OFF' ? 'OFF' : 'ON';
      }
      found.node.progress[key] = value;
      found.node.progressConfigured = true;
      }
    } else {
    if (fieldName === 'videoCompletionThreshold') value = Math.max(1, Math.min(100, Number(value) || 90));
    if (['presentationMode', 'videoCompletionThreshold'].includes(fieldName)) found.node.progressConfigured = true;
    if (fieldName === 'point') value = String(Math.max(0, Number(value) || 0));
    found.node[fieldName] = value;
    }
    if (fieldName === 'repositoryId') {
      const fallback = state.contentLibrary.repositories.find((repository) => repository.default)
        || state.contentLibrary.repositories[0];
      const repositoryId = value || (fallback && fallback.id) || '';
      if (repositoryId) void selectContentRepository(repositoryId);
    }
    updateDashboardNodeSummary();
    renderDashboardPreview();
    updateDashboardDirtyState();
    scheduleDraftSave('dashboard');
  }

  function normalizeTaskForType(task, nextType) {
    task.type = nextType;
    if (nextType === 'gaps') {
      task.text = task.text || 'Uzupełnij {{pierwszą lukę}} i {{drugą lukę}}.';
      task.options = task.options.length >= 2
        ? task.options
        : ['pierwsza odpowiedź', 'druga odpowiedź', 'inna odpowiedź'];
      const gapCount = (task.text.match(/\{\{[^{}]*\}\}/g) || []).length;
      task.answers = task.answers.length === gapCount
        ? task.answers.map((answer) => task.options.includes(answer) ? answer : task.options[0])
        : Array.from({ length: gapCount }, (_, index) => task.options[index] || task.options[0]);
      task.label = 'Uzupełnij wszystkie luki';
    } else if (nextType === 'gaps-text') {
      task.text = task.text || 'Uzupełnij {{pierwszą lukę}} i {{drugą lukę}}.';
      const gapCount = (task.text.match(/\{\{[^{}]*\}\}/g) || []).length;
      task.answers = task.answers.length === gapCount
        ? task.answers
        : Array.from({ length: gapCount }, (_, index) => task.answers[index] || `odpowiedź ${index + 1}`);
      task.options = [];
      task.checkMode = task.checkMode === 'all' ? 'all' : 'each';
      task.label = 'Wpisz odpowiedzi w luki';
    } else if (nextType === 'abcd') {
      const defaults = ['Odpowiedź A', 'Odpowiedź B', 'Odpowiedź C', 'Odpowiedź D'];
      task.options = defaults.map((fallback, index) => task.options[index] || fallback).slice(0, 4);
      task.answers = [/^[A-D]$/i.test(task.answers[0] || '') ? task.answers[0].toUpperCase() : 'A'];
      task.label = task.label || 'Wybierz odpowiedź';
    } else if (nextType === 'choice') {
      if (task.options.length < 2) task.options = ['Pierwsza odpowiedź', 'Druga odpowiedź'];
      const current = task.answers[0];
      task.answers = [task.options.includes(current) ? current : task.options[0]];
      task.label = task.label || 'Wybierz odpowiedź';
    } else {
      if (!task.answers.length || (task.options.length && task.options.includes(task.answers[0]))) {
        task.answers = [nextType === 'number' ? '0' : 'odpowiedź'];
      }
      task.options = [];
      task.label = task.label || (nextType === 'number' ? 'Wynik' : 'Twoja odpowiedź');
    }
  }

  function setSlideTitle(slide, value) {
    const heading = slide.blocks.find((block) => block.type === 'heading');
    if (heading) heading.text = value;
    else slide.blocks.unshift(lessonModelApi.createBlock('heading', { level: 2, text: value }));
  }

  function applyLessonFormulaPreset(button) {
    const preset = LESSON_FORMULA_PRESETS[button.dataset.formulaPreset];
    const found = findLessonNode(state.lesson.selectedId);
    if (!preset || !found || found.kind !== 'block' || found.node.type !== 'formula') return;
    commitMutation('lesson', () => {
      found.node.mode = preset.mode;
      found.node.title = preset.title;
      if (preset.mode === 'math') {
        found.node.expression = preset.expression;
      } else {
        found.node.left = preset.left;
        found.node.arrow = preset.arrow;
        found.node.above = preset.above;
        found.node.below = preset.below;
        found.node.right = preset.right;
        state.lesson.formulaField = 'left';
      }
    });
  }

  function applyLessonFormulaArrow(button) {
    const found = findLessonNode(state.lesson.selectedId);
    if (!found || found.kind !== 'block' || found.node.type !== 'formula') return;
    const arrow = button.dataset.formulaArrow || '';
    commitMutation('lesson', () => {
      found.node.arrow = lessonModelApi.FORMULA_ARROWS.includes(arrow) ? arrow : '';
      if (found.node.arrow && !found.node.right) found.node.right = 'H2O';
    });
  }

  function insertLessonFormulaSnippet(button) {
    const requestedTarget = button.dataset.formulaTarget || 'expression';
    const targetName = requestedTarget === 'active'
      ? (['left', 'right'].includes(state.lesson.formulaField) ? state.lesson.formulaField : 'left')
      : requestedTarget;
    const input = elements.lessonInspector.querySelector(`[data-lesson-field="${targetName}"]`);
    if (!input || typeof input.setRangeText !== 'function') return;
    const snippet = button.dataset.formulaSnippet || '';
    const start = Number.isSafeInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isSafeInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.setRangeText(snippet, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  function openLessonImageManager() {
    const found = findLessonNode(state.lesson.selectedId);
    if (!found || found.kind !== 'block' || found.node.type !== 'image') return;
    if (!window.ChemMediaManager?.open) {
      toast('Media Manager jest niedostępny', 'Odśwież Studio i spróbuj ponownie.', 'error');
      return;
    }
    const filename = state.lesson.model.filename;
    const canUseLocal = Boolean(
      state.lesson.remoteSha
      && state.lesson.remoteFilename === filename
      && state.lesson.remoteRepositoryId
    );
    void window.ChemMediaManager.open({
      scope: canUseLocal ? 'local' : 'shared',
      materialKind: canUseLocal ? 'lesson' : '',
      materialId: canUseLocal ? filename : '',
      repositoryId: state.lesson.remoteRepositoryId || state.contentLibrary.selectedRepositoryId,
      onSelect(asset) {
        commitMutation('lesson', () => {
          found.node.ref = asset.reference;
          found.node.repositoryId = asset.repositoryId || state.contentLibrary.selectedRepositoryId;
          found.node.owner = asset.scope === 'local' || String(asset.reference || '').startsWith('photos/')
            ? (asset.materialId || filename)
            : '';
          found.node.url = '';
          if (!found.node.alt || found.node.alt === 'Ilustracja') {
            found.node.alt = String(asset.filename || 'Ilustracja').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 220);
          }
        });
      }
    });
  }

  function clearLessonImageReference() {
    const found = findLessonNode(state.lesson.selectedId);
    if (!found || found.kind !== 'block' || found.node.type !== 'image') return;
    commitMutation('lesson', () => {
      found.node.ref = '';
      found.node.repositoryId = '';
      found.node.owner = '';
    });
  }

  function handleLessonInspectorInput(event) {
    const target = event.target.closest('[data-lesson-field]');
    if (!target || target.readOnly || target.disabled) return;
    const found = findLessonNode(state.lesson.selectedId);
    if (!found) return;
    beginEdit('lesson');
    const fieldName = target.dataset.lessonField;
    const checked = target.type === 'checkbox' ? target.checked : null;
    const raw = target.type === 'checkbox' ? checked : target.value;

    if (found.kind === 'slide' && fieldName === 'lessonNavigation') {
      state.lesson.model.navigation = raw === 'free' ? 'free' : 'sequential';
      state.lesson.model.navigationConfigured = true;
      elements.lessonAllowSkip.checked = state.lesson.model.navigation === 'free';
    } else if (found.kind === 'slide' && fieldName === 'slideTitle') {
      setSlideTitle(found.node, raw);
    } else if (found.kind === 'slide' && fieldName === 'slideLayout') {
      found.node.layout = raw === 'canvas' ? 'canvas' : 'flow';
      if (found.node.layout === 'canvas') ensureLessonCanvasLayout(found.node);
    } else if (found.kind === 'slide' && fieldName === 'slideBackground') {
      found.node.background = lessonModelApi.SLIDE_BACKGROUNDS.includes(raw) ? raw : 'default';
    } else if (found.kind === 'slide' && fieldName === 'slideBackgroundColor') {
      found.node.backgroundColor = /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : '#f8fafc';
    } else if (found.kind === 'slide' && fieldName === 'slideDecoration') {
      found.node.decoration = lessonModelApi.SLIDE_DECORATIONS.includes(raw) ? raw : 'none';
    } else if (found.kind === 'slide' && fieldName === 'slideTextTone') {
      found.node.textTone = lessonModelApi.SLIDE_TEXT_TONES.includes(raw) ? raw : 'auto';
    } else if (found.kind === 'slide' && fieldName === 'transition') {
      found.node.transition = lessonModelApi.SLIDE_TRANSITIONS.includes(raw) ? raw : 'fade';
    } else if (found.kind === 'slide' && fieldName === 'stepId') {
      if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(raw)) {
        found.node.id = raw;
        state.lesson.selectedId = raw;
      }
      found.node.progressConfigured = true;
    } else if (found.kind === 'slide' && fieldName === 'includeInLesson') {
      found.node.includeInLesson = ['ON', 'OFF', 'INHERIT'].includes(raw) ? raw : 'INHERIT';
      found.node.progressConfigured = true;
    } else if (found.kind === 'slide' && fieldName === 'requiredToAdvance') {
      found.node.requiredToAdvance = Boolean(raw);
      found.node.progressConfigured = true;
    } else if (found.kind === 'slide' && fieldName === 'conditionType') {
      found.node.condition = { ...(found.node.condition || {}), type: raw };
      found.node.progressConfigured = true;
    } else if (found.kind === 'slide' && fieldName === 'minimumScore') {
      found.node.condition = {
        ...(found.node.condition || {}),
        minimumScore: Math.max(0, Math.min(100, Number(raw) || 0))
      };
      found.node.progressConfigured = true;
    } else if (found.kind === 'task') {
      const task = found.node;
      if (fieldName === 'type') {
        normalizeTaskForType(task, raw);
      } else if (fieldName === 'optionItem') {
        const index = Number(target.dataset.optionIndex);
        if (!Number.isSafeInteger(index) || index < 0 || index >= task.options.length) return;
        const previous = task.options[index];
        task.options[index] = raw;
        if (task.type === 'choice' && task.answers[0] === previous) {
          task.answers[0] = raw;
        } else if (task.type === 'gaps') {
          task.answers = task.answers.map((answer) => answer === previous ? raw : answer);
        }
      } else if (fieldName === 'options') {
        const previousOptions = [...task.options];
        const previousAnswer = task.answers[0] || '';
        task.options = String(raw).split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 8);
        if (task.type === 'choice') {
          const oldIndex = previousOptions.indexOf(previousAnswer);
          task.answers = [task.options[Math.max(0, oldIndex)] || task.options[0] || ''];
        }
      } else if (fieldName === 'correctOption') {
        const index = Math.max(0, Math.min(task.options.length - 1, Number(raw) || 0));
        task.answers = [task.type === 'abcd' ? String.fromCharCode(65 + index) : task.options[index]];
      } else if (fieldName === 'gapLabel') {
        const index = Number(target.dataset.gapIndex);
        if (Number.isSafeInteger(index)) replaceTaskGapLabel(task, index, raw);
      } else if (fieldName === 'gapSegment') {
        const index = Number(target.dataset.gapSegmentIndex);
        const structure = taskGapStructure(task);
        if (Number.isSafeInteger(index) && index >= 0 && index < structure.segments.length) {
          structure.segments[index] = String(raw).replace(/\{\{|\}\}/g, '');
          applyTaskGapStructure(task, structure);
        }
      } else if (fieldName === 'gapAnswer') {
        const index = Number(target.dataset.gapIndex);
        if (Number.isSafeInteger(index) && index >= 0 && index < task.answers.length) {
          task.answers[index] = raw;
        }
      } else if (fieldName === 'answers') {
        task.answers = String(raw).split('\n').map((item) => item.trim()).filter(Boolean);
      } else {
        task[fieldName] = raw;
      }
    } else if (found.kind === 'block') {
      const block = found.node;
      if (['layoutX', 'layoutY', 'layoutWidth', 'layoutHeight'].includes(fieldName)) {
        block.layout = block.layout?.mode === 'canvas'
          ? block.layout
          : defaultLessonCanvasLayout(found.index);
        const key = {
          layoutX: 'x',
          layoutY: 'y',
          layoutWidth: 'width',
          layoutHeight: 'height'
        }[fieldName];
        const limits = key === 'x' || key === 'y' ? [0, 92] : [8, 100];
        block.layout[key] = Math.max(limits[0], Math.min(limits[1], Number(raw) || limits[0]));
      } else if (fieldName === 'mode' && block.type === 'formula') {
        const previousMode = block.mode;
        block.mode = raw === 'math' ? 'math' : 'chemistry';
        if (block.mode === 'math' && !block.expression) block.expression = 'E = mc^{2}';
        if (block.mode === 'chemistry' && !block.left) {
          block.left = '2 H2 + O2';
          block.arrow = '->';
          block.right = '2 H2O';
        }
        if (
          !block.title
          || (previousMode === 'chemistry' && block.title === 'Spalanie wodoru')
          || block.title === (previousMode === 'math' ? 'Wzór matematyczny' : 'Równanie reakcji')
        ) {
          block.title = block.mode === 'math' ? 'Wzór matematyczny' : 'Równanie reakcji';
        }
      } else if (fieldName === 'tableHeaders' && block.type === 'table') {
        block.headers = String(raw)
          .split('|')
          .map((cell) => cell.trim().replace(/:::/g, '').slice(0, 240))
          .slice(0, 8);
        block.rows = block.rows.map((row) => (
          block.headers.map((_, index) => row[index] || '')
        ));
      } else if (fieldName === 'tableRows' && block.type === 'table') {
        block.rows = String(raw)
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => line
            .split('|')
            .map((cell) => cell.trim().replace(/:::/g, '').slice(0, 240))
            .slice(0, 8))
          .slice(0, 30);
      } else if (fieldName === 'items') {
        block.items = String(raw).split('\n').map((item) => item.trim()).filter(Boolean);
      } else if (fieldName === 'cards' && block.type === 'flashcards') {
        block.cards = String(raw).split('\n')
          .map((line) => line.split(/\s*=>\s*/, 2))
          .filter((parts) => parts.length === 2)
          .map(([front, back]) => ({ front: front.trim(), back: back.trim() }))
          .filter((card) => card.front || card.back)
          .slice(0, 20);
      } else if (fieldName === 'flashcardColor' && block.type === 'flashcards') {
        block.color = raw;
      } else if (fieldName === 'styledText' && block.type === 'style') {
        let primaryText = block.blocks.find((child) => child.type === 'text');
        if (!primaryText) {
          primaryText = lessonModelApi.createBlock('text', { text: '' });
          block.blocks.unshift(primaryText);
        }
        primaryText.text = raw;
      } else if (fieldName === 'level') {
        block.level = Math.max(1, Math.min(3, Number(raw) || 2));
      } else if (block.type === 'student-answer' && fieldName === 'question') {
        block.question = String(raw).slice(0, 8000);
        lessonAnswerReviews(block.questionId).forEach(({ block: review }) => {
          review.question = block.question;
        });
      } else if (block.type === 'student-answer' && fieldName === 'minHeight') {
        block.minHeight = Math.max(80, Math.min(800, Number(raw) || 160));
      } else if (block.type === 'student-answer' && fieldName === 'maxLength') {
        block.maxLength = Math.max(0, Math.min(6000, Number(raw) || 0));
      } else if (block.type === 'answer-review' && fieldName === 'questionId') {
        const linked = lessonStudentAnswerByQuestionId(raw);
        block.questionId = String(raw || '');
        block.question = linked?.block.question || '';
      } else if (block.type === 'answer-review' && fieldName === 'order') {
        block.order = raw === 'key-first' ? 'key-first' : 'student-first';
      } else if (block.type === 'answer-review' && fieldName === 'aiInstruction') {
        block.aiInstruction = String(raw).slice(0, 2000);
      } else if (block.type === 'google' && ['width', 'heightPercent'].includes(fieldName)) {
        block[fieldName] = window.NextMedGoogleMedia.dimensions({ [fieldName]: raw })[fieldName];
      } else if (fieldName === 'width' && block.type === 'image') {
        block.width = Math.max(20, Math.min(100, Number(raw) || 100));
      } else if (fieldName === 'useColor') {
        block.color = checked ? (block.color || '#0e665a') : '';
      } else if (fieldName === 'color') {
        block.color = raw;
        const colorToggle = elements.lessonInspector.querySelector(
          '[data-lesson-field="useColor"]'
        );
        if (colorToggle) colorToggle.checked = true;
      } else if (fieldName === 'useBackground') {
        block.background = checked ? (block.background || '#e8f5ef') : '';
      } else if (fieldName === 'background') {
        block.background = raw;
        const backgroundToggle = elements.lessonInspector.querySelector(
          '[data-lesson-field="useBackground"]'
        );
        if (backgroundToggle) backgroundToggle.checked = true;
      } else {
        block[fieldName] = raw;
      }
      if (fieldName === 'repositoryId') {
        const fallback = state.contentLibrary.repositories.find((repository) => repository.default)
          || state.contentLibrary.repositories[0];
        const repositoryId = raw || (fallback && fallback.id) || '';
        if (repositoryId) void selectContentRepository(repositoryId);
      }
    }
    if (found.kind === 'block' && found.node.type === 'formula') {
      updateFormulaComposerPreview(found.node);
    }
    updateLessonNodeSummary();
    scheduleDraftSave('lesson');
  }

  function handleLessonDocumentInput(event) {
    beginEdit('lesson');
    if (event.target === elements.lessonTitle) {
      state.lesson.model.title = event.target.value;
    } else if (event.target === elements.lessonFilename) {
      state.lesson.model.filename = event.target.value.trim();
    }
    renderLessonPreview();
    updateRepositoryButtons();
    scheduleDraftSave('lesson');
  }

  async function copyText(value) {
    const text = String(value || '');
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    if (!copied) throw new Error('Przeglądarka nie pozwoliła skopiować tekstu.');
  }

  function currentSource(mode) {
    if (mode === 'dashboard') {
      return dashboardModelApi.serialize(state.dashboard.model, { ensureRequiredHelp: true });
    }
    if (mode === 'lesson') return lessonModelApi.serializeLesson(state.lesson.model);
    return promptModelApi.serializePrompt(state.prompt.model);
  }

  function openSourceDialog(mode) {
    let source;
    try {
      source = currentSource(mode);
    } catch (error) {
      toast(
        'Nie można przygotować kodu',
        error && error.message ? error.message : 'Uzupełnij wymagane pola.',
        'error'
      );
      return;
    }
    state.sourceMode = mode;
    elements.sourceDialogEyebrow.textContent = mode === 'dashboard'
      ? 'Kod panelu kursanta'
      : mode === 'lesson'
        ? 'Kod lekcji'
        : 'Prompt JSON/TXT';
    elements.sourceDialogTitle.textContent = mode === 'dashboard'
      ? 'Kod źródłowy dashboardu'
      : mode === 'lesson'
        ? 'Kod źródłowy lekcji'
        : 'Kod źródłowy promptu';
    elements.sourceDialogHelp.textContent = mode === 'dashboard'
      ? 'Możesz skopiować kod albo wkleić dashboard.md i zamienić go na graficzne klocki.'
      : mode === 'lesson'
        ? 'Możesz skopiować kod albo wkleić istniejącą lekcję .md i edytować ją graficznie.'
        : 'Możesz skopiować kod albo wkleić prompt zgodny z rozszerzeniem wybranej nazwy pliku.';
    elements.sourceTextarea.value = source;
    elements.sourceStatus.textContent = '';
    elements.sourceStatus.className = 'dialog-status';
    elements.sourceDialog.showModal();
  }

  function applySourceDialog() {
    const source = elements.sourceTextarea.value;
    try {
      if (state.sourceMode === 'dashboard') {
        const model = dashboardModelApi.parseMarkdown(source);
        commitMutation('dashboard', () => {
          state.dashboard.model = model;
          state.dashboard.selectedUid = '';
        });
      } else if (state.sourceMode === 'lesson') {
        const model = lessonModelFromSource(source, state.lesson.model.filename);
        commitMutation('lesson', () => {
          state.lesson.model = model;
          state.lesson.previewOpenAnswers.clear();
          state.lesson.selectedId = '';
          state.lesson.previewSlideId = model.slides[0] ? model.slides[0].id : '';
        });
      } else {
        const model = promptModelApi.parsePrompt(source, state.prompt.model.filename);
        commitMutation('prompt', () => {
          state.prompt.model = model;
        });
      }
      elements.sourceDialog.close();
      toast(
        state.sourceMode === 'prompt' ? 'Prompt zastosowany' : 'Zmiany zastosowane',
        state.sourceMode === 'prompt'
          ? 'Kod został zamieniony na edytowalny model promptu.'
          : 'Kod został zamieniony na graficzne klocki.'
      );
    } catch (error) {
      elements.sourceStatus.textContent = error && error.message ? error.message : 'Nieprawidłowy format treści.';
      elements.sourceStatus.className = 'dialog-status is-error';
    }
  }

  function downloadLesson() {
    const validation = lessonModelApi.validateLesson(state.lesson.model);
    if (!validation.valid) {
      toast('Lekcja wymaga poprawek', validation.errors[0].message, 'error');
      return;
    }
    let markdown;
    try {
      markdown = lessonModelApi.serializeLesson(validation.lesson);
    } catch (error) {
      toast('Nie można utworzyć pliku', error.message, 'error');
      return;
    }
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = validation.lesson.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast('Plik lekcji pobrany', validation.lesson.filename);
  }

  async function importMarkdownFile(file, mode) {
    if (!file) return;
    const maxBytes = mode === 'prompt' ? promptModelApi.MAX_FILE_BYTES : MAX_IMPORT_BYTES;
    if (file.size > maxBytes) {
      toast(
        'Plik jest zbyt duży',
        mode === 'prompt' ? 'Maksymalny rozmiar promptu to 256 KiB.' : 'Maksymalny rozmiar importu to 512 KiB.',
        'error'
      );
      return;
    }
    let source;
    try {
      source = await file.text();
    } catch (_) {
      toast('Nie udało się odczytać pliku', 'Wybierz tekstowy plik .md.', 'error');
      return;
    }
    try {
      if (mode === 'dashboard') {
        const model = dashboardModelApi.parseMarkdown(source);
        commitMutation('dashboard', () => {
          state.dashboard.model = model;
          state.dashboard.selectedUid = '';
        });
      } else if (mode === 'lesson') {
        const filename = lessonModelApi.validateFilename(file.name)
          ? file.name
          : state.lesson.model.filename;
        const model = lessonModelFromSource(source, filename);
        commitMutation('lesson', () => {
          state.lesson.model = model;
          state.lesson.previewOpenAnswers.clear();
          state.lesson.selectedId = '';
          state.lesson.previewSlideId = model.slides[0] ? model.slides[0].id : '';
        });
        state.lesson.remoteFilename = '';
        state.lesson.remoteSha = '';
        state.lesson.remoteRepositoryId = '';
        setPendingLessonManifest(null);
        updateRepositoryButtons();
      } else {
        const filename = promptModelApi.validateFilename(file.name)
          ? file.name
          : state.prompt.model.filename;
        const model = promptModelApi.parsePrompt(source, filename);
        commitMutation('prompt', () => {
          state.prompt.model = model;
        });
        state.prompt.remoteFilename = '';
        state.prompt.remoteSha = '';
        state.prompt.remoteRepositoryId = '';
        updateRepositoryButtons();
      }
      toast('Plik zaimportowany', `${file.name} jest gotowy do edycji.`);
    } catch (error) {
      toast('Nie udało się zaimportować', error && error.message ? error.message : 'Nieprawidłowy format treści.', 'error');
    }
  }

  function renderPromptPoints() {
    if (window.NextMedUI?.render('studio-prompt', elements.promptPointsList, { points: state.prompt.model.points, maxLength: promptModelApi.MAX_PROMPT_CHARS })) return;
    const fragment = document.createDocumentFragment();
    state.prompt.model.points.forEach((point, index) => {
      const card = create('article', 'prompt-point');
      card.dataset.promptPointId = point.id;
      const header = create('div', 'prompt-point-header');
      const numberLabel = create('label', 'prompt-point-number');
      numberLabel.append(document.createTextNode('Numer punktu'));
      const number = document.createElement('input');
      number.type = 'number';
      number.min = '1';
      number.max = '9999';
      number.value = String(point.number);
      number.dataset.promptPointField = 'number';
      numberLabel.append(number);
      const actions = create('div', 'prompt-point-actions');
      [
        ['up', '↑', 'Przenieś wyżej'],
        ['down', '↓', 'Przenieś niżej'],
        ['duplicate', '⧉', 'Duplikuj punkt'],
        ['delete', '×', 'Usuń punkt']
      ].forEach(([action, symbol, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.promptPointAction = action;
        button.textContent = symbol;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.disabled = (action === 'up' && index === 0)
          || (action === 'down' && index === state.prompt.model.points.length - 1);
        actions.append(button);
      });
      header.append(numberLabel, actions);
      const textarea = document.createElement('textarea');
      textarea.value = point.content;
      textarea.maxLength = promptModelApi.MAX_PROMPT_CHARS;
      textarea.dataset.promptPointField = 'content';
      textarea.placeholder = 'Instrukcja dla tego trybu pracy asystenta…';
      textarea.setAttribute('aria-label', `Treść punktu ${point.number}`);
      card.append(header, textarea);
      fragment.append(card);
    });
    elements.promptPointsList.replaceChildren(fragment);
  }

  function renderPromptPreview() {
    const validation = promptModelApi.validatePrompt(state.prompt.model);
    elements.promptValidationStatus.classList.toggle('is-error', !validation.valid);
    if (validation.valid) {
      const source = promptModelApi.serializePrompt(validation.prompt);
      const remote = state.prompt.remoteSha
        ? ` · repo: ${state.prompt.remoteFilename}`
        : ' · szkic na tym urządzeniu';
      elements.promptValidationStatus.textContent =
        `Plik poprawny · ${source.length.toLocaleString('pl-PL')} znaków${remote}`;
      elements.promptSourcePreview.textContent = source;
    } else {
      elements.promptValidationStatus.textContent = validation.errors[0].message;
      elements.promptSourcePreview.textContent = state.prompt.model.format === 'json'
        ? JSON.stringify({ prompt: state.prompt.model.instruction }, null, 2)
        : state.prompt.model.points
          .map((point) => `::punkt ${point.number}\n${point.content}`)
          .join('\n\n');
    }
  }

  function renderPrompt() {
    if (!state.prompt.model) return;
    elements.promptFilename.value = state.prompt.model.filename;
    elements.promptFormat.value = state.prompt.model.format;
    elements.promptInstruction.value = state.prompt.model.instruction;
    elements.promptJsonEditor.hidden = state.prompt.model.format !== 'json';
    elements.promptPointsEditor.hidden = state.prompt.model.format !== 'txt';
    elements.promptPointCount.textContent = state.prompt.model.format === 'txt'
      ? String(state.prompt.model.points.length)
      : '1';
    if (state.prompt.model.format === 'txt') renderPromptPoints();
    renderPromptPreview();
    updateRepositoryButtons();
  }

  function nextPromptPointNumber() {
    return state.prompt.model.points.reduce(
      (maximum, point) => Math.max(maximum, Number(point.number) || 0),
      0
    ) + 1;
  }

  function addPromptPoint() {
    commitMutation('prompt', () => {
      state.prompt.model.points.push(promptModelApi.createPoint({
        number: nextPromptPointNumber(),
        content: ''
      }, state.prompt.model.points.length));
    });
  }

  function promptPointAction(action, pointId) {
    const index = state.prompt.model.points.findIndex((point) => point.id === pointId);
    if (index < 0) return;
    const point = state.prompt.model.points[index];
    if (action === 'delete') {
      if (point.content.trim() && !window.confirm(`Usunąć punkt ${point.number}?`)) return;
      commitMutation('prompt', () => {
        state.prompt.model.points.splice(index, 1);
        if (!state.prompt.model.points.length) {
          state.prompt.model.points.push(promptModelApi.createPoint({ number: 1, content: '' }));
        }
      });
      return;
    }
    if (action === 'duplicate') {
      commitMutation('prompt', () => {
        state.prompt.model.points.splice(index + 1, 0, promptModelApi.createPoint({
          number: nextPromptPointNumber(),
          content: point.content
        }, index + 1));
      });
      return;
    }
    const next = index + (action === 'up' ? -1 : action === 'down' ? 1 : 0);
    if (next < 0 || next >= state.prompt.model.points.length || next === index) return;
    commitMutation('prompt', () => {
      const [moving] = state.prompt.model.points.splice(index, 1);
      state.prompt.model.points.splice(next, 0, moving);
    });
  }

  function changePromptFormat(nextFormat) {
    const format = nextFormat === 'txt' ? 'txt' : 'json';
    if (state.prompt.model.format === format) return;
    commitMutation('prompt', () => {
      if (format === 'txt' && !state.prompt.model.points.length) {
        state.prompt.model.points = [promptModelApi.createPoint({
          number: 1,
          content: state.prompt.model.instruction
        })];
      }
      if (format === 'json' && !state.prompt.model.instruction.trim()) {
        state.prompt.model.instruction = state.prompt.model.points
          .map((point) => point.content.trim())
          .filter(Boolean)
          .join('\n\n');
      }
      state.prompt.model.format = format;
      state.prompt.model.filename = promptModelApi.filenameForFormat(
        state.prompt.model.filename,
        format
      );
    });
  }

  function handlePromptInput(event) {
    if (event.target === elements.promptFilename) {
      beginEdit('prompt');
      state.prompt.model.filename = event.target.value.trim();
    } else if (event.target === elements.promptInstruction) {
      beginEdit('prompt');
      state.prompt.model.instruction = event.target.value;
    } else {
      const card = event.target.closest('[data-prompt-point-id]');
      const field = event.target.dataset.promptPointField;
      if (!card || !field) return;
      const point = state.prompt.model.points.find((item) => item.id === card.dataset.promptPointId);
      if (!point) return;
      beginEdit('prompt');
      point[field] = field === 'number' ? Number(event.target.value) : event.target.value;
    }
    renderPromptPreview();
    scheduleDraftSave('prompt');
  }

  function downloadPrompt() {
    const validation = promptModelApi.validatePrompt(state.prompt.model);
    if (!validation.valid) {
      toast('Prompt wymaga poprawek', validation.errors[0].message, 'error');
      return;
    }
    const source = promptModelApi.serializePrompt(validation.prompt);
    const type = validation.prompt.format === 'json'
      ? 'application/json;charset=utf-8'
      : 'text/plain;charset=utf-8';
    const href = URL.createObjectURL(new Blob([source], { type }));
    const link = document.createElement('a');
    link.href = href;
    link.download = validation.prompt.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast('Plik promptu pobrany', validation.prompt.filename);
  }

  function updateRepositoryButtons() {
    const selectedRepositoryId = state.contentLibrary.selectedRepositoryId;
    if (elements.lessonRepositorySave) {
      elements.lessonRepositorySave.disabled = state.lesson.saving;
      const updatesCurrentFile = Boolean(
        state.lesson.remoteFilename
        && state.lesson.remoteSha
        && state.lesson.remoteFilename === state.lesson.model.filename
        && state.lesson.remoteRepositoryId === selectedRepositoryId
      );
      const retryManifestOnly = pendingLessonManifestMatches(
        state.lesson.model,
        state.lesson.manifestPending,
        selectedRepositoryId
      );
      elements.lessonRepositorySave.textContent = retryManifestOnly
        ? 'Ponów synchronizację postępów'
        : updatesCurrentFile ? 'Opublikuj zmiany' : 'Opublikuj';
      elements.lessonRepositorySave.title = retryManifestOnly
        ? 'Lekcja jest już zapisana — ponów tylko aktualizację ustawień postępów'
        : updatesCurrentFile ? `Opublikuj zmiany w lekcji ${state.lesson.remoteFilename}` : 'Zapisz lekcję i udostępnij ją w kursie';
      elements.lessonRepositoryDelete.disabled = state.lesson.saving
        || !state.lesson.remoteFilename
        || !state.lesson.remoteSha
        || state.lesson.remoteRepositoryId !== selectedRepositoryId;
      elements.lessonRepositoryDelete.title = state.lesson.remoteFilename
        ? state.lesson.remoteRepositoryId === selectedRepositoryId
          ? `Usuń ${state.lesson.remoteFilename} z wybranego repozytorium`
          : 'Wybierz repozytorium, z którego wczytano lekcję, aby ją usunąć'
        : 'Najpierw wczytaj albo zapisz lekcję w repozytorium';
    }
    if (elements.promptRepositorySave) {
      elements.promptRepositorySave.disabled = state.prompt.saving;
      elements.promptRepositoryDelete.disabled = state.prompt.saving
        || !state.prompt.remoteFilename
        || !state.prompt.remoteSha
        || state.prompt.remoteRepositoryId !== selectedRepositoryId;
      elements.promptRepositoryDelete.title = state.prompt.remoteFilename
        ? state.prompt.remoteRepositoryId === selectedRepositoryId
          ? `Usuń ${state.prompt.remoteFilename} z wybranego repozytorium`
          : 'Wybierz repozytorium, z którego wczytano prompt, aby go usunąć'
        : 'Najpierw wczytaj albo zapisz prompt w repozytorium';
    }
  }

  async function requireStudyPool(quizId, repositoryId) {
    const asset = await window.ChemContentLibrary.readQuiz(quizId, { repositoryId });
    const definition = JSON.parse(asset.content);
    if (definition.mode !== 'deck' || definition.metadata?.status !== 'published' || definition.metadata?.active === false) {
      throw new Error('Wybierz opublikowaną, aktywną pulę nauki. Zwykły quiz dodasz elementem „Quiz”.');
    }
  }

  async function saveLessonToRepository() {
    const validation = lessonModelApi.validateLesson(state.lesson.model);
    if (!validation.valid) {
      toast('Lekcja wymaga poprawek', validation.errors[0].message, 'error');
      return;
    }
    const filename = validation.lesson.filename;
    const repositoryId = state.contentLibrary.selectedRepositoryId;
    if (!repositoryId) {
      toast('Wybierz repozytorium', 'Najpierw wybierz docelowe repozytorium materiałów.', 'error');
      return;
    }
    validation.lesson.navigationConfigured = true;
    validation.lesson.slides.forEach((slide) => { slide.progressConfigured = true; });
    const serializedLesson = lessonModelApi.serializeLesson(validation.lesson);
    const pendingManifest = state.lesson.manifestPending;
    if (pendingManifest
      && pendingManifest.filename === filename
      && pendingManifest.repositoryId === repositoryId
      && pendingManifest.content === serializedLesson) {
      state.lesson.saving = true;
      updateRepositoryButtons();
      try {
        await syncLessonProgressManifest(pendingManifest);
        setPendingLessonManifest(null);
        toast('Postępy zsynchronizowane', 'Ustawienia postępów zaktualizowano bez ponownej publikacji lekcji.');
      } catch (error) {
        toast('Lekcja pozostaje zapisana', `Synchronizacja postępów nadal się nie udała (${error?.message || 'błąd synchronizacji'}).`, 'error');
      } finally {
        state.lesson.saving = false;
        updateRepositoryButtons();
      }
      return;
    }
    const renamed = state.lesson.remoteFilename && state.lesson.remoteFilename !== filename;
    const moved = state.lesson.remoteRepositoryId && state.lesson.remoteRepositoryId !== repositoryId;
    if (
      (renamed || moved) &&
      !window.confirm(
        moved
          ? 'Wybrano inne repozytorium. Utworzyć w nim nowy plik i pozostawić oryginał bez zmian?'
          : `Nazwa zmieniła się z „${state.lesson.remoteFilename}” na „${filename}”. Utworzyć nowy plik i pozostawić stary w repozytorium?`
      )
    ) return;
    state.lesson.saving = true;
    updateRepositoryButtons();
    try {
      let result;
      try {
        const pools = new Map();
        const visit = (blocks) => (blocks || []).forEach((block) => {
          if (block.type === 'study') pools.set(`${block.repositoryId}:${block.quizId}`, block);
          visit(block.blocks); visit(block.answerKeyBlocks);
        });
        validation.lesson.slides.forEach((slide) => visit(slide.blocks));
        for (const block of pools.values()) await requireStudyPool(block.quizId, block.repositoryId || repositoryId);
        result = await window.ChemContentLibrary.save('lesson', {
          filename,
          content: serializedLesson,
          expectedSha: renamed || moved ? '' : state.lesson.remoteSha,
          repositoryId
        });
      } catch (error) {
        toast('Nie udało się zapisać lekcji', error && error.message ? error.message : 'Błąd repozytorium.', 'error');
        return;
      }
      state.lesson.remoteFilename = filename;
      state.lesson.remoteSha = result.sha;
      state.lesson.remoteRepositoryId = result.repositoryId || repositoryId;
      state.lesson.model = lessonModelApi.createLesson(validation.lesson);
      writeStorage(LESSON_DRAFT_KEY, state.lesson.model);
      toast(
        result.created ? 'Lekcja opublikowana' : 'Zmiany w lekcji opublikowane',
        filename
      );
      const manifest = {
        filename,
        repositoryId: state.lesson.remoteRepositoryId,
        sha: state.lesson.remoteSha || '',
        content: serializedLesson,
        navigation: validation.lesson.navigation,
        steps: validation.lesson.slides.map((slide, index) => ({
          id: slide.id,
          title: slideTitle(slide, index),
          includeInLesson: slide.includeInLesson !== 'OFF',
          requiredToAdvance: slide.requiredToAdvance !== false,
          condition: slide.condition
        }))
      };
      setPendingLessonManifest(manifest);
      try {
        await syncLessonProgressManifest(manifest);
        setPendingLessonManifest(null);
      } catch (error) {
        toast('Lekcja jest zapisana', `Nie udało się zaktualizować ustawień postępów (${error?.message || 'błąd synchronizacji'}). Kliknij „Ponów synchronizację postępów” — nie musisz ponownie publikować lekcji.`, 'warning');
      }
      try {
        await loadRepositoryAssets(true);
      } catch (error) {
        toast('Lekcja jest zapisana', `Nie udało się tylko odświeżyć biblioteki (${error?.message || 'błąd odświeżania'}).`, 'warning');
      }
    } finally {
      state.lesson.saving = false;
      updateRepositoryButtons();
    }
  }

  async function syncLessonProgressManifest(manifest) {
    const progressToken = await adminToken();
    const response = await fetch(ADMIN_PROGRESS_URL, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${progressToken}`
      },
      body: JSON.stringify({
        action: 'lesson_manifest',
        filename: manifest.filename,
        repositoryId: manifest.repositoryId,
        manifest: { navigation: manifest.navigation, steps: manifest.steps }
      })
    });
    if (response.ok) return;
    const progressError = await responseJson(response);
    throw new Error(progressError?.error || String(response.status));
  }

  async function savePromptToRepository() {
    const validation = promptModelApi.validatePrompt(state.prompt.model);
    if (!validation.valid) {
      toast('Prompt wymaga poprawek', validation.errors[0].message, 'error');
      return;
    }
    const filename = validation.prompt.filename;
    const repositoryId = state.contentLibrary.selectedRepositoryId;
    if (!repositoryId) {
      toast('Wybierz repozytorium', 'Najpierw wybierz docelowe repozytorium materiałów.', 'error');
      return;
    }
    const renamed = state.prompt.remoteFilename && state.prompt.remoteFilename !== filename;
    const moved = state.prompt.remoteRepositoryId && state.prompt.remoteRepositoryId !== repositoryId;
    if (
      (renamed || moved) &&
      !window.confirm(
        moved
          ? 'Wybrano inne repozytorium. Utworzyć w nim nowy plik i pozostawić oryginał bez zmian?'
          : `Nazwa zmieniła się z „${state.prompt.remoteFilename}” na „${filename}”. Utworzyć nowy plik i pozostawić stary w repozytorium?`
      )
    ) return;
    state.prompt.saving = true;
    updateRepositoryButtons();
    try {
      let result;
      try {
        result = await window.ChemContentLibrary.save('prompt', {
          filename,
          content: promptModelApi.serializePrompt(validation.prompt),
          expectedSha: renamed || moved ? '' : state.prompt.remoteSha,
          repositoryId
        });
      } catch (error) {
        toast('Nie udało się zapisać promptu', error && error.message ? error.message : 'Błąd repozytorium.', 'error');
        return;
      }
      state.prompt.remoteFilename = filename;
      state.prompt.remoteSha = result.sha;
      state.prompt.remoteRepositoryId = result.repositoryId || repositoryId;
      toast(
        result.created ? 'Instrukcja AI zapisana' : 'Instrukcja AI zaktualizowana',
        filename
      );
      renderPromptPreview();
      try {
        await loadRepositoryAssets(true);
      } catch (error) {
        toast('Instrukcja AI jest zapisana', `Nie udało się tylko odświeżyć biblioteki (${error?.message || 'błąd odświeżania'}).`, 'warning');
      }
    } finally {
      state.prompt.saving = false;
      updateRepositoryButtons();
    }
  }

  async function deleteRepositoryAsset(kind) {
    const target = kind === 'lesson' ? state.lesson : state.prompt;
    if (
      !target.remoteFilename ||
      !target.remoteSha ||
      target.remoteRepositoryId !== state.contentLibrary.selectedRepositoryId
    ) {
      toast('Nie wybrano zapisanej wersji', 'Otwórz materiał z biblioteki przed próbą usunięcia.', 'error');
      return;
    }
    if (!window.confirm(
      `Usunąć „${target.remoteFilename}” z biblioteki? Plik można odzyskać z historii repozytorium.`
    )) return;
    target.saving = true;
    updateRepositoryButtons();
    try {
      const deletedFilename = target.remoteFilename;
      const result = await window.ChemContentLibrary.remove(kind, {
        filename: target.remoteFilename,
        expectedSha: target.remoteSha,
        repositoryId: target.remoteRepositoryId
      });
      target.remoteFilename = '';
      target.remoteSha = '';
      target.remoteRepositoryId = '';
      toast(
        kind === 'lesson' ? 'Lekcja usunięta z biblioteki' : 'Instrukcja AI usunięta z biblioteki',
        'Szkic na tym urządzeniu pozostaje w edytorze.'
      );
      await loadRepositoryAssets(true);
      if (kind === 'prompt') renderPromptPreview();
    } catch (error) {
      toast('Nie udało się usunąć pliku', error && error.message ? error.message : 'Błąd repozytorium.', 'error');
    } finally {
      target.saving = false;
      updateRepositoryButtons();
    }
  }

  function activateInspectorPanel(mode, panel) {
    const prefix = mode === 'dashboard' ? 'dashboard' : 'lesson';
    const inspector = mode === 'dashboard' ? elements.dashboardInspector : elements.lessonInspector;
    const preview = mode === 'dashboard' ? elements.dashboardPreview : elements.lessonPreview;
    all(`[data-${prefix}-panel]`).forEach((button) => {
      const active = button.dataset[`${prefix}Panel`] === panel;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    inspector.hidden = panel !== 'inspector';
    preview.hidden = panel !== 'preview';
    if (panel === 'preview') {
      if (mode === 'dashboard') renderDashboardPreview();
      else renderLessonPreview();
    }
  }

  function filterPalette(input, attribute) {
    const query = String(input.value || '').trim().toLocaleLowerCase('pl');
    all(`[${attribute}]`, input.closest('.palette-panel')).forEach((button) => {
      const text = `${button.getAttribute(attribute) || ''} ${button.textContent || ''}`.toLocaleLowerCase('pl');
      button.hidden = Boolean(query) && !text.includes(query);
    });
  }

  function handleDashboardCanvasClick(event) {
    const action = event.target.closest('[data-node-action]');
    const nodeElement = event.target.closest('[data-node-uid]');
    if (!nodeElement || !elements.dashboardCanvas.contains(nodeElement)) return;
    const uid = nodeElement.dataset.nodeUid;
    if (action) {
      dashboardNodeAction(action.dataset.nodeAction, uid);
      return;
    }
    state.dashboard.selectedUid = uid;
    renderDashboardCanvas();
    renderDashboardInspector();
    renderDashboardPreview();
  }

  function handleLessonCanvasClick(event) {
    const quickTask = event.target.closest('[data-lesson-quick-task]');
    if (quickTask) {
      addLessonNode(quickTask.dataset.lessonQuickTask, {
        slideId: quickTask.dataset.lessonSlideId,
        parentBlockId: ''
      });
      return;
    }
    const action = event.target.closest('[data-lesson-action]');
    const task = event.target.closest('[data-lesson-task-id]');
    const block = event.target.closest('[data-lesson-block-id]');
    const slide = event.target.closest('.lesson-slide[data-lesson-slide-id]');
    const id = task
      ? task.dataset.lessonTaskId
      : block ? block.dataset.lessonBlockId : slide ? slide.dataset.lessonSlideId : '';
    if (!id) return;
    if (action) {
      lessonNodeAction(action.dataset.lessonAction, id);
      return;
    }
    state.lesson.selectedId = id;
    const found = findLessonNode(id);
    if (found) state.lesson.previewSlideId = found.slide.id;
    renderLessonCanvas();
    renderLessonInspector();
    renderLessonPreview();
  }

  function handleDashboardDragStart(event) {
    const item = event.target.closest('[data-node-uid]');
    if (!item || !elements.dashboardCanvas.contains(item)) return;
    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    setStudioDragPayload(event.dataTransfer, {
      source: 'dashboard-node',
      uid: item.dataset.nodeUid
    });
  }

  function handleLessonDragStart(event) {
    const block = event.target.closest('[data-lesson-block-id]');
    const slide = event.target.closest('.lesson-slide[data-lesson-slide-id]');
    if (block) {
      block.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      setStudioDragPayload(event.dataTransfer, {
        source: 'lesson-block',
        id: block.dataset.lessonBlockId
      });
      event.stopPropagation();
      return;
    }
    if (slide) {
      slide.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      setStudioDragPayload(event.dataTransfer, {
        source: 'lesson-slide',
        id: slide.dataset.lessonSlideId
      });
    }
  }

  function repositoryAssetButton(asset, actionLabel, onClick) {
    const button = create('button', 'repository-asset');
    button.type = 'button';
    button.dataset.assetFilename = asset.filename;
    const kind = create(
      'span',
      'repository-asset-kind',
      asset.kind === 'lesson' ? 'MD' : asset.kind === 'exam' ? 'EXAM' : asset.kind === 'presentation' ? 'SLIDE' : asset.kind === 'quiz' ? 'QUIZ' : /\.txt$/i.test(asset.filename) ? 'TXT' : 'JSON'
    );
    const copy = create('span');
    copy.append(
      create('strong', '', asset.title || asset.filename),
      create('small', '', asset.description || asset.filename)
    );
    const action = create('span', 'repository-asset-action', actionLabel);
    button.append(kind, copy, action);
    button.addEventListener('click', () => onClick(asset));
    return button;
  }

  function renderPagedRepositoryAssets(container, assets, key, label, actionLabel, onClick) {
    const paged = pagedListApi.page(state.contentLibrary.paging, key, assets);
    if (window.NextMedUI?.render('studio-assets', container, {
      paged, label, actionLabel, onSelect: onClick,
      onMore(page) { pagedListApi.more(state.contentLibrary.paging, page.key, page.total); renderRepositoryAssets(); }
    })) return paged;
    container.replaceChildren(
      ...paged.items.map((asset) => repositoryAssetButton(asset, actionLabel, onClick))
    );
    if (paged.total) {
      container.append(pagedListApi.controls(document, state.contentLibrary.paging, paged, {
        label,
        onMore: renderRepositoryAssets
      }));
    }
    return paged;
  }

  function renderRepositoryAssets() {
    const library = window.ChemContentLibrary;
    if (!library) return;
    const dashboardAssets = library.search(
      [...state.contentLibrary.lessons, ...state.contentLibrary.prompts, ...state.contentLibrary.exams, ...state.contentLibrary.presentations, ...state.contentLibrary.quizzes],
      elements.dashboardAssetSearch.value
    );
    renderPagedRepositoryAssets(
      elements.dashboardAssetList,
      dashboardAssets,
      'dashboard-assets',
      'materiałów',
      'Dodaj',
      insertDashboardAsset
    );
    const lessonAssets = library.search(
      state.contentLibrary.lessons,
      elements.lessonAssetSearch.value
    );
    renderPagedRepositoryAssets(
      elements.lessonAssetList,
      lessonAssets,
      'lesson-assets',
      'lekcji',
      'Wczytaj',
      importRepositoryLesson
    );
    const promptAssets = library.search(
      state.contentLibrary.prompts,
      elements.promptAssetSearch.value
    );
    renderPagedRepositoryAssets(
      elements.promptAssetList,
      promptAssets,
      'prompt-assets',
      'promptów',
      'Wczytaj',
      importRepositoryPrompt
    );
    if (state.contentLibrary.loaded) {
      elements.dashboardAssetStatus.textContent = dashboardAssets.length
        ? `${dashboardAssets.length} pasujących plików.`
        : 'Brak plików pasujących do wyszukiwania.';
      elements.lessonAssetStatus.textContent = lessonAssets.length
        ? `${lessonAssets.length} pasujących lekcji.`
        : 'Brak lekcji pasujących do wyszukiwania.';
      elements.promptAssetStatus.textContent = promptAssets.length
        ? `${promptAssets.length} pasujących promptów.`
        : 'Brak promptów pasujących do wyszukiwania.';
    }
    renderContentExplorer();
  }

  function renderContentExplorer() {
    if (!elements.contentExplorerFolders) return;
    if (elements.contentExplorerRefresh) {
      elements.contentExplorerRefresh.disabled = state.contentLibrary.loading;
      elements.contentExplorerRefresh.textContent = state.contentLibrary.loading
        ? '↻ Odświeżam…'
        : '↻ Odśwież pliki';
    }
    elements.contentExplorer?.setAttribute('aria-busy', String(state.contentLibrary.loading));
    const library = window.ChemContentLibrary;
    const query = elements.contentExplorerSearch?.value || '';
    const groups = [
      { kind: 'lesson', title: 'Lekcje', icon: 'L', assets: state.contentLibrary.lessons },
      { kind: 'exam', title: 'Egzaminy', icon: 'E', assets: state.contentLibrary.exams },
      { kind: 'presentation', title: 'Prezentacje', icon: 'S', assets: state.contentLibrary.presentations },
      { kind: 'quiz', title: 'Quizy', icon: 'Q', assets: state.contentLibrary.quizzes },
      { kind: 'prompt', title: 'Prompty', icon: 'P', assets: state.contentLibrary.prompts }
    ];
    const reactLibrary = window.NextMedUI?.render('studio-library', elements.contentExplorerFolders, {
      groups: groups.map((group) => ({ ...group, paged: pagedListApi.page(state.contentLibrary.paging, `explorer-${group.kind}`, library?.search ? library.search(group.assets, query) : group.assets) })),
      loading: state.contentLibrary.loading, error: state.contentLibrary.error, query,
      adapters: { repositoryId: state.contentLibrary.selectedRepositoryId, open: state.contentLibrary.explorerOpen,
        mediaKey: explorerMediaKey, size: formatExplorerSize, renderMedia: renderExplorerMediaFolder, renderShared: renderSharedMediaRoot,
        toggle(key, open) { if (open) state.contentLibrary.explorerOpen.add(key); else state.contentLibrary.explorerOpen.delete(key); },
        loadMedia: loadExplorerMedia,
        more(page) { pagedListApi.more(state.contentLibrary.paging, page.key, page.total); renderContentExplorer(); }
      }
    });
    const roots = reactLibrary ? [] : groups.map((group) => {
      const matches = library?.search ? library.search(group.assets, query) : group.assets;
      const paged = pagedListApi.page(state.contentLibrary.paging, `explorer-${group.kind}`, matches);
      const folder = document.createElement('details');
      folder.className = 'content-explorer-folder';
      folder.dataset.explorerRoot = group.kind;
      folder.open = state.contentLibrary.explorerOpen.has(group.kind);
      folder.addEventListener('toggle', () => {
        if (folder.open) state.contentLibrary.explorerOpen.add(group.kind);
        else state.contentLibrary.explorerOpen.delete(group.kind);
      });
      const summary = document.createElement('summary');
      summary.append(
        create('span', 'content-explorer-folder-icon', group.icon),
        create('span', 'content-explorer-folder-copy'),
        create('small', '', `${matches.length}/${group.assets.length}`),
        create('span', 'content-explorer-chevron', '⌄')
      );
      summary.querySelector('.content-explorer-folder-copy').append(
        create('strong', '', group.title),
        create('small', '', group.kind === 'lesson' ? 'Pliki Markdown i lokalne zdjęcia' : ['exam', 'presentation', 'quiz'].includes(group.kind) ? 'Definicja i lokalny folder photos' : 'Pliki JSON i TXT')
      );
      const files = create('div', 'content-explorer-files');
      paged.items.forEach((asset) => {
        const material = document.createElement('details');
        material.className = 'content-explorer-material';
        const ownerKey = explorerMediaKey(group.kind, asset.filename, asset.repositoryId);
        material.dataset.explorerOwnerKey = ownerKey;
        material.open = state.contentLibrary.explorerOpen.has(ownerKey);
        const materialSummary = document.createElement('summary');
        const copy = create('span', 'content-explorer-file-copy');
        copy.append(
          create('strong', '', asset.title || asset.filename),
          create('small', '', asset.path || asset.filename)
        );
        materialSummary.append(
          create('span', `content-explorer-file-type is-${group.kind}`, group.kind === 'lesson' ? 'MD' : group.kind === 'exam' ? 'EXAM' : group.kind === 'presentation' ? 'SLIDE' : group.kind === 'quiz' ? 'QUIZ' : /\.txt$/i.test(asset.filename) ? 'TXT' : 'JSON'),
          copy,
          create('span', 'content-explorer-material-meta', formatExplorerSize(asset.size)),
          create('span', 'content-explorer-chevron', '⌄')
        );
        const body = create('div', 'content-explorer-material-body');
        const row = create('div', 'content-explorer-definition-row');
        const definition = create('div', 'content-explorer-definition-copy');
        definition.append(create('span', '', '◇'), create('span', '', group.kind === 'exam' ? 'exam.json' : group.kind === 'presentation' ? 'presentation.json' : group.kind === 'quiz' ? 'quiz.json' : asset.filename));
        const actions = create('div', 'content-explorer-row-actions');
        const button = create('button', 'content-explorer-open-button', 'Otwórz');
        button.type = 'button';
        button.dataset.explorerOpen = '1';
        button.dataset.explorerKind = group.kind;
        button.dataset.explorerFilename = asset.filename;
        button.dataset.explorerRepository = asset.repositoryId || state.contentLibrary.selectedRepositoryId;
        const remove = create('button', 'content-explorer-delete', 'Usuń');
        remove.type = 'button';
        remove.dataset.explorerDelete = '1';
        remove.dataset.explorerKind = group.kind;
        remove.dataset.explorerFilename = asset.filename;
        remove.dataset.explorerRepository = asset.repositoryId || state.contentLibrary.selectedRepositoryId;
        remove.setAttribute('aria-label', `Usuń ${asset.title || asset.filename} z biblioteki`);
        remove.title = 'Usuń zapisany materiał';
        const duplicate = create('button', 'content-explorer-duplicate', 'Duplikuj');
        duplicate.type = 'button';
        duplicate.dataset.explorerDuplicate = '1';
        duplicate.dataset.explorerKind = group.kind;
        duplicate.dataset.explorerFilename = asset.filename;
        duplicate.dataset.explorerRepository = asset.repositoryId || state.contentLibrary.selectedRepositoryId;
        actions.append(button, duplicate, remove);
        row.append(definition, actions);
        body.append(row);
        if (['lesson', 'exam', 'presentation', 'quiz'].includes(group.kind)) {
          body.append(renderExplorerMediaFolder(group.kind, asset));
        }
        material.append(materialSummary, body);
        material.addEventListener('toggle', () => {
          if (material.open) {
            state.contentLibrary.explorerOpen.add(ownerKey);
            if (['lesson', 'exam', 'presentation', 'quiz'].includes(group.kind)) void loadExplorerMedia(group.kind, asset);
          } else {
            state.contentLibrary.explorerOpen.delete(ownerKey);
          }
        });
        files.append(material);
      });
      if (!matches.length) files.append(create('p', 'content-explorer-empty',
        state.contentLibrary.loading ? 'Wczytywanie…'
          : state.contentLibrary.error ? 'Nie udało się wczytać plików.'
            : query ? 'Brak pasujących plików.' : 'Nie ma jeszcze materiałów tego typu.'));
      else files.append(pagedListApi.controls(document, state.contentLibrary.paging, paged, {
        label: 'plików',
        onMore: renderContentExplorer
      }));
      folder.append(summary, files);
      return folder;
    });
    if (!reactLibrary) {
      roots.push(renderSharedMediaRoot());
      elements.contentExplorerFolders.replaceChildren(...roots);
    }
    if (elements.contentExplorerStatus) {
      const total = groups.reduce((sum, group) => sum + group.assets.length, 0);
      const selected = selectedRepository();
      elements.contentExplorerStatus.classList.toggle('is-error', Boolean(state.contentLibrary.error));
      elements.contentExplorerStatus.textContent = state.contentLibrary.loading
        ? 'Wczytywanie materiałów…'
        : state.contentLibrary.error
          ? state.contentLibrary.error
          : state.contentLibrary.loaded
            ? `${total} plików · ${selected?.label || selected?.repository || 'repozytorium'}${total ? '' : '. Opublikuj pierwszy materiał lub sprawdź, czy skopiowano materiały do wybranego katalogu.'}`
            : 'Biblioteka nie została jeszcze wczytana.';
    }
  }

  function formatExplorerSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function explorerMediaKey(kind, materialId, repositoryId) {
    return `${repositoryId || state.contentLibrary.selectedRepositoryId}:${kind}:${materialId}`;
  }

  function renderExplorerMediaFolder(kind, asset) {
    const repositoryId = asset.repositoryId || state.contentLibrary.selectedRepositoryId;
    const key = explorerMediaKey(kind, asset.filename, repositoryId);
    const media = state.contentLibrary.mediaByOwner.get(key);
    const loading = state.contentLibrary.mediaLoading.has(key);
    const shell = create('section', 'content-explorer-media-folder');
    const heading = create('div', 'content-explorer-media-heading');
    const label = create('div', 'content-explorer-media-label');
    label.append(
      create('span', 'content-explorer-small-folder', '▰'),
      create('span', '', 'photos'),
      create('small', '', loading ? 'pobieranie…' : media ? `${media.length} plików` : 'otwórz materiał, aby wczytać')
    );
    const manage = create('button', 'content-explorer-manage-media', 'Zarządzaj');
    manage.type = 'button';
    manage.dataset.explorerMedia = '1';
    manage.dataset.explorerKind = kind;
    manage.dataset.explorerFilename = asset.filename;
    manage.dataset.explorerRepository = repositoryId;
    heading.append(label, manage);
    shell.append(heading);
    if (loading) {
      shell.append(create('div', 'content-explorer-media-loading', 'Wczytuję zawartość folderu photos…'));
      return shell;
    }
    if (!media) return shell;
    if (!media.length) {
      shell.append(create('p', 'content-explorer-media-empty', 'Brak obrazów. Kliknij „Zarządzaj”, aby dodać pierwszy plik.'));
      return shell;
    }
    const list = create('div', 'content-explorer-media-list');
    const paged = pagedListApi.page(state.contentLibrary.paging, `media-${key}`, media);
    paged.items.forEach((item) => {
      const row = create('div', 'content-explorer-media-row');
      const copy = create('div', 'content-explorer-media-copy');
      copy.append(
        create('span', 'content-explorer-image-icon', '▧'),
        create('span', '', item.filename),
        create('small', '', `${formatExplorerSize(item.size)}${item.usageCount ? ` · używany ${item.usageCount}×` : ' · nieużywany'}`)
      );
      const remove = create('button', 'content-explorer-media-delete', 'Usuń');
      remove.type = 'button';
      remove.dataset.explorerMediaDelete = '1';
      remove.dataset.explorerOwnerKey = key;
      remove.dataset.explorerReference = item.reference;
      row.append(copy, remove);
      list.append(row);
    });
    list.append(pagedListApi.controls(document, state.contentLibrary.paging, paged, {
      label: 'obrazów',
      onMore: renderContentExplorer
    }));
    shell.append(list);
    return shell;
  }

  function renderSharedMediaRoot() {
    const folder = document.createElement('details');
    folder.className = 'content-explorer-folder is-shared';
    folder.open = state.contentLibrary.explorerOpen.has('shared-media');
    folder.addEventListener('toggle', () => {
      if (folder.open) state.contentLibrary.explorerOpen.add('shared-media');
      else state.contentLibrary.explorerOpen.delete('shared-media');
    });
    const summary = document.createElement('summary');
    const copy = create('span', 'content-explorer-folder-copy');
    copy.append(create('strong', '', 'Media wspólne'), create('small', '', 'assets/shared · dla wielu materiałów'));
    summary.append(
      create('span', 'content-explorer-folder-icon is-shared', '▧'),
      copy,
      create('small', '', 'SHARED'),
      create('span', 'content-explorer-chevron', '⌄')
    );
    const body = create('div', 'content-explorer-shared-body');
    body.append(
      create('p', '', 'Biblioteka obrazów wielokrotnego użytku. Usunięcie pliku może wpłynąć na kilka materiałów.'),
      create('button', 'content-explorer-manage-media', 'Otwórz Media Manager')
    );
    body.querySelector('button').type = 'button';
    body.querySelector('button').dataset.explorerMedia = '1';
    body.querySelector('button').dataset.explorerScope = 'shared';
    body.querySelector('button').dataset.explorerRepository = state.contentLibrary.selectedRepositoryId;
    folder.append(summary, body);
    return folder;
  }

  async function loadExplorerMedia(kind, asset, refresh = false) {
    const library = window.ChemContentLibrary;
    if (!library?.listMedia) return;
    const repositoryId = asset.repositoryId || state.contentLibrary.selectedRepositoryId;
    const key = explorerMediaKey(kind, asset.filename, repositoryId);
    if (state.contentLibrary.mediaLoading.has(key) || (!refresh && state.contentLibrary.mediaByOwner.has(key))) return;
    state.contentLibrary.mediaLoading.add(key);
    renderContentExplorer();
    try {
      const media = await library.listMedia({
        scope: 'local',
        materialKind: kind,
        materialId: asset.filename,
        repositoryId,
        refresh,
        usage: true
      });
      state.contentLibrary.mediaByOwner.set(key, media);
    } catch (error) {
      toast('Nie udało się wczytać folderu photos', error?.message || 'Błąd repozytorium.', 'error');
      state.contentLibrary.mediaByOwner.set(key, []);
    } finally {
      state.contentLibrary.mediaLoading.delete(key);
      renderContentExplorer();
    }
  }

  function selectedRepository() {
    return state.contentLibrary.repositories.find(
      (repository) => repository.id === state.contentLibrary.selectedRepositoryId
    ) || null;
  }

  function renderRepositorySelectors() {
    const repositories = state.contentLibrary.repositories;
    const selectedId = state.contentLibrary.selectedRepositoryId;
    [elements.dashboardRepository, elements.lessonRepository, elements.promptRepository, elements.contentExplorerRepository].forEach((select) => {
      if (!select) return;
      select.replaceChildren(...repositories.map((repository) => {
        const option = document.createElement('option');
        option.value = repository.id;
        option.textContent = repository.label || repository.repository;
        return option;
      }));
      select.value = selectedId;
      select.disabled = repositories.length < 2;
    });
  }

  async function selectContentRepository(repositoryId) {
    if (
      !state.contentLibrary.repositories.some((repository) => repository.id === repositoryId) ||
      repositoryId === state.contentLibrary.selectedRepositoryId
    ) return;
    state.contentLibrary.selectedRepositoryId = repositoryId;
    state.contentLibrary.lessons = [];
    state.contentLibrary.prompts = [];
    state.contentLibrary.exams = [];
    state.contentLibrary.presentations = [];
    state.contentLibrary.quizzes = [];
    state.contentLibrary.mediaByOwner.clear();
    state.contentLibrary.mediaLoading.clear();
    pagedListApi.reset(state.contentLibrary.paging);
    state.contentLibrary.loaded = false;
    state.contentLibrary.error = '';
    renderRepositorySelectors();
    renderRepositoryAssets();
    updateRepositoryButtons();
    await loadRepositoryAssets(false);
    if (state.mode === 'dashboard') renderDashboardInspector();
    if (state.mode === 'lesson') renderLessonInspector();
  }

  async function loadRepositoryAssetLists(library, repositoryId, force) {
    const [lesson, prompt, exam, presentation, quiz] = await Promise.all([
      library.list('lesson', { refresh: Boolean(force), repositoryId }),
      library.list('prompt', { refresh: Boolean(force), repositoryId }),
      library.list('exam', { refresh: Boolean(force), repositoryId }),
      library.list('presentation', { refresh: Boolean(force), repositoryId }),
      library.list('quiz', { refresh: Boolean(force), repositoryId })
    ]);
    return { lesson, prompt, exam, presentation, quiz };
  }

  async function loadStudioBootstrap(library, repositoryId, force) {
    if (
      state.contentLibrary.studioBootstrapCapability === false ||
      typeof library.studioBootstrap !== 'function'
    ) return null;
    let failure;
    try {
      const bootstrap = await library.studioBootstrap({
        refresh: Boolean(force),
        repositoryId
      });
      state.contentLibrary.studioBootstrapCapability = true;
      return bootstrap;
    } catch (error) {
      failure = error;
    }
    if (repositoryId && failure?.code === 'INVALID_CONTENT_REPOSITORY') {
      try {
        const bootstrap = await library.studioBootstrap({ refresh: Boolean(force) });
        state.contentLibrary.studioBootstrapCapability = true;
        return bootstrap;
      } catch (error) {
        failure = error;
      }
    }
    // A mixed deploy can briefly serve the new Studio with an older Function.
    // Remember that capability until reload instead of paying for a failed probe
    // before every repositories + list fallback.
    if (failure?.code === 'INVALID_CONTENT_ACTION') {
      state.contentLibrary.studioBootstrapCapability = false;
      return null;
    }
    throw failure;
  }

  function applyRepositoryAssetBundle(assets = {}) {
    state.contentLibrary.lessons = Array.isArray(assets.lesson) ? assets.lesson : [];
    state.contentLibrary.prompts = Array.isArray(assets.prompt) ? assets.prompt : [];
    state.contentLibrary.exams = Array.isArray(assets.exam) ? assets.exam : [];
    state.contentLibrary.presentations = Array.isArray(assets.presentation) ? assets.presentation : [];
    state.contentLibrary.quizzes = Array.isArray(assets.quiz) ? assets.quiz : [];
  }

  async function recoverRepositorySelector(library, requestId) {
    // A broken default repository must not prevent choosing a working one.
    // Metadata comes from server ENV only: no additional Git API request.
    if (state.contentLibrary.repositories.length || typeof library.repositories !== 'function') return;
    try {
      const repositories = await library.repositories();
      if (requestId !== state.contentLibrary.requestId || !Array.isArray(repositories)) return;
      state.contentLibrary.repositories = repositories;
      if (!selectedRepository()) {
        state.contentLibrary.selectedRepositoryId = (repositories.find((entry) => entry.default) || repositories[0])?.id || '';
      }
      renderRepositorySelectors();
    } catch { /* Keep the original content error visible; do not retry in a loop. */ }
  }

  function loadRepositoryAssets(force) {
    const repositoryId = state.contentLibrary.selectedRepositoryId;
    if (state.contentLibrary.loadPromise && state.contentLibrary.loadRepositoryId === repositoryId) {
      return state.contentLibrary.loadPromise;
    }
    if (!force && state.contentLibrary.loaded) return Promise.resolve();
    const operation = performLoadRepositoryAssets(force);
    state.contentLibrary.loadPromise = operation;
    state.contentLibrary.loadRepositoryId = repositoryId;
    operation.finally(() => {
      if (state.contentLibrary.loadPromise === operation) {
        state.contentLibrary.loadPromise = null;
        state.contentLibrary.loadRepositoryId = '';
      }
    });
    return operation;
  }

  async function performLoadRepositoryAssets(force) {
    const library = window.ChemContentLibrary;
    const canLoadLegacy = typeof library?.list === 'function'
      && typeof library?.repositories === 'function';
    if (!library || (typeof library.studioBootstrap !== 'function' && !canLoadLegacy)) {
      elements.dashboardAssetStatus.textContent = 'Brakuje klienta biblioteki materiałów.';
      elements.lessonAssetStatus.textContent = 'Brakuje klienta biblioteki materiałów.';
      elements.promptAssetStatus.textContent = 'Brakuje klienta biblioteki materiałów.';
      if (elements.contentExplorerStatus) elements.contentExplorerStatus.textContent = 'Brakuje klienta biblioteki materiałów.';
      return;
    }
    const requestId = ++state.contentLibrary.requestId;
    state.contentLibrary.loading = true;
    state.contentLibrary.error = '';
    [elements.dashboardAssetStatus, elements.lessonAssetStatus, elements.promptAssetStatus].forEach((status) => {
      status.classList.remove('is-error');
      status.textContent = 'Wczytywanie biblioteki…';
    });
    if (elements.contentExplorerStatus) {
      elements.contentExplorerStatus.classList.remove('is-error');
      elements.contentExplorerStatus.textContent = 'Wczytywanie materiałów…';
    }
    renderContentExplorer();
    try {
      const bootstrap = await loadStudioBootstrap(
        library,
        state.contentLibrary.selectedRepositoryId,
        force
      );
      if (requestId !== state.contentLibrary.requestId) return;
      if (bootstrap) {
        state.contentLibrary.repositories = Array.isArray(bootstrap.repositories)
          ? bootstrap.repositories
          : [];
      } else if (!canLoadLegacy) {
        throw new Error('Brakuje zgodnego klienta biblioteki materiałów.');
      } else if (!state.contentLibrary.repositories.length) {
        state.contentLibrary.repositories = await library.repositories();
        if (requestId !== state.contentLibrary.requestId) return;
      }
      if (!state.contentLibrary.repositories.length) {
        throw new Error('Nie skonfigurowano żadnego repozytorium materiałów.');
      }
      const bootstrapRepository = bootstrap?.repository?.id
        ? state.contentLibrary.repositories.find((repository) => repository.id === bootstrap.repository.id)
        : null;
      if (bootstrapRepository) {
        state.contentLibrary.selectedRepositoryId = bootstrapRepository.id;
      } else if (!selectedRepository()) {
        const fallback = state.contentLibrary.repositories.find((repository) => repository.default)
          || state.contentLibrary.repositories[0];
        state.contentLibrary.selectedRepositoryId = fallback.id;
      }
      renderRepositorySelectors();
      const repositoryId = state.contentLibrary.selectedRepositoryId;
      const assets = bootstrap?.assets
        || await loadRepositoryAssetLists(library, repositoryId, force);
      if (requestId !== state.contentLibrary.requestId) return;
      applyRepositoryAssetBundle(assets);
      state.contentLibrary.loaded = true;
      renderRepositoryAssets();
      updateRepositoryButtons();
      if (state.mode === 'dashboard') renderDashboardInspector();
      if (state.mode === 'lesson') renderLessonInspector();
    } catch (error) {
      if (requestId !== state.contentLibrary.requestId) return;
      if (!['AUTH_REQUIRED', 'AUTH_EXPIRED', 'SESSION_REPLACED', 'ADMIN_REQUIRED', 'ACCESS_REQUIRED', 'ACCESS_EXPIRED', 'SESSION_CHECK_UNAVAILABLE'].includes(error?.code)) {
        await recoverRepositorySelector(library, requestId);
        if (requestId !== state.contentLibrary.requestId) return;
      }
      state.contentLibrary.loaded = false;
      state.contentLibrary.error = error && error.message
        ? error.message
        : 'Nie udało się pobrać listy materiałów.';
      [elements.dashboardAssetStatus, elements.lessonAssetStatus, elements.promptAssetStatus].forEach((status) => {
        status.classList.add('is-error');
        status.textContent = state.contentLibrary.error;
      });
      if (elements.contentExplorerStatus) {
        elements.contentExplorerStatus.classList.add('is-error');
        elements.contentExplorerStatus.textContent = state.contentLibrary.error;
      }
    } finally {
      if (requestId === state.contentLibrary.requestId) {
        state.contentLibrary.loading = false;
        renderContentExplorer();
      }
    }
  }

  async function refreshRepositoryAssetKind(kind, force = false) {
    const propertyByKind = {
      lesson: 'lessons',
      prompt: 'prompts',
      exam: 'exams',
      presentation: 'presentations',
      quiz: 'quizzes'
    };
    const property = propertyByKind[kind];
    const library = window.ChemContentLibrary;
    if (!property || typeof library?.list !== 'function' || !state.contentLibrary.selectedRepositoryId) {
      return loadRepositoryAssets(Boolean(force));
    }
    state.contentLibrary[property] = await library.list(kind, {
      repositoryId: state.contentLibrary.selectedRepositoryId,
      refresh: Boolean(force)
    });
    renderRepositoryAssets();
    updateRepositoryButtons();
    renderContentExplorer();
  }

  function handleContentLibraryChanged(event) {
    const kind = String(event?.detail?.kind || '');
    const repositoryId = String(event?.detail?.repositoryId || '');
    if (repositoryId && repositoryId !== state.contentLibrary.selectedRepositoryId) return;
    void refreshRepositoryAssetKind(kind, false);
  }

  async function importRepositoryLesson(asset, options = {}) {
    if (!asset || !asset.filename) return;
    if (options.confirm !== false && !window.confirm(`Wczytać „${asset.title || asset.filename}” i zastąpić bieżącą lekcję w builderze?`)) {
      return;
    }
    elements.lessonAssetStatus.className = '';
    elements.lessonAssetStatus.textContent = `Pobieranie ${asset.filename}…`;
    try {
      const result = await window.ChemContentLibrary.readLesson(asset.filename, {
        repositoryId: asset.repositoryId
      });
      const sourceWasEmpty = !String(result.content || '').trim();
      const model = lessonModelFromSource(result.content, asset.filename);
      finishEdit();
      state.lesson.model = model;
      state.lesson.previewOpenAnswers.clear();
      state.lesson.selectedId = sourceWasEmpty && model.slides[0] ? model.slides[0].id : '';
      state.lesson.previewSlideId = model.slides[0] ? model.slides[0].id : '';
      history.lesson.undo = [];
      history.lesson.redo = [];
      state.lesson.remoteFilename = asset.filename;
      state.lesson.remoteSha = asset.sha || result.sha || '';
      state.lesson.remoteRepositoryId = asset.repositoryId || result.repositoryId || '';
      const pendingManifest = state.lesson.manifestPending;
      const matchesPendingManifest = Boolean(
        !sourceWasEmpty
        && pendingManifest
        && pendingManifest.filename === asset.filename
        && pendingManifest.repositoryId === state.lesson.remoteRepositoryId
        && pendingManifest.content === String(result.content || '')
      );
      setPendingLessonManifest(matchesPendingManifest
        ? { ...pendingManifest, sha: state.lesson.remoteSha || '' }
        : null);
      scheduleDraftSave('lesson');
      renderLesson();
      updateHistoryButtons();
      updateRepositoryButtons();
      elements.lessonAssetStatus.textContent = sourceWasEmpty
        ? `${asset.filename} był pusty — dodano edytowalny szablon.`
        : `Wczytano ${asset.filename}.`;
      toast(
        sourceWasEmpty ? 'Pusty plik jest gotowy do edycji' : 'Lekcja otwarta do edycji',
        sourceWasEmpty
          ? 'Uzupełnij szablon i kliknij „Opublikuj zmiany”.'
          : 'Możesz ją edytować, podejrzeć i pobrać jako Markdown.'
      );
      switchMode('lesson');
    } catch (error) {
      elements.lessonAssetStatus.className = 'is-error';
      elements.lessonAssetStatus.textContent = error && error.message
        ? error.message
        : 'Nie udało się wczytać lekcji.';
    }
  }

  async function importRepositoryPrompt(asset, options = {}) {
    if (!asset || !asset.filename) return;
    if (options.confirm !== false && !window.confirm(`Wczytać „${asset.title || asset.filename}” i zastąpić bieżący prompt w builderze?`)) {
      return;
    }
    elements.promptAssetStatus.className = 'prompt-repository-status';
    elements.promptAssetStatus.textContent = `Pobieranie ${asset.filename}…`;
    try {
      const result = await window.ChemContentLibrary.readPrompt(asset.filename, {
        repositoryId: asset.repositoryId
      });
      const model = promptModelApi.parsePrompt(result.content, asset.filename);
      finishEdit();
      state.prompt.model = model;
      history.prompt.undo = [];
      history.prompt.redo = [];
      state.prompt.remoteFilename = asset.filename;
      state.prompt.remoteSha = asset.sha || result.sha || '';
      state.prompt.remoteRepositoryId = asset.repositoryId || result.repositoryId || '';
      scheduleDraftSave('prompt');
      renderPrompt();
      updateHistoryButtons();
      updateRepositoryButtons();
      elements.promptAssetStatus.textContent = `Wczytano ${asset.filename}.`;
      toast('Instrukcja AI otwarta do edycji', 'Możesz zmienić treść, zapisać ją lub pobrać kopię.');
      switchMode('prompt');
    } catch (error) {
      elements.promptAssetStatus.className = 'prompt-repository-status is-error';
      elements.promptAssetStatus.textContent = error && error.message
        ? error.message
        : 'Nie udało się wczytać promptu.';
    }
  }

  function contentExplorerAsset(button) {
    if (!button) return null;
    const kind = button.dataset.explorerKind;
    const collection = kind === 'lesson'
      ? state.contentLibrary.lessons
      : kind === 'exam' ? state.contentLibrary.exams
        : kind === 'presentation' ? state.contentLibrary.presentations
          : kind === 'quiz' ? state.contentLibrary.quizzes
            : kind === 'prompt' ? state.contentLibrary.prompts : [];
    return collection.find((entry) => (
      entry.filename === button.dataset.explorerFilename
      && (entry.repositoryId || state.contentLibrary.selectedRepositoryId) === button.dataset.explorerRepository
    )) || null;
  }

  async function openContentExplorerAsset(button) {
    if (!button || button.disabled) return;
    const kind = button.dataset.explorerKind;
    const asset = contentExplorerAsset(button);
    if (!asset) return;
    button.disabled = true;
    elements.contentExplorerStatus.classList.remove('is-error');
    elements.contentExplorerStatus.textContent = `Otwieranie ${asset.title || asset.filename}…`;
    try {
      if (kind === 'lesson') await importRepositoryLesson(asset, { confirm: false });
      else if (kind === 'prompt') await importRepositoryPrompt(asset, { confirm: false });
      else if (kind === 'exam') {
        switchMode('exam');
        await window.ChemExamBuilder?.openAsset?.(asset);
      } else if (kind === 'presentation') {
        switchMode('presentation');
        await window.ChemPresentationBuilder?.openAsset?.(asset);
      } else {
        switchMode('quiz');
        await window.ChemQuizBuilder?.openAsset?.(asset);
      }
    } catch (error) {
      elements.contentExplorerStatus.classList.add('is-error');
      elements.contentExplorerStatus.textContent = error?.message || 'Nie udało się otworzyć pliku.';
    } finally {
      button.disabled = false;
    }
  }

  async function deleteContentExplorerAsset(button) {
    if (!button || button.disabled) return;
    const asset = contentExplorerAsset(button);
    if (!asset?.sha) {
      toast('Nie można bezpiecznie usunąć pliku', 'Odśwież bibliotekę, aby pobrać aktualną wersję pliku.', 'error');
      return;
    }
    const kind = button.dataset.explorerKind;
    const repositoryId = button.dataset.explorerRepository;
    const kindLabel = kind === 'lesson' ? 'lekcję' : kind === 'exam' ? 'egzamin' : kind === 'presentation' ? 'prezentację' : kind === 'quiz' ? 'quiz' : 'prompt';
    let warning = kind === 'lesson'
      ? 'Usunięcie lekcji nie usuwa kart Dashboardu, które mogą ją otwierać, ani historycznego postępu uczniów.\n\n'
      : kind === 'prompt'
        ? 'Usunięcie promptu nie usuwa kart Dashboardu, które mogą się do niego odwoływać.\n\n'
        : '';
    const material = button.closest('.content-explorer-material');
    material?.querySelectorAll('button').forEach((control) => { control.disabled = true; });
    elements.contentExplorerStatus.classList.remove('is-error');
    elements.contentExplorerStatus.textContent = kind === 'exam'
      ? `Sprawdzanie użycia egzaminu ${asset.title || asset.filename}…`
      : `Przygotowanie usunięcia ${asset.title || asset.filename}…`;
    try {
      let localMedia = [];
      if (['lesson', 'exam', 'presentation', 'quiz'].includes(kind) && window.ChemContentLibrary?.listMedia) {
        localMedia = await window.ChemContentLibrary.listMedia({
          scope: 'local',
          materialKind: kind,
          materialId: asset.filename,
          repositoryId,
          refresh: true,
          usage: true
        });
      }
      if (kind === 'exam') {
        warning = window.ChemExamBuilder?.deletionWarning
          ? await window.ChemExamBuilder.deletionWarning({ ...asset, repositoryId })
          : 'Nie udało się sprawdzić odwołań do egzaminu. Usunięcie exam.json nie usuwa jego kart ani kroków lekcji.\n\n';
      }
      const confirmed = window.confirm(
        `${warning}${localMedia.length ? `Materiał ma ${localMedia.length} ${localMedia.length === 1 ? 'przypisany obraz' : 'przypisanych obrazów'}.\n\n` : ''}Usunąć ${kindLabel} „${asset.title || asset.filename}” z biblioteki? Plik można odzyskać z historii repozytorium.`
      );
      if (!confirmed) {
        elements.contentExplorerStatus.textContent = 'Usuwanie anulowane.';
        return;
      }
      const deleteLocalMedia = localMedia.length > 0 && window.confirm(
        `Czy usunąć również folder photos (${localMedia.length} ${localMedia.length === 1 ? 'plik' : 'plików'})?\n\nOK — usuń definicję razem z lokalnymi obrazami.\nAnuluj — usuń tylko definicję i zachowaj obrazy.\n\nMedia wspólne z assets/shared nigdy nie są tu usuwane.`
      );
      const result = await window.ChemContentLibrary.remove(kind, {
        filename: asset.filename,
        expectedSha: asset.sha,
        repositoryId
      });
      const mediaFailures = [];
      if (deleteLocalMedia) {
        for (let index = 0; index < localMedia.length; index += 1) {
          elements.contentExplorerStatus.textContent = `Definicja usunięta · porządkowanie obrazu ${index + 1}/${localMedia.length}: ${localMedia[index].filename}…`;
          try {
            await window.ChemContentLibrary.removeMedia({
              scope: 'local',
              materialKind: kind,
              materialId: asset.filename,
              reference: localMedia[index].reference,
              expectedSha: localMedia[index].sha,
              repositoryId
            });
          } catch (mediaError) {
            mediaFailures.push(localMedia[index].filename);
          }
        }
      }
      if (kind === 'lesson' && state.lesson.remoteFilename === asset.filename && state.lesson.remoteRepositoryId === repositoryId) {
        state.lesson.remoteFilename = '';
        state.lesson.remoteSha = '';
        state.lesson.remoteRepositoryId = '';
      }
      if (kind === 'lesson'
        && state.lesson.manifestPending?.filename === asset.filename
        && state.lesson.manifestPending.repositoryId === repositoryId) setPendingLessonManifest(null);
      if (kind === 'prompt' && state.prompt.remoteFilename === asset.filename && state.prompt.remoteRepositoryId === repositoryId) {
        state.prompt.remoteFilename = '';
        state.prompt.remoteSha = '';
        state.prompt.remoteRepositoryId = '';
        renderPromptPreview();
      }
      if (kind === 'exam') window.ChemExamBuilder?.assetDeleted?.({ ...asset, repositoryId });
      if (kind === 'presentation') window.ChemPresentationBuilder?.assetDeleted?.({ ...asset, repositoryId });
      if (kind === 'quiz') window.ChemQuizBuilder?.assetDeleted?.({ ...asset, repositoryId });
      updateRepositoryButtons();
      toast(
        kind === 'lesson' ? 'Lekcja usunięta z biblioteki'
          : kind === 'exam' ? 'Egzamin usunięty z biblioteki'
            : kind === 'presentation' ? 'Prezentacja usunięta z biblioteki'
              : kind === 'quiz' ? 'Quiz usunięty z biblioteki'
                : 'Instrukcja AI usunięta z biblioteki',
        mediaFailures.length
          ? `Materiał został usunięty, ale nie udało się usunąć ${mediaFailures.length} obrazów: ${mediaFailures.join(', ')}.`
          : `${asset.filename} usunięto. Szkic na tym urządzeniu pozostaje bez zmian.`
      );
      await loadRepositoryAssets(true);
    } catch (error) {
      elements.contentExplorerStatus.classList.add('is-error');
      elements.contentExplorerStatus.textContent = error?.message || 'Nie udało się usunąć pliku.';
      toast('Nie udało się usunąć pliku', error?.message || 'Błąd repozytorium.', 'error');
    } finally {
      material?.querySelectorAll('button').forEach((control) => { control.disabled = false; });
    }
  }

  function duplicateFilename(filename, kind) {
    if (kind === 'lesson') return filename.replace(/\.md$/i, '-kopia.md');
    if (kind === 'prompt') return filename.replace(/(\.(?:json|txt))$/i, '-kopia$1');
    return `${filename}-kopia`;
  }

  async function blobBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function duplicateContentExplorerAsset(button) {
    if (!button || button.disabled) return;
    const asset = contentExplorerAsset(button);
    const library = window.ChemContentLibrary;
    if (!asset || !library) return;
    const kind = button.dataset.explorerKind;
    const repositoryId = button.dataset.explorerRepository;
    const requested = window.prompt('Nazwa kopii w repozytorium:', duplicateFilename(asset.filename, kind));
    if (requested == null) return;
    let target;
    try { target = library.validateFilename(kind, requested.trim().toLowerCase()); }
    catch (error) { toast('Nieprawidłowa nazwa kopii', error.message, 'error'); return; }
    if (target === asset.filename) { toast('Wybierz inną nazwę', 'Kopia musi mieć nowy identyfikator albo nazwę pliku.', 'error'); return; }
    button.disabled = true;
    elements.contentExplorerStatus.textContent = `Duplikowanie ${asset.title || asset.filename}…`;
    try {
      const readers = { lesson: 'readLesson', prompt: 'readPrompt', exam: 'readExam', presentation: 'readPresentation', quiz: 'readQuiz' };
      const source = await library[readers[kind]](asset.filename, { repositoryId });
      let content = source.content;
      if (['exam', 'presentation', 'quiz'].includes(kind)) {
        const definition = JSON.parse(content);
        if (kind === 'exam') { definition.examId = target; definition.status = 'draft'; }
        if (kind === 'presentation') { definition.presentationId = target; definition.metadata = { ...(definition.metadata || {}), status: 'draft' }; }
        if (kind === 'quiz') {
          definition.quizId = target;
          definition.metadata = { ...(definition.metadata || {}), status: 'draft' };
        }
        content = `${JSON.stringify(definition, null, 2)}\n`;
      }
      await library.save(kind, { filename: target, content, repositoryId });
      let media = [];
      if (['lesson', 'exam', 'presentation', 'quiz'].includes(kind)) {
        media = await library.listMedia({ scope: 'local', materialKind: kind, materialId: asset.filename, repositoryId, refresh: true });
        for (let index = 0; index < media.length; index += 1) {
          elements.contentExplorerStatus.textContent = `Kopiowanie obrazu ${index + 1}/${media.length}: ${media[index].filename}…`;
          const blob = await library.readMediaBlob({ scope: 'local', materialKind: kind, materialId: asset.filename, reference: media[index].reference, repositoryId });
          await library.uploadMedia({ scope: 'local', materialKind: kind, materialId: target, filename: media[index].filename, contentBase64: await blobBase64(blob), mimeType: media[index].mimeType || blob.type, repositoryId });
        }
      }
      toast('Kopia utworzona', `${target}${media.length ? ` · skopiowano ${media.length} obrazów lokalnych` : ''}. Referencje wspólne pozostały bez zmian.`);
      await loadRepositoryAssets(true);
    } catch (error) {
      elements.contentExplorerStatus.classList.add('is-error');
      elements.contentExplorerStatus.textContent = error?.message || 'Nie udało się utworzyć kopii.';
      toast('Nie udało się utworzyć pełnej kopii', 'Jeśli definicja zdążyła powstać, sprawdź jej folder photos i usuń niepełną kopię albo ponów brakujące pliki.', 'error');
    } finally { button.disabled = false; }
  }

  async function openExplorerMediaManager(button) {
    if (!window.ChemMediaManager?.open) {
      toast('Media Manager jest niedostępny', 'Odśwież Studio i spróbuj ponownie.', 'error');
      return;
    }
    const shared = button.dataset.explorerScope === 'shared';
    const kind = shared ? '' : button.dataset.explorerKind;
    const materialId = shared ? '' : button.dataset.explorerFilename;
    const repositoryId = button.dataset.explorerRepository || state.contentLibrary.selectedRepositoryId;
    await window.ChemMediaManager.open({
      scope: shared ? 'shared' : 'local',
      materialKind: kind,
      materialId,
      repositoryId,
      onDelete: () => {
        if (!shared) {
          const asset = contentExplorerAsset(button);
          if (asset) void loadExplorerMedia(kind, asset, true);
        }
      }
    });
  }

  async function deleteExplorerMedia(button) {
    if (!button || button.disabled) return;
    const key = button.dataset.explorerOwnerKey;
    const reference = button.dataset.explorerReference;
    const media = state.contentLibrary.mediaByOwner.get(key) || [];
    const asset = media.find((item) => item.reference === reference);
    if (!asset?.sha) {
      toast('Nie można bezpiecznie usunąć obrazu', 'Odśwież folder photos i spróbuj ponownie.', 'error');
      return;
    }
    const warning = asset.usageCount > 0
      ? `Ten obraz jest używany ${asset.usageCount}× w definicji materiału. Po usunięciu pojawi się brak obrazu.\n\n`
      : '';
    if (!window.confirm(`${warning}Usunąć obraz „${asset.filename}” z biblioteki? Plik można odzyskać z historii repozytorium.`)) return;
    button.disabled = true;
    elements.contentExplorerStatus.textContent = `Usuwanie ${asset.filename}…`;
    try {
      const result = await window.ChemContentLibrary.removeMedia({
        scope: asset.scope,
        materialKind: asset.materialKind,
        materialId: asset.materialId,
        reference: asset.reference,
        expectedSha: asset.sha,
        repositoryId: asset.repositoryId || state.contentLibrary.selectedRepositoryId
      });
      state.contentLibrary.mediaByOwner.set(key, media.filter((item) => item.reference !== reference));
      renderContentExplorer();
      toast('Obraz usunięty', asset.filename);
    } catch (error) {
      button.disabled = false;
      elements.contentExplorerStatus.classList.add('is-error');
      elements.contentExplorerStatus.textContent = error?.message || 'Nie udało się usunąć obrazu.';
    }
  }

  function handleContentExplorerAction(event) {
    const mediaDelete = event.target.closest('[data-explorer-media-delete]');
    if (mediaDelete) {
      void deleteExplorerMedia(mediaDelete);
      return;
    }
    const media = event.target.closest('[data-explorer-media]');
    if (media) {
      void openExplorerMediaManager(media);
      return;
    }
    const remove = event.target.closest('[data-explorer-delete]');
    if (remove) {
      void deleteContentExplorerAsset(remove);
      return;
    }
    const duplicate = event.target.closest('[data-explorer-duplicate]');
    if (duplicate) {
      void duplicateContentExplorerAsset(duplicate);
      return;
    }
    const open = event.target.closest('[data-explorer-open]');
    if (open) void openContentExplorerAsset(open);
  }

  function ensureOpenAnswerPalette() {
    const groups = all('.lesson-palette-scroll .palette-group');
    const interactions = groups.find((group) => group.querySelector('h2')?.textContent.trim() === 'Interakcje');
    const grid = interactions?.querySelector('.palette-grid');
    if (!grid || grid.querySelector('[data-lesson-add="student-answer"]')) return;
    [
      {
        type: 'student-answer',
        symbol: 'Aa',
        tone: 'is-teal',
        title: 'Pytanie otwarte',
        description: 'Uczeń zapisuje własną odpowiedź',
        search: 'pytanie otwarte odpowiedź ucznia textarea zapisz samodzielna'
      },
      {
        type: 'answer-review',
        symbol: '≋',
        tone: 'is-violet',
        title: 'Omówienie odpowiedzi',
        description: 'Odpowiedź ucznia, klucz i opcjonalne AI',
        search: 'omówienie odpowiedzi klucz porównanie zapytaj ai questionid'
      }
    ].forEach((definition) => {
      const button = create('button', 'palette-item palette-item-wide open-answer-palette-item');
      button.type = 'button';
      button.draggable = true;
      button.dataset.lessonAdd = definition.type;
      button.dataset.search = definition.search;
      const symbol = create('span', `palette-symbol ${definition.tone}`, definition.symbol);
      const copy = create('span');
      copy.append(
        create('strong', '', definition.title),
        create('small', '', definition.description)
      );
      button.append(symbol, copy);
      grid.append(button);
    });
  }

  function bindPalette() {
    ensureOpenAnswerPalette();
    all('[data-dashboard-add]').forEach((button) => {
      button.addEventListener('click', () => addDashboardNode(button.dataset.dashboardAdd));
      if (button.draggable) {
        button.addEventListener('dragstart', (event) => {
          event.dataTransfer.effectAllowed = 'copy';
          setStudioDragPayload(event.dataTransfer, {
            source: 'dashboard-palette',
            type: button.dataset.dashboardAdd
          });
        });
      }
    });
    all('[data-lesson-add]').forEach((button) => {
      button.addEventListener('click', () => addLessonNode(button.dataset.lessonAdd));
      if (button.draggable) {
        button.addEventListener('dragstart', (event) => {
          event.dataTransfer.effectAllowed = 'copy';
          setStudioDragPayload(event.dataTransfer, {
            source: 'lesson-palette',
            type: button.dataset.lessonAdd
          });
        });
      }
    });
  }

  function bindEvents() {
    document.addEventListener('studio-select-mode', (event) => switchMode(event.detail));
    document.addEventListener('studio-open-media', () => {
      if (!window.ChemMediaManager?.open) { toast('Media Manager jest niedostępny', 'Odśwież Studio i spróbuj ponownie.', 'error'); return; }
      void window.ChemMediaManager.open({ scope: 'shared', repositoryId: state.contentLibrary.selectedRepositoryId });
    });
    all('[data-open-mode]').forEach((button) => {
      button.addEventListener('click', () => switchMode(button.dataset.openMode));
    });
    all('[data-switch-mode]').forEach((button) => {
      button.addEventListener('click', () => switchMode(button.dataset.switchMode));
    });
    all('[data-studio-tool="media"]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!window.ChemMediaManager?.open) {
          toast('Media Manager jest niedostępny', 'Odśwież Studio i spróbuj ponownie.', 'error');
          return;
        }
        void window.ChemMediaManager.open({
          scope: 'shared',
          repositoryId: state.contentLibrary.selectedRepositoryId
        });
      });
    });
    elements.themeToggle.addEventListener('click', toggleTheme);
    document.addEventListener('chemdisk-mathjax-ready', () => typesetMath(elements.lessonPreview));
    elements.undo.addEventListener('click', undo);
    elements.redo.addEventListener('click', redo);
    bindPalette();
    all('[data-studio-toggle]').forEach((button) => {
      button.addEventListener('click', toggleStudioLayout);
    });

    elements.dashboardPaletteSearch.addEventListener('input', () => {
      filterPalette(elements.dashboardPaletteSearch, 'data-search');
    });
    elements.lessonPaletteSearch.addEventListener('input', () => {
      filterPalette(elements.lessonPaletteSearch, 'data-search');
    });
    elements.dashboardAssetSearch.addEventListener('input', () => {
      pagedListApi.reset(state.contentLibrary.paging, 'dashboard-assets');
      renderRepositoryAssets();
    });
    elements.lessonAssetSearch.addEventListener('input', () => {
      pagedListApi.reset(state.contentLibrary.paging, 'lesson-assets');
      renderRepositoryAssets();
    });
    elements.promptAssetSearch.addEventListener('input', () => {
      pagedListApi.reset(state.contentLibrary.paging, 'prompt-assets');
      renderRepositoryAssets();
    });
    elements.contentExplorerSearch?.addEventListener('input', () => {
      ['lesson', 'exam', 'presentation', 'quiz', 'prompt'].forEach((kind) => {
        pagedListApi.reset(state.contentLibrary.paging, `explorer-${kind}`);
      });
      renderContentExplorer();
    });
    elements.contentExplorerFolders?.addEventListener('click', handleContentExplorerAction);
    elements.contentExplorerRefresh?.addEventListener('click', () => loadRepositoryAssets(true));
    document.addEventListener('chemdisk-content-changed', handleContentLibraryChanged);
    [elements.dashboardRepository, elements.lessonRepository, elements.promptRepository, elements.contentExplorerRepository].forEach((select) => {
      if (!select) return;
      select.addEventListener('change', () => selectContentRepository(select.value));
    });

    elements.dashboardCanvas.addEventListener('click', handleDashboardCanvasClick);
    elements.dashboardCanvas.addEventListener('dragstart', handleDashboardDragStart);
    elements.dashboardCanvas.addEventListener('dragend', clearDragClasses);
    elements.dashboardCanvas.addEventListener('dragover', (event) => {
      const zone = event.target.closest('[data-dashboard-drop-parent]');
      if (!zone) return;
      event.preventDefault();
      clearDragClasses();
      zone.classList.add('is-dragover');
    });
    elements.dashboardCanvas.addEventListener('dragleave', (event) => {
      const zone = event.target.closest('[data-dashboard-drop-parent]');
      if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover');
    });
    elements.dashboardCanvas.addEventListener('drop', handleDashboardDrop);

    elements.lessonCanvas.addEventListener('click', handleLessonCanvasClick);
    elements.lessonCanvas.addEventListener('dragstart', handleLessonDragStart);
    elements.lessonCanvas.addEventListener('dragend', clearDragClasses);
    elements.lessonCanvas.addEventListener('dragover', (event) => {
      const zone = event.target.closest('[data-lesson-drop-kind]');
      if (!zone) return;
      event.preventDefault();
      clearDragClasses();
      zone.classList.add('is-dragover');
    });
    elements.lessonCanvas.addEventListener('dragleave', (event) => {
      const zone = event.target.closest('[data-lesson-drop-kind]');
      if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover');
    });
    elements.lessonCanvas.addEventListener('drop', handleLessonDrop);

    [elements.dashboardTitle, elements.dashboardIntro].forEach((input) => {
      input.addEventListener('focus', () => beginEdit('dashboard'));
      input.addEventListener('input', handleDashboardDocumentInput);
      input.addEventListener('blur', finishEdit);
    });
    [elements.lessonTitle, elements.lessonFilename].forEach((input) => {
      input.addEventListener('focus', () => beginEdit('lesson'));
      input.addEventListener('input', handleLessonDocumentInput);
      input.addEventListener('blur', () => {
        finishEdit();
        if (input === elements.lessonFilename && !lessonModelApi.validateFilename(input.value)) {
          toast('Nieprawidłowa nazwa pliku', 'Użyj liter ASCII, cyfr, kropki, myślnika lub podkreślenia i zakończ nazwę przez .md.', 'error');
        }
        updateRepositoryButtons();
      });
    });
    [elements.promptFilename, elements.promptInstruction].forEach((input) => {
      input.addEventListener('focus', () => beginEdit('prompt'));
      input.addEventListener('input', handlePromptInput);
      input.addEventListener('blur', () => {
        finishEdit();
        renderPromptPreview();
      });
    });
    elements.promptFormat.addEventListener('change', () => changePromptFormat(elements.promptFormat.value));
    elements.promptAddPoint.addEventListener('click', addPromptPoint);
    elements.promptPointsList.addEventListener('focusin', (event) => {
      if (event.target.dataset.promptPointField) beginEdit('prompt');
    });
    elements.promptPointsList.addEventListener('input', handlePromptInput);
    elements.promptPointsList.addEventListener('focusout', (event) => {
      if (event.target.dataset.promptPointField) finishEdit();
    });
    elements.promptPointsList.addEventListener('click', (event) => {
      const action = event.target.closest('[data-prompt-point-action]');
      const card = event.target.closest('[data-prompt-point-id]');
      if (action && card) promptPointAction(action.dataset.promptPointAction, card.dataset.promptPointId);
    });

    elements.dashboardInspector.addEventListener('focusin', (event) => {
      if (event.target.closest('[data-dashboard-field]')) beginEdit('dashboard');
    });
    elements.dashboardInspector.addEventListener('input', handleDashboardInspectorInput);
    elements.dashboardInspector.addEventListener('change', (event) => {
      handleDashboardInspectorInput(event);
      finishEdit();
      if (event.target.dataset.dashboardField === 'navigation') renderDashboardCanvas();
      if (['source', 'variant', 'repositoryId', 'protection', 'navigation'].includes(event.target.dataset.dashboardField)) {
        renderDashboardInspector();
      }
    });
    elements.dashboardInspector.addEventListener('focusout', (event) => {
      if (event.target.closest('[data-dashboard-field]')) finishEdit();
    });
    elements.dashboardInspector.addEventListener('click', (event) => {
      const action = event.target.closest('[data-inspector-action]');
      if (action && state.dashboard.selectedUid) {
        dashboardNodeAction(action.dataset.inspectorAction, state.dashboard.selectedUid);
      }
    });

    elements.lessonInspector.addEventListener('focusin', (event) => {
      const target = event.target.closest('[data-lesson-field]');
      if (!target || target.readOnly || target.disabled) return;
      beginEdit('lesson');
      if (['left', 'right'].includes(target.dataset.lessonField)) {
        state.lesson.formulaField = target.dataset.lessonField;
      }
    });
    elements.lessonInspector.addEventListener('input', handleLessonInspectorInput);
    elements.lessonInspector.addEventListener('change', (event) => {
      handleLessonInspectorInput(event);
      finishEdit();
      if (
        ['type', 'mode', 'arrow', 'variant', 'repositoryId', 'promptFile', 'examId', 'presentationId', 'quizId', 'protection', 'requirement', 'options', 'optionItem', 'gapLabel', 'gapSegment', 'useColor', 'conditionType', 'slideLayout', 'slideBackground', 'questionId', 'aiEnabled', 'multiline']
          .includes(event.target.dataset.lessonField)
      ) {
        renderLessonInspector();
      }
    });
    elements.lessonInspector.addEventListener('focusout', (event) => {
      if (event.target.closest('[data-lesson-field]')) finishEdit();
    });
    elements.lessonInspector.addEventListener('click', (event) => {
      const mediaManager = event.target.closest('[data-lesson-media-manager]');
      if (mediaManager) {
        openLessonImageManager();
        return;
      }
      const mediaClear = event.target.closest('[data-lesson-media-clear]');
      if (mediaClear) {
        clearLessonImageReference();
        return;
      }
      const formulaPreset = event.target.closest('[data-formula-preset]');
      if (formulaPreset) {
        applyLessonFormulaPreset(formulaPreset);
        return;
      }
      const formulaArrow = event.target.closest('[data-formula-arrow]');
      if (formulaArrow) {
        applyLessonFormulaArrow(formulaArrow);
        return;
      }
      const formulaSnippet = event.target.closest('[data-formula-snippet]');
      if (formulaSnippet) {
        insertLessonFormulaSnippet(formulaSnippet);
        return;
      }
      const inlineNotation = event.target.closest('[data-lesson-inline-snippet], [data-lesson-inline-wrap]');
      if (inlineNotation) {
        insertLessonInlineNotation(inlineNotation);
        return;
      }
      const taskEditorAction = event.target.closest('[data-lesson-task-editor-action]');
      if (taskEditorAction) {
        lessonTaskEditorAction(taskEditorAction);
        return;
      }
      const answerKeyAdd = event.target.closest('[data-answer-key-add]');
      if (answerKeyAdd) {
        addAnswerKeyBlock(answerKeyAdd.dataset.answerKeyAdd);
        return;
      }
      const action = event.target.closest('[data-lesson-inspector-action]');
      if (action && state.lesson.selectedId) {
        lessonNodeAction(action.dataset.lessonInspectorAction, state.lesson.selectedId);
      }
    });

    all('[data-dashboard-panel]').forEach((button) => {
      button.addEventListener('click', () => activateInspectorPanel('dashboard', button.dataset.dashboardPanel));
    });
    all('[data-lesson-panel]').forEach((button) => {
      button.addEventListener('click', () => activateInspectorPanel('lesson', button.dataset.lessonPanel));
    });
    [elements.dashboardPreview, elements.lessonPreview].forEach((preview) => {
      preview.addEventListener('click', (event) => {
        const button = event.target.closest('[data-full-preview]');
        if (button) openFullPreview(button.dataset.fullPreview);
      });
    });

    elements.dashboardLoad.addEventListener('click', loadActiveDashboard);
    elements.dashboardPublish.addEventListener('click', prepareDashboardPublish);
    elements.dashboardSource.addEventListener('click', () => openSourceDialog('dashboard'));
    elements.dashboardImport.addEventListener('click', () => elements.dashboardFile.click());
    elements.dashboardFile.addEventListener('change', () => {
      const file = elements.dashboardFile.files && elements.dashboardFile.files[0];
      importMarkdownFile(file, 'dashboard');
      elements.dashboardFile.value = '';
    });

    elements.lessonAllowSkip.addEventListener('change', () => {
      commitMutation('lesson', () => {
        state.lesson.model.navigation = elements.lessonAllowSkip.checked ? 'free' : 'sequential';
        state.lesson.model.navigationConfigured = true;
      });
    });
    elements.lessonNew.addEventListener('click', createNewLessonDraft);
    elements.lessonSource.addEventListener('click', () => openSourceDialog('lesson'));
    elements.lessonImport.addEventListener('click', () => elements.lessonFile.click());
    elements.lessonFile.addEventListener('change', () => {
      const file = elements.lessonFile.files && elements.lessonFile.files[0];
      importMarkdownFile(file, 'lesson');
      elements.lessonFile.value = '';
    });
    elements.lessonDownload.addEventListener('click', downloadLesson);
    elements.lessonRepositorySave.addEventListener('click', saveLessonToRepository);
    elements.lessonRepositoryDelete.addEventListener('click', () => deleteRepositoryAsset('lesson'));
    elements.lessonCopy.addEventListener('click', async () => {
      try {
        await copyText(lessonModelApi.serializeLesson(state.lesson.model));
        toast('Kod skopiowany', 'Możesz wkleić go bezpośrednio do nowego pliku .md.');
      } catch (error) {
        toast('Nie udało się skopiować', error.message, 'error');
      }
    });
    elements.promptSource.addEventListener('click', () => openSourceDialog('prompt'));
    elements.promptImport.addEventListener('click', () => elements.promptFile.click());
    elements.promptFile.addEventListener('change', () => {
      const file = elements.promptFile.files && elements.promptFile.files[0];
      importMarkdownFile(file, 'prompt');
      elements.promptFile.value = '';
    });
    elements.promptDownload.addEventListener('click', downloadPrompt);
    elements.promptRepositorySave.addEventListener('click', savePromptToRepository);
    elements.promptRepositoryDelete.addEventListener('click', () => deleteRepositoryAsset('prompt'));
    elements.promptCopy.addEventListener('click', async () => {
      try {
        await copyText(promptModelApi.serializePrompt(state.prompt.model));
        toast('Prompt skopiowany', 'Możesz wkleić go do pliku albo innego repozytorium.');
      } catch (error) {
        toast('Nie udało się skopiować', error.message, 'error');
      }
    });

    elements.sourceCopy.addEventListener('click', async () => {
      try {
        await copyText(elements.sourceTextarea.value);
        elements.sourceStatus.textContent = 'Skopiowano do schowka.';
        elements.sourceStatus.className = 'dialog-status';
      } catch (error) {
        elements.sourceStatus.textContent = error.message;
        elements.sourceStatus.className = 'dialog-status is-error';
      }
    });
    elements.sourceApply.addEventListener('click', applySourceDialog);
    elements.publishDialog.addEventListener('close', () => {
      if (elements.publishDialog.returnValue === 'default') publishDashboard();
    });

    window.addEventListener('pagehide', flushDrafts);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushDrafts();
    });
    document.addEventListener('dragend', clearDragClasses);
    document.addEventListener('keydown', (event) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (state.mode === 'dashboard') prepareDashboardPublish();
        else if (state.mode === 'lesson') downloadLesson();
        else if (state.mode === 'prompt') downloadPrompt();
      }
    });
  }

  async function start() {
    if (!dashboardModelApi || !lessonModelApi || !promptModelApi || !window.ChemExamStudioModel || !window.ChemQuizStudioModel || !window.ChemLesson) {
      setAccessState(
        'Studio nie może się uruchomić',
        'Brakuje jednego z lokalnych modułów buildera. Sprawdź pliki wdrożenia.',
        true
      );
      return;
    }
    let authState;
    try {
      authState = window.ChemAuth && window.ChemAuth.ready
        ? await window.ChemAuth.ready
        : null;
    } catch (_) {
      authState = null;
    }
    const user = window.ChemAuth && typeof window.ChemAuth.getUser === 'function'
      ? window.ChemAuth.getUser()
      : null;
    if (!authState || !authState.authenticated || !authState.session?.ok || !user) {
      setAccessState(
        'Sesja nie jest aktywna',
        'Zaloguj się ponownie, aby otworzyć Studio treści.',
        true
      );
      return;
    }
    if (!isAdmin(user)) {
      setAccessState(
        'Studio jest tylko dla administratora',
        'To konto może korzystać z kursu, ale nie może edytować ani publikować jego zawartości.',
        true
      );
      return;
    }
    state.currentUser = user;
    loadDrafts();
    const previewMode = requestedFullPreviewMode();
    if (previewMode) {
      startStandalonePreview(previewMode);
      return;
    }
    loadStudioLayout();
    bindEvents();
    elements.accessState.hidden = true;
    elements.app.hidden = false;
    elements.modeSwitch.hidden = false;
    switchMode(new URL(window.location.href).searchParams.get('mode') || 'home');
    initializeContentExplorerLoader();
    setSaveIndicator('Szkice gotowe', 'saved');
  }

  document.addEventListener('DOMContentLoaded', start);
})();
