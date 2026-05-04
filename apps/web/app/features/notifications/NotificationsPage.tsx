import { useState } from 'react';
import { Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
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
  /** Merged into list/filter/pagination links (e.g. { tab: 'feed' } on the admin notifications center). */
  listRouteSearch?: Record<string, string>;
  /** Defaults to admin notifications; TPL uses `/tpl/notifications`. */
  listBasePath?: string;
  /** Smaller heading when rendered inside the admin notifications tabbed page. */
  embeddedInTabs?: boolean;
}

function buildNotificationsListUrl(
  query: { page?: string; unreadOnly?: string },
  listRouteSearch: Record<string, string> | undefined,
  listBasePath: string,
) {
  const sp = new URLSearchParams();
  if (listRouteSearch) {
    for (const [k, v] of Object.entries(listRouteSearch)) {
      sp.set(k, v);
    }
  }
  if (query.page) sp.set('page', query.page);
  if (query.unreadOnly) sp.set('unreadOnly', query.unreadOnly);
  const qs = sp.toString();
  return qs ? `${listBasePath}?${qs}` : listBasePath;
}

export function NotificationsPage({
  notifications,
  unreadCount,
  pagination,
  unreadOnlyFilter,
  listRouteSearch,
  listBasePath = '/admin/notifications',
  embeddedInTabs = false,
}: NotificationsPageProps) {
  const [detailNotification, setDetailNotification] = useState<Notification | null>(null);
  const isFilterLoading = useLoaderRefetchBusy();
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
      {embeddedInTabs ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-app-fg">All notifications</h2>
            <p className="text-sm text-app-fg-muted mt-0.5">
              {displayUnreadCount(unreadCount) > 0 ? `${displayUnreadCount(unreadCount)} unread` : 'All caught up'} · Page {pagination.page} of {pagination.totalPages || 1}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={
                unreadOnlyFilter
                  ? buildNotificationsListUrl({}, listRouteSearch, listBasePath)
                  : buildNotificationsListUrl({ unreadOnly: 'true' }, listRouteSearch, listBasePath)
              }
              className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
            >
              {unreadOnlyFilter ? 'Show all' : 'Unread only'}
            </Link>
            {displayUnreadCount(unreadCount) > 0 && (
              <Button type="button" variant="secondary" size="sm" onClick={() => markAllRead()}>
                Mark all read
              </Button>
            )}
          </div>
        </div>
      ) : (
        <PageHeader
          title="All Notifications"
          description={`${displayUnreadCount(unreadCount) > 0 ? `${displayUnreadCount(unreadCount)} unread` : 'All caught up'} · Page ${pagination.page} of ${pagination.totalPages || 1}`}
          actions={
            <div className="flex items-center gap-2">
              <Link
                to={
                  unreadOnlyFilter
                    ? buildNotificationsListUrl({}, listRouteSearch, listBasePath)
                    : buildNotificationsListUrl({ unreadOnly: 'true' }, listRouteSearch, listBasePath)
                }
                className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
              >
                {unreadOnlyFilter ? 'Show all' : 'Unread only'}
              </Link>
              {displayUnreadCount(unreadCount) > 0 && (
                <Button type="button" variant="secondary" size="sm" onClick={() => markAllRead()}>
                  Mark all read
                </Button>
              )}
              <PageRefreshButton />
            </div>
          }
        />
      )}

      <TableLoadingOverlay show={isFilterLoading}>
      <div className="card p-0">
        {notifications.length === 0 ? (
          <EmptyState
            title={unreadOnlyFilter ? 'No unread notifications.' : 'No notifications yet.'}
            secondaryAction={
              unreadOnlyFilter ? (
                <Link
                  to={buildNotificationsListUrl({}, listRouteSearch, listBasePath)}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                >
                  View all notifications
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-app-border">
            {notifications.map((n) => {
              const dotColor = NOTIFICATION_COLORS[n.type] ?? 'bg-surface-400';
              const isRead = n.read || isOptimisticallyRead(n.id);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleOpenDetail(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-app-hover/50 transition-colors flex items-start gap-3 ${
                      !isRead ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''
                    }`}
                  >
                    <div
                      className={`w-2 h-2 mt-1.5 rounded-full flex-shrink-0 ${
                        !isRead ? dotColor : 'bg-transparent'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-app-fg">{n.title}</p>
                      {n.body && (
                        <p className="text-xs text-app-fg-muted mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      <p className="text-[11px] text-app-fg-muted mt-1">
                        {formatNotificationTime(n.createdAt)}
                      </p>
                    </div>
                    <span className="text-app-fg-muted text-xs mt-1.5">View details</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-app-border">
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              pageParam="page"
            />
          </div>
        )}
      </div>
      </TableLoadingOverlay>

      {/* Detail modal — full message, action button only when notification requires one */}
      {detailNotification && (
        <Modal
          open={Boolean(detailNotification)}
          onClose={() => setDetailNotification(null)}
          aria-labelledby="notification-detail-title"
          maxWidth="max-w-md"
          contentClassName="border border-app-border flex flex-col"
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 flex-shrink-0">
            <h2 id="notification-detail-title" className="text-lg font-semibold text-app-fg flex-1 min-w-0">
              {detailNotification.title}
            </h2>
            <button
              type="button"
              onClick={() => setDetailNotification(null)}
              className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
            {detailNotification.body ? (
              <p className="text-sm text-app-fg-muted whitespace-pre-wrap">
                {detailNotification.body}
              </p>
            ) : (
              <p className="text-sm text-app-fg-muted italic">No additional message.</p>
            )}
            <p className="text-xs text-app-fg-muted mt-4">
              {formatNotificationDate(detailNotification.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-app-border flex-shrink-0">
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
        </Modal>
      )}
    </div>
  );
}
