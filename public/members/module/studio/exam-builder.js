(function initializeExamBuilder() {
  'use strict';

  const modelApi = window.ChemExamStudioModel;
  const library = window.ChemContentLibrary;
  const pagedListApi = window.ChemStudioPagedList;
  const DRAFT_KEY = 'chemdisk.studio.exam.v1';
  const BANK_KEY = 'chemdisk.studio.question-bank.v1';
  const TYPE_LABELS = {
    single_choice: 'Jedna odpowiedź',
    multiple_choice: 'Wiele odpowiedzi',
    true_false: 'Prawda / fałsz',
    short_text: 'Krótka odpowiedź',
    number: 'Liczba',
    matching: 'Dopasowywanie',
    ordering: 'Ustalanie kolejności',
    fill_blanks: 'Uzupełnianie luk',
    open_answer: 'Pytanie otwarte'
  };
  const TAB_LABELS = {
    information: 'Informacje', questions: 'Pytania', bank: 'Bank pytań', display: 'Wyświetlanie',
    navigation: 'Nawigacja', time: 'Czas', randomization: 'Losowanie', scoring: 'Punktacja',
    attempts: 'Próby', access: 'Dostęp', security: 'Bezpieczeństwo', results: 'Wyniki', review: 'Sprawdzanie', reports: 'Raporty'
  };
  const byId = (id) => document.getElementById(id);
  const elements = {};
  const state = {
    initialized: false,
    loaded: false,
    activationPromise: null,
    tab: 'information',
    exam: null,
    bank: null,
    selectedQuestionId: '',
    selectedBankQuestionId: '',
    repositories: [],
    repositoryId: '',
    assets: [],
    remoteSha: '',
    remoteExamId: '',
    bankSha: '',
    bankDirty: false,
    saving: false,
    report: null,
    reportLoading: false,
    aiGrading: false,
    attemptReport: null,
    reviewQueue: null,
    reviewLoading: false,
    reviewQuery: '',
    reviewFilter: 'pending',
    reviewUser: null,
    attemptLoading: false,
    attemptRequest: 0,
    gradeDrafts: new Map(),
    gradingBusy: false,
    users: [],
    usersPage: 0,
    usersHasMore: true,
    usersTotal: null,
    usersLoading: false,
    usersLoadAllRequested: false,
    usersPromise: null,
    usersError: '',
    userQuery: '',
    userSearchTimer: 0,
    libraryPaging: pagedListApi?.createState(),
    mediaUploading: false,
    mediaTarget: 'question',
    mediaObjectUrls: []
  };

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function readDraft(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
    catch { return fallback; }
  }

  function saveDrafts() {
    if (!state.exam || !state.bank) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state.exam));
      localStorage.setItem(BANK_KEY, JSON.stringify(state.bank));
    } catch (_) {}
  }

  function field(label, control, hint) {
    const wrapper = create('label', 'exam-field');
    wrapper.append(create('span', '', label), control);
    if (hint) wrapper.append(create('small', '', hint));
    return wrapper;
  }

  function input(path, value, options = {}) {
    const control = document.createElement('input');
    control.type = options.type || 'text';
    control.value = value == null ? '' : String(value);
    control.dataset.examPath = path;
    if (options.placeholder) control.placeholder = options.placeholder;
    if (options.min != null) control.min = String(options.min);
    if (options.max != null) control.max = String(options.max);
    if (options.step != null) control.step = String(options.step);
    if (options.maxLength) control.maxLength = options.maxLength;
    return control;
  }

  function checkbox(path, checked, label) {
    const wrapper = create('label', 'exam-toggle');
    const control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = Boolean(checked);
    control.dataset.examPath = path;
    wrapper.append(control, create('span', '', label));
    return wrapper;
  }

  function textarea(path, value, options = {}) {
    const control = document.createElement('textarea');
    control.value = value == null ? '' : String(value);
    control.dataset.examPath = path;
    control.rows = options.rows || 5;
    if (options.placeholder) control.placeholder = options.placeholder;
    if (options.maxLength) control.maxLength = options.maxLength;
    return control;
  }

  function select(path, value, options) {
    const control = document.createElement('select');
    control.dataset.examPath = path;
    options.forEach((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      control.append(node);
    });
    control.value = value;
    return control;
  }

  function row(...children) {
    const wrapper = create('div', 'exam-field-row');
    wrapper.append(...children);
    return wrapper;
  }

  function section(title, description) {
    const node = create('section', 'exam-form-section');
    const header = create('header');
    header.append(create('h3', '', title));
    if (description) header.append(create('p', '', description));
    node.append(header);
    return node;
  }

  function initialize() {
    if (state.initialized || !modelApi || !library || !pagedListApi || !byId('exam-workspace')) return;
    state.initialized = true;
    Object.assign(elements, {
      workspace: byId('exam-workspace'), repository: byId('exam-repository-select'), search: byId('exam-library-search'),
      library: byId('exam-library'), libraryStatus: byId('exam-library-status'), tabs: byId('exam-tab-list'), editor: byId('exam-editor'),
      editorTitle: byId('exam-editor-title'), badge: byId('exam-status-badge'), validation: byId('exam-validation'),
      summary: byId('exam-summary'), status: byId('exam-builder-status'), newExam: byId('exam-new-button'),
      preview: byId('exam-preview-button'), remove: byId('exam-delete-button'), saveDraft: byId('exam-save-draft-button'),
      publish: byId('exam-publish-button')
    });
    state.exam = modelApi.createExam(readDraft(DRAFT_KEY, null));
    state.bank = modelApi.createQuestionBank(readDraft(BANK_KEY, null));
    state.selectedQuestionId = state.exam.questions[0]?.questionId || '';
    bind();
    render();
  }

  function bind() {
    elements.tabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-exam-tab]');
      if (!button) return;
      state.tab = button.dataset.examTab;
      render();
      if (state.tab === 'reports' && !state.report) void loadReport();
      if (state.tab === 'review' && !state.reviewQueue) void loadReviewQueue();
      if (state.tab === 'access') void loadIdentityUsers(false);
    });
    elements.editor.addEventListener('input', handleInput);
    elements.editor.addEventListener('change', handleInput);
    elements.editor.addEventListener('change', handleMediaControl);
    elements.editor.addEventListener('click', handleAction);
    elements.editor.addEventListener('dragover', handleMediaDragOver);
    elements.editor.addEventListener('dragleave', handleMediaDragLeave);
    elements.editor.addEventListener('drop', handleMediaDrop);
    elements.editor.addEventListener('paste', handleMediaPaste);
    elements.editor.addEventListener('keydown', handleEditorKeydown);
    elements.repository.addEventListener('change', async () => {
      state.repositoryId = elements.repository.value;
      clearReviewSelection();
      state.remoteSha = '';
      state.remoteExamId = '';
      state.bankSha = '';
      pagedListApi.reset(state.libraryPaging);
      await loadAssets(true);
    });
    elements.search.addEventListener('input', () => {
      pagedListApi.reset(state.libraryPaging);
      renderLibrary();
    });
    elements.library.addEventListener('click', (event) => {
      const button = event.target.closest('[data-exam-asset]');
      if (button) void loadExam(button.dataset.examAsset);
    });
    elements.newExam.addEventListener('click', newExam);
    elements.saveDraft.addEventListener('click', () => saveExam('draft'));
    elements.publish.addEventListener('click', () => saveExam('published'));
    elements.preview.addEventListener('click', previewExam);
    elements.remove.addEventListener('click', deleteExam);
    window.addEventListener('pagehide', saveDrafts);
    window.addEventListener('beforeunload', (event) => {
      if (!state.gradeDrafts.size) return;
      event.preventDefault(); event.returnValue = '';
    });
  }

  async function activate() {
    initialize();
    if (state.loaded) return true;
    if (state.activationPromise) return state.activationPromise;
    state.activationPromise = (async () => {
      elements.status.textContent = 'Pobieranie egzaminów i banku pytań…';
      try {
        state.repositories = await library.repositories();
        const preferred = state.repositories.find((repository) => repository.default) || state.repositories[0];
        state.repositoryId = state.repositoryId || preferred?.id || '';
        renderRepositorySelector();
        await loadAssets(false);
        state.loaded = true;
        return true;
      } catch (error) {
        elements.libraryStatus.textContent = error.message || 'Nie udało się pobrać biblioteki egzaminów.';
        elements.libraryStatus.classList.add('is-error');
        elements.status.textContent = error.message || 'Nie udało się pobrać biblioteki egzaminów.';
        elements.status.classList.add('is-error');
        return false;
      } finally {
        state.activationPromise = null;
      }
    })();
    return state.activationPromise;
  }

  function renderRepositorySelector() {
    elements.repository.replaceChildren(...state.repositories.map((repository) => {
      const option = document.createElement('option');
      option.value = repository.id;
      option.textContent = repository.label || repository.repository;
      return option;
    }));
    elements.repository.value = state.repositoryId;
    elements.repository.disabled = state.repositories.length < 2;
  }

  async function loadAssets(force, options = {}) {
    elements.status.className = 'exam-builder-status';
    elements.status.textContent = 'Pobieranie biblioteki egzaminów…';
    elements.libraryStatus.classList.remove('is-error');
    elements.libraryStatus.textContent = 'Pobieranie biblioteki egzaminów…';
    try {
      state.assets = await library.list('exam', { repositoryId: state.repositoryId, refresh: force });
      if (!options.keepBank) {
        try {
          const bank = await library.readQuestionBank({ repositoryId: state.repositoryId });
          state.bank = modelApi.createQuestionBank(JSON.parse(bank.content));
          state.bankSha = bank.sha || '';
          state.bankDirty = false;
        } catch (error) {
          if (error.status !== 404) throw error;
          state.bank = modelApi.createQuestionBank(readDraft(BANK_KEY, null));
          state.bankSha = '';
        }
      }
      elements.status.textContent = `${state.assets.length} egzaminów · ${state.bank.questions.length} pytań w banku.`;
      renderLibrary();
      render();
    } catch (error) {
      elements.libraryStatus.textContent = error.message || 'Nie udało się pobrać egzaminów.';
      elements.libraryStatus.classList.add('is-error');
      elements.status.textContent = error.message || 'Nie udało się pobrać egzaminów.';
      elements.status.classList.add('is-error');
    }
  }

  function renderLibrary() {
    const query = String(elements.search.value || '').trim().toLocaleLowerCase('pl');
    const assets = state.assets.filter((asset) => !query || `${asset.title} ${asset.filename} ${asset.tags?.join(' ')}`.toLocaleLowerCase('pl').includes(query));
    const paged = pagedListApi.page(state.libraryPaging, 'exam-library', assets);
    elements.library.replaceChildren(...paged.items.map((asset) => {
      const button = create('button', 'repository-asset');
      button.type = 'button';
      button.dataset.examAsset = asset.filename;
      button.classList.toggle('is-active', asset.filename === state.exam.examId && Boolean(state.remoteSha));
      const copy = create('span');
      copy.append(create('strong', '', asset.title || asset.filename), create('small', '', asset.filename));
      button.append(
        create('span', 'repository-asset-kind', 'EXAM'),
        copy,
        create('span', 'repository-asset-action', 'Otwórz')
      );
      return button;
    }));
    if (!assets.length) {
      elements.libraryStatus.textContent = query ? 'Brak egzaminów pasujących do wyszukiwania.' : 'Brak egzaminów w tej bibliotece.';
    } else {
      elements.libraryStatus.textContent = `${assets.length} pasujących egzaminów.`;
      elements.library.append(pagedListApi.controls(document, state.libraryPaging, paged, {
        label: 'egzaminów',
        onMore: renderLibrary
      }));
    }
  }

  async function loadExam(examId, options = {}) {
    if (options.confirm !== false && !window.confirm('Otworzyć zapisany egzamin i zastąpić bieżący szkic na tym urządzeniu? Zapisz szkic najpierw, jeśli chcesz zachować zmiany.')) return;
    elements.status.textContent = `Pobieranie ${examId}…`;
    try {
      const result = await library.readExam(examId, { repositoryId: state.repositoryId });
      state.exam = modelApi.createExam(JSON.parse(result.content));
      clearReviewSelection();
      state.remoteSha = result.sha || '';
      state.remoteExamId = state.exam.examId;
      state.selectedQuestionId = state.exam.questions[0]?.questionId || '';
      state.tab = 'information';
      state.report = null;
      state.attemptReport = null;
      saveDrafts();
      render();
      renderLibrary();
      elements.status.textContent = `Wczytano ${examId}.`;
    } catch (error) {
      elements.status.textContent = error.message || 'Nie udało się wczytać egzaminu.';
      if (options.propagate) throw error;
    }
  }

  async function openAsset(asset) {
    if (!asset?.filename) return;
    if (!await activate()) throw new Error('Nie udało się wczytać biblioteki egzaminów.');
    const repositoryId = asset.repositoryId || state.repositoryId;
    if (repositoryId && repositoryId !== state.repositoryId) {
      if (!state.repositories.some((repository) => repository.id === repositoryId)) {
        throw new Error('Repozytorium tego egzaminu nie jest już dostępne.');
      }
      state.repositoryId = repositoryId;
      state.remoteSha = '';
      state.remoteExamId = '';
      state.bankSha = '';
      renderRepositorySelector();
      await loadAssets(false);
    }
    await loadExam(asset.filename, { confirm: false, propagate: true });
  }

  function newExam() {
    if (!window.confirm('Utworzyć nowy egzamin? Bieżący szkic na tym urządzeniu zostanie zastąpiony. Zapisz go najpierw, jeśli chcesz zachować zmiany.')) return;
    state.exam = modelApi.createExam();
    clearReviewSelection();
    state.remoteSha = '';
    state.remoteExamId = '';
    state.selectedQuestionId = state.exam.questions[0]?.questionId || '';
    state.report = null;
    state.attemptReport = null;
    state.tab = 'information';
    saveDrafts();
    render();
    renderLibrary();
  }

  function render() {
    if (!state.exam || !elements.editor) return;
    elements.editor.closest('.exam-workspace')?.classList.toggle('is-reviewing', state.tab === 'review');
    // Keep save/error messages reachable when review hides the definition summary.
    const statusHost = state.tab === 'review' ? elements.editor.parentElement : elements.summary.closest('.exam-summary-panel');
    if (statusHost && elements.status.parentElement !== statusHost) statusHost.append(elements.status);
    byId('exam-editor-eyebrow').textContent = state.tab === 'review' ? 'Odpowiedzi uczestników' : 'Definicja egzaminu';
    state.mediaObjectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    elements.tabs.querySelectorAll('[data-exam-tab]').forEach((button) => {
      const active = button.dataset.examTab === state.tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    elements.editorTitle.textContent = TAB_LABELS[state.tab] || 'Edytor egzaminów';
    elements.badge.textContent = state.remoteSha
      ? state.exam.status === 'published' ? 'Opublikowany' : 'Zapisany szkic'
      : 'Szkic na tym urządzeniu';
    elements.badge.dataset.status = state.exam.status;
    window.NextMedUI?.releaseWithin(elements.editor);
    elements.editor.replaceChildren();
    const renderer = {
      information: renderInformation, questions: renderQuestions, bank: renderBank, display: renderDisplay,
      navigation: renderNavigation, time: renderTime, randomization: renderRandomization, scoring: renderScoring,
      attempts: renderAttempts, access: renderAccess, security: renderSecurity, results: renderResults, review: renderReview, reports: renderReports
    }[state.tab] || renderInformation;
    renderer();
    renderSummary();
    elements.remove.disabled = !state.remoteSha || state.saving;
    elements.saveDraft.disabled = state.saving;
    elements.publish.disabled = state.saving;
  }

  function questionMediaTargets(question) {
    const targets = [{ value: 'question', label: 'Treść pytania' }];
    (question.options || []).forEach((option, index) => targets.push({
      value: `answer:${option.answerId}`,
      label: `Odpowiedź ${index + 1}: ${option.text || option.answerId}`
    }));
    (question.pairs || []).forEach((pair, index) => {
      targets.push({ value: `pair-left:${pair.pairId}`, label: `Dopasowanie ${index + 1} — lewa strona` });
      targets.push({ value: `pair-right:${pair.pairId}`, label: `Dopasowanie ${index + 1} — prawa strona` });
    });
    (question.items || []).forEach((item, index) => targets.push({
      value: `item:${item.itemId}`,
      label: `Kolejność ${index + 1}: ${item.text || item.itemId}`
    }));
    return targets;
  }

  function imagesForTarget(question, target) {
    if (!question) return [];
    if (target === 'question') return question.images;
    const separator = target.indexOf(':');
    const type = separator < 0 ? '' : target.slice(0, separator);
    const id = separator < 0 ? '' : target.slice(separator + 1);
    if (type === 'answer') return question.options?.find((option) => option.answerId === id)?.images || null;
    if (type === 'item') return question.items?.find((item) => item.itemId === id)?.images || null;
    const pair = question.pairs?.find((item) => item.pairId === id);
    if (type === 'pair-left') return pair?.leftImages || null;
    if (type === 'pair-right') return pair?.rightImages || null;
    return null;
  }

  function mediaPanel(scope, question = null) {
    const panel = create('div', 'exam-media-panel');
    panel.dataset.examMediaScope = scope;
    if (question) panel.dataset.questionId = question.questionId;
    const targets = scope === 'cover'
      ? [{ value: 'cover', label: 'Okładka egzaminu' }]
      : questionMediaTargets(question);
    if (!targets.some((target) => target.value === state.mediaTarget)) state.mediaTarget = targets[0].value;
    const heading = create('div', 'exam-media-heading');
    const headingCopy = create('div');
    headingCopy.append(
      create('strong', '', scope === 'cover' ? 'Obraz okładki' : 'Obrazy pytania i odpowiedzi'),
      create('small', '', 'PNG, JPG, WEBP, GIF lub bezpieczny SVG · maksymalnie 4 MB')
    );
    const libraryButton = create('button', 'mini-button', 'Media Manager');
    libraryButton.type = 'button';
    libraryButton.dataset.examAction = 'open-media-manager';
    heading.append(headingCopy, libraryButton);
    if (targets.length > 1) {
      const target = document.createElement('select');
      target.dataset.examMediaTarget = '1';
      targets.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.value; option.textContent = entry.label; target.append(option);
      });
      target.value = state.mediaTarget;
      heading.append(target);
    }
    const inputNode = document.createElement('input');
    inputNode.type = 'file';
    inputNode.accept = 'image/png,image/jpeg,image/webp,image/gif';
    inputNode.hidden = true;
    inputNode.dataset.examMediaInput = '1';
    inputNode.multiple = scope !== 'cover';
    const dropzone = create('div', 'exam-media-dropzone');
    dropzone.tabIndex = 0;
    dropzone.setAttribute('role', 'button');
    dropzone.dataset.examAction = 'choose-media';
    dropzone.append(
      create('span', 'exam-media-drop-icon', '⇧'),
      create('strong', '', state.mediaUploading ? 'Wysyłanie obrazu…' : 'Przeciągnij obraz tutaj'),
      create('small', '', 'albo kliknij i wybierz plik · możesz też wkleić przez Ctrl/Cmd+V')
    );
    dropzone.setAttribute('aria-disabled', String(state.mediaUploading));
    const list = create('div', 'exam-media-list');
    const entries = scope === 'cover'
      ? (state.exam.metadata.cover?.ref ? [{ target: 'cover', label: 'Okładka', image: state.exam.metadata.cover }] : [])
      : targets.flatMap((target) => (imagesForTarget(question, target.value) || []).map((image) => ({ ...target, target: target.value, image })));
    entries.forEach((entry) => {
      const item = create('div', 'exam-media-item');
      const preview = document.createElement('img');
      preview.alt = ''; preview.hidden = true;
      preview.setAttribute('aria-hidden', 'true');
      if (state.remoteSha) void loadMediaThumbnail(preview, entry.image.ref);
      const copy = create('div', 'exam-media-copy');
      copy.append(create('small', '', entry.label), create('code', '', entry.image.ref));
      const alt = document.createElement('input');
      alt.type = 'text'; alt.value = entry.image.alt || ''; alt.placeholder = 'Opis ALT';
      alt.dataset.examMediaAlt = '1'; alt.dataset.mediaTarget = entry.target; alt.dataset.mediaRef = entry.image.ref;
      copy.append(alt);
      const remove = create('button', 'mini-button is-danger', scope === 'cover' ? 'Usuń okładkę' : 'Usuń z pytania');
      remove.type = 'button'; remove.dataset.examAction = 'remove-media-reference';
      remove.dataset.mediaTarget = entry.target; remove.dataset.mediaRef = entry.image.ref;
      item.append(preview, copy, remove); list.append(item);
    });
    if (!entries.length) list.append(create('p', 'exam-media-empty', 'Nie dodano jeszcze obrazu.'));
    panel.append(heading, inputNode, dropzone, list, create('p', 'exam-media-note', 'Usunięcie obrazu z pytania nie usuwa pliku. Plikami zarządzisz w bibliotece obrazów.'));
    return panel;
  }

  function openExamMediaManager(panel) {
    if (!panel || !window.ChemMediaManager?.open) {
      elements.status.className = 'exam-builder-status is-error';
      elements.status.textContent = 'Media Manager jest chwilowo niedostępny.';
      return;
    }
    const target = panel.dataset.examMediaScope === 'cover'
      ? 'cover'
      : panel.querySelector('[data-exam-media-target]')?.value || state.mediaTarget || 'question';
    const canUseLocal = Boolean(state.remoteSha && state.remoteExamId === state.exam.examId);
    void window.ChemMediaManager.open({
      scope: canUseLocal ? 'local' : 'shared',
      materialKind: canUseLocal ? 'exam' : '',
      materialId: canUseLocal ? state.exam.examId : '',
      repositoryId: state.repositoryId,
      onSelect(asset) {
        const image = {
          ref: asset.reference,
          alt: String(asset.filename || 'Ilustracja').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 300)
        };
        if (panel.dataset.examMediaScope === 'cover') state.exam.metadata.cover = image;
        else {
          const images = imagesForTarget(mediaQuestion(panel), target) || imagesForTarget(mediaQuestion(panel), 'question');
          if (images && !images.some((entry) => entry.ref === image.ref)) images.push(image);
        }
        saveDrafts();
        render();
        elements.badge.textContent = 'Niezapisane zmiany';
      }
    });
  }

  async function loadMediaThumbnail(image, ref) {
    try {
      let blob;
      if (window.ChemContentLibrary?.readMediaBlob) {
        const shared = String(ref || '').startsWith('assets/shared/');
        blob = await window.ChemContentLibrary.readMediaBlob({
          scope: shared ? 'shared' : 'local',
          materialKind: shared ? '' : 'exam',
          materialId: shared ? '' : state.exam.examId,
          reference: ref,
          repositoryId: state.repositoryId
        });
      } else {
        const token = await window.ChemAuth.getAccessToken();
        const url = new URL('/.netlify/functions/exam', window.location.origin);
        url.search = new URLSearchParams({ action: 'image', repo: state.repositoryId, exam: state.exam.examId, ref, preview: '1' });
        const response = await fetch(url, { credentials: 'same-origin', cache: 'default', headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return;
        blob = await response.blob();
      }
      const objectUrl = URL.createObjectURL(blob);
      if (!image.isConnected) { URL.revokeObjectURL(objectUrl); return; }
      state.mediaObjectUrls.push(objectUrl);
      image.src = objectUrl; image.hidden = false;
    } catch (_) {}
  }

  function renderInformation() {
    const main = section('Definicja egzaminu', 'Identyfikator tworzy stały adres egzaminu. Nie zmieniaj go po udostępnieniu uczestnikom.');
    main.append(
      row(
        field('ID egzaminu', input('examId', state.exam.examId, { placeholder: 'np. alkohole-proba-1', maxLength: 80 }), 'Małe litery, cyfry i myślniki.'),
        field('Nazwa', input('metadata.name', state.exam.metadata.name, { maxLength: 180 }))
      ),
      field('Opis', textarea('metadata.description', state.exam.metadata.description, { rows: 4 })),
      field('Instrukcja dla ucznia', textarea('metadata.instruction', state.exam.metadata.instruction, { rows: 7 })),
      row(
        field('Próg zaliczenia (%)', input('metadata.passThreshold', state.exam.metadata.passThreshold, { type: 'number', min: 0, max: 100, step: .1 })),
        field('Kategorie', input('metadata.categories', state.exam.metadata.categories.join(', '), { placeholder: 'organiczna, powtórka' }))
      ),
      field('Tagi', input('metadata.tags', state.exam.metadata.tags.join(', '), { placeholder: 'matura, dział 3' }))
    );
    const messages = section('Komunikaty', 'Widoczne przed startem i po bezpiecznym zapisaniu wyniku.');
    messages.append(
      field('Przed rozpoczęciem', textarea('metadata.beforeStartMessage', state.exam.metadata.beforeStartMessage, { rows: 4 })),
      field('Po zakończeniu', textarea('metadata.afterFinishMessage', state.exam.metadata.afterFinishMessage, { rows: 4 })),
      mediaPanel('cover'),
      field('ALT okładki', input('metadata.cover.alt', state.exam.metadata.cover?.alt || '', { placeholder: 'Opis okładki' }))
    );
    elements.editor.append(main, messages);
  }

  function renderQuestions() {
    const header = section('Pytania egzaminu', 'Dodawaj własne pytania lub korzystaj z banku. Zmiana pytania w banku może wpłynąć także na inne egzaminy, które go używają.');
    const actions = create('div', 'exam-inline-actions');
    const add = create('button', 'button button-primary', '＋ Dodaj pytanie');
    add.type = 'button'; add.dataset.examAction = 'add-question';

    const templateSelect = document.createElement('select');
    templateSelect.className = 'exam-quick-template-select';
    templateSelect.setAttribute('aria-label', 'Szybki szablon pytania');
    const defaultOpt = document.createElement('option');
    defaultOpt.value = ''; defaultOpt.textContent = '＋ Wybierz szablon…';
    templateSelect.append(defaultOpt);
    Object.entries(TYPE_LABELS).forEach(([val, lbl]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = lbl;
      templateSelect.append(opt);
    });
    templateSelect.addEventListener('change', () => {
      if (templateSelect.value) {
        addTypedQuestion(templateSelect.value);
        templateSelect.value = '';
      }
    });

    const bankBtn = create('button', 'button button-soft', '📚 Bank pytań');
    bankBtn.type = 'button';
    bankBtn.title = 'Przejdź do repozytorium banku pytań';
    bankBtn.addEventListener('click', () => {
      state.tab = 'bank';
      elements.tabs?.querySelectorAll('[data-exam-tab]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.examTab === 'bank');
      });
      render();
    });

    const liveBtn = create('button', 'button button-soft exam-live-preview-btn', '▶ Graj / Podgląd');
    liveBtn.type = 'button';
    liveBtn.title = 'Uruchom symulator egzaminu (skrót do podglądu)';
    liveBtn.dataset.examAction = 'live-preview';
    liveBtn.addEventListener('click', livePreviewQuestion);

    actions.append(add, templateSelect, bankBtn, liveBtn, create('span', 'exam-count-copy', `${state.exam.questions.length} własnych · ${state.exam.questionRefs.length} z banku`));
    header.append(actions);
    const list = create('div', 'exam-question-list exam-filmstrip');
    const reactList = window.NextMedUI?.render('studio-exam-list', list, {
      questions: [...state.exam.questions.map((question) => ({ question })), ...state.exam.questionRefs.map((questionId) => ({
        question: state.bank.questions.find((candidate) => candidate.questionId === questionId) || { questionId, type: 'single_choice', prompt: 'Brak pytania w banku' }, reference: true
      }))], selected: [state.selectedQuestionId, state.selectedBankQuestionId], labels: TYPE_LABELS
    });
    if (!reactList) {
      state.exam.questions.forEach((question, index) => list.append(questionCard(question, index, false)));
      state.exam.questionRefs.forEach((questionId, index) => {
        const question = state.bank.questions.find((candidate) => candidate.questionId === questionId);
        const card = questionCard(question || { questionId, type: 'single_choice', prompt: 'Brak pytania w banku' }, state.exam.questions.length + index, true);
        list.append(card);
      });
    }
    elements.editor.append(header, list);
    const selected = state.exam.questions.find((question) => question.questionId === state.selectedQuestionId);
    if (selected) elements.editor.append(renderQuestionEditor(selected, 'exam'));
  }

  function questionCard(question, index, bankReference) {
    const card = create('article', 'exam-question-card');
    card.dataset.questionId = question.questionId;
    card.dataset.questionIndex = String(index);
    card.classList.toggle('is-selected', question.questionId === state.selectedQuestionId || question.questionId === state.selectedBankQuestionId);
    if (!bankReference) {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', handleQuestionDragStart);
      card.addEventListener('dragover', handleQuestionDragOver);
      card.addEventListener('dragleave', handleQuestionDragLeave);
      card.addEventListener('drop', handleQuestionDrop);
      card.addEventListener('dragend', handleQuestionDragEnd);
    }
    const copy = create('button', 'exam-question-select');
    copy.type = 'button';
    copy.dataset.examAction = bankReference ? 'select-bank-reference' : 'select-question';
    copy.dataset.questionId = question.questionId;

    let timeLabel = 'Bez limitu';
    if (question.timeLimitSeconds) timeLabel = `${question.timeLimitSeconds}s`;
    else if (state.exam?.timing?.mode === 'question') timeLabel = `${state.exam.timing.questionLimitSeconds || 60}s`;
    else if (state.exam?.timing?.mode === 'exam') timeLabel = 'Egzamin';

    copy.append(
      create('small', '', `${index + 1}. ${TYPE_LABELS[question.type] || question.type}${bankReference ? ' · bank' : ''} · ${question.points != null ? question.points : 1} pkt · ⏱ ${timeLabel}`),
      create('strong', '', question.prompt || question.template || question.questionId)
    );
    const actions = create('span', 'exam-question-actions');
    if (!bankReference) {
      for (const [action, label] of [['duplicate-question', 'Duplikuj'], ['delete-question', 'Usuń']]) {
        const button = create('button', action.includes('delete') ? 'mini-button is-danger' : 'mini-button', label);
        button.type = 'button'; button.dataset.examAction = action; button.dataset.questionId = question.questionId;
        if (action === 'duplicate-question') button.title = 'Powiel pytanie (Ctrl+D)';
        actions.append(button);
      }
    } else {
      const button = create('button', 'mini-button is-danger', 'Usuń odwołanie');
      button.type = 'button'; button.dataset.examAction = 'remove-bank-reference'; button.dataset.questionId = question.questionId;
      actions.append(button);
    }
    card.append(copy, actions);
    return card;
  }

  function renderQuestionEditor(question, scope) {
    const editor = section('Konfigurator pytania', 'Wpisz treść, wybierz sposób odpowiedzi i ustaw punktację. Identyfikatory są obsługiwane automatycznie.');
    editor.classList.add('exam-question-editor');
    editor.dataset.questionScope = scope;
    editor.dataset.questionId = question.questionId;

    const layout = create('div', 'exam-question-layout');
    const canvasArea = create('div', 'exam-question-canvas-area');
    const inspectorArea = create('div', 'exam-question-inspector-area');

    // Canvas top bar
    const topBar = create('div', 'exam-canvas-top-bar');
    const typeField = field('Typ pytania', select('@type', question.type, Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))));
    const liveBtn = create('button', 'mini-button button-soft exam-card-preview-btn', '▶ Podgląd na żywo');
    liveBtn.type = 'button';
    liveBtn.dataset.examAction = 'live-preview';
    liveBtn.addEventListener('click', livePreviewQuestion);

    const dupBtn = create('button', 'mini-button', 'Powiel (Ctrl+D)');
    dupBtn.type = 'button';
    dupBtn.dataset.examAction = scope === 'bank' ? 'duplicate-bank-question' : 'duplicate-question';
    dupBtn.dataset.questionId = question.questionId;

    topBar.append(typeField, liveBtn, dupBtn);
    canvasArea.append(topBar);

    // WYSIWYG Prompt Editor
    canvasArea.append(
      window.ChemAssessmentEditor.create(question.prompt, question.promptFormat, (prompt, format) => {
        question.prompt = prompt; question.promptFormat = format;
        if (scope === 'bank') state.bankDirty = true;
        saveDrafts(); renderSummary(); elements.badge.textContent = 'Niezapisane zmiany';
      })
    );

    // Source text / passage for split screen
    const sourceDetails = create('details', 'exam-source-details');
    if (question.sourceText) sourceDetails.open = true;
    const sourceSummary = create('summary', '', '📖 Tekst źródłowy / Wprowadzenie CKE (Split-Screen)');
    const sourceTextarea = textarea('@sourceText', question.sourceText || '', { rows: 3, placeholder: 'Wpisz tekst wprowadzający do zadania lub opis doświadczenia (np. Do zadań 12-14: W probówkach I i II przeprowadzono...)' });
    sourceDetails.append(sourceSummary, field('', sourceTextarea, 'Wpisanie tekstu źródłowego automatycznie uruchamia widok Split-Screen (stały tekst po lewej, pytania po prawej).'));
    canvasArea.append(sourceDetails);

    // Media Dropzone
    if (scope === 'exam') {
      canvasArea.append(mediaPanel('question', question));
    } else {
      canvasArea.append(field('Obrazy', textarea('@images', imagesToText(question.images), { rows: 3, placeholder: 'photos/schemat.png | Opis ALT' }), 'Jedna stabilna referencja i ALT w wierszu.'));
    }

    // Answers Fields (Large Cards with 1-click Checkmark)
    canvasArea.append(...questionTypeFields(question, scope));

    // Explanation
    canvasArea.append(field('Wyjaśnienie po wyniku', textarea('@explanation', question.explanation, { rows: 3 })));

    // --- Right Inspector Area ---
    inspectorArea.append(create('h4', 'exam-inspector-heading', 'Parametry zadania'));

    // 1. Time limit presets
    const timeBox = create('div', 'exam-inspector-box');
    timeBox.append(create('strong', '', '⏱ Limit czasu na pytanie'));
    const timePills = create('div', 'exam-preset-pills');
    const currentTime = question.timeLimitSeconds != null ? question.timeLimitSeconds : (state.exam?.timing?.questionLimitSeconds || 0);
    [
      { label: '10s', sec: 10 },
      { label: '20s', sec: 20 },
      { label: '30s', sec: 30 },
      { label: '60s', sec: 60 },
      { label: '90s', sec: 90 },
      { label: '120s', sec: 120 },
      { label: '240s', sec: 240 },
      { label: 'Bez limitu', sec: 0 }
    ].forEach((preset) => {
      const pill = create('button', 'exam-preset-pill', preset.label);
      pill.type = 'button';
      pill.classList.toggle('is-active', currentTime === preset.sec);
      pill.addEventListener('click', () => {
        question.timeLimitSeconds = preset.sec;
        if (state.exam?.timing && preset.sec > 0) {
          state.exam.timing.questionLimitSeconds = preset.sec;
        }
        if (scope === 'bank') state.bankDirty = true;
        saveDrafts(); renderSummary(); elements.badge.textContent = 'Niezapisane zmiany';
        render();
      });
      timePills.append(pill);
    });
    timeBox.append(timePills);
    inspectorArea.append(timeBox);

    // 2. Points presets & inputs
    const pointsBox = create('div', 'exam-inspector-box');
    pointsBox.append(create('strong', '', '🏆 Punktacja'));
    const pointsPills = create('div', 'exam-preset-pills');
    [
      { label: '1 pkt', pts: 1 },
      { label: '2 pkt', pts: 2 },
      { label: '3 pkt', pts: 3 },
      { label: '0 pkt (Trening)', pts: 0 },
      { label: 'CKE (5 pkt)', pts: 5 }
    ].forEach((preset) => {
      const pill = create('button', 'exam-preset-pill', preset.label);
      pill.type = 'button';
      pill.classList.toggle('is-active', Number(question.points) === preset.pts);
      pill.addEventListener('click', () => {
        question.points = preset.pts;
        if (scope === 'bank') state.bankDirty = true;
        saveDrafts(); renderSummary(); elements.badge.textContent = 'Niezapisane zmiany';
        render();
      });
      pointsPills.append(pill);
    });
    pointsBox.append(
      pointsPills,
      row(
        field('Punkty', input('@points', question.points, { type: 'number', min: 0, max: 10000, step: .1 })),
        field('Punkty ujemne', input('@negativePoints', question.negativePoints, { type: 'number', min: 0, max: 10000, step: .1 }))
      )
    );
    inspectorArea.append(pointsBox);

    // 3. Choice mode switch (Single vs Multiple)
    if (['single_choice', 'multiple_choice'].includes(question.type)) {
      const modeBox = create('div', 'exam-inspector-box');
      modeBox.append(create('strong', '', 'Wariant odpowiedzi'));
      const modePills = create('div', 'exam-preset-pills');
      const singlePill = create('button', 'exam-preset-pill', 'Jedna odpowiedź');
      singlePill.type = 'button';
      singlePill.classList.toggle('is-active', question.type === 'single_choice');
      singlePill.addEventListener('click', () => {
        if (question.type !== 'single_choice') {
          question.type = 'single_choice';
          if (question.correctAnswerIds?.length > 1) question.correctAnswerIds = question.correctAnswerIds.slice(0, 1);
          if (scope === 'bank') state.bankDirty = true;
          saveDrafts(); render();
        }
      });
      const multiPill = create('button', 'exam-preset-pill', 'Wiele odpowiedzi');
      multiPill.type = 'button';
      multiPill.classList.toggle('is-active', question.type === 'multiple_choice');
      multiPill.addEventListener('click', () => {
        if (question.type !== 'multiple_choice') {
          question.type = 'multiple_choice';
          if (scope === 'bank') state.bankDirty = true;
          saveDrafts(); render();
        }
      });
      modePills.append(singlePill, multiPill);
      modeBox.append(modePills);
      inspectorArea.append(modeBox);
    }

    // 4. Categories & Tags
    inspectorArea.append(
      row(
        field('Kategorie', input('@categories', question.categories.join(', '))),
        field('Tagi', input('@tags', question.tags.join(', ')))
      )
    );

    // 4. Split-Screen layout toggle
    const splitBox = create('div', 'exam-inspector-box');
    splitBox.append(create('strong', '', '◫ Układ ekranu (Split-Screen)'));
    const splitLabel = create('label', 'checkbox-line');
    const splitInput = document.createElement('input');
    splitInput.type = 'checkbox';
    splitInput.dataset.examPath = '@splitScreen';
    splitInput.checked = Boolean(question.splitScreen);
    splitInput.addEventListener('change', () => {
      question.splitScreen = splitInput.checked;
      if (scope === 'bank') state.bankDirty = true;
      saveDrafts(); renderSummary(); elements.badge.textContent = 'Niezapisane zmiany';
    });
    splitLabel.append(splitInput, document.createTextNode(' Włącz widok dwukolumnowy Split-Screen'));
    splitBox.append(splitLabel);
    inspectorArea.append(splitBox);

    // 5. Advanced question ID
    const advanced = create('details', 'answer-advanced');
    advanced.append(create('summary', '', 'Zaawansowane: identyfikator pytania'), field('ID pytania', input('@questionId', question.questionId, { maxLength: 128 }), 'Nie zmieniaj po rozpoczęciu egzaminu przez uczniów.'));
    inspectorArea.append(advanced);

    layout.append(canvasArea, inspectorArea);
    editor.append(layout);
    return editor;
  }

  function questionTypeFields(question, scope) {
    const changed = (structural) => {
      if (scope === 'bank') state.bankDirty = true;
      saveDrafts(); renderSummary(); elements.badge.textContent = 'Niezapisane zmiany';
      if (structural) render();
    };
    if (Array.isArray(question.options) || ['matching', 'ordering', 'fill_blanks'].includes(question.type)) {
      return [window.ChemAnswerFields.exam(question, changed)];
    }
    if (question.type === 'short_text') return [
      window.ChemAnswerFields.textList(question.acceptedAnswers, (values) => { question.acceptedAnswers = values; changed(); }),
      checkbox('@caseInsensitive', question.caseInsensitive, 'Ignoruj wielkość liter')
    ];
    if (question.type === 'number') return [row(
      field('Poprawna liczba', input('@correctNumber', question.correctNumber, { type: 'number', step: 'any' })),
      field('Tolerancja ±', input('@tolerance', question.tolerance, { type: 'number', min: 0, step: 'any' }))
    )];
    return [
      field('Sposób oceniania', select('@gradingMode', question.gradingMode, [
        { value: 'ai', label: 'Autor uruchamia ocenę AI w raporcie' },
        { value: 'manual', label: 'Sprawdzający przyznaje punkty w raporcie' },
        { value: 'ungraded', label: 'Bez punktów — nie licz do wyniku' }
      ]), question.gradingMode === 'manual'
        ? 'Wynik pozostanie oczekujący, aż administrator przyzna punkty.'
        : question.gradingMode === 'ungraded'
          ? 'Odpowiedź będzie zapisana, ale pytanie zostanie wyłączone z sumy punktów.'
          : 'AI nie uruchamia się przy oddaniu egzaminu. Autor może później ocenić oczekujące odpowiedzi jednym przyciskiem w raporcie.'),
      field('Klucz odpowiedzi', textarea('@answerKey', question.answerKey, { rows: 7, maxLength: 10000 }), 'Wymagany w trybie AI. Opisz poprawną odpowiedź i elementy, które powinny otrzymać część punktów.'),
      field('Dodatkowe kryteria dla AI', textarea('@aiInstruction', question.aiInstruction, { rows: 4, maxLength: 2000 }), 'Opcjonalna rubryka lub reguły przyznawania punktów.'),
      checkbox('@multiline', question.multiline, 'Odpowiedź wielowierszowa')
    ];
  }

  function renderBank() {
    const main = section('Wspólny bank pytań', 'Pytania są zapisywane raz w exams/question-bank.json i mogą być używane w wielu egzaminach.');
    const tools = create('div', 'exam-inline-actions');
    const add = create('button', 'button button-primary', '＋ Nowe pytanie w banku');
    add.type = 'button'; add.dataset.examAction = 'add-bank-question';
    const search = input('', '', { placeholder: 'Filtruj po treści, tagu lub kategorii…' });
    search.removeAttribute('data-exam-path'); search.dataset.bankSearch = '1';
    tools.append(add, search);
    main.append(tools);
    const list = create('div', 'exam-question-list');
    list.dataset.bankList = '1';
    if (!window.NextMedUI?.render('studio-exam-list', list, {
      questions: state.bank.questions.map((question) => ({ question })), bank: true, references: state.exam.questionRefs,
      selected: [state.selectedBankQuestionId], labels: TYPE_LABELS
    })) state.bank.questions.forEach((question, index) => list.append(bankCard(question, index)));
    main.append(list);
    elements.editor.append(main);
    const selected = state.bank.questions.find((question) => question.questionId === state.selectedBankQuestionId);
    if (selected) elements.editor.append(renderQuestionEditor(selected, 'bank'));
  }

  function bankCard(question, index) {
    const card = questionCard(question, index, false);
    const actions = card.querySelector('.exam-question-actions');
    actions.replaceChildren();
    for (const [action, label, danger] of [
      ['use-bank-question', state.exam.questionRefs.includes(question.questionId) ? 'Dodane' : 'Dodaj do egzaminu', false],
      ['duplicate-bank-question', 'Duplikuj', false],
      ['delete-bank-question', 'Usuń', true]
    ]) {
      const button = create('button', `mini-button${danger ? ' is-danger' : ''}`, label);
      button.type = 'button'; button.dataset.examAction = action; button.dataset.questionId = question.questionId;
      if (action === 'use-bank-question' && state.exam.questionRefs.includes(question.questionId)) button.disabled = true;
      actions.append(button);
    }
    card.querySelector('[data-exam-action]').dataset.examAction = 'select-bank-question';
    return card;
  }

  function renderDisplay() {
    const main = section('Wyświetlanie pytań', 'Układ nie wpływa na klucz odpowiedzi ani punktację.');
    main.append(
      field('Tryb', select('display.mode', state.exam.display.mode, [
        { value: 'one', label: 'Jedno pytanie na ekran' },
        { value: 'page', label: 'X pytań na ekran' },
        { value: 'all', label: 'Wszystkie pytania' }
      ])),
      field('Pytań na ekran', input('display.questionsPerPage', state.exam.display.questionsPerPage, { type: 'number', min: 1, max: 100 }), 'Używane tylko w trybie X pytań.')
    );
    elements.editor.append(main);
  }

  function renderNavigation() {
    const main = section('Nawigacja', 'Każde ograniczenie jest ponownie sprawdzane po stronie serwera.');
    main.append(
      checkbox('navigation.allowBack', state.exam.navigation.allowBack, 'Pozwól cofać się do wcześniejszych pytań'),
      checkbox('navigation.allowFreeNavigation', state.exam.navigation.allowFreeNavigation, 'Pozwól przechodzić dowolnie przez navigator'),
      checkbox('navigation.allowSkip', state.exam.navigation.allowSkip, 'Pozwól pomijać pytania'),
      checkbox('navigation.requireAnswerBeforeNext', state.exam.navigation.requireAnswerBeforeNext, 'Wymagaj odpowiedzi przed przejściem dalej'),
      checkbox('navigation.allowFlagging', state.exam.navigation.allowFlagging, 'Pozwól oznaczyć pytanie do późniejszego sprawdzenia')
    );
    elements.editor.append(main);
  }

  function renderTime() {
    const main = section('Czas', 'Serwer zapisuje startedAt i expiresAt. Zegar przeglądarki ma wyłącznie funkcję informacyjną.');
    main.append(
      field('Limit', select('timing.mode', state.exam.timing.mode, [
        { value: 'none', label: 'Bez limitu' }, { value: 'exam', label: 'Limit całego egzaminu' }, { value: 'question', label: 'Limit każdego pytania' }
      ])),
      row(
        field('Limit egzaminu (sekundy)', input('timing.limitSeconds', state.exam.timing.limitSeconds, { type: 'number', min: 1 })),
        field('Limit pytania (sekundy)', input('timing.questionLimitSeconds', state.exam.timing.questionLimitSeconds, { type: 'number', min: 1 }))
      ),
      field('Wyświetlanie czasu', select('timing.display', state.exam.timing.display, [
        { value: 'countdown', label: 'Odliczanie' }, { value: 'countup', label: 'Czas od startu' }, { value: 'hidden', label: 'Ukryty' }
      ]))
    );
    elements.editor.append(main);
  }

  function renderRandomization() {
    const main = section('Losowanie', 'Dokładny zestaw pytań i kolejność odpowiedzi są utrwalane przy tworzeniu próby.');
    main.append(
      checkbox('randomization.questionOrder', state.exam.randomization.questionOrder, 'Losuj kolejność pytań'),
      checkbox('randomization.answerOrder', state.exam.randomization.answerOrder, 'Losuj kolejność odpowiedzi'),
      field('Liczba pytań z całej puli', input('randomization.totalQuestions', state.exam.randomization.totalQuestions ?? '', { type: 'number', min: 1, max: 500 }), 'Puste pole oznacza wszystkie pytania.'),
      field('Limity kategorii', textarea('randomization.categoryQuotas', state.exam.randomization.categoryQuotas.map((quota) => `${quota.category}: ${quota.count}`).join('\n'), { rows: 6, placeholder: 'organiczna: 5\nnieorganiczna: 5' }))
    );
    elements.editor.append(main);
  }

  function renderScoring() {
    const main = section('Punktacja', 'Klient nie otrzymuje ukrytych reguł ani odpowiedzi. Wynik oblicza Function po zakończeniu.');
    main.append(
      checkbox('scoring.equalPoints', state.exam.scoring.equalPoints, 'Jednakowe punkty dla wszystkich pytań'),
      field('Domyślne punkty', input('scoring.defaultPoints', state.exam.scoring.defaultPoints, { type: 'number', min: 0, step: .1 })),
      checkbox('scoring.partialPoints', state.exam.scoring.partialPoints, 'Przyznawaj punkty częściowe'),
      checkbox('scoring.negativePointsEnabled', state.exam.scoring.negativePointsEnabled, 'Włącz punkty ujemne'),
      field('Domyślna kara', input('scoring.defaultNegativePoints', state.exam.scoring.defaultNegativePoints, { type: 'number', min: 0, step: .1 })),
      field('Punktacja pytań wielokrotnego wyboru', select('scoring.multipleChoiceStrategy', state.exam.scoring.multipleChoiceStrategy, [
        { value: 'all_or_nothing', label: 'Wszystko albo nic' },
        { value: 'per_option', label: 'Za każdą prawidłową decyzję' },
        { value: 'correct_minus_incorrect', label: 'Poprawne minus błędne zaznaczenia' }
      ]))
    );
    elements.editor.append(main);
  }

  function renderAttempts() {
    const main = section('Próby', 'Ustal, ile razy uczestnik może podejść do egzaminu i jak długo musi odczekać przed kolejną próbą.');
    main.append(
      field('Liczba prób', select('attempts.mode', state.exam.attempts.mode, [
        { value: 'one', label: 'Jedna próba' }, { value: 'limited', label: 'Określona liczba' }, { value: 'unlimited', label: 'Bez limitu' }
      ])),
      row(
        field('Maksymalna liczba', input('attempts.maxAttempts', state.exam.attempts.maxAttempts, { type: 'number', min: 1, max: 1000 })),
        field('Przerwa między próbami (sekundy)', input('attempts.cooldownSeconds', state.exam.attempts.cooldownSeconds, { type: 'number', min: 0 }))
      ),
      field('Wynik wielu prób', select('attempts.resultStrategy', state.exam.attempts.resultStrategy, [
        { value: 'best', label: 'Najlepszy' }, { value: 'first', label: 'Pierwszy' }, { value: 'last', label: 'Ostatni' }, { value: 'average', label: 'Średnia' }
      ]))
    );
    elements.editor.append(main);
  }

  function renderAccess() {
    const main = section('Dostępność', 'Dostęp jest weryfikowany przy każdym rozpoczęciu i wznowieniu próby. Użytkownik nadal musi mieć aktywny dostęp do kursu.');
    main.append(
      field('Okno dostępności', select('availability.mode', state.exam.availability.mode, [
        { value: 'always', label: 'Zawsze' }, { value: 'from', label: 'Od daty' }, { value: 'until', label: 'Do daty' }, { value: 'range', label: 'Zakres dat' }
      ])),
      row(
        field('Od', input('availability.from', dateTimeLocal(state.exam.availability.from), { type: 'datetime-local' })),
        field('Do', input('availability.until', dateTimeLocal(state.exam.availability.until), { type: 'datetime-local' }))
      ),
      field('Odbiorcy egzaminu', select('availability.audienceMode', state.exam.availability.audienceMode, [
        { value: 'all', label: 'Wszyscy użytkownicy z dostępem do kursu' },
        { value: 'selected', label: 'Tylko wybrane osoby' }
      ]), state.exam.availability.audienceMode === 'all'
        ? 'Egzamin będzie dostępny wszystkim uprawnionym osobom w ustawionym oknie czasu.'
        : 'Dostęp otrzymają wyłącznie zaznaczone konta.')
    );
    if (state.exam.availability.audienceMode === 'selected') main.append(audiencePicker());
    elements.editor.append(main);
  }

  function audiencePicker() {
    const wrapper = create('div', 'exam-audience-picker');
    const selected = create('div', 'exam-audience-selected');
    if (!state.exam.availability.userIds.length) {
      selected.append(create('p', 'exam-audience-empty', 'Nie wybrano jeszcze żadnej osoby.'));
    } else {
      state.exam.availability.userIds.forEach((userId) => {
        const user = state.users.find((candidate) => candidate.id === userId);
        const chip = create('span', 'exam-audience-chip');
        const copy = create('span');
        copy.append(create('strong', '', userLabel(user, userId)), create('small', '', user?.email || userId));
        const remove = create('button', '', '×');
        remove.type = 'button'; remove.title = `Usuń ${userLabel(user, userId)}`;
        remove.setAttribute('aria-label', remove.title);
        remove.dataset.examAction = 'remove-audience-user'; remove.dataset.userId = userId;
        chip.append(copy, remove); selected.append(chip);
      });
    }
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Szukaj po imieniu, nazwisku, e-mailu lub ID…';
    search.autocomplete = 'off'; search.value = state.userQuery; search.dataset.audienceSearch = '1';
    const searchField = field('Znajdź użytkownika', search, 'Wyszukaj uczestnika platformy i zaznacz osoby, które mają otrzymać dostęp do egzaminu.');
    const status = create('p', 'exam-audience-status'); status.dataset.audienceStatus = '1';
    status.textContent = audienceStatus();
    const results = create('div', 'exam-audience-results'); results.dataset.audienceResults = '1';
    renderAudienceResults(results);
    wrapper.append(create('strong', 'exam-audience-heading', `Wybrane osoby (${state.exam.availability.userIds.length})`), selected, searchField, status, results);
    if (state.usersHasMore && !state.usersLoading) {
      const all = create('button', 'button button-soft', 'Wczytaj całą listę użytkowników');
      all.type = 'button'; all.dataset.examAction = 'load-audience-users'; wrapper.append(all);
    }
    return wrapper;
  }

  function renderAudienceResults(host) {
    if (!host) return;
    const query = state.userQuery.trim().toLocaleLowerCase('pl');
    const selected = new Set(state.exam.availability.userIds);
    const matches = state.users.filter((user) => {
      if (selected.has(user.id)) return false;
      const haystack = `${user.fullName || ''} ${user.firstName || ''} ${user.lastName || ''} ${user.email || ''} ${user.id}`.toLocaleLowerCase('pl');
      return !query || haystack.includes(query);
    }).slice(0, 50);
    host.replaceChildren(...matches.map((user) => {
      const button = create('button', 'exam-audience-user');
      button.type = 'button'; button.dataset.examAction = 'add-audience-user'; button.dataset.userId = user.id;
      const copy = create('span');
      copy.append(create('strong', '', userLabel(user, user.id)), create('small', '', `${user.email || 'Brak e-maila'} · ${user.id}`));
      const role = create('span', 'exam-audience-role', userAccessLabel(user));
      button.append(copy, role); return button;
    }));
    if (!matches.length) {
      host.append(create('p', 'exam-audience-empty', state.usersLoading
        ? 'Wczytuję użytkowników…'
        : query ? 'Brak pasujących, niewybranych użytkowników.' : 'Brak kolejnych użytkowników do wybrania.'));
    }
  }

  function userLabel(user, fallback) {
    return user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || fallback;
  }

  function userAccessLabel(user) {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    if (roles.includes('admin')) return 'Administrator';
    if (roles.includes('active') || user?.timedAccess?.active) return 'Dostęp aktywny';
    return 'Brak aktywnego dostępu';
  }

  function audienceStatus() {
    if (state.usersError) return state.usersError;
    if (state.usersLoading) return `Wczytuję konta… obecnie ${state.users.length}.`;
    if (!state.users.length) return 'Lista użytkowników nie została jeszcze pobrana.';
    const total = state.usersTotal == null ? '' : ` z ${state.usersTotal}`;
    return state.usersHasMore
      ? `Wczytano ${state.users.length}${total}. Wpisz frazę, aby automatycznie przeszukać całą listę.`
      : `Przeszukiwana jest pełna lista ${state.users.length} kont.`;
  }

  function renderSecurity() {
    const main = section('Opuszczenie egzaminu', 'Zdarzenia karty są pomocnicze i nie są przedstawiane jako pełny proctoring.');
    main.append(field('Zasada opuszczenia', select('security.leavePolicy', state.exam.security.leavePolicy, [
      { value: 'allow_resume', label: 'Pozwól wrócić' },
      { value: 'end_attempt', label: 'Zakończ próbę po zgłoszeniu opuszczenia' },
      { value: 'warn', label: 'Ostrzeż i loguj' },
      { value: 'log', label: 'Tylko loguj zdarzenie' }
    ])));
    const note = create('div', 'exam-security-note');
    note.append(create('strong', '', 'Granica techniczna'), create('p', '', 'Przeglądarka nie gwarantuje wykrycia zamknięcia karty. Serwer zawsze zachowuje stan próby i wymusza własny timer.'));
    main.append(note);
    elements.editor.append(main);
  }

  function renderResults() {
    const main = section('Odpowiedzi i wynik', 'Klucz odpowiedzi jest zwracany przez serwer wyłącznie zgodnie z wybranym trybem. Aktywna próba nie otrzymuje klucza do niezatwierdzonych pytań.');
    main.append(field('Kiedy uczeń może zobaczyć prawidłową odpowiedź?', select('resultVisibility.feedbackMode', state.exam.resultVisibility.feedbackMode, [
      { value: 'immediate', label: 'Od razu po zatwierdzeniu odpowiedzi' },
      { value: 'after_submit', label: 'Dopiero po zakończeniu całego testu' },
      { value: 'never', label: 'Nigdy — pełny wynik tylko dla administratora' }
    ]), state.exam.resultVisibility.feedbackMode === 'immediate'
      ? 'Uczeń zatwierdza pytanie osobnym przyciskiem. Po ujawnieniu odpowiedzi nie może już jej zmienić.'
      : state.exam.resultVisibility.feedbackMode === 'after_submit'
        ? 'Prawidłowe odpowiedzi pojawią się dopiero po bezpiecznym zakończeniu próby.'
        : 'Uczeń otrzyma tylko potwierdzenie zapisania próby. Wynik pozostanie w raporcie administratora.'));
    if (state.exam.resultVisibility.feedbackMode === 'never') {
      const note = create('div', 'exam-security-note');
      if (state.exam.resultVisibility.studentResultVisible) {
        note.append(create('strong', '', 'Ustawienie zgodności starszego egzaminu'), create('p', '', 'Prawidłowe odpowiedzi są ukryte, ale starsza konfiguracja nadal pozwala pokazać część podsumowania. Wyłącz poniższy przełącznik, aby pełny wynik widział tylko administrator.'));
        main.append(note, checkbox('resultVisibility.studentResultVisible', true, 'Pokaż uczniowi podsumowanie bez prawidłowych odpowiedzi'));
      } else {
        note.append(create('strong', '', 'Tryb poufny'), create('p', '', 'Uczeń nie zobaczy procentu, punktów, zaliczenia, prawidłowych odpowiedzi ani wyjaśnień. Administrator nadal ma pełny raport i klucz odpowiedzi.'));
        main.append(note);
      }
      elements.editor.append(main); return;
    }
    const labels = {
      scorePercent: 'Procent wyniku', points: 'Punkty', passFail: 'Zaliczono / nie zaliczono', ownAnswers: 'Własne odpowiedzi',
      explanations: state.exam.resultVisibility.feedbackMode === 'immediate' ? 'Wyjaśnienie od razu po zatwierdzeniu' : 'Wyjaśnienia po zakończeniu', time: 'Czas próby'
    };
    Object.entries(labels).forEach(([key, label]) => main.append(checkbox(`resultVisibility.${key}`, state.exam.resultVisibility[key], label)));
    elements.editor.append(main);
  }

  function reviewScope() { return `${state.repositoryId}:${state.exam.examId}`; }
  function clearReviewSelection() {
    state.attemptRequest++;
    state.attemptLoading = false;
    state.attemptReport = null;
    state.reviewUser = null;
    state.reviewQueue = null;
    state.report = null;
  }
  function gradeDraftKey(attempt) { return `${attempt.repositoryId || state.repositoryId}:${attempt.examId || state.exam.examId}:${attempt.userId}:${attempt.attemptId}`; }
  function renderReview() {
    const main = section('Sprawdzanie egzaminu', 'Wybierz ucznia, następnie jego próbę. Punkty i komentarze zapisujesz samodzielnie; AI działa wyłącznie na Twoje polecenie.');
    elements.editor.append(main);
    if (!state.remoteSha || state.remoteExamId !== state.exam.examId) {
      main.append(create('p', 'exam-report-empty', 'Najpierw zapisz egzamin lub otwórz go z biblioteki.')); return;
    }
    if (state.reviewQueue?.scope !== reviewScope()) state.reviewQueue = null;
    const toolbar = create('div', 'exam-review-toolbar');
    const search = create('input'); search.type = 'search'; search.placeholder = 'Imię, nazwisko lub e-mail'; search.value = state.reviewQuery; search.dataset.reviewSearch = '1';
    const filter = create('select'); filter.dataset.reviewFilter = '1';
    for (const [value, label] of [['pending', 'Do sprawdzenia'], ['all', 'Wszyscy'], ['graded', 'Ocenione']]) {
      const option = create('option', '', label); option.value = value; filter.append(option);
    }
    filter.value = state.reviewFilter;
    const refresh = create('button', 'button button-soft', 'Odśwież listę'); refresh.type = 'button'; refresh.dataset.examAction = 'refresh-review'; refresh.disabled = state.reviewLoading;
    toolbar.append(field('Szukaj we wczytanej liście', search), field('Pokaż', filter), refresh); main.append(toolbar);
    main.append(create('p', 'exam-review-hint', 'Lista jest wczytywana partiami. Nie widzisz ucznia? Wczytaj kolejną część. Wybór osoby udostępni wszystkie jej próby w tym egzaminie.'));
    const columns = create('div', 'exam-review-columns');
    const roster = create('aside', 'exam-review-roster'); roster.dataset.reviewRoster = '1'; roster.setAttribute('aria-label', 'Uczniowie do sprawdzenia');
    const detail = create('div', 'exam-review-detail');
    columns.append(roster, detail); main.append(columns); renderReviewRoster();
    if (state.reviewUser?.scope === reviewScope()) {
      const selector = create('select'); selector.dataset.reviewAttempt = '1'; selector.disabled = state.attemptLoading || state.gradingBusy || state.aiGrading;
      for (const attempt of state.reviewUser.attempts) {
        const option = create('option', '', `Próba ${attempt.number} · ${new Date(attempt.startedAt).toLocaleString('pl-PL')} · ${attempt.gradingStatus === 'pending_review' ? 'do sprawdzenia' : attempt.status === 'active' ? 'w trakcie' : 'zakończona'}`);
        option.value = attempt.attemptId; selector.append(option);
      }
      selector.value = state.attemptReport?.userId === state.reviewUser.userId ? state.attemptReport.attemptId : '';
      detail.append(field('Próba wybranego ucznia', selector));
    }
    if (state.attemptLoading) detail.append(create('p', 'exam-report-empty', 'Wczytuję odpowiedzi ucznia…'));
    else if (state.attemptReport && state.reviewUser?.scope === reviewScope() && state.attemptReport.userId === state.reviewUser.userId) detail.append(attemptReportView(state.attemptReport));
    else detail.append(create('p', 'exam-report-empty', 'Wybierz ucznia z listy, aby otworzyć odpowiedzi i przyznać punkty.'));
  }

  function renderReviewRoster() {
    const host = elements.editor.querySelector('[data-review-roster]'); if (!host) return;
    const normalize = (value) => String(value || '').toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
    const groups = new Map();
    for (const attempt of state.reviewQueue?.attempts || []) {
      const pending = attempt.gradingStatus === 'pending_review';
      if (state.reviewFilter === 'pending' && !pending) continue;
      if (state.reviewFilter === 'graded' && (pending || !['submitted', 'timed_out'].includes(attempt.status) || attempt.gradingStatus === 'not_scored')) continue;
      if (!normalize(`${attempt.profile?.name || ''} ${attempt.profile?.email || ''} ${attempt.userId}`).includes(normalize(state.reviewQuery).trim())) continue;
      const user = groups.get(attempt.userId) || { userId: attempt.userId, profile: attempt.profile, count: 0, pending: 0 };
      user.count++; if (pending) user.pending++; groups.set(user.userId, user);
    }
    const props = { users: [...groups.values()], selected: state.reviewUser?.userId, busy: state.gradingBusy || state.aiGrading, loading: state.reviewLoading, more: Boolean(state.reviewQueue?.cursor),
      onOpen: (id) => void openReviewUser(id), onMore: () => void loadReviewQueue(true) };
    if (window.NextMedUI?.render('studio-exam-review-roster', host, props)) return;
    host.replaceChildren();
    for (const user of props.users) {
      const button = create('button', 'exam-review-user', `${user.profile?.name || user.profile?.email || user.userId} · do sprawdzenia: ${user.pending}`);
      button.type = 'button'; button.disabled = props.busy; button.onclick = () => props.onOpen(user.userId); host.append(button);
    }
    if (!props.users.length) host.append(create('p', '', props.loading ? 'Wczytywanie…' : 'Brak pasujących prób w tej części listy.'));
    if (props.more) { const more = create('button', 'button button-soft', 'Wczytaj kolejnych'); more.type = 'button'; more.disabled = props.loading; more.onclick = props.onMore; host.append(more); }
  }

  async function loadReviewQueue(more = false) {
    if (!state.remoteSha || state.reviewLoading) return;
    const scope = reviewScope(); const cursor = more ? state.reviewQueue?.cursor : '';
    if (more && !cursor) return;
    state.reviewLoading = true; if (state.tab === 'review') render();
    try {
      const result = await adminRequest({ view: 'review', repo: state.repositoryId, exam: state.exam.examId, ...(cursor ? { cursor } : {}) });
      if (scope !== reviewScope()) return;
      const all = new Map((more ? state.reviewQueue?.attempts || [] : []).map((item) => [item.attemptId, item]));
      result.attempts.forEach((item) => all.set(item.attemptId, item));
      state.reviewQueue = { scope, attempts: [...all.values()], cursor: result.cursor };
    } catch (error) { if (scope === reviewScope()) elements.status.textContent = error.message || 'Nie udało się wczytać kolejki.'; }
    finally {
      state.reviewLoading = false;
      if (state.tab === 'review') {
        render();
        if (scope !== reviewScope()) void loadReviewQueue();
      }
    }
  }

  async function openReviewUser(userId) {
    if (state.gradingBusy || state.aiGrading) return;
    const request = ++state.attemptRequest; const scope = reviewScope();
    state.attemptLoading = true; state.attemptReport = null; state.reviewUser = null; render();
    try {
      const payload = await adminRequest({ view: 'user', repo: state.repositoryId, exam: state.exam.examId, userId });
      if (request !== state.attemptRequest || scope !== reviewScope()) return;
      const attempts = (payload.user.attempts || []).filter((attempt) => attempt.status !== 'reset').sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
      state.reviewUser = { scope, userId, attempts };
      const selected = attempts.find((attempt) => attempt.gradingStatus === 'pending_review') || attempts[0];
      if (selected) await openAttemptReport(userId, selected.attemptId);
      else { state.attemptLoading = false; render(); }
    } catch (error) {
      if (request !== state.attemptRequest || scope !== reviewScope()) return;
      state.attemptLoading = false; elements.status.textContent = error.message || 'Nie udało się wczytać prób ucznia.'; render();
    }
  }

  function renderReports() {
    const main = section('Raport egzaminu', 'Sprawdź wyniki i odpowiedzi uczestników. Otwórz szczegóły próby, aby ocenić pytania otwarte.');
    const refresh = create('button', 'button button-soft', state.reportLoading ? 'Pobieranie…' : '↻ Odśwież raport');
    refresh.type = 'button'; refresh.dataset.examAction = 'refresh-report'; refresh.disabled = state.reportLoading || !state.remoteSha;
    main.append(refresh);
    if (!state.remoteSha) main.append(create('p', 'exam-report-empty', 'Najpierw zapisz egzamin lub otwórz go z biblioteki.'));
    else if (!state.report) main.append(create('p', 'exam-report-empty', state.reportLoading ? 'Pobieram próby i analizę pytań…' : 'Kliknij „Odśwież raport”.'));
    else main.append(reportView(state.report));
    elements.editor.append(main);
  }

  function reportView(report) {
    const wrapper = create('div', 'exam-report-view');
    if (report.metricsScope === 'page') wrapper.append(create('p', 'exam-report-empty', 'Statystyki i analiza dotyczą tej części raportu. Kolejne próby znajdziesz poniżej.'));
    const metrics = create('div', 'exam-report-metrics');
    const values = [
      ['Uczestnicy', report.metrics.participants], ['Próby', report.metrics.attempts], ['Średnia', `${report.metrics.average}%`],
      ['Do sprawdzenia', report.metrics.pendingReview || 0],
      ['Mediana', `${report.metrics.median}%`], ['Min / max', `${report.metrics.minimum}% / ${report.metrics.maximum}%`],
      ['Zdawalność', `${report.metrics.passRate}%`], ['Średni czas', formatDuration(report.metrics.averageTimeSeconds)]
    ];
    values.forEach(([label, value]) => {
      const card = create('article'); card.append(create('small', '', label), create('strong', '', value)); metrics.append(card);
    });
    const attempts = create('div', 'exam-report-table');
    attempts.append(create('h4', '', 'Próby uczestników'));
    report.attempts.slice(0, 100).forEach((attempt) => {
      const line = create('button'); line.type = 'button'; line.dataset.examAction = 'open-attempt-report'; line.dataset.attemptId = attempt.attemptId; line.dataset.userId = attempt.userId;
      const outcome = attempt.status === 'active' ? 'w trakcie'
        : attempt.gradingStatus === 'pending_review' ? 'oczekuje na ocenę'
        : attempt.gradingStatus === 'not_scored' ? 'bez punktacji'
        : attempt.passed == null ? 'brak statusu' : attempt.passed ? 'zaliczona' : 'niezaliczona';
      const score = attempt.scorePercent == null ? 'wynik —' : `${attempt.scorePercent}%`;
      line.append(create('span', '', attempt.profile?.name || attempt.profile?.email || attempt.userId), create('span', '', `Próba ${attempt.number} · ${score} · ${outcome}`));
      attempts.append(line);
    });
    const paging = create('div', 'react-list-more');
    for (const [action, label, visible] of [['first-report', 'Od początku', report.requestCursor], ['next-report', 'Następna część', report.cursor]]) {
      if (!visible) continue;
      const button = create('button', 'button button-soft', label);
      button.type = 'button'; button.dataset.examAction = action; button.disabled = state.reportLoading;
      paging.append(button);
    }
    attempts.append(paging);
    const distribution = create('section', 'exam-score-distribution');
    distribution.append(create('h4', '', 'Rozkład wyników'));
    const maximumBucket = Math.max(1, ...Object.values(report.metrics.distribution || {}).map(Number));
    Object.entries(report.metrics.distribution || {}).forEach(([label, count]) => {
      const line = create('div');
      const track = create('span', 'exam-score-track');
      const bar = create('i'); bar.style.width = `${Math.max(3, Number(count) / maximumBucket * 100)}%`; track.append(bar);
      line.append(create('small', '', `${label}%`), track, create('strong', '', count)); distribution.append(line);
    });
    const analysis = create('div', 'exam-question-analysis');
    for (const [title, questions] of [
      ['Najtrudniejsze pytania', report.questionAnalysis?.hardest || []],
      ['Najłatwiejsze pytania', report.questionAnalysis?.easiest || []]
    ]) {
      const group = create('section'); group.append(create('h4', '', title));
      questions.slice(0, 6).forEach((question) => {
        const item = create('div');
        item.append(
          create('span', '', question.prompt || question.questionId),
          create('strong', '', `${question.correctPercent}% poprawnych · ${question.answerCount} odpowiedzi`)
        );
        if (question.commonDistractor) item.title = `Najczęstsza błędna odpowiedź: ${question.commonDistractor.answer}`;
        group.append(item);
      });
      analysis.append(group);
    }
    wrapper.append(metrics, distribution, attempts, analysis);
    if (state.attemptReport) wrapper.append(attemptReportView(state.attemptReport));
    return wrapper;
  }

  function attemptReportView(attempt) {
    const report = create('section', 'exam-attempt-report');
    const finished = ['submitted', 'timed_out'].includes(attempt.status);
    const heading = create('header');
    const copy = create('div');
    copy.append(
      create('small', '', 'Raport szczegółowy próby'),
      create('h3', '', `${attempt.profile?.name || attempt.profile?.email || attempt.userId} · próba ${attempt.number}`),
      create('p', '', attempt.status === 'active'
        ? `W trakcie · odpowiedzi ${Object.keys(attempt.answers || {}).length}/${attempt.questions?.length || 0}`
        : attempt.result?.gradingStatus === 'pending_review'
          ? `Oczekuje na ocenę · ${attempt.result.pendingQuestionIds?.length || 0} pytań · ${formatDuration(attempt.durationSeconds)}`
          : `${attempt.result?.scorePercent ?? '—'}% · ${attempt.result?.passed == null ? 'brak statusu' : attempt.result.passed ? 'zaliczona' : 'niezaliczona'} · ${formatDuration(attempt.durationSeconds)}`)
    );
    const reset = create('button', 'button button-danger', 'Resetuj próbę');
    reset.type = 'button'; reset.dataset.examAction = 'reset-attempt'; reset.dataset.userId = attempt.userId; reset.dataset.attemptId = attempt.attemptId;
    reset.disabled = state.gradingBusy || state.aiGrading;
    heading.append(copy, reset); report.append(heading);
    const signalTypes = new Set(['cursor_leave', 'copy', 'paste', 'context_menu']);
    const signals = (attempt.events || []).filter((entry) => signalTypes.has(entry.type));
    const signalBox = document.createElement('details');
    signalBox.className = `exam-attempt-alerts${signals.length ? ' has-alerts' : ''}`;
    const signalSummary = document.createElement('summary');
    signalSummary.append(
      create('span', '', signals.length ? `Sygnały wymagające uwagi — ${signals.length}` : 'Sygnały wymagające uwagi — brak'),
      create('strong', '', signals.length ? 'Sprawdź' : 'OK')
    );
    signalBox.append(
      signalSummary,
      create('p', 'exam-attempt-alert-note', 'Są to pomocnicze sygnały z przeglądarki, a nie dowód niesamodzielnej pracy. Wyjście kursorem może oznaczać także użycie paska przeglądarki.')
    );
    signals.forEach((entry) => signalBox.append(attemptEventRow(entry, true)));
    report.append(signalBox);
    (attempt.questions || []).forEach((question, index) => {
      const graded = attempt.result?.questionResults?.find((entry) => entry.questionId === question.questionId);
      const details = document.createElement('details'); details.className = 'exam-attempt-question';
      details.open = state.tab === 'review' && question.type === 'open_answer';
      const summary = document.createElement('summary');
      const prompt = create('span');
      window.ChemAssessmentText.render(prompt, `${index + 1}. ${question.prompt || question.template}`, question.promptFormat);
      prompt.style.fontSize = 'inherit';
      summary.append(
        prompt,
        create('strong', '', `${graded?.points ?? '—'}/${graded?.maxPoints ?? question.points} pkt`)
      );
      const answer = create('div', 'assessment-answer-grid');
      answer.append(
        answerCard('Odpowiedź ucznia', question.answerDisplay, false),
        answerCard('Klucz odpowiedzi', question.correctAnswerDisplay, true)
      );
      details.append(summary, answer);
      if (question.aiInstruction) details.append(answerCard('Kryteria oceniania autora', [question.aiInstruction], true));
      if (graded?.feedback) details.append(answerCard('Informacja zwrotna', [graded.feedback], false));
      if (finished && question.type === 'open_answer' && question.gradingMode !== 'ungraded' && Number(question.points) > 0) {
        const grading = create('div', 'exam-manual-grade');
        const draft = state.gradeDrafts.get(gradeDraftKey(attempt))?.[question.questionId];
        const points = input('', draft?.points ?? graded?.points ?? '', { type: 'number', min: 0, max: graded?.maxPoints ?? question.points, step: .1 });
        points.removeAttribute('data-exam-path');
        points.dataset.examGradePoints = question.questionId;
        const feedback = textarea('', draft?.feedback ?? graded?.feedback ?? '', { rows: 3, maxLength: 2000, placeholder: 'Krótka informacja zwrotna dla ucznia' });
        points.disabled = feedback.disabled = state.gradingBusy || state.aiGrading;
        feedback.removeAttribute('data-exam-path');
        feedback.dataset.examGradeFeedback = question.questionId;
        grading.append(
          field(`Przyznane punkty (maks. ${graded?.maxPoints ?? question.points})`, points),
          field('Komentarz sprawdzającego', feedback)
        );
        details.append(grading);
      }
      if (question.explanation) details.append(create('p', '', question.explanation));
      report.append(details);
    });
    const ordinaryEvents = (attempt.events || []).filter((entry) => !signalTypes.has(entry.type));
    const events = document.createElement('details'); events.className = 'exam-attempt-events';
    const eventSummary = document.createElement('summary'); eventSummary.textContent = `Pozostałe zdarzenia próby (${ordinaryEvents.length})`;
    events.append(eventSummary);
    ordinaryEvents.forEach((entry) => events.append(attemptEventRow(entry, false)));
    report.append(events);
    const pendingAi = finished && (attempt.questions || []).some((question) => {
      const graded = attempt.result?.questionResults?.find((entry) => entry.questionId === question.questionId);
      return question.type === 'open_answer' && question.gradingMode === 'ai'
        && Number(question.points) > 0 && graded?.reviewStatus !== 'graded';
    });
    if (pendingAi) {
      const aiGrade = create('button', 'button button-soft', '✦ Sprawdź oczekujące odpowiedzi za pomocą AI');
      aiGrade.type = 'button'; aiGrade.dataset.examAction = 'ai-grade-attempt';
      aiGrade.disabled = state.aiGrading || state.gradingBusy;
      report.append(aiGrade);
    }
    if (finished && (attempt.questions || []).some((question) => question.type === 'open_answer' && question.gradingMode !== 'ungraded' && Number(question.points) > 0)) {
      const saveGrades = create('button', 'button button-primary', 'Zapisz punkty za pytania otwarte');
      saveGrades.type = 'button'; saveGrades.dataset.examAction = 'grade-attempt';
      saveGrades.disabled = state.gradingBusy || state.aiGrading;
      report.append(saveGrades);
    }
    return report;
  }

  function attemptEventRow(entry, alert) {
    const labels = {
      start: 'Rozpoczęcie próby', resume: 'Wznowienie próby', refresh: 'Odświeżenie strony',
      leave: 'Opuszczenie strony', timeout: 'Upłynięcie czasu', submit: 'Zakończenie próby',
      visibility_hidden: 'Ukrycie karty', visibility_visible: 'Powrót do karty',
      cursor_leave: 'Kursor opuścił obszar strony', copy: 'Kopiowanie', paste: 'Wklejanie',
      context_menu: 'Otwarcie menu prawego przycisku', save_answer: 'Zapis odpowiedzi',
      change_question: 'Zmiana pytania', confirm_answer: 'Zatwierdzenie odpowiedzi'
    };
    const question = entry.index != null && Number.isSafeInteger(Number(entry.index)) && Number(entry.index) >= 0
      ? ` · pytanie ${Number(entry.index) + 1}` : '';
    return create(
      'p',
      alert ? 'exam-attempt-alert-row' : '',
      `${new Date(entry.timestamp).toLocaleString('pl-PL')} · ${labels[entry.type] || entry.type}${question}`
    );
  }

  function answerCard(title, values, key) {
    const card = create('section', `assessment-answer-card${key ? ' is-key' : ''}`);
    card.append(create('h4', '', title));
    const entries = Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : [];
    if (!entries.length) card.append(create('p', 'assessment-answer-empty', key ? 'Nie podano klucza.' : 'Brak odpowiedzi.'));
    else for (const value of entries) {
      const content = create('p'); window.ChemAssessmentText.render(content, value); content.style.fontSize = 'inherit'; card.append(content);
    }
    return card;
  }

  function renderSummary() {
    const validation = modelApi.validateExam(state.exam);
    elements.validation.className = `exam-validation${validation.valid ? ' is-valid' : ' is-error'}`;
    elements.validation.textContent = validation.valid ? 'Definicja jest gotowa do zapisu.' : validation.errors[0].message;
    const inlineQuestions = state.exam.questions.length;
    const refs = state.exam.questionRefs.length;
    const maxPoints = state.exam.questions.reduce((sum, question) => sum + (
      question.type === 'open_answer' && question.gradingMode === 'ungraded'
        ? 0
        : state.exam.scoring.equalPoints ? state.exam.scoring.defaultPoints : question.points
    ), 0);
    elements.summary.replaceChildren();
    [
      ['Status', state.exam.status === 'published' ? 'Opublikowany' : 'Szkic'],
      ['Pytania', `${inlineQuestions + refs} (${refs} z banku)`],
      ['Punkty własnych pytań', maxPoints],
      ['Próg', `${state.exam.metadata.passThreshold}%`],
      ['Timer', state.exam.timing.mode === 'none' ? 'Bez limitu' : state.exam.timing.mode === 'exam' ? 'Cały egzamin' : 'Na pytanie'],
      ['Próby', state.exam.attempts.mode === 'unlimited' ? 'Bez limitu' : state.exam.attempts.mode === 'one' ? '1' : state.exam.attempts.maxAttempts]
    ].forEach(([label, value]) => {
      const item = create('div'); item.append(create('small', '', label), create('strong', '', value)); elements.summary.append(item);
    });
  }

  function handleInput(event) {
    if (event.target.dataset.reviewSearch) { state.reviewQuery = event.target.value; renderReviewRoster(); return; }
    if (event.target.dataset.reviewFilter) { state.reviewFilter = event.target.value; renderReviewRoster(); return; }
    if (event.target.dataset.reviewAttempt && event.type === 'change') { void openAttemptReport(state.reviewUser.userId, event.target.value); return; }
    const gradeId = event.target.dataset.examGradePoints || event.target.dataset.examGradeFeedback;
    if (gradeId && state.attemptReport) {
      const key = gradeDraftKey(state.attemptReport); const drafts = state.gradeDrafts.get(key) || {};
      drafts[gradeId] = { ...drafts[gradeId], [event.target.dataset.examGradePoints ? 'points' : 'feedback']: event.target.value };
      state.gradeDrafts.set(key, drafts); return;
    }
    const control = event.target.closest('[data-exam-path]');
    if (!control || !control.dataset.examPath) {
      if (event.target.dataset.bankSearch) filterBank(event.target.value);
      if (event.target.dataset.audienceSearch) {
        state.userQuery = event.target.value;
        renderAudienceResults(elements.editor.querySelector('[data-audience-results]'));
        const status = elements.editor.querySelector('[data-audience-status]');
        if (status) status.textContent = audienceStatus();
        window.clearTimeout(state.userSearchTimer);
        if (state.userQuery.trim().length >= 2 && state.usersHasMore) {
          state.userSearchTimer = window.setTimeout(() => void loadIdentityUsers(true), 250);
        }
      }
      return;
    }
    const value = control.type === 'checkbox' ? control.checked : control.value;
    if (control.dataset.examPath.startsWith('@')) updateQuestion(control, value);
    else updatePath(control.dataset.examPath, value, control.type);
    saveDrafts();
    renderSummary();
    elements.badge.textContent = 'Niezapisane zmiany';
  }

  function updatePath(path, raw, type) {
    const parts = path.split('.');
    let target = state.exam;
    while (parts.length > 1) target = target[parts.shift()];
    const key = parts[0];
    let value = raw;
    if (type === 'number') value = raw === '' ? null : Number(raw);
    if (['metadata.tags', 'metadata.categories', 'availability.userIds'].includes(path)) value = splitList(raw);
    if (path === 'availability.from' || path === 'availability.until') value = raw ? new Date(raw).toISOString() : null;
    if (path === 'randomization.categoryQuotas') value = String(raw).split('\n').map((line) => {
      const match = /^\s*(.+?):\s*(\d+)\s*$/.exec(line);
      return match ? { category: match[1].trim(), count: Number(match[2]) } : null;
    }).filter(Boolean);
    if (path === 'randomization.totalQuestions' && raw === '') value = null;
    if (path === 'resultVisibility.feedbackMode') {
      state.exam.resultVisibility.feedbackMode = value;
      state.exam.resultVisibility.studentResultVisible = value !== 'never';
      state.exam.resultVisibility.correctAnswers = value !== 'never';
      state.exam.resultVisibility.errors = value !== 'never';
      render();
      return;
    }
    if (path === 'availability.audienceMode') {
      target[key] = value;
      if (value === 'all') state.exam.availability.userIds = [];
      render();
      return;
    }
    if (path === 'resultVisibility.studentResultVisible') {
      target[key] = value;
      render();
      return;
    }
    if (path === 'examId') value = String(raw).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
    if (path === 'metadata.cover.ref' || path === 'metadata.cover.alt') {
      state.exam.metadata.cover = state.exam.metadata.cover || { ref: '', alt: '' };
      state.exam.metadata.cover[key] = value;
      return;
    }
    target[key] = value;
  }

  function updateQuestion(control, raw) {
    const editor = control.closest('[data-question-id]');
    if (!editor) return;
    const collection = editor.dataset.questionScope === 'bank' ? state.bank.questions : state.exam.questions;
    const question = collection.find((candidate) => candidate.questionId === editor.dataset.questionId);
    if (!question) return;
    const fieldName = control.dataset.examPath.slice(1);
    if (fieldName === 'type') {
      const replacement = modelApi.createQuestion({ ...question, type: raw, questionId: question.questionId });
      collection.splice(collection.indexOf(question), 1, replacement);
      if (editor.dataset.questionScope === 'bank') state.bankDirty = true;
      render();
      return;
    }
    if (fieldName === 'gradingMode') {
      question.gradingMode = ['ai', 'manual', 'ungraded'].includes(raw) ? raw : 'ai';
      if (editor.dataset.questionScope === 'bank') state.bankDirty = true;
      render();
      return;
    }
    if (fieldName === 'questionId') {
      const nextId = String(raw).trim();
      if (modelApi.createQuestion({ questionId: nextId }).questionId !== nextId) return;
      const previous = question.questionId;
      question.questionId = nextId;
      if (editor.dataset.questionScope === 'bank') {
        state.exam.questionRefs = state.exam.questionRefs.map((id) => id === previous ? nextId : id);
        state.selectedBankQuestionId = nextId;
        state.bankDirty = true;
      } else state.selectedQuestionId = nextId;
    } else if (['points', 'negativePoints', 'correctNumber', 'tolerance', 'timeLimitSeconds'].includes(fieldName)) question[fieldName] = Number(raw) || 0;
    else if (['categories', 'tags', 'acceptedAnswers', 'correctAnswerIds'].includes(fieldName)) question[fieldName] = splitList(raw, fieldName === 'acceptedAnswers' ? /\n/ : /[,\n]/);
    else if (fieldName === 'images') question.images = parseImages(raw);
    else if (fieldName === 'options') {
      question.options = String(raw).split('\n').map((line, index) => {
        const [requestedId, copy, ...imageParts] = line.split('|');
        const answerId = requestedId.trim() || `${question.questionId}-answer-${index + 1}`;
        return {
          answerId,
          text: String(copy || '').trim() || requestedId.trim(),
          images: parseAnswerImages(imageParts.join('|'))
        };
      }).filter((option) => option.text);
      question.correctAnswerIds = question.correctAnswerIds.filter((id) => question.options.some((option) => option.answerId === id));
      if (!question.correctAnswerIds.length && question.options[0]) question.correctAnswerIds = [question.options[0].answerId];
    } else if (fieldName === 'pairs') {
      question.pairs = String(raw).split('\n').map((line, index) => {
        const parts = line.split(/\s*=>\s*/, 2);
        const previous = question.pairs[index];
        return {
          pairId: previous?.pairId || `${question.questionId}-pair-${index + 1}`,
          left: parts[0]?.trim() || '',
          right: parts[1]?.trim() || '',
          leftImages: previous?.leftImages || [],
          rightImages: previous?.rightImages || []
        };
      }).filter((pair) => pair.left || pair.right);
    } else if (fieldName === 'items') {
      question.items = String(raw).split('\n').map((entry, index) => ({
        itemId: question.items[index]?.itemId || `${question.questionId}-item-${index + 1}`,
        text: entry.trim(),
        images: question.items[index]?.images || []
      })).filter((item) => item.text);
      question.correctOrder = question.items.map((item) => item.itemId);
    } else if (fieldName === 'blanks') {
      question.blanks = String(raw).split('\n').map((line, index) => {
        const [requestedId, answers] = line.split('|', 2);
        return { blankId: requestedId.trim() || `${question.questionId}-blank-${index + 1}`, acceptedAnswers: String(answers || '').split(';').map((item) => item.trim()).filter(Boolean), caseInsensitive: true };
      }).filter((blank) => blank.acceptedAnswers.length);
    } else question[fieldName] = raw;
    if (editor.dataset.questionScope === 'bank') state.bankDirty = true;
  }

  function mediaQuestion(panel) {
    if (!panel || panel.dataset.examMediaScope !== 'question') return null;
    return state.exam.questions.find((question) => question.questionId === panel.dataset.questionId) || null;
  }

  function handleMediaControl(event) {
    const targetSelect = event.target.closest('[data-exam-media-target]');
    if (targetSelect) {
      state.mediaTarget = targetSelect.value;
      return;
    }
    const alt = event.target.closest('[data-exam-media-alt]');
    if (alt) {
      const panel = alt.closest('[data-exam-media-scope]');
      const value = String(alt.value || '').trim().slice(0, 300) || 'Ilustracja do pytania';
      if (panel?.dataset.examMediaScope === 'cover') {
        if (state.exam.metadata.cover?.ref === alt.dataset.mediaRef) state.exam.metadata.cover.alt = value;
      } else {
        const images = imagesForTarget(mediaQuestion(panel), alt.dataset.mediaTarget);
        const image = images?.find((entry) => entry.ref === alt.dataset.mediaRef);
        if (image) image.alt = value;
      }
      saveDrafts(); elements.badge.textContent = 'Niezapisane zmiany';
      return;
    }
    const fileInput = event.target.closest('[data-exam-media-input]');
    if (fileInput?.files?.length) {
      void uploadExamMediaFiles(Array.from(fileInput.files), fileInput.closest('[data-exam-media-scope]'));
      fileInput.value = '';
    }
  }

  function handleMediaDragOver(event) {
    const dropzone = event.target.closest('.exam-media-dropzone');
    if (!dropzone) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('is-dragover');
  }

  function handleMediaDragLeave(event) {
    const dropzone = event.target.closest('.exam-media-dropzone');
    if (dropzone && !dropzone.contains(event.relatedTarget)) dropzone.classList.remove('is-dragover');
  }

  function handleMediaDrop(event) {
    const dropzone = event.target.closest('.exam-media-dropzone');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove('is-dragover');
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
    if (files.length) void uploadExamMediaFiles(files, dropzone.closest('[data-exam-media-scope]'));
  }

  function handleMediaPaste(event) {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    const panel = event.target.closest('[data-exam-media-scope]') || elements.editor.querySelector('[data-exam-media-scope]');
    if (!panel) return;
    event.preventDefault();
    void uploadExamMediaFiles(files, panel);
  }

  let draggedQuestionId = null;

  function handleQuestionDragStart(event) {
    const card = event.currentTarget || event.target.closest('.exam-question-card');
    if (!card) return;
    draggedQuestionId = card.dataset.questionId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedQuestionId);
    }
    card.classList.add('is-dragging');
  }

  function handleQuestionDragOver(event) {
    const card = event.currentTarget || event.target.closest('.exam-question-card');
    if (!card || !draggedQuestionId || card.dataset.questionId === draggedQuestionId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = card.getBoundingClientRect();
    const isBelow = event.clientY > rect.top + rect.height / 2;
    card.classList.toggle('is-drop-below', isBelow);
    card.classList.toggle('is-drop-above', !isBelow);
  }

  function handleQuestionDragLeave(event) {
    const card = event.currentTarget || event.target.closest('.exam-question-card');
    if (card) {
      card.classList.remove('is-drop-above', 'is-drop-below');
    }
  }

  function handleQuestionDrop(event) {
    const card = event.currentTarget || event.target.closest('.exam-question-card');
    if (!card || !draggedQuestionId || card.dataset.questionId === draggedQuestionId) return;
    event.preventDefault();
    const targetId = card.dataset.questionId;
    const isBelow = card.classList.contains('is-drop-below');
    card.classList.remove('is-drop-above', 'is-drop-below');

    const fromIndex = state.exam.questions.findIndex((q) => q.questionId === draggedQuestionId);
    let toIndex = state.exam.questions.findIndex((q) => q.questionId === targetId);
    if (fromIndex >= 0 && toIndex >= 0) {
      const [moved] = state.exam.questions.splice(fromIndex, 1);
      if (isBelow && fromIndex > toIndex) toIndex += 1;
      else if (!isBelow && fromIndex < toIndex) toIndex -= 1;
      state.exam.questions.splice(Math.max(0, toIndex), 0, moved);
      state.selectedQuestionId = moved.questionId;
      saveDrafts();
      render();
    }
    draggedQuestionId = null;
  }

  function handleQuestionDragEnd(event) {
    const card = event.currentTarget || event.target.closest('.exam-question-card');
    if (card) card.classList.remove('is-dragging');
    document.querySelectorAll('.exam-question-card.is-drop-above, .exam-question-card.is-drop-below').forEach((el) => {
      el.classList.remove('is-drop-above', 'is-drop-below');
    });
    draggedQuestionId = null;
  }

  function livePreviewQuestion() {
    saveDrafts();
    if (!state.remoteSha || state.remoteExamId !== state.exam?.examId) {
      const examId = state.exam?.examId || 'draft';
      const repoId = state.repositoryId || 'default';
      const url = `/members/module/exam/?repo=${encodeURIComponent(repoId)}&exam=${encodeURIComponent(examId)}&preview=1`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    previewExam();
  }

  function addTypedQuestion(type) {
    const question = modelApi.createQuestion({ type });
    state.exam.questions.push(question);
    state.selectedQuestionId = question.questionId;
    saveDrafts();
    render();
  }

  function handleEditorKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        if (state.tab === 'questions' && state.selectedQuestionId) {
          event.preventDefault();
          duplicateQuestion(state.exam.questions, state.selectedQuestionId, false);
          return;
        }
      }
    }
    handleMediaKeydown(event);
  }

  function handleMediaKeydown(event) {
    const dropzone = event.target.closest('.exam-media-dropzone');
    if (!dropzone || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!state.mediaUploading) {
      dropzone.closest('[data-exam-media-scope]')?.querySelector('[data-exam-media-input]')?.click();
    }
  }

  function mediaFilename(file) {
    const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
    const extension = extensions[file.type] || '';
    const original = String(file.name || 'obraz').replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const stem = original.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'obraz';
    const suffix = cryptoId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-10);
    return `${stem}-${suffix}.${extension}`;
  }

  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Nie udało się odczytać obrazu.'));
      reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '');
      reader.readAsDataURL(file);
    });
  }

  function defaultImageAlt(file) {
    return String(file.name || 'Ilustracja').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 300) || 'Ilustracja';
  }

  function addUploadedMedia(panel, target, media, file) {
    const image = { ref: media.ref, alt: defaultImageAlt(file) };
    if (panel.dataset.examMediaScope === 'cover') {
      state.exam.metadata.cover = image;
      return;
    }
    const question = mediaQuestion(panel);
    const images = imagesForTarget(question, target) || imagesForTarget(question, 'question');
    if (images && !images.some((entry) => entry.ref === image.ref)) images.push(image);
  }

  async function uploadExamMediaFiles(files, panel) {
    if (!panel || state.mediaUploading) return;
    if (!state.remoteSha || state.remoteExamId !== state.exam.examId) {
      elements.status.className = 'exam-builder-status is-error';
      elements.status.textContent = 'Najpierw zapisz szkic egzaminu, aby móc dodać do niego obrazy.';
      return;
    }
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    const selected = files.slice(0, panel.dataset.examMediaScope === 'cover' ? 1 : 8);
    const invalid = selected.find((file) => !allowed.has(file.type) || file.size <= 0 || file.size > 4 * 1024 * 1024);
    if (invalid) {
      elements.status.className = 'exam-builder-status is-error';
      elements.status.textContent = 'Wybierz prawidłowy obraz PNG, JPG, WEBP lub GIF o rozmiarze do 4 MB.';
      return;
    }
    const target = panel.dataset.examMediaScope === 'cover'
      ? 'cover'
      : panel.querySelector('[data-exam-media-target]')?.value || state.mediaTarget || 'question';
    state.mediaUploading = true;
    elements.status.className = 'exam-builder-status';
    let uploadedCount = 0;
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        elements.status.textContent = `Wysyłanie obrazu ${index + 1}/${selected.length}: ${file.name || 'obraz'}…`;
        const media = await library.uploadExamMedia({
          examId: state.exam.examId,
          filename: mediaFilename(file),
          contentBase64: await fileBase64(file),
          mimeType: file.type,
          repositoryId: state.repositoryId
        });
        addUploadedMedia(panel, target, media, file);
        uploadedCount += 1;
      }
      elements.status.textContent = selected.length === 1
        ? 'Obraz dodano do egzaminu. Zapisz szkic, aby zachować zmianę.'
        : `Dodano obrazy: ${selected.length}. Zapisz szkic, aby zachować zmiany.`;
    } catch (error) {
      elements.status.classList.add('is-error');
      elements.status.textContent = error.message || 'Nie udało się wysłać obrazu.';
    } finally {
      if (uploadedCount) saveDrafts();
      state.mediaUploading = false;
      render();
      elements.badge.textContent = 'Niezapisane zmiany';
    }
  }

  function handleAction(event) {
    const button = event.target.closest('[data-exam-action]');
    if (!button) return;
    const action = button.dataset.examAction;
    const questionId = button.dataset.questionId;
    if (action === 'open-media-manager') {
      openExamMediaManager(button.closest('[data-exam-media-scope]'));
    } else if (action === 'choose-media') {
      if (!state.mediaUploading) button.closest('[data-exam-media-scope]')?.querySelector('[data-exam-media-input]')?.click();
    } else if (action === 'remove-media-reference') {
      const panel = button.closest('[data-exam-media-scope]');
      if (panel?.dataset.examMediaScope === 'cover') state.exam.metadata.cover = null;
      else {
        const images = imagesForTarget(mediaQuestion(panel), button.dataset.mediaTarget);
        if (images) images.splice(0, images.length, ...images.filter((image) => image.ref !== button.dataset.mediaRef));
      }
      render();
    } else if (action === 'add-question') {
      const question = modelApi.createQuestion(); state.exam.questions.push(question); state.selectedQuestionId = question.questionId; render();
    } else if (action === 'select-question') { state.selectedQuestionId = questionId; render(); }
    else if (action === 'duplicate-question') duplicateQuestion(state.exam.questions, questionId, false);
    else if (action === 'delete-question') deleteQuestion(state.exam.questions, questionId, false);
    else if (action === 'remove-bank-reference') { state.exam.questionRefs = state.exam.questionRefs.filter((id) => id !== questionId); render(); }
    else if (action === 'add-bank-question') {
      const question = modelApi.createQuestion(); state.bank.questions.push(question); state.selectedBankQuestionId = question.questionId; state.bankDirty = true; render();
    } else if (action === 'select-bank-question' || action === 'select-bank-reference') { state.selectedBankQuestionId = questionId; if (action === 'select-bank-question') render(); }
    else if (action === 'duplicate-bank-question') duplicateQuestion(state.bank.questions, questionId, true);
    else if (action === 'delete-bank-question') deleteQuestion(state.bank.questions, questionId, true);
    else if (action === 'use-bank-question') { if (!state.exam.questionRefs.includes(questionId)) state.exam.questionRefs.push(questionId); render(); }
    else if (action === 'refresh-report') void loadReport();
    else if (action === 'refresh-review') void loadReviewQueue();
    else if (action === 'first-report') void loadReport();
    else if (action === 'next-report' && state.report?.cursor) void loadReport(state.report.cursor);
    else if (action === 'open-attempt-report') void openAttemptReport(button.dataset.userId, button.dataset.attemptId);
    else if (action === 'reset-attempt') void resetAttempt(button.dataset.userId, button.dataset.attemptId);
    else if (action === 'ai-grade-attempt') void aiGradeAttemptReport(button);
    else if (action === 'grade-attempt') void gradeAttemptReport();
    else if (action === 'add-audience-user') {
      if (!state.exam.availability.userIds.includes(button.dataset.userId)) state.exam.availability.userIds.push(button.dataset.userId);
      state.exam.availability.audienceMode = 'selected'; render();
    } else if (action === 'remove-audience-user') {
      state.exam.availability.userIds = state.exam.availability.userIds.filter((userId) => userId !== button.dataset.userId); render();
    } else if (action === 'load-audience-users') void loadIdentityUsers(true);
    saveDrafts();
  }

  async function loadIdentityUsers(loadAll) {
    state.usersLoadAllRequested = state.usersLoadAllRequested || Boolean(loadAll);
    if (state.usersPromise || !state.usersHasMore) return state.usersPromise;
    state.usersLoading = true; state.usersError = '';
    const status = elements.editor.querySelector('[data-audience-status]');
    if (status) status.textContent = audienceStatus();
    state.usersPromise = (async () => {
      try {
        do {
          const page = state.usersPage + 1;
          const payload = await identityUsersPage(page);
          const known = new Map(state.users.map((user) => [user.id, user]));
          (payload.users || []).forEach((user) => { if (user?.id) known.set(user.id, user); });
          state.users = [...known.values()].sort((left, right) => userLabel(left, left.id).localeCompare(userLabel(right, right.id), 'pl'));
          state.usersPage = page;
          state.usersHasMore = Boolean(payload.pagination?.hasMore);
          state.usersTotal = Number.isFinite(Number(payload.pagination?.total)) ? Number(payload.pagination.total) : state.usersTotal;
        } while (state.usersHasMore && state.usersLoadAllRequested);
      } catch (error) {
        state.usersError = error.message || 'Nie udało się wczytać listy użytkowników.';
      } finally {
        state.usersLoading = false; state.usersPromise = null;
        if (!state.usersHasMore) state.usersLoadAllRequested = false;
        if (state.tab === 'access') render();
      }
    })();
    return state.usersPromise;
  }

  async function identityUsersPage(page) {
    const token = await window.ChemAuth.getAccessToken();
    const url = new URL('/.netlify/functions/admin-users', window.location.origin);
    url.searchParams.set('page', String(page)); url.searchParams.set('perPage', '100');
    const response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Nie udało się pobrać użytkowników.');
    return payload;
  }

  function duplicateQuestion(collection, questionId, bank) {
    const source = collection.find((question) => question.questionId === questionId);
    if (!source) return;
    const clone = modelApi.createQuestion({ ...structuredClone(source), questionId: '' });
    clone.prompt = `${clone.prompt} — kopia`;
    collection.splice(collection.indexOf(source) + 1, 0, clone);
    if (bank) { state.selectedBankQuestionId = clone.questionId; state.bankDirty = true; }
    else state.selectedQuestionId = clone.questionId;
    render();
  }

  function deleteQuestion(collection, questionId, bank) {
    if (!window.confirm('Usunąć to pytanie? Zmiana zostanie utrwalona, gdy zapiszesz szkic lub opublikujesz egzamin.')) return;
    const index = collection.findIndex((question) => question.questionId === questionId);
    if (index < 0) return;
    collection.splice(index, 1);
    if (bank) {
      state.exam.questionRefs = state.exam.questionRefs.filter((id) => id !== questionId);
      state.selectedBankQuestionId = collection[0]?.questionId || '';
      state.bankDirty = true;
    } else state.selectedQuestionId = collection[0]?.questionId || '';
    render();
  }

  function filterBank(query) {
    const normalized = String(query || '').trim().toLocaleLowerCase('pl');
    elements.editor.querySelectorAll('[data-bank-list] .exam-question-card').forEach((card, index) => {
      const question = state.bank.questions[index];
      card.hidden = Boolean(normalized) && !`${question.prompt} ${question.tags.join(' ')} ${question.categories.join(' ')}`.toLocaleLowerCase('pl').includes(normalized);
    });
  }

  async function saveExam(status) {
    if (state.saving) return;
    state.exam.status = status;
    const validation = modelApi.validateExam(state.exam);
    if (!validation.valid) { render(); elements.status.textContent = validation.errors[0].message; return; }
    const renamed = state.remoteSha && state.remoteExamId !== state.exam.examId;
    if (renamed && !window.confirm('ID wskazuje nową ścieżkę. Utworzyć nowy egzamin i pozostawić poprzedni bez zmian?')) return;
    state.saving = true; render();
    try {
      if (state.bankDirty || (!state.bankSha && state.bank.questions.length)) {
        const bankSaved = await library.save('question_bank', {
          filename: 'question-bank.json',
          content: modelApi.serializeQuestionBank(state.bank),
          expectedSha: state.bankSha,
          repositoryId: state.repositoryId
        });
        state.bankSha = bankSaved.sha || '';
        state.bankDirty = false;
      }
      const saved = await library.save('exam', {
        filename: state.exam.examId,
        content: modelApi.serializeExam(state.exam),
        expectedSha: renamed ? '' : state.remoteSha,
        repositoryId: state.repositoryId
      });
      state.remoteSha = saved.sha || '';
      state.remoteExamId = state.exam.examId;
      saveDrafts();
      elements.status.textContent = status === 'published' ? 'Egzamin został opublikowany.' : 'Szkic egzaminu zapisano.';
      await loadAssets(true, { keepBank: true });
      window.document.dispatchEvent(new CustomEvent('chemdisk-content-changed', {
        detail: { kind: 'exam', repositoryId: state.repositoryId }
      }));
    } catch (error) {
      elements.status.textContent = error.message || 'Nie udało się zapisać egzaminu.';
      elements.status.classList.add('is-error');
    } finally { state.saving = false; render(); }
  }

  function previewExam() {
    const validation = modelApi.validateExam(state.exam);
    if (!validation.valid || !state.remoteSha || state.remoteExamId !== state.exam.examId) {
      elements.status.textContent = validation.valid ? 'Zapisz egzamin przed podglądem.' : validation.errors[0].message;
      return;
    }
    const url = new URL(library.examUrl(state.exam.examId, state.repositoryId, modelApi.canonicalMaterialId(state.repositoryId, state.exam.examId)), window.location.origin);
    url.searchParams.set('preview', '1');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  async function deleteExam() {
    if (!state.remoteSha) return;
    try {
      const warning = await examDeletionWarning(state.exam.examId, state.repositoryId);
      if (!window.confirm(`${warning}Usunąć zapisany egzamin z biblioteki? Plik można odzyskać z historii repozytorium.`)) return;
      await library.remove('exam', { filename: state.exam.examId, expectedSha: state.remoteSha, repositoryId: state.repositoryId });
      state.remoteSha = '';
      state.remoteExamId = '';
      elements.status.textContent = 'Egzamin usunięto z biblioteki. Szkic na tym urządzeniu pozostał w edytorze.';
      await loadAssets(true, { keepBank: true });
      window.document.dispatchEvent(new CustomEvent('chemdisk-content-changed', {
        detail: { kind: 'exam', repositoryId: state.repositoryId }
      }));
    } catch (error) { elements.status.textContent = error.message || 'Nie udało się usunąć egzaminu.'; }
  }

  async function examDeletionWarning(examId, repositoryId) {
    const references = await adminRequest({ view: 'references', repo: repositoryId, exam: examId });
    const places = (references.references || []).slice(0, 12).map((entry) => (
      `• ${entry.source === 'lesson' ? 'Lekcja' : 'Dashboard'}: ${entry.title || entry.filename || entry.materialId}`
    ));
    return references.count
      ? `Egzamin jest używany w ${references.count} miejscu/miejscach. Usunięcie pozostawi niedziałające odwołania:\n${places.join('\n')}${references.count > places.length ? `\n• …i ${references.count - places.length} kolejnych` : ''}\n\n${references.note || ''}\n\n`
      : `${references.note || 'Nie znaleziono odwołań w Dashboardzie ani lekcjach.'}\n\n`;
  }

  async function deletionWarning(asset) {
    if (!asset?.filename) throw new Error('Nie wybrano egzaminu do usunięcia.');
    return examDeletionWarning(asset.filename, asset.repositoryId || state.repositoryId);
  }

  function assetDeleted(asset) {
    if (!asset?.filename) return;
    const repositoryId = asset.repositoryId || state.repositoryId;
    if (repositoryId !== state.repositoryId) return;
    state.assets = state.assets.filter((entry) => entry.filename !== asset.filename);
    if (state.remoteExamId === asset.filename) {
      state.remoteSha = '';
      state.remoteExamId = '';
      state.report = null;
      state.attemptReport = null;
      elements.status.textContent = 'Egzamin usunięto z biblioteki. Szkic na tym urządzeniu pozostał w edytorze.';
    }
    renderLibrary();
    render();
  }

  async function loadReport(cursor = '') {
    if (!state.remoteSha || state.reportLoading) return;
    state.reportLoading = true; render();
    try {
      state.report = await adminRequest({ view: 'overview', repo: state.repositoryId, exam: state.exam.examId, ...(cursor ? { cursor } : {}) });
      state.report.requestCursor = cursor;
      if (state.attemptReport && !state.report.attempts.some((attempt) => attempt.attemptId === state.attemptReport.attemptId)) state.attemptReport = null;
    } catch (error) { elements.status.textContent = error.message || 'Nie udało się pobrać raportu.'; }
    finally { state.reportLoading = false; render(); }
  }

  async function openAttemptReport(userId, attemptId) {
    if (state.gradingBusy || state.aiGrading) return;
    const request = ++state.attemptRequest; const scope = reviewScope();
    state.attemptLoading = true;
    if (state.tab === 'review') render();
    try {
      const payload = await adminRequest({ view: 'attempt', repo: state.repositoryId, exam: state.exam.examId, userId, attemptId });
      if (request !== state.attemptRequest || scope !== reviewScope()) return;
      state.attemptReport = payload.attempt;
    } catch (error) { if (request === state.attemptRequest && scope === reviewScope()) elements.status.textContent = error.message || 'Nie udało się pobrać próby.'; }
    finally { if (request === state.attemptRequest && scope === reviewScope()) { state.attemptLoading = false; render(); } }
  }

  async function resetAttempt(userId, attemptId) {
    if (state.gradingBusy || state.aiGrading) return;
    if (!window.confirm('Zresetować tę próbę? Pozostałe próby ucznia zostaną zachowane, a postęp egzaminu przeliczony ponownie.')) return;
    const scope = reviewScope();
    const draftKey = gradeDraftKey({ userId, attemptId });
    state.gradingBusy = true; render();
    try {
      await adminMutation({ repositoryId: state.repositoryId, examId: state.exam.examId, targetUserId: userId, attemptId, operationId: `admin-reset:${cryptoId()}` });
      state.gradeDrafts.delete(draftKey);
      if (scope !== reviewScope()) return;
      state.attemptReport = null;
      state.reviewUser = null;
      state.report = null;
      if (state.tab === 'review') await loadReviewQueue();
      else await loadReport();
    } catch (error) { elements.status.textContent = error.message || 'Nie udało się zresetować próby.'; }
    finally { state.gradingBusy = false; render(); }
  }

  async function gradeAttemptReport() {
    const attempt = state.attemptReport;
    if (!attempt || state.gradingBusy || state.aiGrading) return;
    const scope = reviewScope();
    const grades = Array.from(elements.editor.querySelectorAll('[data-exam-grade-points]')).filter((control) => control.value !== '').map((control) => ({
      questionId: control.dataset.examGradePoints,
      points: control.value === '' ? NaN : Number(control.value),
      feedback: elements.editor.querySelector(`[data-exam-grade-feedback="${CSS.escape(control.dataset.examGradePoints)}"]`)?.value || ''
    }));
    if (!grades.length || grades.some((grade) => !Number.isFinite(grade.points))) {
      elements.status.textContent = 'Wpisz punkty dla co najmniej jednego pytania. Puste pola pozostaną do oceny.';
      elements.status.classList.add('is-error');
      return;
    }
    state.gradingBusy = true; render();
    try {
      const payload = await adminGrade({
        action: 'grade', repositoryId: state.repositoryId, examId: state.exam.examId,
        targetUserId: attempt.userId, attemptId: attempt.attemptId, revision: attempt.revision,
        operationId: `admin-grade:${cryptoId()}`, grades
      });
      const drafts = state.gradeDrafts.get(gradeDraftKey(attempt));
      if (drafts) {
        grades.forEach((grade) => delete drafts[grade.questionId]);
        if (!Object.keys(drafts).length) state.gradeDrafts.delete(gradeDraftKey(attempt));
      }
      if (scope !== reviewScope()) return;
      acceptGradedAttempt(payload.attempt);
      elements.status.classList.remove('is-error');
      const warning = payload.warnings?.length ? ' Ocena jest zapisana; synchronizacja raportu dokończy się później.' : '';
      elements.status.textContent = payload.attempt.result?.gradingStatus === 'pending_review'
        ? `Punkty zapisano. Niektóre odpowiedzi nadal czekają na ocenę.${warning}`
        : `Punkty zapisano, a wynik ucznia został przeliczony.${warning}`;
      if (state.tab !== 'review') await loadReport();
    } catch (error) {
      elements.status.textContent = error.message || 'Nie udało się zapisać punktów.';
      elements.status.classList.add('is-error');
    } finally { state.gradingBusy = false; render(); }
  }

  function acceptGradedAttempt(attempt) {
    state.attemptReport = attempt;
    const update = (item) => item.attemptId === attempt.attemptId && (!item.userId || item.userId === attempt.userId)
      ? { ...item, gradingStatus: attempt.result?.gradingStatus, scorePercent: attempt.result?.scorePercent, passed: attempt.result?.passed, pendingQuestionCount: attempt.result?.pendingQuestionIds?.length || 0 } : item;
    if (state.reviewQueue?.scope === reviewScope()) state.reviewQueue.attempts = state.reviewQueue.attempts.map(update);
    if (state.reviewUser?.scope === reviewScope()) state.reviewUser.attempts = state.reviewUser.attempts.map(update);
    state.report = null;
  }

  async function aiGradeAttemptReport(button) {
    const attempt = state.attemptReport;
    if (!attempt || state.aiGrading || state.gradingBusy) return;
    if (state.gradeDrafts.has(gradeDraftKey(attempt))) { elements.status.textContent = 'Najpierw zapisz ręczne punkty i komentarze, zanim uruchomisz AI.'; return; }
    const scope = reviewScope();
    state.aiGrading = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'AI sprawdza odpowiedzi…';
    }
    elements.status.classList.remove('is-error');
    elements.status.textContent = 'AI ocenia oczekujące odpowiedzi. Zwykle jest to jedno zbiorcze wywołanie…';
    render();
    try {
      const payload = await adminGrade({
        action: 'ai-grade', repositoryId: state.repositoryId, examId: state.exam.examId,
        targetUserId: attempt.userId, attemptId: attempt.attemptId, revision: attempt.revision,
        operationId: `admin-ai-grade:${cryptoId()}`
      });
      if (scope !== reviewScope()) return;
      acceptGradedAttempt(payload.attempt);
      const warning = payload.warnings?.length ? ' Ocena jest zapisana; synchronizacja raportu dokończy się później.' : '';
      elements.status.textContent = payload.attempt.result?.gradingStatus === 'pending_review'
        ? `AI oceniło ${payload.aiGradedCount || 0} odpowiedzi.${payload.aiDeferredCount ? ` Kolejne ${payload.aiDeferredCount} czekają na następne kliknięcie „Oceń AI”.` : ' Pozostałe wymagają sprawdzenia.'}${aiReviewIssueSummary(payload)}${warning}`
        : `AI oceniło odpowiedzi, a wynik ucznia został przeliczony.${warning}`;
      if (state.tab !== 'review') await loadReport();
    } catch (error) {
      elements.status.textContent = error.message || 'Nie udało się uruchomić oceny AI.';
      elements.status.classList.add('is-error');
    } finally {
      state.aiGrading = false;
      render();
      // loadReport may have replaced the clicked button while grading a batch.
      elements.editor.querySelectorAll('[data-exam-action="ai-grade-attempt"]').forEach((control) => {
        control.disabled = false;
        control.textContent = '✦ Sprawdź oczekujące odpowiedzi za pomocą AI';
      });
    }
  }

  async function adminRequest(params) {
    const token = await window.ChemAuth.getAccessToken();
    const url = new URL('/.netlify/functions/admin-exams', window.location.origin);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, credentials: 'same-origin', cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Błąd raportu egzaminu.');
    return payload;
  }

  async function adminMutation(body) {
    const token = await window.ChemAuth.getAccessToken();
    const response = await fetch('/.netlify/functions/admin-exams', {
      method: 'DELETE', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Błąd resetowania próby.');
    return payload;
  }

  async function adminGrade(body) {
    const token = await window.ChemAuth.getAccessToken();
    if (!token) throw new Error('Sesja wygasła. Zaloguj się ponownie i otwórz raport.');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    let response, payload;
    try {
      response = await fetch('/.netlify/functions/admin-exams', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      payload = await response.json().catch(() => ({}));
    } catch {
      throw new Error('Nie otrzymano odpowiedzi serwera. Odśwież próbę przed ponowną oceną — poprzednia operacja mogła zostać zapisana.');
    } finally { window.clearTimeout(timeout); }
    if (!response.ok) {
      const messages = {
        AI_NOT_CONFIGURED: 'Najpierw przypisz konfigurację AI do modułu aiGrader w panelu AI / Modele.',
        AI_RATE_LIMITED: 'Dostawca AI ograniczył ruch. Spróbuj ponownie później albo oceń odpowiedzi ręcznie.',
        AI_PROVIDER_TIMEOUT: 'AI nie odpowiedziało w wymaganym czasie. Odpowiedzi są zachowane — możesz przyznać punkty ręcznie albo spróbować później.',
        AI_INVALID_KEY: 'Klucz API jest nieprawidłowy. Sprawdź konfigurację przypisaną do modułu aiGrader w AI / Modele.',
        AI_PERMISSION_DENIED: 'Klucz API nie ma dostępu do wybranego modelu. Sprawdź konfigurację aiGrader.',
        AI_MODEL_UNAVAILABLE: 'Wybrany model jest niedostępny. W AI / Modele wybierz dostępny model dla aiGrader.',
        AI_QUOTA_EXHAUSTED: 'Dostawca AI zgłasza wyczerpaną kwotę API. Sprawdź rozliczenia klucza albo oceń ręcznie.',
        AI_CREDIT_BALANCE_EXHAUSTED: 'Brak środków na koncie dostawcy API. Doładuj je albo oceń odpowiedzi ręcznie.',
        AI_CONCURRENT_REQUEST_LIMIT_REACHED: 'Inna operacja AI nadal trwa. Zaczekaj na jej zakończenie.',
        AI_LIMIT_STORAGE_UNAVAILABLE: 'Nie można odczytać limitów AI. Sprawdź dostęp do Netlify Blobs (SITE_ID i NETLIFY_API_TOKEN).',
        EMPTY_MODEL_RESPONSE: 'Model nie zwrócił oceny. Spróbuj innym modelem przypisanym do aiGrader albo oceń ręcznie.',
        AI_DISABLED_FOR_USER: 'Ocena AI jest wyłączona dla Twojego konta.',
        AI_GRADING_MISSING_KEY: 'W zapisanej próbie brakuje klucza odpowiedzi. Oceń ręcznie i uzupełnij klucz w edytorze dla przyszłych prób.',
        AI_GRADING_CONTEXT_TOO_LONG: 'Dane pytania przekraczają limit jednej analizy. Oceń odpowiedź ręcznie.',
        AI_GRADING_INSUFFICIENT_CONTEXT: 'AI wskazało brak informacji potrzebnych do oceny. Odpowiedź pozostaje bez punktacji do sprawdzenia.',
        AI_GRADING_INVALID_RESPONSE: 'AI nie zwróciło poprawnej punktacji. Spróbuj ponownie albo oceń ręcznie.',
        NO_AI_ANSWERS_TO_GRADE: 'Nie ma już oczekujących odpowiedzi przeznaczonych do oceny AI.',
        ATTEMPT_VERSION_CONFLICT: 'Raport został w międzyczasie zmieniony. Otwórz próbę ponownie i ponów ocenę.',
        ATTEMPT_NOT_FINISHED: 'Ta próba nie została jeszcze zakończona.'
      };
      const limit = /LIMIT.*(?:REACHED|EXCEEDED)/.test(payload.error || '');
      throw new Error((messages[payload.error] || (limit ? 'Osiągnięto limit AI dla tej operacji. Sprawdź AI Limity dla konta sprawdzającego i modułu aiGrader.' : payload.error) || 'Błąd zapisywania punktów.') + aiReviewIssueSummary(payload));
    }
    return payload;
  }

  function aiReviewIssueSummary(payload) {
    return (Array.isArray(payload.aiReviewIssues) ? payload.aiReviewIssues : []).slice(0, 3)
      .map((issue) => ` Pytanie ${issue.questionId}: ${String(issue.message || '').slice(0, 300)}`).join('');
  }

  function cryptoId() {
    return window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function splitList(value, separator = /[,\n]/) {
    return [...new Set(String(value || '').split(separator).map((item) => item.trim()).filter(Boolean))];
  }

  function parseImages(value) {
    return String(value || '').split('\n').map((line) => {
      const [ref, ...alt] = line.split('|');
      return { ref: ref.trim(), alt: alt.join('|').trim() || 'Ilustracja do pytania' };
    }).filter((image) => image.ref);
  }

  function imagesToText(images) {
    return (images || []).map((image) => `${image.ref} | ${image.alt}`).join('\n');
  }

  function answerImagesToText(images) {
    return (images || []).map((image) => `${image.ref} :: ${image.alt}`).join('; ');
  }

  function parseAnswerImages(value) {
    return String(value || '').split(';').map((item) => {
      const [ref, ...alt] = item.split('::');
      return { ref: String(ref || '').trim(), alt: alt.join('::').trim() || 'Ilustracja przy odpowiedzi' };
    }).filter((image) => image.ref);
  }

  function dateTimeLocal(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(value / 60);
    return minutes ? `${minutes} min ${value % 60} s` : `${value} s`;
  }

  window.ChemExamBuilder = { activate, assetDeleted, deletionWarning, flush: saveDrafts, openAsset };
  document.addEventListener('DOMContentLoaded', initialize);
})();
