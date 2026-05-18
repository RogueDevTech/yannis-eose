/**
 * Yannis EOSE — Offline Sync Utility
 *
 * Provides IndexedDB-backed offline queue for mutations.
 * Used by riders (delivery confirmations) and CS closers (queue caching).
 *
 * When offline, actions are saved to IndexedDB.
 * When online, the service worker background sync processes them.
 * Falls back to manual sync if Background Sync API is unavailable.
 */

const DB_NAME = 'yannis_sync';
const SYNC_STORE = 'pending_actions';
const CACHE_STORE = 'cached_data';
const DB_VERSION = 2;

interface PendingAction {
  id?: number;
  type: string;
  url: string;
  method: string;
  body: unknown;
  headers?: Record<string, string>;
  timestamp: string;
  gpsLat?: number;
  gpsLng?: number;
}

interface CachedData {
  key: string;
  data: unknown;
  cachedAt: string;
  expiresAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        const syncStore = db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true });
        syncStore.createIndex('timestamp', 'timestamp');
        syncStore.createIndex('type', 'type');
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Queue Actions for Offline Sync ────────────────────────────

export async function queueAction(action: Omit<PendingAction, 'id' | 'timestamp'>): Promise<void> {
  // Try to get GPS coordinates if available
  let gpsLat: number | undefined;
  let gpsLng: number | undefined;

  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 3000,
          enableHighAccuracy: true,
        });
      });
      gpsLat = pos.coords.latitude;
      gpsLng = pos.coords.longitude;
    } catch {
      // GPS not available — proceed without
    }
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    tx.objectStore(SYNC_STORE).add({
      ...action,
      timestamp: new Date().toISOString(),
      gpsLat,
      gpsLng,
    });
    tx.oncomplete = () => {
      // Request background sync
      requestBackgroundSync();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingActions(): Promise<PendingAction[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const req = tx.objectStore(SYNC_STORE).getAll();
    req.onsuccess = () => resolve(req.result as PendingAction[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const req = tx.objectStore(SYNC_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingAction(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    tx.objectStore(SYNC_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Cached Data (for reading offline) ─────────────────────────

export async function cacheData(key: string, data: unknown, ttlMs: number = 300000): Promise<void> {
  const db = await openDB();
  const entry: CachedData = {
    key,
    data,
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedData<T = unknown>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () => {
      const entry = req.result as CachedData | undefined;
      if (!entry) {
        resolve(null);
        return;
      }
      // Check expiry
      if (new Date(entry.expiresAt) < new Date()) {
        resolve(null);
        return;
      }
      resolve(entry.data as T);
    };
    req.onerror = () => reject(req.error);
  });
}

// ── Background Sync Registration ──────────────────────────────

function requestBackgroundSync(): void {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then((reg) => {
      (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } })
        .sync.register('yannis-sync').catch(() => {
          // Background Sync not supported — fall back to manual sync
          manualSync();
        });
    });
  } else {
    // No Background Sync API — sync manually
    manualSync();
  }
}

// ── Manual Sync Fallback ──────────────────────────────────────

async function manualSync(): Promise<void> {
  if (!navigator.onLine) return;

  const actions = await getPendingActions();
  for (const action of actions) {
    try {
      const response = await fetch(action.url, {
        method: action.method,
        headers: {
          'Content-Type': 'application/json',
          ...(action.headers ?? {}),
        },
        body: action.body ? JSON.stringify(action.body) : undefined,
        credentials: 'include',
      });

      if (response.ok && action.id !== undefined) {
        await removePendingAction(action.id);
      } else if (response.status < 500 && action.id !== undefined) {
        // Client error — won't help to retry
        await removePendingAction(action.id);
      }
    } catch {
      // Still offline — stop trying
      break;
    }
  }
}

// ── Online/Offline Hook ───────────────────────────────────────

export function setupOnlineSync(): () => void {
  const handler = () => {
    // Sync within 30 seconds of reconnection (per CLAUDE.md benchmark)
    setTimeout(() => {
      manualSync();
    }, 1000);
  };

  window.addEventListener('online', handler);
  // Also sync on page load if online
  if (navigator.onLine) {
    manualSync();
  }

  return () => window.removeEventListener('online', handler);
}

// ── Rider-Specific: Queue Delivery Confirmation ───────────────

export async function queueDeliveryConfirmation(params: {
  orderId: string;
  status: 'DELIVERED' | 'PARTIALLY_DELIVERED' | 'RETURNED';
  deliveredQty?: number;
  returnedQty?: number;
  returnReason?: string;
  otp?: string;
  gpsLat?: number;
  gpsLng?: number;
  deliveryFeeAddOn?: number;
  deliveryDiscountAmount?: number;
}): Promise<void> {
  const API_URL = (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__ENV_API_URL)
    ? String((window as unknown as Record<string, unknown>).__ENV_API_URL)
    : 'http://localhost:4444';

  const metadata: Record<string, unknown> = {
    reason: params.returnReason,
    deliveredQuantity: params.deliveredQty,
    returnedQuantity: params.returnedQty,
    otp: params.otp,
    gpsLat: params.gpsLat,
    gpsLng: params.gpsLng,
  };
  if (params.deliveryFeeAddOn !== undefined && params.deliveryFeeAddOn >= 0) {
    metadata.deliveryFeeAddOn = params.deliveryFeeAddOn;
  }
  if (params.deliveryDiscountAmount !== undefined && params.deliveryDiscountAmount >= 0) {
    metadata.deliveryDiscountAmount = params.deliveryDiscountAmount;
  }

  // DELIVERED and PARTIALLY_DELIVERED require HOL approval: submit request instead of direct transition
  const useSubmitRequest = params.status === 'DELIVERED' || params.status === 'PARTIALLY_DELIVERED';

  return queueAction({
    type: 'delivery_confirmation',
    url: useSubmitRequest
      ? `${API_URL}/trpc/logistics.submitDeliveryConfirmation`
      : `${API_URL}/trpc/orders.transition`,
    method: 'POST',
    body: useSubmitRequest
      ? { orderId: params.orderId, newStatus: params.status, metadata }
      : { orderId: params.orderId, newStatus: params.status, metadata },
  });
}

// ── Push Notification Subscription ────────────────────────────

export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;

  // Check existing subscription
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  // Subscribe
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });

  return subscription;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
