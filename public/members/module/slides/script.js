(async () => {
  'use strict';

  const media = window.ChemMedia;
  const params = media.readParamsAndHide(window);
  const STORAGE_KEY = 'chemdisk.slides.v3';
  const progressApi = window.ChemProgress;

  const fromUrl = params.has('id');
  const requestedType = media.normalizeType(params.get('type'), ['1', '2', '4', '5'], '1');
  const rawFromUrl = fromUrl ? params.get('id') : '';
  const directFromUrl = ['4', '5'].includes(requestedType) ? media.safeHttpsUrl(rawFromUrl) : '';
  const parsedFromUrl = ['4', '5'].includes(requestedType) ? null : media.extractSlides(rawFromUrl);
  if (parsedFromUrl || directFromUrl) {
    media.saveState(sessionStorage, STORAGE_KEY, {
      id: parsedFromUrl ? parsedFromUrl.id : '',
      url: directFromUrl,
      published: parsedFromUrl ? parsedFromUrl.published : false,
      type: requestedType
    });
  }

  const saved = !fromUrl ? media.loadState(sessionStorage, STORAGE_KEY) : null;
  const savedType = saved
    ? media.normalizeType(saved.type, ['1', '2', '4', '5'], '1')
    : '1';
  const state = parsedFromUrl || directFromUrl
    ? {
        id: parsedFromUrl ? parsedFromUrl.id : '',
        url: directFromUrl,
        published: parsedFromUrl ? parsedFromUrl.published : false,
        type: requestedType
      }
    : saved && ['4', '5'].includes(savedType) && media.safeHttpsUrl(saved.url)
      ? { id: '', url: media.safeHttpsUrl(saved.url), published: false, type: savedType }
      : saved && media.isDriveId(saved.id)
        ? { id: saved.id, url: '', published: saved.published === true, type: savedType }
        : null;
  const progressMaterialId = progressApi && state
    ? progressApi.materialId('presentation', state.id || state.url, params.get('material') || '')
    : '';

  const authState = await window.ChemAuth.ready;
  if (!authState?.authenticated || !authState.session?.ok) return;

  const app = document.getElementById('app');
  const stage = document.getElementById('stage');
  const frame = document.getElementById('slides-frame');
  const loading = document.getElementById('loading');
  const slow = document.getElementById('slow');
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
    error.hidden = false;
    errorCopy.textContent = message;
    retryTop.hidden = false;
    app.removeAttribute('aria-busy');
  }

  if (!state) {
    showError('Brakuje poprawnego ID/linku Google Slides albo pełnego adresu HTTPS dla trybu 4 lub 5.');
    return;
  }

  async function markPresentationOpened() {
    if (!progressApi || !progressMaterialId) return;
    await progressApi.open({
      materialId: progressMaterialId,
      materialType: 'presentation'
    }).catch(() => {});
  }

  if (state.type === '5') {
    await markPresentationOpened();
    window.location.replace(state.url);
    return;
  }

  void markPresentationOpened();

  const directEmbedMode = state.type === '4';
  const protectedMode = state.type === '2';
  modeBadge.textContent = protectedMode
    ? 'Tryb ograniczony'
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

  const encodedId = encodeURIComponent(state.id);
  const base = state.published
    ? `https://docs.google.com/presentation/d/e/${encodedId}`
    : `https://docs.google.com/presentation/d/${encodedId}`;
  const sourceUrl = directEmbedMode
    ? state.url
    : state.published
      ? `${base}/embed?start=false&loop=false&delayms=3000`
      : protectedMode
        ? `${base}/embed?start=false&loop=false&delayms=3000&rm=minimal`
        : `${base}/preview?start=false&loop=false&delayms=3000`;
  const outsideUrl = directEmbedMode
    ? state.url
    : state.published ? `${base}/pub` : `${base}/view`;
  providerTop.hidden = protectedMode;
  providerLink.hidden = protectedMode;
  if (!protectedMode) {
    providerTop.href = outsideUrl;
    providerLink.href = outsideUrl;
  } else {
    providerTop.removeAttribute('href');
    providerLink.removeAttribute('href');
  }

  function beginLoad() {
    attempt += 1;
    clearTimers();
    stage.classList.remove('is-ready');
    loading.hidden = false;
    slow.hidden = true;
    error.hidden = true;
    retryTop.hidden = true;
    app.setAttribute('aria-busy', 'true');

    frame.src = 'about:blank';
    window.requestAnimationFrame(() => {
      frame.src = attempt === 1 || directEmbedMode
        ? sourceUrl
        : media.withCacheBust(sourceUrl, attempt);
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
          : 'Google nie potwierdził załadowania prezentacji. Upewnij się, że plik jest udostępniony odbiorcom.');
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
        try { frame.contentWindow.postMessage({ type: 'chemdisk:resume', position: saved.lastPosition }, new URL(sourceUrl).origin); } catch (_) {}
      }
    }).catch(() => {});
  });
  window.addEventListener('message', (event) => {
    if (!progressApi || !progressMaterialId || event.source !== frame.contentWindow) return;
    let expectedOrigin = '';
    try { expectedOrigin = new URL(sourceUrl).origin; } catch (_) {}
    if (!expectedOrigin || event.origin !== expectedOrigin || event.data?.type !== 'chemdisk:slide') return;
    const index = Math.max(0, Math.floor(Number(event.data.index) || 0));
    const total = Math.max(0, Math.floor(Number(event.data.total) || 0));
    progressApi.update({
      materialId: progressMaterialId,
      materialType: 'presentation',
      action: 'presentation',
      lastPosition: { slideId: String(event.data.id || index + 1), slideIndex: index },
      details: {
        lastSlideId: String(event.data.id || index + 1),
        lastSlideIndex: index,
        highestReachedSlide: index + 1,
        visitedSlides: [String(event.data.id || index + 1)],
        totalSlides: total
      }
    });
  });
  frame.addEventListener('error', () => showError(directEmbedMode
    ? 'Nie udało się osadzić podanego adresu HTTPS. Spróbuj trybu 5.'
    : 'Nie udało się połączyć z Google Slides.'));

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
