import { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigation } from '@remix-run/react';
import { Sidebar, SidebarIcons, type SidebarGroup } from './sidebar';
import { Header } from './header';
import { useSocket, useRealtimeNotifications } from '~/hooks/useSocket';
import { ToastProvider } from '~/components/ui/toast';
import { NotificationsStateProvider, useNotificationsState } from '~/contexts/notifications-state';
import { subscribeToPush } from '~/lib/offline-sync';
import { RouteLoader } from '~/components/ui/route-loader';
import { CSOverviewSkeleton } from '~/features/cs/CSOverviewSkeleton';
import { playNotificationSound, unlockAudioContext } from '~/lib/notification-sound';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
  data?: Record<string, unknown> | null;
}

export type NotificationsPromise = Promise<{ notifications: Notification[]; unreadCount: number }>;

interface DashboardLayoutProps {
  user: {
    name: string;
    role: string;
    email: string;
    permissions?: string[];
  } | null;
  notificationsPromise: NotificationsPromise;
  /** Route action URL for notification mark-read (e.g. /admin or /hr). */
  notificationsActionUrl?: string;
}

interface NavItemDef {
  label: string;
  href: string;
  icon: React.ReactNode;
  permission?: string; // undefined = all authenticated users
  /** If set, these roles can see the item without needing the permission. */
  roles?: string[];
}

interface NavGroupDef {
  group: string | null;
  items: NavItemDef[];
}

const navStructure: NavGroupDef[] = [
  {
    group: null,
    items: [
      { label: 'Dashboard', href: '/admin', icon: SidebarIcons.dashboard },
    ],
  },
  {
    group: 'MARKETING',
    items: [
      { label: 'Live Activities', href: '/admin/marketing/overview', icon: SidebarIcons.marketing, permission: 'marketing.teamOverview', roles: ['SUPER_ADMIN', 'HEAD_OF_MARKETING'] },
      { label: 'Team', href: '/admin/marketing/team', icon: SidebarIcons.marketing, permission: 'marketing.teamOverview', roles: ['SUPER_ADMIN', 'HEAD_OF_MARKETING'] },
      { label: 'Marketing Orders', href: '/admin/marketing/orders', icon: SidebarIcons.orders, permission: 'marketing.orders' },
      { label: 'Funding & Ad Spend', href: '/admin/marketing/funding', icon: SidebarIcons.marketing, permission: 'marketing.read' },
      { label: 'Forms', href: '/admin/marketing/forms', icon: SidebarIcons.campaigns, permission: 'marketing.campaigns' },
      { label: 'Marketing Leaderboard', href: '/admin/marketing/leaderboard', icon: SidebarIcons.leaderboards, permission: 'marketing.leaderboard' },
    ],
  },
  {
    group: 'SALES & CS',
    items: [
      { label: 'Live Activities', href: '/admin/cs/queue', icon: SidebarIcons.cs, permission: 'cs.teamOverview' },
      { label: 'Team', href: '/admin/cs/team', icon: SidebarIcons.cs, permission: 'cs.teamOverview', roles: ['SUPER_ADMIN', 'HEAD_OF_CS'] },
      { label: 'CS Orders', href: '/admin/cs/orders', icon: SidebarIcons.orders, permission: 'orders.read' },
      { label: 'CS Leaderboard', href: '/admin/cs/leaderboard', icon: SidebarIcons.leaderboards, permission: 'cs.leaderboard' },
    ],
  },
  {
    group: 'LOGISTICS',
    items: [
      { label: 'Partners', href: '/admin/logistics/partners', icon: SidebarIcons.logistics, permission: 'logistics.read' },
      { label: 'Logistics Orders', href: '/admin/logistics/orders', icon: SidebarIcons.orders, permission: 'logistics.read' },
      { label: 'Delivery confirmations', href: '/admin/logistics/delivery-confirmations', icon: SidebarIcons.orders, permission: 'logistics.read' },
      { label: 'Remittances', href: '/admin/logistics/remittances', icon: SidebarIcons.logistics, permission: 'logistics.write' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'Finance', href: '/admin/finance/overview', icon: SidebarIcons.finance, permission: 'finance.read' },
      { label: 'Delivery remittances', href: '/admin/finance/delivery-remittances', icon: SidebarIcons.finance, permission: 'finance.read' },
      { label: 'Disbursements', href: '/admin/finance/disbursements', icon: SidebarIcons.finance, permission: 'finance.disburse' },
    ],
  },
  {
    group: 'Warehouse',
    items: [
      { label: 'Inventory', href: '/admin/inventory', icon: SidebarIcons.inventory, permission: 'inventory.read' },
      { label: 'Transfers', href: '/admin/transfers', icon: SidebarIcons.transfers, permission: 'transfers.read' },
      { label: 'Returns', href: '/admin/returns', icon: SidebarIcons.returns, permission: 'returns.read' },
    ],
  },
  {
    group: 'Catalog',
    items: [
      { label: 'Products', href: '/admin/products', icon: SidebarIcons.products, permission: 'products.read' },
      { label: 'Categories', href: '/admin/categories', icon: SidebarIcons.categories, permission: 'categories.read' },
    ],
  },
  {
    group: 'HR',
    items: [
      { label: 'Payroll', href: '/hr/payroll', icon: SidebarIcons.hr, permission: 'hr.read' },
      { label: 'Users', href: '/hr/users', icon: SidebarIcons.users, permission: 'users.read' },
    ],
  },
  {
    group: 'Config',
    items: [
      { label: 'Notifications', href: '/admin/notifications', icon: SidebarIcons.notifications },
      { label: 'Settings', href: '/admin/settings', icon: SidebarIcons.settings },
      { label: 'Permission Requests', href: '/admin/permission-requests', icon: SidebarIcons.audit, permission: 'audit.read' },
    ],
  },
  {
    group: 'Analytics',
    items: [
      { label: 'Audit Trail', href: '/admin/analytics/audit', icon: SidebarIcons.audit, permission: 'audit.read' },
    ],
  },
];

