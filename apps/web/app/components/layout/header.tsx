import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Form, Link, useNavigate } from '@remix-run/react';
import { SearchModal, useSearchShortcut } from '~/components/ui/search-modal';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
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

interface HeaderProps {
  user: {
    name: string;
    role: string;
    email: string;
  } | null;
  sidebarCollapsed: boolean;
  darkMode: boolean;
  notificationsPromise: Promise<{ notifications: Notification[]; unreadCount: number }>;
  realtimeNotifications?: Notification[];
  realtimeCount?: number;
  socketConnected?: boolean;
  onToggleDarkMode: () => void;
  onMobileMenuToggle: () => void;
  onRemoveRealtimeNotification?: (id: string) => void;
  onPruneServerKnown?: (serverIds: Set<string>) => void;
  onClearRealtimeNotifications?: () => void;
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

export function Header({ user, sidebarCollapsed, darkMode, notificationsPromise, realtimeNotifications = [], realtimeCount: _realtimeCount = 0, socketConnected, onToggleDarkMode, onMobileMenuToggle, onRemoveRealtimeNotification, onPruneServerKnown, onClearRealtimeNotifications }: HeaderProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifTriggerRef = useRef<HTMLButtonElement>(null);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { displayUnreadCount, isOptimisticallyRead, markAsRead, markAllRead } = useNotificationsState();

  useSearchShortcut(() => setSearchOpen(true));

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
      markAsRead(notif.id);
      onRemoveRealtimeNotification?.(notif.id);
    }
  }, [markAsRead, onRemoveRealtimeNotification]);

  return (
    <header
      className={`fixed top-0 right-0 z-30 h-[var(--header-height)] bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between px-4 lg:px-6 transition-all duration-300 left-0 ${
        sidebarCollapsed
          ? 'lg:left-[var(--sidebar-collapsed-width)]'
          : 'lg:left-[var(--sidebar-width)]'
      }`}
    >
      {/* Left: mobile menu + logo (mobile) + search */}
      <div className="flex items-center gap-3 flex-1 max-w-lg">
        {/* Mobile hamburger — before logo */}
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden p-1.5 rounded-lg text-surface-800 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        {/* Logo — mobile only, after menu bar */}
        <Link
          to="/admin"
          className="lg:hidden flex items-center shrink-0"
          aria-label="Yannis home"
        >
          <img
            src={darkMode ? '/assets/yannis-logo1.png' : '/assets/yannis-logo-white-bg.png'}
            alt="Yannis"
            className="h-[1.575rem] w-auto max-w-[108px] object-contain"
          />
        </Link>

        {/* Search trigger */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="relative w-full hidden sm:flex items-center gap-2 pl-10 pr-3 py-1.5 text-sm text-surface-800 bg-surface-50 dark:text-surface-200 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg hover:border-surface-300 dark:hover:border-surface-600 transition-colors"
        >
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-700 dark:text-surface-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <span>Search orders, products, users...</span>
          <kbd className="ml-auto px-1.5 py-0.5 text-[10px] bg-surface-100 dark:bg-surface-700 rounded font-mono">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right side: dark mode + notifications + user */}
      <div className="flex items-center gap-2 lg:gap-3">
        {/* Dark mode toggle */}
        <button
          onClick={onToggleDarkMode}
          className="p-1.5 rounded-lg text-surface-800 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 transition-colors"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
            </svg>
          )}
        </button>

        {/* Notifications bell — deferred so layout loads immediately */}
        <div className="relative">
          <DeferredSection resolve={notificationsPromise} skeleton="inline">
            {({ notifications, unreadCount }) => {
              // Deduplicate: only include realtime notifications NOT already in the server list
              const serverIds = new Set(notifications.map((n: Notification) => n.id));
              const uniqueRealtime = realtimeNotifications.filter((n) => !serverIds.has(n.id));
              const mergedNotifications = [...uniqueRealtime, ...notifications];
              const serverUnread = unreadCount + uniqueRealtime.length;
              const mergedUnreadCount = displayUnreadCount(serverUnread);
              return (
                <>
                  <SyncNotificationReadIds notifications={notifications} onPruneServerKnown={onPruneServerKnown} />
                  <button
                    ref={notifTriggerRef}
                    onClick={() => setNotifOpen(!notifOpen)}
                    className="relative p-1.5 rounded-lg text-surface-800 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 transition-colors"
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
                        className={`absolute bottom-0.5 left-0.5 w-2 h-2 rounded-full border border-white dark:border-surface-900 ${
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
                          className="fixed top-0 right-0 h-full w-full max-w-md sm:max-w-lg bg-white dark:bg-surface-800 shadow-2xl z-[101] flex flex-col animate-slide-in-right"
                          role="dialog"
                          aria-label="Notifications"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between px-4 py-4 border-b border-surface-100 dark:border-surface-700 flex-shrink-0">
                            <h3 className="text-base font-semibold text-surface-900 dark:text-white">
                              Notifications
                              {mergedUnreadCount > 0 && (
                                <span className="ml-1.5 text-sm text-surface-800 dark:text-surface-300 font-normal">
                                  ({mergedUnreadCount} unread)
                                </span>
                              )}
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
                                className="p-1.5 rounded-lg text-surface-600 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700 transition-colors"
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
                                <svg className="w-12 h-12 text-surface-400 dark:text-surface-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                                </svg>
                                <p className="text-sm text-surface-600 dark:text-surface-300">No notifications yet</p>
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
                                      className={`w-full text-left px-4 py-3 border-b border-surface-50 dark:border-surface-700/50 hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors cursor-pointer ${
                                        !isRead ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''
                                      }`}
                                    >
                                      <div className="flex items-start gap-2.5">
                                        <div className={`w-2 h-2 mt-1.5 rounded-full flex-shrink-0 ${
                                          !isRead ? dotColor : 'bg-transparent'
                                        }`} />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-surface-900 dark:text-surface-100 leading-tight">
                                            {n.title}
                                          </p>
                                          {n.body && (
                                            <p className="text-xs text-surface-800 dark:text-surface-200 mt-0.5 line-clamp-2">
                                              {n.body}
                                            </p>
                                          )}
                                          <div className="flex items-center gap-2 mt-1">
                                            <p className="text-[11px] text-surface-700 dark:text-surface-300">
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
                            <div className="px-4 py-3 border-t border-surface-100 dark:border-surface-700 flex-shrink-0">
                              <a
                                href="/admin/notifications"
                                className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
                                onClick={() => setNotifOpen(false)}
                              >
                                View all notifications
                              </a>
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
                          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[111] w-full max-w-md max-h-[90dvh] flex flex-col bg-white dark:bg-surface-800 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700 mx-4 animate-fade-in"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-start justify-between gap-3 p-5 pb-0 flex-shrink-0">
                            <h2 id="notification-detail-title" className="text-lg font-semibold text-surface-900 dark:text-white pr-8">
                              {selectedNotification.title}
                            </h2>
                            <button
                              type="button"
                              onClick={() => setSelectedNotification(null)}
                              className="p-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors -mt-1 -mr-1"
                              aria-label="Close"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                            {selectedNotification.body ? (
                              <p className="text-sm text-surface-700 dark:text-surface-200 whitespace-pre-wrap">
                                {selectedNotification.body}
                              </p>
                            ) : (
                              <p className="text-sm text-surface-500 dark:text-surface-400 italic">No additional message.</p>
                            )}
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-4">
                              {formatNotificationDate(selectedNotification.createdAt)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 p-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-surface-100 dark:border-surface-700 flex-shrink-0">
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
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 pl-2 lg:pl-3 border-l border-surface-200 dark:border-surface-700 hover:opacity-80 transition-opacity"
            >
              <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center">
                <span className="text-xs font-semibold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="hidden md:block min-w-0 text-left">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate leading-tight">
                  {user.name}
                </p>
                <p className="text-2xs text-surface-800 dark:text-surface-200 truncate">
                  {formatRole(user.role)}
                </p>
              </div>
              <svg
                className={`w-4 h-4 text-surface-700 dark:text-surface-200 hidden md:block transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {/* Dropdown menu */}
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-lg bg-white dark:bg-surface-800 shadow-lg border border-surface-200 dark:border-surface-700 py-1 animate-fade-in z-50">
                {/* User info (mobile) */}
                <div className="md:hidden px-4 py-3 border-b border-surface-100 dark:border-surface-700">
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">
                    {user.name}
                  </p>
                  <p className="text-xs text-surface-500 dark:text-surface-200">
                    {user.email}
                  </p>
                  <p className="text-2xs text-surface-700 dark:text-surface-300 mt-0.5">
                    {formatRole(user.role)}
                  </p>
                </div>

                {/* Email on desktop */}
                <div className="hidden md:block px-4 py-2 border-b border-surface-100 dark:border-surface-700">
                  <p className="text-xs text-surface-800 dark:text-surface-200 truncate">
                    {user.email}
                  </p>
                </div>

                {/* Menu items */}
                <div className="py-1">
                  <a
                    href="/admin/settings"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
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
                <div className="border-t border-surface-100 dark:border-surface-700 py-1">
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
          </div>
        )}
      </div>
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}

function formatRole(role: string): string {
  return role
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
