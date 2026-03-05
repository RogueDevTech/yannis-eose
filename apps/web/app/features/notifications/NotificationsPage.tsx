import { useState } from 'react';
import { Link, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import { getNotificationAction, formatNotificationTime, formatNotificationDate } from '~/lib/notification-links';
import { useNotificationsState } from '~/contexts/notifications-state';
import type { Notification } from './types';

const NOTIFICATION_COLORS: Record<string, string> = {
  'order:new': 'bg-brand-500',
  'order:status': 'bg-info-500',
  'order:assigned': 'bg-brand-500',
  'transfer:created': 'bg-warning-500',
  'transfer:verified': 'bg-success-500',
  'funding:sent': 'bg-brand-500',
  'funding:disputed': 'bg-danger-500',
  'finance:approval': 'bg-success-500',
  'payout:generated': 'bg-success-500',
  'system:info': 'bg-surface-500',
};

interface NotificationsPageProps {
  notifications: Notification[];
  unreadCount: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  unreadOnlyFilter: boolean;
}

export function NotificationsPage({
  notifications,
  unreadCount,
  pagination,
  unreadOnlyFilter,
}: NotificationsPageProps) {
  const [detailNotification, setDetailNotification] = useState<Notification | null>(null);
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const { displayUnreadCount, isOptimisticallyRead, markAsRead, markAllRead } = useNotificationsState();

  const handleOpenDetail = (n: Notification) => {
    setDetailNotification(n);
    if (!n.read && !isOptimisticallyRead(n.id)) {
      markAsRead(n.id);
    }
  };

  const action = detailNotification ? getNotificationAction(detailNotification) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">All Notifications</h1>
          <p className="text-sm text-surface-600 dark:text-surface-300 mt-0.5">
            {displayUnreadCount(unreadCount) > 0 ? `${displayUnreadCount(unreadCount)} unread` : 'All caught up'} · Page {pagination.page} of {pagination.totalPages || 1}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={unreadOnlyFilter ? '/admin/notifications' : '/admin/notifications?unreadOnly=true'}
            className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
          >
            {unreadOnlyFilter ? 'Show all' : 'Unread only'}
          </Link>
          {isFilterLoading && (
            <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
          {displayUnreadCount(unreadCount) > 0 && (
            <Button type="button" variant="secondary" size="sm" onClick={() => markAllRead()}>
              Mark all read
            </Button>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <p className="text-surface-600 dark:text-surface-300">
              {unreadOnlyFilter ? 'No unread notifications.' : 'No notifications yet.'}
            </p>
            {unreadOnlyFilter && (
              <Link to="/admin/notifications" className="mt-2 text-sm text-brand-600 dark:text-brand-400 hover:underline">
                View all notifications
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-surface-100 dark:divide-surface-700">
            {notifications.map((n) => {
              const dotColor = NOTIFICATION_COLORS[n.type] ?? 'bg-surface-400';
              const isRead = n.read || isOptimisticallyRead(n.id);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleOpenDetail(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors flex items-start gap-3 ${
                      !isRead ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''
                    }`}
                  >
                    <div
                      className={`w-2 h-2 mt-1.5 rounded-full flex-shrink-0 ${
                        !isRead ? dotColor : 'bg-transparent'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-white">{n.title}</p>
                      {n.body && (
                        <p className="text-xs text-surface-600 dark:text-surface-300 mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
                        {formatNotificationTime(n.createdAt)}
                      </p>
                    </div>
                    <span className="text-surface-400 dark:text-surface-500 text-xs mt-1.5">View details</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-100 dark:border-surface-700">
            <p className="text-xs text-surface-600 dark:text-surface-400">
              {pagination.total} total
            </p>
            <div className="flex gap-2">
              {pagination.page > 1 && (
                <Link
                  to={`/admin/notifications?page=${pagination.page - 1}${unreadOnlyFilter ? '&unreadOnly=true' : ''}`}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                >
                  Previous
                </Link>
              )}
              {pagination.page < pagination.totalPages && (
                <Link
                  to={`/admin/notifications?page=${pagination.page + 1}${unreadOnlyFilter ? '&unreadOnly=true' : ''}`}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail modal — full message, action button only when notification requires one */}
      {detailNotification && (
        <>
          <div
            className="fixed inset-0 z-[200] bg-black/50 dark:bg-black/60"
            aria-hidden
            onClick={() => setDetailNotification(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-detail-title"
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-full max-w-md max-h-[90vh] flex flex-col bg-white dark:bg-surface-800 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700 animate-fade-in mx-4"
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 flex-shrink-0">
              <h2 id="notification-detail-title" className="text-lg font-semibold text-surface-900 dark:text-white flex-1 min-w-0">
                {detailNotification.title}
              </h2>
              <button
                type="button"
                onClick={() => setDetailNotification(null)}
                className="p-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors shrink-0"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
              {detailNotification.body ? (
                <p className="text-sm text-surface-700 dark:text-surface-200 whitespace-pre-wrap">
                  {detailNotification.body}
                </p>
              ) : (
                <p className="text-sm text-surface-500 dark:text-surface-400 italic">No additional message.</p>
              )}
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-4">
                {formatNotificationDate(detailNotification.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-5 pt-3 pb-5 border-t border-surface-100 dark:border-surface-700 flex-shrink-0">
              {action && (
                <Link
                  to={action.link}
                  onClick={() => setDetailNotification(null)}
                  className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-500 transition-colors"
                >
                  {action.label}
                </Link>
              )}
              <Button variant="secondary" size="sm" onClick={() => setDetailNotification(null)}>
                Close
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
