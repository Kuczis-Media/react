(function exposeChemMediaManager(root) {
  'use strict';

  const MAX_BYTES = 4 * 1024 * 1024;
  const PAGE_SIZE = 24;
  const THUMB_CONCURRENCY = 3;
  const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);
  const state = {
    dialog: null, options: null, scope: 'shared', repositoryId: '', ownerRepositoryId: '',
    assets: [], query: '', page: 0, loading: false, busy: false, selected: false,
    session: 0, request: 0, render: 0, searchTimer: null, repositories: [],
    observer: null, thumbnails: new Map(), queue: [], active: 0, closeLightbox: null
  };
  const create = (tag, className, text) => {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (label, className, action) => {
    const node = create('button', className, label); node.type = 'button';
    node.addEventListener('click', action); return node;
  };
  const searchText = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLocaleLowerCase('pl');
  const assetName = (asset) => asset.displayName || asset.filename;
  const context = () => ({ scope: state.scope, repositoryId: state.repositoryId,
    materialKind: state.scope === 'local' ? state.options?.materialKind || '' : '',
    materialId: state.scope === 'local' ? state.options?.materialId || '' : '' });
  const current = (session) => state.session === session && state.dialog?.open;
  const sameContext = (input) => JSON.stringify(input) === JSON.stringify(context());
  const localReady = () => Boolean(state.options?.materialKind && state.options?.materialId && state.repositoryId === state.ownerRepositoryId);

  function ensureDialog() {
    if (state.dialog) return state.dialog;
    const dialog = create('dialog', 'chem-media-dialog');
    dialog.setAttribute('aria-labelledby', 'chem-media-title');
    dialog.innerHTML = `
      <div class="chem-media-shell">
        <header class="chem-media-header">
          <div><span>Biblioteka plików</span><h2 id="chem-media-title">Media Manager</h2><p>Wybierz obraz lub dodaj pliki do wybranego repozytorium.</p></div>
          <button class="chem-media-close" type="button" aria-label="Zamknij">×</button>
        </header>
        <div class="chem-media-location">
          <label class="chem-media-repository">Repozytorium<select aria-label="Repozytorium obrazów"></select></label>
          <div class="chem-media-tabs" role="tablist" aria-label="Folder obrazów">
            <button type="button" data-media-scope="local" role="tab">W tym materiale</button>
            <button type="button" data-media-scope="shared" role="tab">Wspólne dla kursu</button>
          </div>
        </div>
        <div class="chem-media-toolbar">
          <label class="chem-media-search"><span class="sr-only">Szukaj obrazu</span><input type="search" placeholder="Szukaj po nazwie we wszystkich obrazach…" autocomplete="off"></label>
          <button class="chem-media-refresh" type="button">↻ Odśwież</button>
        </div>
        <section class="chem-media-drop" tabindex="0" aria-label="Dodaj obrazy">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple hidden>
          <span class="chem-media-drop-icon">＋</span>
          <div><strong>Przeciągnij, wklej Ctrl/Cmd+V albo wybierz pliki</strong><small>PNG, JPG, WebP, GIF lub bezpieczny SVG · maks. 4 MB</small></div>
          <button type="button">Wybierz pliki</button>
        </section>
        <p class="chem-media-status" role="status" aria-live="polite"></p>
        <div class="chem-media-grid" aria-label="Obrazy"></div>
        <footer class="chem-media-footer"><span></span><div class="chem-media-pagination"></div><button type="button" class="chem-media-done">Gotowe</button></footer>
      </div>`;
    root.document.body.append(dialog); state.dialog = dialog;
    const close = () => dialog.close();
    dialog.querySelector('.chem-media-close').addEventListener('click', close);
    dialog.querySelector('.chem-media-done').addEventListener('click', close);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener('cancel', (event) => { if (state.closeLightbox) { event.preventDefault(); state.closeLightbox(); } });
    dialog.addEventListener('close', () => {
      if (dialog.open) return; // A queued close event must not invalidate a newly opened picker.
      state.session += 1; state.request += 1; state.loading = false; state.busy = false;
      state.options = null; root.clearTimeout(state.searchTimer); cleanupThumbnails();
    });
    dialog.querySelectorAll('[data-media-scope]').forEach((node) => node.addEventListener('click', () => {
      if (node.disabled || state.scope === node.dataset.mediaScope) return;
      state.scope = node.dataset.mediaScope; changeFolder();
    }));
    dialog.querySelector('.chem-media-repository select').addEventListener('change', (event) => {
      state.repositoryId = event.target.value;
      if (!localReady()) state.scope = 'shared';
      changeFolder();
    });
    dialog.querySelector('.chem-media-search input').addEventListener('input', (event) => {
      state.query = event.target.value; state.page = 0;
      root.clearTimeout(state.searchTimer);
      state.searchTimer = root.setTimeout(renderAssets, 120);
    });
    dialog.querySelector('.chem-media-refresh').addEventListener('click', () => void loadAssets(true));
    const drop = dialog.querySelector('.chem-media-drop');
    const input = drop.querySelector('input');
    drop.querySelector('button').addEventListener('click', () => { if (!state.busy) input.click(); });
    drop.addEventListener('click', (event) => {
      if (!state.busy && event.target !== input && !event.target.closest('button')) input.click();
    });
    drop.addEventListener('keydown', (event) => {
      if (event.target === drop && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!state.busy) input.click(); }
    });
    input.addEventListener('change', () => { void uploadFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((name) => drop.addEventListener(name, (event) => {
      event.preventDefault(); event.stopPropagation(); drop.classList.add('is-dragging');
    }));
    drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault(); event.stopPropagation(); drop.classList.remove('is-dragging');
      void uploadFiles(event.dataTransfer?.files);
    });
    dialog.addEventListener('paste', (event) => {
      const files = imageFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault(); event.stopPropagation(); void uploadFiles(files);
    });
    return dialog;
  }

  function setStatus(message, error = false) {
    const node = state.dialog.querySelector('.chem-media-status');
    node.textContent = message; node.classList.toggle('is-error', error);
  }
  function syncChrome() {
    const dialog = state.dialog;
    dialog.querySelectorAll('[data-media-scope]').forEach((node) => {
      node.disabled = state.busy || (node.dataset.mediaScope === 'local' && !localReady());
      node.classList.toggle('is-active', node.dataset.mediaScope === state.scope);
      node.setAttribute('aria-selected', String(node.dataset.mediaScope === state.scope));
    });
    dialog.querySelector('.chem-media-repository select').disabled = state.busy;
    dialog.querySelector('.chem-media-refresh').disabled = state.busy || state.loading;
    dialog.querySelector('.chem-media-drop button').disabled = state.busy;
    dialog.querySelector('.chem-media-drop input').disabled = state.busy;
    dialog.querySelector('.chem-media-grid').setAttribute('aria-busy', String(state.loading));
    const repo = state.repositories.find((entry) => entry.id === state.repositoryId);
    dialog.querySelector('.chem-media-footer > span').textContent = `${repo?.label || state.repositoryId} · ${state.scope === 'shared' ? 'assets/shared/' : `${state.options.materialKind}/${state.options.materialId}/photos/`}`;
  }
  function changeFolder() {
    state.page = 0; state.assets = []; cleanupThumbnails(); void loadAssets(false);
  }
  function indexedAssets(assets) {
    return assets.map((asset) => ({ ...asset, search: searchText(`${assetName(asset)} ${asset.filename}`) }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || assetName(a).localeCompare(assetName(b), 'pl'));
  }
  async function loadAssets(refresh) {
    if (state.busy || !state.dialog.open) return;
    const session = state.session, request = ++state.request, input = context();
    state.loading = true; setStatus('Pobieranie listy obrazów…'); renderAssets();
    try {
      const assets = await root.ChemContentLibrary.listMedia({ ...input, refresh: Boolean(refresh), usage: input.scope === 'local' });
      if (!current(session) || request !== state.request) return;
      state.assets = indexedAssets(assets);
      setStatus(`${assets.length} obrazów · najnowsze na początku · miniatury tylko widocznych obrazów.`);
    } catch (error) {
      if (!current(session) || request !== state.request) return;
      state.assets = []; setStatus(error?.message || 'Nie udało się pobrać mediów.', true);
    } finally {
      if (current(session) && request === state.request) { state.loading = false; renderAssets(); }
    }
  }
  function cleanupThumbnails() {
    state.render += 1; state.queue = []; state.observer?.disconnect(); state.observer = null;
    state.closeLightbox?.();
    state.thumbnails.forEach((url) => root.URL.revokeObjectURL(url)); state.thumbnails.clear();
  }
  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  function renderAssets() {
    if (!state.dialog?.open) return;
    state.render += 1; state.queue = []; state.observer?.disconnect(); syncChrome();
    const grid = state.dialog.querySelector('.chem-media-grid');
    const pagination = state.dialog.querySelector('.chem-media-pagination'); pagination.replaceChildren();
    if (state.loading) {
      grid.replaceChildren(...Array.from({ length: 6 }, () => create('div', 'chem-media-card is-skeleton'))); return;
    }
    const query = searchText(state.query.trim());
    const assets = query ? state.assets.filter((asset) => asset.search.includes(query)) : state.assets;
    const pages = Math.max(1, Math.ceil(assets.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const visible = assets.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    grid.replaceChildren(...visible.map(mediaCard)); grid.scrollTop = 0;
    if (!visible.length) {
      const empty = create('div', 'chem-media-empty');
      empty.append(create('span', '', '▧'), create('strong', '', query ? 'Brak pasujących obrazów' : 'Ten folder jest pusty'),
        create('small', '', query ? 'Zmień wyszukiwaną nazwę.' : 'Dodaj pierwszy obraz lub wybierz inne repozytorium.'));
      grid.append(empty);
    }
    const previous = button('←', '', () => { state.page -= 1; renderAssets(); });
    previous.disabled = state.page === 0; previous.setAttribute('aria-label', 'Poprzednia strona obrazów');
    const next = button('→', '', () => { state.page += 1; renderAssets(); });
    next.disabled = state.page >= pages - 1; next.setAttribute('aria-label', 'Następna strona obrazów');
    const count = create('span', '', `${assets.length ? state.page * PAGE_SIZE + 1 : 0}–${Math.min((state.page + 1) * PAGE_SIZE, assets.length)} z ${assets.length}`);
    count.setAttribute('aria-live', 'polite'); pagination.append(previous, count, next);
    observeThumbnails();
  }
  function mediaCard(asset) {
    const card = create('article', 'chem-media-card');
    const thumb = button('', 'chem-media-thumb', () => openLightbox(asset));
    thumb.dataset.mediaThumb = '1'; thumb.dataset.reference = asset.reference; thumb.dataset.sha = asset.sha || '';
    thumb.setAttribute('aria-label', `Podgląd: ${assetName(asset)}`);
    const copy = create('div', 'chem-media-card-copy');
    const title = create('strong', '', assetName(asset)); title.title = `${assetName(asset)}\n${asset.filename}`;
    copy.append(title, create('small', '', `${formatSize(asset.size)} · ${(asset.mimeType || '').replace('image/', '').toUpperCase()}`));
    const actions = create('div', 'chem-media-actions');
    if (typeof state.options?.onSelect === 'function') actions.append(button('Wybierz', 'chem-media-select', () => selectAsset(asset)));
    const rename = button('Zmień nazwę', 'chem-media-rename', () => editName(asset, copy));
    const remove = button('Usuń', 'chem-media-remove', () => void deleteAsset(asset));
    rename.disabled = remove.disabled = state.busy; actions.append(rename, remove);
    card.append(thumb, copy, actions); return card;
  }
  function editName(asset, copy) {
    if (state.busy || copy.querySelector('form')) return;
    const form = create('form', 'chem-media-name-form');
    const label = create('label', '', 'Nazwa w bibliotece'); const input = create('input');
    input.value = assetName(asset); input.maxLength = 120; input.required = true; label.append(input);
    const save = button('Zapisz', '', () => {}); save.type = 'submit';
    form.append(label, create('small', '', 'Odwołania do obrazu pozostaną bez zmian.'), save,
      button('Anuluj', '', () => renderAssets()));
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (state.busy || !input.value.trim()) return;
      if (input.value.trim() === assetName(asset)) { renderAssets(); return; }
      const session = state.session, folder = context(); state.busy = true; save.disabled = true; syncChrome();
      try {
        const saved = await root.ChemContentLibrary.renameMedia({ ...folder, reference: asset.reference, expectedSha: asset.sha, displayName: input.value.trim() });
        if (!current(session) || !sameContext(folder)) return;
        state.assets = indexedAssets(state.assets.map((entry) => entry.reference === asset.reference ? { ...entry, displayName: saved.displayName } : entry));
        setStatus('Nazwa obrazu została zmieniona.');
      } catch (error) { if (current(session)) setStatus(error?.message || 'Nie udało się zmienić nazwy.', true); }
      finally { if (current(session)) { state.busy = false; renderAssets(); } }
    });
    copy.replaceChildren(form); input.focus(); input.select();
  }
  function selectAsset(asset) {
    if (!state.dialog.open || state.selected || state.busy) return;
    state.selected = true;
    const callback = state.options?.onSelect, selected = { ...asset, ...context() };
    state.dialog.close(); callback?.(selected);
  }
  async function deleteAsset(asset) {
    if (state.busy) return;
    const warning = asset.usageCount > 0 ? `Obraz jest używany ${asset.usageCount}× w materiale. `
      : state.scope === 'shared' ? 'Obraz może być używany w wielu materiałach. ' : '';
    if (!root.confirm(`${warning}Usunąć „${assetName(asset)}”? Poprzednia wersja pozostanie w historii repozytorium.`)) return;
    const session = state.session, folder = context(), onDelete = state.options?.onDelete;
    state.busy = true; renderAssets(); setStatus('Usuwanie obrazu…');
    try {
      await root.ChemContentLibrary.removeMedia({ ...folder, reference: asset.reference, expectedSha: asset.sha });
      if (!current(session) || !sameContext(folder)) return;
      state.assets = state.assets.filter((entry) => entry.reference !== asset.reference);
      setStatus('Obraz usunięto.'); onDelete?.(asset);
    } catch (error) { if (current(session)) setStatus(error?.message || 'Nie udało się usunąć obrazu.', true); }
    finally { if (current(session)) { state.busy = false; renderAssets(); } }
  }
  function observeThumbnails() {
    const generation = state.render, input = context(), session = state.session;
    const enqueue = (thumb) => { state.queue.push({ thumb, generation, input, session }); drainThumbnails(); };
    const thumbs = state.dialog.querySelectorAll('[data-media-thumb]');
    if (!root.IntersectionObserver) { thumbs.forEach(enqueue); return; }
    const observer = new root.IntersectionObserver((entries) => {
      if (generation !== state.render) return;
      entries.forEach((entry) => { if (entry.isIntersecting) { observer.unobserve(entry.target); enqueue(entry.target); } });
    }, { root: state.dialog.querySelector('.chem-media-grid'), rootMargin: '80px' });
    state.observer = observer; thumbs.forEach((thumb) => observer.observe(thumb));
  }
  function drainThumbnails() {
    while (state.active < THUMB_CONCURRENCY && state.queue.length) {
      const job = state.queue.shift();
      if (!current(job.session) || job.generation !== state.render || !job.thumb.isConnected) continue;
      state.active += 1;
      void loadThumbnail(job).finally(() => { state.active -= 1; drainThumbnails(); });
    }
  }
  async function smallThumbnail(blob) {
    if (!root.createImageBitmap || blob.type === 'image/svg+xml') return blob;
    let bitmap;
    try {
      bitmap = await root.createImageBitmap(blob, { resizeWidth: 320, resizeQuality: 'medium' });
      const canvas = root.document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return await new Promise((resolve) => canvas.toBlob((value) => resolve(value || blob), 'image/webp', .78));
    } catch { return blob; }
    finally { bitmap?.close(); }
  }
  async function loadThumbnail({ thumb, generation, input, session }) {
    const valid = () => current(session) && generation === state.render && thumb.isConnected;
    const key = `${JSON.stringify(input)}:${thumb.dataset.reference}:${thumb.dataset.sha}`;
    try {
      let url = state.thumbnails.get(key);
      if (!url) {
        const blob = await root.ChemContentLibrary.readMediaBlob({ ...input, reference: thumb.dataset.reference });
        if (!valid()) return;
        const small = await smallThumbnail(blob); if (!valid()) return;
        url = root.URL.createObjectURL(small); state.thumbnails.set(key, url);
        while (state.thumbnails.size > PAGE_SIZE * 3) {
          const oldest = state.thumbnails.keys().next().value;
          root.URL.revokeObjectURL(state.thumbnails.get(oldest)); state.thumbnails.delete(oldest);
        }
      } else { state.thumbnails.delete(key); state.thumbnails.set(key, url); }
      if (!valid()) return;
      const image = create('img'); image.src = url; image.alt = ''; image.decoding = 'async';
      image.onerror = () => { thumb.replaceChildren(); thumb.classList.add('is-error'); };
      thumb.replaceChildren(image);
    } catch { if (valid()) thumb.classList.add('is-error'); }
  }
  async function openLightbox(asset) {
    state.closeLightbox?.();
    const session = state.session, input = context();
    const lightbox = create('div', 'chem-media-lightbox');
    const backdrop = create('div', 'chem-media-lightbox-backdrop');
    const content = create('div', 'chem-media-lightbox-content');
    const wrap = create('div', 'chem-media-lightbox-img-wrap', 'Ładowanie podglądu…');
    const details = create('div', 'chem-media-lightbox-details');
    details.append(create('strong', '', assetName(asset)), create('small', '', `${formatSize(asset.size)} · ${asset.reference}`));
    let url = '';
    const close = () => { lightbox.remove(); if (url) root.URL.revokeObjectURL(url); state.closeLightbox = null; };
    state.closeLightbox = close;
    const closeButton = button('×', 'chem-media-lightbox-close', close); closeButton.setAttribute('aria-label', 'Zamknij podgląd');
    backdrop.addEventListener('click', close); content.append(closeButton, wrap, details);
    if (typeof state.options?.onSelect === 'function') details.append(button('Wybierz obraz', 'chem-media-select', () => selectAsset(asset)));
    lightbox.append(backdrop, content); state.dialog.append(lightbox); closeButton.focus();
    try {
      const blob = await root.ChemContentLibrary.readMediaBlob({ ...input, reference: asset.reference });
      if (!current(session) || !lightbox.isConnected) return;
      url = root.URL.createObjectURL(blob); const image = create('img'); image.src = url; image.alt = assetName(asset); wrap.replaceChildren(image);
    } catch { if (lightbox.isConnected) wrap.textContent = 'Nie udało się wczytać podglądu. Zamknij i spróbuj ponownie.'; }
  }

  function safeFilename(file) {
    const dot = file.name.lastIndexOf('.');
    const rawStem = dot > 0 ? file.name.slice(0, dot) : 'obraz';
    const fallbackExtension = ({
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
      'image/gif': 'gif', 'image/svg+xml': 'svg'
    })[file.type] || '';
    const extension = (dot > 0 ? file.name.slice(dot + 1) : fallbackExtension).toLowerCase().replace('jpeg', 'jpg');
    const stem = rawStem.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'obraz';
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    return `${stem}-${suffix}.${extension}`;
  }

  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new root.FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('Nie udało się odczytać pliku.'));
      reader.readAsDataURL(file);
    });
  }

  function imageFiles(data) {
    const files = Array.from(data?.files || []).filter((file) => file.type.startsWith('image/'));
    return files.length ? files : Array.from(data?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile()).filter(Boolean);
  }

  // The inline editors and the modal share validation, naming and storage.
  async function uploadImage(file, options = {}) {
    if (!file || !ACCEPTED.has(file.type) || file.size <= 0 || file.size > MAX_BYTES) {
      throw new Error('Wybierz obraz PNG, JPG, WebP, GIF lub SVG o rozmiarze do 4 MB.');
    }
    const filename = safeFilename(file);
    const scope = options.scope === 'local' && options.materialKind && options.materialId ? 'local' : 'shared';
    const asset = await root.ChemContentLibrary.uploadMedia({
      scope, materialKind: scope === 'local' ? options.materialKind : '',
      materialId: scope === 'local' ? options.materialId : '',
      filename, contentBase64: await fileBase64(file), mimeType: file.type,
      repositoryId: options.repositoryId || ''
    });
    return { ...asset, filename: asset.filename || filename, reference: asset.reference || asset.ref || `${scope === 'local' ? 'photos' : 'assets/shared'}/${filename}` };
  }

  async function uploadFiles(rawFiles) {
    const files = Array.from(rawFiles || []);
    if (!files.length || state.busy || state.loading) return;
    const invalid = files.find((file) => !ACCEPTED.has(file.type) || file.size <= 0 || file.size > MAX_BYTES);
    if (invalid) { setStatus(`„${invalid.name}” ma nieobsługiwany format albo przekracza 4 MB.`, true); return; }
    const session = state.session, input = context(); state.busy = true; syncChrome();
    let added = 0, failure = '';
    try {
      for (const file of files) {
        if (!current(session)) break;
        setStatus(`Wysyłanie ${added + 1}/${files.length}: ${file.name}…`);
        const asset = await uploadImage(file, input); added += 1;
        if (current(session)) state.assets = indexedAssets([asset, ...state.assets.filter((entry) => entry.reference !== asset.reference)]);
      }
    } catch (error) { failure = error?.message || 'Nie udało się wysłać obrazu.'; }
    finally {
      if (current(session)) {
        state.busy = false; state.page = 0; state.query = ''; state.dialog.querySelector('.chem-media-search input').value = '';
        setStatus(failure ? `Dodano ${added}/${files.length}. ${failure}` : `Dodano ${added} obrazów. Wybierz obraz, aby wstawić go do materiału.`, Boolean(failure));
        renderAssets();
      }
    }
  }
  async function open(options = {}) {
    const dialog = ensureDialog();
    cleanupThumbnails(); root.clearTimeout(state.searchTimer);
    const session = ++state.session; state.request += 1;
    state.options = { ...options }; state.selected = false; state.busy = false; state.loading = true;
    state.repositoryId = options.repositoryId || ''; state.ownerRepositoryId = state.repositoryId;
    state.scope = options.scope === 'shared' ? 'shared' : options.materialKind && options.materialId ? 'local' : 'shared';
    state.query = ''; state.assets = []; state.page = 0;
    dialog.querySelector('.chem-media-repository select').replaceChildren();
    dialog.querySelector('.chem-media-search input').value = '';
    if (!dialog.open) dialog.showModal();
    setStatus('Wczytywanie repozytoriów…'); renderAssets();
    try {
      const repositories = await root.ChemContentLibrary.repositories();
      if (!current(session)) return;
      state.repositories = repositories.filter((repo) => repo.configured !== false);
      if (!state.repositoryId || state.repositoryId === 'default') state.repositoryId = state.repositories.find((repo) => repo.default)?.id || state.repositories[0]?.id || '';
      state.ownerRepositoryId = state.repositoryId;
      if (!state.repositories.some((repo) => repo.id === state.repositoryId)) throw new Error('Wybrane repozytorium jest niedostępne.');
      const select = dialog.querySelector('.chem-media-repository select');
      select.replaceChildren(...state.repositories.map((repo) => { const option = create('option', '', repo.label || repo.id); option.value = repo.id; return option; }));
      select.value = state.repositoryId;
      await loadAssets(false);
    } catch (error) {
      if (current(session)) { state.loading = false; renderAssets(); setStatus(error?.message || 'Nie udało się wczytać repozytoriów.', true); }
    }
  }
  root.ChemMediaManager = Object.freeze({ open, uploadImage, imageFiles });
})(typeof globalThis !== 'undefined' ? globalThis : window);
