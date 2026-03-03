/**
 * OpenBridge WebChat — Service Worker
 * Caches the HTML/CSS/JS shell for offline use and handles push notifications.
 */

var CACHE_NAME = 'openbridge-webchat-v1';

// Install: pre-cache the app shell HTML so it loads when offline
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(['/']);
    }),
  );
  self.skipWaiting();
});

// Activate: remove stale caches from previous versions
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k !== CACHE_NAME;
          })
          .map(function (k) {
            return caches.delete(k);
          }),
      );
    }),
  );
  self.clients.claim();
});

// Fetch: cache-first for the main HTML shell so the UI loads offline
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Only intercept the root HTML shell
  if (url.pathname === '/' || url.pathname === '') {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req);
      }),
    );
  }
});

// Push: display a browser notification when a push event is received
self.addEventListener('push', function (event) {
  var data = { title: 'OpenBridge', body: 'New message received' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_) {
      data.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'OpenBridge', {
      body: data.body,
      icon: '/icons/icon-192.png',
    }),
  );
});

// Notification click: focus the existing WebChat tab or open a new one
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    }),
  );
});
