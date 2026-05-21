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

// `__BUILD_ID__` is replaced at build time by scripts/inject-sw-build-id.mjs
// with the git SHA + a build timestamp. This is what makes a routine deploy
// change the bytes of /sw.js — without it the browser never sees a "new"
// service worker, `updatefound` never fires, and the in-app update modal
// (dashboard-layout.tsx) can never appear. In dev the placeholder is left
// as-is (harmless — the SW is unregistered on localhost in root.tsx).
const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = 'yannis-' + BUILD_ID;
const OFFLINE_URL = '/offline';

// Static assets to pre-cache for app shell
const APP_SHELL_ASSETS = [
  '/',
  '/admin',
  '/offline',
  '/assets/yannis-logo1.png',
  '/assets/favicon-32.png',
  '/assets/icon-180.png',
  '/assets/icon-192.png',
  '/assets/icon-512-maskable.png',
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
  // Do NOT call skipWaiting() — let the old SW finish before this one takes over.
  // skipWaiting() causes clients.claim() to fire on open tabs mid-session, which
  // interrupts in-flight requests and triggers reload loops.
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
    const docRequest = new Request(request, { cache: 'no-store' });
    event.respondWith(
      fetch(docRequest)
        .then((response) => {
          // Don't cache document responses — hard refresh should always refetch
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

  const data = payload.data || {};
  const logId = data.logId;

  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'yannis-notification',
    data: data,
    actions: payload.actions || [],
    vibrate: [200, 100, 200],
    requireInteraction: payload.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Yannis EOSE', options).then(() => {
      const tasks = [];

      // Ack shown — ping delivery log
      if (logId) {
        tasks.push(
          fetch('/push/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logId, event: 'shown' }),
          }).catch(() => {})
        );
      }

      // Notify any open tabs: play sound + refresh in-app notification bell
      tasks.push(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
          clientList.forEach((client) => {
            client.postMessage({ type: 'PLAY_NOTIFICATION_SOUND' });
            // Triggers an in-app notification bell refresh so the unread count updates
            client.postMessage({
              type: 'PUSH_NOTIFICATION_RECEIVED',
              title: payload.title,
              body: payload.body,
              data: data,
            });
          });
        })
      );

      return Promise.all(tasks);
    })
  );
});

// ── Notification Click ──────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Only navigate to a specific deep link — if no url in payload, just focus the app without redirecting
  const targetUrl = event.notification.data?.url || null;
  const logId = event.notification.data?.logId;

  event.waitUntil(
    Promise.all([
      // Ack clicked — ping delivery log
      logId
        ? fetch('/push/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logId, event: 'clicked' }),
          }).catch(() => {})
        : Promise.resolve(),

      // Open or focus app window — navigate to deep link only if one exists
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            if (targetUrl) {
              client.postMessage({
                type: 'NOTIFICATION_CLICK',
                url: targetUrl,
                data: event.notification.data,
              });
            }
            return;
          }
        }
        // No open tab — open the app at the deep link or home
        return self.clients.openWindow(targetUrl || '/admin');
      }),
    ])
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
