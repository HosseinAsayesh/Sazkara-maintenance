/*
 * Service worker: make the shell instant and fail gracefully offline.
 *
 * The one rule that shapes everything here: NEVER cache a page.
 *
 * Every screen in this app is behind a login and several are behind a role. Caching HTML
 * would mean a technician's phone, or a shared tablet in the workshop, could serve one
 * person's dashboard to the next — and could serve yesterday's fieldwork as though it
 * were current. So HTML always goes to the network, and the only thing the cache offers a
 * failed navigation is a static "you are offline" page that contains no data at all.
 *
 * What IS cached is the part that carries no information: hashed build assets, the font
 * and the brand marks. Those are content-addressed or versioned, identical for every
 * user, and are what actually cost time on a slow connection.
 *
 * Nothing here queues form submissions. Reporting offline is a separate, larger job; the
 * worker deliberately does not touch POSTs, so a submission still fails loudly rather
 * than appearing to succeed and vanishing.
 */

const VERSION = 'v1';
const SHELL = `sazkara-shell-${VERSION}`;
const ASSETS = `sazkara-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';

/** Same-origin prefixes safe to serve cache-first: immutable and user-independent. */
const CACHEABLE = ['/_next/static/', '/fonts/', '/brand/', '/icons/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) =>
        cache.addAll([
          OFFLINE_URL,
          '/fonts/vazirmatn-variable.woff2',
          '/brand/logo.svg',
          '/brand/logo-white.svg',
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that changes state stays entirely out of the worker's hands.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network only. The cache's role is the offline page, nothing more.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL, { cacheName: SHELL }).then(
          (cached) =>
            cached ??
            new Response('offline', { status: 503, headers: { 'content-type': 'text/plain' } }),
        ),
      ),
    );
    return;
  }

  if (!CACHEABLE.some((prefix) => url.pathname.startsWith(prefix))) return;

  event.respondWith(
    caches.match(request, { cacheName: ASSETS }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // An opaque or failed response must not be stored as though it were the asset.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(ASSETS).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

/*
 * Push notifications (lib/push.ts): "an order is finished" for managers and crew leads.
 * The payload is JSON { title, body, url, tag }; tapping opens (or focuses) that page.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'سازکارا', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'سازکارا', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/maskable-192.png',
      dir: 'rtl',
      lang: 'fa',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url === target && 'focus' in w) return w.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
