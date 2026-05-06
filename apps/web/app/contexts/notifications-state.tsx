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
  /**
   * Badge unread count: server total minus in-flight mark-read rows only.
   * Row styling uses a separate set so IDs cleared from the badge after success do not
   * double-subtract once `unreadCount` already dropped server-side (e.g. marked from
   * another page — those IDs never appear on the bell's first page for sync pruning).
   */
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
  /**
   * When true, the provider treats every mark-read action as a no-op — no optimistic UI
   * change, no server submit. Used in Mirror Mode so an admin viewing the user's bell
   * doesn't accidentally mark the user's notifications as read on their behalf.
   */
  readOnly?: boolean;
}

export function NotificationsStateProvider({ actionUrl, children, readOnly = false }: NotificationsStateProviderProps) {
  /** Row/modal styling until server list shows `read: true` (pruned in syncReadIdsFromServer). */
  const [optimisticReadIds, setOptimisticReadIds] = useState<Set<string>>(new Set());
  /** Subtracted from badge only while the mark-read request is in flight (not entire optimistic set). */
  const [pendingBadgeAdjustIds, setPendingBadgeAdjustIds] = useState<Set<string>>(new Set());
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
      return Math.max(0, serverUnreadCount - pendingBadgeAdjustIds.size);
    },
    [markAllRead, pendingBadgeAdjustIds.size],
  );

  const isOptimisticallyRead = useCallback(
    (id: string): boolean => {
      return markAllRead || optimisticReadIds.has(id);
    },
    [markAllRead, optimisticReadIds],
  );

  const markAsRead = useCallback(
    (id: string) => {
      // Mirror Mode is view-only — never touch the target user's read state.
      if (readOnly) return;
      setOptimisticReadIds((prev) => new Set(prev).add(id));
      setPendingBadgeAdjustIds((prev) => new Set(prev).add(id));
      lastIntentRef.current = 'one';
      lastIdRef.current = id;
      fetcher.submit(
        { intent: 'markNotificationRead', notificationId: id },
        { method: 'post', action: actionUrl },
      );
    },
    [actionUrl, fetcher, readOnly],
  );

  const markAllReadFn = useCallback(() => {
    if (readOnly) return;
    setMarkAllRead(true);
    lastIntentRef.current = 'all';
    lastIdRef.current = null;
    fetcher.submit(
      { intent: 'markAllNotificationsRead' },
      { method: 'post', action: actionUrl },
    );
  }, [actionUrl, fetcher, readOnly]);

  const syncReadIdsFromServer = useCallback((readIds: string[]) => {
    if (readIds.length === 0) return;
    setOptimisticReadIds((prev) => {
      const next = new Set(prev);
      readIds.forEach((id) => next.delete(id));
      return next.size === prev.size ? prev : next;
    });
    setPendingBadgeAdjustIds((prev) => {
      const next = new Set(prev);
      readIds.forEach((id) => next.delete(id));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  // On success: drop badge adjustments immediately (server unread already excludes those rows
  // after persist + cache invalidation). Keep optimisticReadIds for row styling until sync.
  // Reset markAllRead after mark-all success so new notifications increment the badge again.
  // Only run once per response: re-renders after revalidate() would otherwise call revalidate() again and loop.
  useEffect(() => {
    if (fetcher.state !== 'idle' || fetcher.data == null) return;
    if (lastProcessedDataRef.current === fetcher.data) return;
    lastProcessedDataRef.current = fetcher.data;

    if (fetcher.data.success) {
      const intent = lastIntentRef.current;
      const id = lastIdRef.current;
      lastIntentRef.current = null;
      lastIdRef.current = null;

      if (intent === 'one' && id) {
        setPendingBadgeAdjustIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next.size === prev.size ? prev : next;
        });
      } else if (intent === 'all') {
        setPendingBadgeAdjustIds(new Set());
        setMarkAllRead(false);
      }

      revalidate();
      return;
    }
    if (fetcher.data.error) {
      if (lastIntentRef.current === 'all') {
        setMarkAllRead(false);
      } else if (lastIntentRef.current === 'one' && lastIdRef.current) {
        const rid = lastIdRef.current;
        setOptimisticReadIds((prev) => {
          const next = new Set(prev);
          next.delete(rid);
          return next;
        });
        setPendingBadgeAdjustIds((prev) => {
          const next = new Set(prev);
          next.delete(rid);
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
