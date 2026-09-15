(function initChemMedia(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChemMedia = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChemMedia() {
  'use strict';

  const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
  const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

  function parseUrl(value) {
    try {
      return new URL(String(value || '').trim());
    } catch {
      return null;
    }
  }

  function hostWithoutWww(url) {
    return String(url?.hostname || '').toLowerCase().replace(/^www\./, '');
  }

  function isDriveId(value) {
    return DRIVE_ID.test(String(value || ''));
  }

  function extractDriveId(input) {
    const value = String(input || '').trim();
    if (isDriveId(value)) return value;

    const url = parseUrl(value);
    const host = hostWithoutWww(url);
    if (!url || !['drive.google.com', 'docs.google.com'].includes(host)) return '';

    const queryId = url.searchParams.get('id') || '';
    if (isDriveId(queryId)) return queryId;

    const match = url.pathname.match(/\/(?:file|document|presentation|spreadsheets)(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/i);
    return match && isDriveId(match[1]) ? match[1] : '';
  }

  function extractYouTubeId(input) {
    const value = String(input || '').trim();
    if (YOUTUBE_ID.test(value)) return value;

    const url = parseUrl(value);
    const host = hostWithoutWww(url);
    if (!url || !['youtu.be', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) return '';

    let candidate = '';
    if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] || '';
    if (host !== 'youtu.be') {
      candidate = url.searchParams.get('v') || '';
      if (!candidate) {
        const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/i);
        candidate = match ? match[1] : '';
      }
    }
    return YOUTUBE_ID.test(candidate) ? candidate : '';
  }

  function extractSlides(input) {
    const value = String(input || '').trim();
    if (isDriveId(value)) return { id: value, published: false };

    const url = parseUrl(value);
    const host = hostWithoutWww(url);
    if (!url || !['docs.google.com', 'drive.google.com'].includes(host)) return null;

    const published = url.pathname.match(/^\/presentation\/d\/e\/([A-Za-z0-9_-]{10,200})(?:\/|$)/i);
    if (published && isDriveId(published[1])) return { id: published[1], published: true };

    const standard = url.pathname.match(/^\/presentation(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/i);
    if (standard && isDriveId(standard[1])) return { id: standard[1], published: false };

    const driveId = extractDriveId(value);
    return driveId ? { id: driveId, published: false } : null;
  }

  function inferVideoProvider(input) {
    if (extractYouTubeId(input)) return 'youtube';
    if (extractDriveId(input)) return 'drive';
    return '';
  }

  function safeHttpsUrl(input) {
    const value = String(input || '').trim();
    if (
      !value
      || value.length > 2_048
      || /[\u0000-\u0020\\]/.test(value)
    ) return '';
    const url = parseUrl(value);
    if (
      !url
      || url.protocol !== 'https:'
      || !url.hostname
      || url.username
      || url.password
    ) return '';
    return url.toString();
  }

  function normalizeType(value, allowed, fallback) {
    const normalized = String(value || '');
    return allowed.includes(normalized) ? normalized : fallback;
  }

  function readParamsAndHide(win) {
    const currentWindow = win || (typeof window !== 'undefined' ? window : null);
    if (!currentWindow) return new URLSearchParams();

    let params;
    try {
      params = new URLSearchParams(currentWindow.location.search || '');
    } catch {
      params = new URLSearchParams();
    }

    if (currentWindow.location.search) {
      try {
        currentWindow.history.replaceState(
          currentWindow.history.state,
          currentWindow.document?.title || '',
          `${currentWindow.location.pathname}${currentWindow.location.hash || ''}`
        );
      } catch {}
    }
    return params;
  }

  function saveState(storage, key, state) {
    try {
      storage.setItem(key, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  function loadState(storage, key) {
    try {
      const value = JSON.parse(storage.getItem(key) || 'null');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }

  function withCacheBust(url, attempt) {
    const parsed = new URL(url);
    parsed.searchParams.set('_retry', String(attempt || Date.now()));
    return parsed.toString();
  }

  return {
    extractDriveId,
    extractSlides,
    extractYouTubeId,
    inferVideoProvider,
    isDriveId,
    loadState,
    normalizeType,
    readParamsAndHide,
    safeHttpsUrl,
    saveState,
    withCacheBust
  };
});
