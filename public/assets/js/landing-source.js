(function () {
  'use strict';
  const api = window.NextMedLandingDelivery;
  if (!api) return;
  const CACHE_KEY = 'nextmed.landing.route.v2';
  const PUBLICATION_CACHE_KEY = 'nextmed.landing.publication.v1';
  const TTL = 5 * 60_000;
  let cached;
  try {
    const entry = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (entry && Number.isFinite(entry.checkedAt) && entry.checkedAt <= Date.now()) cached = { settings: { ...api.normalize(entry.settings), ...(entry.settings?.unavailable ? { unavailable: true } : {}) }, checkedAt: entry.checkedAt };
  } catch {}
  const preview = new URLSearchParams(location.search).get('landing-preview') === '1' && window.parent !== window;
  const exported = Boolean(document.querySelector('meta[name="nextmed-landing-export"]'));
  async function resolveRoute() {
    if (preview || exported) return api.normalize();
    if (cached && Date.now() - cached.checkedAt < TTL) return cached.settings;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(api.ROUTE_URL, { cache: 'default', credentials: 'omit', signal: controller.signal });
      if (!response.ok && response.status !== 404) throw new Error('Route unavailable');
      const settings = response.status === 404 ? api.normalize() : api.normalize(await response.json());
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ settings, checkedAt: Date.now() })); } catch {}
      return settings;
    } catch {
      const settings = cached?.settings || { ...api.normalize(), unavailable: true };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ settings, checkedAt: Date.now() })); } catch {}
      return settings;
    }
    finally { window.clearTimeout(timer); }
  }
  function validPublication(value) {
    if (!value || !['netlify-blobs', 'static-github'].includes(value.mode)
      || typeof value.version !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.version)) return false;
    const model = value.model;
    return value.mode === 'static-github' || (value.active === true && model?.version === 3
      && model.branding && typeof model.branding.brandName === 'string' && model.branding.brandName.trim()
      && Number.isSafeInteger(model.revision) && model.revision >= 0
      && Array.isArray(model.sections) && model.sections.length === 6
      && ['home', 'about', 'services', 'pricing', 'skills', 'contact']
        .every((id) => model.sections.some((section) => section?.id === id)));
  }
  async function resolvePublication() {
    let cachedPublication;
    try {
      const entry = JSON.parse(localStorage.getItem(PUBLICATION_CACHE_KEY) || 'null');
      if (entry && Number.isFinite(entry.checkedAt) && entry.checkedAt <= Date.now()
        && (entry.publication === null || validPublication(entry.publication))) cachedPublication = entry;
    } catch {}
    if (cachedPublication && Date.now() - cachedPublication.checkedAt < TTL) return cachedPublication.publication;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    try {
      // A durable CDN response, shared between visitors. No identity/session
      // is sent, no polling and no request on scroll or editor keystrokes.
      const response = await fetch('/.netlify/functions/landing', { cache: 'default', credentials: 'omit', signal: controller.signal });
      if (!response.ok && response.status !== 404) throw new Error('Publication unavailable');
      const payload = response.status === 404 ? null : await response.json();
      const publication = validPublication(payload) ? payload : null;
      if (payload?.mode && !publication) throw new Error('Invalid publication');
      try { localStorage.setItem(PUBLICATION_CACHE_KEY, JSON.stringify({ publication, checkedAt: Date.now() })); } catch {}
      return publication;
    } catch {
      const publication = cachedPublication?.publication || null;
      // Throttle retries across page navigation even during an outage; never
      // turn a failed response into a new authoritative delivery decision.
      try { localStorage.setItem(PUBLICATION_CACHE_KEY, JSON.stringify({ publication, checkedAt: Date.now() })); } catch {}
      return publication;
    }
    finally { window.clearTimeout(timer); }
  }
  async function resolve() {
    if (preview || exported) return api.normalize();
    const [settings, publication] = await Promise.all([resolveRoute(), resolvePublication()]);
    return publication ? { ...settings, publication } : settings;
  }
  window.NextMedLandingSource = Object.freeze({ ready: resolve(), cacheKey: CACHE_KEY, publicationCacheKey: PUBLICATION_CACHE_KEY });
})();
