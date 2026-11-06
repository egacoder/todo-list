/**
 * Сервис-воркер: приложение открывается и работает без интернета.
 *
 * Стратегии:
 *  - файлы приложения — «сначала сеть»: онлайн всегда свежая версия,
 *    офлайн — последняя сохранённая копия;
 *  - шрифты Google — «сначала кэш»: они не меняются.
 */

const VERSION = 'v2';
const APP_CACHE = `todo-app-${VERSION}`;
const FONT_CACHE = 'todo-fonts-v1';

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/theme.js',
  './js/app.js',
  './js/store.js',
  './js/sortable.js',
  './js/confetti.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match('./index.html');
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
  }
});
