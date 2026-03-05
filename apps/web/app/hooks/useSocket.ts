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

function getSocket(): Socket {
  if (!socketInstance) {
    const apiUrl = typeof window !== 'undefined' ? window.__ENV?.API_URL : '';
    socketInstance = io(apiUrl || 'http://localhost:4444', {
      withCredentials: true,
      autoConnect: false,
      transports: ['websocket', 'polling'],
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
 */
export function usePageRefreshOnEvent(events: string[]): void {
  const { revalidate } = useRevalidator();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isConnected } = useSocket();

  const debouncedRevalidate = useCallback(() => {
    if (!isConnected) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      revalidate();
    }, 500);
  }, [revalidate, isConnected]);

  useEffect(() => {
    if (!isConnected) return;
    const socket = getSocket();
    const listener = () => debouncedRevalidate();

    events.forEach((event) => socket.on(event, listener));

    return () => {
      events.forEach((event) => socket.off(event, listener));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [events, debouncedRevalidate, isConnected]);
}
