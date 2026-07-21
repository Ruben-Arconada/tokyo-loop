// Minimal offline-capable service worker for Yamanote Fun.
// Strategy: network-first for navigations (so deploys land immediately),
// stale-while-revalidate for same-origin assets (hashed by Vite, so a cached
// asset is always the right version for the page that requested it).
const CACHE = 'yamanote-fun-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
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
