import { useEffect, useRef, useState, useCallback } from 'react';
import { useRevalidator } from '@remix-run/react';
import { io, type Socket } from 'socket.io-client';
import { invalidateCachedLoader } from '~/lib/loader-cache';

interface RealtimeNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

let socketInstance: Socket | null = null;
let connectionCount = 0;

function getSocketBaseUrl(): string {
  // In development, use same origin so cookies are sent (Vite proxies /socket.io → API).
  // In production, use the API_URL directly (same domain or subdomain shares cookies).
  if (typeof window === 'undefined') return '';
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isDev) return window.location.origin;
  const raw = window.__ENV?.API_URL ?? '';
  if (window.location.protocol === 'https:' && raw.startsWith('http://')) {
    return raw.replace(/^http:\/\//, 'https://');
  }
  return raw || window.location.origin;
}

function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(getSocketBaseUrl(), {
      withCredentials: true,
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    // Prevent unhandled errors when API is down or WebSocket fails
    socketInstance.on('connect_error', () => {
      // Connection failed (e.g. API not running) — no need to throw
    });
    socketInstance.on('error', () => {});
  }
  return socketInstance;
}

/**
 * Singleton socket connection. Connects on mount, disconnects when last consumer unmounts.
 */
export function useSocket(): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    connectionCount++;

    if (!socket.connected) {
      socket.connect();
    }

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Set initial state
    setIsConnected(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      connectionCount--;
      if (connectionCount <= 0) {
        socket.disconnect();
        socketInstance = null;
        connectionCount = 0;
      }
    };
  }, []);

  return { isConnected };
}

/**
 * Subscribe to a specific Socket.io event with auto-cleanup.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const listener = (data: T) => handlerRef.current(data);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}

/**
 * Listen for notification:new events, accumulate new notifications since page load.
 * Provides methods to remove individual items (on mark-read) and to prune
 * entries that the server already knows about (after revalidation).
 */
