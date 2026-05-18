import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPendingCount, setupOnlineSync } from '~/lib/offline-sync';

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

/** Returns true if the browser is online. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Returns the count of pending offline actions. */
export function usePendingCount(): number {
  const [count, setCount] = useState(0);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    let mounted = true;

    const refresh = () => {
      getPendingCount()
        .then((c) => { if (mounted) setCount(c); })
        .catch(() => {});
    };

    refresh();
    // Re-check when online status changes
    const interval = setInterval(refresh, 10000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isOnline]);

  return count;
}

/** Sets up the auto-sync on reconnection. Call once at the app root. */
export function useOfflineSync(): void {
  useEffect(() => {
    return setupOnlineSync();
  }, []);
}
