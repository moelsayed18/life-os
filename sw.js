/* Life OS service worker: opens instantly and works offline.
   Bump CACHE when you publish a new version so old files are dropped. */
const CACHE = 'lifeos-v4-2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const FONTS = ['https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Instrument+Sans:wght@400;500;600&display=swap'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE).then(() => Promise.all(FONTS.map((f) => c.add(f).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com') return; // never cache sync traffic
  const ok = url.origin === self.location.origin || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!ok) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const nav = req.mode === 'navigate';
      const cached = (await cache.match(req, { ignoreSearch: nav })) || (nav ? await cache.match('./index.html') : undefined);
      const fresh = fetch(req)
        .then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});

/* ---- daily reminder, best-effort even when the app isn't open ----
   The page writes a small status record into IndexedDB ('lifeos-sw' / 'kv' / 'reminder')
   every time it saves. Periodic Background Sync is only supported on some Chromium
   browsers for installed, well-engaged PWAs (mainly Android) - this never fires on
   iOS/Safari or most desktop browsers. When it does fire, it reads that record and
   shows a local notification; it never contacts a server. */
const DB_NAME = 'lifeos-sw', STORE = 'kv';
function idbGet(key) {
  return new Promise((resolve) => {
    try {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore(STORE); } catch (e) {} };
      rq.onsuccess = () => {
        try {
          const tx = rq.result.transaction(STORE, 'readonly');
          const gq = tx.objectStore(STORE).get(key);
          gq.onsuccess = () => resolve(gq.result || null);
          gq.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      };
      rq.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
function idbPut(key, val) {
  return new Promise((resolve) => {
    try {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore(STORE); } catch (e) {} };
      rq.onsuccess = () => {
        try {
          const tx = rq.result.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(val, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      };
      rq.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}
function pad2(n) { return String(n).padStart(2, '0'); }
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'lifeos-daily-check') return;
  e.waitUntil((async () => {
    const rec = await idbGet('reminder');
    if (!rec || !rec.remindOn) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    if (rec.notifiedDate === today) return;
    const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    if (hhmm < (rec.remindTime || '21:00')) return;
    // if the saved status is from an earlier day, the app hasn't been opened today yet -> nothing done today
    const doneToday = rec.date === today ? !!rec.minDone : false;
    if (doneToday) return;
    await self.registration.showNotification('Life OS', {
      body: "You have not checked off today's essentials yet.",
      icon: './icon-192.png', badge: './icon-192.png', tag: 'lifeos-daily', renotify: true
    });
    rec.notifiedDate = today;
    await idbPut('reminder', rec);
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
