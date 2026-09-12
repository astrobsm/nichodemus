/**
 * Service worker: makes the application shell available with no network, and
 * is the mechanism by which an installed copy updates itself.
 *
 * It caches ONLY application files - HTML, JavaScript, CSS, the SQLite WASM
 * binary and icons. Patient data lives in OPFS/IndexedDB and is never placed
 * in a cache, never serialised into a request, and never sent anywhere.
 *
 * HOW UPDATING WORKS, AND WHY IT IS SHAPED LIKE THIS
 * -------------------------------------------------
 * BUILD is replaced at build time (scripts/stamp-build.mjs). That is what
 * makes this file's contents differ between deployments, which is the only
 * signal a browser uses to decide a service worker is new. With a fixed
 * cache name and a file that never changed, an installed application served
 * the code it was installed with for ever - which is exactly what it did
 * before this was stamped.
 *
 * The new worker does NOT take over on its own. A nurse may be halfway
 * through entering a blood pressure; swapping the code under her would at
 * best lose the form and at worst break a lazily-loaded chunk mid-save. It
 * installs, waits, tells the page, and the page offers the choice.
 */

const BUILD = '__BUILD__'
const CACHE = `nug-outreach-${BUILD}`

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sql-wasm-browser.wasm',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // reload bypasses the HTTP cache: a shell taken from it could be the
      // very copy this update exists to replace.
      cache
        .addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))
        .catch(() => cache.addAll(SHELL).catch(() => undefined)),
    ),
    // Deliberately no skipWaiting() here. See the note above.
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('nug-outreach-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data) return

  // The page has decided it is safe to swap - nothing unsaved on screen.
  if (data.type === 'SKIP_WAITING') self.skipWaiting()

  // Which build is actually in charge of this page. Answered on the port the
  // asker supplied when there is one - event.source is null for a message
  // sent through a MessageChannel, so replying only to it would answer
  // nothing at all.
  if (data.type === 'BUILD?') {
    const reply = { type: 'BUILD', build: BUILD }
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply)
    else if (event.source) event.source.postMessage(reply)
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Only ever serve our own origin. Nothing else should be requested at all.
  if (url.origin !== self.location.origin) return

  // The API is never cached: a stale sync, sign-in or version answer is worse
  // than no answer, and those calls only run when there is a connection.
  if (url.pathname.startsWith('/api/')) return

  // Navigations: serve the cached shell first so the app opens instantly and
  // works with the device in flight mode. Freshness is not this path's job -
  // the worker update above handles it, with no network wait on launch.
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
