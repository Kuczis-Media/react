(async () => {
  'use strict';

  const elements = {
    main: document.getElementById('presentation-player-main'),
    loading: document.getElementById('presentation-player-loading'),
    error: document.getElementById('presentation-player-error'),
    errorCopy: document.getElementById('presentation-player-error-copy'),
    retry: document.getElementById('presentation-player-retry'),
    player: document.getElementById('presentation-player'),
    title: document.getElementById('presentation-player-title'),
    outline: document.getElementById('presentation-player-outline'),
    outlineToggle: document.getElementById('presentation-player-outline-toggle'),
    stage: document.getElementById('presentation-player-stage'),
    previous: document.getElementById('presentation-player-previous'),
    next: document.getElementById('presentation-player-next'),
    position: document.getElementById('presentation-player-position'),
    progress: document.getElementById('presentation-player-progress'),
    fullscreen: document.getElementById('presentation-player-fullscreen'),
    theme: document.getElementById('presentation-player-theme'),
    save: document.getElementById('presentation-player-save'),
    edit: document.getElementById('presentation-player-edit'),
    presenterBtn: document.getElementById('presentation-player-presenter'),
    pdf: document.getElementById('presentation-player-pdf'),
    annotationCanvas: document.getElementById('presentation-annotation-canvas'),
    laserDot: document.getElementById('presentation-laser-dot'),
    annotationToolbar: document.getElementById('presentation-annotation-toolbar'),
    toolColors: document.getElementById('presentation-tool-colors'),
    toggleTools: document.getElementById('presentation-toggle-tools'),
    presenterView: document.getElementById('presentation-presenter-view'),
    presenterTitle: document.getElementById('presenter-title'),
    presenterClock: document.getElementById('presenter-clock'),
    presenterTimer: document.getElementById('presenter-timer'),
    presenterTimerToggle: document.getElementById('presenter-timer-toggle'),
    presenterTimerReset: document.getElementById('presenter-timer-reset'),
    presenterSyncStatus: document.getElementById('presenter-sync-status'),
    presenterSyncText: document.getElementById('presenter-sync-text'),
    presenterStepBadge: document.getElementById('presenter-step-badge'),
    presenterStageCurrent: document.getElementById('presenter-stage-current'),
    presenterStageNext: document.getElementById('presenter-stage-next'),
    presenterNextEnd: document.getElementById('presenter-next-end'),
    presenterPos: document.getElementById('presenter-pos-indicator'),
    presenterPrevBtn: document.getElementById('presenter-prev-btn'),
    presenterNextBtn: document.getElementById('presenter-next-btn'),
    presenterNotes: document.getElementById('presenter-notes-content'),
    presenterFontInc: document.getElementById('presenter-font-inc'),
    presenterFontDec: document.getElementById('presenter-font-dec'),
    presenterFilmstrip: document.getElementById('presenter-filmstrip'),
    presenterNextTitle: document.getElementById('presenter-next-title')
  };

  const state = {
    definition: null,
    index: 0,
    currentStep: 0,
    visited: new Set(),
    urls: new Set(),
    materialId: '',
    repositoryId: 'default',
    presentationId: '',
    preview: false,
    availableRepositories: [],
    loading: false,
    activeTool: 'pointer',
    activeColor: '#e63946',
    annotations: {},
    isPresenterMode: false,
    timerSeconds: 0,
    timerRunning: true,
    notesFontSize: 1.1,
    syncChannel: null,
    quizAnswers: {}
  };


  const progressApi = window.ChemProgress;

  function showError(message) {
    elements.loading.hidden = true;
    elements.player.hidden = true;
    elements.error.hidden = false;
    elements.errorCopy.textContent = message;
  }

  function friendlyError(error) {
    const code = error?.code || error?.message || '';
    if (window.ChemContentLibrary?.ERROR_MESSAGES?.[code]) {
      return window.ChemContentLibrary.ERROR_MESSAGES[code];
    }
    const messages = {
      AUTH_REQUIRED: 'Zaloguj się ponownie, aby przejść do prezentacji.',
      PRESENTATION_NOT_PUBLISHED: 'Prezentacja nie została jeszcze opublikowana.',
      INVALID_PRESENTATION_REFERENCE: 'Nieprawidłowy identyfikator prezentacji lub repozytorium.',
      INVALID_CONTENT_REPOSITORY: 'Wybrane repozytorium materiałów nie zostało skonfigurowane.',
      CONTENT_REPOSITORY_NOT_CONFIGURED: 'Biblioteka materiałów nie została jeszcze skonfigurowana.',
      CONTENT_FILE_NOT_FOUND: 'Nie znaleziono pliku prezentacji w bibliotece.',
      CONTENT_REPOSITORY_TIMEOUT: 'Serwer repozytorium zbyt długo nie odpowiadał. Spróbuj ponownie za chwilę.',
      CONTENT_REPOSITORY_UNAVAILABLE: 'Biblioteka materiałów jest chwilowo niedostępna.'
    };
    return messages[code] || error?.message || 'Nie udało się pobrać prezentacji.';
  }

  function fontStack(font) {
    return ({
      roboto: 'Roboto, Arial, sans-serif',
      'open-sans': '"Open Sans", Arial, sans-serif',
      montserrat: 'Montserrat, Arial, sans-serif',
      poppins: 'Poppins, Arial, sans-serif',
      lato: 'Lato, Arial, sans-serif',
      nunito: 'Nunito, Arial, sans-serif',
      lora: 'Lora, Georgia, serif',
      merriweather: 'Merriweather, Georgia, serif',
      playfair: '"Playfair Display", Georgia, serif',
      georgia: 'Georgia, serif',
      times: '"Times New Roman", serif',
      'jetbrains-mono': '"JetBrains Mono", ui-monospace, monospace',
      'source-code-pro': '"Source Code Pro", ui-monospace, monospace',
      mono: 'ui-monospace, monospace',
      arial: 'Arial, sans-serif',
      verdana: 'Verdana, sans-serif'
    })[font] || 'Inter, system-ui, sans-serif';
  }

  async function fetchPresentation(repoId, presId, isPreview) {
    const token = await window.ChemAuth.getAccessToken();
    const url = new URL('/.netlify/functions/presentation', location.origin);
    url.searchParams.set('presentation', presId);
    url.searchParams.set('repo', repoId);
    if (isPreview) url.searchParams.set('preview', '1');

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), 12_000);
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        ...(controller ? { signal: controller.signal } : {})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = payload.error || `HTTP_${response.status}`;
        const err = new Error(code);
        err.code = code;
        throw err;
      }
      return payload.presentation;
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutErr = new Error('CONTENT_REPOSITORY_TIMEOUT');
        timeoutErr.code = 'CONTENT_REPOSITORY_TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestDefinition() {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(state.presentationId) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(state.repositoryId)) {
      throw new Error('INVALID_PRESENTATION_REFERENCE');
    }
    try {
      return await fetchPresentation(state.repositoryId, state.presentationId, state.preview);
    } catch (primaryError) {
      const retryableCodes = ['INVALID_CONTENT_REPOSITORY', 'CONTENT_REPOSITORY_NOT_FOUND', 'CONTENT_REPOSITORY_NOT_CONFIGURED', 'CONTENT_ASSET_NOT_FOUND'];
      if (retryableCodes.includes(primaryError.code)) {
        if (Array.isArray(state.availableRepositories)) {
          for (const repo of state.availableRepositories) {
            const targetId = repo && typeof repo.id === 'string' ? repo.id : '';
            if (targetId && targetId !== state.repositoryId) {
              try {
                const res = await fetchPresentation(targetId, state.presentationId, state.preview);
                state.repositoryId = targetId;
                return res;
              } catch (_) {}
            }
          }
        }
        if (state.repositoryId !== 'default') {
          try {
            const fallback = await fetchPresentation('default', state.presentationId, state.preview);
            state.repositoryId = 'default';
            return fallback;
          } catch (_) {}
        }
      }
      throw primaryError;
    }
  }

  function cleanup() {
    state.urls.forEach((url) => URL.revokeObjectURL(url));
    state.urls.clear();
  }

  function geometry(node, item) {
    Object.assign(node.style, {
      left: `${item.x}%`,
      top: `${item.y}%`,
      width: `${item.width}%`,
      height: `${item.height}%`,
      transform: `rotate(${item.rotation}deg)`,
      zIndex: String(item.z)
    });
    if (item.fontSize) node.style.setProperty('--elem-fs', String(item.fontSize));
  }

  function renderFormattedText(container, text) {
    container.textContent = '';
    const parts = String(text || '').split(/(<\/?(?:sub|sup)>|<br\s*\/?>)/i);
    let currentTag = null;
    parts.forEach((part) => {
      if (!part) return;
      const lower = part.toLowerCase();
      if (lower === '<sub>') currentTag = 'sub';
      else if (lower === '</sub>') { if (currentTag === 'sub') currentTag = null; }
      else if (lower === '<sup>') currentTag = 'sup';
      else if (lower === '</sup>') { if (currentTag === 'sup') currentTag = null; }
      else if (lower === '<br>' || lower === '<br/>' || lower === '<br />') {
        container.append(document.createElement('br'));
      } else {
        if (currentTag) {
          const el = document.createElement(currentTag);
          el.textContent = part;
          container.append(el);
        } else {
          container.append(document.createTextNode(part));
        }
      }
    });
  }

  function renderElement(item) {
    const node = document.createElement('div');
    node.className = `presentation-player-element is-${item.type}`;
    geometry(node, item);
    if (item.animationType && item.animationType !== 'none' && item.animationOrder > 0) {
      node.classList.add('presentation-player-animated', `is-${item.animationType}`);
      node.dataset.animOrder = String(item.animationOrder);
      if (item.animationOrder > state.currentStep) {
        node.classList.add('is-anim-hidden');
      } else {
        node.classList.add('is-anim-visible');
      }
    }

    if (item.type === 'text' || item.type === 'heading') {
      const copy = document.createElement('div');
      copy.className = 'presentation-player-text';
      renderFormattedText(copy, item.content);
      Object.assign(copy.style, {
        fontFamily: fontStack(item.fontFamily),
        fontSize: `${item.fontSize}px`,
        color: item.color,
        fontWeight: String(item.fontWeight || (item.bold ? 800 : 400)),
        fontStyle: item.italic ? 'italic' : 'normal',
        textDecoration: [item.underline ? 'underline' : '', item.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
        textAlign: item.align || 'left',
        justifyContent: item.verticalAlign === 'center' ? 'center' : item.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
        lineHeight: String(item.lineHeight || 1.15),
        letterSpacing: `${item.letterSpacing || 0}px`
      });
      node.append(copy);
    } else if (item.type === 'shape') {
      const shape = document.createElement('div');
      shape.className = `presentation-player-shape is-${item.shape}`;
      Object.assign(shape.style, {
        background: item.fill,
        borderColor: item.border,
        borderWidth: `${item.borderWidth}px`,
        opacity: String(item.opacity),
        color: item.border
      });
      node.append(shape);
    } else if (item.type === 'formula') {
      const formula = document.createElement('div');
      formula.className = 'presentation-player-formula';
      formula.style.color = item.color;
      formula.style.fontSize = `${item.fontSize}px`;
      if (window.ChemAssessmentText) {
        let expr = String(item.expression || '').trim();
        if (!expr.startsWith('\\(') && !expr.startsWith('\\[') && !expr.startsWith('$$')) {
          expr = item.mode === 'chemistry' && !expr.startsWith('\\ce{') ? `\\[\\ce{${expr}}\\]` : `\\[${expr}\\]`;
        }
        window.ChemAssessmentText.render(formula, expr);
      } else {
        formula.textContent = item.expression;
      }
      node.append(formula);
    } else if (item.type === 'image') {
      const placeholder = document.createElement('div');
      placeholder.className = 'presentation-player-image-placeholder';
      placeholder.textContent = 'Wczytywanie…';
      node.append(placeholder);
      void loadImage(node, item);
    } else if (item.type === 'icon') {
      const icon = document.createElement('div');
      icon.className = 'presentation-player-icon';
      icon.textContent = item.symbol;
      Object.assign(icon.style, {
        color: item.color,
        background: item.background,
        fontSize: `${item.fontSize}px`,
        borderRadius: `${item.borderRadius}px`
      });
      node.append(icon);
    } else if (item.type === 'table') {
      const table = document.createElement('table');
      table.className = 'presentation-player-table';
      table.style.fontSize = `${item.fontSize}px`;
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      item.headers.forEach((value) => {
        const cell = document.createElement('th');
        cell.textContent = value;
        cell.style.background = item.headerColor;
        headRow.append(cell);
      });
      thead.append(headRow);
      const tbody = document.createElement('tbody');
      item.rows.forEach((row, rowIndex) => {
        const tr = document.createElement('tr');
        row.forEach((value) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          if (rowIndex % 2) cell.style.background = item.accentColor;
          tr.append(cell);
        });
        tbody.append(tr);
      });
      table.append(thead, tbody);
      node.append(table);
    } else if (item.type === 'button') {
      const link = document.createElement('a');
      link.className = 'presentation-player-button';
      link.textContent = item.label;
      link.href = item.href;
      if (/^https:\/\//.test(item.href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      Object.assign(link.style, {
        color: item.color,
        background: item.background,
        borderRadius: `${item.borderRadius}px`
      });
      node.append(link);
    } else if (item.type === 'code') {
      const code = document.createElement('pre');
      code.className = 'presentation-player-code';
      code.textContent = item.code;
      Object.assign(code.style, {
        color: item.color,
        background: item.background,
        fontSize: `${item.fontSize}px`
      });
      node.append(code);
    } else if (item.type === 'embed') {
      const frame = document.createElement('iframe');
      frame.className = 'presentation-player-embed';
      frame.src = item.url;
      frame.title = item.title;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
      frame.setAttribute('allow', 'fullscreen; encrypted-media');
      node.append(frame);
    } else if (item.type === 'quiz') {
      const card = document.createElement('div');
      card.className = 'presentation-player-quiz';
      card.dataset.quizId = item.elementId;
      Object.assign(card.style, {
        background: item.background || '#ffffff',
        border: `2px solid ${item.borderColor || '#d9e2ec'}`,
        borderRadius: `${item.borderRadius || 14}px`,
        color: item.color || '#17233a',
        padding: '24px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        height: '100%'
      });

      const qBox = document.createElement('div');
      qBox.className = 'presentation-quiz-question';
      qBox.style.fontSize = `${item.fontSize || 20}px`;
      qBox.style.fontWeight = '700';
      if (window.ChemAssessmentText) {
        window.ChemAssessmentText.render(qBox, item.question || 'Wybierz poprawną odpowiedź:');
      } else {
        qBox.textContent = item.question || 'Wybierz poprawną odpowiedź:';
      }
      if (item.blockNextUntilCorrect) {
        const lockBadge = document.createElement('span');
        lockBadge.className = 'presentation-quiz-lock-badge';
        lockBadge.textContent = ' 🔒 Wymagana poprawna odpowiedź';
        qBox.append(lockBadge);
      }
      card.append(qBox);

      const optsBox = document.createElement('div');
      optsBox.className = 'presentation-quiz-options';

      const feedback = document.createElement('div');
      feedback.className = 'presentation-quiz-feedback';
      feedback.style.display = 'none';

      const lockNotice = document.createElement('div');
      lockNotice.className = 'presentation-quiz-locked-msg';
      lockNotice.style.display = 'none';
      lockNotice.textContent = '⚠️ Aby przejść do kolejnego slajdu, musisz wybrać poprawną odpowiedź!';

      (item.options || []).forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'presentation-quiz-option';
        const letterSpan = document.createElement('span');
        letterSpan.className = 'presentation-quiz-opt-letter';
        letterSpan.textContent = String.fromCharCode(65 + idx);
        const textSpan = document.createElement('span');
        textSpan.className = 'presentation-quiz-opt-text';
        if (window.ChemAssessmentText) {
          window.ChemAssessmentText.render(textSpan, opt.text || '');
        } else {
          textSpan.textContent = opt.text || '';
        }
        btn.append(letterSpan, textSpan);

        if (state.isPresenterMode && opt.correct) {
          btn.classList.add('is-presenter-hint');
        }

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (state.quizAnswers[item.elementId]) return;

          optsBox.querySelectorAll('.presentation-quiz-option').forEach((b) => b.classList.remove('is-selected', 'is-incorrect'));
          btn.classList.add('is-selected');

          if (opt.correct) {
            btn.classList.add('is-correct');
            state.quizAnswers[item.elementId] = true;
            feedback.className = 'presentation-quiz-feedback is-correct';
            feedback.innerHTML = `<strong>Świetnie! Poprawna odpowiedź.</strong>${item.explanation ? `<p>${item.explanation}</p>` : ''}`;
            feedback.style.display = 'block';
            lockNotice.style.display = 'none';
            optsBox.querySelectorAll('.presentation-quiz-option').forEach((b) => {
              if (b !== btn) b.disabled = true;
            });
          } else {
            btn.classList.add('is-incorrect');
            feedback.className = 'presentation-quiz-feedback is-incorrect';
            feedback.innerHTML = `<strong>Niestety nie, spróbuj jeszcze raz!</strong>`;
            feedback.style.display = 'block';
          }
        });

        if (state.quizAnswers[item.elementId]) {
          if (opt.correct) {
            btn.classList.add('is-correct', 'is-selected');
          } else {
            btn.disabled = true;
          }
        }

        optsBox.append(btn);
      });

      if (state.quizAnswers[item.elementId]) {
        feedback.className = 'presentation-quiz-feedback is-correct';
        feedback.innerHTML = `<strong>Świetnie! Poprawna odpowiedź.</strong>${item.explanation ? `<p>${item.explanation}</p>` : ''}`;
        feedback.style.display = 'block';
      }

      card.append(optsBox, feedback, lockNotice);
      node.append(card);
    }
    return node;
  }

  async function mediaBlob(reference, ownerRepository) {
    const shared = reference.startsWith('assets/shared/');
    let targetRepo = state.repositoryId;
    if (ownerRepository && ownerRepository !== state.repositoryId) {
      const exists = state.availableRepositories.some((r) => r.id === ownerRepository);
      if (exists) targetRepo = ownerRepository;
    }
    try {
      return await window.ChemContentLibrary.readMediaBlob({
        scope: shared ? 'shared' : 'local',
        materialKind: shared ? '' : 'presentation',
        materialId: shared ? '' : state.presentationId,
        reference,
        repositoryId: targetRepo
      });
    } catch (error) {
      if (targetRepo !== state.repositoryId) {
        return window.ChemContentLibrary.readMediaBlob({
          scope: shared ? 'shared' : 'local',
          materialKind: shared ? '' : 'presentation',
          materialId: shared ? '' : state.presentationId,
          reference,
          repositoryId: state.repositoryId
        });
      }
      throw error;
    }
  }

  async function loadImage(node, item) {
    try {
      const blob = await Promise.race([
        mediaBlob(item.ref, item.repositoryId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8_000))
      ]);
      if (!node.isConnected) return;
      const url = URL.createObjectURL(blob);
      state.urls.add(url);
      const image = document.createElement('img');
      image.src = url;
      image.alt = item.alt;
      image.style.objectFit = item.fit;
      image.style.objectPosition = `${item.focalX}% ${item.focalY}%`;
      image.style.borderRadius = `${item.borderRadius}px`;
      image.style.opacity = String(item.opacity ?? 1);
      node.replaceChildren(image);
    } catch (_) {
      if (!node.isConnected) return;
      node.replaceChildren();
      node.textContent = 'Brak obrazu';
      node.classList.add('is-missing-media');
    }
  }

  async function loadBackground(slide) {
    try {
      const blob = await Promise.race([
        mediaBlob(slide.backgroundRef),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8_000))
      ]);
      if (!elements.stage.isConnected) return;
      const url = URL.createObjectURL(blob);
      state.urls.add(url);
      elements.stage.style.backgroundImage = `url(${url})`;
      elements.stage.style.backgroundSize = 'cover';
      elements.stage.style.backgroundPosition = 'center';
    } catch (_) {}
  }

  function getMaxStep(slide) {
    if (!slide?.elements?.length) return 0;
    let max = 0;
    for (const el of slide.elements) {
      if (el.animationType && el.animationType !== 'none' && el.animationOrder > 0) {
        if (el.animationOrder > max) max = el.animationOrder;
      }
    }
    return max;
  }

  function isSlideLocked(slide) {
    if (state.isPresenterMode) return false;
    if (!slide || !slide.elements) return false;
    return slide.elements.some((el) => el.type === 'quiz' && el.blockNextUntilCorrect && !state.quizAnswers[el.elementId]);
  }

  function triggerLockNotice() {
    const slide = state.definition?.slides?.[state.index];
    if (!slide) return;
    const lockedQuizzes = (slide.elements || []).filter(
      (el) => el.type === 'quiz' && el.blockNextUntilCorrect && !state.quizAnswers[el.elementId]
    );
    lockedQuizzes.forEach((quizEl) => {
      const quizNode = elements.stage.querySelector(`[data-quiz-id="${quizEl.elementId}"]`);
      if (quizNode) {
        quizNode.classList.remove('presentation-quiz-shake');
        void quizNode.offsetWidth;
        quizNode.classList.add('presentation-quiz-shake');
        const alertMsg = quizNode.querySelector('.presentation-quiz-locked-msg');
        if (alertMsg) alertMsg.style.display = 'block';
      }
    });
  }

  function renderOutline() {
    elements.outline.replaceChildren(...state.definition.slides.map((slide, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.classList.toggle('is-active', index === state.index);
      const number = document.createElement('span');
      number.textContent = index + 1;
      const title = document.createElement('span');
      title.textContent = slide.title;
      button.append(number, title);
      button.addEventListener('click', () => {
        if (index > state.index && isSlideLocked(state.definition.slides[state.index])) {
          triggerLockNotice();
          return;
        }
        state.index = index;
        state.currentStep = 0;
        render();
      });
      return button;
    }));
  }

  function presentationPercent() {
    const slides = state.definition.slides;
    const mode = state.definition.progress?.mode || 'visited';
    if (mode === 'highest') {
      return Math.max(0, ...Array.from(state.visited).map((id) => slides.findIndex((slide) => slide.slideId === id) + 1)) / slides.length * 100;
    }
    if (mode === 'all_required') {
      const required = slides.filter((slide) => slide.required !== false);
      return required.length ? required.filter((slide) => state.visited.has(slide.slideId)).length / required.length * 100 : 100;
    }
    return state.visited.size / slides.length * 100;
  }

  function render() {
    cleanup();
    const slide = state.definition.slides[state.index];
    state.visited.add(slide.slideId);
    const maxStep = getMaxStep(slide);
    state.currentStep = Math.min(Math.max(0, state.currentStep || 0), maxStep);
    elements.stage.dataset.aspect = state.definition.settings.aspectRatio;
    elements.stage.style.backgroundImage = 'none';
    elements.stage.style.background = slide.backgroundType === 'gradient'
      ? `linear-gradient(${slide.gradientAngle}deg, ${slide.gradientFrom}, ${slide.gradientTo})`
      : slide.background;
    const slideElements = slide.elements.slice().sort((a, b) => a.z - b.z).map(renderElement);
    if (elements.annotationCanvas && elements.laserDot && elements.annotationToolbar) {
      elements.stage.replaceChildren(...slideElements, elements.annotationCanvas, elements.laserDot, elements.annotationToolbar);
    } else {
      elements.stage.replaceChildren(...slideElements);
    }
    elements.stage.classList.remove('is-animating');
    void elements.stage.offsetWidth;
    elements.stage.classList.add('is-animating');
    if (slide.backgroundRef && slide.backgroundType === 'image') void loadBackground(slide);
    elements.position.textContent = `${state.index + 1} / ${state.definition.slides.length}`;
    elements.progress.style.width = `${presentationPercent()}%`;
    elements.previous.disabled = state.index === 0 && state.currentStep === 0;
    const isLast = state.index === state.definition.slides.length - 1;
    elements.next.textContent = (isLast && state.currentStep >= maxStep) ? 'Zakończ ✓' : 'Dalej →';
    renderOutline();
    saveProgress(slide);
    scheduleSlidePrefetch(state.index);
    resizeCanvas();
    redrawAnnotations();
    broadcastState('NAVIGATE');
  }

  function nextStepOrSlide() {
    if (!state.definition?.slides?.length) return;
    const slide = state.definition.slides[state.index];
    const maxStep = getMaxStep(slide);
    if (state.currentStep < maxStep) {
      state.currentStep += 1;
      const targets = elements.stage.querySelectorAll(`.presentation-player-animated[data-anim-order="${state.currentStep}"]`);
      targets.forEach((el) => {
        el.classList.remove('is-anim-hidden');
        el.classList.add('is-anim-visible');
      });
      elements.previous.disabled = false;
      const isLast = state.index === state.definition.slides.length - 1;
      elements.next.textContent = (isLast && state.currentStep >= maxStep) ? 'Zakończ ✓' : 'Dalej →';
      if (state.isPresenterMode) renderPresenter();
      broadcastState('NAVIGATE');
    } else if (state.index < state.definition.slides.length - 1) {
      if (isSlideLocked(slide)) {
        triggerLockNotice();
        return;
      }
      state.index += 1;
      state.currentStep = 0;
      if (state.isPresenterMode) renderPresenter();
      else render();
      broadcastState('NAVIGATE');
    } else {
      if (!state.isPresenterMode) {
        location.href = window.ChemModuleReturn?.url || '/members/';
      }
    }
  }

  function prevStepOrSlide() {
    if (!state.definition?.slides?.length) return;
    if (state.currentStep > 0) {
      const targets = elements.stage.querySelectorAll(`.presentation-player-animated[data-anim-order="${state.currentStep}"]`);
      targets.forEach((el) => {
        el.classList.remove('is-anim-visible');
        el.classList.add('is-anim-hidden');
      });
      state.currentStep -= 1;
      elements.previous.disabled = state.index === 0 && state.currentStep === 0;
      const isLast = state.index === state.definition.slides.length - 1;
      const slide = state.definition.slides[state.index];
      const maxStep = getMaxStep(slide);
      elements.next.textContent = (isLast && state.currentStep >= maxStep) ? 'Zakończ ✓' : 'Dalej →';
      if (state.isPresenterMode) renderPresenter();
      broadcastState('NAVIGATE');
    } else if (state.index > 0) {
      state.index -= 1;
      const prevSlide = state.definition.slides[state.index];
      state.currentStep = getMaxStep(prevSlide);
      if (state.isPresenterMode) renderPresenter();
      else render();
      broadcastState('NAVIGATE');
    }
  }

  // Live Annotation & Laser Pointer
  let isDrawing = false;
  let currentStroke = null;

  function resizeCanvas() {
    if (!elements.annotationCanvas || !elements.stage) return;
    const rect = elements.stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (elements.annotationCanvas.width !== w || elements.annotationCanvas.height !== h) {
      elements.annotationCanvas.width = w;
      elements.annotationCanvas.height = h;
      redrawAnnotations();
    }
  }

  function redrawAnnotations() {
    if (!elements.annotationCanvas || !elements.stage || !state.definition?.slides?.length) return;
    const ctx = elements.annotationCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, elements.annotationCanvas.width, elements.annotationCanvas.height);
    const slide = state.definition.slides[state.index];
    if (!slide) return;
    const strokes = state.annotations[slide.slideId] || [];
    const w = elements.annotationCanvas.width;
    const h = elements.annotationCanvas.height;

    strokes.forEach((stroke) => {
      if (!stroke.points || stroke.points.length < 2) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * w, stroke.points[i].y * h);
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (stroke.tool === 'highlighter') {
        ctx.strokeStyle = stroke.color.startsWith('#') ? `${stroke.color}66` : stroke.color;
        ctx.lineWidth = Math.max(12, w * 0.015);
      } else {
        ctx.strokeStyle = stroke.color || '#e63946';
        ctx.lineWidth = Math.max(3, w * 0.0035);
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  function initLiveAnnotations() {
    if (!elements.annotationCanvas || !elements.stage) return;

    window.addEventListener('resize', () => resizeCanvas());

    function getNormalizedPos(e) {
      const rect = elements.stage.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      };
    }

    elements.stage.addEventListener('mousemove', (e) => {
      if (state.activeTool === 'laser' && elements.laserDot) {
        const rect = elements.stage.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const relY = (e.clientY - rect.top) / rect.height;
        elements.laserDot.hidden = false;
        elements.laserDot.style.left = `${relX * 100}%`;
        elements.laserDot.style.top = `${relY * 100}%`;
        if (state.syncChannel) {
          state.syncChannel.postMessage({ type: 'LASER', x: relX, y: relY, visible: true });
        }
      }
    });

    elements.stage.addEventListener('mouseleave', () => {
      if (elements.laserDot) elements.laserDot.hidden = true;
      if (state.syncChannel) {
        state.syncChannel.postMessage({ type: 'LASER', visible: false });
      }
    });

    const canvas = elements.annotationCanvas;
    function startStroke(e) {
      if (state.activeTool !== 'pen' && state.activeTool !== 'highlighter') return;
      isDrawing = true;
      const pos = getNormalizedPos(e);
      currentStroke = {
        tool: state.activeTool,
        color: state.activeColor,
        points: [pos]
      };
    }

    function moveStroke(e) {
      if (!isDrawing || !currentStroke) return;
      const pos = getNormalizedPos(e);
      currentStroke.points.push(pos);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        const w = canvas.width;
        const h = canvas.height;
        const pts = currentStroke.points;
        const p1 = pts[pts.length - 2];
        const p2 = pts[pts.length - 1];
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (currentStroke.tool === 'highlighter') {
          ctx.strokeStyle = currentStroke.color.startsWith('#') ? `${currentStroke.color}66` : currentStroke.color;
          ctx.lineWidth = Math.max(12, w * 0.015);
        } else {
          ctx.strokeStyle = currentStroke.color;
          ctx.lineWidth = Math.max(3, w * 0.0035);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    function endStroke() {
      if (!isDrawing || !currentStroke) return;
      isDrawing = false;
      const slide = state.definition?.slides?.[state.index];
      if (slide && currentStroke.points.length > 1) {
        if (!state.annotations[slide.slideId]) state.annotations[slide.slideId] = [];
        state.annotations[slide.slideId].push(currentStroke);
        if (state.syncChannel) {
          state.syncChannel.postMessage({
            type: 'STROKE',
            slideId: slide.slideId,
            stroke: currentStroke
          });
        }
      }
      currentStroke = null;
    }

    canvas.addEventListener('mousedown', startStroke);
    canvas.addEventListener('mousemove', moveStroke);
    window.addEventListener('mouseup', endStroke);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startStroke(e); }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); moveStroke(e); }, { passive: false });
    window.addEventListener('touchend', endStroke);

    if (elements.annotationToolbar) {
      elements.annotationToolbar.querySelectorAll('.anim-tool-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tool = btn.dataset.tool;
          if (tool === 'clear') {
            const slide = state.definition?.slides?.[state.index];
            if (slide) {
              state.annotations[slide.slideId] = [];
              redrawAnnotations();
              if (state.syncChannel) {
                state.syncChannel.postMessage({ type: 'CLEAR', slideId: slide.slideId });
              }
            }
            return;
          }
          setTool(tool);
        });
      });
    }

    if (elements.toolColors) {
      elements.toolColors.querySelectorAll('.anim-color-dot').forEach((dot) => {
        dot.addEventListener('click', () => {
          state.activeColor = dot.dataset.color;
          elements.toolColors.querySelectorAll('.anim-color-dot').forEach((d) => d.classList.remove('is-active'));
          dot.classList.add('is-active');
        });
      });
    }

    if (elements.toggleTools) {
      elements.toggleTools.addEventListener('click', () => {
        const isHidden = elements.annotationToolbar.hidden;
        elements.annotationToolbar.hidden = !isHidden;
        if (!isHidden) setTool('pointer');
      });
    }
  }

  function setTool(tool) {
    state.activeTool = tool;
    if (elements.annotationToolbar) {
      elements.annotationToolbar.querySelectorAll('.anim-tool-btn').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.tool === tool);
      });
    }
    if (elements.toolColors) {
      elements.toolColors.hidden = tool !== 'pen' && tool !== 'highlighter';
    }
    if (elements.stage) {
      elements.stage.classList.toggle('is-laser', tool === 'laser');
      elements.stage.classList.toggle('is-drawing', tool === 'pen' || tool === 'highlighter');
    }
    if (tool !== 'laser' && elements.laserDot) {
      elements.laserDot.hidden = true;
    }
  }

  // Presenter View Rendering & Timer
  let timerInterval = null;
  let timerSeconds = 0;
  let timerRunning = true;

  function renderSlidePreview(stageEl, slide, step = 999) {
    if (!stageEl || !slide) return;
    stageEl.dataset.aspect = state.definition?.settings?.aspectRatio || '16:9';
    stageEl.style.backgroundImage = 'none';
    stageEl.style.background = slide.backgroundType === 'gradient'
      ? `linear-gradient(${slide.gradientAngle}deg, ${slide.gradientFrom}, ${slide.gradientTo})`
      : slide.background;
    const oldStep = state.currentStep;
    state.currentStep = step;
    stageEl.replaceChildren(...slide.elements.slice().sort((a, b) => a.z - b.z).map(renderElement));
    state.currentStep = oldStep;
    if (slide.backgroundRef && slide.backgroundType === 'image') {
      void mediaBlob(slide.backgroundRef).then((blob) => {
        if (!stageEl.isConnected) return;
        const url = URL.createObjectURL(blob);
        state.urls.add(url);
        stageEl.style.backgroundImage = `url(${url})`;
        stageEl.style.backgroundSize = 'cover';
        stageEl.style.backgroundPosition = 'center';
      }).catch(() => {});
    }
  }

  function renderPresenter() {
    if (!elements.presenterView || !state.definition) return;
    const slides = state.definition.slides;
    const slide = slides[state.index];
    const maxStep = getMaxStep(slide);
    state.currentStep = Math.min(Math.max(0, state.currentStep || 0), maxStep);

    if (elements.presenterTitle) elements.presenterTitle.textContent = state.definition.metadata.title || 'Prezentacja';
    if (elements.presenterPos) elements.presenterPos.textContent = `${state.index + 1} / ${slides.length}`;
    if (elements.presenterStepBadge) elements.presenterStepBadge.textContent = maxStep > 0 ? `Krok ${state.currentStep} / ${maxStep}` : 'Brak kroków';

    renderSlidePreview(elements.presenterStageCurrent, slide, state.currentStep);

    const nextIndex = state.index + 1;
    if (nextIndex < slides.length) {
      const nextSlide = slides[nextIndex];
      if (elements.presenterNextTitle) elements.presenterNextTitle.textContent = nextSlide.title || `Slajd ${nextIndex + 1}`;
      if (elements.presenterNextEnd) elements.presenterNextEnd.hidden = true;
      if (elements.presenterStageNext) {
        elements.presenterStageNext.hidden = false;
        renderSlidePreview(elements.presenterStageNext, nextSlide, 999);
      }
    } else {
      if (elements.presenterNextTitle) elements.presenterNextTitle.textContent = 'Koniec prezentacji';
      if (elements.presenterStageNext) {
        elements.presenterStageNext.replaceChildren();
        elements.presenterStageNext.hidden = true;
      }
      if (elements.presenterNextEnd) elements.presenterNextEnd.hidden = false;
    }

    if (elements.presenterNotes) {
      const notes = (slide.notes || '').trim();
      elements.presenterNotes.textContent = notes || 'Brak notatek dla tego slajdu.';
      elements.presenterNotes.style.fontStyle = notes ? 'normal' : 'italic';
      elements.presenterNotes.style.opacity = notes ? '1' : '0.6';
    }

    if (elements.presenterPrevBtn) {
      elements.presenterPrevBtn.disabled = state.index === 0 && state.currentStep === 0;
    }
    if (elements.presenterNextBtn) {
      const isLast = state.index === slides.length - 1;
      elements.presenterNextBtn.textContent = (isLast && state.currentStep >= maxStep) ? 'Zakończ ✓' : 'Następny krok →';
    }

    renderPresenterFilmstrip();
  }

  function renderPresenterFilmstrip() {
    if (!elements.presenterFilmstrip || !state.definition) return;
    const slides = state.definition.slides;
    elements.presenterFilmstrip.replaceChildren(...slides.map((s, idx) => {
      const thumb = document.createElement('div');
      thumb.className = `presenter-thumb${idx === state.index ? ' is-active' : ''}`;
      const num = document.createElement('span');
      num.className = 'presenter-thumb-num';
      num.textContent = idx + 1;
      const title = document.createElement('span');
      title.className = 'presenter-thumb-title';
      title.textContent = s.title || `Slajd ${idx + 1}`;
      thumb.append(num, title);
      thumb.addEventListener('click', () => {
        state.index = idx;
        state.currentStep = 0;
        renderPresenter();
        broadcastState('NAVIGATE');
      });
      return thumb;
    }));
  }

  function initPresenterTimer() {
    function formatTime(totalSec) {
      const hrs = Math.floor(totalSec / 3600).toString().padStart(2, '0');
      const mins = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
      const secs = (totalSec % 60).toString().padStart(2, '0');
      return `${hrs}:${mins}:${secs}`;
    }

    function updateClock() {
      if (!elements.presenterClock) return;
      const now = new Date();
      elements.presenterClock.textContent = now.toTimeString().split(' ')[0];
    }

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      updateClock();
      if (timerRunning) {
        timerSeconds += 1;
        if (elements.presenterTimer) elements.presenterTimer.textContent = formatTime(timerSeconds);
      }
    }, 1000);
    updateClock();

    if (elements.presenterTimerToggle) {
      elements.presenterTimerToggle.addEventListener('click', () => {
        timerRunning = !timerRunning;
        elements.presenterTimerToggle.textContent = timerRunning ? '⏸' : '▶';
        elements.presenterTimerToggle.title = timerRunning ? 'Pauza' : 'Wznów';
      });
    }

    if (elements.presenterTimerReset) {
      elements.presenterTimerReset.addEventListener('click', () => {
        timerSeconds = 0;
        if (elements.presenterTimer) elements.presenterTimer.textContent = '00:00:00';
      });
    }

    if (elements.presenterFontInc) {
      elements.presenterFontInc.addEventListener('click', () => {
        state.notesFontSize = Math.min(2.2, (state.notesFontSize || 1.1) + 0.15);
        if (elements.presenterNotes) elements.presenterNotes.style.setProperty('--presenter-notes-fs', `${state.notesFontSize}rem`);
      });
    }
    if (elements.presenterFontDec) {
      elements.presenterFontDec.addEventListener('click', () => {
        state.notesFontSize = Math.max(0.75, (state.notesFontSize || 1.1) - 0.15);
        if (elements.presenterNotes) elements.presenterNotes.style.setProperty('--presenter-notes-fs', `${state.notesFontSize}rem`);
      });
    }

    if (elements.presenterPrevBtn) {
      elements.presenterPrevBtn.addEventListener('click', () => {
        prevStepOrSlide();
        renderPresenter();
        broadcastState('NAVIGATE');
      });
    }
    if (elements.presenterNextBtn) {
      elements.presenterNextBtn.addEventListener('click', () => {
        nextStepOrSlide();
        renderPresenter();
        broadcastState('NAVIGATE');
      });
    }
  }

  // Cross-Window Synchronization (BroadcastChannel)
  function initSyncChannel() {
    if (typeof BroadcastChannel !== 'function') return null;
    try {
      const channel = new BroadcastChannel(`nextmed-pres-sync-${state.presentationId}`);
      channel.onmessage = (event) => {
        const data = event.data;
        if (!data) return;
        if (data.type === 'NAVIGATE') {
          if (state.index !== data.index || state.currentStep !== data.step) {
            state.index = data.index;
            state.currentStep = data.step;
            if (state.isPresenterMode) renderPresenter();
            else render();
          }
        } else if (data.type === 'LASER') {
          if (elements.laserDot) {
            if (data.visible) {
              elements.laserDot.hidden = false;
              elements.laserDot.style.left = `${data.x * 100}%`;
              elements.laserDot.style.top = `${data.y * 100}%`;
            } else {
              elements.laserDot.hidden = true;
            }
          }
        } else if (data.type === 'STROKE') {
          if (!state.annotations[data.slideId]) state.annotations[data.slideId] = [];
          state.annotations[data.slideId].push(data.stroke);
          if (!state.isPresenterMode) redrawAnnotations();
        } else if (data.type === 'CLEAR') {
          state.annotations[data.slideId] = [];
          if (!state.isPresenterMode) redrawAnnotations();
        } else if (data.type === 'REQUEST_STATE') {
          broadcastState('STATE_RESPONSE');
        } else if (data.type === 'STATE_RESPONSE') {
          if (state.isPresenterMode) {
            state.index = data.index;
            state.currentStep = data.step;
            renderPresenter();
          }
        }
      };
      return channel;
    } catch (_) {
      return null;
    }
  }

  function broadcastState(type = 'NAVIGATE') {
    if (!state.syncChannel) return;
    try {
      state.syncChannel.postMessage({
        type,
        index: state.index,
        step: state.currentStep,
        presentationId: state.presentationId
      });
    } catch (_) {}
  }

  async function exportPresentationToPdf() {
    if (!state.definition?.slides?.length) return;
    const originalTitle = document.title;
    document.title = `${state.definition.metadata.title || 'Prezentacja'} — Slajdy PDF`;

    let printContainer = document.getElementById('presentation-print-container');
    if (!printContainer) {
      printContainer = document.createElement('div');
      printContainer.id = 'presentation-print-container';
      printContainer.className = 'presentation-print-container';
      document.body.appendChild(printContainer);
    }
    printContainer.replaceChildren();

    if (elements.pdf) elements.pdf.textContent = 'Generuję PDF…';

    for (let i = 0; i < state.definition.slides.length; i++) {
      const slide = state.definition.slides[i];
      const page = document.createElement('div');
      page.className = 'presentation-print-page';

      const stage = document.createElement('div');
      stage.className = 'presentation-player-stage presentation-print-stage';
      stage.dataset.aspect = state.definition.settings?.aspectRatio || '16:9';
      stage.style.backgroundImage = 'none';
      stage.style.background = slide.backgroundType === 'gradient'
        ? `linear-gradient(${slide.gradientAngle}deg, ${slide.gradientFrom}, ${slide.gradientTo})`
        : slide.background;

      const oldStep = state.currentStep;
      state.currentStep = 999;
      const renderedEls = slide.elements.slice().sort((a, b) => a.z - b.z).map(renderElement);
      state.currentStep = oldStep;
      stage.replaceChildren(...renderedEls);

      if (slide.backgroundRef && slide.backgroundType === 'image') {
        try {
          const blob = await mediaBlob(slide.backgroundRef);
          const url = URL.createObjectURL(blob);
          state.urls.add(url);
          stage.style.backgroundImage = `url(${url})`;
          stage.style.backgroundSize = 'cover';
          stage.style.backgroundPosition = 'center';
        } catch (_) {}
      }

      page.appendChild(stage);
      printContainer.appendChild(page);
    }

    if (elements.pdf) elements.pdf.textContent = '📄 PDF';

    window.print();

    window.addEventListener('afterprint', () => {
      document.title = originalTitle;
      printContainer?.replaceChildren();
    }, { once: true });
  }




  function scheduleSlidePrefetch(currentIndex) {
    const upcomingSlides = state.definition.slides.slice(currentIndex + 1, currentIndex + 3);
    upcomingSlides.forEach((slide) => {
      if (slide.backgroundRef && slide.backgroundType === 'image') {
        void mediaBlob(slide.backgroundRef).catch(() => {});
      }
      slide.elements.filter((el) => el.type === 'image' && el.ref).forEach((el) => {
        void mediaBlob(el.ref, el.repositoryId).catch(() => {});
      });
    });
  }

  function saveProgress(slide) {
    if (!progressApi || state.preview) return;
    elements.save.textContent = 'Zapisywanie…';
    progressApi.update({
      materialId: state.materialId,
      materialType: 'presentation',
      action: 'presentation',
      lastPosition: { slideId: slide.slideId, slideIndex: state.index },
      details: {
        lastSlideId: slide.slideId,
        lastSlideIndex: state.index,
        highestReachedSlide: Math.max(state.index + 1, ...Array.from(state.visited).map((id) => state.definition.slides.findIndex((slideItem) => slideItem.slideId === id) + 1)),
        visitedSlides: [...state.visited],
        totalSlides: state.definition.slides.length
      }
    }).then(() => {
      elements.save.textContent = 'Postęp zapisany';
    }).catch(() => {
      elements.save.textContent = 'Zapis ponowi się później';
    });
  }

  async function loadPresentation() {
    if (state.loading) return;
    state.loading = true;
    elements.loading.hidden = false;
    elements.player.hidden = true;
    elements.error.hidden = true;

    let auth;
    try {
      auth = await window.ChemAuth.ready;
    } catch (_) {
      auth = null;
    }
    if (!auth?.authenticated || !auth.session?.ok) {
      state.loading = false;
      showError('Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.');
      return;
    }

    const params = new URLSearchParams(location.search);
    state.presentationId = String(params.get('presentation') || '').trim().toLowerCase();
    state.repositoryId = String(params.get('repo') || 'default').trim().toLowerCase() || 'default';
    state.preview = params.get('preview') === '1';

    if (window.ChemContentLibrary?.repositories) {
      try {
        state.availableRepositories = await window.ChemContentLibrary.repositories();
        if (Array.isArray(state.availableRepositories) && state.availableRepositories.length > 0) {
          const matching = state.availableRepositories.find((r) => r.id === state.repositoryId);
          if (!matching) {
            const fallback = state.availableRepositories.find((r) => r.default) || state.availableRepositories[0];
            if (fallback) state.repositoryId = fallback.id;
          }
        }
      } catch (_) {}
    }

    try {
      state.definition = await requestDefinition();
      state.materialId = progressApi?.materialId('presentation', `${state.repositoryId}:${state.presentationId}`, params.get('material') || '') || '';
      if (progressApi && !state.preview) {
        await progressApi.load().catch(() => {});
        const saved = progressApi.record(state.materialId);
        const lastId = saved?.details?.lastSlideId || saved?.lastPosition?.slideId;
        const last = state.definition.slides.findIndex((slide) => slide.slideId === lastId);
        if (last >= 0) state.index = last;
        (saved?.details?.visitedSlides || []).forEach((id) => state.visited.add(id));
      }
      elements.title.textContent = state.definition.metadata.title;
      window.NextMedBrand ? window.NextMedBrand.setTitle(state.definition.metadata.title) : (document.title = state.definition.metadata.title + " — NextMed");
      elements.loading.hidden = true;

      const isPresenter = params.get('presenter') === '1' || params.get('mode') === 'presenter';
      state.isPresenterMode = isPresenter;
      state.syncChannel = initSyncChannel();

      if (isPresenter) {
        document.querySelector('.presentation-player-topbar')?.setAttribute('hidden', '');
        elements.player.hidden = true;
        if (elements.presenterView) elements.presenterView.hidden = false;
        initPresenterTimer();
        renderPresenter();
        if (state.syncChannel) {
          state.syncChannel.postMessage({ type: 'REQUEST_STATE' });
        }
      } else {
        elements.player.hidden = false;
        if (elements.presenterView) elements.presenterView.hidden = true;
        const user = window.ChemAuth?.getUser?.();
        const roles = user?.app_metadata?.roles || [];
        const isAdmin = roles.includes('admin') || roles.includes('instructor') || user?.email?.endsWith('@nextmed.pl');
        if (isAdmin) {
          if (elements.edit) {
            elements.edit.hidden = false;
            elements.edit.href = `/members/module/studio/?mode=presentation&id=${encodeURIComponent(state.presentationId)}&repo=${encodeURIComponent(state.repositoryId)}`;
          }
          if (elements.presenterBtn) {
            elements.presenterBtn.hidden = false;
            elements.presenterBtn.addEventListener('click', () => {
              const url = new URL(location.href);
              url.searchParams.set('presenter', '1');
              window.open(url.toString(), `NextMedPresenter_${state.presentationId}`, 'width=1280,height=850,menubar=no,toolbar=no,location=no');
            });
          }
          if (elements.toggleTools) {
            elements.toggleTools.hidden = false;
          }
        } else {
          if (elements.edit) elements.edit.hidden = true;
          if (elements.presenterBtn) elements.presenterBtn.hidden = true;
          if (elements.toggleTools) elements.toggleTools.hidden = true;
        }
        initLiveAnnotations();
        render();
        if (params.get('print') === '1') {
          setTimeout(() => exportPresentationToPdf(), 500);
        }
      }
    } catch (error) {
      showError(friendlyError(error));
    } finally {
      state.loading = false;
    }
  }

  // Bind controls
  if (elements.retry) elements.retry.addEventListener('click', () => loadPresentation());
  if (elements.pdf) elements.pdf.addEventListener('click', () => exportPresentationToPdf());
  elements.previous.addEventListener('click', () => prevStepOrSlide());
  elements.next.addEventListener('click', () => nextStepOrSlide());

  elements.outlineToggle.addEventListener('click', () => elements.outline.classList.toggle('is-open'));
  elements.fullscreen.addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : elements.main.requestFullscreen());
  elements.theme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('chem.theme', next); } catch (_) {}
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input,textarea,select')) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === 'p' || event.key === 'P')) {
      event.preventDefault();
      exportPresentationToPdf();
      return;
    }

    if (['l', 'L'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setTool(state.activeTool === 'laser' ? 'pointer' : 'laser');
      return;
    } else if (['p', 'P'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setTool(state.activeTool === 'pen' ? 'pointer' : 'pen');
      return;
    } else if (['h', 'H'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setTool(state.activeTool === 'highlighter' ? 'pointer' : 'highlighter');
      return;
    } else if (['v', 'V'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setTool('pointer');
      return;
    } else if (['e', 'E'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const slide = state.definition?.slides?.[state.index];
      if (slide) {
        state.annotations[slide.slideId] = [];
        redrawAnnotations();
        if (state.syncChannel) state.syncChannel.postMessage({ type: 'CLEAR', slideId: slide.slideId });
      }
      return;
    }

    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
      if (event.target.matches('button') && (event.key === ' ' || event.key === 'Enter')) return;
      event.preventDefault();
      nextStepOrSlide();
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key)) {
      event.preventDefault();
      prevStepOrSlide();
    } else if (event.key === 'Home') {
      if (state.index !== 0 || state.currentStep !== 0) {
        event.preventDefault();
        state.index = 0;
        state.currentStep = 0;
        if (state.isPresenterMode) renderPresenter();
        else render();
        broadcastState('NAVIGATE');
      }
    } else if (event.key === 'End') {
      if (isSlideLocked(state.definition?.slides?.[state.index])) {
        triggerLockNotice();
        return;
      }
      const last = state.definition.slides.length - 1;
      const lastSlide = state.definition.slides[last];
      const maxStep = getMaxStep(lastSlide);
      if (state.index !== last || state.currentStep !== maxStep) {
        event.preventDefault();
        state.index = last;
        state.currentStep = maxStep;
        if (state.isPresenterMode) renderPresenter();
        else render();
        broadcastState('NAVIGATE');
      }
    } else if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      document.fullscreenElement ? document.exitFullscreen() : elements.main.requestFullscreen();
    }
  });


  let touchStart = null;
  elements.stage.addEventListener('touchstart', (event) => {
    const point = event.changedTouches[0];
    touchStart = point ? { x: point.clientX, y: point.clientY } : null;
  }, { passive: true });
  elements.stage.addEventListener('touchend', (event) => {
    if (!touchStart || !state.definition?.slides?.length) return;
    const point = event.changedTouches[0];
    const dx = point ? point.clientX - touchStart.x : 0;
    const dy = point ? point.clientY - touchStart.y : 0;
    touchStart = null;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx < 0) nextStepOrSlide();
    else if (dx > 0) prevStepOrSlide();
  }, { passive: true });


  await loadPresentation();
})();
