const CACHE_NAME = 'learning-trainer-v4';

const CORE_URLS = [
  '/words',
  '/words/',
  '/chess',
  '/chess/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/words/topics.json',
  '/words/rules.json',
  '/words/exercises.json',
  '/words/topics/calendar-study.json',
  '/words/topics/cinema-theater.json',
  '/words/topics/city-hotel-post-currency.json',
  '/words/topics/excursion.json',
  '/words/topics/family.json',
  '/words/topics/food.json',
  '/words/topics/house-apartment.json',
  '/words/topics/lesson.json',
  '/words/topics/personal-contacts.json',
  '/words/topics/seasons.json',
  '/words/topics/shopping-department-store.json',
  '/words/topics/sport.json',
  '/words/topics/travel.json',
  '/words/topics/visit-to-the-doctor.json',
  '/chess/openings.json',
  '/chess/openings/caro-kann.json',
  '/chess/openings/french-defense.json',
  '/chess/openings/italian-game.json',
  '/chess/openings/london-system.json',
  '/chess/openings/queens-gambit.json',
  '/chess/openings/ruy-lopez.json',
  '/chess/openings/scandinavian-defense.json',
  '/chess/openings/sicilian-defense.json',
  '/chess/sidelines.json',
  '/chess/theory.ru.json'
];

async function cacheResponse(cache, url) {
  try {
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) return;
    await cache.put(url, response.clone());

    if (response.headers.get('content-type')?.includes('text/html')) {
      const html = await response.text();
      const assetUrls = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
        .map((match) => new URL(match[1], self.location.origin))
        .filter((assetUrl) => assetUrl.origin === self.location.origin)
        .map((assetUrl) => assetUrl.pathname);
      await Promise.all(assetUrls.map((assetUrl) => cacheResponse(cache, assetUrl)));
    }
  } catch {
    // A partial cache is still useful; missing files can be retried next visit.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(CORE_URLS.map((url) => cacheResponse(cache, url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () =>
          (await caches.match(event.request, { ignoreSearch: true }))
          || (await caches.match('/words'))
        )
    );
    return;
  }

  // Content JSON changes independently of the application shell. Prefer the
  // network so an installed PWA does not keep rendering an older lesson list.
  if (requestUrl.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkUpdate = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        });
      return cached || networkUpdate;
    })
  );
});