export function useRealtimeNotifications(): {
  realtimeNotifications: RealtimeNotification[];
  realtimeCount: number;
  /** Remove a single realtime notification (e.g. when marked as read). */
  removeRealtimeNotification: (id: string) => void;
  /** Remove all realtime notifications whose ids appear in the given set (server already has them). */
  pruneServerKnown: (serverIds: Set<string>) => void;
  /** Clear all realtime notifications (e.g. on mark-all-read). */
  clearRealtimeNotifications: () => void;
} {
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([]);

  useSocketEvent<RealtimeNotification>('notification:new', (notif) => {
    setNotifications((prev) => {
      // Prevent duplicates (same id arriving twice)
      if (prev.some((n) => n.id === notif.id)) return prev;
      return [notif, ...prev];
    });
  });

  // Also listen for push notifications received via service worker (handles the case where
  // the socket was disconnected or the tab was in the background when the push arrived).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { title?: string; body?: string; data?: Record<string, unknown> };
      if (!detail) return;
      // Inject a synthetic notification entry so the bell count increments.
      // Uses a stable synthetic id so duplicates are filtered if the socket also fires.
      const syntheticId = `push-${detail.data?.logId ?? Date.now()}`;
      const syntheticNotif: RealtimeNotification = {
        id: syntheticId,
        type: (detail.data?.type as string) ?? 'system:info',
        title: detail.title ?? 'New notification',
        body: detail.body ?? null,
        read: false,
        createdAt: new Date().toISOString(),
      };
      setNotifications((prev) => {
        if (prev.some((n) => n.id === syntheticId)) return prev;
        return [syntheticNotif, ...prev];
      });
    };
    window.addEventListener('yannis:push-received', handler);
    return () => window.removeEventListener('yannis:push-received', handler);
  }, []);

  const removeRealtimeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const pruneServerKnown = useCallback((serverIds: Set<string>) => {
    setNotifications((prev) => {
      const next = prev.filter((n) => !serverIds.has(n.id));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  const clearRealtimeNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    realtimeNotifications: notifications,
    realtimeCount: notifications.length,
    removeRealtimeNotification,
    pruneServerKnown,
    clearRealtimeNotifications,
  };
}

/**
 * Returns connection state and a "showGreen" flag for LiveIndicator:
 * yellow blinking (idle) → green (a socket update is being applied) → back to yellow.
 *
 * `showGreen` goes true the moment a relevant event fires and stays true for the
 * WHOLE update — through the page revalidation triggered by `usePageRefreshOnEvent`
 * — then lingers briefly so the user sees it land. It is NOT a fixed timer: the
 * green only clears once the revalidation has actually finished. A safety-net
 * timeout covers pages that listen without an accompanying `usePageRefreshOnEvent`.
 */
export function useLiveIndicator(events: string[]): { isConnected: boolean; showGreen: boolean } {
  const { isConnected } = useSocket();
  const { state: revalidatorState } = useRevalidator();
  const [showGreen, setShowGreen] = useState(false);

  // `pending` = an event arrived and we hold the indicator green until the
  // revalidation it triggered has completed. `sawLoading` confirms a real
  // revalidation cycle ran (loading → idle) before we clear.
  const pendingRef = useRef(false);
  const sawLoadingRef = useRef(false);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Socket event → go green and wait for the revalidation cycle to finish.
  useEffect(() => {
    if (!isConnected) return;
    const socket = getSocket();
    const listener = () => {
      if (lingerRef.current) {
        clearTimeout(lingerRef.current);
        lingerRef.current = null;
      }
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
      pendingRef.current = true;
      sawLoadingRef.current = false;
      setShowGreen(true);
      // Safety net: if no revalidation runs (page has no usePageRefreshOnEvent),
      // don't leave the indicator stuck green forever.
      fallbackRef.current = setTimeout(() => {
        if (pendingRef.current && !sawLoadingRef.current) {
          pendingRef.current = false;
          setShowGreen(false);
        }
      }, 6000);
    };
    events.forEach((event) => socket.on(event, listener));
    return () => {
      events.forEach((event) => socket.off(event, listener));
    };
  }, [events, isConnected]);

  // Hold green through the revalidation; clear it shortly AFTER it completes.
  useEffect(() => {
    if (!pendingRef.current) return;
    if (revalidatorState === 'loading') {
      sawLoadingRef.current = true;
      if (fallbackRef.current) {
        clearTimeout(fallbackRef.current);
        fallbackRef.current = null;
      }
      setShowGreen(true);
    } else if (revalidatorState === 'idle' && sawLoadingRef.current) {
      // Update finished — linger briefly so the green "Updated" state is visible.
      pendingRef.current = false;
      sawLoadingRef.current = false;
      if (lingerRef.current) clearTimeout(lingerRef.current);
      lingerRef.current = setTimeout(() => setShowGreen(false), 1200);
    }
  }, [revalidatorState]);

  useEffect(() => {
    return () => {
      if (lingerRef.current) clearTimeout(lingerRef.current);
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    };
  }, []);

  return { isConnected, showGreen };
}

/**
 * Auto-refresh page data (revalidate Remix loaders) when any of the listed events fire.
 * Debounces by 500ms to avoid rapid-fire revalidations.
 * Only revalidates when socket is connected so we don't trigger loaders while API is unreachable.
 * Uses a ref for revalidate to avoid effect re-runs when revalidator identity changes (prevents refetch loops).
 */
export function usePageRefreshOnEvent(events: string[]): void {
  const { revalidate } = useRevalidator();
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isConnected } = useSocket();

  useEffect(() => {
    if (!isConnected) return;
    const socket = getSocket();
    const listener = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        // Bust this page's client loader cache BEFORE revalidating. Routes that
        // use `cachedClientLoader` would otherwise serve the stale cached
        // payload to this socket-triggered `revalidate()` — so the live event
        // would not actually refresh the page. Clearing the entry forces the
        // revalidation to hit the server and fetch fresh data.
        if (typeof window !== 'undefined') {
          invalidateCachedLoader(window.location.pathname);
        }
        revalidateRef.current();
      }, 500);
    };

    events.forEach((event) => socket.on(event, listener));

    return () => {
      events.forEach((event) => socket.off(event, listener));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [events, isConnected]);
}

