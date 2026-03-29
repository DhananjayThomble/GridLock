// GridLock Service Worker — cache-first for assets, network-first for HTML
const CACHE_NAME = 'gridlock-v3';

// Derive base path from SW scope to support sub-path deployments (e.g. /beta)
const BASE_PATH = new URL('./', self.registration?.scope || self.location.href).pathname;
const STATIC_ASSETS = [BASE_PATH, `${BASE_PATH}index.html`];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: purge ALL caches so stale hashed assets are dropped on deploy
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gridlock-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => caches.open(CACHE_NAME))
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.clients.claim())
  );
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
        .catch(() => caches.match(`${BASE_PATH}index.html`))
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
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Try to find a tab already at the target URL
        for (const client of windowClients) {
          if (client.url === targetUrl) {
            return client.focus();
          }
        }
        // Navigate first same-origin tab to targetUrl
        for (const client of windowClients) {
          if (new URL(client.url).origin === self.location.origin) {
            return client.navigate(targetUrl).then((c) => c.focus());
          }
        }
        // No existing tabs — open a new window
        return clients.openWindow(targetUrl);
      })
  );
});
