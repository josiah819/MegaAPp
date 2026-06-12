/* WoodsOS service worker — keeps the shell installable and snappy.
   Strategy: network-first for navigations (fresh app, offline fallback),
   stale-while-revalidate for static assets, API always straight through.
   Round 3: web push — notifications mirror to the lock screen. */
const VERSION = 'woodsos-v3'
const SHELL = ['/', '/manifest.webmanifest', '/brand/logo-colour.png', '/brand/logo-stacked-white.png']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return // live data only — never cache

  // App navigations: try the network, fall back to the cached shell offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone()
          caches.open(VERSION).then(c => c.put('/', copy)).catch(() => {})
          return r
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Hashed assets, brand images, fonts, the 3D map: cache, refresh in the background
  if (/^\/(assets|brand|map3d)\//.test(url.pathname) || /\.(png|svg|webp|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        const fresh = fetch(e.request).then(r => {
          if (r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone())).catch(() => {})
          return r
        }).catch(() => hit)
        return hit || fresh
      })
    )
  }
})

/* ---- web push ---- */
self.addEventListener('push', e => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { title: 'WoodsOS', body: e.data?.text() || '' } }
  e.waitUntil(self.registration.showNotification(data.title || 'WoodsOS', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { link: data.link || '/' },
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const link = e.notification.data?.link || '/'
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.navigate(link); return c.focus() }
    }
    return clients.openWindow(link)
  }))
})
