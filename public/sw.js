// Minimal offline-capable service worker for Tokyo Loop.
// Strategy: network-first for navigations (so deploys land immediately),
// stale-while-revalidate for same-origin assets (hashed by Vite, so a cached
// asset is always the right version for the page that requested it).
const CACHE = 'tokyo-loop-v1'

// Precached at install time so the app is truly offline-capable right after
// the FIRST visit — previously install() only called skipWaiting() and left
// caching entirely to runtime fetch interception, which never fires for a
// page's own first load (a page isn't "controlled" by a service worker
// until the NEXT navigation after it activates), so the shell and bundle
// were never guaranteed cached until a second visit.
const PRECACHE_URLS = ['.', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(PRECACHE_URLS)
      // Pull in the actual hashed JS/CSS bundle too. There's no build-time
      // asset manifest here (this file is hand-written, not generated), so
      // instead parse index.html itself for same-origin script/style URLs —
      // cheap, dependency-free, and correct as long as Vite keeps emitting
      // a plain <script src> / <link href>.
      try {
        const res = await fetch('./index.html')
        await cache.put('./index.html', res.clone())
        const html = await res.text()
        const urls = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1])
        if (urls.length) await cache.addAll(urls)
      } catch {
        // Best-effort — the runtime fetch handler below still fills the
        // cache in on the next visit if this one failed offline/mid-flight.
      }
      await self.skipWaiting()
    })(),
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
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin) return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone())
          return res
        })
        .catch(() => cached)
      // Navigations prefer fresh HTML; assets serve instantly from cache.
      return event.request.mode === 'navigate' ? network : cached || network
    }),
  )
})
