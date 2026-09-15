// NextMed Media & Asset Service Worker (Offline & Instant Streaming Engine)
'use strict';

const CACHE_NAME = 'nextmed-media-v1';
const MEDIA_URL_PATTERN = /\/\.netlify\/functions\/content-media/;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept content-media binary requests
  if (MEDIA_URL_PATTERN.test(url.pathname) && event.request.method === 'GET') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (error) {
          if (cachedResponse) return cachedResponse;
          throw error;
        }
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PREFETCH_MEDIA' && Array.isArray(event.data.urls)) {
    caches.open(CACHE_NAME).then((cache) => {
      event.data.urls.forEach((url) => {
        cache.match(url).then((existing) => {
          if (!existing) {
            fetch(url, { credentials: 'same-origin' }).then((res) => {
              if (res.ok) cache.put(url, res);
            }).catch(() => {});
          }
        });
      });
    });
  }
});

