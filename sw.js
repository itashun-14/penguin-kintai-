// オフライン対応: アプリ本体はキャッシュから即表示し、裏で最新版に更新する。
// 文字認識の部品(初回のみCDNから取得)もキャッシュして、次回以降は通信なしで使えるようにする。
const VERSION = 'v1';
const CACHE = `penguin-kintai-${VERSION}`;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/calc.js', 'js/holidays.js', 'js/mascot.js', 'js/ocr.js', 'js/parse.js',
  'js/season.js', 'js/sheets.js', 'js/store.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  ...['normal', 'happy', 'worried', 'sleep', 'loupe', 'flag', 'vacation', 'walk'].map((n) => `assets/penguin/${n}.png`),
  ...Array.from({ length: 12 }, (_, i) => `assets/season/${String(i + 1).padStart(2, '0')}.jpg`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('penguin-kintai-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // 先にキャッシュを返し、裏で更新(次に開いたとき最新になる)
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req, { ignoreSearch: true });
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      }),
    );
  } else if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
