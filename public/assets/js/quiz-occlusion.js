(function (root) {
  'use strict';
  const model = root.ChemQuizOcclusionModel;
  const rich = () => root.ChemQuizFlashcards;
  const node = (tag, cls = '', text) => {
    const el = root.document.createElement(tag); el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const button = (label, action, cls = '') => {
    const el = node('button', `mini-button quiz-player-button is-secondary ${cls}`, label); el.type = 'button'; el.addEventListener('click', action); return el;
  };
  function place(el, mask) {
    for (const [key, property] of [['x', 'left'], ['y', 'top'], ['width', 'width'], ['height', 'height']]) el.style[property] = `${mask[key] * 100}%`;
  }
  function surface(image, getUrl) {
    const host = node('div', 'io-image-host'), stage = node('div', 'io-stage'); stage.hidden = true;
    const img = node('img'); img.alt = image.alt || 'Obraz do rozpoznawania zasłoniętych fragmentów'; img.draggable = false; img.decoding = 'async';
    const overlay = node('div', 'io-overlay');
    const status = node('p', 'io-image-status', image.ref ? 'Wczytywanie obrazu…' : 'Najpierw wybierz obraz źródłowy.'); status.setAttribute('role', 'status');
    stage.append(img, overlay); host.append(status, stage);
    let pending = false;
    async function load() {
      if (pending || !image.ref) return;
      pending = true; stage.hidden = true; status.hidden = false; status.textContent = 'Wczytywanie obrazu…';
      function fail() {
        pending = false; stage.hidden = true;
        if (host.isConnected) status.replaceChildren(node('span', '', 'Nie udało się wczytać obrazu. '), button('Spróbuj ponownie', load));
      }
      try {
        const url = await getUrl(image.ref, image.repositoryId);
        if (!host.isConnected) return;
        img.onload = () => { pending = false; if (host.isConnected && img.naturalWidth) { stage.hidden = false; status.hidden = true; } };
        img.onerror = fail; img.src = url;
      } catch (_) { fail(); }
    }
    if (image.ref) Promise.resolve().then(load);
    return { host, stage, overlay, img };
  }
  function card(question, getUrl) {
    const outer = node('section', 'quiz-flashcard io-card');
    outer.dataset.occlusionQuestion = question.questionId;
    outer.append(rich().text(question.prompt, getUrl));
    const { host, stage, overlay } = surface(question.image, getUrl);
    const masks = question.occlusion.masks, active = new Set(question.activeMaskIds || masks.map((m) => m.maskId));
    const revealed = new Set(), answers = node('div', 'io-answers'); answers.setAttribute('aria-live', 'polite');
    const controls = node('div', 'io-reveal-list'), layers = new Map(), toggles = new Map();
    stage.style.setProperty('--io-color', model.COLORS[question.occlusion.color] || model.COLORS.teal);
    function refresh() {
      layers.forEach((el, id) => { el.classList.toggle('is-revealed', revealed.has(id)); el.setAttribute('aria-expanded', String(revealed.has(id))); });
      toggles.forEach((el, id) => { const number = masks.findIndex((m) => m.maskId === id) + 1; el.textContent = `${revealed.has(id) ? 'Zakryj' : 'Odsłoń'} maskę ${number}`; el.setAttribute('aria-expanded', String(revealed.has(id))); });
      root.MathJax?.typesetClear?.([answers]); answers.replaceChildren();
      masks.filter((m) => revealed.has(m.maskId)).forEach((mask) => {
        const section = node('section', 'io-answer'); section.dataset.maskAnswer = mask.maskId;
        section.append(node('h4', '', mask.name || `Maska ${masks.indexOf(mask) + 1}`));
        section.append(rich().text(mask.answer || 'Zobacz odsłonięty fragment obrazu.', getUrl));
        if (mask.explanation) section.append(node('strong', '', 'Wyjaśnienie'), rich().text(mask.explanation, getUrl));
        answers.append(section);
      });
      const complete = active.size > 0 && [...active].every((id) => revealed.has(id));
      if (complete && question.explanation) answers.append(rich().text(question.explanation, getUrl));
      reveal.textContent = complete ? 'Zakryj odpowiedź' : 'Pokaż odpowiedź'; reveal.setAttribute('aria-expanded', String(complete));
      outer.dispatchEvent(new root.CustomEvent('flashcard-reveal', { detail: complete }));
    }
    function toggle(id) { revealed.has(id) ? revealed.delete(id) : revealed.add(id); refresh(); }
    masks.forEach((mask, i) => {
      const enabled = active.has(mask.maskId);
      const el = button(String(i + 1), () => toggle(mask.maskId), 'io-mask');
      el.disabled = !enabled; el.classList.toggle('is-active', enabled); el.dataset.maskId = mask.maskId;
      el.setAttribute('aria-label', `${enabled ? 'Odsłoń' : 'Nieaktywna'} maska ${i + 1}`); el.setAttribute('aria-expanded', 'false');
      place(el, mask); overlay.append(el); layers.set(mask.maskId, el);
      if (enabled && active.size > 1) { const control = button(`Odsłoń maskę ${i + 1}`, () => toggle(mask.maskId)); toggles.set(mask.maskId, control); controls.append(control); }
    });
    const reveal = button('Pokaż odpowiedź', () => {
      const all = [...active].every((id) => revealed.has(id));
      active.forEach((id) => all ? revealed.delete(id) : revealed.add(id)); refresh();
    });
    reveal.dataset.flashcardReveal = '1'; reveal.disabled = active.size === 0; reveal.setAttribute('aria-expanded', 'false');
    const helpText = active.size > 1
      ? 'Odsłoń zaznaczone maski na obrazie lub użyj przycisków pod nim.'
      : 'Odsłoń zaznaczoną maskę na obrazie lub kliknij przycisk poniżej.';
    const elementsToAppend = [host, node('p', 'io-help', helpText)];
    if (controls.children.length > 0) elementsToAppend.push(controls);
    elementsToAppend.push(reveal, answers);
    outer.append(...elementsToAppend);
    return outer;
  }
  function player(question, getUrl) {
    if (question.activeMaskIds) return card(question, getUrl);
    const cards = model.expand([question]), host = node('div', 'io-player'); let index = 0;
    function render() {
      root.MathJax?.typesetClear?.([host]);
      const view = card(cards[index], getUrl); host.replaceChildren(view);
      if (cards.length > 1) {
        const nav = node('div', 'quiz-flashcard-navigation');
        const previous = button('← Poprzednia maska', () => { index--; render(); }); previous.disabled = index === 0;
        const next = button('Następna maska →', () => { index++; render(); }); next.disabled = index === cards.length - 1;
        nav.append(previous, node('span', '', `${index + 1} / ${cards.length}`), next); host.append(nav);
      }
    }
    render(); return host;
  }
  function editor(question, { getUrl, onChange, onImage, onImageFile }) {
    const host = node('section', 'io-editor'), settings = question.occlusion;
    let selected = settings.masks[0]?.maskId || '', drawing = false, gesture = null;
    const removedMasks = [];
    const changed = () => onChange();
    function field(label, value, update, options = {}) {
      const wrap = node('div', 'quiz-math-field'), labelNode = node('label');
      const input = node(options.multiline ? 'textarea' : 'input'); input.value = value; input.maxLength = options.multiline ? 3000 : 160;
      if (options.multiline) input.rows = 3;
      input.setAttribute('aria-label', label);
      input.addEventListener('input', () => { update(input.value); changed(); });
      labelNode.append(node('span', '', label), input); wrap.append(labelNode);
      if (options.multiline) wrap.append(root.ChemAssessmentEditor.equationButton(input));
      return wrap;
    }
    host.append(field('Polecenie', question.prompt, (v) => { question.prompt = v; }, { multiline: true }));
    const media = node('div', 'io-toolbar');
    media.append(button(question.image.ref ? 'Podmień obraz źródłowy' : 'Wybierz obraz źródłowy', onImage));
    const removeImage = button('Usuń obraz', () => {}); removeImage.dataset.quizAction = 'remove-media'; removeImage.disabled = !question.image.ref;
    media.append(removeImage); host.append(media, field('Opis obrazu', question.image.alt, (v) => { question.image.alt = v; }));
    if (onImageFile && root.ChemMediaManager?.imageFiles) {
      const drop = node('div', 'io-image-drop'); drop.tabIndex = 0;
      drop.setAttribute('role', 'group'); drop.setAttribute('aria-label', 'Wklej lub przeciągnij obraz źródłowy');
      const help = node('p', '', 'Kliknij tutaj i wklej obraz Ctrl+V / ⌘V lub przeciągnij plik.');
      const status = node('p', 'io-upload-status'); status.setAttribute('role', 'status');
      const input = node('input'); input.type = 'file'; input.hidden = true;
      input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
      const pick = button('Dodaj plik z urządzenia', () => input.click());
      drop.append(help, pick, input, node('small', '', 'Jeden obraz źródłowy · do 4 MB'), status);
      host.append(drop);
      let uploading = false;
      async function upload(files) {
        if (uploading || !files.length) return;
        if (files.length > 1) { status.textContent = 'Wklej jeden obraz źródłowy naraz.'; return; }
        uploading = true; host.inert = true; status.textContent = 'Zapisywanie obrazu…';
        try {
          const saved = await onImageFile(files[0]);
          if (host.isConnected) status.textContent = saved ? 'Obraz dodany. Możesz rysować maski.' : 'Nie zmieniono obrazu.';
        } catch (error) { if (host.isConnected) status.textContent = error.message || 'Nie udało się zapisać obrazu. Spróbuj ponownie.'; }
        finally { uploading = false; host.inert = false; }
      }
      input.addEventListener('change', () => { void upload(Array.from(input.files || [])); input.value = ''; });
      host.addEventListener('paste', (event) => {
        const files = root.ChemMediaManager.imageFiles(event.clipboardData);
        if (!files.length) return; // Normal text paste into answers is untouched.
        event.preventDefault(); event.stopPropagation(); void upload(files);
      });
      host.addEventListener('pointerdown', (event) => {
        if (!event.target.closest('input, textarea, select, button, [role="button"], [contenteditable]')) drop.focus({ preventScroll: true });
      });
      ['dragenter', 'dragover'].forEach((name) => host.addEventListener(name, (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
        event.preventDefault(); drop.classList.add('is-dragging');
      }));
      host.addEventListener('dragleave', (event) => { if (!host.contains(event.relatedTarget)) drop.classList.remove('is-dragging'); });
      host.addEventListener('drop', (event) => {
        const files = Array.from(event.dataTransfer?.files || []); if (!files.length) return;
        event.preventDefault(); event.stopPropagation(); drop.classList.remove('is-dragging'); void upload(files);
      });
    }
    const modeLabel = node('label'), mode = node('select');
    for (const [value, label] of Object.entries(model.MODES)) { const option = node('option', '', label); option.value = value; mode.append(option); }
    mode.value = settings.mode; mode.dataset.occlusionMode = '1'; mode.setAttribute('aria-label', 'Tryb masek');
    mode.addEventListener('change', () => { settings.mode = mode.value; changed(); });
    modeLabel.append(node('span', '', 'Tryb nauki'), mode); host.append(modeLabel);
    const colors = node('label'), color = node('select'); color.setAttribute('aria-label', 'Kolor masek');
    const labels = { teal: 'Morski', blue: 'Niebieski', violet: 'Fioletowy', dark: 'Grafitowy' };
    for (const [key, label] of Object.entries(labels)) { const option = node('option', '', label); option.value = key; color.append(option); }
    color.value = settings.color;
    color.addEventListener('change', () => { settings.color = color.value; stage.style.setProperty('--io-color', model.COLORS[color.value]); changed(); });
    colors.append(node('span', '', 'Kolor masek'), color); host.append(colors);
    const { host: imageHost, stage, overlay } = surface(question.image, getUrl);
    stage.classList.add('io-editing'); stage.style.setProperty('--io-color', model.COLORS[settings.color]); overlay.dataset.ioCanvas = '1';
    const toolbar = node('div', 'io-toolbar'), maskList = node('div', 'io-mask-list'), detail = node('div', 'io-mask-detail');
    const notice = node('p', 'io-help', 'Włącz „Rysuj maskę” i przeciągnij po obrazie. W trybie edycji przeciągnij maskę lub uchwyt ↘. Pola procentowe i klawisze strzałek pozwalają poprawić małe obszary.'); notice.setAttribute('role', 'status');
    const drawButton = button('Rysuj maskę', () => { drawing = !drawing; refreshTool(); }); drawButton.dataset.ioDraw = '1';
    const addButton = button('Dodaj maskę na środku', () => {
      if (!question.image.ref || settings.masks.length >= model.MAX_MASKS) return;
      const mask = newMask({ x: .3, y: .3, width: .25, height: .15 }); settings.masks.push(mask); selected = mask.maskId;
      renderMasks(); renderDetails(); changed();
    }); addButton.dataset.ioAdd = '1';
    const deleteButton = button('Usuń zaznaczoną maskę', () => removeMask(selected), 'io-delete-mask'); deleteButton.dataset.ioDelete = '1';
    const undoButton = button('Cofnij usunięcie', () => {
      if (!removedMasks.length || settings.masks.length >= model.MAX_MASKS || gesture) return;
      const { mask, index } = removedMasks.pop(); settings.masks.splice(index, 0, mask); selected = mask.maskId;
      renderMasks(); renderDetails(); focusSelected(); changed(); notice.textContent = 'Przywrócono usuniętą maskę.';
    }); undoButton.dataset.ioUndo = '1';
    toolbar.append(drawButton, addButton, deleteButton, undoButton); host.append(toolbar, notice, imageHost, maskList, detail);
    host.append(field('Wyjaśnienie całego obrazu (opcjonalnie)', question.explanation, (v) => { question.explanation = v; }, { multiline: true }));
    function removeMask(id) {
      const index = settings.masks.findIndex((mask) => mask.maskId === id);
      if (index < 0 || gesture) return;
      const [mask] = settings.masks.splice(index, 1); removedMasks.push({ mask, index });
      if (removedMasks.length > model.MAX_MASKS) removedMasks.shift();
      if (selected === id) selected = settings.masks[Math.min(index, settings.masks.length - 1)]?.maskId || '';
      renderMasks(); renderDetails(); changed();
      notice.textContent = 'Maska usunięta. Możesz użyć „Cofnij usunięcie”.';
      if (selected) focusSelected(); else undoButton.focus({ preventScroll: true });
    }
    function newMask(rect) {
      return { maskId: `mask-${root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`, ...rect, name: '', answer: '', explanation: '' };
    }
    function refreshTool() {
      deleteButton.disabled = !settings.masks.some((mask) => mask.maskId === selected);
      undoButton.disabled = !removedMasks.length || settings.masks.length >= model.MAX_MASKS;
      stage.dataset.tool = drawing ? 'draw' : 'select'; drawButton.setAttribute('aria-pressed', String(drawing));
      drawButton.textContent = drawing ? 'Zakończ rysowanie' : 'Rysuj maskę';
      addButton.disabled = !question.image.ref || settings.masks.length >= model.MAX_MASKS;
      drawButton.disabled = !question.image.ref || (!drawing && settings.masks.length >= model.MAX_MASKS);
    }
    function focusSelected() {
      [...overlay.children].find((el) => el.dataset.maskId === selected)?.focus({ preventScroll: true });
    }
    function renderMasks() {
      overlay.replaceChildren(); maskList.replaceChildren();
      settings.masks.forEach((mask, i) => {
        const el = node('div', `io-mask${selected === mask.maskId ? ' is-selected' : ''}`, String(i + 1)); el.tabIndex = 0;
        el.dataset.maskId = mask.maskId; el.setAttribute('role', 'button'); el.setAttribute('aria-label', `Edytuj maskę ${i + 1}`); el.setAttribute('aria-pressed', String(selected === mask.maskId));
        place(el, mask); overlay.append(el);
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); removeMask(mask.maskId); return; }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selected = mask.maskId; renderMasks(); renderDetails(); focusSelected(); return; }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const dx = event.key === 'ArrowLeft' ? -.005 : event.key === 'ArrowRight' ? .005 : 0;
          const dy = event.key === 'ArrowUp' ? -.005 : event.key === 'ArrowDown' ? .005 : 0;
          Object.assign(mask, event.shiftKey ? model.resize(mask, dx, dy) : model.move(mask, dx, dy)); selected = mask.maskId; renderMasks(); renderDetails(); focusSelected(); changed();
        });
        if (selected === mask.maskId) { const handle = node('span', 'io-resize', '↘'); handle.dataset.ioResize = '1'; handle.setAttribute('aria-hidden', 'true'); el.append(handle); }
        const choose = button(`${i + 1}. ${mask.name || 'Maska bez nazwy'}`, () => { selected = mask.maskId; renderMasks(); renderDetails(); });
        choose.dataset.ioSelect = mask.maskId; choose.setAttribute('aria-pressed', String(selected === mask.maskId));
        const remove = button('×', () => removeMask(mask.maskId), 'io-delete-mask');
        remove.dataset.ioRemove = mask.maskId; remove.setAttribute('aria-label', `Usuń maskę ${i + 1}${mask.name ? ': ' + mask.name : ''}`); remove.title = 'Usuń tę maskę';
        const row = node('div', 'io-mask-item'); row.append(choose, remove); maskList.append(row);
      });
      refreshTool();
    }
    function renderDetails() {
      const mask = settings.masks.find((entry) => entry.maskId === selected); detail.replaceChildren();
      if (!mask) { detail.append(node('p', '', 'Dodaj lub zaznacz maskę, aby edytować jej odpowiedź.')); return; }
      const position = node('div', 'io-position-grid');
      for (const [key, label] of [['x', 'Od lewej (%)'], ['y', 'Od góry (%)'], ['width', 'Szerokość (%)'], ['height', 'Wysokość (%)']]) {
        const wrap = node('label'), input = node('input'); input.type = 'number'; input.min = key === 'x' || key === 'y' ? '0' : '0.5'; input.max = '100'; input.step = '.1'; input.value = String(Math.round(mask[key] * 100000) / 1000);
        input.dataset.ioCoordinate = key; input.setAttribute('aria-label', label);
        input.addEventListener('change', () => {
          if (!Number.isFinite(input.valueAsNumber)) { renderDetails(); return; }
          const value = input.valueAsNumber / 100;
          Object.assign(mask, key === 'x' || key === 'y' ? model.move(mask, key === 'x' ? value - mask.x : 0, key === 'y' ? value - mask.y : 0) : model.rect({ ...mask, [key]: value }));
          renderMasks(); renderDetails(); changed();
        });
        wrap.append(node('span', '', label), input); position.append(wrap);
      }
      detail.append(node('h4', '', `Maska ${settings.masks.indexOf(mask) + 1}`), position,
        field('Nazwa maski (opcjonalnie)', mask.name, (v) => { mask.name = v; const label = [...maskList.querySelectorAll('[data-io-select]')].find((el) => el.dataset.ioSelect === mask.maskId); if (label) label.textContent = `${settings.masks.indexOf(mask) + 1}. ${v || 'Maska bez nazwy'}`; }),
        field('Odpowiedź maski (opcjonalnie)', mask.answer, (v) => { mask.answer = v; }, { multiline: true }),
        field('Wyjaśnienie maski (opcjonalnie)', mask.explanation, (v) => { mask.explanation = v; }, { multiline: true }));
    }
    overlay.addEventListener('pointerdown', (event) => {
      if (gesture || event.isPrimary === false || (event.button !== undefined && event.button !== 0) || stage.hidden) return;
      const start = model.point(event.clientX, event.clientY, stage.getBoundingClientRect()); if (!start) return;
      const target = event.target.closest('[data-mask-id]');
      let mask;
      if (drawing) {
        if (settings.masks.length >= model.MAX_MASKS) return;
        mask = newMask(model.draw(start, start)); selected = mask.maskId;
      } else { mask = settings.masks.find((m) => m.maskId === target?.dataset.maskId); if (!mask) return; selected = mask.maskId; }
      event.preventDefault();
      gesture = { id: event.pointerId, start, mask, original: { ...mask }, current: { ...mask }, action: drawing ? 'draw' : event.target.closest('[data-io-resize]') ? 'resize' : 'move' };
      renderMasks(); renderDetails();
      if (drawing) { const draft = node('div', 'io-mask is-selected'); draft.dataset.maskId = mask.maskId; place(draft, mask); overlay.append(draft); }
      overlay.setPointerCapture?.(event.pointerId);
    });
    function updateGesture(event) {
      if (!gesture || event.pointerId !== gesture.id) return;
      const point = model.point(event.clientX, event.clientY, stage.getBoundingClientRect()); if (!point) return;
      const { start, original, action, mask } = gesture;
      gesture.current = action === 'draw' ? model.draw(start, point) : action === 'resize' ? model.resize(original, point.x - start.x, point.y - start.y) : model.move(original, point.x - start.x, point.y - start.y);
      const el = [...overlay.children].find((el) => el.dataset.maskId === mask.maskId); if (el) place(el, gesture.current);
    }
    overlay.addEventListener('pointermove', (event) => { if (gesture && event.pointerId === gesture.id) { event.preventDefault(); updateGesture(event); } });
    function finish(event, cancel) {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (!cancel) updateGesture(event);
      const previous = gesture; gesture = null;
      if (!cancel) {
        Object.assign(previous.mask, previous.current);
        if (previous.action === 'draw') settings.masks.push(previous.mask);
      }
      if (overlay.hasPointerCapture?.(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
      if (!settings.masks.some((m) => m.maskId === selected)) selected = settings.masks[0]?.maskId || '';
      renderMasks(); renderDetails(); if (!cancel) changed();
    }
    overlay.addEventListener('pointerup', (event) => finish(event, false));
    overlay.addEventListener('pointercancel', (event) => finish(event, true));
    overlay.addEventListener('lostpointercapture', (event) => finish(event, true));
    renderMasks(); renderDetails(); return host;
  }
  root.ChemQuizOcclusion = Object.freeze({ editor, card, player });
})(typeof globalThis !== 'undefined' ? globalThis : this);
