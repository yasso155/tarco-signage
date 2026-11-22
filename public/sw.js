// Network-first cache so a screen can reload itself even if the internet drops for a while.
const CACHE = 'tarco-signage-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || !/^https?:/.test(r.url)) return;
  if (/firestore\.googleapis\.com|identitytoolkit|securetoken|firebasestorage\.googleapis\.com|storage\.googleapis\.com/.test(r.url)) return;   // data -> Firestore offline cache; videos (range requests) -> browser HTTP cache
  if (r.headers.has('range')) return;   // audio/video range requests return 206, which the Cache API cannot store
  e.respondWith((async () => {
    try {
      const res = await fetch(r);
      if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(r, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
