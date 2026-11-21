// Guarda o "esqueleto" do site para abrir rápido e funcionar sem internet.
// Os dados (data/site.json) sempre vêm da internet primeiro.
const CACHE = 'termometro-v1';
const BASE = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'assets/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // rede primeiro; se falhar, usa a cópia guardada
  e.respondWith(
    fetch(e.request).then((r) => {
      const copia = r.clone();
      if (r.ok) caches.open(CACHE).then((c) => c.put(e.request.url.split('?')[0], copia));
      return r;
    }).catch(() => caches.match(e.request.url.split('?')[0]).then((r) => r || caches.match('index.html')))
  );
});
