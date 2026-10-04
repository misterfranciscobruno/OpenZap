/* Service worker mínimo: melhora suporte em alguns browsers e é requisito para PWA / Web Push futuro. */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
