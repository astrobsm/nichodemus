/**
 * Service worker: makes the application shell available with no network.
 *
 * It caches ONLY application files - HTML, JavaScript, CSS, the SQLite WASM
 * binary and icons. Patient data lives in OPFS/IndexedDB and is never placed
 * in a cache, never serialised into a request, and never sent anywhere.
 */

const CACHE = 'nug-outreach-v1'
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sql-wasm-browser.wasm',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Only ever serve our own origin. Nothing else should be requested at all.
  if (url.origin !== self.location.origin) return

  // Navigations: serve the cached shell first so the app opens instantly and
  // works with the device in flight mode.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(
        (cached) =>
          cached ??
          fetch(request).catch(() => caches.match('./') ?? new Response('Offline', { status: 503 })),
      ),
    )
    return
  }

  // Everything else: cache first, then network, storing what we fetch.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached ?? new Response('Offline', { status: 503 }))
    }),
  )
})
