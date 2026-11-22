// Service worker simples: sempre busca na internet. Só usa a cópia guardada se estiver sem conexão.
const CACHE = 'termometro-v25';
const BASE = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'assets/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(url.pathname.endsWith('/') ? 'index.html' : e.request, { ignoreSearch: true })
        .then((r) => r || caches.match('index.html')))
  );
});
