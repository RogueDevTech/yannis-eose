import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Form, Link, useNavigate, useSubmit, useNavigation, useLocation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Modal } from '~/components/ui/modal';
import {
  canRoleSeeAllBranchesInHeader,
  shouldShowHeaderBranchSwitcher,
} from './header-branch-scope';
import { getNotificationLink, getNotificationAction, formatNotificationTime, formatNotificationDate } from '~/lib/notification-links';
import { useNotificationsState } from '~/contexts/notifications-state';
interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
  data?: Record<string, unknown> | null;
}

interface BranchInfo {
  id: string;
  name: string;
  code: string;
}

interface HeaderProps {
  user: {
    name: string;
    role: string;
    email: string;
  } | null;
  sidebarCollapsed: boolean;
  /** Logo asset on mobile header — dark PNG only for Dark theme */
  isDarkTheme: boolean;
  notificationsPromise: Promise<{ notifications: Notification[]; unreadCount: number }>;
  realtimeNotifications?: Notification[];
  realtimeCount?: number;
  socketConnected?: boolean;
  onMobileMenuToggle: () => void;
  onRemoveRealtimeNotification?: (id: string) => void;
  onPruneServerKnown?: (serverIds: Set<string>) => void;
  onClearRealtimeNotifications?: () => void;
  branches?: BranchInfo[];
  /** False while admin layout streams branch list — desktop switcher shows a skeleton. */
  branchesHydrationReady?: boolean;
  currentBranchId?: string | null;
  /**
   * When set, the header renders an "Exit Mirror" pill that posts to /auth/mirror/stop.
   * Surfaced from the layout, threaded down from `getCurrentUser`.
   */
  mirroredBy?: { id: string; name: string; role: string } | null;
}

const NOTIFICATION_COLORS: Record<string, string> = {
  'order:new': 'bg-brand-500',
  'order:status': 'bg-info-500',
  'order:status_changed': 'bg-info-500',
  'order:assigned': 'bg-brand-500',
  'transfer:created': 'bg-warning-500',
  'transfer:verified': 'bg-success-500',
  'shrinkage:detected': 'bg-danger-500',
  'reconciliation:pending': 'bg-danger-500',
  'stock:low': 'bg-warning-500',
  'stock:updated': 'bg-info-500',
  'finance:approval': 'bg-success-500',
  'funding:sent': 'bg-brand-500',
  'funding:disputed': 'bg-danger-500',
  'payout:generated': 'bg-success-500',
  'escalation:transfer': 'bg-danger-500',
  'escalation:stuck_order': 'bg-danger-500',
  'high_cpa:warning': 'bg-warning-500',
  'system:info': 'bg-surface-500',
  'remittance:sent': 'bg-warning-500',
  'remittance:received': 'bg-success-500',
};

function timeAgo(dateStr: string): string {
  return formatNotificationTime(dateStr);
}

/** When server list resolves, prune optimistic read set and realtime duplicates. */
function SyncNotificationReadIds({ notifications, onPruneServerKnown }: { notifications: Notification[]; onPruneServerKnown?: (serverIds: Set<string>) => void }) {
  const { syncReadIdsFromServer } = useNotificationsState();
  useEffect(() => {
    const readIds = notifications.filter((n) => n.read).map((n) => n.id);
    if (readIds.length > 0) syncReadIdsFromServer(readIds);
    // Prune realtime notifications that are already in the server list
    if (onPruneServerKnown && notifications.length > 0) {
      const serverIds = new Set(notifications.map((n) => n.id));
      onPruneServerKnown(serverIds);
    }
  }, [notifications, syncReadIdsFromServer, onPruneServerKnown]);
  return null;
}