/** Role-based nav label overrides (UI only). CS/Media agents see "My Orders" etc. */
function getDisplayLabel(
  item: NavItemDef,
  user: { role: string } | null
): string {
  const role = user?.role;
  if (item.href === '/admin/cs/orders' && role === 'CS_AGENT') return 'My Orders';
  if (item.href === '/admin/marketing/orders' && role === 'MEDIA_BUYER') return 'My Orders';
  return item.label;
}

function getNavGroupsForUser(user: { role: string; permissions?: string[] } | null): SidebarGroup[] {
  const result: SidebarGroup[] = [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const role = user?.role ?? '';

  const isLogisticsOnly = ['HEAD_OF_LOGISTICS', 'TPL_MANAGER'].includes(role);
  const logisticsHiddenGroups = ['Catalog', 'HR', 'Analytics', 'Finance'];

  for (const groupDef of navStructure) {
    // Head of Logistics has their own Logistics Orders page; hide Sales & CS group.
    if (groupDef.group === 'SALES & CS' && role === 'HEAD_OF_LOGISTICS') continue;
    // Logistics-only roles: hide Catalog, HR, Analytics, Finance (defense in depth).
    if (isLogisticsOnly && groupDef.group != null && logisticsHiddenGroups.includes(groupDef.group)) continue;

    const visibleItems = groupDef.items
      .filter((item) => {
        if (!item.permission) return true;
        if (isSuperAdmin) return true;
        if (item.roles?.includes(user?.role ?? '')) return true;
        return perms.includes(item.permission);
      })
      .map((item) => ({
        label: getDisplayLabel(item, user),
        href: item.href,
        icon: item.icon,
      }));

    if (visibleItems.length === 0) continue;

    result.push({ group: groupDef.group, items: visibleItems });
  }

  return result;
}

function DashboardLayoutInner({ user, notificationsPromise, notificationsActionUrl: _notificationsActionUrl = '/admin' }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const { isConnected } = useSocket();
  const { realtimeCount, realtimeNotifications, removeRealtimeNotification, pruneServerKnown, clearRealtimeNotifications } = useRealtimeNotifications();
  const { displayUnreadCount } = useNotificationsState();
  const navigation = useNavigation();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    notificationsPromise.then(({ unreadCount }) => {
      if (!cancelled) setServerUnreadCount(unreadCount);
    });
    return () => { cancelled = true; };
  }, [notificationsPromise]);

  const notificationCount = displayUnreadCount(serverUnreadCount + realtimeCount);

  // Initialize dark mode and sidebar collapse from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('yannis_theme');
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }
    const savedCollapsed = localStorage.getItem('yannis_sidebar_collapsed');
    if (savedCollapsed === 'true') {
      setCollapsed(true);
    }
  }, []);

  // Request push notification subscription (once, silently)
  useEffect(() => {
    const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
    const env = w?.__ENV as Record<string, unknown> | undefined;
    const vapidKey = env && typeof env.VAPID_PUBLIC_KEY === 'string' ? env.VAPID_PUBLIC_KEY : undefined;
    if (vapidKey) {
      subscribeToPush(vapidKey).catch(() => {
        // Push not supported or permission denied — silent fail
      });
    }
  }, []);

  // Unlock notification sound on first user interaction (required by browser autoplay policy)
  // Keep audio context alive — browsers re-suspend it after inactivity,
  // so we re-resume on every user interaction (not just the first one).
  useEffect(() => {
    const unlock = () => unlockAudioContext();
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  // Register notification sound for SW push messages (and play on realtime socket notifications)
  const prevRealtimeCountRef = useRef(0);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as Window & { __playNotificationSound?: () => void }).__playNotificationSound = playNotificationSound;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as Window & { __playNotificationSound?: () => void }).__playNotificationSound;
      }
    };
  }, []);

  useEffect(() => {
    if (realtimeCount > prevRealtimeCountRef.current && prevRealtimeCountRef.current >= 0) {
      playNotificationSound();
    }
    prevRealtimeCountRef.current = realtimeCount;
  }, [realtimeCount]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('yannis_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('yannis_theme', 'light');
    }
  };

  const navGroups = getNavGroupsForUser(user);

  // Show a global content loader only during real route transitions
  const isAdminShellPath = location.pathname.startsWith('/admin') || location.pathname.startsWith('/hr');
  const isNavigating = navigation.state !== 'idle' && navigation.location != null;
  const isRouteChange =
    isNavigating &&
    navigation.location.pathname !== location.pathname &&
    (navigation.location.pathname.startsWith('/admin') || navigation.location.pathname.startsWith('/hr'));
  const isRouteLoading = isAdminShellPath && isRouteChange;

  const handleToggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('yannis_sidebar_collapsed', String(next));
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Sidebar
        groups={navGroups}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={handleToggleCollapse}
        onMobileClose={() => setMobileOpen(false)}
        activePathname={isRouteLoading && navigation.location ? navigation.location.pathname : undefined}
        notificationCount={notificationCount}
        darkMode={darkMode}
      />
      <Header
        user={user}
        sidebarCollapsed={collapsed}
        darkMode={darkMode}
        notificationsPromise={notificationsPromise}
        realtimeNotifications={realtimeNotifications}
        realtimeCount={realtimeCount}
        socketConnected={isConnected}
        onToggleDarkMode={toggleDarkMode}
        onMobileMenuToggle={() => setMobileOpen(!mobileOpen)}
        onRemoveRealtimeNotification={removeRealtimeNotification}
        onPruneServerKnown={pruneServerKnown}
        onClearRealtimeNotifications={clearRealtimeNotifications}
      />

      {/* Main content area */}
      <main
        className={`pt-[var(--header-height)] min-h-screen transition-all duration-300
          ${collapsed
            ? 'lg:pl-[var(--sidebar-collapsed-width)]'
            : 'lg:pl-[var(--sidebar-width)]'
          }
        `}
      >
        <div className="p-4 lg:p-6">
          <div
            className={`relative transition-all duration-300 ${isRouteLoading ? 'min-h-[calc(100vh-var(--header-height)-3rem)]' : ''}`}
            aria-busy={isRouteLoading}
            aria-live="polite"
          >
            {isRouteLoading && (
              <div className="absolute inset-0 z-20 bg-surface-50 dark:bg-surface-950 p-4 lg:p-6">
                {navigation.location?.pathname === '/admin/cs/queue' ? (
                  <CSOverviewSkeleton />
                ) : (
                  <RouteLoader />
                )}
              </div>
            )}
            <div className={isRouteLoading ? 'absolute inset-0 opacity-0 pointer-events-none' : ''}>
              <Outlet />
            </div>
          </div>
        </div>
      </main>
      </div>
  );
}

export function DashboardLayout(props: DashboardLayoutProps) {
  return (
    <ToastProvider>
      <NotificationsStateProvider actionUrl={props.notificationsActionUrl ?? '/admin'}>
        <DashboardLayoutInner {...props} />
      </NotificationsStateProvider>
    </ToastProvider>
  );
}
