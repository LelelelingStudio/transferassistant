/* =========================================================================
   sw.js —— 离线缓存
   策略：静态资源 cache-first + 后台更新；导航请求回退到 index.html
   ========================================================================= */
const VERSION = 'lta-v1.1.0';
const CORE_CACHE = 'lta-core-' + VERSION;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './assets/css/app.css',
  './assets/js/i18n.js',
  './assets/js/store.js',
  './assets/js/log.js',
  './assets/js/record.js',
  './assets/js/net.js',
  './assets/js/registry.js',
  './assets/js/scanner.js',
  './assets/js/transfer.js',
  './assets/js/chat.js',
  './assets/js/bt.js',
  './assets/js/pwa.js',
  './assets/js/settings.js',
  './assets/js/ui.js',
  './assets/js/main.js',
  './assets/vendor/peerjs.min.js',
  './assets/vendor/qrcode-generator.js',
  './assets/vendor/jsQR.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) => {
      // 单个资源失败不能让整次安装失败
      return Promise.all(
        CORE_ASSETS.map((path) =>
          cache.add(new Request(path, { cache: 'reload' })).catch(() => null)
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('lta-core-') && k !== CORE_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'offline-ready' }));
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 信令与外部请求交给网络

  // 导航：先网络，失败回退首页缓存（离线也能打开）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then((res) => res || caches.match('./')).then((res) =>
          res || new Response('离线缓存不可用，请联网后再打开一次。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          })
        )
      )
    );
    return;
  }

  // 其他同源资源：缓存优先，命中后后台静默更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CORE_CACHE).then((cache) => cache.put(req, clone)).catch(() => null);
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
