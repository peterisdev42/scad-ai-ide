/* Runtime cache exclusively for immutable, versioned, same-origin Demo files.
   No HTML homepage, SEO/GEO, API or cross-origin caching. */
const RELEASE = '__DEMO_RELEASE__';
const PREFIX = 'scad-ai-ide-pages-demo-v1:';
const scope = new URL(self.registration.scope);
const ownedCache = version => PREFIX + scope.pathname + ':' + version;
const releaseRoot = scope.pathname + 'demo/releases/';
const inflight = new Map();
self.addEventListener('install', () => {
  // Do not prefetch the entire 10+ MB Workbench or skipWaiting: old clients
  // may still be using their own immutable release.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name.startsWith(PREFIX + scope.pathname + ':') && name !== ownedCache(RELEASE)).map(name => caches.delete(name)));
    } catch { /* Storage unavailable; normal HTTP still works. */ }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(releaseRoot) || request.headers.has('range')) return;
  const version = url.pathname.slice(releaseRoot.length).split('/')[0];
  if (!/^[a-f0-9]{24}$/.test(version) || !url.pathname.startsWith(releaseRoot + version + '/')) return;
  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(ownedCache(version));
      const hit = await cache.match(request);
      if (hit) return hit;
    } catch { return fetch(request); }
    // Coalesce overlapping cold preload / frame fetches. Every caller gets
    // its own response; a failed or partial response must never be persisted.
    const key = request.url;
    let pending = inflight.get(key);
    if (!pending) {
      pending = (async () => {
        const response = await fetch(request);
        if (response.ok && response.status === 200 && response.type !== 'opaque' && !response.redirected) {
          try { await cache.put(request, response.clone()); } catch { /* Quota or private browsing. */ }
        }
        return response;
      })();
      inflight.set(key, pending);
      pending.finally(() => inflight.delete(key)).catch(() => {});
    }
    return (await pending).clone();
  })());
});
