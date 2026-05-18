import { useState, useEffect, useCallback } from 'react';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';

/**
 * Converts a base64url-encoded VAPID public key to a Uint8Array
 * required by PushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * Detect whether the current window is running as an installed PWA (home-screen icon).
 * `display-mode: standalone` is the cross-browser signal; `navigator.standalone` is the
 * iOS-only variant Safari exposes. Returns 'UNKNOWN' on the server / pre-hydration.
 */
export type InstallMode = 'STANDALONE' | 'BROWSER' | 'UNKNOWN';
export function detectInstallMode(): InstallMode {
  if (typeof window === 'undefined') return 'UNKNOWN';
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? 'STANDALONE' : 'BROWSER';
}

/**
 * Mirror Mode is strictly view-only — every tRPC mutation rejects with FORBIDDEN while
 * `mirroredBy` is set on the session, including this push install-mode heartbeat. Skip the
 * fetch entirely when the global mirror flag is on (DashboardLayout sets `data-mirror="1"`
 * on `<html>`). Same convention as `useAgentStateBroadcast`. See CLAUDE.md → Mirror Mode.
 */
function isMirroring(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.mirror === '1';
}

export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface UsePushSubscriptionResult {
  isSupported: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  isSubscribed: boolean;
  permissionState: PermissionState;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

/**
 * Per-user, per-endpoint memo of the last-saved push subscription payload
 * stored in `localStorage`. Used by `saveSubscriptionToDb` and the install-mode
 * heartbeat to skip a redundant POST when nothing has changed.
 *
 * The key is scoped by user id so a different account signing in on the same
 * device still gets its row inserted on first mount even when the browser-level
 * `PushSubscription` (endpoint/keys) is identical.
 */
function pushSubLastSentKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `yannis:pushsub:lastSent:${userId}`;
}

function pushInstallModeLastSentKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `yannis:pushsub:lastInstallMode:${userId}`;
}

function readLocalStorage(key: string | null): string | null {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string | null, value: string): void {
  if (!key || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota or privacy mode — soft-fail, the next mount will retry */
  }
}

