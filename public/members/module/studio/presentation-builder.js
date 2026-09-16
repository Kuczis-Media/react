(function initializePresentationBuilder(root) {
  'use strict';

  const modelApi = root.ChemPresentationStudioModel;
  const library = root.ChemContentLibrary;
  const pagedListApi = root.ChemStudioPagedList;
  if (!modelApi || !library || !pagedListApi) return;

  const byId = (id) => root.document.getElementById(id);
  const elements = {
    workspace: byId('presentation-workspace'),
    title: byId('presentation-title'),
    repository: byId('presentation-repository'),
    search: byId('presentation-search'),
    library: byId('presentation-library'),
    libraryStatus: byId('presentation-library-status'),
    slides: byId('presentation-slide-list'),
    layout: byId('presentation-layout'),
    zoom: byId('presentation-zoom'),
    stageWrap: byId('presentation-stage-wrap'),
    canvas: byId('presentation-canvas'),
    notes: byId('presentation-notes'),
    propertiesTitle: byId('presentation-properties-title'),
    properties: byId('presentation-properties'),
    status: byId('presentation-status')
  };
  if (!elements.workspace) return;

  const DRAFT_KEY = 'chemdisk.studio.presentation.v1';
  const state = {
    presentation: null,
    selectedSlideId: '',
    selectedElementId: '',
    selectedElementIds: new Set(),
    repositoryId: '',
    remoteId: '',
    remoteSha: '',
    repositories: [],
    assets: [],
    active: false,
    loaded: false,
    libraryPaging: pagedListApi.createState(),
    undo: [],
    redo: [],
    clipboard: null,
    objectUrls: new Set(),
    inputSnapshot: '',
    dragSnapshot: ''
  };

  const create = (tag, className, text) => {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function snapshot() { return JSON.stringify(state.presentation); }
  function restore(raw) {
    state.presentation = modelApi.parse(raw);
    if (!state.presentation.slides.some((slide) => slide.slideId === state.selectedSlideId)) {
      state.selectedSlideId = state.presentation.slides[0]?.slideId || '';
    }
    if (!selectedSlide()?.elements.some((element) => element.elementId === state.selectedElementId)) state.selectedElementId = '';
  }
  function saveLocal() {
    try { root.localStorage.setItem(DRAFT_KEY, snapshot()); } catch (_) {}
  }
  function setStatus(message, error) {
    elements.status.textContent = message || '';
    elements.status.classList.toggle('is-error', Boolean(error));
  }

  function setLibraryStatus(message, error = false) {
    if (!elements.libraryStatus) return;
    elements.libraryStatus.textContent = message || '';
    elements.libraryStatus.classList.toggle('is-error', Boolean(error));
  }

  function pushHistory(raw = snapshot()) {
    if (state.undo[state.undo.length - 1] !== raw) state.undo.push(raw);
    state.undo = state.undo.slice(-200);
    state.redo = [];
  }

  function mutate(task, label = 'Niezapisane zmiany') {
    pushHistory();
    task();
    saveLocal();
    setStatus(label);
    render();
  }

  function selectedSlide() {
    return state.presentation?.slides.find((slide) => slide.slideId === state.selectedSlideId)
      || state.presentation?.slides[0]
      || null;
  }
  function selectedElement() {
    return selectedSlide()?.elements.find((element) => element.elementId === state.selectedElementId) || null;
  }

  function loadDraft() {
    let draft = null;
    try { draft = root.localStorage.getItem(DRAFT_KEY); } catch (_) {}
    try { state.presentation = draft ? modelApi.parse(draft) : modelApi.createPresentation(); }
    catch (_) { state.presentation = modelApi.createPresentation(); }
    state.selectedSlideId = state.presentation.slides[0].slideId;
  }

  async function loadLibrary(refresh = false) {
    setLibraryStatus('Pobieranie biblioteki prezentacji…');
    try {
      if (!state.repositories.length) state.repositories = await library.repositories();
      if (!state.repositoryId) state.repositoryId = state.repositories.find((entry) => entry.default)?.id || state.repositories[0]?.id || '';
      elements.repository.replaceChildren(...state.repositories.map((entry) => {
        const option = create('option', '', entry.label || entry.repository);
        option.value = entry.id;
        return option;
      }));
      elements.repository.value = state.repositoryId;
      state.assets = await library.list('presentation', { repositoryId: state.repositoryId, refresh });
      renderLibrary();
    } catch (error) {
      setLibraryStatus(error?.message || 'Nie udało się wczytać prezentacji.', true);
      setStatus(error?.message || 'Nie udało się wczytać prezentacji.', true);
    }
  }

  function renderLibrary() {
    const assets = library.search(state.assets, elements.search.value);
    const paged = pagedListApi.page(state.libraryPaging, 'presentation-library', assets);
    elements.library.replaceChildren(...paged.items.map((asset) => {
      const button = create('button', `repository-asset${state.remoteId === asset.filename ? ' is-active' : ''}`);
      button.type = 'button';
      const copy = create('span');
      copy.append(create('strong', '', asset.title || asset.filename), create('small', '', asset.filename));
      button.append(
        create('span', 'repository-asset-kind', 'SLIDE'),
        copy,
        create('span', 'repository-asset-action', 'Otwórz')
      );
      button.addEventListener('click', () => void openAsset(asset));
      return button;
    }));
    if (!assets.length) {
      setLibraryStatus(state.assets.length ? 'Brak prezentacji pasujących do wyszukiwania.' : 'Brak prezentacji w tej bibliotece.');
    } else {
      setLibraryStatus(`${assets.length} pasujących prezentacji.`);
      elements.library.append(pagedListApi.controls(root.document, state.libraryPaging, paged, {
        label: 'prezentacji',
        onMore: renderLibrary
      }));
    }
  }

  const imageBlobCache = new Map();

  function cleanupUrls() {
    imageBlobCache.forEach(({ url }) => root.URL.revokeObjectURL(url));
    imageBlobCache.clear();
    state.objectUrls.forEach((url) => root.URL.revokeObjectURL(url));
    state.objectUrls.clear();
  }

  function render() {
    if (!state.presentation) return;
    elements.title.value = state.presentation.metadata.title;
    const slide = selectedSlide();
    if (slide) {
      state.selectedSlideId = slide.slideId;
      elements.layout.value = slide.layout;
      elements.notes.value = slide.notes;
    }
    elements.stageWrap.style.setProperty('--presentation-zoom', elements.zoom.value || '.9');
    elements.canvas.dataset.aspect = state.presentation.settings.aspectRatio;
    renderSlides();
    renderCanvas();
    renderProperties();
    updateToolbar();
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
        container.append(create('br'));
      } else {
        if (currentTag) {
          container.append(create(currentTag, '', part));
        } else {
          container.append(root.document.createTextNode(part));
        }
      }
    });
  }

  function updateToolbar() {
    const undo = elements.workspace.querySelectorAll('[data-presentation-action="undo"]');
    const redo = elements.workspace.querySelectorAll('[data-presentation-action="redo"]');
    undo.forEach((btn) => { btn.disabled = !state.undo.length; });
    redo.forEach((btn) => { btn.disabled = !state.redo.length; });

    const fontSelect = byId('presentation-font-family');
    if (fontSelect && !fontSelect.children.length) {
      fontOptions().forEach(([val, label]) => {
        const opt = create('option', '', label);
        opt.value = val;
        fontSelect.append(opt);
      });
    }

    const element = selectedElement();
    const isText = Boolean(element && (element.type === 'text' || element.type === 'heading'));
    const isShape = Boolean(element && element.type === 'shape');

    if (fontSelect) fontSelect.value = isText ? (element.fontFamily || 'inter') : (state.presentation?.settings?.bodyFont || 'inter');

    const fontSizeInput = byId('presentation-font-size');
    if (fontSizeInput) fontSizeInput.value = isText ? (element.fontSize || 30) : '';

    const colorPicker = byId('presentation-color-picker');
    const colorBar = byId('presentation-text-color-bar');
    if (colorPicker) colorPicker.value = isText ? (element.color || '#17233a') : '#17233a';
    if (colorBar) colorBar.style.background = isText ? (element.color || '#17233a') : '#17233a';

    const fillPicker = byId('presentation-fill-picker');
    const fillBar = byId('presentation-fill-color-bar');
    if (fillPicker) fillPicker.value = isShape ? (element.fill || '#dff4ef') : '#dff4ef';
    if (fillBar) fillBar.style.background = isShape ? (element.fill || '#dff4ef') : '#dff4ef';

    const borderPicker = byId('presentation-border-picker');
    const borderBar = byId('presentation-border-color-bar');
    if (borderPicker) borderPicker.value = isShape ? (element.border || '#0d7a6a') : '#0d7a6a';
    if (borderBar) borderBar.style.background = isShape ? (element.border || '#0d7a6a') : '#0d7a6a';

    const borderWidth = byId('presentation-border-width');
    if (borderWidth) borderWidth.value = String(isShape ? (element.borderWidth || 1) : 1);

    const toggle = (id, active) => {
      const node = byId(id);
      if (node) node.classList.toggle('is-active', Boolean(active));
    };
    toggle('presentation-btn-bold', isText && element.bold);
    toggle('presentation-btn-italic', isText && element.italic);
    toggle('presentation-btn-underline', isText && element.underline);
    toggle('presentation-btn-strikethrough', isText && element.strikethrough);
    toggle('presentation-btn-align-left', isText && (!element.align || element.align === 'left'));
    toggle('presentation-btn-align-center', isText && element.align === 'center');
    toggle('presentation-btn-align-right', isText && element.align === 'right');
    toggle('presentation-btn-align-justify', isText && element.align === 'justify');

    const hasMulti = Boolean(state.selectedElementIds && state.selectedElementIds.size > 1);
    const hasGrouped = Boolean(selectedSlide()?.elements.some((item) => (item.elementId === state.selectedElementId || state.selectedElementIds?.has(item.elementId)) && item.groupId));
    const btnGroup = byId('presentation-btn-group');
    if (btnGroup) btnGroup.disabled = !hasMulti;
    const btnUngroup = byId('presentation-btn-ungroup');
    if (btnUngroup) btnUngroup.disabled = !hasGrouped;
  }

  function renderSlides() {
    if (root.NextMedUI?.render('studio-presentation-slides', elements.slides, {
      slides: state.presentation.slides, selected: state.selectedSlideId,
      onMove(sourceId, target) {
        const from = state.presentation.slides.findIndex((entry) => entry.slideId === sourceId);
        if (from < 0 || from === target || target < 0 || target >= state.presentation.slides.length) return;
        mutate(() => { const [moved] = state.presentation.slides.splice(from, 1); state.presentation.slides.splice(target, 0, moved); });
      },
      onAction(action, id) {
        const index = state.presentation.slides.findIndex((slide) => slide.slideId === id);
        if (index < 0) return;
        const slide = state.presentation.slides[index];
        if (action === 'select') { state.selectedSlideId = id; state.selectedElementId = ''; render(); return; }
        if (action === 'delete' && (state.presentation.slides.length < 2 || !root.confirm(`Usunąć slajd „${slide.title}”?`))) return;
        mutate(() => {
          if (action === 'up' || action === 'down') {
            const target = index + (action === 'up' ? -1 : 1);
            if (target < 0 || target >= state.presentation.slides.length) return;
            state.presentation.slides.splice(index, 1); state.presentation.slides.splice(target, 0, slide);
          } else if (action === 'duplicate') {
            const copy = modelApi.duplicateSlide(slide);
            state.presentation.slides.splice(index + 1, 0, copy); state.selectedSlideId = copy.slideId; state.selectedElementId = '';
          } else if (action === 'delete') {
            state.presentation.slides.splice(index, 1);
            state.selectedSlideId = state.presentation.slides[Math.min(index, state.presentation.slides.length - 1)].slideId;
            state.selectedElementId = '';
          }
        });
      }
    })) return;
    const rows = state.presentation.slides.map((slide, index) => {
      const row = create('article', `presentation-slide-row${slide.slideId === state.selectedSlideId ? ' is-selected' : ''}`);
      row.draggable = true;
      row.dataset.slideId = slide.slideId;
      row.dataset.slideIndex = String(index);
      const number = create('span', 'presentation-slide-number', index + 1);
      const thumb = create('button', 'presentation-slide-thumb');
      thumb.type = 'button';
      thumb.style.position = 'relative';
      thumb.style.background = slide.backgroundType === 'gradient'
        ? `linear-gradient(${slide.gradientAngle ?? 135}deg, ${slide.gradientFrom || '#ffffff'}, ${slide.gradientTo || '#cbd5e1'})`
        : slide.background;

      const previewBox = create('div', 'presentation-slide-thumb-elements');
      (slide.elements || []).slice(0, 12).forEach((el) => {
        const item = create('div', `presentation-thumb-el presentation-thumb-el-${el.type}`);
        item.style.position = 'absolute';
        item.style.left = `${el.x}%`;
        item.style.top = `${el.y}%`;
        item.style.width = `${Math.max(4, el.width)}%`;
        item.style.height = `${Math.max(4, el.height)}%`;
        if (el.type === 'shape') {
          item.style.background = el.fill || '#cbd5e1';
          item.style.border = `1px solid ${el.border || 'transparent'}`;
        } else if (el.type === 'text' || el.type === 'heading') {
          item.style.background = el.color ? `color-mix(in srgb, ${el.color} 50%, transparent)` : '#94a3b8';
          item.style.borderRadius = '1px';
        } else if (el.type === 'image') {
          item.style.background = '#93c5fd';
          item.style.borderRadius = '1px';
        } else if (el.type === 'table') {
          item.style.background = '#e2e8f0';
          item.style.border = '1px dashed #94a3b8';
        }
        previewBox.append(item);
      });
      const titleSpan = create('span', 'presentation-slide-thumb-title', slide.title);
      thumb.append(previewBox, titleSpan);

      thumb.addEventListener('click', () => {
        state.selectedSlideId = slide.slideId;
        state.selectedElementId = '';
        render();
      });
      const actions = create('div', 'presentation-slide-actions');
      const up = create('button', '', '↑'); up.type = 'button'; up.title = 'Przesuń wyżej'; up.disabled = index === 0;
      up.addEventListener('click', () => mutate(() => { const [moved] = state.presentation.slides.splice(index, 1); state.presentation.slides.splice(index - 1, 0, moved); }));
      const down = create('button', '', '↓'); down.type = 'button'; down.title = 'Przesuń niżej'; down.disabled = index === state.presentation.slides.length - 1;
      down.addEventListener('click', () => mutate(() => { const [moved] = state.presentation.slides.splice(index, 1); state.presentation.slides.splice(index + 1, 0, moved); }));
      const duplicate = create('button', '', '⧉'); duplicate.type = 'button'; duplicate.title = 'Duplikuj (Ctrl+D)';
      duplicate.addEventListener('click', () => mutate(() => {
        const copy = modelApi.duplicateSlide(slide);
        state.presentation.slides.splice(index + 1, 0, copy);
        state.selectedSlideId = copy.slideId;
        state.selectedElementId = '';
      }));
      const remove = create('button', 'is-danger', '×'); remove.type = 'button'; remove.title = 'Usuń';
      remove.disabled = state.presentation.slides.length < 2;
      remove.addEventListener('click', () => {
        if (!root.confirm(`Usunąć slajd „${slide.title}”?`)) return;
        mutate(() => {
          state.presentation.slides.splice(index, 1);
          state.selectedSlideId = state.presentation.slides[Math.min(index, state.presentation.slides.length - 1)].slideId;
          state.selectedElementId = '';
        });
      });
      actions.append(up, down, duplicate, remove);
      row.append(number, thumb, actions);

      row.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/presentation-slide', slide.slideId);
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => {
        elements.slides.querySelectorAll('.presentation-slide-row').forEach((r) => {
          r.classList.remove('is-dragging', 'is-drop-above', 'is-drop-below');
        });
      });
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        const isAbove = event.clientY < rect.top + rect.height / 2;
        row.classList.toggle('is-drop-above', isAbove);
        row.classList.toggle('is-drop-below', !isAbove);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('is-drop-above', 'is-drop-below');
      });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const isAbove = row.classList.contains('is-drop-above');
        row.classList.remove('is-drop-above', 'is-drop-below');
        const sourceId = event.dataTransfer.getData('text/presentation-slide');
        const from = state.presentation.slides.findIndex((entry) => entry.slideId === sourceId);
        if (from < 0) return;
        let to = index;
        if (!isAbove && from < index) to = index;
        else if (isAbove && from > index) to = index;
        else if (!isAbove) to = Math.min(state.presentation.slides.length - 1, index);
        if (from === to) return;
        mutate(() => {
          const [moved] = state.presentation.slides.splice(from, 1);
          state.presentation.slides.splice(to, 0, moved);
        });
      });

      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openSlideContextMenu(event.clientX, event.clientY, slide, index);
      });

      return row;
    });
    elements.slides.replaceChildren(...rows);
  }

  function openSlideContextMenu(x, y, slide, index) {
    root.document.querySelector('.presentation-context-menu')?.remove();
    const menu = create('div', 'presentation-context-menu');
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(root.innerWidth - 190, Math.max(10, x))}px`;
    menu.style.top = `${Math.min(root.innerHeight - 220, Math.max(10, y))}px`;
    menu.style.zIndex = '9999';

    const addItem = (label, fn, isDanger) => {
      const btn = create('button', isDanger ? 'is-danger' : '', label);
      btn.type = 'button';
      btn.addEventListener('click', () => { menu.remove(); fn(); });
      menu.append(btn);
    };

    addItem('＋ Nowy slajd', () => {
      mutate(() => {
        const fresh = modelApi.createSlide({ layout: 'title-content', title: `Slajd ${state.presentation.slides.length + 1}` });
        state.presentation.slides.splice(index + 1, 0, fresh);
        state.selectedSlideId = fresh.slideId;
        state.selectedElementId = '';
      });
    });

    addItem('⧉ Powiel slajd (Ctrl+D)', () => {
      mutate(() => {
        const copy = modelApi.duplicateSlide(slide);
        state.presentation.slides.splice(index + 1, 0, copy);
        state.selectedSlideId = copy.slideId;
        state.selectedElementId = '';
      });
    });

    addItem('🎨 Zmień tło…', () => {
      state.selectedSlideId = slide.slideId;
      render();
      openImageManager('background');
    });

    if (state.presentation.slides.length > 1) {
      addItem('🗑 Usuń slajd', () => {
        if (!root.confirm(`Usunąć slajd „${slide.title}”?`)) return;
        mutate(() => {
          state.presentation.slides.splice(index, 1);
          state.selectedSlideId = state.presentation.slides[Math.min(index, state.presentation.slides.length - 1)].slideId;
          state.selectedElementId = '';
        });
      }, true);
    }

    root.document.body.append(menu);
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        root.document.removeEventListener('pointerdown', close);
      }
    };
    setTimeout(() => root.document.addEventListener('pointerdown', close), 10);
  }

  function openElementContextMenu(x, y, element) {
    root.document.querySelector('.presentation-context-menu')?.remove();
    const menu = create('div', 'presentation-context-menu');
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(root.innerWidth - 210, Math.max(10, x))}px`;
    menu.style.top = `${Math.min(root.innerHeight - 270, Math.max(10, y))}px`;
    menu.style.zIndex = '9999';

    const addItem = (label, fn, isDanger) => {
      const btn = create('button', isDanger ? 'is-danger' : '', label);
      btn.type = 'button';
      btn.addEventListener('click', () => { menu.remove(); fn(); });
      menu.append(btn);
    };

    const hasMulti = Boolean(state.selectedElementIds && state.selectedElementIds.size > 1);
    const hasGroup = Boolean(element.groupId || selectedSlide()?.elements.some((item) => state.selectedElementIds?.has(item.elementId) && item.groupId));

    if (hasMulti) addItem('⧉ Grupuj (Ctrl+G)', () => propertyAction('group-elements'));
    if (hasGroup) addItem('⧈ Rozgrupuj (Ctrl+Shift+G)', () => propertyAction('ungroup-elements'));
    addItem('⤒ Na sam wierzch (Ctrl+Shift+])', () => propertyAction('layer-front'));
    addItem('↑ Przesuń wyżej (Ctrl+])', () => propertyAction('layer-up'));
    addItem('↓ Przesuń niżej (Ctrl+[)', () => propertyAction('layer-down'));
    addItem('⤓ Na sam spód (Ctrl+Shift+[)', () => propertyAction('layer-back'));
    addItem('❐ Powiel (Ctrl+D)', () => propertyAction('duplicate-element'));
    addItem('🗑 Usuń element (Del)', () => propertyAction('delete-element'), true);

    root.document.body.append(menu);
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        root.document.removeEventListener('pointerdown', close);
      }
    };
    setTimeout(() => root.document.addEventListener('pointerdown', close), 10);
  }

  function startInlineTextEdit(element, node) {
    if (element.locked) return;
    const content = node.querySelector('.presentation-text-content');
    if (!content) return;
    state.isInlineEditing = true;
    state.inlineEditingElementId = element.elementId;
    state.selectedElementId = element.elementId;
    state.selectedElementIds = new Set([element.elementId]);
    node.classList.add('is-inline-editing');
    node.querySelectorAll('.presentation-resize-handle').forEach((h) => { h.style.display = 'none'; });
    content.contentEditable = 'true';
    content.focus();

    const sel = root.getSelection?.();
    if (sel && root.document.createRange) {
      const range = root.document.createRange();
      range.selectNodeContents(content);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const startContent = element.content || '';
    const startSnap = snapshot();

    const onInput = () => {
      element.content = content.innerText || content.textContent || '';
      const propText = elements.properties?.querySelector('[data-presentation-field="content"]');
      if (propText) propText.value = element.content;
      setStatus('Edycja tekstu inline…');
    };

    const onKeyDown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        content.blur();
      }
    };

    const onBlur = () => {
      content.removeEventListener('input', onInput);
      content.removeEventListener('keydown', onKeyDown);
      content.removeEventListener('blur', onBlur);
      content.contentEditable = 'false';
      node.classList.remove('is-inline-editing');
      state.isInlineEditing = false;
      state.inlineEditingElementId = '';
      if (element.content !== startContent) {
        pushHistory(startSnap);
        saveLocal();
        setStatus('Zaktualizowano tekst.');
      }
      renderProperties();
      renderCanvas();
    };

    content.addEventListener('input', onInput);
    content.addEventListener('keydown', onKeyDown);
    content.addEventListener('blur', onBlur, { once: true });
  }

  function renderCanvas() {
    const slide = selectedSlide();
    if (!slide) return;
    elements.canvas.style.backgroundImage = 'none';
    elements.canvas.style.background = slide.backgroundType === 'gradient'
      ? `linear-gradient(${slide.gradientAngle ?? 135}deg, ${slide.gradientFrom || '#ffffff'}, ${slide.gradientTo || '#cbd5e1'})`
      : slide.background;
    elements.canvas.replaceChildren(...slide.elements.slice().sort((a, b) => a.z - b.z).map(renderElement));
    if (slide.backgroundRef && slide.backgroundType === 'image') void loadBackground(slide);
  }

  function renderElement(element) {
    const isSelected = element.elementId === state.selectedElementId || Boolean(state.selectedElementIds?.has(element.elementId));
    const node = create('div', `presentation-element is-${element.type}${isSelected ? ' is-selected' : ''}${element.locked ? ' is-locked' : ''}`);
    node.dataset.elementId = element.elementId;
    if (element.groupId) node.dataset.groupId = element.groupId;
    applyGeometry(node, element);
    if (element.animationType && element.animationType !== 'none') {
      const badge = create('span', 'presentation-anim-badge', String(element.animationOrder || 1));
      badge.title = `Krok odkrywania: ${element.animationOrder || 1} (${element.animationType})`;
      node.append(badge);
    }
    if (element.type === 'text' || element.type === 'heading') {
      node.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startInlineTextEdit(element, node);
      });
      const content = create('div', 'presentation-text-content');
      renderFormattedText(content, element.content || 'Kliknij, aby wpisać tekst');
      Object.assign(content.style, {
        fontFamily: fontStack(element.fontFamily), fontSize: `${element.fontSize}px`, color: element.color,
        fontWeight: String(element.fontWeight || (element.bold ? 800 : 400)), fontStyle: element.italic ? 'italic' : 'normal',
        textDecoration: [element.underline ? 'underline' : '', element.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
        textAlign: element.align || 'left',
        justifyContent: element.verticalAlign === 'center' ? 'center' : element.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
        lineHeight: String(element.lineHeight || 1.15), letterSpacing: `${element.letterSpacing || 0}px`
      });
      node.append(content);
    } else if (element.type === 'shape') {
      const shape = create('div', `presentation-shape is-${element.shape}`);
      Object.assign(shape.style, {
        background: element.fill,
        borderColor: element.border,
        borderWidth: `${element.borderWidth || 1}px`,
        opacity: String(element.opacity ?? 1),
        color: element.border
      });
      node.append(shape);
    } else if (element.type === 'formula') {
      const formula = create('div', 'presentation-formula');
      formula.style.color = element.color;
      formula.style.fontSize = `${element.fontSize}px`;
      if (window.ChemAssessmentText) {
        let expr = String(element.expression || 'H2O').trim();
        if (!expr.startsWith('\\(') && !expr.startsWith('\\[') && !expr.startsWith('$$')) {
          expr = element.mode === 'chemistry' && !expr.startsWith('\\ce{') ? `\\[\\ce{${expr}}\\]` : `\\[${expr}\\]`;
        }
        window.ChemAssessmentText.render(formula, expr);
      } else {
        formula.textContent = element.expression || 'H2O';
      }
      node.append(formula);
    } else if (element.type === 'image') {
      node.classList.toggle('is-cropping', element.cropMode === true);
      const cacheKey = `${element.repositoryId || state.repositoryId}:${element.ref}`;
      const cached = imageBlobCache.get(cacheKey);
      if (cached?.url) {
        const image = create('img');
        image.src = cached.url;
        image.alt = element.alt || '';
        image.style.objectFit = element.fit;
        image.style.objectPosition = `${element.focalX}% ${element.focalY}%`;
        image.style.borderRadius = `${element.borderRadius}px`;
        image.style.opacity = String(element.opacity ?? 1);
        node.append(image);
      } else {
        const placeholder = create('div', 'presentation-image-placeholder', 'Wczytywanie obrazu…');
        node.append(placeholder);
        void loadElementImage(node, element);
      }
    } else if (element.type === 'icon') {
      const icon = create('div', 'presentation-icon', element.symbol);
      Object.assign(icon.style, { color: element.color, background: element.background, fontSize: `${element.fontSize}px`, borderRadius: `${element.borderRadius}px` });
      node.append(icon);
    } else if (element.type === 'table') {
      const table = create('table', 'presentation-table');
      table.style.fontSize = `${element.fontSize}px`;
      const head = create('thead'); const headRow = create('tr');
      element.headers.forEach((cell) => { const th = create('th', '', cell); th.style.background = element.headerColor; headRow.append(th); });
      head.append(headRow); const body = create('tbody');
      element.rows.forEach((row, rowIndex) => { const tr = create('tr'); row.forEach((cell) => { const td = create('td', '', cell); if (rowIndex % 2) td.style.background = element.accentColor; tr.append(td); }); body.append(tr); });
      table.append(head, body); node.append(table);
    } else if (element.type === 'button') {
      const link = create('div', 'presentation-button-element', element.label);
      Object.assign(link.style, { color: element.color, background: element.background, borderRadius: `${element.borderRadius}px` });
      node.append(link);
    } else if (element.type === 'code') {
      const code = create('pre', 'presentation-code'); code.textContent = element.code || 'Wpisz kod…';
      Object.assign(code.style, { color: element.color, background: element.background, fontSize: `${element.fontSize}px` }); node.append(code);
    } else if (element.type === 'embed') {
      const embed = create('div', 'presentation-embed-placeholder');
      embed.append(create('span', '', '▣'), create('strong', '', element.title), create('small', '', element.url || 'Wpisz dozwolony URL osadzenia'));
      node.append(embed);
    } else if (element.type === 'quiz') {
      const quizWrap = create('div', 'presentation-builder-quiz');
      Object.assign(quizWrap.style, {
        background: element.background || '#ffffff',
        border: `1.5px solid ${element.borderColor || '#d9e2ec'}`,
        borderRadius: `${element.borderRadius || 14}px`,
        color: element.color || '#17233a',
        padding: '14px 18px',
        height: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between'
      });
      const qTitle = create('div', 'presentation-quiz-q-preview');
      qTitle.style.fontWeight = '700';
      qTitle.style.fontSize = `${element.fontSize || 18}px`;
      qTitle.style.marginBottom = '10px';
      qTitle.textContent = element.question || 'Wybierz poprawną odpowiedź:';
      if (element.blockNextUntilCorrect) {
        const lockBadge = create('span', 'presentation-quiz-lock-badge', ' 🔒 Blokada');
        lockBadge.style.cssText = 'font-size: 11px; background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle;';
        qTitle.append(lockBadge);
      }
      quizWrap.append(qTitle);

      const optList = create('div', 'presentation-quiz-opts-preview');
      optList.style.display = 'grid';
      optList.style.gap = '6px';
      (element.options || []).forEach((opt, idx) => {
        const optRow = create('div', 'presentation-quiz-opt-preview');
        optRow.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; font-size: 13px; background: ' + (opt.correct ? '#ecfdf5; border: 1px solid #10b981;' : '#f8fafc; border: 1px solid #e2e8f0;');
        const badge = create('strong', '', `${String.fromCharCode(65 + idx)}.`);
        badge.style.color = opt.correct ? '#059669' : '#64748b';
        const txt = create('span', '', opt.text);
        txt.style.flex = '1';
        optRow.append(badge, txt);
        if (opt.correct) {
          const check = create('span', '', '✓');
          check.style.cssText = 'color: #059669; font-weight: bold;';
          optRow.append(check);
        }
        optList.append(optRow);
      });
      quizWrap.append(optList);
      node.append(quizWrap);
    }
    if (element.elementId === state.selectedElementId && !element.locked) {
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((handle) => {
        const resize = create('span', `presentation-resize-handle is-${handle}`);
        resize.dataset.resizeHandle = handle;
        node.append(resize);
      });
    }
    return node;
  }

  function applyGeometry(node, element) {
    Object.assign(node.style, {
      left: `${element.x}%`, top: `${element.y}%`, width: `${element.width}%`, height: `${element.height}%`,
      transform: `rotate(${element.rotation}deg)`, zIndex: String(element.z)
    });
    if (element.fontSize) node.style.setProperty('--elem-fs', String(element.fontSize));
  }

  function fontStack(font) {
    return ({
      roboto: 'Roboto, Arial, sans-serif', 'open-sans': '"Open Sans", Arial, sans-serif', montserrat: 'Montserrat, Arial, sans-serif',
      poppins: 'Poppins, Arial, sans-serif', lato: 'Lato, Arial, sans-serif', nunito: 'Nunito, Arial, sans-serif',
      lora: 'Lora, Georgia, serif', merriweather: 'Merriweather, Georgia, serif', playfair: '"Playfair Display", Georgia, serif',
      georgia: 'Georgia, serif', times: '"Times New Roman", serif', 'jetbrains-mono': '"JetBrains Mono", ui-monospace, monospace',
      'source-code-pro': '"Source Code Pro", ui-monospace, monospace', mono: 'ui-monospace, monospace', arial: 'Arial, sans-serif', verdana: 'Verdana, sans-serif'
    })[font] || 'Inter, system-ui, sans-serif';
  }

  async function loadElementImage(node, element) {
    const cacheKey = `${element.repositoryId || state.repositoryId}:${element.ref}`;
    try {
      let cached = imageBlobCache.get(cacheKey);
      if (!cached?.url) {
        const shared = element.ref.startsWith('assets/shared/');
        const blob = await library.readMediaBlob({
          scope: shared ? 'shared' : 'local', materialKind: shared ? '' : 'presentation',
          materialId: shared ? '' : state.presentation.presentationId, reference: element.ref,
          repositoryId: element.repositoryId || state.repositoryId
        });
        const url = root.URL.createObjectURL(blob);
        cached = { url, blob };
        imageBlobCache.set(cacheKey, cached);
      }
      if (!node.isConnected) return;
      const image = create('img'); image.src = cached.url; image.alt = element.alt;
      image.style.objectFit = element.fit; image.style.objectPosition = `${element.focalX}% ${element.focalY}%`; image.style.borderRadius = `${element.borderRadius}px`; image.style.opacity = String(element.opacity ?? 1);
      node.replaceChildren(image, ...Array.from(node.querySelectorAll('.presentation-resize-handle')));
    } catch (_) { node.querySelector('.presentation-image-placeholder')?.replaceChildren(document.createTextNode('Brak obrazu')); }
  }

  async function loadBackground(slide) {
    const cacheKey = `bg:${state.repositoryId}:${slide.backgroundRef}`;
    try {
      let cached = imageBlobCache.get(cacheKey);
      if (!cached?.url) {
        const shared = slide.backgroundRef.startsWith('assets/shared/');
        const blob = await library.readMediaBlob({
          scope: shared ? 'shared' : 'local', materialKind: shared ? '' : 'presentation',
          materialId: shared ? '' : state.presentation.presentationId, reference: slide.backgroundRef,
          repositoryId: state.repositoryId
        });
        const url = root.URL.createObjectURL(blob);
        cached = { url, blob };
        imageBlobCache.set(cacheKey, cached);
      }
      elements.canvas.style.backgroundImage = `url(${cached.url})`;
      elements.canvas.style.backgroundSize = 'cover';
      elements.canvas.style.backgroundPosition = 'center';
    } catch (_) {}
  }

  function field(label, control, help = '') {
    const wrapper = create('label', 'presentation-field');
    wrapper.append(create('span', '', label), control);
    if (help) wrapper.append(create('small', '', help));
    return wrapper;
  }
  function input(value, path, options = {}) {
    const node = create('input'); node.value = value ?? ''; node.dataset.presentationField = path;
    Object.entries(options).forEach(([key, val]) => { if (key in node) node[key] = val; else node.setAttribute(key, val); });
    return node;
  }
  function textarea(value, path) { const node = create('textarea'); node.value = value ?? ''; node.rows = 4; node.dataset.presentationField = path; return node; }
  function select(value, path, entries) {
    const node = create('select'); node.dataset.presentationField = path;
    entries.forEach(([entryValue, label]) => { const option = create('option', '', label); option.value = entryValue; node.append(option); });
    node.value = value; return node;
  }
  function button(label, action, danger = false) { const node = create('button', danger ? 'is-danger' : '', label); node.type = 'button'; node.dataset.presentationPropertyAction = action; return node; }

  function fontOptions() {
    return [
      ['inter', 'Inter'], ['roboto', 'Roboto'], ['open-sans', 'Open Sans'], ['montserrat', 'Montserrat'], ['poppins', 'Poppins'], ['lato', 'Lato'], ['nunito', 'Nunito'],
      ['arial', 'Arial'], ['verdana', 'Verdana'], ['lora', 'Lora'], ['merriweather', 'Merriweather'], ['playfair', 'Playfair Display'], ['georgia', 'Georgia'], ['times', 'Times New Roman'],
      ['jetbrains-mono', 'JetBrains Mono'], ['source-code-pro', 'Source Code Pro'], ['mono', 'Monospace']
    ];
  }

  function check(value, path) {
    const node = input('', path, { type: 'checkbox' }); node.checked = Boolean(value); return node;
  }

  function actionRow(entries) {
    const row = create('div', 'presentation-action-grid');
    entries.forEach(([label, action]) => row.append(button(label, action)));
    return row;
  }

  const MODERN_BACKGROUND_PRESETS = [
    // --- CIEMNE (Dark & Modern) ---
    { id: 'bio-emerald', name: 'Szmaragd Bio-Lab', category: 'dark', type: 'gradient', from: '#05231c', to: '#0d5e52', angle: 135, bg: '#05231c', textTone: 'light', textColor: '#f0fdf9', description: 'Głęboka zieleń laboratoryjna, idealna dla chemii.' },
    { id: 'nordic-slate', name: 'Nordic Slate', category: 'dark', type: 'gradient', from: '#090d16', to: '#1e293b', angle: 145, bg: '#090d16', textTone: 'light', textColor: '#f8fafc', description: 'Elegancki, minimalistyczny ciemny grafit klasy premium.' },
    { id: 'cyber-indigo', name: 'Cyber Indigo', category: 'dark', type: 'gradient', from: '#0b1120', to: '#2e1065', angle: 135, bg: '#0b1120', textTone: 'light', textColor: '#faf5ff', description: 'Nowoczesny technologiczny fiolet z głębokim indigo.' },
    { id: 'ocean-depths', name: 'Głębia Oceanu', category: 'dark', type: 'gradient', from: '#03192e', to: '#0c4a6e', angle: 150, bg: '#03192e', textTone: 'light', textColor: '#f0f9ff', description: 'Chłodny, profesjonalny błękit naukowo-medyczny.' },
    { id: 'midnight-plum', name: 'Midnight Plum', category: 'dark', type: 'gradient', from: '#160924', to: '#3b0764', angle: 140, bg: '#160924', textTone: 'light', textColor: '#fdf4ff', description: 'Luksusowa śliwka i głęboka purpura.' },
    { id: 'amber-glow', name: 'Amber Glow', category: 'dark', type: 'gradient', from: '#1c100e', to: '#451a14', angle: 135, bg: '#1c100e', textTone: 'light', textColor: '#fff7ed', description: 'Ciepły bursztyn z subtelną burgundową poświatą.' },
    { id: 'pure-carbon', name: 'Węgiel i Czerń', category: 'dark', type: 'gradient', from: '#05070a', to: '#141824', angle: 145, bg: '#05070a', textTone: 'light', textColor: '#f8fafc', description: 'Maksymalny kontrast, głęboka matowa czerń.' },

    // --- JASNE (Clean & Pastel) ---
    { id: 'mint-clean', name: 'Świeża Mięta', category: 'light', type: 'gradient', from: '#ecfdf5', to: '#d1fae5', angle: 135, bg: '#ecfdf5', textTone: 'dark', textColor: '#064e3b', description: 'Świeży, krystaliczny pastelowy odcień mięty.' },
    { id: 'ice-blue', name: 'Błękitna Mgiełka', category: 'light', type: 'gradient', from: '#f0f9ff', to: '#e0f2fe', angle: 140, bg: '#f0f9ff', textTone: 'dark', textColor: '#0c4a6e', description: 'Krystaliczny, czysty błękit laboratoryjny.' },
    { id: 'soft-lavender', name: 'Pastelowa Lawenda', category: 'light', type: 'gradient', from: '#faf5ff', to: '#f3e8ff', angle: 135, bg: '#faf5ff', textTone: 'dark', textColor: '#4c1d95', description: 'Nowoczesny, delikatny fiolet w stylu Gamma.' },
    { id: 'nordic-frost', name: 'Nordic Frost', category: 'light', type: 'gradient', from: '#ffffff', to: '#f1f5f9', angle: 145, bg: '#ffffff', textTone: 'dark', textColor: '#0f172a', description: 'Minimalistyczny, jasny off-white o świetnej czytelności.' },
    { id: 'warm-sand', name: 'Ciepły Piaskowy', category: 'light', type: 'gradient', from: '#fffbeb', to: '#fef3c7', angle: 135, bg: '#fffbeb', textTone: 'dark', textColor: '#78350f', description: 'Ciepły, naturalny papierowy pergamin.' },
    { id: 'rose-quartz', name: 'Różany Kwarc', category: 'light', type: 'gradient', from: '#fff1f2', to: '#ffe4e6', angle: 135, bg: '#fff1f2', textTone: 'dark', textColor: '#881337', description: 'Subtelny pudrowy róż o nowoczesnym wyrazie.' },
    { id: 'aurora-pearl', name: 'Perłowa Zorza', category: 'light', type: 'gradient', from: '#f0fdfa', to: '#fdf4ff', angle: 125, bg: '#f0fdfa', textTone: 'dark', textColor: '#134e4a', description: 'Wielotonowy delikatny gradient z pastelową poświatą.' },

    // --- JEDNOLITE (Modern Solids) ---
    { id: 'solid-slate', name: 'Czysty Grafit', category: 'solid', type: 'solid', bg: '#0f172a', textTone: 'light', textColor: '#f8fafc', description: 'Jednolity, głęboki grafit techniczny.' },
    { id: 'solid-emerald', name: 'Głęboki Szmaragd', category: 'solid', type: 'solid', bg: '#062b24', textTone: 'light', textColor: '#f0fdf9', description: 'Jednolita zieleń butelkowa / ciemny szmaragd.' },
    { id: 'solid-white', name: 'Kredowa Biel', category: 'solid', type: 'solid', bg: '#ffffff', textTone: 'dark', textColor: '#17233a', description: 'Klasyczna, czysta biel studyjna.' },
    { id: 'solid-eucalyptus', name: 'Jasny Eukaliptus', category: 'solid', type: 'solid', bg: '#eaf5f2', textTone: 'dark', textColor: '#0d5e53', description: 'Jasny, stonowany odcień medyczny.' },
    { id: 'solid-paper', name: 'Ciepły Alabaster', category: 'solid', type: 'solid', bg: '#f8fafc', textTone: 'dark', textColor: '#17233a', description: 'Nowoczesny szary off-white.' }
  ];

  function isDarkColor(hex) {
    if (!hex || typeof hex !== 'string') return false;
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return false;
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    return ((r * 299 + g * 587 + b * 114) / 1000) < 128;
  }

  function applyBackgroundPreset(preset, allSlides = false) {
    mutate(() => {
      const slidesToUpdate = allSlides ? state.presentation.slides : [selectedSlide()].filter(Boolean);
      slidesToUpdate.forEach((slide) => {
        slide.backgroundType = preset.type;
        slide.background = preset.bg;
        slide.gradientFrom = preset.from || preset.bg;
        slide.gradientTo = preset.to || preset.bg;
        slide.gradientAngle = preset.angle || 135;
        slide.backgroundRef = '';

        const isDarkPreset = preset.textTone === 'light';
        (slide.elements || []).filter((el) => el.type === 'text' || el.type === 'heading').forEach((el) => {
          const currentColor = String(el.color || '').toLowerCase();
          const darkColors = new Set(['#17233a', '#111111', '#000000', '#0f172a', '#1e293b', '#0d5e53', '#064e3b', '#78350f', '#881337']);
          const lightColors = new Set(['#ffffff', '#f8fafc', '#f4f7fb', '#faf5ff', '#f0fdf9', '#e0e7ff', '#d1fae5']);
          if (isDarkPreset && (darkColors.has(currentColor) || !el.color)) {
            el.color = preset.textColor || '#f8fafc';
          } else if (!isDarkPreset && (lightColors.has(currentColor) || currentColor === '#ffffff')) {
            el.color = preset.textColor || '#17233a';
          }
        });
      });
    });
    saveLocal();
    renderCanvas();
    renderSlides();
    renderProperties();
    setStatus(allSlides ? `Zastosowano motyw „${preset.name}” do wszystkich slajdów.` : `Zastosowano motyw tła: ${preset.name}`);
  }

  function renderThemePresetPicker(slide) {
    const section = create('div', 'presentation-theme-presets-section');
    const header = create('div', 'presentation-theme-presets-header');
    header.append(
      create('span', 'presentation-theme-presets-title', '🎨 Gotowe motywy tła'),
      create('small', 'presentation-theme-presets-hint', 'Nowoczesne presety tła dopasowane do slajdów.')
    );
    section.append(header);

    const activeCat = state.presetCategory || 'all';
    const tabs = create('div', 'presentation-preset-tabs');
    const tabDefs = [
      ['all', 'Wszystkie'],
      ['dark', '🌙 Ciemne'],
      ['light', '☀️ Jasne'],
      ['solid', '◼ Jednolite']
    ];
    tabDefs.forEach(([cat, label]) => {
      const btn = create('button', 'presentation-preset-tab' + (activeCat === cat ? ' is-active' : ''), label);
      btn.type = 'button';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        state.presetCategory = cat;
        renderProperties();
      });
      tabs.append(btn);
    });
    section.append(tabs);

    const filtered = MODERN_BACKGROUND_PRESETS.filter((p) => activeCat === 'all' || p.category === activeCat);
    const grid = create('div', 'presentation-theme-presets-grid');

    let currentActivePreset = null;
    filtered.forEach((preset) => {
      const isGradientMatch = preset.type === 'gradient' &&
        slide.backgroundType === 'gradient' &&
        slide.gradientFrom?.toLowerCase() === preset.from?.toLowerCase() &&
        slide.gradientTo?.toLowerCase() === preset.to?.toLowerCase();
      const isSolidMatch = preset.type === 'solid' &&
        (slide.backgroundType === 'solid' || !slide.backgroundType) &&
        slide.background?.toLowerCase() === preset.bg?.toLowerCase();
      const isActive = isGradientMatch || isSolidMatch;
      if (isActive) currentActivePreset = preset;

      const card = create('button', 'presentation-preset-card' + (isActive ? ' is-active' : ''));
      card.type = 'button';
      card.title = `${preset.name} — ${preset.description}`;

      const preview = create('div', 'presentation-preset-preview');
      preview.style.background = preset.type === 'gradient'
        ? `linear-gradient(${preset.angle}deg, ${preset.from}, ${preset.to})`
        : preset.bg;

      const mockHead = create('div', 'mock-line is-head');
      mockHead.style.background = preset.textColor;
      const mockBody = create('div', 'mock-line is-body');
      mockBody.style.background = preset.textColor;
      preview.append(mockHead, mockBody);

      const nameEl = create('span', 'presentation-preset-name', preset.name);
      const toneBadge = create('span', 'presentation-preset-tone', preset.textTone === 'light' ? 'Ciemne' : 'Jasne');
      card.append(preview, nameEl, toneBadge);

      card.addEventListener('click', (e) => {
        e.preventDefault();
        applyBackgroundPreset(preset, false);
      });

      grid.append(card);
    });
    section.append(grid);

    const actions = create('div', 'presentation-preset-actions');
    const applyAllBtn = create('button', '', '✨ Zastosuj motyw do wszystkich slajdów');
    applyAllBtn.type = 'button';
    applyAllBtn.title = 'Ustawia ten sam nowoczesny styl tła na wszystkich slajdach prezentacji';
    applyAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const presetToApply = currentActivePreset || filtered[0] || MODERN_BACKGROUND_PRESETS[0];
      applyBackgroundPreset(presetToApply, true);
    });

    const harmonizeBtn = create('button', '', '◑ Dopasuj kontrast napisów');
    harmonizeBtn.type = 'button';
    harmonizeBtn.title = 'Dostosowuje kolory napisów na tym slajdzie do jasności tła';
    harmonizeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      mutate(() => {
        const isDarkBg = slide.backgroundType === 'gradient'
          ? isDarkColor(slide.gradientFrom || '#ffffff')
          : isDarkColor(slide.background || '#ffffff');
        (slide.elements || []).filter((el) => el.type === 'text' || el.type === 'heading').forEach((el) => {
          el.color = isDarkBg ? '#f8fafc' : '#17233a';
        });
      });
      saveLocal();
      renderCanvas();
      renderSlides();
      renderProperties();
      setStatus('Dopasowano kontrast tekstów do tła slajdu.');
    });

    actions.append(applyAllBtn, harmonizeBtn);
    section.append(actions);

    return section;
  }

  function renderProperties() {
    const slide = selectedSlide();
    const element = selectedElement();
    const form = create('div', 'presentation-properties-form');
    if (element) {
      const labels = { text: 'Pole tekstowe', heading: 'Nagłówek', image: 'Obraz', shape: 'Kształt / linia', formula: 'Wzór', icon: 'Ikona', table: 'Tabela', button: 'Przycisk', code: 'Blok kodu', embed: 'Bezpieczny embed', quiz: 'Interaktywny quiz' };
      elements.propertiesTitle.textContent = labels[element.type] || 'Element';
      form.append(field('elementId', input(element.elementId, 'elementId', { readOnly: true })));
      if (element.type === 'text' || element.type === 'heading') form.append(
        field('Treść', textarea(element.content, 'content')),
        field('Krój pisma', select(element.fontFamily, 'fontFamily', fontOptions())),
        field('Rozmiar', input(element.fontSize, 'fontSize', { type: 'number', min: 8, max: 160 })),
        field('Grubość', select(String(element.fontWeight || 400), 'fontWeight', [['100', '100 — cienka'], ['300', '300 — lekka'], ['400', '400 — normalna'], ['500', '500 — średnia'], ['600', '600 — półgruba'], ['700', '700 — gruba'], ['800', '800 — bardzo gruba'], ['900', '900 — czarna']])),
        field('Interlinia', input(element.lineHeight, 'lineHeight', { type: 'number', min: .8, max: 3, step: .05 })),
        field('Odstępy liter', input(element.letterSpacing, 'letterSpacing', { type: 'number', min: -5, max: 20, step: .1 })),
        field('Kolor', input(element.color, 'color', { type: 'color' })),
        field('Wyrównanie', select(element.align, 'align', [['left', 'Do lewej'], ['center', 'Środek'], ['right', 'Do prawej'], ['justify', 'Wyjustuj']])),
        field('Pogrubienie', check(element.bold, 'bold')),
        field('Kursywa', check(element.italic, 'italic')),
        field('Podkreślenie', check(element.underline, 'underline')),
        field('Przekreślenie', check(element.strikethrough, 'strikethrough'))
      );
      if (element.type === 'image') form.append(
        field('Plik', input(element.ref, 'ref', { readOnly: true })),
        field('ALT', input(element.alt, 'alt')),
        field('Dopasowanie', select(element.fit, 'fit', [['contain', 'Pokaż cały'], ['cover', 'Wypełnij / przytnij']])),
        field('Zachowaj proporcje przy resize', check(element.aspectLocked, 'aspectLocked')),
        field('Tryb Przytnij', check(element.cropMode, 'cropMode'), 'W trybie Przytnij przeciągnij wewnątrz obrazu, aby ustawić widoczny fragment.'),
        field('Punkt kadrowania X', input(element.focalX, 'focalX', { type: 'range', min: 0, max: 100 })),
        field('Punkt kadrowania Y', input(element.focalY, 'focalY', { type: 'range', min: 0, max: 100 })),
        field('Zaokrąglenie', input(element.borderRadius, 'borderRadius', { type: 'range', min: 0, max: 80 })),
        field('Przezroczystość', input(element.opacity, 'opacity', { type: 'range', min: 0, max: 1, step: .05 })),
        button('Zmień w Media Managerze', 'replace-image')
      );
      if (element.type === 'shape') form.append(
        field('Kształt', select(element.shape, 'shape', [['rectangle', 'Prostokąt'], ['rounded', 'Zaokrąglony'], ['circle', 'Koło'], ['line', 'Linia'], ['arrow', 'Strzałka']])),
        field('Wypełnienie', input(element.fill, 'fill', { type: 'color' })),
        field('Obramowanie / linia', input(element.border, 'border', { type: 'color' })),
        field('Grubość obramowania', input(element.borderWidth || 1, 'borderWidth', { type: 'number', min: 0, max: 24 }))
      );
      if (element.type === 'formula') form.append(
        field('Zapis', textarea(element.expression, 'expression')),
        field('Tryb', select(element.mode, 'mode', [['chemistry', 'Chemia'], ['math', 'Matematyka']])),
        field('Rozmiar', input(element.fontSize, 'fontSize', { type: 'number', min: 12, max: 140 }))
      );
      if (element.type === 'icon') form.append(
        field('Symbol / ikona', input(element.symbol, 'symbol', { maxLength: 12 })),
        field('Kolor ikony', input(element.color, 'color', { type: 'color' })),
        field('Tło', input(element.background, 'background', { type: 'color' })),
        field('Rozmiar', input(element.fontSize, 'fontSize', { type: 'number', min: 12, max: 180 }))
      );
      if (element.type === 'table') form.append(
        field('Nagłówki — rozdziel |', input(element.headers.join(' | '), 'tableHeaders')),
        field('Wiersze — jeden w linii', textarea(element.rows.map((row) => row.join(' | ')).join('\n'), 'tableRows')),
        field('Kolor nagłówka', input(element.headerColor, 'headerColor', { type: 'color' })),
        field('Kolor naprzemienny', input(element.accentColor, 'accentColor', { type: 'color' })),
        field('Rozmiar tekstu', input(element.fontSize, 'fontSize', { type: 'number', min: 8, max: 48 }))
      );
      if (element.type === 'button') form.append(
        field('Etykieta', input(element.label, 'label')),
        field('Adres HTTPS lub wewnętrzny', input(element.href, 'href', { placeholder: '/members/ albo https://…' })),
        field('Kolor tekstu', input(element.color, 'color', { type: 'color' })),
        field('Tło', input(element.background, 'background', { type: 'color' }))
      );
      if (element.type === 'code') form.append(
        field('Język', input(element.language, 'language', { maxLength: 24 })),
        field('Kod', textarea(element.code, 'code')),
        field('Kolor tekstu', input(element.color, 'color', { type: 'color' })),
        field('Tło', input(element.background, 'background', { type: 'color' })),
        field('Rozmiar', input(element.fontSize, 'fontSize', { type: 'number', min: 8, max: 48 }))
      );
      if (element.type === 'embed') form.append(
        field('Tytuł', input(element.title, 'title')),
        field('Dozwolony URL iframe', input(element.url, 'url', { placeholder: 'https://www.youtube-nocookie.com/embed/…' }), 'YouTube embed, Dokumenty Google albo podgląd pliku Google Drive.')
      );
      if (element.type === 'quiz') form.append(
        field('Pytanie', textarea(element.question, 'question')),
        ...(element.options || []).map((opt, idx) => field(`Odpowiedź ${String.fromCharCode(65 + idx)}`, input(opt.text, `quizOpt${idx}`))),
        field('Poprawna odpowiedź', select(String(element.options && element.options.findIndex((o) => o.correct) >= 0 ? element.options.findIndex((o) => o.correct) : 0), 'quizCorrectIndex', (element.options || []).map((o, idx) => [String(idx), `Odpowiedź ${String.fromCharCode(65 + idx)}`]))),
        field('Wyjaśnienie (po odpowiedzi)', textarea(element.explanation, 'explanation')),
        field('Blokuj przejście dalej do poprawnej odpowiedzi', check(element.blockNextUntilCorrect, 'blockNextUntilCorrect'), 'Uczeń nie przejdzie do następnego slajdu, dopóki nie wskaże właściwej opcji.'),
        field('Rozmiar tekstu pytania', input(element.fontSize, 'fontSize', { type: 'number', min: 12, max: 48 })),
        field('Kolor tekstu', input(element.color, 'color', { type: 'color' })),
        field('Kolor tła karty', input(element.background, 'background', { type: 'color' })),
        field('Kolor ramki', input(element.borderColor, 'borderColor', { type: 'color' })),
        field('Zaokrąglenie', input(element.borderRadius, 'borderRadius', { type: 'range', min: 0, max: 40 }))
      );
      form.append(
        field('Animacja wejścia', select(element.animationType || 'none', 'animationType', [
          ['none', 'Brak animacji'],
          ['fade-in', 'Zanikanie (Fade in)'],
          ['slide-up', 'Wjazd od dołu (Slide up)'],
          ['zoom-in', 'Przybliżenie (Zoom in)']
        ])),
        ...(element.animationType && element.animationType !== 'none' ? [
          field('Kolejność odkrywania (krok)', input(element.animationOrder || 1, 'animationOrder', { type: 'number', min: 1, max: 99 }))
        ] : []),
        field('Pozycja X', input(element.x, 'x', { type: 'number', min: 0, max: 100 })),
        field('Pozycja Y', input(element.y, 'y', { type: 'number', min: 0, max: 100 })),
        field('Szerokość', input(element.width, 'width', { type: 'number', min: 2, max: 100 })),
        field('Wysokość', input(element.height, 'height', { type: 'number', min: 2, max: 100 })),
        field('Obrót', input(element.rotation, 'rotation', { type: 'number', min: -180, max: 180 })),
        actionRow([['←', 'align-left'], ['↔', 'align-center'], ['→', 'align-right'], ['↑', 'align-top'], ['↕', 'align-middle'], ['↓', 'align-bottom']]),
        button(element.locked ? 'Odblokuj element' : 'Zablokuj element', 'toggle-lock'),
        ...(state.selectedElementIds && state.selectedElementIds.size > 1 ? [button('Grupuj zaznaczone (Ctrl+G)', 'group-elements')] : []),
        ...((element.groupId || slide.elements.some((i) => state.selectedElementIds?.has(i.elementId) && i.groupId)) ? [button('Rozgrupuj (Ctrl+Shift+G)', 'ungroup-elements')] : []),
        button('Przenieś wyżej', 'layer-up'),
        button('Przenieś niżej', 'layer-down'),
        button('Na sam wierzch', 'layer-front'),
        button('Na sam spód', 'layer-back'),
        button('Duplikuj', 'duplicate-element'),
        button('Usuń element', 'delete-element', true)
      );
      const layersSection = create('div', 'presentation-layers-inspector');
      const layersHeading = create('strong', '', 'Warstwy slajdu');
      Object.assign(layersHeading.style, { display: 'block', margin: '10px 0 6px', fontSize: '0.62rem', color: 'var(--chem-muted)' });
      layersSection.append(layersHeading);
      const layersList = create('div', 'presentation-layers-list');
      Object.assign(layersList.style, { display: 'grid', gap: '3px', maxHeight: '180px', overflowY: 'auto' });
      slide.elements.slice().sort((a, b) => b.z - a.z).forEach((item) => {
        const itemRow = create('div', `presentation-layer-row${item.elementId === state.selectedElementId || state.selectedElementIds?.has(item.elementId) ? ' is-active' : ''}`);
        Object.assign(itemRow.style, {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 8px', borderRadius: '6px', fontSize: '0.6rem',
          background: item.elementId === state.selectedElementId ? 'var(--chem-primary-soft, #e6f4f1)' : 'var(--chem-bg, #f4f7fb)',
          cursor: 'pointer'
        });
        const nameSpan = create('span', '', `${item.type}${item.groupId ? ' (Grupa)' : ''} [z:${item.z}]`);
        itemRow.append(nameSpan);
        itemRow.addEventListener('click', (e) => {
          e.stopPropagation();
          if (item.groupId) {
            const grouped = slide.elements.filter((g) => g.groupId === item.groupId);
            state.selectedElementIds = new Set(grouped.map((g) => g.elementId));
          } else {
            state.selectedElementIds = new Set([item.elementId]);
          }
          state.selectedElementId = item.elementId;
          renderProperties();
          renderCanvas();
        });
        layersList.append(itemRow);
      });
      layersSection.append(layersList);
      form.append(layersSection);
    } else {
      elements.propertiesTitle.textContent = 'Slajd i prezentacja';
      form.append(
        field('Identyfikator prezentacji', input(state.presentation.presentationId, 'presentation.presentationId'), 'Krótka, unikalna nazwa używana w linku do prezentacji.'),
        field('Opis', textarea(state.presentation.metadata.description, 'presentation.metadata.description')),
        field('Tagi', input(state.presentation.metadata.tags.join(', '), 'presentation.metadata.tags')),
        field('Proporcje', select(state.presentation.settings.aspectRatio, 'presentation.settings.aspectRatio', [['16:9', '16:9 — panoramiczne'], ['4:3', '4:3 — klasyczne']])),
        field('Motyw', select(state.presentation.settings.theme, 'presentation.settings.theme', [['light', 'Jasny'], ['dark', 'Ciemny'], ['chemistry', 'Chemiczny'], ['minimal', 'Minimalny']])),
        field('Czcionka nagłówków', select(state.presentation.settings.headingFont, 'presentation.settings.headingFont', fontOptions())),
        field('Czcionka treści', select(state.presentation.settings.bodyFont, 'presentation.settings.bodyFont', fontOptions())),
        field('Liczenie postępu', select(state.presentation.progress.mode, 'presentation.progress.mode', [['highest', 'Najwyższy slajd'], ['visited', 'Odwiedzone slajdy'], ['all_required', 'Wszystkie wymagane']])),
        create('hr'),
        field('slideId', input(slide.slideId, 'slideId', { readOnly: true })),
        field('Nazwa slajdu', input(slide.title, 'title')),
        renderThemePresetPicker(slide),
        create('hr'),
        field('Rodzaj tła (ręcznie)', select(slide.backgroundType, 'backgroundType', [['solid', 'Jednolity kolor'], ['gradient', 'Gradient'], ['image', 'Obraz'], ['theme', 'Z motywu']])),
        field('Kolor tła', input(slide.background, 'background', { type: 'color' })),
        ...(slide.backgroundType === 'gradient' ? [
          field('Gradient — początek', input(slide.gradientFrom, 'gradientFrom', { type: 'color' })),
          field('Gradient — koniec', input(slide.gradientTo, 'gradientTo', { type: 'color' })),
          field('Kąt gradientu', input(slide.gradientAngle, 'gradientAngle', { type: 'range', min: 0, max: 360 }))
        ] : []),
        field('Wymagany w postępie', (() => { const check = input('', 'required', { type: 'checkbox' }); check.checked = slide.required; return check; })()),
        button('Ustaw obraz tła', 'background-image'),
        button('Zastosuj tło do wszystkich slajdów', 'background-all'),
        ...(slide.backgroundRef ? [button('Usuń obraz tła', 'clear-background')] : [])
      );
    }
    elements.properties.replaceChildren(form);
  }

  function updateField(target) {
    const path = target.dataset.presentationField;
    if (!path) return;
    const raw = target.type === 'checkbox' ? target.checked : target.value;
    const element = selectedElement();
    const slide = selectedSlide();
    if (path.startsWith('presentation.')) {
      const clean = path.slice(13);
      if (clean === 'presentationId') state.presentation.presentationId = String(raw).trim().toLowerCase();
      else if (clean === 'metadata.description') state.presentation.metadata.description = raw;
      else if (clean === 'metadata.tags') state.presentation.metadata.tags = String(raw).split(',').map((tag) => tag.trim()).filter(Boolean);
      else if (clean === 'settings.aspectRatio') state.presentation.settings.aspectRatio = raw;
      else if (clean === 'settings.theme') applyTheme(raw);
      else if (clean === 'settings.headingFont') state.presentation.settings.headingFont = raw;
      else if (clean === 'settings.bodyFont') state.presentation.settings.bodyFont = raw;
      else if (clean === 'progress.mode') state.presentation.progress.mode = raw;
    } else if (element) {
      const numeric = new Set(['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'focalX', 'focalY', 'borderRadius', 'opacity', 'borderWidth', 'x', 'y', 'width', 'height', 'rotation', 'animationOrder']);
      if (path === 'tableHeaders') element.headers = String(raw).split('|').map((item) => item.trim()).filter(Boolean).slice(0, 8);
      else if (path === 'tableRows') element.rows = String(raw).split('\n').filter((line) => line.trim()).map((line) => line.split('|').map((item) => item.trim()).slice(0, 8)).slice(0, 20);
      else if (path.startsWith('quizOpt')) {
        const optIdx = parseInt(path.replace('quizOpt', ''), 10);
        if (element.options && element.options[optIdx]) {
          element.options[optIdx].text = String(raw);
        }
      } else if (path === 'quizCorrectIndex') {
        const correctIdx = parseInt(raw, 10);
        if (element.options) {
          element.options.forEach((opt, i) => { opt.correct = (i === correctIdx); });
        }
      } else element[path] = numeric.has(path) ? Number(raw) : raw;
      if (path === 'cropMode' && raw) element.fit = 'cover';
      if (path === 'animationType') {
        if (raw !== 'none' && !element.animationOrder) element.animationOrder = 1;
        renderProperties();
      }
    } else if (slide && path !== 'slideId') {
      slide[path] = path === 'gradientAngle' ? Number(raw) : raw;
      if (path === 'backgroundType' && raw !== 'image') slide.backgroundRef = raw === 'theme' ? '' : slide.backgroundRef;
    }
    saveLocal();
    renderCanvas();
    if (!element) renderSlides();
    setStatus('Niezapisane zmiany');
  }

  function applyTheme(theme) {
    state.presentation.settings.theme = theme;
    const preset = {
      light: ['#ffffff', '#17233a', 'inter', 'inter'], dark: ['#101927', '#f4f7fb', 'montserrat', 'inter'],
      chemistry: ['#eaf7f3', '#0d5e53', 'poppins', 'nunito'], minimal: ['#ffffff', '#111111', 'playfair', 'lato']
    }[theme] || ['#ffffff', '#17233a', 'inter', 'inter'];
    state.presentation.settings.headingFont = preset[2]; state.presentation.settings.bodyFont = preset[3];
    state.presentation.slides.forEach((slide) => {
      slide.backgroundType = 'theme'; slide.background = preset[0]; slide.backgroundRef = '';
      slide.elements.filter((item) => item.type === 'text' || item.type === 'heading').forEach((item) => {
        item.color = preset[1]; item.fontFamily = item.type === 'heading' ? preset[2] : preset[3];
      });
    });
  }

  function addElement(type) {
    const slide = selectedSlide();
    if (!slide) return;
    if (type === 'image') { openImageManager('element'); return; }
    mutate(() => {
      if (type === 'line') {
        const lineEl = modelApi.createElement('shape', {
          shape: 'line', x: 20, y: 50, width: 60, height: 2,
          border: '#0d7a6a', borderWidth: 2, fill: 'transparent'
        });
        lineEl.z = Math.max(0, ...slide.elements.map((item) => item.z)) + 1;
        slide.elements.push(lineEl); state.selectedElementId = lineEl.elementId;
        return;
      }
      if (type === 'arrow') {
        const arrowEl = modelApi.createElement('shape', {
          shape: 'arrow', x: 20, y: 50, width: 60, height: 4,
          border: '#0d7a6a', borderWidth: 2, fill: 'transparent'
        });
        arrowEl.z = Math.max(0, ...slide.elements.map((item) => item.z)) + 1;
        slide.elements.push(arrowEl); state.selectedElementId = arrowEl.elementId;
        return;
      }
      if (type === 'circle') {
        const circleEl = modelApi.createElement('shape', {
          shape: 'circle', x: 35, y: 25, width: 30, height: 45,
          fill: '#dff4ef', border: '#0d7a6a', borderWidth: 1
        });
        circleEl.z = Math.max(0, ...slide.elements.map((item) => item.z)) + 1;
        slide.elements.push(circleEl); state.selectedElementId = circleEl.elementId;
        return;
      }
      const seeds = {
        text: { x: 15, y: 18, width: 70, height: 20, content: 'Nowe pole tekstowe', fontSize: 30 },
        heading: { x: 10, y: 10, width: 80, height: 18, content: 'Nowy nagłówek', fontSize: 44 },
        shape: { x: 25, y: 25, width: 50, height: 35 }, formula: { x: 20, y: 32, width: 60, height: 22, expression: 'H2O' },
        icon: { x: 40, y: 30, width: 20, height: 30 }, table: { x: 10, y: 20, width: 80, height: 60 },
        button: { x: 35, y: 40, width: 30, height: 13 }, code: { x: 12, y: 18, width: 76, height: 64, code: 'H2O + CO2' },
        embed: { x: 10, y: 12, width: 80, height: 72 },
        quiz: { x: 12, y: 15, width: 76, height: 62, question: 'Wybierz poprawną odpowiedź:', blockNextUntilCorrect: false }
      };
      const element = modelApi.createElement(type, seeds[type] || {});
      element.z = Math.max(0, ...slide.elements.map((item) => item.z)) + 1;
      slide.elements.push(element); state.selectedElementId = element.elementId;
    });
  }

  function openImageManager(target) {
    const canUseLocal = Boolean(state.remoteSha && state.remoteId === state.presentation.presentationId);
    void root.ChemMediaManager?.open({
      scope: canUseLocal ? 'local' : 'shared',
      materialKind: canUseLocal ? 'presentation' : '', materialId: canUseLocal ? state.presentation.presentationId : '',
      repositoryId: state.repositoryId,
      onSelect(asset) {
        mutate(() => {
          if (target === 'background') { selectedSlide().backgroundRef = asset.reference; selectedSlide().backgroundType = 'image'; }
          else if (target === 'replace') {
            const element = selectedElement(); if (element?.type === 'image') { element.ref = asset.reference; element.repositoryId = asset.repositoryId; }
          } else {
            const image = modelApi.createElement('image', { x: 20, y: 20, width: 60, height: 60, ref: asset.reference, repositoryId: asset.repositoryId, alt: asset.filename.replace(/\.[^.]+$/, '') });
            image.z = Math.max(0, ...selectedSlide().elements.map((item) => item.z)) + 1;
            selectedSlide().elements.push(image); state.selectedElementId = image.elementId;
          }
        }, 'Obraz dodano. Zapisz szkic, aby zachować zmianę.');
      }
    });
  }

  const SUB_MAP = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋' };
  const REV_SUB_MAP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-' };
  const SUP_MAP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻' };
  const REV_SUP_MAP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };

  function transformSubscript(text) {
    if (!text) return '';
    const chars = [...text];
    const allSub = chars.some((c) => REV_SUB_MAP[c]) && chars.every((c) => REV_SUB_MAP[c] || !SUB_MAP[c]);
    return chars.map((c) => allSub ? (REV_SUB_MAP[c] || c) : (SUB_MAP[c] || c)).join('');
  }

  function transformSuperscript(text) {
    if (!text) return '';
    const chars = [...text];
    const allSup = chars.some((c) => REV_SUP_MAP[c]) && chars.every((c) => REV_SUP_MAP[c] || !SUP_MAP[c]);
    return chars.map((c) => allSup ? (REV_SUP_MAP[c] || c) : (SUP_MAP[c] || c)).join('');
  }

  function transformAutoChem(text) {
    if (!text) return '';
    let res = text.replace(/([A-Z][a-z]?|\))([0-9]+)/g, (match, sym, num) => sym + [...num].map((d) => SUB_MAP[d] || d).join(''));
    res = res.replace(/([A-Za-z0-9₀-₉\)]\s*)([0-9]*[+-])/g, (match, pfx, chg) => pfx + [...chg].map((c) => SUP_MAP[c] || c).join(''));
    return res;
  }

  function applyChemicalTextAction(action) {
    const active = root.document.activeElement;
    const isInput = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
    const element = selectedElement();

    if (isInput) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      const val = active.value;
      let nextVal = val;
      let nextStart = start;
      let nextEnd = end;

      if (start !== end) {
        const slice = val.slice(start, end);
        const transformed = action === 'subscript' ? transformSubscript(slice) : action === 'superscript' ? transformSuperscript(slice) : transformAutoChem(slice);
        nextVal = val.slice(0, start) + transformed + val.slice(end);
        nextEnd = start + transformed.length;
      } else if (action === 'chemical-formula-auto') {
        nextVal = transformAutoChem(val);
      } else if (start > 0) {
        const char = val[start - 1];
        const transformed = action === 'subscript' ? transformSubscript(char) : transformSuperscript(char);
        nextVal = val.slice(0, start - 1) + transformed + val.slice(start);
      }
      active.value = nextVal;
      active.setSelectionRange(nextStart, nextEnd);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (!element || (element.type !== 'text' && element.type !== 'heading')) return;
    mutate(() => {
      const raw = element.content || '';
      if (action === 'subscript') element.content = transformSubscript(raw);
      else if (action === 'superscript') element.content = transformSuperscript(raw);
      else if (action === 'chemical-formula-auto') element.content = transformAutoChem(raw);
    });
  }

  function propertyAction(action) {
    const slide = selectedSlide(); const element = selectedElement();
    if (action === 'replace-image') return openImageManager('replace');
    if (action === 'background-image') return openImageManager('background');
    if (action === 'subscript' || action === 'superscript' || action === 'chemical-formula-auto') {
      applyChemicalTextAction(action);
      return;
    }
    mutate(() => {
      if (action === 'clear-background') { slide.backgroundRef = ''; slide.backgroundType = 'solid'; }
      else if (action === 'background-all') {
        state.presentation.slides.forEach((entry) => {
          entry.backgroundType = slide.backgroundType; entry.background = slide.background; entry.gradientFrom = slide.gradientFrom;
          entry.gradientTo = slide.gradientTo; entry.gradientAngle = slide.gradientAngle; entry.backgroundRef = slide.backgroundRef;
        });
      }
      else if (action === 'toggle-lock' && element) element.locked = !element.locked;
      else if (action === 'toggle-bold' && element) {
        element.bold = !element.bold;
        element.fontWeight = element.bold ? 700 : 400;
      }
      else if (action === 'toggle-italic' && element) element.italic = !element.italic;
      else if (action === 'toggle-underline' && element) element.underline = !element.underline;
      else if (action === 'toggle-strikethrough' && element) element.strikethrough = !element.strikethrough;
      else if (action === 'font-size-plus' && element) element.fontSize = Math.min(160, (element.fontSize || 24) + 2);
      else if (action === 'font-size-minus' && element) element.fontSize = Math.max(8, (element.fontSize || 24) - 2);
      else if (action === 'text-align-left' && element) element.align = 'left';
      else if (action === 'text-align-center' && element) element.align = 'center';
      else if (action === 'text-align-right' && element) element.align = 'right';
      else if (action === 'text-align-justify' && element) element.align = 'justify';
      else if (action === 'group-elements') {
        if (state.selectedElementIds && state.selectedElementIds.size > 1) {
          const gid = 'grp-' + Math.random().toString(36).slice(2, 9);
          slide.elements.forEach((item) => {
            if (state.selectedElementIds.has(item.elementId)) item.groupId = gid;
          });
          setStatus('Zgrupowano elementy (Ctrl+G).');
        }
      }
      else if (action === 'ungroup-elements') {
        const targets = slide.elements.filter((item) => item.elementId === state.selectedElementId || state.selectedElementIds?.has(item.elementId));
        const groupIds = new Set(targets.map((item) => item.groupId).filter(Boolean));
        if (groupIds.size) {
          slide.elements.forEach((item) => {
            if (groupIds.has(item.groupId)) item.groupId = '';
          });
          setStatus('Rozgrupowano elementy (Ctrl+Shift+G).');
        }
      }
      else if (action === 'layer-up') {
        const targets = (state.selectedElementIds?.size > 1)
          ? slide.elements.filter((item) => state.selectedElementIds.has(item.elementId))
          : (element ? [element] : []);
        targets.forEach((item) => { item.z = Math.min(999, item.z + 1); });
      }
      else if (action === 'layer-down') {
        const targets = (state.selectedElementIds?.size > 1)
          ? slide.elements.filter((item) => state.selectedElementIds.has(item.elementId))
          : (element ? [element] : []);
        targets.forEach((item) => { item.z = Math.max(0, item.z - 1); });
      }
      else if (action === 'layer-front') {
        const targets = (state.selectedElementIds?.size > 1)
          ? slide.elements.filter((item) => state.selectedElementIds.has(item.elementId))
          : (element ? [element] : []);
        const maxZ = Math.max(0, ...slide.elements.map((item) => item.z));
        targets.sort((a, b) => a.z - b.z).forEach((item, idx) => {
          item.z = maxZ + 1 + idx;
        });
      }
      else if (action === 'layer-back') {
        const targets = (state.selectedElementIds?.size > 1)
          ? slide.elements.filter((item) => state.selectedElementIds.has(item.elementId))
          : (element ? [element] : []);
        const nonTargets = slide.elements.filter((item) => !targets.includes(item));
        nonTargets.forEach((item) => { item.z = Math.min(999, item.z + targets.length); });
        targets.sort((a, b) => a.z - b.z).forEach((item, idx) => {
          item.z = idx;
        });
      }
      else if (action === 'align-left' && element) element.x = 0;
      else if (action === 'align-center' && element) element.x = (100 - element.width) / 2;
      else if (action === 'align-right' && element) element.x = 100 - element.width;
      else if (action === 'align-top' && element) element.y = 0;
      else if (action === 'align-middle' && element) element.y = (100 - element.height) / 2;
      else if (action === 'align-bottom' && element) element.y = 100 - element.height;
      else if (action === 'align-slide-center' && element) element.x = (100 - element.width) / 2;
      else if (action === 'align-slide-middle' && element) element.y = (100 - element.height) / 2;
      else if (action === 'delete-element' && (element || state.selectedElementIds?.size)) {
        const toDelete = state.selectedElementIds?.size ? state.selectedElementIds : new Set(element ? [element.elementId] : []);
        slide.elements = slide.elements.filter((item) => !toDelete.has(item.elementId));
        state.selectedElementId = '';
        state.selectedElementIds?.clear();
      }
      else if (action === 'duplicate-element' && (element || state.selectedElementIds?.size)) {
        const toDuplicate = (state.selectedElementIds?.size > 1)
          ? slide.elements.filter((item) => state.selectedElementIds.has(item.elementId))
          : (element ? [element] : []);
        const nextIds = new Set();
        const groupMap = new Map();
        toDuplicate.forEach((item) => {
          const seed = clone(item); delete seed.elementId;
          if (seed.groupId) {
            if (!groupMap.has(seed.groupId)) groupMap.set(seed.groupId, 'grp-' + Math.random().toString(36).slice(2, 9));
            seed.groupId = groupMap.get(seed.groupId);
          }
          const copy = modelApi.createElement(seed); copy.x = Math.min(96, copy.x + 3); copy.y = Math.min(96, copy.y + 3); copy.z += 1;
          slide.elements.push(copy); nextIds.add(copy.elementId);
        });
        state.selectedElementIds = nextIds;
        state.selectedElementId = Array.from(nextIds)[0] || '';
      }
    });
  }

  function newPresentation() {
    if (!root.confirm('Utworzyć nową prezentację? Bieżący szkic na tym urządzeniu zostanie zastąpiony. Zapisz go najpierw, jeśli chcesz zachować zmiany.')) return;
    state.presentation = modelApi.createPresentation(); state.selectedSlideId = state.presentation.slides[0].slideId; state.selectedElementId = '';
    state.remoteId = ''; state.remoteSha = ''; state.undo = []; state.redo = []; saveLocal(); render(); setStatus('Nowa prezentacja jest gotowa.');
  }

  async function save(publish) {
    if (publish) state.presentation.metadata.status = 'published';
    else if (!state.remoteSha) state.presentation.metadata.status = 'draft';
    const validation = modelApi.validate(state.presentation);
    if (!validation.valid) { setStatus(validation.errors[0].message, true); return; }
    setStatus(publish ? 'Publikowanie prezentacji…' : 'Zapisywanie szkicu…');
    try {
      const result = await library.save('presentation', {
        filename: state.presentation.presentationId,
        content: modelApi.serialize(state.presentation),
        expectedSha: state.remoteId === state.presentation.presentationId ? state.remoteSha : '',
        repositoryId: state.repositoryId
      });
      state.remoteId = state.presentation.presentationId; state.remoteSha = result.sha; saveLocal();
      setStatus(publish ? 'Prezentacja opublikowana. Uczniowie mogą ją otworzyć.' : 'Szkic prezentacji zapisano.');
      await loadLibrary(true);
      root.document.dispatchEvent(new CustomEvent('chemdisk-content-changed', {
        detail: { kind: 'presentation', repositoryId: state.repositoryId }
      }));
    } catch (error) { setStatus(error?.message || 'Nie udało się zapisać prezentacji.', true); }
  }

  async function openAsset(asset) {
    setStatus(`Wczytywanie ${asset.title || asset.filename}…`);
    const result = await library.readPresentation(asset.filename, { repositoryId: asset.repositoryId });
    state.presentation = modelApi.parse(result.content, asset.filename);
    state.repositoryId = asset.repositoryId || result.repositoryId || state.repositoryId;
    state.remoteId = asset.filename; state.remoteSha = asset.sha || result.sha;
    state.selectedSlideId = state.presentation.slides[0].slideId; state.selectedElementId = ''; state.undo = []; state.redo = [];
    saveLocal(); render(); setStatus('Prezentację otwarto do edycji.');
  }

  function preview() {
    if (!state.remoteSha || state.remoteId !== state.presentation.presentationId) { setStatus('Najpierw zapisz szkic prezentacji.', true); return; }
    const url = new URL(library.presentationUrl(state.presentation.presentationId, state.repositoryId), root.location.origin);
    url.searchParams.set('preview', '1');
    root.open(url.toString(), '_blank', 'noopener');
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot()); restore(state.undo.pop()); saveLocal(); render(); setStatus('Cofnięto zmianę.');
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot()); restore(state.redo.pop()); saveLocal(); render(); setStatus('Ponowiono zmianę.');
  }

  function pointerDown(event) {
    const node = event.target.closest('[data-element-id]');
    const handle = event.target.dataset.resizeHandle || '';

    if (!node || !elements.canvas.contains(node)) {
      if (event.button !== 0 || (event.target !== elements.canvas && !elements.canvas.contains(event.target))) return;
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
        state.selectedElementId = '';
        state.selectedElementIds?.clear();
        renderProperties();
        renderCanvas();
      }
      const rect = elements.canvas.getBoundingClientRect();
      const startX = (event.clientX - rect.left) / rect.width * 100;
      const startY = (event.clientY - rect.top) / rect.height * 100;
      const marquee = create('div', 'presentation-marquee-box');
      Object.assign(marquee.style, { left: `${startX}%`, top: `${startY}%`, width: '0%', height: '0%' });
      elements.canvas.append(marquee);

      const moveMarquee = (moveEvent) => {
        const curX = Math.max(0, Math.min(100, (moveEvent.clientX - rect.left) / rect.width * 100));
        const curY = Math.max(0, Math.min(100, (moveEvent.clientY - rect.top) / rect.height * 100));
        const minX = Math.min(startX, curX);
        const maxX = Math.max(startX, curX);
        const minY = Math.min(startY, curY);
        const maxY = Math.max(startY, curY);
        Object.assign(marquee.style, {
          left: `${minX}%`, top: `${minY}%`,
          width: `${maxX - minX}%`, height: `${maxY - minY}%`
        });
        const slide = selectedSlide();
        if (!slide) return;
        const selectedInBox = new Set();
        slide.elements.forEach((item) => {
          const overlaps = !(item.x > maxX || item.x + item.width < minX || item.y > maxY || item.y + item.height < minY);
          if (overlaps) selectedInBox.add(item.elementId);
        });
        state.selectedElementIds = selectedInBox;
        state.selectedElementId = Array.from(selectedInBox)[0] || '';
        elements.canvas.querySelectorAll('[data-element-id]').forEach((elNode) => {
          elNode.classList.toggle('is-selected', selectedInBox.has(elNode.dataset.elementId));
        });
      };

      const upMarquee = () => {
        root.removeEventListener('pointermove', moveMarquee);
        root.removeEventListener('pointerup', upMarquee);
        marquee.remove();
        renderProperties();
        renderCanvas();
      };
      root.addEventListener('pointermove', moveMarquee);
      root.addEventListener('pointerup', upMarquee, { once: true });
      event.preventDefault();
      return;
    }

    const element = selectedSlide().elements.find((item) => item.elementId === node.dataset.elementId);
    if (!element) return;

    if (state.isInlineEditing && state.inlineEditingElementId === element.elementId) return;

    const isMultiKey = Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
    const groupMembers = element.groupId
      ? selectedSlide().elements.filter((item) => item.groupId === element.groupId)
      : [element];

    if (isMultiKey) {
      const allSelected = groupMembers.every((item) => state.selectedElementIds?.has(item.elementId));
      state.selectedElementIds = state.selectedElementIds || new Set();
      if (allSelected) {
        groupMembers.forEach((item) => state.selectedElementIds.delete(item.elementId));
        state.selectedElementId = Array.from(state.selectedElementIds)[0] || '';
      } else {
        groupMembers.forEach((item) => state.selectedElementIds.add(item.elementId));
        state.selectedElementId = element.elementId;
      }
    } else {
      if (element.groupId) {
        state.selectedElementIds = new Set(groupMembers.map((item) => item.elementId));
        state.selectedElementId = element.elementId;
      } else if (!state.selectedElementIds?.has(element.elementId)) {
        state.selectedElementIds = new Set([element.elementId]);
        state.selectedElementId = element.elementId;
      } else {
        state.selectedElementId = element.elementId;
      }
    }
    renderProperties();
    renderCanvas();
    updateToolbar();

    if (element.locked || event.button !== 0) return;
    const cropDrag = element.type === 'image' && element.cropMode && !handle && event.target.matches('img');
    const rect = elements.canvas.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, geometry: clone(element) };

    const selectedItems = selectedSlide().elements.filter((item) => state.selectedElementIds?.has(item.elementId));
    const startGeometries = new Map(selectedItems.map((item) => [item.elementId, clone(item)]));

    state.dragSnapshot = snapshot();

    const ensureGuide = (className) => {
      let g = elements.canvas.querySelector(`.${className}`);
      if (!g) {
        g = create('div', `presentation-smart-guide ${className}`);
        elements.canvas.append(g);
      }
      return g;
    };
    const clearGuides = () => {
      elements.canvas.querySelectorAll('.presentation-smart-guide').forEach((g) => g.remove());
      elements.canvas.classList.remove('has-guide-x', 'has-guide-y');
    };

    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - start.x) / rect.width * 100;
      const dy = (moveEvent.clientY - start.y) / rect.height * 100;

      if (cropDrag) {
        element.focalX = Math.max(0, Math.min(100, start.geometry.focalX - dx * 1.4));
        element.focalY = Math.max(0, Math.min(100, start.geometry.focalY - dy * 1.4));
        const image = elements.canvas.querySelector(`[data-element-id="${CSS.escape(element.elementId)}"] img`);
        if (image) image.style.objectPosition = `${element.focalX}% ${element.focalY}%`;
      } else if (!handle) {
        let nextX = Math.max(0, Math.min(100 - element.width, start.geometry.x + dx));
        let nextY = Math.max(0, Math.min(100 - element.height, start.geometry.y + dy));

        const SNAP_THRESHOLD = 1.2;
        let snapXGuide = null;
        let snapYGuide = null;

        const centeredX = Math.abs(nextX + element.width / 2 - 50) < 1;
        const centeredY = Math.abs(nextY + element.height / 2 - 50) < 1;
        if (centeredX) nextX = (100 - element.width) / 2;
        if (centeredY) nextY = (100 - element.height) / 2;
        elements.canvas.classList.toggle('has-guide-x', centeredX);
        elements.canvas.classList.toggle('has-guide-y', centeredY);

        const others = selectedSlide().elements.filter((item) => !state.selectedElementIds?.has(item.elementId));
        for (const other of others) {
          if (snapXGuide === null) {
            if (Math.abs(nextX - other.x) < SNAP_THRESHOLD) { nextX = other.x; snapXGuide = other.x; }
            else if (Math.abs((nextX + element.width / 2) - (other.x + other.width / 2)) < SNAP_THRESHOLD) {
              nextX = other.x + other.width / 2 - element.width / 2;
              snapXGuide = other.x + other.width / 2;
            } else if (Math.abs((nextX + element.width) - (other.x + other.width)) < SNAP_THRESHOLD) {
              nextX = other.x + other.width - element.width;
              snapXGuide = other.x + other.width;
            }
          }
          if (snapYGuide === null) {
            if (Math.abs(nextY - other.y) < SNAP_THRESHOLD) { nextY = other.y; snapYGuide = other.y; }
            else if (Math.abs((nextY + element.height / 2) - (other.y + other.height / 2)) < SNAP_THRESHOLD) {
              nextY = other.y + other.height / 2 - element.height / 2;
              snapYGuide = other.y + other.height / 2;
            } else if (Math.abs((nextY + element.height) - (other.y + other.height)) < SNAP_THRESHOLD) {
              nextY = other.y + other.height - element.height;
              snapYGuide = other.y + other.height;
            }
          }
        }

        element.x = nextX;
        element.y = nextY;

        if (snapXGuide !== null && !centeredX) {
          const gX = ensureGuide('is-vertical');
          gX.style.left = `${snapXGuide}%`;
        } else {
          elements.canvas.querySelector('.presentation-smart-guide.is-vertical')?.remove();
        }
        if (snapYGuide !== null && !centeredY) {
          const gY = ensureGuide('is-horizontal');
          gY.style.top = `${snapYGuide}%`;
        } else {
          elements.canvas.querySelector('.presentation-smart-guide.is-horizontal')?.remove();
        }

        const actualDx = element.x - start.geometry.x;
        const actualDy = element.y - start.geometry.y;
        selectedItems.forEach((item) => {
          if (item !== element) {
            const orig = startGeometries.get(item.elementId);
            if (orig) {
              item.x = Math.max(0, Math.min(100 - item.width, orig.x + actualDx));
              item.y = Math.max(0, Math.min(100 - item.height, orig.y + actualDy));
              const itemNode = elements.canvas.querySelector(`[data-element-id="${CSS.escape(item.elementId)}"]`);
              if (itemNode) applyGeometry(itemNode, item);
            }
          }
        });
      } else resizeGeometry(element, start.geometry, handle, dx, dy);
      const current = elements.canvas.querySelector(`[data-element-id="${CSS.escape(element.elementId)}"]`);
      if (current && !cropDrag) applyGeometry(current, element);
    };
    const up = () => {
      root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', up);
      clearGuides();
      if (state.dragSnapshot !== snapshot()) pushHistory(state.dragSnapshot);
      state.dragSnapshot = ''; saveLocal(); render();
    };
    root.addEventListener('pointermove', move); root.addEventListener('pointerup', up, { once: true });
    event.preventDefault();
  }

  function resizeGeometry(element, original, handle, dx, dy) {
    const min = 2;
    if (original.aspectLocked && /^(?:nw|ne|se|sw)$/.test(handle)) {
      const ratio = original.width / original.height;
      let width = handle.includes('e') ? original.width + dx : original.width - dx;
      let height = handle.includes('s') ? original.height + dy : original.height - dy;
      if (Math.abs(dx / Math.max(original.width, 1)) >= Math.abs(dy / Math.max(original.height, 1))) height = width / ratio;
      else width = height * ratio;
      const maxWidth = handle.includes('e') ? 100 - original.x : original.x + original.width;
      const maxHeight = handle.includes('s') ? 100 - original.y : original.y + original.height;
      width = Math.max(min, Math.min(maxWidth, width)); height = width / ratio;
      if (height > maxHeight) { height = maxHeight; width = height * ratio; }
      element.width = width; element.height = Math.max(min, height);
      element.x = handle.includes('w') ? original.x + original.width - element.width : original.x;
      element.y = handle.includes('n') ? original.y + original.height - element.height : original.y;
      return;
    }
    if (handle.includes('e')) element.width = Math.max(min, Math.min(100 - original.x, original.width + dx));
    if (handle.includes('s')) element.height = Math.max(min, Math.min(100 - original.y, original.height + dy));
    if (handle.includes('w')) { const nextX = Math.max(0, Math.min(original.x + original.width - min, original.x + dx)); element.width = original.width + original.x - nextX; element.x = nextX; }
    if (handle.includes('n')) { const nextY = Math.max(0, Math.min(original.y + original.height - min, original.y + dy)); element.height = original.height + original.y - nextY; element.y = nextY; }
  }

  function bind() {
    elements.workspace.addEventListener('click', (event) => {
      const add = event.target.closest('[data-presentation-add]'); if (add) return addElement(add.dataset.presentationAdd);
      const property = event.target.closest('[data-presentation-property-action]'); if (property) return propertyAction(property.dataset.presentationPropertyAction);
      const action = event.target.closest('[data-presentation-action]')?.dataset.presentationAction;
      if (!action) return;
      if (action === 'new') newPresentation(); else if (action === 'undo') undo(); else if (action === 'redo') redo();
      else if (action === 'preview') preview(); else if (action === 'save') void save(false); else if (action === 'publish') void save(true);
      else if (action === 'export-pdf') { saveLocal(); const url = `/members/module/presentation/?presentation=${encodeURIComponent(state.presentation.presentationId)}&repo=${encodeURIComponent(state.repositoryId)}&print=1&preview=1`; window.open(url, '_blank'); }
      else if (action === 'add-slide') mutate(() => { const slide = modelApi.createSlide({ layout: 'title-content', title: `Slajd ${state.presentation.slides.length + 1}` }); state.presentation.slides.push(slide); state.selectedSlideId = slide.slideId; state.selectedElementId = ''; });
    });
    elements.title.addEventListener('focus', () => { state.inputSnapshot = snapshot(); });
    elements.title.addEventListener('input', () => { state.presentation.metadata.title = elements.title.value; saveLocal(); setStatus('Niezapisane zmiany'); });
    elements.title.addEventListener('change', () => { if (state.inputSnapshot !== snapshot()) pushHistory(state.inputSnapshot); state.inputSnapshot = ''; renderSlides(); });
    elements.properties.addEventListener('focusin', (event) => { if (event.target.dataset.presentationField) state.inputSnapshot = snapshot(); });
    elements.properties.addEventListener('input', (event) => updateField(event.target));
    elements.properties.addEventListener('change', (event) => { updateField(event.target); if (state.inputSnapshot !== snapshot()) pushHistory(state.inputSnapshot); state.inputSnapshot = ''; renderProperties(); updateToolbar(); });
    const formatToolbar = byId('presentation-format-toolbar');
    if (formatToolbar) {
      formatToolbar.addEventListener('focusin', (event) => { if (event.target.dataset.presentationField) state.inputSnapshot = snapshot(); });
      formatToolbar.addEventListener('input', (event) => { updateField(event.target); updateToolbar(); });
      formatToolbar.addEventListener('change', (event) => {
        updateField(event.target);
        if (state.inputSnapshot !== snapshot()) pushHistory(state.inputSnapshot);
        state.inputSnapshot = '';
        renderProperties();
        updateToolbar();
      });
    }
    elements.notes.addEventListener('focus', () => { state.inputSnapshot = snapshot(); });
    elements.notes.addEventListener('input', () => { selectedSlide().notes = elements.notes.value; saveLocal(); setStatus('Niezapisane notatki.'); });
    elements.notes.addEventListener('change', () => { if (state.inputSnapshot !== snapshot()) pushHistory(state.inputSnapshot); state.inputSnapshot = ''; });
    elements.layout.addEventListener('change', () => {
      const slide = selectedSlide(); const layout = elements.layout.value;
      const replace = !slide.elements.length || root.confirm('Zastosować układ i zastąpić obecne elementy slajdu?');
      if (!replace) { elements.layout.value = slide.layout; return; }
      mutate(() => { const fresh = modelApi.createSlide({ layout, title: slide.title, slideId: slide.slideId, notes: slide.notes, required: slide.required, backgroundType: slide.backgroundType, background: slide.background, gradientFrom: slide.gradientFrom, gradientTo: slide.gradientTo, gradientAngle: slide.gradientAngle, backgroundRef: slide.backgroundRef }); slide.layout = fresh.layout; slide.elements = fresh.elements; state.selectedElementId = ''; });
    });
    elements.zoom.addEventListener('change', render);
    elements.repository.addEventListener('change', async () => {
      state.repositoryId = elements.repository.value;
      state.assets = [];
      pagedListApi.reset(state.libraryPaging);
      await loadLibrary();
    });
    elements.search.addEventListener('input', () => {
      pagedListApi.reset(state.libraryPaging);
      renderLibrary();
    });
    elements.canvas.addEventListener('pointerdown', pointerDown);
    elements.canvas.addEventListener('contextmenu', (event) => {
      const node = event.target.closest('[data-element-id]');
      if (!node) return;
      event.preventDefault();
      const element = selectedSlide()?.elements.find((item) => item.elementId === node.dataset.elementId);
      if (!element) return;
      if (!state.selectedElementIds?.has(element.elementId)) {
        if (element.groupId) {
          const grouped = selectedSlide().elements.filter((item) => item.groupId === element.groupId);
          state.selectedElementIds = new Set(grouped.map((item) => item.elementId));
        } else {
          state.selectedElementIds = new Set([element.elementId]);
        }
        state.selectedElementId = element.elementId;
        renderProperties();
        renderCanvas();
      }
      openElementContextMenu(event.clientX, event.clientY, element);
    });
    root.document.addEventListener('paste', async (event) => {
      if (!state.active || elements.workspace.hidden) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      const file = files[0];
      setStatus('Wysyłanie wklejonego obrazu…');
      try {
        const canUseLocal = Boolean(state.remoteSha && state.remoteId === state.presentation.presentationId);
        const asset = await root.ChemMediaManager?.uploadImage(file, {
          scope: canUseLocal ? 'local' : 'shared',
          materialKind: canUseLocal ? 'presentation' : '',
          materialId: canUseLocal ? state.presentation.presentationId : '',
          repositoryId: state.repositoryId
        });
        if (!asset) throw new Error('Brak menedżera mediów.');
        mutate(() => {
          const image = modelApi.createElement('image', {
            x: 20, y: 20, width: 60, height: 60,
            ref: asset.reference,
            repositoryId: asset.repositoryId,
            alt: asset.filename.replace(/\.[^.]+$/, '')
          });
          image.z = Math.max(0, ...selectedSlide().elements.map((item) => item.z)) + 1;
          selectedSlide().elements.push(image);
          state.selectedElementId = image.elementId;
        }, 'Wklejono obraz ze schowka. Zapisz szkic, aby zachować zmianę.');
        setStatus('Wklejono obraz ze schowka.');
      } catch (err) {
        setStatus(err?.message || 'Nie udało się wkleić obrazu.', true);
      }
    });
    root.document.addEventListener('keydown', (event) => {
      if (!state.active || elements.workspace.hidden || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable || event.target.closest?.('[contenteditable="true"]')) return;
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (meta && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (meta && event.key.toLowerCase() === 'p') { event.preventDefault(); saveLocal(); const url = `/members/module/presentation/?presentation=${encodeURIComponent(state.presentation.presentationId)}&repo=${encodeURIComponent(state.repositoryId)}&print=1&preview=1`; window.open(url, '_blank'); }
      else if (meta && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? propertyAction('ungroup-elements') : propertyAction('group-elements'); }
      else if (meta && event.key === ']') { event.preventDefault(); (event.shiftKey || event.altKey) ? propertyAction('layer-front') : propertyAction('layer-up'); }
      else if (meta && event.key === '[') { event.preventDefault(); (event.shiftKey || event.altKey) ? propertyAction('layer-back') : propertyAction('layer-down'); }
      else if (meta && event.key.toLowerCase() === 'b' && selectedElement()) { event.preventDefault(); propertyAction('toggle-bold'); }
      else if (meta && event.key.toLowerCase() === 'i' && selectedElement()) { event.preventDefault(); propertyAction('toggle-italic'); }
      else if (meta && event.key.toLowerCase() === 'u' && selectedElement()) { event.preventDefault(); propertyAction('toggle-underline'); }
      else if (meta && event.key.toLowerCase() === 'c' && selectedElement()) { state.clipboard = clone(selectedElement()); }
      else if (meta && event.key.toLowerCase() === 'v' && state.clipboard) { event.preventDefault(); mutate(() => { const seed = clone(state.clipboard); delete seed.elementId; const copy = modelApi.createElement(seed); copy.x = Math.min(96, copy.x + 3); copy.y = Math.min(96, copy.y + 3); selectedSlide().elements.push(copy); state.selectedElementId = copy.elementId; }); }
      else if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        const element = selectedElement();
        if (element || (state.selectedElementIds && state.selectedElementIds.size > 0)) {
          propertyAction('duplicate-element');
        } else {
          const slide = selectedSlide();
          if (slide) {
            const index = state.presentation.slides.findIndex((s) => s.slideId === slide.slideId);
            mutate(() => {
              const copy = modelApi.duplicateSlide(slide);
              state.presentation.slides.splice(index + 1, 0, copy);
              state.selectedSlideId = copy.slideId;
              state.selectedElementId = '';
            }, 'Powielono slajd (Ctrl+D).');
          }
        }
      }
      else if (['Delete', 'Backspace'].includes(event.key) && (selectedElement() || state.selectedElementIds?.size)) { event.preventDefault(); propertyAction('delete-element'); }
    });
  }

  async function activate() {
    state.active = true;
    if (!state.presentation) loadDraft();
    render();
    if (!state.loaded) { state.loaded = true; await loadLibrary(); }
  }

  function assetDeleted(asset) {
    if (state.remoteId === asset.filename && state.repositoryId === asset.repositoryId) { state.remoteId = ''; state.remoteSha = ''; setStatus('Prezentację usunięto z biblioteki. Szkic na tym urządzeniu pozostał w Studio.'); }
  }

  bind();
  root.ChemPresentationBuilder = Object.freeze({ activate, assetDeleted, openAsset });
})(typeof globalThis !== 'undefined' ? globalThis : window);
