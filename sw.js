// ── sw.js — Service Worker corregido ────────────────────────────────────────
const CACHE_NAME = 'censo-mascotas-v6';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/auth.js',
  './js/api.js',
  './js/geo.js',
  './js/camera.js',
  './js/sync.js',
  './pages/personas.html',
  './pages/duenos.html',
  './pages/mascotas.html',
  './pages/censo.html',
  './pages/mapa.html',
  './pages/registro.html',
  './assets/icons/chuchu.jpeg',
  './assets/icons/app-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-72.png',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando v6...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activado v6');
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: Cache-first para assets, Network-first para API ───────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API GET: red primero, caché como fallback
  if (url.pathname.includes('/api/') && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request.clone())
        .then((response) => {
          if (response && response.ok) {
            // Clonar PRIMERO, devolver el clon al cache y el original al navegador
            const responseParaCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseParaCache));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ error: 'Sin conexión. Datos guardados localmente.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // Recursos estáticos: caché primero, luego red
  const shouldCache = ['.html','.js','.css','.json','.png','.jpg','.jpeg','.svg','.webp','.woff2','.woff']
    .some(ext => url.pathname.endsWith(ext));

  if (shouldCache) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const responseParaCache = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, responseParaCache));
          }
          return response;
        }).catch(() => {
          if (event.request.destination === 'document' || url.pathname.endsWith('.html')) {
            return caches.match('./index.html');
          }
          return new Response('Sin conexión', { status: 503 });
        });
      })
    );
    return;
  }
});

// ── PUSH: notificaciones push — corregido (una sola llamada a showNotification)
self.addEventListener('push', (event) => {
  console.log('[SW] Push recibido');

  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { titulo: '¡Nuevo censo!', cuerpo: event.data?.text() || '' };
  }

  // Soporta formato propio {titulo, cuerpo, url, censoId}
  // y formato genérico web-push {notification: {title, body, data}}
  const notif     = payload.notification || {};
  const titulo    = payload.titulo  || notif.title  || '¡Nuevo censo registrado!';
  const cuerpo    = payload.cuerpo  || notif.body   || 'Se registró un nuevo censo de mascotas';
  const icon      = payload.icon    || notif.icon   || 'assets/icons/icon-192.png';
  const badge     = payload.badge   || notif.badge  || 'assets/icons/icon-72.png';
  const censoId   = payload.censoId || notif.data?.censoId || '';
  const urlDestino = payload.url    || notif.data?.url
    || (censoId ? `pages/mapa.html?censoId=${censoId}` : 'pages/mapa.html');

  // FIX: una única llamada a showNotification (antes había dos anidadas)
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body:    cuerpo,
      icon,
      badge,
      vibrate: [200, 100, 200],
      data:    { url: urlDestino, censoId },
      actions: [
        { action: 'ver',    title: 'Ver censo' },
        { action: 'cerrar', title: 'Cerrar'    },
      ],
    })
  );
});

// ── NOTIFICATION CLICK ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'cerrar') return;

  const censoId   = event.notification.data?.censoId || '';
  const base      = self.registration.scope;
  const destino   = censoId
    ? `${base}pages/mapa.html?censoId=${censoId}`
    : `${base}pages/mapa.html`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Buscar si ya hay una ventana con mapa.html abierta
      const mapaCliente = clientList.find(c => c.url.includes('mapa.html'));
      if (mapaCliente) {
        // Ya está abierta: navegar a la URL con censoId y enfocar
        return mapaCliente.navigate(destino).then(c => c ? c.focus() : mapaCliente.focus());
      }
      // Buscar cualquier ventana de la app y navegar
      const appCliente = clientList.find(c => c.url.startsWith(base) && 'navigate' in c);
      if (appCliente) {
        return appCliente.navigate(destino).then(c => c ? c.focus() : appCliente.focus());
      }
      // No hay ventana abierta: abrir una nueva
      return clients.openWindow(destino);
    })
  );
});

// ── BACKGROUND SYNC ──────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-censos') {
    console.log('[SW] Background sync: notificando clientes...');
    event.waitUntil(notificarClientesSync());
  }
});

async function notificarClientesSync() {
  const allClients = await clients.matchAll({ type: 'window' });
  for (const client of allClients) {
    client.postMessage({ tipo: 'SYNC_REQUIRED' });
  }
}
