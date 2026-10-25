/* The shell contains no server-rendered user data. APIs and cross-origin traffic are never cached. */
const CACHE = 'almond-shell-v3';
const PAGES = ['/', '/login', '/register'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const assets = new Set();
    for (const path of PAGES) {
      const shell = await fetch(path, { cache: 'reload' });
      if (!shell.ok || shell.redirected) throw new Error('Shell unavailable');
      const html = await shell.clone().text();
      await cache.put(path, shell);
      for (const match of html.matchAll(/(?:src|href)="([^"\s]+)"/g)) {
        if (match[1].startsWith('/_next/static/')) assets.add(match[1]);
      }
    }
    await cache.addAll(['/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', ...assets]);
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('almond-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    // Every cached page boots the same access gate; no personalized HTML is stored.
    event.respondWith(fetch(request).catch(async () => PAGES.includes(url.pathname)
      ? (await caches.match(url.pathname)) || Response.error()
      : Response.error()));
  } else if (url.pathname.startsWith('/_next/static/') || ['/icon.svg', '/icon-192.png', '/icon-512.png'].includes(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) { const cache = await caches.open(CACHE); await cache.put(request, response.clone()); }
      return response;
    })());
  }
});
