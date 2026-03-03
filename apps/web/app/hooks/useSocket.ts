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
    socketInstance = io(apiUrl || 'http://localhost:4000', {
      withCredentials: true,
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
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
 */
export function useRealtimeNotifications(): {
  realtimeNotifications: RealtimeNotification[];
  realtimeCount: number;
} {
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([]);

  useSocketEvent<RealtimeNotification>('notification:new', (notif) => {
    setNotifications((prev) => [notif, ...prev]);
  });

  return {
    realtimeNotifications: notifications,
    realtimeCount: notifications.length,
  };
}

/**
 * Auto-refresh page data (revalidate Remix loaders) when any of the listed events fire.
 * Debounces by 500ms to avoid rapid-fire revalidations.
 */
export function usePageRefreshOnEvent(events: string[]): void {
  const { revalidate } = useRevalidator();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRevalidate = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      revalidate();
    }, 500);
  }, [revalidate]);

  useEffect(() => {
    const socket = getSocket();
    const listener = () => debouncedRevalidate();

    events.forEach((event) => socket.on(event, listener));

    return () => {
      events.forEach((event) => socket.off(event, listener));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [events, debouncedRevalidate]);
}
