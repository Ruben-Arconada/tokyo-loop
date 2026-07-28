// Offline-capable service worker for Japan Loop.
//
// TEMPLATE. The build (see the swGeneration plugin in vite.config.ts) fills in
// the generation id and the asset list and emits the real sw.js, so the worker
// can never disagree with the bundle that shipped and nobody has to remember
// to bump a cache name by hand.
//
// The values are baked IN rather than fetched at runtime. A first attempt read
// them from a generated manifest over the network, and it failed the offline
// test immediately: a service worker is killed and restarted constantly, and a
// restarted one with no network could not even learn the name of its own cache
// — so it served nothing at all. Anything the worker needs in order to answer
// a request offline has to live inside the worker.
//
// CacheStorage is scoped to the ORIGIN, not the path, and every one of our
// projects lives under ruben-arconada.github.io — Abismo and Abismo 2 share
// this namespace. Cache names therefore carry a project prefix, and the sweep
// in activate() may only ever touch keys wearing it. A plain
// `keys.filter(k => k !== CACHE)` deletes the neighbours' offline caches; it
// did, for months. See AGENTS.md.
const CACHE_PREFIX = 'tokyo-loop-'
/** Replaced at build time with a hash of this build's asset names. */
const GENERATION = '__GENERATION__'
/** Replaced at build time with the files this build actually emitted. */
const ASSETS = __ASSETS__
const CACHE = CACHE_PREFIX + GENERATION

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      try {
        // ORDER MATTERS. Every bundle is stored FIRST; the HTML that points
        // at them goes in last. If a bundle fails, addAll rejects, install
        // fails, and the previous generation keeps serving — instead of
        // leaving a page cached that asks for scripts nobody has. An
        // interrupted update costs you the update, never the working copy.
        await cache.addAll(ASSETS.map((f) => `./${f}`))
        const shell = await fetch('./index.html', { cache: 'no-cache' })
        if (!shell.ok) throw new Error(`index.html: ${shell.status}`)
        await cache.put('./index.html', shell.clone())
        await cache.put('./', shell.clone())
        await cache.add('./manifest.webmanifest')
      } catch (err) {
        // caches.open() has already created the generation by the time a
        // download fails, so a half-deployed update would leave an empty
        // cache sitting there until some later activate() swept it. Drop it
        // now: a failed install should leave no trace at all.
        await caches.delete(CACHE)
        throw err
      }
      // Only now is this generation complete and safe to switch to.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          // Our own superseded generations, and nothing else on this origin.
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(event.request)
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone())
          return res
        })
        .catch(() => null)
      // Navigations prefer fresh HTML so a deploy lands at once; hashed assets
      // serve instantly from cache. Either way the cached copy is the
      // fallback, which is what makes this work with no network at all.
      if (event.request.mode === 'navigate') return (await network) || cached || Response.error()
      return cached || (await network) || Response.error()
    })(),
  )
})
