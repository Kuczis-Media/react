(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChemProgressiveImage = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';
  const jobs = new WeakMap();
  const visibleJobs = new WeakMap();

  function cancelVisible(root) { visibleJobs.get(root)?.(); visibleJobs.delete(root); }
  function loadVisible(root, figures, loadFigure) {
    cancelVisible(root);
    let active = 0, disposed = false;
    const queue = [], queued = new Set();
    const environment = root.ownerDocument.defaultView;
    const observer = environment?.IntersectionObserver ? new environment.IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { observer.unobserve(entry.target); void enqueue(entry.target); } });
    }, { rootMargin: '350px 0px' }) : null;
    function drain() {
      while (!disposed && active < 2 && queue.length) {
        const { figure, resolve } = queue.shift();
        if (!figure.isConnected) { resolve(); continue; }
        active++;
        Promise.resolve().then(() => loadFigure(figure, false, figures.indexOf(figure))).catch(() => {}).finally(() => { active--; resolve(); drain(); });
      }
    }
    function enqueue(figure) {
      if (disposed || queued.has(figure)) return Promise.resolve();
      queued.add(figure);
      return new Promise(resolve => { queue.push({ figure, resolve }); drain(); });
    }
    visibleJobs.set(root, () => { disposed = true; observer?.disconnect(); queue.splice(0).forEach(item => item.resolve()); });
    return Promise.all(figures.map((figure, index) => {
      if (!observer || index < 2) return enqueue(figure);
      observer.observe(figure); return Promise.resolve();
    }));
  }

  // Keep a small set of decoded-source URLs for revisiting nearby slides.
  // In-flight decoding and currently displayed images must never be evicted.
  function createCache(readBlob, { document: doc, urlApi, maxEntries = 24, maxBytes = 48 * 1024 * 1024 }) {
    const entries = new Map();
    let generation = 0, bytes = 0, trimTimer;
    function trim() {
      const displayed = new Set([...doc.querySelectorAll('img[src]')].map(image => image.src));
      for (const [key, entry] of entries) {
        if (entries.size <= maxEntries && bytes <= maxBytes) break;
        if (!entry.url || entry.users || displayed.has(entry.url)) continue;
        urlApi.revokeObjectURL(entry.url); bytes -= entry.bytes; entries.delete(key);
      }
    }
    function get(reference, repositoryId = '', variant = '') {
      const key = JSON.stringify([reference, repositoryId, variant]);
      if (entries.has(key)) {
        const entry = entries.get(key); entries.delete(key); entries.set(key, entry); return entry.promise;
      }
      const owner = generation, entry = { url: '', bytes: 0, users: 0 };
      entry.promise = Promise.resolve().then(() => readBlob(reference, repositoryId, variant)).then(blob => {
        if (owner !== generation) throw new Error('PREVIEW_CHANGED');
        entry.url = urlApi.createObjectURL(blob); entry.bytes = blob.size; bytes += blob.size;
        return entry.url;
      }).catch(error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
      entries.set(key, entry); return entry.promise;
    }
    get.preview = (reference, repositoryId) => get(reference, repositoryId, 'thumbnail');
    get.retain = url => { for (const entry of entries.values()) if (entry.url === url) entry.users++; };
    get.release = url => { for (const entry of entries.values()) if (entry.url === url) entry.users = Math.max(0, entry.users - 1); clearTimeout(trimTimer); trimTimer = setTimeout(trim, 0); };
    function clear() {
      clearTimeout(trimTimer); generation++; entries.forEach(entry => { if (entry.url) urlApi.revokeObjectURL(entry.url); }); entries.clear(); bytes = 0;
    }
    return { get, clear, trim };
  }

  // URL ownership stays with the caller's bounded cache (or the current slide).
  // Decode in a separate image so a useful thumbnail never flashes blank.
  function load(image, getUrl, options = {}) {
    const job = {}; jobs.set(image, job);
    const current = () => jobs.get(image) === job && image.isConnected && (!options.current || options.current());
    let fullReady = false, shown = false, previewUrl = '';
    image.setAttribute('aria-busy', 'true'); image.classList.add('is-loading');
    const fail = error => {
      if (!current()) return;
      image.setAttribute('aria-busy', 'false'); image.classList.remove('is-loading');
      options.onError?.(error);
    };
    const show = async (url, thumbnail) => {
      if (!url) throw new Error('IMAGE_URL_MISSING');
      getUrl.retain?.(url);
      try {
        if (!current() || (thumbnail && fullReady)) { options.onDiscard?.(url); return; }
        const decoded = image.ownerDocument.createElement('img');
        decoded.decoding = 'async'; decoded.src = url;
        const environment = image.ownerDocument.defaultView || globalThis;
        let decodeTimer;
        try {
          if (decoded.decode) await Promise.race([
            decoded.decode(),
            new Promise((_, reject) => {
              decodeTimer = environment.setTimeout(() => reject(new Error('IMAGE_DECODE_TIMEOUT')), 12_000);
            })
          ]);
        }
        catch (error) { decoded.removeAttribute('src'); options.onDiscard?.(url); throw error; }
        finally { if (decodeTimer !== undefined) environment.clearTimeout(decodeTimer); }
        if (!current() || (thumbnail && fullReady)) { options.onDiscard?.(url); return; }
        if (thumbnail) previewUrl = url;
        else fullReady = true;
        const previousUrl = image.getAttribute('src') || '';
        image.onload = () => { if (current()) options.onReady?.({ url, thumbnail }); };
        image.onerror = () => {
          if (!current()) return;
          if (!thumbnail && previewUrl) {
            image.onerror = () => fail(new Error('IMAGE_DECODE_FAILED'));
            image.src = previewUrl; image.dataset.mediaQuality = 'thumbnail';
            options.onDisplay?.({ url: previewUrl, thumbnail: true, previousUrl: url });
          } else fail(new Error('IMAGE_DECODE_FAILED'));
        };
        image.src = url; image.hidden = false; image.dataset.mediaQuality = thumbnail ? 'thumbnail' : 'full';
        image.setAttribute('aria-busy', 'false'); image.classList.remove('is-loading'); shown = true;
        options.onDisplay?.({ url, thumbnail, previousUrl });
        if (image.complete && image.naturalWidth) options.onReady?.({ url, thumbnail });
      } finally { getUrl.release?.(url); }
    };
    const read = method => Promise.resolve().then(() => {
      if (!current()) return '';
      return method(options.reference, options.repositoryId);
    });
    const small = getUrl.preview ? read(getUrl.preview).then(url => show(url, true)).catch(() => {}) : Promise.resolve();
    return read(getUrl).then(url => show(url, false)).then(() => shown).catch(async error => {
      await small;
      if (!shown) fail(error);
      return shown;
    });
  }
  function cancel(image) {
    jobs.delete(image); image.onload = null; image.onerror = null;
  }
  async function loadManaged(figure, input, options) {
    const image = figure.ownerDocument.createElement('img');
    const environment = figure.ownerDocument.defaultView || globalThis;
    const timeout = environment.setTimeout?.bind(environment) || setTimeout;
    const clearTimer = environment.clearTimeout?.bind(environment) || clearTimeout;
    const current = () => image.isConnected && (!options.current || options.current());
    const owned = new Set();
    const discard = url => {
      if (!owned.delete(url)) return;
      options.urlApi.revokeObjectURL(url);
      const index = options.objectUrls.indexOf(url); if (index >= 0) options.objectUrls.splice(index, 1);
    };
    image.alt = figure.dataset.lessonMediaAlt || 'Ilustracja';
    image.loading = options.priority ? 'eager' : 'lazy'; image.decoding = 'async';
    image.fetchPriority = options.priority ? 'high' : 'auto';
    figure.replaceChildren(image);
    const read = async variant => {
      let timer;
      try {
        const blob = await Promise.race([
          options.library.readMediaBlob({ ...input, ...(variant ? { variant } : {}) }, { bypassCache: Boolean(options.bypassCache) }),
          new Promise((_, reject) => { timer = timeout(() => reject(new Error('MEDIA_TIMEOUT')), 20_000); })
        ]);
        if (!current()) throw new Error('PREVIEW_CHANGED');
        const url = options.urlApi.createObjectURL(blob); owned.add(url); options.objectUrls.push(url); return url;
      } finally { clearTimer(timer); }
    };
    const getUrl = () => read(''); getUrl.preview = () => read('thumbnail');
    return load(image, getUrl, {
      current,
      onDisplay: info => { figure.classList.remove('is-error'); options.onDisplay?.(info); },
      onDiscard: discard,
      onError: error => { owned.forEach(discard); options.onError?.(error); }
    });
  }
  return Object.freeze({ load, cancel, loadManaged, createCache, loadVisible, cancelVisible });
});
