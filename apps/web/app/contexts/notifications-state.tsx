import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFetcher, useRevalidator } from '@remix-run/react';
import { useToast } from '~/components/ui/toast';

const NotificationsStateContext = createContext<NotificationsStateContextValue | null>(null);

export interface NotificationsStateContextValue {
  /** Display unread count = server count minus optimistically read; 0 if markAllRead. */
  displayUnreadCount: (serverUnreadCount: number) => number;
  /** True if this id has been optimistically marked read. */
  isOptimisticallyRead: (id: string) => boolean;
  /** Mark one notification as read (optimistic + submit). */
  markAsRead: (id: string) => void;
  /** Mark all as read (optimistic + submit). */
  markAllRead: () => void;
  /** Prune optimistic set with server-known read ids so count stays correct after revalidation. */
  syncReadIdsFromServer: (readIds: string[]) => void;
}

interface NotificationsStateProviderProps {
  actionUrl: string;
  children: ReactNode;
}

export function NotificationsStateProvider({ actionUrl, children }: NotificationsStateProviderProps) {
  const [optimisticReadIds, setOptimisticReadIds] = useState<Set<string>>(new Set());
  const [markAllRead, setMarkAllRead] = useState(false);
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const { revalidate } = useRevalidator();
  const { toast } = useToast();
  const lastIntentRef = useRef<'one' | 'all' | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const lastProcessedDataRef = useRef<typeof fetcher.data>(undefined);

  const displayUnreadCount = useCallback(
    (serverUnreadCount: number): number => {
      if (markAllRead) return 0;
      return Math.max(0, serverUnreadCount - optimisticReadIds.size);
    },
    [markAllRead, optimisticReadIds.size],
  );

  const isOptimisticallyRead = useCallback(
    (id: string): boolean => {
      return markAllRead || optimisticReadIds.has(id);
    },
    [markAllRead, optimisticReadIds],
  );

  const markAsRead = useCallback(
    (id: string) => {
      setOptimisticReadIds((prev) => new Set(prev).add(id));
      lastIntentRef.current = 'one';
      lastIdRef.current = id;
      fetcher.submit(
        { intent: 'markNotificationRead', notificationId: id },
        { method: 'post', action: actionUrl },
      );
    },
    [actionUrl, fetcher],
  );

  const markAllReadFn = useCallback(() => {
    setMarkAllRead(true);
    lastIntentRef.current = 'all';
    lastIdRef.current = null;
    fetcher.submit(
      { intent: 'markAllNotificationsRead' },
      { method: 'post', action: actionUrl },
    );
  }, [actionUrl, fetcher]);

  const syncReadIdsFromServer = useCallback((readIds: string[]) => {
    if (readIds.length === 0) return;
    setOptimisticReadIds((prev) => {
      const next = new Set(prev);
      readIds.forEach((id) => next.delete(id));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  // On success: revalidate so layout gets fresh server count. Do NOT clear optimisticReadIds
  // here — revalidated server data may still be stale; prune via syncReadIdsFromServer when list has read: true.
  // Only run once per response: re-renders after revalidate() would otherwise call revalidate() again and loop.
  useEffect(() => {
    if (fetcher.state !== 'idle' || fetcher.data == null) return;
    if (lastProcessedDataRef.current === fetcher.data) return;
    lastProcessedDataRef.current = fetcher.data;

    if (fetcher.data.success) {
      // Do NOT remove from optimisticReadIds here: revalidate() may return stale unread count,
      // causing the badge to "come back". Prune via syncReadIdsFromServer when server list has read: true.
      lastIntentRef.current = null;
      lastIdRef.current = null;
      revalidate();
      return;
    }
    if (fetcher.data.error) {
      if (lastIntentRef.current === 'all') {
        setMarkAllRead(false);
      } else if (lastIntentRef.current === 'one' && lastIdRef.current) {
        setOptimisticReadIds((prev) => {
          const next = new Set(prev);
          next.delete(lastIdRef.current!);
          return next;
        });
      }
      lastIntentRef.current = null;
      lastIdRef.current = null;
      toast.error('Error', fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data, toast, revalidate]);

  const value: NotificationsStateContextValue = {
    displayUnreadCount,
    isOptimisticallyRead,
    markAsRead,
    markAllRead: markAllReadFn,
    syncReadIdsFromServer,
  };

  return (
    <NotificationsStateContext.Provider value={value}>
      {children}
    </NotificationsStateContext.Provider>
  );
}

export function useNotificationsState(): NotificationsStateContextValue {
  const ctx = useContext(NotificationsStateContext);
  if (!ctx) {
    return {
      displayUnreadCount: (n) => n,
      isOptimisticallyRead: () => false,
      markAsRead: () => {},
      markAllRead: () => {},
      syncReadIdsFromServer: () => {},
    };
  }
  return ctx;
}
