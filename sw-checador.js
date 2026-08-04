// sw-checador.js — Service worker del Checador Digital
// Cachea el shell para instalabilidad PWA y arranque rápido.
// Los registros de asistencia SIEMPRE requieren conexión (van directo a Supabase).
const CACHE = 'checador-v1';
const SHELL = ['/checador.html', '/manifest-checador.json', '/logo-clicklaboral-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Solo interceptar el shell propio — nunca las llamadas a Supabase ni a otros dominios
  if (url.origin === self.location.origin && SHELL.includes(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
        .catch(() => caches.match(e.request))
    );
  }
});
