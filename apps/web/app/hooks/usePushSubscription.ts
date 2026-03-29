import { useState, useEffect, useCallback } from 'react';

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

function getApiBase(): string {
  const w = window as Window & { __ENV?: Record<string, unknown> };
  const raw = typeof w.__ENV?.API_URL === 'string' ? w.__ENV.API_URL : 'http://localhost:4444';
  return raw.replace(/\/+$/, '');
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

export function usePushSubscription(): UsePushSubscriptionResult {
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

    // Check if already subscribed
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => {
        if (sub) setIsSubscribed(true);
      })
      .catch(() => {
        // Service worker not ready yet — ignore
      });
  }, []);

  /**
   * Saves a PushSubscription object to the backend DB.
   * Separated so it can be called both after a new subscribe() and on
   * page-load when permission is already granted but the DB row may be missing.
   */
  const saveSubscriptionToDb = useCallback(async (subscription: PushSubscription): Promise<void> => {
    const raw = subscription.toJSON();
    if (!raw?.endpoint || !raw.keys?.auth || !raw.keys?.p256dh) return;
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/trpc/notifications.savePushSubscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        endpoint: raw.endpoint,
        auth: raw.keys.auth,
        p256dh: raw.keys.p256dh,
        userAgent: navigator.userAgent,
      }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const msg = errBody?.error?.message ?? `Failed to save push subscription (${res.status})`;
      console.error('[push] savePushSubscription failed:', res.status, msg, errBody);
      throw new Error(msg);
    }
  }, []);

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

    const res = await fetch(`${getApiBase()}/trpc/notifications.removePushSubscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(errBody?.error?.message ?? `Failed to remove push subscription (${res.status})`);
    }

    setIsSubscribed(false);
    if ('Notification' in window) {
      setPermissionState(Notification.permission as PermissionState);
    }
  }, [isSupported]);

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
