/**
 * Yannis EOSE — Service Worker
 *
 * Handles:
 * - App shell caching (static assets)
 * - Offline fallback page
 * - Background sync for pending mutations (deliveries, order updates)
 * - Push notification handling
 * - IndexedDB-based offline queue for rider/CS agent workflows
 */

const CACHE_NAME = 'yannis-v1';
const OFFLINE_URL = '/offline';

// Static assets to pre-cache for app shell
const APP_SHELL_ASSETS = [
  '/',
  '/admin',
  '/offline',
  '/assets/yannis-logo1.png',
  '/manifest.webmanifest',
];

// ── Install ─────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pre-cache app shell — don't fail install if some assets aren't available yet
      return Promise.allSettled(
        APP_SHELL_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            // Silently skip assets that fail (e.g., dynamic routes)
          })
        )
      );
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// ── Activate ────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// ── Fetch ───────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (mutations are handled by background sync)
  if (request.method !== 'GET') return;

  // Skip API calls and tRPC requests — don't cache dynamic data
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/trpc')) return;

  // Skip socket.io requests
  if (url.pathname.startsWith('/socket.io')) return;

  // Network-first for HTML pages (always try to get fresh content)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful HTML responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline — try cache, then fallback
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return caches.match(OFFLINE_URL).then((offlinePage) => {
              if (offlinePage) return offlinePage;
              return new Response('You are offline', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' },
              });
            });
          });
        })
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, images, fonts)
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }
});

// ── IndexedDB Helpers ───────────────────────────────────────────

const DB_NAME = 'yannis_sync';
const SYNC_STORE = 'pending_actions';
const DB_VERSION = 1;

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        const store = db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('type', 'type');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllPendingActions() {
  const db = await openSyncDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const req = tx.objectStore(SYNC_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deletePendingAction(id) {
  const db = await openSyncDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    tx.objectStore(SYNC_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Background Sync ─────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'yannis-sync') {
    event.waitUntil(syncPendingActions());
  }
});

async function syncPendingActions() {
  try {
    const actions = await getAllPendingActions();

    for (const action of actions) {
      try {
        const response = await fetch(action.url, {
          method: action.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(action.headers || {}),
          },
          body: action.body ? JSON.stringify(action.body) : undefined,
          credentials: 'include',
        });

        if (response.ok) {
          await deletePendingAction(action.id);

          // Notify all clients of successful sync
          const clients = await self.clients.matchAll();
          clients.forEach((client) => {
            client.postMessage({
              type: 'SYNC_COMPLETE',
              actionType: action.type,
              data: action.body,
            });
          });
        } else if (response.status < 500) {
          // Client error — remove from queue (retrying won't help)
          await deletePendingAction(action.id);
        }
        // 5xx errors — leave in queue for next sync attempt
      } catch {
        // Network still down — leave in queue
      }
    }
  } catch {
    // IndexedDB error — nothing we can do
  }
}

// ── Push Notifications ──────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Yannis EOSE', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/assets/yannis-logo1.png',
    badge: '/assets/yannis-logo1.png',
    tag: payload.tag || 'yannis-notification',
    data: payload.data || {},
    actions: payload.actions || [],
    vibrate: [200, 100, 200],
    requireInteraction: payload.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Yannis EOSE', options)
  );
});

// ── Notification Click ──────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/admin';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If there's already a window open, focus it and navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: targetUrl,
            data: event.notification.data,
          });
          return;
        }
      }
      // No window open — open a new one
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Message Handler (from main thread) ──────────────────────────

self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CACHE_URLS':
      // Pre-cache specific URLs (e.g., rider's assigned deliveries)
      if (Array.isArray(event.data.urls)) {
        caches.open(CACHE_NAME).then((cache) => {
          event.data.urls.forEach((url) => {
            cache.add(url).catch(() => {});
          });
        });
      }
      break;

    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME).then(() => {
        caches.open(CACHE_NAME);
      });
      break;
  }
});
