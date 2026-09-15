(async () => {
  'use strict';

  const media = window.ChemMedia;
  const params = media.readParamsAndHide(window);
  const STORAGE_KEY = 'chemdisk.pdf.v3';
  const progressApi = window.ChemProgress;
  const fromUrl = params.has('id');
  const requestedType = media.normalizeType(params.get('type'), ['1', '2', '3', '4', '5'], '1');
  const rawFromUrl = fromUrl ? params.get('id') : '';
  const directFromUrl = ['4', '5'].includes(requestedType) ? media.safeHttpsUrl(rawFromUrl) : '';
  const idFromUrl = ['4', '5'].includes(requestedType) ? '' : media.extractDriveId(rawFromUrl);

  if (idFromUrl || directFromUrl) {
    media.saveState(sessionStorage, STORAGE_KEY, {
      id: idFromUrl,
      url: directFromUrl,
      type: requestedType
    });
  }
  const saved = !fromUrl ? media.loadState(sessionStorage, STORAGE_KEY) : null;
  const savedType = saved
    ? media.normalizeType(saved.type, ['1', '2', '3', '4', '5'], '1')
    : '1';
  const state = idFromUrl || directFromUrl
    ? { id: idFromUrl, url: directFromUrl, type: requestedType }
    : saved && ['4', '5'].includes(savedType) && media.safeHttpsUrl(saved.url)
      ? { id: '', url: media.safeHttpsUrl(saved.url), type: savedType }
      : saved && media.isDriveId(saved.id)
        ? { id: saved.id, url: '', type: savedType }
        : null;
  const progressMaterialId = progressApi && state
    ? progressApi.materialId('pdf', state.id || state.url, params.get('material') || '')
    : '';

  const authState = await window.ChemAuth.ready;
  if (!authState?.authenticated || !authState.session?.ok) return;

  const app = document.getElementById('app');
  const stage = document.getElementById('stage');
  const frame = document.getElementById('pdf-frame');
  const loading = document.getElementById('loading');
  const slow = document.getElementById('slow');
  const download = document.getElementById('download');
  const error = document.getElementById('error');
  const errorCopy = document.getElementById('error-copy');
  const retryTop = document.getElementById('retry-top');
  const providerLink = document.getElementById('provider-link');
  const providerTop = document.getElementById('provider-top');
  const modeBadge = document.getElementById('mode-badge');
  let slowTimer = 0;
  let failTimer = 0;
  let attempt = 0;

  function clearTimers() {
    window.clearTimeout(slowTimer);
    window.clearTimeout(failTimer);
  }

  function showError(message) {
    clearTimers();
    loading.hidden = true;
    slow.hidden = true;
    download.hidden = true;
    error.hidden = false;
    errorCopy.textContent = message;
    retryTop.hidden = false;
    app.removeAttribute('aria-busy');
  }

  if (!state) {
    showError('Brakuje poprawnego ID/linku Google Drive albo pełnego adresu HTTPS dla trybu 4 lub 5.');
    return;
  }

  if (state.type === '5') {
    window.location.replace(state.url);
    return;
  }

  const directEmbedMode = state.type === '4';
  const encodedId = encodeURIComponent(state.id);
  const previewUrl = directEmbedMode
    ? state.url
    : `https://drive.google.com/file/d/${encodedId}/preview`;
  const outsideUrl = directEmbedMode
    ? state.url
    : `https://drive.google.com/file/d/${encodedId}/view`;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodedId}`;
  const protectedMode = state.type === '1';
  providerTop.hidden = protectedMode;
  providerLink.hidden = protectedMode;
  if (!protectedMode) {
    providerTop.href = outsideUrl;
    providerLink.href = outsideUrl;
  } else {
    providerTop.removeAttribute('href');
    providerLink.removeAttribute('href');
  }

  if (state.type === '2') {
    modeBadge.textContent = 'Pobieranie';
    frame.hidden = true;
    loading.hidden = true;
    download.hidden = false;
    document.getElementById('download-link').href = downloadUrl;
    app.removeAttribute('aria-busy');
    return;
  }

  modeBadge.textContent = protectedMode
    ? 'Ograniczone akcje'
    : directEmbedMode ? 'Osadzony adres HTTPS' : 'Zwykły podgląd';
  stage.classList.toggle('is-protected', protectedMode);
  if (protectedMode) {
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
    document.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
    document.addEventListener('keydown', (event) => {
      const key = String(event.key || '').toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ['s', 'p', 'u'].includes(key)) event.preventDefault();
    }, { capture: true });
  }

  function beginLoad() {
    attempt += 1;
    clearTimers();
    stage.classList.remove('is-ready');
    loading.hidden = false;
    slow.hidden = true;
    error.hidden = true;
    download.hidden = true;
    retryTop.hidden = true;
    app.setAttribute('aria-busy', 'true');
    frame.src = 'about:blank';
    window.requestAnimationFrame(() => {
      frame.src = attempt === 1 || directEmbedMode
        ? previewUrl
        : media.withCacheBust(previewUrl, attempt);
    });

    slowTimer = window.setTimeout(() => {
      if (!stage.classList.contains('is-ready')) {
        loading.hidden = true;
        slow.hidden = false;
        retryTop.hidden = false;
      }
    }, 12000);
    failTimer = window.setTimeout(() => {
      if (!stage.classList.contains('is-ready')) {
        showError(directEmbedMode
          ? 'Ta strona nie potwierdziła osadzenia. Jej właściciel może blokować wyświetlanie w iframe — użyj trybu 5.'
          : 'Google nie potwierdził załadowania dokumentu. Sprawdź udostępnianie albo spróbuj ponownie później.');
      }
    }, 45000);
  }

  frame.addEventListener('load', () => {
    if (!frame.src || frame.src === 'about:blank') return;
    clearTimers();
    loading.hidden = true;
    slow.hidden = true;
    error.hidden = true;
    stage.classList.add('is-ready');
    retryTop.hidden = false;
    app.removeAttribute('aria-busy');
    progressApi?.load().then(() => {
      const saved = progressApi.record(progressMaterialId);
      if (saved?.lastPosition) {
        try { frame.contentWindow.postMessage({ type: 'chemdisk:resume', position: saved.lastPosition }, new URL(previewUrl).origin); } catch (_) {}
      }
    }).catch(() => {});
  });
  window.addEventListener('message', (event) => {
    if (!progressApi || !progressMaterialId || event.source !== frame.contentWindow) return;
    let expectedOrigin = '';
    try { expectedOrigin = new URL(previewUrl).origin; } catch (_) {}
    if (!expectedOrigin || event.origin !== expectedOrigin || event.data?.type !== 'chemdisk:pdf-page') return;
    const page = Math.max(1, Math.floor(Number(event.data.page) || 1));
    const total = Math.max(0, Math.floor(Number(event.data.totalPages) || 0));
    progressApi.update({
      materialId: progressMaterialId,
      materialType: 'pdf',
      action: 'pdf',
      lastPosition: { page, totalPages: total },
      details: { lastPage: page, highestVisitedPage: page, totalPages: total }
    });
  });
  frame.addEventListener('error', () => showError(directEmbedMode
    ? 'Nie udało się osadzić podanego adresu HTTPS. Spróbuj trybu 5.'
    : 'Nie udało się połączyć z podglądem Google Drive.'));

  document.getElementById('keep-waiting').addEventListener('click', () => {
    slow.hidden = true;
    stage.classList.add('is-ready');
    app.removeAttribute('aria-busy');
  });
  document.getElementById('retry').addEventListener('click', beginLoad);
  document.getElementById('retry-error').addEventListener('click', beginLoad);
  retryTop.addEventListener('click', beginLoad);

  beginLoad();
})();
