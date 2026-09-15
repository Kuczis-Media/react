(async () => {
  'use strict';

  const media = window.ChemMedia;
  const params = media.readParamsAndHide(window);
  const STORAGE_KEY = 'chemdisk.film.v3';
  const progressApi = window.ChemProgress;
  const fromUrl = params.has('id');
  const rawInput = fromUrl ? String(params.get('id') || '').trim() : '';
  const explicitType = params.has('type');
  const inferredProvider = media.inferVideoProvider(rawInput);
  const requestedType = explicitType
    ? media.normalizeType(params.get('type'), ['1', '2', '3'], '1')
    : inferredProvider === 'drive' ? '2' : '1';
  const idFromUrl = fromUrl
    ? requestedType === '2' ? media.extractDriveId(rawInput) : media.extractYouTubeId(rawInput)
    : '';

  if (idFromUrl) media.saveState(sessionStorage, STORAGE_KEY, { id: idFromUrl, type: requestedType });
  const saved = !fromUrl ? media.loadState(sessionStorage, STORAGE_KEY) : null;
  const savedType = media.normalizeType(saved?.type, ['1', '2', '3'], '1');
  const savedIdIsValid = savedType === '2'
    ? media.isDriveId(saved?.id)
    : /^[A-Za-z0-9_-]{11}$/.test(String(saved?.id || ''));
  const state = idFromUrl
    ? { id: idFromUrl, type: requestedType }
    : saved && savedIdIsValid ? { id: saved.id, type: savedType } : null;
  const progressMaterialId = progressApi && state
    ? progressApi.materialId('video', state.id, params.get('material') || '')
    : '';

  const authState = await window.ChemAuth.ready;
  if (!authState?.authenticated || !authState.session?.ok) return;

  const app = document.getElementById('app');
  const stage = document.getElementById('stage');
  const frame = document.getElementById('film-frame');
  const loading = document.getElementById('loading');
  const slow = document.getElementById('slow');
  const error = document.getElementById('error');
  const errorCopy = document.getElementById('error-copy');
  const retryTop = document.getElementById('retry-top');
  const providerLink = document.getElementById('provider-link');
  const providerTop = document.getElementById('provider-top');
  const providerCopy = document.getElementById('provider-copy');
  const modeBadge = document.getElementById('mode-badge');
  let slowTimer = 0;
  let failTimer = 0;
  let attempt = 0;
  let youtubePlayer = null;
  let youtubePlayerReady = false;
  let youtubeTrackingAttached = false;
  let youtubeApiPromise = null;
  let watchTimer = 0;
  let lastWatchSample = null;
  let currentWatchRange = null;
  let watchedRanges = [];
  let lastProgressSync = 0;
  const PROGRESS_SYNC_INTERVAL = 15000;

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
    showError('Brakuje poprawnego ID lub linku do filmu YouTube albo Google Drive.');
    return;
  }

  const isDrive = state.type === '2';
  const protectedMode = state.type === '1';
  const encodedId = encodeURIComponent(state.id);
  const query = new URLSearchParams({ rel: '0', playsinline: '1', origin: location.origin });
  if (!isDrive) query.set('enablejsapi', '1');
  if (protectedMode) {
    query.set('controls', '1');
    query.set('fs', '0');
    query.set('disablekb', '1');
    query.set('iv_load_policy', '3');
  }
  const rawTime = params.get('t') || params.get('start') || params.get('time') || '';
  if (rawTime && !isDrive) {
    let startSec = 0;
    const timeMatch = /^(\d+h)?(\d+m)?(\d+s)?$/.exec(rawTime.toLowerCase());
    if (timeMatch && (timeMatch[1] || timeMatch[2] || timeMatch[3])) {
      startSec = (timeMatch[1] ? parseInt(timeMatch[1], 10) * 3600 : 0) +
                 (timeMatch[2] ? parseInt(timeMatch[2], 10) * 60 : 0) +
                 (timeMatch[3] ? parseInt(timeMatch[3], 10) : 0);
    } else {
      startSec = parseInt(rawTime, 10) || 0;
    }
    if (startSec > 0) query.set('start', String(startSec));
  }

  const sourceUrl = isDrive
    ? `https://drive.google.com/file/d/${encodedId}/preview`
    : `${protectedMode ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com'}/embed/${encodedId}?${query.toString()}`;
  const outsideUrl = isDrive
    ? `https://drive.google.com/file/d/${encodedId}/view`
    : `https://www.youtube.com/watch?v=${encodedId}`;
  providerTop.href = outsideUrl;
  providerTop.hidden = protectedMode;
  providerLink.hidden = protectedMode;

  providerCopy.textContent = isDrive ? 'Google Drive' : 'YouTube';
  modeBadge.textContent = isDrive ? 'Wideo z Dysku' : protectedMode ? 'Tryb ograniczony' : 'Pełny odtwarzacz';
  document.getElementById('loading-copy').textContent = isDrive
    ? 'Google Drive przygotowuje odtwarzacz. Film musi być udostępniony odbiorcom.'
    : 'Ładowanie odtwarzacza YouTube może potrwać kilka sekund.';
  document.getElementById('slow-copy').textContent = isDrive
    ? 'Film może być nadal przetwarzany przez Google albo wymagać włączonych plików cookie innych firm.'
    : 'Film może mieć wyłączone osadzanie albo być niedostępny dla odbiorcy.';
  stage.classList.toggle('is-protected', protectedMode);

  if (protectedMode) {
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    frame.setAttribute('allow', 'autoplay; encrypted-media');
    frame.removeAttribute('allowfullscreen');
    document.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
    document.addEventListener('keydown', (event) => {
      const key = String(event.key || '').toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ['s', 'p', 'u'].includes(key)) event.preventDefault();
    }, { capture: true });
  } else {
    frame.setAttribute('allowfullscreen', '');
  }

  function trackedRanges() {
    return [
      ...watchedRanges,
      ...(currentWatchRange ? [currentWatchRange] : [])
    ];
  }

  function closeCurrentWatchRange() {
    if (!currentWatchRange) return;
    watchedRanges.push(currentWatchRange);
    currentWatchRange = null;
    if (watchedRanges.length > 300) watchedRanges = watchedRanges.slice(-300);
  }

  function syncVideoProgress(immediate) {
    if (!progressApi || !progressMaterialId || !youtubePlayerReady || !youtubePlayer) return;
    const duration = Number(youtubePlayer.getDuration()) || 0;
    const position = Number(youtubePlayer.getCurrentTime()) || 0;
    progressApi.update({
      materialId: progressMaterialId,
      materialType: 'video',
      action: 'video',
      lastPosition: { seconds: position, duration },
      details: {
        playbackStarted: true,
        duration,
        lastPlaybackPosition: position,
        watchedRanges: trackedRanges()
      }
    }, { immediate: Boolean(immediate), debounceMs: 3000 });
    lastProgressSync = Date.now();
  }

  function collectWatchSample() {
    if (!youtubePlayerReady || !youtubePlayer || !window.YT) return;
    if (youtubePlayer.getPlayerState() !== window.YT.PlayerState.PLAYING) return;
    const current = Number(youtubePlayer.getCurrentTime());
    if (!Number.isFinite(current) || current < 0) return;
    if (lastWatchSample != null) {
      const delta = current - lastWatchSample;
      if (delta > 0 && delta <= 2.5) {
        if (!currentWatchRange) currentWatchRange = [lastWatchSample, current];
        else if (lastWatchSample <= currentWatchRange[1] + .5) currentWatchRange[1] = current;
        else {
          closeCurrentWatchRange();
          currentWatchRange = [lastWatchSample, current];
        }
      } else {
        closeCurrentWatchRange();
      }
    }
    lastWatchSample = current;
    if (Date.now() - lastProgressSync >= PROGRESS_SYNC_INTERVAL) syncVideoProgress(false);
  }

  function loadYouTubeApi() {
    if (window.YT && typeof window.YT.Player === 'function') return Promise.resolve();
    if (youtubeApiPromise) return youtubeApiPromise;
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      const timeout = window.setTimeout(() => reject(new Error('YouTube API timeout')), 15000);
      window.onYouTubeIframeAPIReady = () => {
        window.clearTimeout(timeout);
        if (typeof previousReady === 'function') previousReady();
        resolve();
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.youtubeIframeApi = 'true';
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('YouTube API unavailable'));
      };
      document.head.appendChild(script);
    });
    return youtubeApiPromise;
  }

  function attachYouTubeTracking() {
    if (isDrive || youtubeTrackingAttached) return;
    youtubeTrackingAttached = true;
    loadYouTubeApi().then(() => {
      youtubePlayer = new window.YT.Player(frame, {
        events: {
          onReady: (event) => {
            youtubePlayer = event.target;
            youtubePlayerReady = true;
            window.clearInterval(watchTimer);
            watchTimer = window.setInterval(collectWatchSample, 1000);
            progressApi?.load().then(() => {
              const saved = progressApi.record(progressMaterialId);
              const savedPosition = Number(saved?.details?.lastPlaybackPosition);
              const duration = Number(youtubePlayer.getDuration()) || 0;
              if (Number.isFinite(savedPosition) && savedPosition > 0 && savedPosition < duration - 2) {
                youtubePlayer.seekTo(savedPosition, true);
              }
            }).catch(() => {});
          },
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.PLAYING) {
              lastWatchSample = Number(youtubePlayer.getCurrentTime()) || 0;
              syncVideoProgress(false);
              return;
            }
            if ([window.YT.PlayerState.PAUSED, window.YT.PlayerState.ENDED].includes(event.data)) {
              collectWatchSample();
              closeCurrentWatchRange();
              lastWatchSample = null;
              syncVideoProgress(true);
            }
          }
        }
      });
    }).catch((error) => {
      youtubeTrackingAttached = false;
      console.warn('Śledzenie odtwarzacza YouTube jest niedostępne', error?.message || error);
    });
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
      frame.src = attempt === 1 ? sourceUrl : media.withCacheBust(sourceUrl, attempt);
    });

    slowTimer = window.setTimeout(() => {
      if (!stage.classList.contains('is-ready')) {
        loading.hidden = true;
        slow.hidden = false;
        providerLink.href = outsideUrl;
        retryTop.hidden = false;
      }
    }, 12000);
    failTimer = window.setTimeout(() => {
      if (!stage.classList.contains('is-ready')) showError('Dostawca filmu nie potwierdził uruchomienia odtwarzacza.');
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
    attachYouTubeTracking();
  });
  frame.addEventListener('error', () => showError('Nie udało się połączyć z dostawcą filmu.'));
  window.addEventListener('message', (event) => {
    if (!progressApi || !progressMaterialId || event.source !== frame.contentWindow) return;
    let expectedOrigin = '';
    try { expectedOrigin = new URL(sourceUrl).origin; } catch (_) {}
    if (!expectedOrigin || event.origin !== expectedOrigin || event.data?.type !== 'chemdisk:video') return;
    progressApi.update({
      materialId: progressMaterialId,
      materialType: 'video',
      action: 'video',
      details: {
        playbackStarted: event.data.playbackStarted === true,
        duration: event.data.duration,
        lastPlaybackPosition: event.data.position,
        watchedRanges: event.data.watchedRanges
      }
    });
  });

  document.getElementById('keep-waiting').addEventListener('click', () => {
    slow.hidden = true;
    stage.classList.add('is-ready');
    app.removeAttribute('aria-busy');
  });
  document.getElementById('retry').addEventListener('click', beginLoad);
  document.getElementById('retry-error').addEventListener('click', beginLoad);
  retryTop.addEventListener('click', beginLoad);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      closeCurrentWatchRange();
      lastWatchSample = null;
      syncVideoProgress(true);
    }
  });
  window.addEventListener('pagehide', () => {
    closeCurrentWatchRange();
    syncVideoProgress(true);
    window.clearInterval(watchTimer);
  }, { once: true });

  beginLoad();
})();
