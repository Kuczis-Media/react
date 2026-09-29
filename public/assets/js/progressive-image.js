(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChemProgressiveImage = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';
  const jobs = new WeakMap();

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
      if (!current() || (thumbnail && fullReady)) { options.onDiscard?.(url); return; }
      const decoded = image.ownerDocument.createElement('img');
      decoded.decoding = 'async'; decoded.src = url;
      try { if (decoded.decode) await decoded.decode(); }
      catch (error) { options.onDiscard?.(url); throw error; }
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
  return Object.freeze({ load, cancel, loadManaged });
});