/**
 * Polling fallback for when the socket is disconnected.
 * Revalidates the Remix loader every `intervalMs` (default 30s) while disconnected.
 * Stops automatically when the socket reconnects.
 */
export function usePollingFallback(intervalMs = 30_000): void {
  const { revalidate } = useRevalidator();
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  const { isConnected } = useSocket();

  useEffect(() => {
    if (isConnected) return; // socket is healthy — no polling needed
    const id = setInterval(() => revalidateRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [isConnected, intervalMs]);
}

/**
 * Sales Closer — broadcasts current UI state for Team Live View.
 * Call this in route components for Sales closers. Only emits if the socket is connected.
 *
 * Mirror Mode: when `<html data-mirror="1">` is set by DashboardLayout, the broadcast is
 * skipped. An admin viewing the app as a Sales closer would otherwise pollute the supervisor
 * mirror view — and Mirror Mode is contractually view-only.
 */
export function useAgentStateBroadcast(state: {
  currentRoute: string;
  currentOrderId?: string | null;
  currentPanel?: string | null;
}): void {
  const { isConnected } = useSocket();

  useEffect(() => {
    if (!isConnected) return;
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-mirror') === '1') {
      return;
    }
    const socket = getSocket();
    socket.emit('agent:state_update', state);
  }, [isConnected, state.currentRoute, state.currentOrderId, state.currentPanel]);
}

/**
 * Force-logout on `auth:session_revoked` server event. The server emits this
 * to the user's room when their account is deactivated (or when an admin
 * kills their sessions explicitly). The session is already revoked server-
 * side — this hook handles the browser-side cleanup so the user can't keep
 * clicking around in already-rendered UI:
 *   1. Best-effort POST `/auth/logout` so the cookie is cleared via Set-Cookie
 *      (the server session is already dead, but this drops the client cookie
 *      so future tab opens don't reuse it).
 *   2. Hard navigation to `/auth?reason=deactivated` which ends the SPA
 *      session entirely (Remix loaders re-run from scratch).
 *
 * Fired exactly once per mount so a hot socket reconnect that replays the
 * event doesn't cause an infinite redirect loop.
 */
export function useForceLogoutOnRevoke(): void {
  const handledRef = useRef(false);
  useSocketEvent<{ reason?: string }>('auth:session_revoked', (data) => {
    if (handledRef.current) return;
    handledRef.current = true;
    const reason = data?.reason ?? 'revoked';
    // Fire-and-forget logout POST to clear the cookie. We don't await — the
    // hard navigation below races it, but the server has already revoked the
    // session row + Redis key, so cookie cleanup is the only remaining step
    // and it's idempotent.
    if (typeof window !== 'undefined' && window.fetch) {
      window.fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }
    if (typeof window !== 'undefined') {
      window.location.assign(`/auth?reason=${encodeURIComponent(reason)}`);
    }
  });
}

/**
 * Team Live View — listens for agent:state_update events from all Sales closers.
 * Used by HoCS to see who's doing what in real-time.
 */
export function useTeamLiveView(): Map<string, {
  agentId: string;
  currentRoute: string;
  currentOrderId: string | null;
  currentPanel: string | null;
  lastActionAt: string;
}> {
  type AgentState = { agentId: string; currentRoute: string; currentOrderId: string | null; currentPanel: string | null; lastActionAt: string };
  const [agentStates, setAgentStates] = useState(new Map<string, AgentState>());

  useSocketEvent<AgentState>('agent:state_update', (data) => {
    setAgentStates((prev) => {
      const next = new Map(prev);
      next.set(data.agentId, data);
      return next;
    });
  });

  return agentStates;
}
