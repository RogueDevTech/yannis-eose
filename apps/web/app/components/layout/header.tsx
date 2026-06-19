import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Form, Link, useNavigate, useSubmit, useNavigation, useLocation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Modal } from '~/components/ui/modal';
import { getAppLogoSrc } from '~/lib/theme';
import {
  canRoleSeeAllBranchesInHeader,
  shouldShowHeaderBranchSwitcher,
} from './header-branch-scope';
import { getNotificationLink, getNotificationAction, formatNotificationTime, formatNotificationDate } from '~/lib/notification-links';
import { clearLoaderCache } from '~/lib/loader-cache';
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
  /** Branch lifecycle status — `INACTIVE` branches stay in the switcher but are tagged. */
  status?: string;
  /** Branch group ("company") this branch belongs to. CEO directive 2026-06-10. */
  groupId?: string | null;
  /** Resolved company group name for display. */
  groupName?: string | null;
}

interface HeaderProps {
  user: {
    name: string;
    role: string;
    email: string;
  } | null;
  sidebarCollapsed: boolean;
  /** Whether the active app theme uses dark surfaces for theme-aware logo selection. */
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
  /** Multi-branch selection from session — CEO directive 2026-06-10. */
  selectedBranchIds?: string[] | null;
  /** Branch groups for SuperAdmin header group switcher. */
  branchGroups?: Array<{ id: string; name: string; status?: string }>;
  /**
   * When set, the header renders an "Exit Mirror" pill that posts to /auth/mirror/stop.
   * Surfaced from the layout, threaded down from `getCurrentUser`.
   */
  mirroredBy?: { id: string; name: string; role: string } | null;
  onSearchOpen?: () => void;
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
  selectedBranchIds,
  branchGroups,
  mirroredBy,
  onSearchOpen,
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
  const [isMobileBranchApplying, setIsMobileBranchApplying] = useState(false);
  const [mobileExpandedGroups, setMobileExpandedGroups] = useState<Set<string>>(new Set());
  const isMobileBranchSwitching =
    isMobileBranchApplying || (navigation.state !== 'idle' && navigation.formAction?.includes('/admin/branches/switch'));

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

  // Mobile multi-branch checkbox state — mirrors desktop HeaderBranchSwitcher logic.
  const mobileActiveGroups = useMemo(() => branchGroups?.filter((g) => g.status !== 'INACTIVE'), [branchGroups]);
  const mobileHasMultipleGroups = (mobileActiveGroups?.length ?? 0) > 1;
  const allMobileBranchIds = useMemo(() => (branches ?? []).map((b) => b.id), [branches]);
  // When multiple groups exist, default to first group to prevent cross-company mixing.
  const defaultMobileBranchIds = useMemo(() => {
    if (mobileHasMultipleGroups && mobileActiveGroups?.length) {
      const firstGroupId = mobileActiveGroups[0]!.id;
      return (branches ?? []).filter((b) => b.groupId === firstGroupId).map((b) => b.id);
    }
    return allMobileBranchIds;
  }, [mobileHasMultipleGroups, mobileActiveGroups, branches, allMobileBranchIds]);
  const defaultMobileBranchIdsKey = defaultMobileBranchIds.join(',');
  const [mobileChecked, setMobileChecked] = useState<Set<string>>(() => {
    if (selectedBranchIds && selectedBranchIds.length > 0) return new Set(selectedBranchIds);
    if (currentBranchId) return new Set([currentBranchId]);
    return new Set(defaultMobileBranchIds);
  });
  // Sync on external session changes.
  useEffect(() => {
    if (selectedBranchIds && selectedBranchIds.length > 0) {
      setMobileChecked(new Set(selectedBranchIds));
    } else if (currentBranchId) {
      setMobileChecked(new Set([currentBranchId]));
    } else {
      setMobileChecked(new Set(defaultMobileBranchIdsKey.split(',').filter(Boolean)));
    }
  }, [currentBranchId, selectedBranchIds, defaultMobileBranchIdsKey]);

