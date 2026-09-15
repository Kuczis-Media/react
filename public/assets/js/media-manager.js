(function exposeChemMediaManager(root) {
  'use strict';

  const MAX_BYTES = 4 * 1024 * 1024;
  const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);
  const pagedListApi = root.ChemStudioPagedList;
  const state = {
    dialog: null,
    scope: 'local',
    options: null,
    assets: [],
    query: '',
    loading: false,
    paging: pagedListApi?.createState(),
    objectUrls: new Set(),
    observer: null
  };

  const create = (tag, className, text) => {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };

  function ensureDialog() {
    if (state.dialog) return state.dialog;
    const dialog = create('dialog', 'chem-media-dialog');
    dialog.innerHTML = `
      <div class="chem-media-shell">
        <header class="chem-media-header">
          <div><span>Biblioteka plików</span><h2>Media Manager</h2><p>Wybierz istniejący obraz albo przeciągnij nowy plik.</p></div>
          <button class="chem-media-close" type="button" aria-label="Zamknij">×</button>
        </header>
        <div class="chem-media-tabs" role="tablist">
          <button type="button" data-media-scope="local" role="tab">W tym materiale</button>
          <button type="button" data-media-scope="shared" role="tab">Wspólne dla kursu</button>
        </div>
        <div class="chem-media-toolbar">
          <label class="chem-media-search"><span class="sr-only">Szukaj obrazu</span><input type="search" placeholder="Szukaj po nazwie…" autocomplete="off"></label>
          <button class="chem-media-refresh" type="button">↻ Odśwież</button>
        </div>
        <section class="chem-media-drop" tabindex="0">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple hidden>
          <span class="chem-media-drop-icon">＋</span>
          <div><strong>Przeciągnij, wklej Ctrl/Cmd+V albo wybierz plik</strong><small>PNG, JPG, WebP, GIF lub bezpieczny SVG · maks. 4 MB</small></div>
          <button type="button">Wybierz pliki</button>
        </section>
        <p class="chem-media-status" role="status" aria-live="polite"></p>
        <div class="chem-media-grid"></div>
        <footer class="chem-media-footer"><span></span><button type="button" class="chem-media-done">Gotowe</button></footer>
      </div>`;
    root.document.body.append(dialog);
    state.dialog = dialog;
    bindDialog(dialog);
    return dialog;
  }

  function bindDialog(dialog) {
    const close = () => dialog.close();
    dialog.querySelector('.chem-media-close').addEventListener('click', close);
    dialog.querySelector('.chem-media-done').addEventListener('click', close);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener('close', cleanupObjectUrls);
    dialog.querySelectorAll('[data-media-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled || state.scope === button.dataset.mediaScope) return;
        state.scope = button.dataset.mediaScope;
        pagedListApi?.reset(state.paging);
        void loadAssets(false);
      });
    });
    dialog.querySelector('.chem-media-search input').addEventListener('input', (event) => {
      state.query = event.target.value;
      pagedListApi?.reset(state.paging);
      renderAssets();
    });
    dialog.querySelector('.chem-media-refresh').addEventListener('click', () => loadAssets(true));
    const drop = dialog.querySelector('.chem-media-drop');
    const input = drop.querySelector('input');
    drop.querySelector('button').addEventListener('click', () => input.click());
    drop.addEventListener('click', (event) => { if (!event.target.closest('button')) input.click(); });
    input.addEventListener('change', () => { void uploadFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((name) => drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach((name) => drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.remove('is-dragging');
    }));
    drop.addEventListener('drop', (event) => void uploadFiles(event.dataTransfer?.files));
    dialog.addEventListener('paste', (event) => {
      const files = imageFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void uploadFiles(files);
    });
  }

  function owner() {
    const options = state.options || {};
    if (state.scope === 'shared') return { scope: 'shared', materialKind: '', materialId: '' };
    return {
      scope: 'local',
      materialKind: options.materialKind || '',
      materialId: options.materialId || ''
    };
  }

  function setStatus(message, error) {
    if (!state.dialog) return;
    const status = state.dialog.querySelector('.chem-media-status');
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(error));
  }

  function syncChrome() {
    const dialog = state.dialog;
    const localReady = Boolean(state.options?.materialKind && state.options?.materialId);
    dialog.querySelectorAll('[data-media-scope]').forEach((button) => {
      const active = button.dataset.mediaScope === state.scope;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.disabled = button.dataset.mediaScope === 'local' && !localReady;
    });
    const scopeName = state.scope === 'shared'
      ? 'assets/shared/'
      : `${state.options?.materialKind || 'materiał'}/${state.options?.materialId || ''}/photos/`;
    dialog.querySelector('.chem-media-footer span').textContent = scopeName;
    const picker = typeof state.options?.onSelect === 'function';
    dialog.classList.toggle('is-picker', picker);
  }

  async function loadAssets(refresh) {
    const library = root.ChemContentLibrary;
    if (!library?.listMedia || state.loading) return;
    state.loading = true;
    syncChrome();
    setStatus('Pobieranie zawartości folderu…');
    renderAssets();
    try {
      state.assets = await library.listMedia({
        ...owner(),
        repositoryId: state.options?.repositoryId || '',
        refresh: Boolean(refresh),
        usage: state.scope === 'local'
      });
      setStatus(`${state.assets.length} ${state.assets.length === 1 ? 'plik' : 'plików'} · obrazy są wczytywane dopiero, gdy pojawią się na ekranie.`);
    } catch (error) {
      state.assets = [];
      setStatus(error?.message || 'Nie udało się pobrać mediów.', true);
    } finally {
      state.loading = false;
      renderAssets();
    }
  }

  function cleanupObjectUrls() {
    state.objectUrls.forEach((url) => root.URL.revokeObjectURL(url));
    state.objectUrls.clear();
    state.observer?.disconnect();
    state.observer = null;
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function renderAssets() {
    if (!state.dialog) return;
    cleanupObjectUrls();
    syncChrome();
    const grid = state.dialog.querySelector('.chem-media-grid');
    if (state.loading) {
      grid.replaceChildren(...Array.from({ length: 6 }, () => create('div', 'chem-media-card is-skeleton')));
      return;
    }
    const query = state.query.trim().toLocaleLowerCase('pl');
    const assets = state.assets.filter((asset) => !query || asset.filename.toLocaleLowerCase('pl').includes(query));
    if (!assets.length) {
      const empty = create('div', 'chem-media-empty');
      empty.append(create('span', '', '▧'), create('strong', '', query ? 'Brak pasujących obrazów' : 'Ten folder jest pusty'), create('small', '', query ? 'Zmień wyszukiwanie.' : 'Przeciągnij pierwszy plik do pola powyżej.'));
      grid.replaceChildren(empty);
      return;
    }
    const paged = pagedListApi
      ? pagedListApi.page(state.paging, 'media-manager', assets)
      : { items: assets, total: assets.length, visible: assets.length, remaining: 0, pageSize: assets.length, key: 'media-manager' };
    const cards = paged.items.map((asset) => mediaCard(asset));
    grid.replaceChildren(...cards);
    if (pagedListApi) {
      const controls = pagedListApi.controls(root.document, state.paging, paged, {
        label: 'obrazów',
        onMore: renderAssets
      });
      controls.classList.add('chem-media-pagination');
      grid.append(controls);
    }
    observeThumbnails();
  }

  function mediaCard(asset) {
    const card = create('article', 'chem-media-card');
    const thumb = create('div', 'chem-media-thumb');
    thumb.dataset.mediaThumb = '1';
    thumb.dataset.reference = asset.reference;
    thumb.setAttribute('role', 'button');
    thumb.setAttribute('tabindex', '0');
    thumb.title = 'Kliknij, aby powiększyć podgląd';
    const preview = () => openLightbox(asset, thumb);
    thumb.addEventListener('click', preview);
    thumb.addEventListener('keydown', (e) => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); preview(); } });
    const copy = create('div', 'chem-media-card-copy');
    copy.append(create('strong', '', asset.filename), create('small', '', `${formatSize(asset.size)} · ${asset.mimeType.replace('image/', '').toUpperCase()}`));
    const badges = create('div', 'chem-media-badges');
    if (asset.usageCount > 0) badges.append(create('span', 'is-used', `Używany ${asset.usageCount}×`));
    else if (state.scope === 'local') badges.append(create('span', '', 'Nieużywany'));
    const actions = create('div', 'chem-media-actions');
    if (typeof state.options?.onSelect === 'function') {
      const select = create('button', 'chem-media-select', 'Wybierz');
      select.type = 'button';
      select.addEventListener('click', () => selectAsset(asset));
      actions.append(select);
      card.addEventListener('dblclick', () => selectAsset(asset));
    }
    const remove = create('button', 'chem-media-remove', 'Usuń');
    remove.type = 'button';
    remove.addEventListener('click', () => void deleteAsset(asset, remove));
    actions.append(remove);
    card.append(thumb, copy, badges, actions);
    return card;
  }

  function openLightbox(asset, thumb) {
    if (!state.dialog) return;
    const existing = state.dialog.querySelector('.chem-media-lightbox');
    if (existing) existing.remove();
    const lightbox = create('div', 'chem-media-lightbox');
    lightbox.innerHTML = `
      <div class="chem-media-lightbox-backdrop"></div>
      <div class="chem-media-lightbox-content">
        <button type="button" class="chem-media-lightbox-close" aria-label="Zamknij podgląd">×</button>
        <div class="chem-media-lightbox-body">
          <div class="chem-media-lightbox-img-wrap">
            <span class="chem-media-lightbox-loading">Ładowanie…</span>
          </div>
          <div class="chem-media-lightbox-details">
            <strong>${asset.filename}</strong>
            <small>${formatSize(asset.size)} · ${asset.mimeType.replace('image/', '').toUpperCase()} · ${asset.reference}</small>
          </div>
        </div>
      </div>`;
    const close = () => lightbox.remove();
    lightbox.querySelector('.chem-media-lightbox-close').addEventListener('click', close);
    lightbox.querySelector('.chem-media-lightbox-backdrop').addEventListener('click', close);
    const escHandler = (e) => { if (e.key === 'Escape') { close(); root.removeEventListener?.('keydown', escHandler); } };
    root.addEventListener?.('keydown', escHandler);
    const target = state.dialog.querySelector('.chem-media-shell') || state.dialog;
    target.append(lightbox);

    const wrap = lightbox.querySelector('.chem-media-lightbox-img-wrap');
    const existingImg = thumb.querySelector('img');
    if (existingImg && existingImg.src) {
      const img = create('img');
      img.src = existingImg.src;
      img.alt = asset.filename;
      wrap.replaceChildren(img);
    } else {
      root.ChemContentLibrary?.readMediaBlob?.({
        ...owner(),
        reference: asset.reference,
        repositoryId: state.options?.repositoryId || ''
      }).then((blob) => {
        const url = root.URL.createObjectURL(blob);
        state.objectUrls.add(url);
        const img = create('img');
        img.src = url;
        img.alt = asset.filename;
        wrap.replaceChildren(img);
      }).catch(() => {
        wrap.textContent = 'Nie udało się wczytać podglądu.';
      });
    }
  }

  function observeThumbnails() {
    if (!root.IntersectionObserver) {
      state.dialog.querySelectorAll('[data-media-thumb]').forEach((thumb) => void loadThumbnail(thumb));
      return;
    }
    state.observer = new root.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        state.observer.unobserve(entry.target);
        void loadThumbnail(entry.target);
      });
    }, { root: state.dialog.querySelector('.chem-media-shell'), rootMargin: '180px' });
    state.dialog.querySelectorAll('[data-media-thumb]').forEach((thumb) => state.observer.observe(thumb));
  }

  async function loadThumbnail(thumb) {
    const library = root.ChemContentLibrary;
    if (!library?.readMediaBlob || !thumb.isConnected) return;
    try {
      const blob = await library.readMediaBlob({
        ...owner(),
        reference: thumb.dataset.reference,
        repositoryId: state.options?.repositoryId || ''
      });
      if (!thumb.isConnected) return;
      const url = root.URL.createObjectURL(blob);
      state.objectUrls.add(url);
      const image = create('img');
      image.src = url;
      image.alt = '';
      image.loading = 'lazy';
      thumb.replaceChildren(image);
    } catch {
      thumb.classList.add('is-error');
    }
  }

  function selectAsset(asset) {
    state.options?.onSelect?.({
      ...asset,
      scope: state.scope,
      repositoryId: state.options?.repositoryId || asset.repositoryId || ''
    });
    state.dialog.close();
  }

  async function deleteAsset(asset, button) {
    const warning = asset.usageCount > 0
      ? `Ten obraz ma ${asset.usageCount} ${asset.usageCount === 1 ? 'odwołanie' : 'odwołania'} w definicji materiału. Po usunięciu w jego miejscu może pojawić się brak obrazu.\n\n`
      : state.scope === 'shared'
        ? 'To plik współdzielony. Może być używany przez wiele materiałów, których nie skanujemy automatycznie.\n\n'
        : '';
    if (!root.confirm(`${warning}Usunąć „${asset.filename}” z prywatnego repozytorium? Poprzednia wersja pozostanie w historii zmian.`)) return;
    button.disabled = true;
    setStatus(`Usuwanie ${asset.filename}…`);
    try {
      await root.ChemContentLibrary.removeMedia({
        ...owner(),
        reference: asset.reference,
        expectedSha: asset.sha,
        repositoryId: state.options?.repositoryId || ''
      });
      state.assets = state.assets.filter((entry) => entry.sha !== asset.sha);
      setStatus(`${asset.filename} usunięto. Plik można przywrócić z historii repozytorium.`);
      renderAssets();
      state.options?.onDelete?.(asset);
    } catch (error) {
      button.disabled = false;
      setStatus(error?.message || 'Nie udało się usunąć obrazu.', true);
    }
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
    if (!files.length || state.loading) return;
    const invalid = files.find((file) => !ACCEPTED.has(file.type) || file.size <= 0 || file.size > MAX_BYTES);
    if (invalid) {
      setStatus(`„${invalid.name}” ma nieobsługiwany format albo przekracza 4 MB.`, true);
      return;
    }
    state.loading = true;
    renderAssets();
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setStatus(`Wysyłanie ${index + 1}/${files.length}: ${file.name}…`);
        await uploadImage(file, { ...owner(), repositoryId: state.options?.repositoryId || '' });
      }
      state.loading = false;
      await loadAssets(true);
    } catch (error) {
      state.loading = false;
      setStatus(error?.message || 'Nie udało się wysłać obrazu.', true);
      renderAssets();
    }
  }

  async function open(options = {}) {
    const dialog = ensureDialog();
    state.options = { ...options };
    state.scope = options.scope === 'shared' ? 'shared' : (options.materialKind && options.materialId ? 'local' : 'shared');
    state.query = '';
    state.assets = [];
    pagedListApi?.reset(state.paging);
    dialog.querySelector('.chem-media-search input').value = '';
    syncChrome();
    if (!dialog.open) dialog.showModal();
    await loadAssets(false);
  }

  root.ChemMediaManager = Object.freeze({ open, uploadImage, imageFiles });
})(typeof globalThis !== 'undefined' ? globalThis : window);
