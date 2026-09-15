// NextMed Service Worker Registration & Media Prefetch API
(function initNextMedServiceWorker(root) {
  'use strict';

  if (!root || !('serviceWorker' in root.navigator)) return;

  function register() {
    root.navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // SW registration failure is non-blocking
    });
  }

  if (root.document && root.document.readyState === 'complete') {
    register();
  } else if (root.addEventListener) {
    root.addEventListener('load', register);
  }

  function prefetchMediaUrls(urls) {
    if (!Array.isArray(urls) || !urls.length) return;
    if (root.navigator.serviceWorker.controller) {
      root.navigator.serviceWorker.controller.postMessage({
        type: 'PREFETCH_MEDIA',
        urls: urls.filter((u) => typeof u === 'string')
      });
    }
  }

  root.NextMedServiceWorker = Object.freeze({
    prefetchMediaUrls
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);