  // Collapse all groups when mobile menu opens
  useEffect(() => {
    if (mobileUserMenuOpen) setMobileExpandedGroups(new Set());
  }, [mobileUserMenuOpen]);

  const mobileAllChecked = mobileChecked.size === allMobileBranchIds.length && allMobileBranchIds.every((id) => mobileChecked.has(id));
  const mobileNoneChecked = mobileChecked.size === 0;

  const handleMobileBranchApply = useCallback(async () => {
    if (!branches || isMobileBranchSwitching) return;
    clearLoaderCache();
    setIsMobileBranchApplying(true);

    let branchId = '';
    let selectedBranchIds = '';
    if (mobileAllChecked || mobileNoneChecked) {
      // All branches
    } else if (mobileChecked.size === 1) {
      branchId = [...mobileChecked][0]!;
    } else {
      selectedBranchIds = [...mobileChecked].join(',');
    }

    const body = new FormData();
    body.set('intent', 'switchBranch');
    body.set('branchId', branchId);
    body.set('selectedBranchIds', selectedBranchIds);

    await fetch('/admin/branches/switch', { method: 'POST', body });
    window.location.reload();
  }, [branches, isMobileBranchSwitching, mobileAllChecked, mobileNoneChecked, mobileChecked]);

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
        {/* Mobile hamburger — before logo. Sized to match the bell + avatar
            so the entire mobile top bar reads as one row of equal-weight
            chrome (CEO consistency directive). */}
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg text-app-fg hover:bg-app-hover transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        {/* Logo — mobile only, after menu bar. Use the same theme-aware asset
            selection as the sidebar so dark themes get the dark-surface logo and
            light themes get the light-surface logo. */}
        <Link
          to="/admin"
          className="lg:hidden flex items-center shrink-0 px-2 py-0.5 rounded-lg border border-app-logo-strip-border bg-app-logo-strip-bg"
          aria-label="Yannis home"
        >
          <img
            src={getAppLogoSrc(isDarkTheme)}
            alt="Yannis"
            className="h-[1.575rem] w-auto max-w-[108px] object-contain"
          />
        </Link>

      </div>

