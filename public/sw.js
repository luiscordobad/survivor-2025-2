// public/sw.js
// Service worker mínimo, pensado para no repetir el bug que obligó a un
// kill-switch antes: usa network-first para la navegación (nunca sirve un
// index.html viejo en caché) y cache-first solo para assets estáticos con
// nombre hasheado por Vite. CACHE_VERSION sube en cada release relevante
// para que las pestañas viejas no se queden pegadas a un cache stale.
const CACHE_VERSION = 'survivor-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegación (index.html / rutas de la SPA): siempre red primero, y solo
  // cae a caché si el usuario está offline. Así nunca se queda pegada una
  // versión vieja del bundle.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/', copy));
          return resp;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Assets estáticos (JS/CSS con hash, imágenes): cache-first, se rellena
  // en segundo plano.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
