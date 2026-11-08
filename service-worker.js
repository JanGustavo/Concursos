const CACHE_NAME = 'tjpb-estudo-v18';
const PRECACHE_URLS = [
  '/',
  '/?view=questoes',
  '/tjpb-mapa-estudo.html',
  '/relatorio_visual_fgv_ti_tribunais.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Conteúdos privados do Drive e respostas autenticadas nunca entram no cache offline.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/biblioteca/') || url.pathname === '/support/pix') return;
  // Always refresh the application document; retain a cached copy for offline study.
  // Otherwise a cached HTML can keep showing old configuration screens after a deploy.
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(fetch(event.request, {cache: 'no-store'}).then(async response => {
      if (response.ok) {
        try { const cache = await caches.open(CACHE_NAME); await cache.put(event.request, response.clone()); } catch {}
      }
      return response;
    }).catch(async () => (await caches.match(event.request)) || (await caches.match('/')) || new Response('Sem conexão. Abra o aplicativo uma vez com internet para preparar o modo offline.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
    return;
  }
  // Small static assets may be read from cache while the next version is fetched.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);
      return cachedResponse || fetchPromise;
    })
  );
});