export function usePushSubscription(userId?: string | null): UsePushSubscriptionResult {
  const [isSupported, setIsSupported] = useState(false);
  const [iosDevice, setIosDevice] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionState>('default');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    const ios = isIOS();
    const standalone =
      !!('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone) ||
      window.matchMedia('(display-mode: standalone)').matches;

    setIsSupported(supported);
    setIosDevice(ios);
    setIsStandalone(standalone);

    if (!supported) {
      setPermissionState('unsupported');
      return;
    }

    // Map Notification.permission to our PermissionState type
    const perm = Notification.permission as PermissionState;
    setPermissionState(perm === 'default' || perm === 'granted' || perm === 'denied' ? perm : 'default');

    // Check if already subscribed, and heartbeat the current install mode so the dashboard
    // tracks installs/uninstalls between sessions without requiring a fresh subscribe.
    // The heartbeat is guarded by a per-user `localStorage` memo so we don't POST on every
    // navigation when nothing has changed (the previous behavior added ~1.9s per warm nav).
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => {
        if (sub) {
          setIsSubscribed(true);
          const mode = detectInstallMode();
          if (mode !== 'UNKNOWN' && !isMirroring()) {
            const key = pushInstallModeLastSentKey(userId);
            const payload = JSON.stringify({ endpoint: sub.endpoint, installMode: mode });
            if (readLocalStorage(key) === payload) return;
            fetch(`${getBrowserApiBaseUrl()}/trpc/notifications.updatePushInstallMode`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: payload,
            })
              .then((res) => {
                if (res.ok) writeLocalStorage(key, payload);
              })
              .catch(() => {
                // Heartbeat is best-effort; next mount will try again.
              });
          }
        }
      })
      .catch(() => {
        // Service worker not ready yet — ignore
      });
  }, [userId]);

  // When the user installs the PWA mid-session, the `appinstalled` event fires in the
  // browsing context and `display-mode` flips to `standalone`. Push the updated flag
  // immediately so the admin dashboard reflects it without waiting for the next mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    async function pushMode(mode: InstallMode) {
      if (mode === 'UNKNOWN') return;
      if (isMirroring()) return; // Read-only while mirroring; the next mount will retry.
      try {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        if (!sub) return;
        const key = pushInstallModeLastSentKey(userId);
        const payload = JSON.stringify({ endpoint: sub.endpoint, installMode: mode });
        if (readLocalStorage(key) === payload) return;
        const res = await fetch(`${getBrowserApiBaseUrl()}/trpc/notifications.updatePushInstallMode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: payload,
        });
        if (res.ok) writeLocalStorage(key, payload);
      } catch {
        // Best-effort.
      }
    }

    const onInstalled = () => {
      setIsStandalone(true);
      pushMode('STANDALONE');
    };
    window.addEventListener('appinstalled', onInstalled);

    // Some browsers flip display-mode without firing appinstalled (e.g. user manually
    // added to home screen). Watch the media query so we catch that too.
    const mq = window.matchMedia('(display-mode: standalone)');
    const onDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
      pushMode(e.matches ? 'STANDALONE' : 'BROWSER');
    };
    mq.addEventListener('change', onDisplayModeChange);

    return () => {
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener('change', onDisplayModeChange);
    };
  }, [userId]);

  /**
   * Saves a PushSubscription object to the backend DB.
   * Separated so it can be called both after a new subscribe() and on
   * page-load when permission is already granted but the DB row may be missing.
   *
   * Skips the POST entirely when the resolved payload (endpoint + keys + UA + install
   * mode) is byte-identical to the last successful save for this user — `DashboardLayoutInner`
   * fires this on every mount, so without the guard a warm nav between admin pages costs
   * ~1.9s for a write the server would no-op anyway. The cache is per-user so a second
   * account on the same device still gets its row created on first visit.
   */
  const saveSubscriptionToDb = useCallback(
    async (subscription: PushSubscription): Promise<void> => {
      const raw = subscription.toJSON();
      if (!raw?.endpoint || !raw.keys?.auth || !raw.keys?.p256dh) return;
      const body = {
        endpoint: raw.endpoint,
        auth: raw.keys.auth,
        p256dh: raw.keys.p256dh,
        userAgent: navigator.userAgent,
        installMode: detectInstallMode(),
      };
      const payload = JSON.stringify(body);
      const key = pushSubLastSentKey(userId);
      if (readLocalStorage(key) === payload) return;
      const apiBase = getBrowserApiBaseUrl();
      const res = await fetch(`${apiBase}/trpc/notifications.savePushSubscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: payload,
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        const msg = errBody?.error?.message ?? `Failed to save push subscription (${res.status})`;
        console.error('[push] savePushSubscription failed:', res.status, msg, errBody);
        throw new Error(msg);
      }
      writeLocalStorage(key, payload);
      // The server upserts the install-mode column on the same row, so keep the
      // heartbeat memo in sync and avoid a redundant follow-up POST on the next mount.
      writeLocalStorage(
        pushInstallModeLastSentKey(userId),
        JSON.stringify({ endpoint: body.endpoint, installMode: body.installMode }),
      );
    },
    [userId],
  );

  const subscribe = useCallback(async (): Promise<void> => {
    if (!isSupported) throw new Error('Push notifications are not supported in this browser.');

    // Request permission if not already granted
    const currentPermission = Notification.permission;
    if (currentPermission !== 'granted') {
      const permission = await Notification.requestPermission();
      setPermissionState(permission as PermissionState);
      if (permission !== 'granted') {
        throw new Error('Notification permission was denied.');
      }
    }

    const registration = await navigator.serviceWorker.ready;

    // Re-use an existing browser subscription if present — avoids needing VAPID key
    // just to save the endpoint to the DB.
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // No existing subscription — must create one, which requires VAPID key
      const w = window as Window & { __ENV?: Record<string, unknown> };
      const vapidPublicKey = w.__ENV?.VAPID_PUBLIC_KEY;
      if (typeof vapidPublicKey !== 'string' || !vapidPublicKey) {
        throw new Error('VAPID public key is not configured.');
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    await saveSubscriptionToDb(subscription);
    setIsSubscribed(true);
  }, [isSupported, saveSubscriptionToDb]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!isSupported) return;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setIsSubscribed(false);
      return;
    }

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    const res = await fetch(`${getBrowserApiBaseUrl()}/trpc/notifications.removePushSubscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(errBody?.error?.message ?? `Failed to remove push subscription (${res.status})`);
    }

    // Clear the per-user save/heartbeat memo so the next subscribe POSTs a fresh row.
    if (typeof localStorage !== 'undefined') {
      try {
        const subKey = pushSubLastSentKey(userId);
        const modeKey = pushInstallModeLastSentKey(userId);
        if (subKey) localStorage.removeItem(subKey);
        if (modeKey) localStorage.removeItem(modeKey);
      } catch {
        /* ignore */
      }
    }

    setIsSubscribed(false);
    if ('Notification' in window) {
      setPermissionState(Notification.permission as PermissionState);
    }
  }, [isSupported, userId]);

  return {
    isSupported,
    isIOS: iosDevice,
    isStandalone,
    isSubscribed,
    permissionState,
    subscribe,
    unsubscribe,
  };
}
