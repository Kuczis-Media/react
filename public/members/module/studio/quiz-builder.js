(function initializeQuizBuilder(root) {
  'use strict';

  const modelApi = root.ChemQuizStudioModel;
  const library = root.ChemContentLibrary;
  const pagedListApi = root.ChemStudioPagedList;
  if (!modelApi || !library || !pagedListApi) return;

  const byId = (id) => root.document.getElementById(id);
  const elements = {
    workspace: byId('quiz-workspace'),
    repository: byId('quiz-repository-select'),
    search: byId('quiz-library-search'),
    library: byId('quiz-library'),
    libraryStatus: byId('quiz-library-status'),
    id: byId('quiz-id'),
    title: byId('quiz-title'),
    description: byId('quiz-description'),
    mode: byId('quiz-mode'), course: byId('quiz-course'), active: byId('quiz-active'),
    courseField: byId('quiz-course-field'), activeField: byId('quiz-active-field'),
    courseStatus: byId('quiz-course-status'), deckLink: byId('quiz-deck-link'),
    newDeckButton: byId('quiz-new-deck-button'),
    passingScore: byId('quiz-passing-score'),
    tags: byId('quiz-tags'),
    shuffle: byId('quiz-shuffle'),
    showFeedback: byId('quiz-show-feedback'),
    allowRetry: byId('quiz-allow-retry'),
    coverReference: byId('quiz-cover-reference'),
    coverSelect: byId('quiz-cover-select'),
    coverRemove: byId('quiz-cover-remove'),
    questions: byId('quiz-question-list'),
    questionCount: byId('quiz-question-count'),
    validation: byId('quiz-validation'),
    preview: byId('quiz-preview'),
    badge: byId('quiz-status-badge'),
    status: byId('quiz-builder-status'),
    newButton: byId('quiz-new-button'),
    deleteButton: byId('quiz-delete-button'),
    saveButton: byId('quiz-save-draft-button'),
    publishButton: byId('quiz-publish-button'),
    importCsvButton: byId('quiz-import-csv-button'),
    addCsvButton: byId('quiz-add-csv-button'),
    csvFileInput: byId('quiz-csv-file-input'),
    csvDialog: byId('quiz-csv-import-dialog'),
    csvPickButton: byId('quiz-csv-pick-button'),
    csvFilename: byId('quiz-csv-filename'),
    csvPasteInput: byId('quiz-csv-paste-input'),
    csvModeAppend: byId('quiz-csv-mode-append'),
    csvTarget: byId('quiz-csv-target'), csvHeader: byId('quiz-csv-header'), csvType: byId('quiz-csv-type'),
    csvDelimiter: byId('quiz-csv-delimiter'), csvDuplicates: byId('quiz-csv-duplicates'), csvMapping: byId('quiz-csv-mapping'),
    csvPreview: byId('quiz-csv-preview'),
    csvPreviewCount: byId('quiz-csv-preview-count'),
    csvPreviewTable: byId('quiz-csv-preview-table'),
    csvStatus: byId('quiz-csv-dialog-status'),
    csvConfirmButton: byId('quiz-csv-confirm-button'),
    csvCancelButton: byId('quiz-csv-cancel-button'),
    reportPanel: byId('quiz-report-panel'),
    reportDisclosure: byId('quiz-report-disclosure'),
    reportRefresh: byId('quiz-report-refresh'),
    reportStatus: byId('quiz-report-status'),
    reportBody: byId('quiz-report-body')
  };
  if (!elements.workspace) return;

  const DRAFT_KEY = 'chemdisk.studio.quiz.v1';
  const state = {
    quiz: null,
    repositoryId: '',
    repositories: [],
    assets: [],
    remoteId: '',
    remoteSha: '',
    loaded: false,
    active: false,
    busy: false,
    focusQuestionId: '',
    libraryPaging: pagedListApi.createState(),
    objectUrls: new Set(),
    previewImageObserver: null,
    report: null,
    attemptReport: null,
    reportLoading: false, reportError: '',
    courses: null, coursesLoading: false, coursesFailed: false, previewUrls: new Map(), previewGeneration: 0, deckImageCache: null
  };
  let draftTimer = null;
  let feedbackTimer = null;
  let openSequence = 0;
  let csvTarget = null, csvReadSequence = 0, csvFileSequence = 0, csvPreviewTimer = null, csvTargetError = '';

  const create = (tag, className, text) => {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function setStatus(message, error) {
    elements.status.textContent = message || '';
    elements.status.classList.toggle('is-error', Boolean(error));
  }

  function setLibraryStatus(message, error = false) {
    if (!elements.libraryStatus) return;
    elements.libraryStatus.textContent = message || '';
    elements.libraryStatus.classList.toggle('is-error', Boolean(error));
  }

  function saveLocal() {
    try { root.localStorage.setItem(DRAFT_KEY, JSON.stringify(state.quiz)); } catch (_) {}
  }

  function flush() {
    root.clearTimeout(draftTimer); draftTimer = null;
    if (state.quiz) saveLocal();
  }

  function scheduleFeedback() {
    root.clearTimeout(feedbackTimer);
    feedbackTimer = root.setTimeout(() => {
      feedbackTimer = null;
      renderValidation(); renderPreview();
    }, 180);
  }

  function loadDraft() {
    let value = null;
    try { value = root.localStorage.getItem(DRAFT_KEY); } catch (_) {}
    try { state.quiz = value ? modelApi.parse(value) : modelApi.createQuiz(); }
    catch (_) { state.quiz = modelApi.createQuiz(); }
  }

  function markChanged(message = 'Niezapisane zmiany zapisano lokalnie.') {
    root.clearTimeout(draftTimer);
    draftTimer = root.setTimeout(flush, 200);
    elements.badge.textContent = 'Szkic na tym urządzeniu';
    setStatus(message);
  }

  function questionLabel(count) {
    if (state.quiz?.mode === 'deck') return `${count} ${count === 1 ? 'karta' : 'kart'}`;
    if (count === 1) return '1 pytanie';
    if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return `${count} pytania`;
    return `${count} pytań`;
  }

  function renderSettings() {
    const { quiz } = state;
    const deck = quiz.mode === 'deck';
    elements.mode.value = deck ? 'deck' : 'quiz';
    elements.courseField.hidden = !deck; elements.activeField.hidden = !deck;
    elements.active.checked = quiz.metadata.active !== false;
    renderCourses();
    elements.passingScore.closest('label').hidden = deck;
    elements.showFeedback.closest('label').hidden = deck;
    elements.allowRetry.closest('label').hidden = deck;
    elements.reportPanel.hidden = false;
    if (elements.reportDisclosure) elements.reportDisclosure.hidden = false;
    const reportTitle = byId('quiz-report-title');
    if (reportTitle) reportTitle.textContent = deck ? 'Statystyki puli nauki' : 'Raport i ręczna punktacja';
    const reportLabel = elements.reportDisclosure?.querySelector('summary');
    if (reportLabel) reportLabel.textContent = deck ? 'Statystyki puli nauki' : 'Raport i ręczna punktacja';
    const reportEyebrow = elements.reportPanel.querySelector('small');
    if (reportEyebrow) reportEyebrow.textContent = deck ? 'Nauka i powtórki' : 'Odpowiedzi otwarte';
    root.document.querySelectorAll('[data-quiz-add]').forEach((button) => { button.hidden = deck && !root.ChemQuizPractice.DECK_TYPES.includes(button.dataset.quizAdd); });
    elements.deckLink.hidden = !deck;
    if (deck) {
      elements.deckLink.replaceChildren(create('small', '', 'Udostępnij pulę w kafelku Quiz na dashboardzie lub jako „Powtórka / Fiszki” w lekcji. '));
      if (state.remoteSha && state.remoteId === quiz.quizId) {
        const link = create('a', '', 'Otwórz podgląd ucznia ↗');
        const params = new URLSearchParams({ repo: state.repositoryId, quiz: quiz.quizId, preview: '1' });
        link.href = `/members/module/quiz/?${params}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
        elements.deckLink.append(link);
      }
      void loadCourses();
    }
    elements.id.value = quiz.quizId;
    elements.title.value = quiz.metadata.title;
    elements.description.value = quiz.metadata.description;
    elements.passingScore.value = String(quiz.settings.passingScore);
    elements.tags.value = quiz.metadata.tags.join(', ');
    elements.shuffle.checked = quiz.settings.shuffleQuestions;
    elements.showFeedback.checked = quiz.settings.showFeedback;
    elements.allowRetry.checked = quiz.settings.allowRetry;
    elements.coverReference.textContent = quiz.metadata.cover.ref || 'Brak obrazu';
    elements.coverRemove.disabled = !quiz.metadata.cover.ref;
    elements.deleteButton.disabled = !state.remoteSha || state.remoteId !== quiz.quizId || state.busy;
    elements.saveButton.disabled = state.busy;
    elements.publishButton.disabled = state.busy;
    elements.newButton.disabled = state.busy; elements.newDeckButton.disabled = state.busy;
    elements.badge.textContent = state.remoteSha && state.remoteId === quiz.quizId
      ? quiz.metadata.status === 'published' ? 'Opublikowany' : 'Zapisany szkic'
      : 'Szkic na tym urządzeniu';
  }

  async function loadCourses() {
    if (state.courses || state.coursesLoading || state.coursesFailed) return;
    state.coursesLoading = true;
    try {
      const token = await root.ChemAuth.getAccessToken();
      const response = await root.fetch('/.netlify/functions/admin-progress?view=config', {
        credentials: 'same-origin', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('COURSES_UNAVAILABLE');
      const payload = await response.json();
      state.courses = (payload.catalog?.nodes || []).filter((node) => node.type === 'course');
      if (!state.courses.length) state.courses = [{ id: 'course', title: 'Główny kurs platformy' }];
      renderCourses();
      elements.courseStatus.textContent = 'Kursy z dashboardu. Dostęp ucznia jest kontrolowany przez obecne uprawnienia platformy.';
    } catch (_) {
      state.coursesFailed = true;
      const retry = create('button', 'mini-button', 'Wczytaj kursy ponownie'); retry.type = 'button';
      retry.addEventListener('click', () => { state.coursesFailed = false; void loadCourses(); });
      elements.courseStatus.replaceChildren(create('span', '', 'Nie udało się wczytać kursów. '), retry);
    } finally { state.coursesLoading = false; }
  }

  function renderCourses() {
    const options = [{ id: '', title: 'Wybierz kurs…' }, ...(state.courses || [])];
    const selected = state.quiz.metadata.courseId || '';
    if (selected && !options.some((entry) => entry.id === selected)) options.push({ id: selected, title: `${selected} (wcześniejsze przypisanie)` });
    elements.course.replaceChildren(...options.map((entry) => {
      const option = create('option', '', entry.title); option.value = entry.id; return option;
    }));
    elements.course.value = selected;
  }

  function fieldLabel(label, control, className = '') {
    const wrapper = create('label', className);
    wrapper.append(create('span', '', label), control);
    if (control.tagName === 'TEXTAREA' && root.ChemAssessmentEditor) wrapper.append(root.ChemAssessmentEditor.equationButton(control));
    return wrapper;
  }

  function questionSelect(question) {
    const select = create('select', 'quiz-question-type');
    select.dataset.quizField = 'type';
    [
      ['single', 'Jedna odpowiedź'],
      ['multiple', 'Wiele odpowiedzi'],
      ['true_false', 'Prawda / fałsz'],
      ['text', 'Odpowiedź tekstowa'],
      ['open', 'Pytanie otwarte'], ['flashcard', 'Fiszka'], ['image_occlusion', 'Obraz z maskami']
    ].forEach(([value, label]) => {
      const option = create('option', '', label);
      option.value = value;
      select.append(option);
    });
    select.value = question.type;
    return select;
  }

  function renderOptions(question, index) {
    const section = create('div', 'quiz-options-editor');
    if (question.type === 'open') {
      const mode = create('select');
      mode.dataset.quizField = 'gradingMode';
      [
        ['ai', 'Uczeń uruchamia sprawdzanie AI'],
        ['manual', 'Sprawdzający przyznaje punkty'],
        ['ungraded', 'Bez punktów — nie licz do wyniku']
      ].forEach(([value, label]) => {
        const option = create('option', '', label); option.value = value; mode.append(option);
      });
      mode.value = question.gradingMode;
      const answerKey = create('textarea');
      answerKey.rows = 5; answerKey.maxLength = 10000; answerKey.value = question.answerKey;
      answerKey.placeholder = 'Wzorcowa odpowiedź i najważniejsze wymagane elementy';
      answerKey.dataset.quizField = 'answerKey';
      const instruction = create('textarea');
      instruction.rows = 3; instruction.maxLength = 2000; instruction.value = question.aiInstruction;
      instruction.placeholder = 'Opcjonalnie: kryteria punktacji, elementy częściowo poprawne…';
      instruction.dataset.quizField = 'aiInstruction';
      const multiline = create('input');
      multiline.type = 'checkbox'; multiline.checked = question.multiline !== false;
      multiline.dataset.quizField = 'multiline';
      section.append(
        fieldLabel('Sposób oceniania', mode),
        fieldLabel('Klucz odpowiedzi', answerKey),
        fieldLabel('Dodatkowe kryteria dla AI', instruction),
        fieldLabel('Odpowiedź wielowierszowa', multiline),
        create('small', 'quiz-options-hint', question.gradingMode === 'manual'
          ? 'Wynik ucznia pojawi się dopiero po przyznaniu punktów w raporcie.'
          : question.gradingMode === 'ungraded'
            ? 'Odpowiedź zostanie zachowana, ale pytanie nie zmieni wyniku.'
            : 'AI uruchomi się dopiero po kliknięciu przez ucznia „Sprawdź odpowiedzi za pomocą AI”. Jedno zbiorcze żądanie ogranicza zużycie funkcji i tokenów.')
      );
      return section;
    }
    if (question.type === 'text') {
      section.append(root.ChemAnswerFields.textList(question.acceptedAnswers, (values) => {
        question.acceptedAnswers = values;
        markChanged(); renderPreview();
      }, { maxLength: 500, maximum: 20, multiline: true, equations: true }));
      const settings = root.ChemQuizPractice.settings(question.textCompare);
      const tolerances = create('fieldset', 'quiz-text-tolerances');
      tolerances.append(create('legend', '', 'Porównywanie tekstu — bez AI'));
      for (const [key, label] of [['ignoreCase', 'Ignoruj wielkość liter'], ['collapseWhitespace', 'Ignoruj nadmiarowe spacje'], ['ignoreFinalPeriod', 'Ignoruj końcową kropkę']]) {
        const check = create('input'); check.type = 'checkbox'; check.checked = settings[key];
        check.addEventListener('change', () => { settings[key] = check.checked; question.textCompare = { ...settings }; markChanged(); scheduleFeedback(); });
        tolerances.append(fieldLabel(label, check, 'quiz-inline-check'));
      }
      const typos = create('select');
      for (const [value, label] of [[0, 'Bez literówek'], [1, 'Do 1 literówki'], [2, 'Do 2 literówek']]) {
        const option = create('option', '', label); option.value = String(value); typos.append(option);
      }
      typos.value = String(settings.maxTypos);
      typos.addEventListener('change', () => { settings.maxTypos = Number(typos.value); question.textCompare = { ...settings }; markChanged(); scheduleFeedback(); });
      tolerances.append(fieldLabel('Tolerancja literówek', typos), create('small', '', 'Literówki są akceptowane tylko przy podobieństwie co najmniej 80%. Przy symbolach chemicznych rozważ wyłączenie ignorowania wielkości liter. Porównujemy zapis, nie znaczenie ani równoważność wzorów.'));
      const advanced = create('details', 'quiz-editor-details');
      advanced.append(create('summary', '', 'Dostosuj sprawdzanie tekstu'), tolerances);
      section.append(advanced);
      return section;
    }
    section.append(create('small', 'quiz-options-hint', question.type === 'multiple'
      ? 'Zaznacz wszystkie poprawne odpowiedzi.'
      : 'Zaznacz jedną poprawną odpowiedź.'));
    question.options.forEach((option, optionIndex) => {
      const row = create('div', 'quiz-option-row');
      const correct = create('input');
      correct.type = question.type === 'multiple' ? 'checkbox' : 'radio';
      correct.name = `quiz-correct-${question.questionId}`;
      correct.checked = option.correct;
      correct.dataset.quizCorrect = '1';
      correct.dataset.optionId = option.optionId;
      correct.setAttribute('aria-label', `Poprawna odpowiedź ${optionIndex + 1} w pytaniu ${index + 1}`);
      const copy = create('textarea'); copy.rows = 2;
      copy.maxLength = 500;
      copy.value = option.text;
      copy.placeholder = `Wpisz odpowiedź ${String.fromCharCode(65 + optionIndex)}`;
      copy.setAttribute('aria-label', `Treść odpowiedzi ${optionIndex + 1} w pytaniu ${index + 1}`);
      copy.dataset.quizField = 'optionText';
      copy.dataset.optionId = option.optionId;
      const remove = create('button', 'mini-button is-danger', '×');
      remove.type = 'button';
      remove.title = 'Usuń odpowiedź';
      remove.setAttribute('aria-label', `Usuń odpowiedź ${optionIndex + 1}`);
      remove.dataset.quizAction = 'delete-option';
      remove.dataset.optionId = option.optionId;
      remove.disabled = question.type === 'true_false' || question.options.length <= 2;
      const content = create('div', 'quiz-option-content');
      content.append(create('small', 'quiz-correct-badge', '✓ Poprawna odpowiedź'));
      content.append(fieldLabel(`Odpowiedź ${String.fromCharCode(65 + optionIndex)}`, copy));
      const media = create('div', 'quiz-option-media');
      const choose = create('button', 'mini-button', option.image?.ref ? 'Podmień obraz' : 'Dodaj obraz'); choose.type = 'button';
      choose.dataset.quizAction = 'option-media'; choose.dataset.optionId = option.optionId;
      media.append(choose);
      if (option.image?.ref) {
        media.append(root.ChemQuizFlashcards.image(option.image, previewImageUrl));
        const alt = create('input'); alt.value = option.image.alt; alt.maxLength = 300;
        alt.dataset.quizField = 'optionAlt'; alt.dataset.optionId = option.optionId;
        media.append(fieldLabel('Opis obrazu', alt));
        const removeImage = create('button', 'mini-button', 'Usuń obraz'); removeImage.type = 'button';
        removeImage.dataset.quizAction = 'remove-option-media'; removeImage.dataset.optionId = option.optionId; media.append(removeImage);
      }
      content.append(media); row.append(correct, content, remove);
      section.append(row);
    });
    if (question.type !== 'true_false' && question.options.length < 6) {
      const add = create('button', 'mini-button quiz-add-option', '＋ Dodaj odpowiedź');
      add.type = 'button';
      add.dataset.quizAction = 'add-option';
      section.append(add);
    }
    return section;
  }

  function renderQuestions() {
    if (root.NextMedUI?.render('studio-quiz', elements.questions, { questions: state.quiz.questions, renderOptions, renderFlashcard, renderOcclusion, deck: state.quiz.mode === 'deck', focusQuestionId: state.focusQuestionId })) {
      elements.questionCount.textContent = questionLabel(state.quiz.questions.length);
      return;
    }
    const fragment = root.document.createDocumentFragment();
    state.quiz.questions.forEach((question, index) => {
      const card = create('article', 'quiz-question-card');
      card.dataset.questionId = question.questionId;
      const heading = create('header', 'quiz-question-card-heading');
      const title = create('div');
      title.append(create('small', '', `${question.type === 'flashcard' ? 'Fiszka' : 'Pytanie'} ${index + 1}`), create('strong', '', ['flashcard', 'image_occlusion'].includes(question.type) || state.quiz.mode === 'deck' ? 'Nauka bez punktów' : `${question.points} ${question.points === 1 ? 'punkt' : 'pkt'}`));
      const actions = create('div', 'quiz-question-actions');
      const up = create('button', 'mini-button', '↑'); up.type = 'button'; up.title = 'Przenieś wyżej'; up.dataset.quizAction = 'up'; up.disabled = index === 0;
      const down = create('button', 'mini-button', '↓'); down.type = 'button'; down.title = 'Przenieś niżej'; down.dataset.quizAction = 'down'; down.disabled = index === state.quiz.questions.length - 1;
      const duplicate = create('button', 'mini-button', 'Duplikuj'); duplicate.type = 'button'; duplicate.dataset.quizAction = 'duplicate';
      const remove = create('button', 'mini-button is-danger', 'Usuń'); remove.type = 'button'; remove.dataset.quizAction = 'delete'; remove.disabled = state.quiz.questions.length === 1;
      actions.append(up, down, duplicate, remove);
      heading.append(title, actions);
      if (question.type === 'flashcard') {
        card.append(heading, renderFlashcard(question)); fragment.append(card); return;
      }
      if (question.type === 'image_occlusion') {
        card.append(heading, renderOcclusion(question)); fragment.append(card); return;
      }

      const controls = create('div', 'quiz-question-controls');
      const points = create('input'); points.type = 'number'; points.min = '0'; points.max = '10000'; points.step = '0.1'; points.value = String(question.points); points.dataset.quizField = 'points';
      const required = create('input'); required.type = 'checkbox'; required.checked = question.required; required.dataset.quizField = 'required';
      controls.append(
        fieldLabel('Rodzaj', questionSelect(question)),
        fieldLabel('Punkty', points),
        fieldLabel('Wymagane', required, 'quiz-inline-check')
      );
      if (state.quiz.mode === 'deck') { points.closest('label').hidden = true; required.closest('label').hidden = true; }

      const prompt = create('textarea');
      prompt.rows = 3; prompt.maxLength = 3000; prompt.value = question.prompt; prompt.dataset.quizField = 'prompt';
      const explanation = create('textarea');
      explanation.rows = 2; explanation.maxLength = 3000; explanation.value = question.explanation; explanation.dataset.quizField = 'explanation'; explanation.placeholder = 'Opcjonalne wyjaśnienie po sprawdzeniu';

      const media = create('div', 'quiz-question-media');
      const mediaCopy = create('div');
      mediaCopy.append(create('small', '', 'Obraz do pytania'), create('code', '', question.image.ref || 'Brak obrazu'));
      const selectMedia = create('button', 'mini-button', 'Wybierz obraz'); selectMedia.type = 'button'; selectMedia.dataset.quizAction = 'select-media';
      const removeMedia = create('button', 'mini-button is-danger', 'Usuń obraz z pytania'); removeMedia.type = 'button'; removeMedia.dataset.quizAction = 'remove-media'; removeMedia.disabled = !question.image.ref;
      media.append(mediaCopy, selectMedia, removeMedia);

      card.append(
        heading,
        controls,
        fieldLabel('Treść pytania', prompt),
        media,
        renderOptions(question, index),
        fieldLabel('Informacja zwrotna / wyjaśnienie', explanation)
      );
      fragment.append(card);
    });
    elements.questions.replaceChildren(fragment);
    elements.questionCount.textContent = questionLabel(state.quiz.questions.length);
  }

  function renderOcclusion(question) {
    return root.ChemQuizOcclusion.editor(question, {
      getUrl: previewImageUrl, onImage: () => openMediaManager(question),
      onImageFile: (file) => uploadOcclusionImage(question, file),
      onChange: () => { markChanged(); scheduleFeedback(); }
    });
  }

  async function uploadOcclusionImage(question, file) {
    if (!root.ChemMediaManager?.uploadImage) throw new Error('Przesyłanie obrazów jest chwilowo niedostępne. Odśwież Studio.');
    const owner = state.quiz, repositoryId = state.repositoryId, quizId = owner.quizId;
    const previousRef = question.image.ref;
    if (question.occlusion.masks.length && !root.confirm('Podmiana obrazu usunie jego maski. Kontynuować?')) return false;
    const local = Boolean(state.remoteSha && state.remoteId === quizId);
    const asset = await root.ChemMediaManager.uploadImage(file, {
      repositoryId, scope: local ? 'local' : 'shared', materialKind: local ? 'quiz' : '', materialId: local ? quizId : ''
    });
    if (state.quiz !== owner || state.repositoryId !== repositoryId || owner.quizId !== quizId || !owner.questions.includes(question)) return false;
    if (question.image.ref !== previousRef) throw new Error('Obraz źródłowy został już zmieniony. Wysłany plik znajdziesz w bibliotece obrazów.');
    question.image = { ref: asset.reference, alt: String(file.name || 'Ilustracja').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 300) };
    question.occlusion.masks = [];
    markChanged('Obraz dodano. Możesz teraz rysować maski.');
    render();
    Array.from(elements.questions.children).find((node) => node.dataset.questionId === question.questionId)?.querySelector('.io-image-drop')?.focus({ preventScroll: true });
    return true;
  }

  function scrollQuizTarget(target) {
    if (!target) return;
    const panel = target.closest('.quiz-editor-panel, .quiz-preview-panel');
    if (panel && root.matchMedia?.('(min-width: 1181px)').matches) {
      // Do not scroll all ancestors: overflow-hidden workspaces can otherwise
      // be scrolled programmatically, moving the toolbar offscreen.
      const top = panel.scrollTop + target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
      panel.scrollTo?.({ top: Math.max(0, top), behavior: 'smooth' });
    } else target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  function resetQuizScroll() {
    if (elements.workspace) elements.workspace.scrollTop = 0;
    root.document.querySelectorAll('#quiz-workspace, .quiz-editor-panel, .quiz-preview-panel').forEach((panel) => { panel.scrollTop = 0; });
    if (elements.reportDisclosure) elements.reportDisclosure.open = false;
  }

  function renderFlashcard(question) {
    const editor = create('div', 'quiz-flashcard-editor');
    editor.append(create('p', 'quiz-editor-hint', '1. Wpisz pytanie z przodu. 2. Dodaj odpowiedź z tyłu. 3. Sprawdź podgląd. Równania wstawisz przyciskiem fx, a obrazy — przyciskiem pod tekstem.'));
    function insertSnippet(textarea, before, after = '', placeholder = '') {
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? start;
      const selected = after ? textarea.value.slice(start, end) || placeholder : '';
      const replacement = before + selected + after;
      if (textarea.maxLength > 0 && textarea.value.length - (end - start) + replacement.length > textarea.maxLength) return false;
      textarea.setRangeText(replacement, start, end, 'end');
      textarea.focus();
      if (after) textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    const faces = create('div', 'quiz-face-editors');
    for (const [side, label] of [['front', 'Przód — pytanie'], ['back', 'Tył — odpowiedź']]) {
      const section = create('fieldset', `quiz-face-editor is-${side}`); section.append(create('legend', '', label));

      const toolbar = create('div', 'quiz-flashcard-latex-toolbar');
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', `Narzędzia formatowania i LaTeX dla: ${label}`);

      const makeBtn = (text, title, onClick, extraClass = '') => {
        const b = create('button', `quiz-latex-btn mini-button ${extraClass}`.trim(), text);
        b.type = 'button';
        b.title = title;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', onClick);
        return b;
      };

      const input = create('textarea'); input.rows = 5; input.maxLength = 10000;
      input.value = question[side].text; input.dataset.quizField = `${side}Text`;
      input.placeholder = side === 'front' ? 'Np. Jaką funkcję pełnią mitochondria? Wzór: $\\ce{H2O}$' : 'Np. Wytwarzają ATP w procesie oddychania komórkowego.';

      toolbar.append(
        makeBtn('fx Wzór', 'Wstaw wzór matematyczny lub chemiczny ($...$)', () => insertSnippet(input, '$\\ce{', '}$', 'H2O'), 'is-primary-chip'),
        makeBtn('H₂O', 'Wstaw wzór chemiczny (\\ce{H2O})', () => insertSnippet(input, '$\\ce{', '}$', 'H2O')),
        makeBtn('x₂', 'Wstaw indeks dolny', () => insertSnippet(input, '_{', '}', '2')),
        makeBtn('x²', 'Wstaw indeks górny / potęgę', () => insertSnippet(input, '^{', '}', '2')),
        makeBtn('a/b', 'Wstaw ułamek (\\frac{a}{b})', () => insertSnippet(input, '$\\frac{', '}{b}$', 'a')),
        makeBtn('√x', 'Wstaw pierwiastek', () => insertSnippet(input, '$\\sqrt{', '}$', 'x')),
        makeBtn('→', 'Wstaw strzałkę reakcji', () => insertSnippet(input, ' \\rightarrow ')),
        makeBtn('⇌', 'Wstaw strzałkę równowagi', () => insertSnippet(input, ' \\rightleftharpoons ')),
        makeBtn('ΔH', 'Wstaw symbol entalpii', () => insertSnippet(input, ' \\Delta H ')),
        makeBtn('B', 'Pogrubienie (**tekst**)', () => insertSnippet(input, '**', '**', 'tekst'))
      );

      const formulaDrawer = create('div', 'quiz-formula-drawer');
      formulaDrawer.hidden = true;
      if (root.ChemAssessmentEditor?.formulaBuilder) {
        const toggleDrawerBtn = makeBtn('📐 Kreator równań', 'Otwórz zaawansowany kreator wzorów i reakcji', () => {
          formulaDrawer.hidden = !formulaDrawer.hidden;
        });
        toolbar.append(toggleDrawerBtn);

        formulaDrawer.append(root.ChemAssessmentEditor.formulaBuilder((formula) => {
          insertSnippet(input, `\\(${formula}\\)`);
          formulaDrawer.hidden = true;
        }, { insertLabel: 'Wstaw wzór do fiszki' }));
      }

      section.append(toolbar, formulaDrawer);
      section.append(fieldLabel(side === 'front' ? 'Co ma sobie przypomnieć uczeń?' : 'Jaka jest odpowiedź?', input));

      const livePreview = create('div', 'quiz-face-latex-preview');
      livePreview.hidden = true;
      const updateLivePreview = () => {
        const val = input.value;
        const hasMath = /[$|\\]|\\ce|\^|_|\\frac/.test(val);
        if (!hasMath || !val.trim()) {
          livePreview.hidden = true;
          livePreview.replaceChildren();
          return;
        }
        livePreview.hidden = false;
        livePreview.replaceChildren();
        const pLabel = create('small', 'quiz-face-latex-preview-label', '✨ Podgląd wzorów LaTeX:');
        const rendered = create('div', 'quiz-face-latex-rendered');
        if (root.ChemAssessmentText?.render) {
          root.ChemAssessmentText.render(rendered, val);
        } else {
          rendered.textContent = val;
          root.MathJax?.typesetPromise?.([rendered]).catch?.(() => {});
        }
        livePreview.append(pLabel, rendered);
      };
      input.addEventListener('input', updateLivePreview);
      root.setTimeout(updateLivePreview, 100);

      section.append(livePreview);
      question[side].images.forEach((entry, index) => {
        const row = create('div', 'quiz-question-media quiz-face-image');
        row.append(root.ChemQuizFlashcards.image(entry, previewImageUrl));
        const alt = create('input'); alt.value = entry.alt; alt.maxLength = 300;
        alt.dataset.quizField = 'flashcardAlt'; alt.dataset.side = side; alt.dataset.imageIndex = String(index);
        row.append(fieldLabel('Opis obrazka (opcjonalnie)', alt));
        for (const [action, title] of [['replace-flashcard-media', 'Podmień obraz'], ['remove-flashcard-media', 'Usuń obraz']]) {
          const button = create('button', 'mini-button', title); button.type = 'button';
          button.dataset.quizAction = action; button.dataset.side = side; button.dataset.imageIndex = String(index); row.append(button);
        }
        section.append(row);
      });
      const add = create('button', 'mini-button', `Dodaj obraz — ${side === 'front' ? 'przód' : 'tył'}`);
      add.type = 'button'; add.dataset.quizAction = 'add-flashcard-media'; add.dataset.side = side;
      add.disabled = question[side].images.length >= 8;
      section.append(add); faces.append(section);
    }
    editor.append(faces);
    const explanation = create('textarea'); explanation.rows = 3; explanation.maxLength = 3000;
    explanation.value = question.explanation; explanation.dataset.quizField = 'explanation';
    editor.append(fieldLabel('Wyjaśnienie (opcjonalnie)', explanation));
    const preview = create('details'); preview.append(create('summary', '', 'Podgląd tej fiszki i obrazów'));
    preview.className = 'quiz-editor-details';
    const refreshPreview = () => {
      if (preview.open && editor.isConnected) {
        const old = preview.querySelector('[data-flashcard-id]');
        const revealed = old?.querySelector('[data-flashcard-reveal]')?.getAttribute('aria-expanded') === 'true';
        if (old) { root.MathJax?.typesetClear?.([old]); old.remove(); }
        const next = root.ChemQuizFlashcards.card(question, previewImageUrl);
        preview.append(next);
        if (revealed) next.querySelector('[data-flashcard-reveal]')?.click();
      }
    };
    preview.addEventListener('toggle', refreshPreview);
    let timer;
    editor.addEventListener('input', () => {
      root.clearTimeout(timer);
      if (preview.open) timer = root.setTimeout(refreshPreview, 200);
    });
    editor.append(preview);
    return editor;
  }

  function previewImageUrl(ref) {
    if (state.quiz.mode === 'deck') {
      if (!state.deckImageCache) {
        const repositoryId = state.repositoryId, materialId = state.quiz.quizId;
        state.deckImageCache = root.ChemQuizFlashcards.imageCache((reference) => library.readMediaBlob({
          reference, repositoryId, scope: reference.startsWith('assets/shared/') ? 'shared' : 'local',
          materialKind: reference.startsWith('assets/shared/') ? '' : 'quiz',
          materialId: reference.startsWith('assets/shared/') ? '' : materialId
        }));
      }
      return state.deckImageCache.get(ref);
    }
    const key = `${state.repositoryId}:${state.quiz.quizId}:${ref}`;
    if (!state.previewUrls.has(key)) {
      const generation = state.previewGeneration;
      state.previewUrls.set(key, library.readMediaBlob({
        scope: ref.startsWith('assets/shared/') ? 'shared' : 'local',
        materialKind: ref.startsWith('assets/shared/') ? '' : 'quiz',
        materialId: ref.startsWith('assets/shared/') ? '' : state.quiz.quizId,
        reference: ref, repositoryId: state.repositoryId
      }).then((blob) => {
        if (generation !== state.previewGeneration) throw new Error('PREVIEW_CHANGED');
        const url = root.URL.createObjectURL(blob); state.objectUrls.add(url); return url;
      })
        .catch((error) => { state.previewUrls.delete(key); throw error; }));
    }
    return state.previewUrls.get(key);
  }

  function revokeObjectUrls() {
    state.previewGeneration += 1;
    state.previewImageObserver?.disconnect();
    state.previewImageObserver = null;
    state.objectUrls.forEach((url) => root.URL.revokeObjectURL(url));
    state.objectUrls.clear();
    state.previewUrls.clear();
    state.deckImageCache?.clear(); state.deckImageCache = null;
  }

  async function hydratePreviewImage(image, priority = false) {
    const ref = image.dataset.quizPreviewImage;
    try {
      const url = await previewImageUrl(ref);
      if (!image.isConnected) return;
      image.loading = priority ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.fetchPriority = priority ? 'high' : 'auto';
      image.src = url;
      image.hidden = false;
    } catch (_) {
      if (image.isConnected) image.replaceWith(create('span', 'quiz-preview-image-error', 'Nie udało się wczytać obrazu.'));
    }
  }

  function hydratePreviewImages() {
    const images = Array.from(elements.preview.querySelectorAll('[data-quiz-preview-image]'));
    const cover = images.find((image) => image.classList.contains('quiz-preview-cover'));
    if (cover) void hydratePreviewImage(cover, true);
    const questionImages = images.filter((image) => image !== cover);
    if (!questionImages.length) return;
    if (typeof root.IntersectionObserver !== 'function') {
      questionImages.forEach((image) => { void hydratePreviewImage(image); });
      return;
    }
    state.previewImageObserver = new root.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        state.previewImageObserver?.unobserve(entry.target);
        const image = entry.target.querySelector('[data-quiz-preview-image]');
        if (image) void hydratePreviewImage(image);
      });
    }, { root: elements.preview.closest('.quiz-preview-panel'), rootMargin: '320px 0px' });
    questionImages.forEach((image) => {
      const question = image.closest('.quiz-preview-question');
      if (question) state.previewImageObserver.observe(question);
    });
  }

  function previewQuestion(question, index) {
    if (question.type === 'image_occlusion') return root.ChemQuizOcclusion.player(question, previewImageUrl);
    if (question.type === 'flashcard') return root.ChemQuizFlashcards.card(question, previewImageUrl);
    const fieldset = create('fieldset', 'quiz-preview-question');
    fieldset.dataset.previewQuestion = question.questionId;
    const legend = create('legend', 'quiz-preview-sr-label', `Pytanie ${index + 1}`);
    const heading = create('div', 'quiz-preview-heading');
    heading.append(create('span', '', `${index + 1}.`), root.ChemQuizFlashcards.text(question.prompt, previewImageUrl), create('small', '', `${question.points} pkt`));
    fieldset.append(legend, heading);
    if (question.image.ref) {
      const image = create('img', 'quiz-preview-image');
      image.alt = question.image.alt || '';
      image.hidden = true;
      image.dataset.quizPreviewImage = question.image.ref;
      fieldset.append(image);
    }
    if (question.type === 'open') {
      const input = create(question.multiline === false ? 'input' : 'textarea');
      if (question.multiline !== false) input.rows = 5;
      input.placeholder = 'Twoja odpowiedź'; input.dataset.previewText = '1';
      fieldset.append(input);
    } else if (question.type === 'text') {
      const input = create('textarea'); input.rows = 2; input.maxLength = 500;
      input.placeholder = 'Twoja odpowiedź'; input.dataset.previewText = '1';
      fieldset.append(input);
    } else {
      question.options.forEach((option) => {
        const label = create('label', 'quiz-preview-option');
        const input = create('input');
        input.type = question.type === 'multiple' ? 'checkbox' : 'radio';
        input.name = `quiz-preview-${question.questionId}`;
        input.value = option.optionId;
        label.append(input, root.ChemQuizFlashcards.text(option.text, previewImageUrl));
        if (option.image?.ref) label.append(root.ChemQuizFlashcards.image(option.image, previewImageUrl));
        fieldset.append(label);
      });
    }
    const feedback = create('p', 'quiz-preview-feedback');
    feedback.hidden = true;
    fieldset.append(feedback);
    return fieldset;
  }

  function renderPreview() {
    // Keep cached managed images while typing; only release on material change.
    state.previewImageObserver?.disconnect();
    const quiz = state.quiz;
    root.NextMedUI?.releaseWithin?.(elements.preview);
    if (quiz.mode === 'deck' && root.ChemQuizFlashcards) {
      const props = { questions: quiz.questions, getUrl: previewImageUrl, preview: true, initialQuestionId: state.focusQuestionId };
      if (!root.NextMedUI?.render('quiz-deck', elements.preview, props)) elements.preview.replaceChildren(root.ChemQuizFlashcards.study(props));
      return;
    }
    const shell = create('form', 'quiz-preview-form');
    shell.addEventListener('submit', (event) => event.preventDefault());
    if (quiz.metadata.cover.ref) {
      const cover = create('img', 'quiz-preview-cover');
      cover.alt = quiz.metadata.cover.alt || '';
      cover.hidden = true;
      cover.dataset.quizPreviewImage = quiz.metadata.cover.ref;
      shell.append(cover);
    }
    shell.append(create('h2', '', quiz.metadata.title));
    if (quiz.metadata.description) shell.append(create('p', 'quiz-preview-description', quiz.metadata.description));
    quiz.questions.forEach((question, index) => shell.append(previewQuestion(question, index)));
    const result = create('p', 'quiz-preview-result');
    result.hidden = true;
    const check = create('button', 'button button-primary', 'Sprawdź odpowiedzi');
    check.type = 'button';
    check.addEventListener('click', () => checkPreview(shell, result));
    shell.append(check, result);
    elements.preview.replaceChildren(shell);
    if (quiz.metadata.cover.ref || quiz.questions.some((question) => question.image.ref)) hydratePreviewImages();
  }

  function checkPreview(form, resultNode) {
    const answers = {};
    state.quiz.questions.forEach((question) => {
      const fieldset = form.querySelector(`[data-preview-question="${question.questionId}"]`);
      if (!fieldset) return;
      if (['text', 'open'].includes(question.type)) answers[question.questionId] = fieldset.querySelector('[data-preview-text]')?.value || '';
      else answers[question.questionId] = Array.from(fieldset.querySelectorAll('input:checked')).map((input) => input.value);
    });
    const scored = modelApi.score(state.quiz, answers);
    scored.results.forEach((entry) => {
      const fieldset = form.querySelector(`[data-preview-question="${entry.questionId}"]`);
      const feedback = fieldset?.querySelector('.quiz-preview-feedback');
      if (!feedback) return;
      const question = state.quiz.questions.find((item) => item.questionId === entry.questionId);
      feedback.hidden = false;
      const pending = entry.reviewStatus === 'pending';
      const ungraded = entry.reviewStatus === 'not_scored';
      feedback.className = `quiz-preview-feedback ${pending || ungraded ? '' : entry.correct ? 'is-correct' : 'is-wrong'}`;
      feedback.textContent = pending
        ? 'Odpowiedź będzie oceniona przez AI lub sprawdzającego po wysłaniu.'
        : ungraded
          ? 'Odpowiedź zostanie zapisana, ale nie wpływa na wynik.'
          : `${entry.correct ? 'Poprawnie' : 'Niepoprawnie'} · ${entry.points}/${entry.maximum} pkt`;
      fieldset.querySelector('.quiz-practice-feedback')?.remove();
      if (!pending && !ungraded && question.type !== 'open') fieldset.append(root.ChemQuizFlashcards.feedback(question, root.ChemQuizPractice.evaluate(question, answers[question.questionId]), previewImageUrl, state.quiz.settings.showFeedback));
    });
    resultNode.hidden = false;
    resultNode.className = `quiz-preview-result ${scored.passed == null ? '' : scored.passed ? 'is-passed' : 'is-failed'}`;
    resultNode.textContent = scored.gradingStatus === 'pending_review'
      ? `Wynik oczekuje na ocenę pytań otwartych · obecnie ${scored.earned}/${scored.maximum} pkt.`
      : scored.gradingStatus === 'not_scored'
        ? 'Odpowiedzi zostaną zapisane, ale ten quiz nie ma punktacji.'
      : `${scored.earned}/${scored.maximum} pkt · ${scored.percent}% · ${scored.passed ? 'zaliczony' : 'jeszcze niezaliczony'}`;
  }

  function renderValidation(validation = modelApi.validate(state.quiz)) {
    elements.validation.replaceChildren();
    if (validation.valid) {
      const ok = create('div', 'quiz-validation-ok');
      const deck = state.quiz.mode === 'deck';
      ok.append(create('strong', '', deck ? '✓ Pula jest gotowa do zapisu' : '✓ Quiz jest gotowy do zapisu'), create('span', '', deck ? `${questionLabel(state.quiz.questions.length)} · nauka bez punktów` : `${state.quiz.questions.length} pytań · próg ${state.quiz.settings.passingScore}%`));
      elements.validation.append(ok);
      return;
    }
    const warning = create('div', 'quiz-validation-errors');
    warning.append(create('strong', '', 'Uzupełnij quiz przed zapisem'));
    const list = create('ul');
    validation.errors.slice(0, 8).forEach((error) => list.append(create('li', '', error.message)));
    warning.append(list);
    elements.validation.append(warning);
  }

  function renderLibrary() {
    const assets = library.search(state.assets, elements.search.value);
    const paged = pagedListApi.page(state.libraryPaging, 'quiz-library', assets);
    elements.library.replaceChildren(...paged.items.map((asset) => {
      const button = create('button', `repository-asset${state.remoteId === asset.filename ? ' is-active' : ''}`);
      button.type = 'button';
      const copy = create('span');
      copy.append(create('strong', '', asset.title || asset.filename), create('small', '', asset.filename));
      button.append(
        create('span', 'repository-asset-kind', 'QUIZ'),
        copy,
        create('span', 'repository-asset-action', 'Otwórz')
      );
      button.addEventListener('click', () => void openAsset(asset));
      return button;
    }));
    if (assets.length) {
      elements.library.append(pagedListApi.controls(root.document, state.libraryPaging, paged, {
        label: 'quizów',
        onMore: renderLibrary
      }));
      setLibraryStatus(`${assets.length} pasujących quizów.`);
    } else {
      setLibraryStatus(state.assets.length ? 'Brak quizów pasujących do wyszukiwania.' : 'Brak quizów w tej bibliotece.');
    }
  }

  function render() {
    root.clearTimeout(feedbackTimer); feedbackTimer = null;
    renderSettings();
    renderQuestions();
    renderValidation();
    renderPreview();
    renderLibrary();
    renderReport();
  }

  function renderReport() {
    if (!elements.reportBody) return;
    elements.reportRefresh.disabled = state.reportLoading || !state.remoteSha || state.remoteId !== state.quiz.quizId;
    elements.reportRefresh.textContent = state.reportLoading ? 'Pobieranie…' : '↻ Odśwież raport';
    elements.reportBody.replaceChildren();
    if (!state.remoteSha || state.remoteId !== state.quiz.quizId) {
      elements.reportStatus.textContent = 'Zapisz quiz lub otwórz go z biblioteki, aby zobaczyć raport.';
      return;
    }
    if (!state.report || ((state.report.kind === 'study') !== (state.quiz.mode === 'deck'))) {
      elements.reportStatus.textContent = state.reportError || (state.quiz.mode === 'deck' ? 'Kliknij „Odśwież raport”, aby pobrać statystyki puli.' : 'Kliknij „Odśwież raport”, aby pobrać odpowiedzi oczekujące na ocenę.');
      return;
    }
    if (state.report.kind === 'study') { renderStudyReport(); return; }
    const metrics = create('div', 'quiz-report-metrics');
    [
      ['Uczestnicy', state.report.metrics.participants],
      ['Próby z pytaniami otwartymi', state.report.metrics.attempts],
      ['Do sprawdzenia', state.report.metrics.pendingReview],
      ['Ocenione', state.report.metrics.graded],
      ['Średnia', `${state.report.metrics.average}%`]
    ].forEach(([label, value]) => {
      const item = create('article'); item.append(create('small', '', label), create('strong', '', value)); metrics.append(item);
    });
    const list = create('div', 'quiz-report-attempts');
    state.report.attempts.forEach((attempt) => {
      const button = create('button'); button.type = 'button'; button.dataset.quizReportAction = 'open';
      button.dataset.userId = attempt.userId; button.dataset.attemptId = attempt.attemptId;
      button.append(
        create('span', '', attempt.profile?.name || attempt.profile?.email || attempt.userId),
        create('strong', '', attempt.gradingStatus === 'pending_review'
          ? `Próba ${attempt.number} · oczekuje na ocenę`
          : attempt.gradingStatus === 'not_scored'
            ? `Próba ${attempt.number} · bez punktacji`
            : `Próba ${attempt.number} · ${attempt.scorePercent ?? '—'}%`)
      );
      list.append(button);
    });
    if (!state.report.attempts.length) list.append(create('p', '', 'Brak prób wymagających raportowania.'));
    elements.reportStatus.textContent = state.report.metricsScope === 'page' ? 'Statystyki dotyczą tej części raportu. Pozostałe próby wczytasz przyciskiem poniżej.' : 'Raport jest aktualny.';
    elements.reportBody.append(metrics, list);
    const paging = create('div', 'react-list-more');
    for (const [action, label, visible] of [['first', 'Od początku', state.report.requestCursor], ['next', 'Następna część', state.report.cursor]]) {
      if (!visible) continue;
      const button = create('button', 'button button-soft', label);
      button.type = 'button'; button.dataset.quizReportAction = action; button.disabled = state.reportLoading;
      paging.append(button);
    }
    elements.reportBody.append(paging);
    if (state.attemptReport) elements.reportBody.append(quizAttemptReport(state.attemptReport));
  }

  function quizAttemptReport(attempt) {
    const section = create('section', 'quiz-attempt-report');
    section.append(create('h3', '', `${attempt.profile?.name || attempt.profile?.email || attempt.userId} · próba ${attempt.number}`));
    attempt.questions.forEach((question, index) => {
      const graded = attempt.result?.results?.find((entry) => entry.questionId === question.questionId);
      const details = document.createElement('details'); details.open = question.type === 'open';
      const summary = document.createElement('summary');
      summary.append(
        create('span', '', `${index + 1}. ${question.prompt}`),
        create('strong', '', question.type === 'open' && question.gradingMode === 'ungraded'
          ? 'bez punktów'
          : `${graded?.points ?? '—'}/${graded?.maxPoints ?? question.points} pkt`)
      );
      details.append(summary, create('pre', '', `Odpowiedź ucznia:\n${String(attempt.answers?.[question.questionId] ?? 'Brak odpowiedzi')}`));
      if (question.type === 'open' && question.gradingMode !== 'ungraded' && Number(question.points) > 0) {
        const editor = create('div', 'quiz-grade-editor');
        const points = create('input'); points.type = 'number'; points.min = '0'; points.max = String(graded?.maxPoints ?? question.points); points.step = '0.1'; points.value = graded?.points ?? '';
        points.dataset.quizGradePoints = question.questionId;
        const feedback = create('textarea'); feedback.rows = 3; feedback.maxLength = 2000; feedback.value = graded?.feedback || ''; feedback.placeholder = 'Komentarz dla ucznia';
        feedback.dataset.quizGradeFeedback = question.questionId;
        editor.append(fieldLabel(`Punkty (maks. ${graded?.maxPoints ?? question.points})`, points), fieldLabel('Komentarz', feedback));
        details.append(editor);
      }
      section.append(details);
    });
    if (attempt.questions.some((question) => question.type === 'open' && question.gradingMode !== 'ungraded' && question.points > 0)) {
      const save = create('button', 'button button-primary', 'Zapisz punkty i przelicz wynik');
      save.type = 'button'; save.dataset.quizReportAction = 'grade'; section.append(save);
    }
    return section;
  }

  function renderStudyReport() {
    const report = state.report, m = report.metrics, metrics = create('div', 'quiz-report-metrics');
    const pct = (value) => value == null ? '—' : `${value}%`;
    for (const [label, value] of [['Uczniowie, którzy rozpoczęli', m.participants], ['Średnia skuteczność ucznia', pct(m.average)], ['Poprawne odpowiedzi', pct(m.correctPercent)], ['Oznaczenia „Trudne”', m.hardMarks], ['Odpowiedzi / powtórki', m.attempts]]) {
      const item = create('article'); item.append(create('small', '', label), create('strong', '', value)); metrics.append(item);
    }
    elements.reportBody.append(metrics, create('p', '', 'Średnia skuteczność: średnia wyników uczniów z odpowiedziami. Procent poprawnych: poprawne / wszystkie odpowiedzi. Fiszki i maski opierają się na samoocenie. Licznik oznaczeń „Trudne” jest zbierany od sesji 5; obecnie trudne karty: ' + m.hard + '.'));
    elements.reportBody.append(create('h3', '', 'Najtrudniejsze pytania'));
    const hardest = [...report.questions].filter((q) => q.attempts).sort((a, b) => a.correct / a.attempts - b.correct / b.attempts || b.attempts - a.attempts || a.questionId.localeCompare(b.questionId)).slice(0, 10);
    const list = create('ol', 'study-report-questions');
    for (const q of hardest) {
      const item = create('li'), prompt = create('div');
      if (root.ChemAssessmentText) root.ChemAssessmentText.render(prompt, q.prompt); else prompt.textContent = q.prompt;
      item.append(prompt, create('p', '', `${Math.round(q.correct / q.attempts * 10000) / 100}% poprawnych · ${q.correct}/${q.attempts} odpowiedzi · Trudne: ${q.hardMarks}`)); list.append(item);
    }
    if (!hardest.length) elements.reportBody.append(create('p', '', 'Brak danych o odpowiedziach na pytania.'));
    else elements.reportBody.append(list);
    if (m.missingQuestionStats) elements.reportBody.append(create('p', '', `Starsze podsumowania bez podziału na pytania: ${m.missingQuestionStats}. Podział zostanie uzupełniony przy następnym otwarciu puli przez ucznia.`));
    elements.reportStatus.textContent = state.reportError || `${report.cursor ? 'Częściowe statystyki' : 'Wczytano wszystkie konta'} · Sprawdzone konta: ${report.scannedUsers}. Dane odświeżane na żądanie.`;
    if (report.cursor) {
      const more = create('button', 'button button-soft', 'Wczytaj kolejne konta do statystyk'); more.type = 'button'; more.dataset.quizReportAction = 'next'; more.disabled = state.reportLoading; elements.reportBody.append(more);
    }
  }

  function mergeStudyReport(previous, page) {
    if (!previous) return page;
    const metrics = { ...page.metrics };
    for (const key of ['participants', 'attempts', 'correct', 'incorrect', 'hard', 'hardMarks', 'learnerPercentSum', 'learnersWithAnswers', 'missingQuestionStats']) metrics[key] += previous.metrics[key];
    metrics.average = metrics.learnersWithAnswers ? Math.round(metrics.learnerPercentSum / metrics.learnersWithAnswers * 100) / 100 : null;
    metrics.correctPercent = metrics.attempts ? Math.round(metrics.correct / metrics.attempts * 10000) / 100 : null;
    const questions = new Map(previous.questions.map((q) => [q.questionId, { ...q }]));
    for (const q of page.questions) {
      if (!questions.has(q.questionId)) questions.set(q.questionId, { ...q });
      else for (const key of ['attempts', 'correct', 'incorrect', 'hardMarks']) questions.get(q.questionId)[key] += q[key];
    }
    return { ...page, metrics, questions: [...questions.values()], scannedUsers: previous.scannedUsers + page.scannedUsers };
  }

  async function loadReport(cursor = '') {
    if (state.reportLoading || !state.remoteSha) return;
    const sequence = openSequence, repo = state.repositoryId, id = state.quiz.quizId, deck = state.quiz.mode === 'deck';
    state.reportLoading = true; state.reportError = ''; renderReport();
    try {
      const page = await quizAdminRequest({ view: deck ? 'study' : 'overview', repo, quiz: id, ...(cursor ? { cursor } : {}) });
      if (sequence !== openSequence || repo !== state.repositoryId || id !== state.quiz.quizId) return;
      state.report = deck ? mergeStudyReport(cursor ? state.report : null, page) : page;
      state.report.requestCursor = cursor;
      if (state.attemptReport && !state.report.attempts?.some((attempt) => attempt.attemptId === state.attemptReport.attemptId)) state.attemptReport = null;
    } catch (error) {
      if (sequence === openSequence) state.reportError = error.message;
    } finally { state.reportLoading = false; renderReport(); }
  }

  async function openQuizAttempt(userId, attemptId) {
    try {
      const payload = await quizAdminRequest({ view: 'attempt', repo: state.repositoryId, quiz: state.quiz.quizId, userId, attemptId });
      state.attemptReport = payload.attempt; renderReport();
    } catch (error) { elements.reportStatus.textContent = error.message; }
  }

  async function gradeQuizAttempt() {
    const attempt = state.attemptReport;
    if (!attempt) return;
    const grades = Array.from(elements.reportBody.querySelectorAll('[data-quiz-grade-points]')).map((control) => ({
      questionId: control.dataset.quizGradePoints,
      points: control.value === '' ? NaN : Number(control.value),
      feedback: elements.reportBody.querySelector(`[data-quiz-grade-feedback="${CSS.escape(control.dataset.quizGradePoints)}"]`)?.value || ''
    }));
    if (!grades.length || grades.some((grade) => !Number.isFinite(grade.points))) {
      elements.reportStatus.textContent = 'Wpisz punkty dla każdego ocenianego pytania.'; return;
    }
    try {
      const payload = await quizAdminMutation({
        action: 'grade', repositoryId: state.repositoryId, quizId: state.quiz.quizId,
        targetUserId: attempt.userId, attemptId: attempt.attemptId, revision: attempt.revision,
        operationId: `quiz-grade:${root.crypto?.randomUUID?.() || Date.now()}`, grades
      });
      state.attemptReport = payload.attempt;
      elements.reportStatus.textContent = payload.warnings?.length
        ? 'Punkty są zapisane. Synchronizacja części raportu dokończy się później.'
        : 'Punkty zapisano i wynik ucznia został przeliczony.';
      await loadReport();
    } catch (error) { elements.reportStatus.textContent = error.message; }
  }

  async function quizAdminRequest(params) {
    const token = await root.ChemAuth.getAccessToken();
    const url = new URL('/.netlify/functions/admin-quizzes', root.location.origin);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Nie udało się pobrać raportu quizu.');
    return payload;
  }

  async function quizAdminMutation(body) {
    const token = await root.ChemAuth.getAccessToken();
    const response = await fetch('/.netlify/functions/admin-quizzes', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Nie udało się zapisać punktów.');
    return payload;
  }

  async function loadLibrary(refresh = false) {
    setLibraryStatus('Pobieranie biblioteki quizów…');
    try {
      if (!state.repositories.length) state.repositories = await library.repositories();
      if (!state.repositoryId) state.repositoryId = state.repositories.find((entry) => entry.default)?.id || state.repositories[0]?.id || '';
      elements.repository.replaceChildren(...state.repositories.map((entry) => {
        const option = create('option', '', entry.label || entry.repository || entry.id);
        option.value = entry.id;
        return option;
      }));
      elements.repository.value = state.repositoryId;
      state.assets = await library.list('quiz', { repositoryId: state.repositoryId, refresh });
      renderLibrary();
    } catch (error) {
      setLibraryStatus(error?.message || 'Nie udało się wczytać biblioteki quizów.', true);
      setStatus(error?.message || 'Nie udało się wczytać biblioteki quizów.', true);
    }
  }

  function updateMetadata() {
    if (state.quiz.quizId !== elements.id.value.trim().toLowerCase()) revokeObjectUrls();
    state.quiz.quizId = elements.id.value.trim().toLowerCase();
    state.quiz.metadata.title = elements.title.value;
    state.quiz.metadata.description = elements.description.value;
    if (state.quiz.mode === 'deck') {
      state.quiz.metadata.courseId = elements.course.value;
      state.quiz.metadata.active = elements.active.checked;
    }
    state.quiz.metadata.tags = elements.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
    state.quiz.settings.passingScore = Math.max(0, Math.min(100, Math.round(Number(elements.passingScore.value) || 0)));
    state.quiz.settings.shuffleQuestions = elements.shuffle.checked;
    state.quiz.settings.showFeedback = elements.showFeedback.checked;
    state.quiz.settings.allowRetry = elements.allowRetry.checked;
    markChanged();
    scheduleFeedback();
    renderSettings();
  }

  function questionFor(node) {
    const card = node.closest('[data-question-id]');
    return state.quiz.questions.find((question) => question.questionId === card?.dataset.questionId) || null;
  }

  function updateQuestionControl(control, rerender) {
    const question = questionFor(control);
    if (!question) return;
    const field = control.dataset.quizField;
    if (!field && !control.dataset.quizCorrect) return;
    if (field === 'type') {
      if (state.quiz.mode === 'deck' && !root.ChemQuizPractice.DECK_TYPES.includes(control.value)) { control.value = question.type; return; }
      const replacement = modelApi.createQuestion({ ...clone(question), type: control.value, questionId: question.questionId });
      state.quiz.questions.splice(state.quiz.questions.indexOf(question), 1, replacement);
    } else if (['frontText', 'backText'].includes(field) && question.type === 'flashcard') {
      question[field === 'frontText' ? 'front' : 'back'].text = control.value.slice(0, 10000);
      question.prompt = question.front.text.slice(0, 3000);
    } else if (field === 'flashcardAlt' && question.type === 'flashcard') {
      const image = question[control.dataset.side]?.images?.[Number(control.dataset.imageIndex)];
      if (image) image.alt = control.value.slice(0, 300);
    } else if (field === 'prompt') question.prompt = control.value;
    else if (field === 'points') question.points = Math.round(Math.max(0, Math.min(10000, Number(control.value) || 0)) * 100) / 100;
    else if (field === 'required') question.required = control.checked;
    else if (field === 'explanation') question.explanation = control.value;
    else if (field === 'acceptedAnswers') question.acceptedAnswers = control.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 20);
    else if (field === 'gradingMode') question.gradingMode = ['ai', 'manual', 'ungraded'].includes(control.value) ? control.value : 'manual';
    else if (field === 'answerKey') question.answerKey = control.value.slice(0, 10000);
    else if (field === 'aiInstruction') question.aiInstruction = control.value.slice(0, 2000);
    else if (field === 'multiline') question.multiline = control.checked;
    else if (field === 'optionText') {
      const option = question.options.find((entry) => entry.optionId === control.dataset.optionId);
      if (option) option.text = control.value;
    } else if (field === 'optionAlt') {
      const option = question.options.find((entry) => entry.optionId === control.dataset.optionId);
      if (option?.image) option.image.alt = control.value.slice(0, 300);
    } else if (control.dataset.quizCorrect) {
      if (question.type !== 'multiple') question.options.forEach((option) => { option.correct = false; });
      const option = question.options.find((entry) => entry.optionId === control.dataset.optionId);
      if (option) option.correct = control.checked;
    }
    markChanged();
    if (rerender) render();
    else scheduleFeedback();
  }

  function moveQuestion(question, offset) {
    const index = state.quiz.questions.indexOf(question);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= state.quiz.questions.length) return;
    state.quiz.questions.splice(index, 1);
    state.quiz.questions.splice(target, 0, question);
  }

  function handleQuestionAction(button) {
    const action = button.dataset.quizAction;
    const question = questionFor(button);
    if (!question) return;
    if (action === 'preview-question') {
      state.focusQuestionId = question.questionId;
      renderPreview();
      const target = state.quiz.mode === 'deck' ? elements.preview.querySelector('.quiz-deck-study')
        : Array.from(elements.preview.querySelectorAll('[data-preview-question], [data-flashcard-id], [data-occlusion-id]')).find((node) => Object.values(node.dataset).includes(question.questionId));
      scrollQuizTarget(target || elements.preview);
      return;
    }
    if (action.endsWith('flashcard-media') && question.type === 'flashcard') {
      const side = button.dataset.side;
      if (!['front', 'back'].includes(side)) return;
      const index = Number(button.dataset.imageIndex);
      if (action === 'remove-flashcard-media') question[side].images.splice(index, 1);
      else { openMediaManager(question, side, action === 'replace-flashcard-media' ? index : -1); return; }
      markChanged(); render(); return;
    }
    if (action === 'up') moveQuestion(question, -1);
    else if (action === 'down') moveQuestion(question, 1);
    else if (action === 'duplicate') {
      if (state.quiz.questions.length >= 200) return;
      const index = state.quiz.questions.indexOf(question);
      state.quiz.questions.splice(index + 1, 0, modelApi.duplicateQuestion(question));
    } else if (action === 'delete' && state.quiz.questions.length > 1) {
      if (!root.confirm('Usunąć to pytanie?')) return;
      state.quiz.questions = state.quiz.questions.filter((entry) => entry !== question);
    } else if (action === 'add-option') {
      if (question.options.length >= 6) return;
      question.options.push(modelApi.createOption({ text: `Odpowiedź ${question.options.length + 1}` }, question.options.length));
    } else if (action === 'delete-option' && question.options.length > 2) {
      question.options = question.options.filter((entry) => entry.optionId !== button.dataset.optionId);
      if (!question.options.some((option) => option.correct)) question.options[0].correct = true;
    } else if (action === 'option-media') {
      openMediaManager(question, 'option', button.dataset.optionId); return;
    } else if (action === 'remove-option-media') {
      const option = question.options.find((entry) => entry.optionId === button.dataset.optionId);
      if (option) delete option.image;
    } else if (action === 'select-media') {
      openMediaManager(question);
      return;
    } else if (action === 'remove-media') {
      if (question.type === 'image_occlusion' && question.occlusion.masks.length) {
        if (!root.confirm('Usunąć obraz wraz z maskami z tego pytania? Plik pozostanie w bibliotece.')) return;
        question.occlusion.masks = [];
      }
      question.image = { ref: '', alt: '' };
    } else return;
    markChanged();
    render();
  }

  function addQuestion(type) {
    if (state.quiz.questions.length >= 200 || (state.quiz.mode === 'deck' && !root.ChemQuizPractice.DECK_TYPES.includes(type))) return;
    const question = modelApi.createQuestion({ type, prompt: `Nowe pytanie ${state.quiz.questions.length + 1}` });
    state.focusQuestionId = question.questionId;
    state.quiz.questions.push(question);
    markChanged('Pytanie dodano do szkicu na tym urządzeniu.');
    render();
    scrollQuizTarget(elements.questions.lastElementChild);
    elements.questions.lastElementChild?.querySelector('textarea')?.focus({ preventScroll: true });
  }

  function openMediaManager(question = null, side = '', index = -1) {
    if (!root.ChemMediaManager?.open) {
      setStatus('Media Manager jest chwilowo niedostępny.', true);
      return;
    }
    const canUseLocal = Boolean(state.remoteSha && state.remoteId === state.quiz.quizId);
    const owner = state.quiz;
    void root.ChemMediaManager.open({
      scope: canUseLocal ? 'local' : 'shared',
      materialKind: canUseLocal ? 'quiz' : '',
      materialId: canUseLocal ? state.quiz.quizId : '',
      repositoryId: state.repositoryId,
      onSelect(asset) {
        if (state.quiz !== owner || (question && !state.quiz.questions.includes(question))) return;
        if (question?.type === 'image_occlusion' && question.image.ref !== asset.reference && question.occlusion.masks.length) {
          if (!root.confirm('Podmiana obrazu usunie jego maski, aby nie zasłaniały niewłaściwych miejsc. Kontynuować?')) return;
          question.occlusion.masks = [];
        }
        const selected = {
          ref: asset.reference,
          alt: String(asset.filename || 'Ilustracja').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 300)
        };
        if (question?.type === 'flashcard' && ['front', 'back'].includes(side)) {
          if (index >= 0 && question[side].images[index]) question[side].images[index] = selected;
          else if (question[side].images.length < 8) question[side].images.push(selected);
        } else if (question && side === 'option') {
          const option = question.options.find((entry) => entry.optionId === index);
          if (!option) return;
          option.image = selected;
        } else if (question) question.image = selected;
        else state.quiz.metadata.cover = selected;
        markChanged('Obraz dodano z Media Managera.');
        render();
      }
    });
  }

  function newQuiz(deck = false) {
    if (!root.confirm('Utworzyć nowy quiz? Bieżący szkic na tym urządzeniu zostanie zastąpiony. Zapisz go najpierw, jeśli chcesz zachować zmiany.')) return;
    openSequence++;
    revokeObjectUrls();
    state.quiz = modelApi.createQuiz(deck ? { mode: 'deck', quizId: `fiszki-${Date.now().toString(36)}`, metadata: { title: 'Nowa pula fiszek' } } : {});
    renderCourses();
    state.remoteId = '';
    state.remoteSha = '';
    saveLocal();
    render();
    setStatus(deck ? 'Nowa pula fiszek jest gotowa. Wybierz kurs i uzupełnij obie strony kart.' : 'Nowy quiz jest gotowy.');
    resetQuizScroll();
    elements.id.focus({ preventScroll: true });
    elements.id.select();
  }

  async function save(publish) {
    if (state.busy) return;
    const before = JSON.stringify(state.quiz);
    const candidate = clone(state.quiz);
    candidate.metadata.status = publish ? 'published' : 'draft';
    const validation = modelApi.validate(candidate);
    if (!validation.valid) {
      root.clearTimeout(feedbackTimer); feedbackTimer = null;
      renderValidation(validation);
      setStatus(validation.errors[0].message, true);
      return;
    }
    state.busy = true;
    renderSettings();
    setStatus(publish ? 'Publikowanie quizu…' : 'Zapisywanie szkicu…');
    try {
      const result = await library.save('quiz', {
        filename: candidate.quizId,
        content: modelApi.serialize(candidate),
        expectedSha: state.remoteId === candidate.quizId ? state.remoteSha : '',
        repositoryId: state.repositoryId
      });
      const replaceDraft = JSON.stringify(state.quiz) === before;
      if (replaceDraft) state.quiz = validation.quiz;
      state.remoteId = candidate.quizId;
      state.remoteSha = result.sha;
      // Rich widgets retain the question objects they edit. Rebind them when
      // publication replaces the draft with its normalized definition.
      if (replaceDraft) { renderQuestions(); renderPreview(); }
      saveLocal();
      setStatus(publish ? 'Quiz opublikowano.' : 'Szkic quizu zapisano.');
      await loadLibrary(true);
      root.document.dispatchEvent(new CustomEvent('chemdisk-content-changed', {
        detail: { kind: 'quiz', repositoryId: state.repositoryId }
      }));
    } catch (error) {
      setStatus(error?.message || 'Nie udało się zapisać quizu.', true);
    } finally {
      state.busy = false;
      renderSettings();
      renderReport();
    }
  }

  async function removeCurrent() {
    if (!state.remoteSha || state.remoteId !== state.quiz.quizId) return;
    if (!root.confirm(`Usunąć zapisany quiz „${state.quiz.metadata.title}”? Dodane obrazy pozostaną w bibliotece obrazów i można je usunąć osobno.`)) return;
    state.busy = true;
    renderSettings();
    try {
      await library.remove('quiz', {
        filename: state.remoteId,
        expectedSha: state.remoteSha,
        repositoryId: state.repositoryId
      });
      state.remoteId = '';
      state.remoteSha = '';
      setStatus('Quiz usunięto z biblioteki. Szkic na tym urządzeniu pozostał w Studio.');
      await loadLibrary(true);
      root.document.dispatchEvent(new CustomEvent('chemdisk-content-changed', {
        detail: { kind: 'quiz', repositoryId: state.repositoryId }
      }));
    } catch (error) {
      setStatus(error?.message || 'Nie udało się usunąć quizu.', true);
    } finally {
      state.busy = false;
      renderSettings();
    }
  }

  async function openAsset(asset) {
    const sequence = ++openSequence;
    const targetId = asset.filename || asset.quizId;
    setStatus(`Wczytywanie ${asset.title || targetId}…`);
    let result, quiz;
    try {
      result = await library.readQuiz(targetId, { repositoryId: asset.repositoryId });
      quiz = result?.quiz ? modelApi.createQuiz(result.quiz) : modelApi.parse(result.content, targetId);
    } catch (error) {
      if (sequence === openSequence) setStatus(error.message || 'Nie udało się otworzyć materiału.', true);
      return;
    }
    if (sequence !== openSequence) return;
    revokeObjectUrls();
    state.quiz = quiz;
    renderCourses();
    state.repositoryId = asset.repositoryId || result.repositoryId || state.repositoryId;
    state.remoteId = targetId;
    state.remoteSha = asset.sha || result.sha;
    state.report = null;
    state.attemptReport = null;
    state.focusQuestionId = '';
    saveLocal();
    render();
    resetQuizScroll();
    setStatus('Quiz otwarto do edycji.');
  }

  function csvSummary(result) {
    return `Dodane: ${result.added} · Pominięte: ${result.skipped} · Błędy: ${result.errors.length} · Duplikaty: ${result.duplicates}.`;
  }

  function importCsv(content, options = {}) {
    if (state.busy) return false;
    const target = csvTarget || { quiz: state.quiz, id: state.remoteId, sha: state.remoteSha };
    const result = modelApi.importCardsFromCsv(target.quiz, content, options);
    if (result.errors.length || !result.count) {
      const message = `${csvSummary(result)} ${result.errors[0]?.message || 'Nie ma nowych rekordów do dodania.'}`;
      setStatus(message, true); if (elements.csvStatus) elements.csvStatus.textContent = message;
      return false;
    }
    state.quiz = result.quiz; state.remoteId = target.id; state.remoteSha = target.sha;
    state.report = null; state.attemptReport = null;
    revokeObjectUrls(); saveLocal();
    markChanged(`${csvSummary(result)} Zatwierdzono w szkicu. Użyj „Zapisz szkic” lub „Opublikuj”, aby zapisać pulę w bibliotece.`);
    render(); resetQuizScroll(); return true;
  }

  function csvOptions() {
    return {
      append: elements.csvModeAppend?.checked !== false,
      hasHeader: elements.csvHeader?.checked === true,
      type: elements.csvType?.value || 'flashcard',
      delimiter: elements.csvDelimiter?.value === 'tab' ? '\t' : elements.csvDelimiter?.value || undefined,
      duplicates: elements.csvDuplicates?.value || 'skip',
      mapping: Object.fromEntries(Array.from(elements.csvMapping?.querySelectorAll('select') || []).map((select) => [select.dataset.csvField, Number(select.value)]))
    };
  }

  function openCsvDialog() {
    if (state.busy || !elements.csvDialog) return;
    csvReadSequence++; csvFileSequence++; csvTarget = null; csvTargetError = '';
    elements.csvPasteInput.value = ''; elements.csvFilename.textContent = ''; elements.csvFileInput.value = '';
    elements.csvHeader.checked = false; elements.csvMapping.replaceChildren();
    elements.csvStatus.textContent = ''; elements.csvPreview.hidden = true; elements.csvConfirmButton.disabled = true;
    const current = create('option', '', `Obecny szkic: ${state.quiz.metadata.title} (${state.quiz.quizId})`); current.value = '';
    elements.csvTarget.replaceChildren(current);
    state.assets.filter((asset) => asset.filename !== state.quiz.quizId).forEach((asset) => {
      const option = create('option', '', `${asset.title || asset.filename} (${asset.filename})`); option.value = asset.filename; elements.csvTarget.append(option);
    });
    if (typeof elements.csvDialog.showModal === 'function') elements.csvDialog.showModal();
    else elements.csvDialog.setAttribute('open', '');
  }

  async function selectCsvTarget() {
    const sequence = ++csvReadSequence, id = elements.csvTarget.value;
    csvTarget = null; csvTargetError = '';
    elements.csvConfirmButton.disabled = true;
    if (id) {
      csvTargetError = 'Wczytywanie puli docelowej…';
      try {
        const result = await library.readQuiz(id, { repositoryId: state.repositoryId });
        if (sequence !== csvReadSequence) return;
        const quiz = result.quiz ? modelApi.createQuiz(result.quiz) : modelApi.parse(result.content, id);
        if (quiz.mode !== 'deck') throw new Error('Wybrany materiał nie jest pulą nauki.');
        csvTarget = { quiz, id, sha: result.sha }; csvTargetError = '';
      } catch (error) { if (sequence === csvReadSequence) csvTargetError = error.message; }
    }
    if (sequence === csvReadSequence) previewCsv(elements.csvPasteInput.value);
  }

  function previewCsv(content, resetMapping = false) {
    if (!elements.csvPreview) return;
    if (resetMapping) elements.csvMapping.replaceChildren();
    const options = csvOptions();
    const parsed = modelApi.parseCsv(content, options);
    if (!elements.csvMapping.children.length && parsed.headers.length) {
      const labels = { question: 'Pytanie / przód', answer: 'Odpowiedź / tył', explanation: 'Wyjaśnienie', type: 'Typ z CSV', tags: 'Tagi', correct: 'Klucz (A lub A|C)' };
      Object.entries(parsed.mapping).forEach(([field, value]) => {
        const select = create('select'); select.dataset.csvField = field;
        const empty = create('option', '', 'Nie używaj'); empty.value = '-1'; select.append(empty);
        parsed.headers.forEach((header, i) => { const option = create('option', '', `${i + 1}: ${header.slice(0, 60)}`); option.value = String(i); select.append(option); });
        select.value = String(value); select.addEventListener('change', () => previewCsv(elements.csvPasteInput.value));
        elements.csvMapping.append(fieldLabel(labels[field] || `Opcja ${field.slice(-1)}`, select));
      });
    }
    const target = csvTarget?.quiz || state.quiz;
    const result = modelApi.importCardsFromCsv(target, content, options);
    elements.csvPreview.hidden = !parsed.rows.length;
    elements.csvConfirmButton.disabled = Boolean(csvTargetError) || result.errors.length > 0 || !result.count;
    elements.csvPreviewCount.textContent = `Podgląd · ${target.metadata.title} · ${csvSummary(result)}`;
    elements.csvPreviewTable.replaceChildren();
    const table = create('table', 'quiz-csv-preview-table'), head = create('thead'), headings = create('tr'), body = create('tbody');
    ['Wiersz', 'Typ', 'Pytanie / przód', 'Odpowiedź / tył', 'Duplikat'].forEach((label) => headings.append(create('th', '', label)));
    head.append(headings);
    result.cards.slice(0, 5).forEach((card) => {
      const tr = create('tr'); [card.row, card.type, card.front, card.back, card.duplicate ? 'Tak' : 'Nie'].forEach((value) => tr.append(create('td', '', value))); body.append(tr);
    });
    table.append(head, body); elements.csvPreviewTable.append(table);
    elements.csvStatus.textContent = csvTargetError || result.errors.slice(0, 5).map((e) => `${e.row ? `Wiersz ${e.row}: ` : ''}${e.message}`).join(' ') || (content.trim() ? `${csvSummary(result)} Sprawdź mapowanie i zatwierdź.` : '');
  }

  function assetDeleted(asset) {
    if (state.remoteId === asset.filename && state.repositoryId === asset.repositoryId) {
      state.remoteId = '';
      state.remoteSha = '';
      renderSettings();
      setStatus('Quiz usunięto z biblioteki. Szkic na tym urządzeniu pozostał w Studio.');
    }
  }

  function bind() {
    const header = root.document.querySelector('.studio-header');
    if (header && root.ResizeObserver) {
      const resize = new root.ResizeObserver(() => elements.workspace.style.setProperty('--quiz-header-height', `${header.getBoundingClientRect().height}px`));
      resize.observe(header);
    }
    [elements.id, elements.title, elements.description, elements.passingScore, elements.tags].forEach((input) => {
      input.addEventListener('input', updateMetadata);
    });
    [elements.shuffle, elements.showFeedback, elements.allowRetry, elements.active, elements.course].forEach((input) => {
      input.addEventListener('change', updateMetadata);
    });
    elements.coverSelect.addEventListener('click', () => openMediaManager());
    elements.coverRemove.addEventListener('click', () => {
      state.quiz.metadata.cover = { ref: '', alt: '' };
      markChanged();
      render();
    });
    elements.questions.addEventListener('input', (event) => {
      if (event.target.matches('input[type="checkbox"], input[type="radio"], select')) return;
      updateQuestionControl(event.target, false);
    });
    elements.questions.addEventListener('change', (event) => {
      if (event.target.matches('input[type="checkbox"], input[type="radio"], select')) updateQuestionControl(event.target, true);
    });
    elements.questions.addEventListener('click', (event) => {
      const button = event.target.closest('[data-quiz-action]');
      if (button) handleQuestionAction(button);
    });
    root.document.querySelectorAll('[data-quiz-add]').forEach((button) => {
      button.addEventListener('click', () => addQuestion(button.dataset.quizAdd));
    });
    elements.repository.addEventListener('change', async () => {
      openSequence++;
      revokeObjectUrls();
      state.repositoryId = elements.repository.value;
      state.assets = [];
      state.remoteId = '';
      state.remoteSha = '';
      pagedListApi.reset(state.libraryPaging);
      renderSettings();
      await loadLibrary();
    });
    elements.search.addEventListener('input', () => {
      pagedListApi.reset(state.libraryPaging);
      renderLibrary();
    });
    elements.newButton.addEventListener('click', () => newQuiz());
    elements.newDeckButton.addEventListener('click', () => newQuiz(true));
    elements.mode.addEventListener('change', () => {
      if (elements.mode.value === 'deck' && state.quiz.questions.some((q) => !root.ChemQuizPractice.DECK_TYPES.includes(q.type) || q.options.length > 6)) {
        elements.mode.value = 'quiz'; setStatus('Utwórz nową pulę przyciskiem „Nowa pula fiszek”. Obecne pytania pozostają w quizie.', true); return;
      }
      state.quiz.mode = elements.mode.value;
      revokeObjectUrls();
      if (state.quiz.mode === 'deck') { state.quiz.metadata.active = true; state.quiz.metadata.courseId ||= ''; }
      markChanged(); render();
    });
    elements.saveButton.addEventListener('click', () => void save(false));
    elements.publishButton.addEventListener('click', () => void save(true));
    elements.deleteButton.addEventListener('click', () => void removeCurrent());
    elements.importCsvButton?.addEventListener('click', () => openCsvDialog());
    elements.addCsvButton?.addEventListener('click', () => openCsvDialog());
    elements.csvPickButton?.addEventListener('click', () => elements.csvFileInput?.click());
    elements.csvFileInput?.addEventListener('change', () => {
      const file = elements.csvFileInput.files?.[0]; if (!file) return;
      const sequence = ++csvFileSequence;
      elements.csvFilename.textContent = file.name;
      elements.csvPasteInput.value = ''; elements.csvConfirmButton.disabled = true;
      if (!/\.(csv|txt)$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
        elements.csvStatus.textContent = 'Wybierz plik .csv lub .txt UTF-8 do 2 MiB.'; return;
      }
      const reader = new root.FileReader();
      reader.onerror = () => { if (sequence === csvFileSequence) elements.csvStatus.textContent = 'Nie udało się odczytać pliku.'; };
      reader.onload = () => {
        if (sequence !== csvFileSequence) return;
        elements.csvPasteInput.value = String(reader.result || ''); previewCsv(elements.csvPasteInput.value, true);
      };
      reader.readAsText(file, 'utf-8');
    });
    elements.csvPasteInput?.addEventListener('input', () => {
      elements.csvConfirmButton.disabled = true;
      root.clearTimeout(csvPreviewTimer);
      csvPreviewTimer = root.setTimeout(() => previewCsv(elements.csvPasteInput.value), 180);
    });
    elements.csvTarget?.addEventListener('change', () => void selectCsvTarget());
    for (const control of [elements.csvHeader, elements.csvDelimiter]) control?.addEventListener('change', () => previewCsv(elements.csvPasteInput.value, true));
    for (const control of [elements.csvType, elements.csvDuplicates, elements.csvModeAppend, byId('quiz-csv-mode-replace')]) control?.addEventListener('change', () => previewCsv(elements.csvPasteInput.value));
    elements.csvConfirmButton?.addEventListener('click', () => {
      if (csvTargetError || elements.csvConfirmButton.disabled) return;
      if (importCsv(elements.csvPasteInput?.value || '', csvOptions())) {
        if (typeof elements.csvDialog?.close === 'function') elements.csvDialog.close();
        else elements.csvDialog?.removeAttribute('open');
        csvTarget = null;
      }
    });
    elements.csvDialog?.addEventListener('close', () => { csvReadSequence++; csvFileSequence++; csvTarget = null; root.clearTimeout(csvPreviewTimer); });
    elements.csvCancelButton?.addEventListener('click', () => {
      if (typeof elements.csvDialog?.close === 'function') elements.csvDialog.close();
      else elements.csvDialog?.removeAttribute('open');
    });
    elements.reportRefresh?.addEventListener('click', () => void loadReport());
    elements.reportBody?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-quiz-report-action]');
      if (!button) return;
      if (button.dataset.quizReportAction === 'open') void openQuizAttempt(button.dataset.userId, button.dataset.attemptId);
      if (button.dataset.quizReportAction === 'grade') void gradeQuizAttempt();
      if (button.dataset.quizReportAction === 'first') void loadReport();
      if (button.dataset.quizReportAction === 'next' && state.report?.cursor) void loadReport(state.report.cursor);
    });
  }

  async function activate() {
    state.active = true;
    if (!state.quiz) loadDraft();
    render();
    if (!state.loaded) {
      state.loaded = true;
      await loadLibrary();
    }
  }

  bind();
  root.addEventListener('pagehide', flush);
  root.addEventListener('pagehide', (event) => { if (!event.persisted) revokeObjectUrls(); });
  root.ChemQuizBuilder = Object.freeze({ activate, assetDeleted, flush, openAsset, importCsv });
})(typeof globalThis !== 'undefined' ? globalThis : window);