export function Header({
  user,
  sidebarCollapsed,
  isDarkTheme,
  notificationsPromise,
  realtimeNotifications = [],
  realtimeCount: _realtimeCount = 0,
  socketConnected,
  onMobileMenuToggle,
  onRemoveRealtimeNotification,
  onPruneServerKnown,
  onClearRealtimeNotifications,
  branches,
  branchesHydrationReady = true,
  currentBranchId,
  mirroredBy,
}: HeaderProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifTriggerRef = useRef<HTMLButtonElement>(null);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const location = useLocation();
  // Per-shell notifications page: TPL users land on `/tpl/notifications`, everyone else
  // (admin / hr / tpl-admin) shares the canonical `/admin/notifications` history page.
  const notificationsHistoryPath = location.pathname.startsWith('/tpl')
    ? '/tpl/notifications'
    : '/admin/notifications';
  const { displayUnreadCount, isOptimisticallyRead, markAsRead, markAllRead } = useNotificationsState();
  const isMobileBranchSwitching =
    navigation.state !== 'idle' && navigation.formAction?.includes('/admin/branches/switch');

  const canSeeAllBranches = canRoleSeeAllBranchesInHeader(user?.role ?? '');
  const mobileCurrentBranch = branches?.find((b) => b.id === (currentBranchId ?? null)) ?? null;
  const mobileCanSwitchBranches = !!branches && shouldShowHeaderBranchSwitcher(branches.length, user?.role ?? '');
  const isMobileAllBranches = canSeeAllBranches && currentBranchId == null;

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      const inNotifPanel = notifPanelRef.current?.contains(event.target as Node);
      const inNotifTrigger = notifTriggerRef.current?.contains(event.target as Node);
      if (notifOpen && !inNotifPanel && !inNotifTrigger) {
        setNotifOpen(false);
      }
    }
    if (userMenuOpen || notifOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen, notifOpen]);

  // Body scroll lock when notification drawer is open
  useEffect(() => {
    if (notifOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [notifOpen]);

  // Escape key to close notification drawer or detail modal
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (selectedNotification) setSelectedNotification(null);
        else setNotifOpen(false);
      }
    }
    if (notifOpen || selectedNotification) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [notifOpen, selectedNotification]);

  const handleMarkAllRead = useCallback(() => {
    markAllRead();
    onClearRealtimeNotifications?.();
  }, [markAllRead, onClearRealtimeNotifications]);

  const handleNotificationClick = useCallback((notif: Notification) => {
    setNotifOpen(false);
    setSelectedNotification(notif);
    if (!notif.read) {
      // Synthetic realtime notifications (from Socket.io / Web Push) carry non-UUID
      // ids (e.g. `push-<logId>`) and are not stored in the `notifications` table —
      // their read state lives in `push_delivery_log` and is acked by the service
      // worker. Calling notifications.markAsRead with their id fails the server
      // Zod uuid check. Dismiss them client-side only.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notif.id);
      if (isUuid) markAsRead(notif.id);
      onRemoveRealtimeNotification?.(notif.id);
    }
  }, [markAsRead, onRemoveRealtimeNotification]);

  const handleMobileBranchSwitch = useCallback((branchId: string | null) => {
    if (!branches || isMobileBranchSwitching) return;
    if (branchId === (currentBranchId ?? null)) {
      setMobileUserMenuOpen(false);
      return;
    }

    submit(
      { intent: 'switchBranch', branchId: branchId ?? '' },
      { method: 'post', action: '/admin/branches/switch' },
    );
    setMobileUserMenuOpen(false);
  }, [branches, isMobileBranchSwitching, currentBranchId, submit]);

  return (
    <header
      className={`fixed top-0 right-0 z-30 h-[var(--header-height)] bg-app-elevated border-b border-app-border text-app-fg flex items-center px-4 lg:px-6 transition-all duration-300 left-0 ${
        sidebarCollapsed
          ? 'lg:left-[var(--sidebar-collapsed-width)]'
          : 'lg:left-[var(--sidebar-width)]'
      }`}
    >
      {/* Left: mobile menu + logo (mobile). Desktop: no flex-grow so branch + actions stay one cluster. */}
      <div className="flex items-center gap-3 flex-1 min-w-0 max-w-lg lg:flex-none lg:max-w-none">
        {/* Mobile hamburger — before logo */}
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden p-1.5 rounded-lg text-app-fg hover:bg-app-hover transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        {/* Logo — mobile only, after menu bar. Wrapped in the themed strip the
            desktop sidebar uses (`bg-app-logo-strip-bg`) so the logo always sits
            on a consistent light-ish background. Because the strip is always
            light, we always use the light-mode asset (yannis-logo-white-bg.png)
            instead of swapping by `isDarkTheme` — swapping was the bug, because
            in Dark/Dim/Ink themes the function picked yannis-logo1.png, which
            assumed a dark surface the strip wasn't giving it. */}
        <Link
          to="/admin"
          className="lg:hidden flex items-center shrink-0 px-2 py-0.5 rounded-lg border border-app-logo-strip-border bg-app-logo-strip-bg"
          aria-label="Yannis home"
        >
          <img
            src="/assets/yannis-logo-white-bg.png"
            alt="Yannis"
            className="h-[1.575rem] w-auto max-w-[108px] object-contain"
          />
        </Link>

      </div>

      {/* Branch + actions: single row with even gaps (avoids justify-between wedge between branch and bell). */}
      <div className="flex items-center gap-2 lg:gap-3 ml-auto min-w-0">
        {!branchesHydrationReady && (
          <div
            className="hidden lg:flex items-center shrink-0 h-9 w-[min(12rem,28vw)] rounded-md bg-app-hover animate-pulse"
            aria-hidden
          />
        )}
        {branchesHydrationReady && branches && branches.length > 0 && (
          <div className="hidden lg:flex items-center shrink-0">
            <HeaderBranchSwitcher
              branches={branches}
              currentBranchId={currentBranchId ?? null}
              userRole={user?.role ?? ''}
            />
          </div>
        )}
        {/* Mirror Mode pill — only shown when the session is mirroring another user.
            POSTs to the same /admin action that exits mirror; returns to /admin when done. */}
        {mirroredBy && (
          // POSTs to the LAYOUT route (no `?index`) — the action handler that calls
          // `/auth/mirror/stop` lives in routes/admin/route.tsx. Adding `?index` would
          // route it to admin._index which has no action and 500s.
          <Form method="post" action="/admin" className="inline-flex" data-mirror-allow="">
            <input type="hidden" name="intent" value="exitMirror" />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-success-100 text-success-800 border border-success-300 hover:bg-success-200 dark:bg-success-700/30 dark:text-success-200 dark:border-success-600/60 dark:hover:bg-success-700/50 transition-colors"
              title={`Mirroring ${user?.name ?? 'user'} as ${mirroredBy.name}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse" />
              <span className="hidden sm:inline">Exit mirror</span>
              <span className="sm:hidden">Exit</span>
            </button>
          </Form>
        )}
        {/* Notifications bell — deferred so layout loads immediately */}
        <div className="relative">
          <DeferredSection resolve={notificationsPromise} skeleton="inline">
            {({ notifications, unreadCount, total }: { notifications: Notification[]; unreadCount: number; total?: number }) => {
              // Deduplicate: only include realtime notifications NOT already in the server list
              const serverIds = new Set(notifications.map((n: Notification) => n.id));
              const uniqueRealtime = realtimeNotifications.filter((n) => !serverIds.has(n.id));
              const mergedNotifications = [...uniqueRealtime, ...notifications];
              const serverUnread = unreadCount + uniqueRealtime.length;
              const mergedUnreadCount = displayUnreadCount(serverUnread);
              // Total across the user's full history (server `pagination.total`). May be
              // larger than `mergedNotifications.length` because the drawer is capped at
              // 50 — surfaced in the header so the user can tell at a glance whether
              // more notifications exist beyond what's rendered here.
              const serverTotal =
                typeof total === 'number'
                  ? Math.max(total, mergedNotifications.length)
                  : mergedNotifications.length;
              const hasOlderHistory = serverTotal > mergedNotifications.length;
              return (
                <>
                  <SyncNotificationReadIds notifications={notifications} onPruneServerKnown={onPruneServerKnown} />
                  <button
                    ref={notifTriggerRef}
                    onClick={() => setNotifOpen(!notifOpen)}
                    className="relative p-1.5 rounded-lg text-app-fg hover:bg-app-hover transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                      />
                    </svg>
                    {socketConnected !== undefined && (
                      <span
                        className={`absolute bottom-0.5 left-0.5 w-2 h-2 rounded-full border border-app-elevated ${
                          socketConnected ? 'bg-success-500' : 'bg-danger-500'
                        }`}
                        title={socketConnected ? 'Real-time connected' : 'Real-time disconnected'}
                      />
                    )}
                    {mergedUnreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold bg-danger-500 text-white rounded-full">
                        {mergedUnreadCount > 99 ? '99+' : mergedUnreadCount}
                      </span>
                    )}
                  </button>

                  {notifOpen &&
                    createPortal(
                      <>
                        <div
                          className="fixed inset-0 z-[100] bg-black/40 dark:bg-black/60 backdrop-blur-sm"
                          onClick={() => setNotifOpen(false)}
                          aria-hidden="true"
                        />
                        <div
                          ref={notifPanelRef}
                          className="fixed top-0 right-0 h-full w-full max-w-md sm:max-w-lg bg-app-elevated shadow-2xl z-[101] flex flex-col animate-slide-in-right"
                          role="dialog"
                          aria-label="Notifications"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between px-4 py-4 border-b border-app-border flex-shrink-0">
                            <h3 className="text-base font-semibold text-app-fg">
                              Notifications
                              <span className="ml-1.5 text-sm text-app-fg-muted font-normal">
                                {mergedUnreadCount > 0
                                  ? `(${mergedUnreadCount} unread · ${serverTotal} total)`
                                  : serverTotal > 0
                                    ? `(${serverTotal} total)`
                                    : null}
                              </span>
                            </h3>
                            <div className="flex items-center gap-2">
                              {mergedUnreadCount > 0 && (
                                <button
                                  onClick={handleMarkAllRead}
                                  className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
                                >
                                  Mark all read
                                </button>
                              )}
                              <button
                                onClick={() => setNotifOpen(false)}
                                className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors"
                                aria-label="Close notifications"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          <div className="flex-1 overflow-y-auto min-h-0">
                            {mergedNotifications.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full px-4 py-12 text-center">
                                <svg className="w-12 h-12 text-app-fg-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                                </svg>
                                <p className="text-sm text-app-fg-muted">No notifications yet</p>
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                {mergedNotifications.map((n: Notification) => {
                                  const link = getNotificationLink(n);
                                  const dotColor = NOTIFICATION_COLORS[n.type] ?? 'bg-surface-400';
                                  const isRead = n.read || isOptimisticallyRead(n.id);
                                  return (
                                    <button
                                      key={n.id}
                                      type="button"
                                      onClick={() => handleNotificationClick(n)}
                                      className={`w-full text-left px-4 py-3 border-b border-app-border/50 hover:bg-app-hover transition-colors cursor-pointer ${
                                        !isRead ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''
                                      }`}
                                    >
                                      <div className="flex items-start gap-2.5">
                                        <div className={`w-2 h-2 mt-1.5 rounded-full flex-shrink-0 ${
                                          !isRead ? dotColor : 'bg-transparent'
                                        }`} />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-app-fg leading-tight">
                                            {n.title}
                                          </p>
                                          {n.body && (
                                            <p className="text-xs text-app-fg-muted mt-0.5 line-clamp-2">
                                              {n.body}
                                            </p>
                                          )}
                                          <div className="flex items-center gap-2 mt-1">
                                            <p className="text-[11px] text-app-fg-muted">
                                              {timeAgo(n.createdAt)}
                                            </p>
                                            {link && (
                                              <span className="text-[11px] text-brand-500 dark:text-brand-400">
                                                View →
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {mergedNotifications.length > 0 && (
                            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-app-border flex-shrink-0">
                              <a
                                href={notificationsHistoryPath}
                                className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
                                onClick={() => setNotifOpen(false)}
                              >
                                View all notifications
                              </a>
                              {hasOlderHistory && (
                                <span className="text-xs text-app-fg-muted">
                                  +{serverTotal - mergedNotifications.length} older in history
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </>,
                      document.body
                    )}

                  {/* Notification detail modal — mark as read when opened */}
                  {selectedNotification &&
                    createPortal(
                      <>
                        <div
                          className="fixed inset-0 z-[110] bg-black/50 dark:bg-black/60"
                          aria-hidden
                          onClick={() => setSelectedNotification(null)}
                        />
                        <div
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="notification-detail-title"
                          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[111] w-full max-w-md max-h-[90dvh] flex flex-col bg-app-elevated rounded-xl shadow-xl border border-app-border mx-4 animate-fade-in"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-start justify-between gap-3 p-5 pb-0 flex-shrink-0">
                            <h2 id="notification-detail-title" className="text-lg font-semibold text-app-fg pr-8">
                              {selectedNotification.title}
                            </h2>
                            <button
                              type="button"
                              onClick={() => setSelectedNotification(null)}
                              className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors -mt-1 -mr-1"
                              aria-label="Close"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                            {selectedNotification.body ? (
                              <p className="text-sm text-app-fg whitespace-pre-wrap">
                                {selectedNotification.body}
                              </p>
                            ) : (
                              <p className="text-sm text-app-fg-muted italic">No additional message.</p>
                            )}
                            <p className="text-xs text-app-fg-muted mt-4">
                              {formatNotificationDate(selectedNotification.createdAt)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 p-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-app-border flex-shrink-0">
                            {(() => {
                              const action = getNotificationAction(selectedNotification);
                              return action ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedNotification(null);
                                    navigate(action.link);
                                  }}
                                >
                                  {action.label}
                                </Button>
                              ) : null;
                            })()}
                            <Button variant="secondary" size="sm" onClick={() => setSelectedNotification(null)}>
                              Close
                            </Button>
                          </div>
                        </div>
                      </>,
                      document.body
                    )}
                </>
              );
            }}
          </DeferredSection>
        </div>

        {/* User menu with dropdown */}
        {user && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMobileUserMenuOpen(true)}
              className="md:hidden flex items-center gap-2 pl-2 border-l border-app-border hover:opacity-80 transition-opacity"
            >
              <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center">
                <span className="text-xs font-semibold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="hidden md:flex items-center gap-2 pl-3 border-l border-app-border hover:opacity-80 transition-opacity"
            >
              <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center">
                <span className="text-xs font-semibold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="hidden md:block min-w-0 text-left">
                <p className="text-sm font-medium text-app-fg truncate leading-tight">
                  {user.name}
                </p>
                <p className="text-2xs text-app-fg-muted truncate">
                  {formatRole(user.role)}
                </p>
              </div>
              <svg
                className={`w-4 h-4 text-app-fg-muted hidden md:block transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {/* Dropdown menu (desktop) */}
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-lg bg-app-elevated shadow-lg border border-app-border py-1 animate-fade-in z-50 hidden md:block">
                <div className="px-4 py-2 border-b border-app-border">
                  <p className="text-xs text-app-fg-muted truncate">
                    {user.email}
                  </p>
                </div>

                <div className="py-1">
                  <a
                    href="/admin/profile"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-app-fg-muted hover:bg-app-hover transition-colors"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                    My Profile
                  </a>
                  <a
                    href="/admin/settings"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-app-fg-muted hover:bg-app-hover transition-colors"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Settings
                  </a>
                </div>

                {/* Logout */}
                <div className="border-t border-app-border py-1">
                  <Form method="post" action="/auth/logout">
                    <Button
                      type="submit"
                      variant="ghost"
                      className="flex items-center gap-2 w-full justify-start text-danger-600 dark:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-700/20 transition-colors h-auto py-2 px-4 font-normal"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                      </svg>
                      Sign out
                    </Button>
                  </Form>
                </div>
              </div>
            )}

            {/* Mobile user sheet */}
            <Modal
              open={mobileUserMenuOpen}
              onClose={() => setMobileUserMenuOpen(false)}
              aria-labelledby="mobile-user-menu-title"
              maxWidth="max-w-md"
              contentClassName="border border-app-border"
            >
              <div className="px-5 py-4 border-b border-app-border">
                <p id="mobile-user-menu-title" className="text-base font-semibold text-app-fg">
                  Account
                </p>
                <p className="text-sm font-medium text-app-fg mt-2">{user.name}</p>
                <p className="text-xs text-app-fg-muted">{user.email}</p>
                <p className="text-2xs text-app-fg-muted mt-0.5">{formatRole(user.role)}</p>
              </div>

              {branches && branches.length > 0 && (
                <div className="border-b border-app-border py-2">
                  <div className="px-5 pt-1 pb-1">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-app-fg-muted">
                      Branch
                    </p>
                  </div>

                  {mobileCanSwitchBranches ? (
                    <div className="pb-1">
                      {canSeeAllBranches && (
                        <button
                          type="button"
                          onClick={() => handleMobileBranchSwitch(null)}
                          disabled={isMobileBranchSwitching}
                          className={`w-full flex items-center justify-between gap-2 px-5 py-2.5 text-sm transition-colors ${
                            isMobileAllBranches
                              ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
                              : 'text-app-fg-muted hover:bg-app-hover/50'
                          } ${isMobileBranchSwitching ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <span>All Branches</span>
                          {isMobileAllBranches && (
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      )}

                      {branches.map((branch) => (
                        <button
                          key={branch.id}
                          type="button"
                          onClick={() => handleMobileBranchSwitch(branch.id)}
                          disabled={isMobileBranchSwitching}
                          className={`w-full flex items-center justify-between gap-2 px-5 py-2.5 text-sm transition-colors ${
                            branch.id === (currentBranchId ?? null)
                              ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
                              : 'text-app-fg-muted hover:bg-app-hover/50'
                          } ${isMobileBranchSwitching ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <span className="truncate">{branch.name}</span>
                          <span className="flex items-center gap-1.5 text-[10px]">
                            <span className="font-mono text-app-fg-muted">{branch.code}</span>
                            {branch.id === (currentBranchId ?? null) && (
                              <svg className="w-3.5 h-3.5 flex-shrink-0 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                        </button>
                      ))}
                      {isMobileBranchSwitching && (
                        <p className="px-5 pt-1 text-[11px] text-app-fg-muted">
                          Switching branch...
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="px-5 pb-2">
                      <div className="flex items-center justify-between rounded-md bg-app-hover px-3 py-2">
                        <span className="text-sm text-app-fg truncate">
                          {mobileCurrentBranch?.name ?? 'Branch'}
                        </span>
                        {mobileCurrentBranch?.code && (
                          <span className="text-[10px] font-mono text-app-fg-muted">
                            {mobileCurrentBranch.code}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="py-2">
                <a
                  href="/admin/profile"
                  className="flex items-center gap-2 px-5 py-2.5 text-sm text-app-fg-muted hover:bg-app-hover transition-colors"
                  onClick={() => setMobileUserMenuOpen(false)}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  My Profile
                </a>
                <a
                  href="/admin/settings"
                  className="flex items-center gap-2 px-5 py-2.5 text-sm text-app-fg-muted hover:bg-app-hover transition-colors"
                  onClick={() => setMobileUserMenuOpen(false)}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </a>
              </div>

              <div className="border-t border-app-border py-2">
                <Form method="post" action="/auth/logout">
                  <Button
                    type="submit"
                    variant="ghost"
                    className="flex items-center gap-2 w-full justify-start text-danger-600 dark:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-700/20 transition-colors h-auto py-2.5 px-5 font-normal"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                    </svg>
                    Sign out
                  </Button>
                </Form>
              </div>
            </Modal>
          </div>
        )}
      </div>
    </header>
  );
}

/* ── Header Branch Switcher ───────────────────────────────────────────── */

function HeaderBranchSwitcher({
  branches,
  currentBranchId,
  userRole,
}: {
  branches: BranchInfo[];
  currentBranchId: string | null;
  userRole: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Use top-level `useSubmit` (full navigation), NOT `useFetcher`. With a
  // fetcher, the action's `redirect(referer, { headers })` is followed but the
  // parent /admin loader is not re-validated — leaving the layout's React
  // state pointed at the pre-switch user even though the freshly-issued
  // bundle cookie has the new currentBranchId. The result was the entire
  // sidebar nav going blank after a switch (mirror mode made it most visible).
  // Top-level submit triggers a real navigation so all loaders revalidate.
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== 'idle' && navigation.formAction === '/admin/branches/switch';

  const canSeeAllBranches = canRoleSeeAllBranchesInHeader(userRole);
  const currentBranch = branches.find((b) => b.id === currentBranchId) ?? null;
  // "All Branches" is active when currentBranchId is null (and user can see all)
  const isAllBranches = canSeeAllBranches && currentBranchId === null;
  const canSwitch = shouldShowHeaderBranchSwitcher(branches.length, userRole);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // null branchId = "All Branches"; empty string submitted to action = null on backend
  const handleSwitch = (branchId: string | null) => {
    if (branchId === currentBranchId) { setOpen(false); return; }
    submit(
      { intent: 'switchBranch', branchId: branchId ?? '' },
      { method: 'post', action: '/admin/branches/switch' },
    );
    setOpen(false);
  };

  // Single-branch user with no "All Branches" option — static pill
  if (!canSwitch) {
    const display = currentBranch ?? branches[0];
    if (!display) return null;
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-hover border border-app-border">
        <svg className="w-3.5 h-3.5 text-app-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        <span className="text-xs font-semibold text-app-fg">{display.name}</span>
        <span className="text-[10px] text-app-fg-muted font-mono bg-app-hover px-1 rounded">
          {display.code}
        </span>
      </div>
    );
  }

  // Trigger label
  const triggerLabel = isAllBranches ? 'All Branches' : (currentBranch?.name ?? 'Select Branch');
  const triggerCode = isAllBranches ? null : (currentBranch?.code ?? null);

  // Multi-branch / SuperAdmin — dropdown
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-hover border border-app-border hover:bg-app-hover transition-colors duration-150 text-left"
        disabled={isSubmitting}
      >
        {isAllBranches ? (
          <svg className="w-3.5 h-3.5 text-brand-500 dark:text-brand-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-app-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        )}
        <span className={`text-xs font-semibold truncate max-w-[140px] ${isAllBranches ? 'text-brand-600 dark:text-brand-400' : 'text-app-fg'}`}>
          {triggerLabel}
        </span>
        {triggerCode && (
          <span className="text-[10px] text-app-fg-muted font-mono bg-app-hover px-1 rounded">
            {triggerCode}
          </span>
        )}
        {isSubmitting ? (
          <svg
            className="w-3 h-3 ml-0.5 flex-shrink-0 animate-spin text-brand-500 dark:text-brand-400"
            fill="none" viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg
            className={`w-3 h-3 text-app-fg-muted ml-0.5 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 min-w-[220px] bg-app-elevated border border-app-border rounded-lg shadow-lg z-50 py-1 overflow-hidden animate-fade-in">
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-app-fg-muted">
            Switch Branch
          </p>

          {/* All Branches option — SuperAdmin only */}
          {canSeeAllBranches && (
            <button
              type="button"
              onClick={() => handleSwitch(null)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-app-hover transition-colors duration-100 ${
                isAllBranches ? 'bg-brand-50 dark:bg-brand-900/20' : ''
              }`}
            >
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded flex-shrink-0 ${
                isAllBranches ? 'bg-brand-600 text-white' : 'bg-app-hover text-app-fg-muted'
              }`}>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-app-fg">All Branches</p>
                <p className="text-[10px] text-app-fg-muted">Global view — no branch filter</p>
              </div>
              {isAllBranches && (
                <svg className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          )}

          {canSeeAllBranches && branches.length > 0 && (
            <div className="my-1 border-t border-app-border" />
          )}

          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => handleSwitch(branch.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-app-hover transition-colors duration-100 ${
                branch.id === currentBranchId ? 'bg-brand-50 dark:bg-brand-900/20' : ''
              }`}
            >
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold flex-shrink-0 ${
                branch.id === currentBranchId
                  ? 'bg-brand-600 text-white'
                  : 'bg-app-hover text-app-fg-muted'
              }`}>
                {branch.code.slice(0, 2)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-app-fg truncate">{branch.name}</p>
                <p className="text-[10px] text-app-fg-muted">{branch.code}</p>
              </div>
              {branch.id === currentBranchId && (
                <svg className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRole(role: string): string {
  return role
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