      {/* Branch + actions: single row with even gaps (avoids justify-between wedge between branch and bell). */}
      <div className="flex items-center gap-2 lg:gap-3 ml-auto min-w-0">
        {onSearchOpen && (
          <button
            type="button"
            onClick={onSearchOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-app-fg-muted hover:text-app-fg hover:bg-app-hover transition-colors"
            aria-label="Search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </button>
        )}
        {!branchesHydrationReady && (
          <div
            className="hidden lg:flex items-center shrink-0 h-9 w-[min(12rem,28vw)] rounded-md bg-app-hover animate-pulse"
            aria-hidden
          />
        )}
        {branchesHydrationReady &&
          branches &&
          shouldShowHeaderBranchSwitcher(branches.length, user?.role ?? '') && (
            <div className="hidden lg:flex items-center shrink-0">
              <HeaderBranchSwitcher
                branches={branches}
                branchGroups={branchGroups}
                currentBranchId={currentBranchId ?? null}
                userRole={user?.role ?? ''}
                selectedBranchIds={selectedBranchIds}
              />
            </div>
          )}
        {/* Static branch label — single-branch non-admin users still see which branch they're in */}
        {branchesHydrationReady &&
          branches &&
          branches.length === 1 &&
          !shouldShowHeaderBranchSwitcher(branches.length, user?.role ?? '') && (
            <div className="hidden lg:flex items-center shrink-0">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-app-bg-secondary px-3 py-1 text-xs font-medium text-app-fg-muted">
                {branches[0]?.name}
              </span>
            </div>
          )}
        {/* Mirror Mode pill — only shown when the session is mirroring another user.
            POSTs to the same /admin action that exits mirror; returns to /admin when done. */}
        {mirroredBy && (
          // POSTs to the LAYOUT route (no `?index`) — the action handler that calls
          // `/auth/mirror/stop` lives in routes/admin/route.tsx. Adding `?index` would
          // route it to admin._index which has no action and 500s.
          <Form method="post" action="/admin" className="inline-flex" data-mirror-allow="" onSubmit={() => clearLoaderCache()}>
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
                    className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-app-fg hover:bg-app-hover transition-colors"
                    aria-label="Notifications"
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
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-micro font-bold bg-danger-500 text-white rounded-full">
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
                                            <p className="text-mini text-app-fg-muted">
                                              {timeAgo(n.createdAt)}
                                            </p>
                                            {link && (
                                              <span className="text-mini text-brand-500 dark:text-brand-400">
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
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-app-hover transition-colors"
              aria-label="Account menu"
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
                    <p className="text-micro uppercase tracking-wider font-semibold text-app-fg-muted">
                      Branch
                    </p>
                  </div>

                  {mobileCanSwitchBranches ? (
                    <div className="pb-1">
                      {/* Select All checkbox — shown when 2+ branches; hidden when multiple groups exist (group headers handle it) */}
                      {(branches?.length ?? 0) > 1 && !mobileHasMultipleGroups && (
                        <label className="w-full flex items-center gap-3 px-5 py-2.5 text-sm cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={mobileAllChecked}
                            onChange={() => {
                              if (mobileAllChecked) setMobileChecked(new Set());
                              else setMobileChecked(new Set(allMobileBranchIds));
                            }}
                            className="w-4 h-4 rounded border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border"
                          />
                          <span className="text-app-fg font-medium">All Branches</span>
                        </label>
                      )}

                      {mobileHasMultipleGroups && mobileActiveGroups ? (
                        // Grouped accordion view for multi-company
                        mobileActiveGroups.map((group) => {
                          const groupBranches = (branches ?? []).filter((b) => b.groupId === group.id);
                          const groupAllChecked = groupBranches.length > 0 && groupBranches.every((b) => mobileChecked.has(b.id));
                          const groupSomeChecked = groupBranches.some((b) => mobileChecked.has(b.id));
                          const isExpanded = mobileExpandedGroups.has(group.id);
                          return (
                            <div key={group.id} className="mb-0.5">
                              <div className="flex items-center gap-3 px-5 py-2.5">
                                <input
                                  type="checkbox"
                                  checked={groupAllChecked}
                                  ref={(el) => { if (el) el.indeterminate = groupSomeChecked && !groupAllChecked; }}
                                  onChange={() => {
                                    setMobileChecked((prev) => {
                                      const next = new Set(prev);
                                      if (groupAllChecked) {
                                        groupBranches.forEach((b) => next.delete(b.id));
                                      } else {
                                        // Clear other groups first
                                        for (const id of prev) {
                                          const b = (branches ?? []).find((br) => br.id === id);
                                          if (b?.groupId && b.groupId !== group.id) next.delete(id);
                                        }
                                        groupBranches.forEach((b) => next.add(b.id));
                                      }
                                      return next;
                                    });
                                  }}
                                  className="w-4 h-4 rounded border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border flex-shrink-0 cursor-pointer"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMobileExpandedGroups((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(group.id)) next.delete(group.id);
                                      else next.add(group.id);
                                      return next;
                                    });
                                  }}
                                  className="flex items-center gap-1.5 flex-1 min-w-0 select-none cursor-pointer"
                                >
                                  <svg
                                    className={`w-3.5 h-3.5 text-app-fg-muted flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2.5}
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                  </svg>
                                  <span className="text-sm font-semibold text-app-fg truncate">{group.name}</span>
                                  <span className="text-xs text-app-fg-muted flex-shrink-0">({groupBranches.length})</span>
                                </button>
                              </div>
                              {isExpanded && groupBranches.map((branch) => {
                                const isInactive = branch.status != null && branch.status !== 'ACTIVE';
                                const isBranchChecked = mobileChecked.has(branch.id);
                                return (
                                  <label
                                    key={branch.id}
                                    className="w-full flex items-center gap-3 pl-10 pr-5 py-2 text-sm cursor-pointer select-none"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isBranchChecked}
                                      onChange={() => {
                                        setMobileChecked((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(branch.id)) {
                                            next.delete(branch.id);
                                          } else {
                                            if (branch.groupId) {
                                              for (const id of prev) {
                                                const b = (branches ?? []).find((br) => br.id === id);
                                                if (b?.groupId && b.groupId !== branch.groupId) next.delete(id);
                                              }
                                            }
                                            next.add(branch.id);
                                          }
                                          return next;
                                        });
                                      }}
                                      className="w-4 h-4 rounded border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border flex-shrink-0"
                                    />
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded text-micro font-bold flex-shrink-0 bg-app-hover text-app-fg-muted">
                                      {branch.code.slice(0, 2)}
                                    </span>
                                    <span className="truncate text-app-fg">{branch.name}</span>
                                    {isInactive && (
                                      <span className="text-micro font-medium uppercase tracking-wide text-app-fg-muted bg-app-hover px-1.5 py-0.5 rounded ml-auto flex-shrink-0">
                                        Inactive
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          );
                        })
                      ) : (
                        // Flat view for single-group
                        branches.map((branch) => {
                          const isInactive = branch.status != null && branch.status !== 'ACTIVE';
                          const isBranchChecked = mobileChecked.has(branch.id);
                          return (
                            <label
                              key={branch.id}
                              className="w-full flex items-center gap-3 px-5 py-2 text-sm cursor-pointer select-none"
                            >
                              <input
                                type="checkbox"
                                checked={isBranchChecked}
                                onChange={() => {
                                  setMobileChecked((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(branch.id)) {
                                      next.delete(branch.id);
                                    } else {
                                      next.add(branch.id);
                                    }
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 rounded border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border flex-shrink-0"
                              />
                              <span className="truncate text-app-fg">{branch.name}</span>
                              <span className="flex items-center gap-1.5 text-micro ml-auto">
                                {isInactive && (
                                  <span className="font-medium uppercase tracking-wide text-app-fg-muted bg-app-hover px-1.5 py-0.5 rounded">
                                    Inactive
                                  </span>
                                )}
                                <span className="font-mono text-app-fg-muted">{branch.code}</span>
                              </span>
                            </label>
                          );
                        })
                      )}

                      {/* Apply button */}
                      <div className="px-5 pt-2 pb-1">
                        <button
                          type="button"
                          onClick={handleMobileBranchApply}
                          disabled={isMobileBranchSwitching || mobileNoneChecked}
                          className="w-full text-sm font-semibold py-2 px-3 rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isMobileBranchSwitching ? 'Applying...' : mobileNoneChecked ? 'Select at least one' : 'Apply'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-5 pb-2">
                      <div className="flex items-center justify-between rounded-md bg-app-hover px-3 py-2">
                        <span className="text-sm text-app-fg truncate">
                          {mobileCurrentBranch?.name ?? 'Branch'}
                        </span>
                        {mobileCurrentBranch?.code && (
                          <span className="text-micro font-mono text-app-fg-muted">
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
  branchGroups,
  currentBranchId,
  userRole,
  selectedBranchIds: initialSelectedBranchIds,
}: {
  branches: BranchInfo[];
  branchGroups?: Array<{ id: string; name: string; status?: string }>;
  currentBranchId: string | null;
  userRole: string;
  selectedBranchIds?: string[] | null;
}) {
  // Only show active groups in the branch filter dropdown
  const activeGroups = useMemo(() => branchGroups?.filter((g) => g.status !== 'INACTIVE'), [branchGroups]);
  // Hide branches whose group is inactive
  const inactiveGroupIds = useMemo(() => {
    if (!branchGroups) return new Set<string>();
    return new Set(branchGroups.filter((g) => g.status === 'INACTIVE').map((g) => g.id));
  }, [branchGroups]);
  const visibleBranches = useMemo(
    () => branches.filter((b) => !b.groupId || !inactiveGroupIds.has(b.groupId)),
    [branches, inactiveGroupIds],
  );
  const [open, setOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  // Accordion state for grouped branch view — tracks which group IDs are expanded.
  // Default: expand only the group that has checked branches (or the first group).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const ref = useRef<HTMLDivElement>(null);
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = isApplying || (navigation.state !== 'idle' && navigation.formAction === '/admin/branches/switch');

  const canSeeAllBranches = canRoleSeeAllBranchesInHeader(userRole);
  const canSwitch = shouldShowHeaderBranchSwitcher(visibleBranches.length, userRole);

  // Org-wide roles (non-branch-eligible, non-admin) see a simplified group-level
  // switcher instead of individual branch checkboxes.
  const BRANCH_ELIGIBLE_HEADER = new Set(['MEDIA_BUYER', 'HEAD_OF_MARKETING', 'CS_CLOSER', 'HEAD_OF_CS', 'BRANCH_ADMIN']);
  const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);
  const isOrgWideRole = !BRANCH_ELIGIBLE_HEADER.has(userRole) && !ADMIN_ROLES.has(userRole);

  // Derive unique groups from the user's branches (for org-wide group switcher)
  const derivedGroups = useMemo(() => {
    if (!isOrgWideRole) return [];
    const groupMap = new Map<string, { id: string; name: string; branchIds: string[] }>();
    for (const b of visibleBranches) {
      if (!b.groupId) continue;
      const existing = groupMap.get(b.groupId);
      if (existing) {
        existing.branchIds.push(b.id);
      } else {
        // Use activeGroups for name if available, else fallback
        const groupName = b.groupName ?? activeGroups?.find((g) => g.id === b.groupId)?.name ?? b.groupId;
        groupMap.set(b.groupId, { id: b.groupId, name: groupName, branchIds: [b.id] });
      }
    }
    return [...groupMap.values()];
  }, [isOrgWideRole, visibleBranches, activeGroups]);

  // When multiple groups exist, toggling a branch must clear branches from other groups
  // to prevent cross-company data mixing.
  const hasMultipleGroups = (activeGroups?.length ?? 0) > 1 || derivedGroups.length > 1;

  // Multi-select state: checked branch IDs within the open dropdown.
  // Initialised from session state; defaults to all visible branches checked.
  const allBranchIds = useMemo(() => visibleBranches.map((b) => b.id), [visibleBranches]);
  // When multiple groups exist, "all" defaults to the first group's branches
  // to prevent cross-company data mixing.
  const defaultBranchIds = useMemo(() => {
    if (hasMultipleGroups && activeGroups?.length) {
      const firstGroupId = activeGroups[0]!.id;
      return visibleBranches.filter((b) => b.groupId === firstGroupId).map((b) => b.id);
    }
    return allBranchIds;
  }, [hasMultipleGroups, activeGroups, visibleBranches, allBranchIds]);
  // Stable string key so the sync effect only fires when IDs actually change.
  const defaultBranchIdsKey = defaultBranchIds.join(',');
  const selectedIdsKey = initialSelectedBranchIds?.join(',') ?? '';
  const [checked, setChecked] = useState<Set<string>>(() => {
    if (initialSelectedBranchIds && initialSelectedBranchIds.length > 0) {
      return new Set(initialSelectedBranchIds);
    }
    if (currentBranchId) return new Set([currentBranchId]);
    return new Set(defaultBranchIds);
  });

  // Sync when session changes externally (e.g. mirror mode, other tab)
  useEffect(() => {
    if (selectedIdsKey) {
      setChecked(new Set(selectedIdsKey.split(',')));
    } else if (currentBranchId) {
      setChecked(new Set([currentBranchId]));
    } else {
      setChecked(new Set(defaultBranchIdsKey.split(',').filter(Boolean)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranchId, selectedIdsKey, defaultBranchIdsKey]);

  // Collapse all groups when the dropdown opens
  useEffect(() => {
    if (open) setExpandedGroups(new Set());
  }, [open]);

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

  const allChecked = checked.size === allBranchIds.length && allBranchIds.every((id) => checked.has(id));
  const noneChecked = checked.size === 0;

  const handleToggle = (branchId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) {
        next.delete(branchId);
      } else {
        // If multi-group, clear branches from other groups first
        if (hasMultipleGroups) {
          const targetBranch = visibleBranches.find((b) => b.id === branchId);
          if (targetBranch?.groupId) {
            for (const id of prev) {
              const b = visibleBranches.find((br) => br.id === id);
              if (b?.groupId && b.groupId !== targetBranch.groupId) next.delete(id);
            }
          }
        }
        next.add(branchId);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (allChecked) {
      setChecked(new Set());
    } else {
      setChecked(new Set(allBranchIds));
    }
  };

  const handleApply = async () => {
    clearLoaderCache();
    setIsApplying(true);

    let branchId = '';
    let selectedBranchIds = '';
    if (allChecked || noneChecked) {
      // All checked or none = "All Branches" (no filter)
    } else if (checked.size === 1) {
      branchId = [...checked][0]!;
    } else {
      selectedBranchIds = [...checked].join(',');
    }

    const body = new FormData();
    body.set('intent', 'switchBranch');
    body.set('branchId', branchId);
    body.set('selectedBranchIds', selectedBranchIds);

    // POST via fetch (not Remix submit) so we can hard-reload after the
    // session cookie is updated — guarantees every loader refetches with
    // the new branch scope instead of reusing stale React state.
    await fetch('/admin/branches/switch', { method: 'POST', body });
    window.location.reload();
  };

  // Non-global, single-branch user — static pill, no switcher
  if (!canSwitch) {
    const display = visibleBranches.find((b) => b.id === currentBranchId) ?? visibleBranches[0];
    if (!display) return null;
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-hover border border-app-border">
        <svg className="w-3.5 h-3.5 text-app-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        <span className="text-xs font-semibold text-app-fg">{display.name}</span>
        <span className="text-micro text-app-fg-muted font-mono bg-app-hover px-1 rounded">
          {display.code}
        </span>
      </div>
    );
  }

  // Trigger label — reflects the current applied state, not the in-progress checkboxes.
  // Intersect session selectedBranchIds with visibleBranches so the count never
  // exceeds what the user can actually see (the session may contain group-wide IDs
  // that include branches the user isn't assigned to).
  const visibleSelectedIds = useMemo(() => {
    if (!initialSelectedBranchIds?.length) return [];
    const visibleSet = new Set(visibleBranches.map((b) => b.id));
    return initialSelectedBranchIds.filter((id) => visibleSet.has(id));
  }, [initialSelectedBranchIds, visibleBranches]);
  const allVisibleSelected = visibleSelectedIds.length > 0 && visibleSelectedIds.length === visibleBranches.length;
  const isAllBranches = canSeeAllBranches && !currentBranchId && (visibleSelectedIds.length === 0 || allVisibleSelected);
  const isMultiBranch = visibleSelectedIds.length > 1;
  const currentBranch = visibleBranches.find((b) => b.id === currentBranchId) ?? null;
  // When all branches of a single group are selected, show the group name —
  // but only when multiple groups exist (multi-company). Single-group setups
  // show "All Branches" since the group name adds no context.
  const selectedGroupLabel = useMemo(() => {
    if (!isMultiBranch || !hasMultipleGroups || !activeGroups?.length || !visibleSelectedIds.length) return null;
    for (const group of activeGroups) {
      const groupBranches = visibleBranches.filter((b) => b.groupId === group.id);
      if (groupBranches.length > 0 && groupBranches.length === visibleSelectedIds.length &&
          groupBranches.every((b) => visibleSelectedIds.includes(b.id))) {
        return group.name;
      }
    }
    return null;
  }, [isMultiBranch, hasMultipleGroups, activeGroups, visibleBranches, visibleSelectedIds]);
  const appliedSet = useMemo(() => new Set(visibleSelectedIds), [visibleSelectedIds]);
  const triggerLabel = isOrgWideRole && derivedGroups.length === 1
    ? derivedGroups[0]!.name
    : isOrgWideRole && derivedGroups.length > 1
      ? (derivedGroups.find((g) => g.branchIds.every((id) => appliedSet.has(id)))?.name ?? derivedGroups[0]!.name)
    : isAllBranches
    ? 'All Branches'
    : isMultiBranch
      ? (selectedGroupLabel ?? `${visibleSelectedIds.length} Branches`)
      : visibleSelectedIds.length === 1
        ? (visibleBranches.find((b) => b.id === visibleSelectedIds[0])?.name ?? 'Select Branch')
        : (currentBranch?.name ?? 'Select Branch');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-hover border border-app-border hover:bg-app-hover transition-colors duration-150 text-left"
        disabled={isSubmitting}
      >
        {(isAllBranches || isMultiBranch) ? (
          <svg className="w-3.5 h-3.5 text-brand-500 dark:text-brand-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-app-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        )}
        <span className={`text-xs font-semibold truncate max-w-[140px] ${(isAllBranches || isMultiBranch) ? 'text-brand-600 dark:text-brand-400' : 'text-app-fg'}`}>
          {triggerLabel}
        </span>
        {!isAllBranches && !isMultiBranch && currentBranch?.code && (
          <span className="text-micro text-app-fg-muted font-mono bg-app-hover px-1 rounded">
            {currentBranch.code}
          </span>
        )}
        {isSubmitting ? (
          <svg className="w-3 h-3 ml-0.5 flex-shrink-0 animate-spin text-brand-500 dark:text-brand-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className={`w-3 h-3 text-app-fg-muted ml-0.5 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 min-w-[240px] bg-app-elevated border border-app-border rounded-lg shadow-lg z-50 overflow-hidden animate-fade-in">
          <p className="px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-wider text-app-fg-muted">
            Filter Branches
          </p>

          {/* Org-wide roles: simplified group-level radio switcher */}
          {isOrgWideRole && derivedGroups.length > 0 ? (
            <div className="py-1 max-h-[320px] overflow-y-auto">
              {derivedGroups.length === 1 ? (
                <div className="px-3 py-2.5">
                  <span className="text-xs font-semibold text-app-fg">{derivedGroups[0]!.name}</span>
                </div>
              ) : (
                derivedGroups.map((group) => {
                  const isSelected = group.branchIds.every((id) => checked.has(id));
                  return (
                    <label
                      key={group.id}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-app-hover transition-colors duration-100 cursor-pointer select-none"
                    >
                      <input
                        type="radio"
                        name="orgwide-group"
                        checked={isSelected}
                        onChange={() => {
                          setChecked(new Set(group.branchIds));
                        }}
                        className="w-4 h-4 border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border"
                      />
                      <span className="text-xs font-semibold text-app-fg">{group.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          ) : (
          <>
          {/* Select All checkbox — shown when 2+ branches visible; hidden when multiple groups exist (group headers serve as select-all) */}
          {visibleBranches.length > 1 && !(activeGroups && activeGroups.length > 1) && (
            <>
              <label className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-app-hover transition-colors duration-100 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={handleToggleAll}
                  className="w-4 h-4 rounded border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border"
                />
                <span className="text-xs font-medium text-app-fg">All Branches</span>
              </label>
              <div className="mx-3 border-t border-app-border" />
            </>
          )}

          {/* Branch checkboxes — grouped by branch group for SuperAdmin, flat for others */}
          <div className="py-1 max-h-[320px] overflow-y-auto">
            {activeGroups && activeGroups.length > 1 ? (
              // Grouped view: branches organized under their group headers
              activeGroups.map((group) => {
                const groupBranches = visibleBranches.filter((b) => b.groupId === group.id);
                const groupAllChecked = groupBranches.length > 0 && groupBranches.every((b) => checked.has(b.id));
                const groupSomeChecked = groupBranches.some((b) => checked.has(b.id));
                const isExpanded = expandedGroups.has(group.id);
                return (
                  <div key={group.id} className="mb-0.5">
                    {/* Group header row: checkbox + clickable accordion toggle */}
                    <div className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-app-hover transition-colors duration-100">
                      <input
                        type="checkbox"
                        checked={groupAllChecked}
                        ref={(el) => { if (el) el.indeterminate = groupSomeChecked && !groupAllChecked; }}
                        onChange={() => {
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (groupAllChecked) {
                              groupBranches.forEach((b) => next.delete(b.id));
                            } else {
                              if (hasMultipleGroups) {
                                for (const id of prev) {
                                  const b = visibleBranches.find((br) => br.id === id);
                                  if (b?.groupId && b.groupId !== group.id) next.delete(id);
                                }
                              }
                              groupBranches.forEach((b) => next.add(b.id));
                            }
                            return next;
                          });
                        }}
                        className="w-4 h-4 rounded border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border flex-shrink-0 cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          });
                        }}
                        className="flex items-center gap-1.5 flex-1 min-w-0 select-none cursor-pointer"
                      >
                        <svg
                          className={`w-3 h-3 text-app-fg-muted flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="text-xs font-semibold text-app-fg truncate">{group.name}</span>
                        <span className="text-micro text-app-fg-muted flex-shrink-0">({groupBranches.length})</span>
                      </button>
                    </div>
                    {/* Individual branches — collapsible */}
                    {isExpanded && groupBranches.map((branch) => {
                      const isInactive = branch.status != null && branch.status !== 'ACTIVE';
                      const isChecked = checked.has(branch.id);
                      return (
                        <label
                          key={branch.id}
                          className="w-full flex items-center gap-2.5 pl-8 pr-3 py-1 hover:bg-app-hover transition-colors duration-100 cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggle(branch.id)}
                            className="w-3.5 h-3.5 rounded border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border flex-shrink-0"
                          />
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded text-micro font-bold flex-shrink-0 bg-app-hover text-app-fg-muted">
                            {branch.code.slice(0, 2)}
                          </span>
                          <span className={`text-xs truncate ${isInactive ? 'text-app-fg-muted' : 'text-app-fg'}`}>
                            {branch.name}
                          </span>
                          {isInactive && (
                            <span className="text-micro font-medium uppercase tracking-wide text-app-fg-muted bg-app-hover px-1 py-0.5 rounded flex-shrink-0">
                              Inactive
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              // Flat view: no groups or non-SuperAdmin
              visibleBranches.map((branch) => {
                const isInactive = branch.status != null && branch.status !== 'ACTIVE';
                const isChecked = checked.has(branch.id);
                return (
                  <label
                    key={branch.id}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-app-hover transition-colors duration-100 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggle(branch.id)}
                      className="w-4 h-4 rounded border-app-border text-brand-600 focus:ring-brand-500 dark:bg-app-bg dark:border-app-border flex-shrink-0"
                    />
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded text-micro font-bold flex-shrink-0 bg-app-hover text-app-fg-muted">
                      {branch.code.slice(0, 2)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${isInactive ? 'text-app-fg-muted' : 'text-app-fg'}`}>
                        {branch.name}
                      </p>
                    </div>
                    {isInactive && (
                      <span className="text-micro font-medium uppercase tracking-wide text-app-fg-muted bg-app-hover px-1.5 py-0.5 rounded flex-shrink-0">
                        Inactive
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
          </>
          )}

          {/* Apply button */}
          <div className="border-t border-app-border px-3 py-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={isSubmitting || noneChecked}
              className="w-full text-xs font-semibold py-1.5 px-3 rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Applying...' : noneChecked ? 'Select at least one' : 'Apply'}
            </button>
          </div>
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
