// 네트워크 우선 + 오프라인 시 캐시 폴백 (수정 사항이 바로 반영되도록)
const V = 'fc-v1';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'config.js',
  'manifest.webmanifest', 'install.html',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(V).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // API 요청은 건드리지 않음
  e.respondWith(
    fetch(r)
      .then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(r, copy));
        return res;
      })
      .catch(() => caches.match(r).then((m) => m || caches.match('index.html')))
  );
});
