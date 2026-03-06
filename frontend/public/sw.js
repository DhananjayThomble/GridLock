// GridLock Service Worker — cache-first for assets, network-first for HTML
const CACHE_NAME = 'gridlock-v1';
const STATIC_ASSETS = ['/', '/index.html'];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: purge old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: skip non-cacheable, network-first for HTML, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip: non-GET, socket.io, API, chrome-extension, etc.
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/api') ||
    url.protocol === 'chrome-extension:'
  ) {
    return;
  }

  // Navigation (HTML): network-first, fallback to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts): cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only cache successful same-origin responses
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'GridLock', {
      body: data.body || '',
      icon: '/logo192.png',
      badge: '/badge72.png',
      data: { url: data.url || '/' },
      tag: data.tag || 'gridlock',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Focus existing tab if found
        for (const client of windowClients) {
          if (new URL(client.url).origin === self.location.origin) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});
