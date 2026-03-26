import { useEffect, useRef, useState, useCallback } from 'react';
import { useRevalidator } from '@remix-run/react';
import { io, type Socket } from 'socket.io-client';

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

// #region agent log
function agentDebugSocketLog(payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
}): void {
  fetch('http://127.0.0.1:7446/ingest/fef61901-cf82-4188-853f-f0e1d3885547', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'bc49f3' },
    body: JSON.stringify({
      sessionId: 'bc49f3',
      timestamp: Date.now(),
      runId: 'pre-fix',
      ...payload,
    }),
  }).catch(() => {});
}
// #endregion

function getSocketBaseUrl(): string {
  const raw = typeof window !== 'undefined' ? window.__ENV?.API_URL : '';
  const url = raw || 'http://localhost:4444';
  if (typeof window !== 'undefined' && window.location?.protocol === 'https:' && url.startsWith('http://')) {
    return url.replace(/^http:\/\//, 'https://');
  }
  return url;
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

    const rawEnvApi = typeof window !== 'undefined' ? (window.__ENV?.API_URL ?? '') : '';
    const resolvedUrl = getSocketBaseUrl();
    // #region agent log
    agentDebugSocketLog({
      hypothesisId: 'A',
      location: 'useSocket.ts:useSocket:mount',
      message: 'socket_api_url_config',
      data: {
        pageOrigin: typeof window !== 'undefined' ? window.location.origin : '',
        rawEnvApiUrlEmpty: !rawEnvApi.length,
        rawEnvApiHost: rawEnvApi ? new URL(resolvedUrl).host : 'fallback',
        resolvedSocketUrlHost: (() => {
          try {
            return new URL(resolvedUrl).host;
          } catch {
            return 'parse_error';
          }
        })(),
        httpsPageUsesHttpsSocket:
          typeof window !== 'undefined'
            ? window.location.protocol === 'https:' && resolvedUrl.startsWith('https:')
            : true,
      },
    });
    // #endregion

    if (!socket.connected) {
      socket.connect();
    }

    const onConnect = () => {
      // #region agent log
      agentDebugSocketLog({
        hypothesisId: 'B',
        location: 'useSocket.ts:connect',
        message: 'socket_io_transport_connected',
        data: {
          socketId: socket.id ?? null,
          /* httpOnly cookie not visible in document.cookie; false is normal */
          documentCookieLen: typeof document !== 'undefined' ? document.cookie.length : 0,
        },
      });
      // #endregion
      setIsConnected(true);
    };
    const onDisconnect = () => setIsConnected(false);

    const onServerConnected = (payload: { userId?: string; role?: string }) => {
      // #region agent log
      agentDebugSocketLog({
        hypothesisId: 'C',
        location: 'useSocket.ts:server_connected_event',
        message: 'auth_session_accepted',
        data: {
          hasUserId: Boolean(payload?.userId),
          role: payload?.role ?? null,
        },
      });
      // #endregion
    };

    const onConnectError = (err: Error) => {
      // #region agent log
      agentDebugSocketLog({
        hypothesisId: 'D',
        location: 'useSocket.ts:connect_error',
        message: 'socket_connect_error',
        data: { errorMessage: err?.message ?? String(err) },
      });
      // #endregion
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connected', onServerConnected);
    socket.on('connect_error', onConnectError);

    // Set initial state
    setIsConnected(socket.connected);
    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connected', onServerConnected);
      socket.off('connect_error', onConnectError);
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
 * Returns connection state and a "showGreen" flag that is true for 4 seconds after any of the given events fire.
 * Used by LiveIndicator: yellow blinking (idle) → green (event just received) → back to yellow.
 */
export function useLiveIndicator(events: string[]): { isConnected: boolean; showGreen: boolean } {
  const { isConnected } = useSocket();
  const [showGreen, setShowGreen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isConnected) return;
    const socket = getSocket();
    const listener = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setShowGreen(true);
      timeoutRef.current = setTimeout(() => setShowGreen(false), 4000);
    };
    events.forEach((event) => socket.on(event, listener));
    return () => {
      events.forEach((event) => socket.off(event, listener));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [events, isConnected]);

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
 * CS Agent — broadcasts current UI state for Team Live View.
 * Call this in route components for CS agents. Only emits if the socket is connected.
 */
export function useAgentStateBroadcast(state: {
  currentRoute: string;
  currentOrderId?: string | null;
  currentPanel?: string | null;
}): void {
  const { isConnected } = useSocket();

  useEffect(() => {
    if (!isConnected) return;
    const socket = getSocket();
    socket.emit('agent:state_update', state);
  }, [isConnected, state.currentRoute, state.currentOrderId, state.currentPanel]);
}

/**
 * Team Live View — listens for agent:state_update events from all CS agents.
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
