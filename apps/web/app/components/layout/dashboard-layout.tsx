import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigation } from '@remix-run/react';
import { Sidebar, SidebarIcons, type SidebarGroup } from './sidebar';
import { Header } from './header';
import {
  BottomNav,
  BottomNavMoreModal,
  type BottomNavItem,
  type BottomNavGroup,
} from './bottom-nav';
import { useSocket, useRealtimeNotifications } from '~/hooks/useSocket';
import { ToastProvider } from '~/components/ui/toast';
import { NotificationsStateProvider, useNotificationsState } from '~/contexts/notifications-state';
import { IosInstallBanner } from '~/components/ui/ios-install-banner';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { usePushSubscription } from '~/hooks/usePushSubscription';
import { usePwaInstall } from '~/hooks/usePwaInstall';
import { NavProgressBar } from '~/components/ui/nav-progress-bar';
import { RouteLoader } from '~/components/ui/route-loader';
import { CSOverviewSkeleton } from '~/features/cs/CSOverviewSkeleton';
import { playNotificationSound, unlockAudioContext } from '~/lib/notification-sound';
import { useAppTheme } from '~/hooks/useAppTheme';
import { PullToRefresh } from '~/components/ui/pull-to-refresh';
import { BranchScopeGuardProvider } from '~/contexts/branch-scope-action-guard';
import { OnboardingNudge } from './onboarding-nudge';
import { canAccessGlobalAuditLog } from '~/lib/rbac';

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
    isFinanceOfficer?: boolean;
    currentBranchId?: string | null;
    /**
     * When set, the layout renders the Mirror Mode chrome (green border + Exit pill in the
     * header). The actor seeing the app is the original admin in `mirroredBy.id` — the rest
     * of the session impersonates the target user.
     */
    mirroredBy?: { id: string; name: string; role: string } | null;
  } | null;
  notificationsPromise: NotificationsPromise;
  /** Route action URL for notification mark-read (e.g. /admin or /hr). */
  notificationsActionUrl?: string;
  /** Available branches for the branch switcher. Only shown when length > 1. */
  branches?: Array<{ id: string; name: string; code: string }>;
}

interface NavItemDef {
  label: string;
  /** Shown only on mobile (bottom nav + More modal). Falls back to label if not set. */
  labelShort?: string;
  href: string;
  icon: React.ReactNode;
  /**
   * Required permission. With no `roles`, undefined = visible to all authenticated users.
   * If both `permission` and `roles` are set, the user can see the item with EITHER.
   */
  permission?: string;
  /**
   * Roles allowlist. When set without `permission`, the item is restricted to these roles
   * (admin-class always bypasses). When set with `permission`, listed roles see it without
   * needing the permission.
   */
  roles?: string[];
}

interface NavGroupDef {
  group: string | null;
  items: NavItemDef[];
}

const navStructure: NavGroupDef[] = [
  {
    group: null,
    items: [{ label: 'Dashboard', href: '/admin', icon: SidebarIcons.dashboard }],
  },
  {
    group: 'MARKETING',
    items: [
      {
        label: 'Live Activities',
        labelShort: 'Marketing',
        href: '/admin/marketing/overview',
        icon: SidebarIcons.marketing,
        permission: 'marketing.teamOverview',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
      },
      {
        label: 'Team Analysis',
        href: '/admin/marketing/team',
        icon: SidebarIcons.marketing,
        permission: 'marketing.teamOverview',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
      },
      {
        label: 'Orders',
        href: '/admin/marketing/orders',
        icon: SidebarIcons.orders,
        permission: 'marketing.orders',
      },
      {
        label: 'Funding',
        href: '/admin/marketing/funding',
        icon: SidebarIcons.marketing,
        permission: 'marketing.read',
      },
      {
        label: 'Ads Expense',
        href: '/admin/marketing/ad-spend',
        icon: SidebarIcons.marketing,
        permission: 'marketing.read',
      },
      {
        label: 'Forms',
        href: '/admin/marketing/forms',
        icon: SidebarIcons.campaigns,
        permission: 'marketing.campaigns',
      },
      {
        label: 'Leaderboard',
        href: '/admin/marketing/leaderboard',
        icon: SidebarIcons.leaderboards,
        permission: 'marketing.leaderboard',
      },
      {
        label: 'Cross-funnel',
        href: '/admin/marketing/cross-funnel',
        icon: SidebarIcons.marketing,
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
      },
    ],
  },
  {
    group: 'SALES & CS',
    items: [
      {
        label: 'Live Activities',
        labelShort: 'Sales',
        href: '/admin/cs/queue',
        icon: SidebarIcons.cs,
        permission: 'cs.teamOverview',
      },
      {
        label: 'Team Analysis',
        href: '/admin/cs/team',
        icon: SidebarIcons.cs,
        permission: 'cs.teamOverview',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
      },
      {
        label: 'Orders',
        href: '/admin/cs/orders',
        icon: SidebarIcons.orders,
        permission: 'orders.read',
      },
      {
        label: 'Leaderboard',
        href: '/admin/cs/leaderboard',
        icon: SidebarIcons.leaderboards,
        permission: 'cs.leaderboard',
      },
      {
        label: 'Message Templates',
        href: '/admin/cs/message-templates',
        icon: SidebarIcons.notifications,
        // CS agents need to author + use templates; HoCS / Admins manage shared ones via
        // the same page (cs.teamOverview). Ownership-based edit gating is enforced server-side.
        permission: 'cs.teamOverview',
        roles: ['CS_AGENT'],
      },
    ],
  },
  {
    group: 'LOGISTICS',
    items: [
      {
        label: 'Logistics companies',
        href: '/admin/logistics/partners',
        icon: SidebarIcons.logistics,
        permission: 'logistics.read',
      },
      {
        label: 'Orders',
        labelShort: 'Logistics',
        href: '/admin/logistics/orders',
        icon: SidebarIcons.orders,
        permission: 'logistics.read',
      },
      {
        label: 'Delivery confirmations',
        href: '/admin/logistics/delivery-confirmations',
        icon: SidebarIcons.orders,
        permission: 'logistics.read',
      },
      {
        label: 'Stock Transfer Confirmations',
        href: '/admin/logistics/remittances',
        icon: SidebarIcons.logistics,
        permission: 'logistics.write',
      },
    ],
  },
  {
    group: 'Finance',
    items: [
      {
        label: 'Finance',
        href: '/admin/finance/overview',
        icon: SidebarIcons.finance,
        permission: 'finance.read',
      },
      {
        label: 'Cash remittance',
        href: '/admin/finance/delivery-remittances',
        icon: SidebarIcons.remittances,
        permission: 'finance.read',
      },
      {
        label: 'Payout',
        href: '/admin/finance/payout',
        icon: SidebarIcons.finance,
        permission: 'finance.read',
      },
      {
        label: 'Disbursements',
        href: '/admin/finance/disbursements',
        icon: SidebarIcons.disbursements,
        permission: 'finance.disburse',
      },
      {
        label: 'Staff Accounts',
        href: '/admin/finance/staff-accounts',
        icon: SidebarIcons.users,
        permission: 'users.read',
        roles: ['HR_MANAGER', 'FINANCE_OFFICER'],
      },
    ],
  },
  {
    group: 'Stock Management',
    items: [
      {
        label: 'Inventory',
        href: '/admin/inventory',
        icon: SidebarIcons.inventory,
        permission: 'inventory.read',
        // Heads see inventory read-only by role so they can plan against stock.
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'HEAD_OF_CS'],
      },
      {
        label: 'Transfers',
        href: '/admin/transfers',
        icon: SidebarIcons.transfers,
        permission: 'transfers.read',
      },
    ],
  },
  {
    group: 'Catalog',
    items: [
      {
        label: 'Products',
        href: '/admin/products',
        icon: SidebarIcons.products,
        permission: 'products.read',
      },
      {
        label: 'Categories',
        href: '/admin/categories',
        icon: SidebarIcons.categories,
        permission: 'categories.read',
      },
    ],
  },
  {
    group: 'HR',
    items: [
      // Payroll (Monthly Batches): HR + admins via permission, Heads + Finance via explicit role
      // allow-list. Heads see only their dept's batches; Finance sees PENDING_FINANCE+. See
      // CLAUDE.md → "Payroll Workflow".
      {
        label: 'Payroll',
        href: '/hr/payroll',
        icon: SidebarIcons.hr,
        permission: 'hr.read',
        roles: ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS', 'FINANCE_OFFICER'],
      },
      // Commission Plans: separate page so Heads can manage their own dept's plans (CEO directive
      // 2026-04-26). Backend `hr.listPlans` / `hr.createPlan` / `hr.updatePlan` auto-scope per
      // viewer — Heads only see/edit roles in their dept; HR + admins see/edit all.
      {
        label: 'Commission Plans',
        href: '/hr/plans',
        icon: SidebarIcons.leaderboards,
        permission: 'hr.read',
        roles: ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS'],
      },
      // /hr/users is the HR-owned staff directory. Gated on `hr.read` (HR_MANAGER + admins);
      // Head of Marketing / Head of CS hold `users.read` for other features but must not see
      // this link — they manage their team from the Marketing / CS team pages instead.
      { label: 'Users', href: '/hr/users', icon: SidebarIcons.users, permission: 'hr.read' },
    ],
  },
  {
    group: 'Config',
    items: [
      // Personal profile entry — mirrors the "My Profile" link in the header dropdown so
      // users can reach it from the sidebar too. Open to every authenticated user, no permission gate.
      { label: 'My Profile', href: '/admin/profile', icon: SidebarIcons.profile },
      {
        label: 'Notifications',
        href: '/admin/notifications',
        icon: SidebarIcons.notifications,
      },
      { label: 'Settings', href: '/admin/settings', icon: SidebarIcons.settings },
      {
        label: 'Branches',
        href: '/admin/branches',
        icon: SidebarIcons.settings,
        permission: 'branches.manage',
      },
      {
        label: 'Role templates',
        href: '/admin/settings/role-templates',
        icon: SidebarIcons.settings,
        permission: 'rbac.manage_templates',
      },
      {
        label: 'Permission Requests',
        href: '/admin/permission-requests',
        icon: SidebarIcons.audit,
        // Admins (SuperAdmin, Admin) bypass via roles; HR_MANAGER also explicitly allowed
        // since they manage staff; otherwise gate by audit.read. CS / Marketing / Logistics /
        // Stock have no business reading the queue of pending role grants.
        permission: 'audit.read',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'],
      },
    ],
  },
  {
    group: 'Analytics',
    items: [
      {
        label: 'Audit Trail',
        href: '/admin/analytics/audit',
        icon: SidebarIcons.audit,
        permission: 'audit.read',
      },
    ],
  },
];

/** Capability-based nav label overrides (UI only). CS/Media agents see "My Orders" etc. */
function getDisplayLabel(
  item: NavItemDef,
  user: { role: string; permissions?: string[] } | null,
): string {
  const perms = user?.permissions ?? [];
  if (item.href === '/admin/cs/orders' && perms.includes('cs.leaderboard')) return 'My Orders';
  if (item.href === '/admin/marketing/orders' && perms.includes('marketing.orders')) return 'My Orders';
  return item.label;
}

/** Label for mobile (bottom nav + More modal): uses labelShort when set. */
function getDisplayLabelMobile(
  item: NavItemDef,
  user: { role: string; permissions?: string[] } | null,
): string {
  return item.labelShort ?? getDisplayLabel(item, user);
}

function getNavGroupsForUser(
  user: { role: string; permissions?: string[]; isFinanceOfficer?: boolean; currentBranchId?: string | null } | null,
  options?: { forMobile?: boolean },
): SidebarGroup[] {
  const result: SidebarGroup[] = [];
  // Broad sidebar visibility: SuperAdmin (system role) or explicit CEO/overview capability.
  const navBypass = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('ceo.overview') ?? false);
  const perms = user?.permissions ?? [];
  const role = user?.role ?? '';
  const forMobile = options?.forMobile === true;

  const isLogisticsOnly = ['HEAD_OF_LOGISTICS', 'TPL_MANAGER'].includes(role);
  const logisticsHiddenGroups = ['Catalog', 'HR', 'Analytics', 'Finance'];

  for (const groupDef of navStructure) {
    // Head of Logistics has their own Logistics Orders page; hide Sales & CS group.
    // Finance Officer has no business in CS; hide Sales & CS group.
    if (
      groupDef.group === 'SALES & CS' &&
      (role === 'HEAD_OF_LOGISTICS' || role === 'FINANCE_OFFICER')
    )
      continue;
    // Logistics-only roles: hide Catalog, HR, Analytics, Finance (defense in depth).
    if (isLogisticsOnly && groupDef.group != null && logisticsHiddenGroups.includes(groupDef.group))
      continue;

    const visibleItems = groupDef.items
      .filter((item) => {
        if (item.href === '/admin/analytics/audit') {
          return canAccessGlobalAuditLog(user);
        }
        if (item.href === '/admin/finance/staff-accounts') {
          if ((user?.isFinanceOfficer ?? false) === true) return true;
        }
        // Disbursements: Finance → HoM only; HoM must not see this (they use Marketing → Funding).
        if (item.href === '/admin/finance/disbursements' && role === 'HEAD_OF_MARKETING')
          return false;
        // No permission AND no roles allowlist → visible to all authed users.
        // When `roles` is set without `permission`, the item is restricted to those roles.
        if (!item.permission && !item.roles) return true;
        if (navBypass) return true;
        if (item.roles?.includes(user?.role ?? '')) return true;
        if (item.permission && perms.includes(item.permission)) return true;
        return false;
      })
      .map((item) => ({
        label: forMobile ? getDisplayLabelMobile(item, user) : getDisplayLabel(item, user),
        href: item.href,
        icon: item.icon,
      }));

    if (visibleItems.length === 0) continue;

    result.push({ group: groupDef.group, items: visibleItems });
  }

  return result;
}

/** Priority hrefs for bottom nav per role (max 5). Order matters. */
const BOTTOM_NAV_PRIORITY_BY_ROLE: Record<string, string[]> = {
  SUPER_ADMIN: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/cs/queue',
    '/admin/logistics/orders',
    '/admin/finance/overview',
  ],
  ADMIN: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/cs/queue',
    '/admin/logistics/orders',
    '/admin/finance/overview',
  ],
  HEAD_OF_MARKETING: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/marketing/team',
    '/admin/marketing/funding',
    '/admin/marketing/ad-spend',
  ],
  MEDIA_BUYER: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/marketing/orders',
    '/admin/marketing/funding',
    '/admin/marketing/ad-spend',
  ],
  HEAD_OF_CS: [
    '/admin',
    '/admin/cs/queue',
    '/admin/cs/team',
    '/admin/cs/orders',
    '/admin/cs/leaderboard',
  ],
  CS_AGENT: ['/admin', '/admin/cs/queue', '/admin/cs/orders', '/admin/cs/leaderboard'],
  HEAD_OF_LOGISTICS: [
    '/admin',
    '/admin/logistics/orders',
    '/admin/logistics/partners',
    '/admin/logistics/delivery-confirmations',
    '/admin/logistics/remittances',
  ],
  TPL_MANAGER: [
    '/admin',
    '/admin/logistics/orders',
    '/admin/logistics/partners',
    '/admin/logistics/delivery-confirmations',
    '/admin/logistics/remittances',
  ],
  FINANCE_OFFICER: [
    '/admin',
    '/admin/finance/overview',
    '/admin/finance/delivery-remittances',
    '/admin/finance/disbursements',
  ],
  STOCK_MANAGER: ['/admin', '/admin/inventory', '/admin/transfers'],
  HR_MANAGER: ['/admin', '/hr/payroll', '/hr/users'],
};

const FLAT_NAV_ITEMS = navStructure.flatMap((g) => g.items);

function getBottomNavItemsForUser(
  user: { role: string; permissions?: string[]; isFinanceOfficer?: boolean } | null,
): BottomNavItem[] {
  if (!user) return [];
  const role = user.role ?? '';
  const priorityHrefs = BOTTOM_NAV_PRIORITY_BY_ROLE[role];
  if (priorityHrefs) {
    const navBypass = user.role === 'SUPER_ADMIN' || (user.permissions?.includes('ceo.overview') ?? false);
    const perms = user.permissions ?? [];
    const result: BottomNavItem[] = [];
    const hrefToItem = new Map(FLAT_NAV_ITEMS.map((item) => [item.href, item]));
    for (const href of priorityHrefs) {
      if (result.length >= 5) break;
      const item = hrefToItem.get(href);
      if (!item) continue;
      const allowed =
        // No permission AND no roles allowlist → visible to all authed users.
        // When `roles` is set without `permission`, restrict to those roles.
        (!item.permission && !item.roles) ||
        navBypass ||
        (item.roles?.includes(role) ?? false) ||
        (!!item.permission && perms.includes(item.permission)) ||
        (item.href === '/admin/analytics/audit' && canAccessGlobalAuditLog(user));
      if (allowed) {
        result.push({
          label: getDisplayLabelMobile(item, user),
          href: item.href,
          icon: item.icon,
        });
      }
    }
    if (result.length > 0) return result;
  }
  // Fallback: first 5 items from visible sidebar groups (mobile labels)
  const groups = getNavGroupsForUser(user, { forMobile: true });
  const flat: BottomNavItem[] = groups.flatMap((g) => g.items);
  return flat.slice(0, 5);
}

const MORE_OPEN_KEY = 'yannis_more_open_ts';
const MORE_OPEN_TTL_MS = 600;

function readMoreOpenFromStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(MORE_OPEN_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) && Date.now() - ts < MORE_OPEN_TTL_MS;
  } catch {
    return false;
  }
}

function DashboardLayoutInner({
  user,
  notificationsPromise,
  notificationsActionUrl: _notificationsActionUrl = '/admin',
  branches,
}: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);
  const { subscribe: subscribePush, permissionState, isSupported } = usePushSubscription();
  const { isInstalled } = usePwaInstall();

  const dismissPushPrompt = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('yannis_push_banner_dismissed', '1');
    }
    setShowPushBanner(false);
  };
  // Must match SSR (no sessionStorage): hydrate first, then read storage in useEffect.
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const { isDarkTheme } = useAppTheme();
  const [updateReady, setUpdateReady] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const { isConnected } = useSocket();
  const {
    realtimeCount,
    realtimeNotifications,
    removeRealtimeNotification,
    pruneServerKnown,
    clearRealtimeNotifications,
  } = useRealtimeNotifications();
  const { displayUnreadCount } = useNotificationsState();
  const navigation = useNavigation();
  const location = useLocation();

  useEffect(() => {
    setMoreNavOpen(readMoreOpenFromStorage());
  }, []);

  useEffect(() => {
    const handler = () => setUpdateReady(true);
    window.addEventListener('yannis:sw-update-ready', handler);
    return () => window.removeEventListener('yannis:sw-update-ready', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    notificationsPromise.then(({ unreadCount }) => {
      if (!cancelled) setServerUnreadCount(unreadCount);
    });
    return () => {
      cancelled = true;
    };
  }, [notificationsPromise]);

  const notificationCount = displayUnreadCount(serverUnreadCount + realtimeCount);

  useEffect(() => {
    const savedCollapsed = localStorage.getItem('yannis_sidebar_collapsed');
    if (savedCollapsed === 'true') {
      setCollapsed(true);
    }
  }, []);

  // Show a dismissible push prompt banner if push is supported but not yet granted
  useEffect(() => {
    if (
      isSupported &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default' &&
      !localStorage.getItem('yannis_push_banner_dismissed')
    ) {
      const t = setTimeout(() => setShowPushBanner(true), 2000);
      return () => clearTimeout(t);
    }
  }, [isSupported]);

  // If permission was already granted (e.g. returning user), sync the subscription to the DB once.
  // Guarded by a ref so it only fires once per mount even if subscribePush identity changes.
  const didAutoSubscribeRef = useRef(false);
  useEffect(() => {
    if (permissionState === 'granted' && !didAutoSubscribeRef.current) {
      didAutoSubscribeRef.current = true;
      subscribePush().catch(() => {});
    }
  }, [permissionState, subscribePush]);

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
      (window as Window & { __playNotificationSound?: () => void }).__playNotificationSound =
        playNotificationSound;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as Window & { __playNotificationSound?: () => void })
          .__playNotificationSound;
      }
    };
  }, []);

  useEffect(() => {
    if (realtimeCount > prevRealtimeCountRef.current && prevRealtimeCountRef.current >= 0) {
      playNotificationSound();
    }
    prevRealtimeCountRef.current = realtimeCount;
  }, [realtimeCount]);

  const navGroups = getNavGroupsForUser(user);
  const bottomNavItems = getBottomNavItemsForUser(user);
  const allNavGroups = getNavGroupsForUser(user, { forMobile: true });
  const allNavGroupsForModal: BottomNavGroup[] = allNavGroups.map((g) => ({
    group: g.group,
    items: g.items,
  }));
  const allNavItemsForModal: BottomNavItem[] = allNavGroups.flatMap((g) => g.items);
  const barItems = bottomNavItems.slice(0, 4);

  // Show a global content loader only during real route transitions
  const isAdminShellPath =
    location.pathname.startsWith('/admin') || location.pathname.startsWith('/hr');
  const isNavigating = navigation.state !== 'idle' && navigation.location != null;
  const isRouteChange =
    isNavigating &&
    navigation.location.pathname !== location.pathname &&
    (navigation.location.pathname.startsWith('/admin') ||
      navigation.location.pathname.startsWith('/hr'));
  const isRouteLoading = isAdminShellPath && isRouteChange;

  const handleToggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('yannis_sidebar_collapsed', String(next));
  };

  // Mirror Mode chrome: a 4px green border pinned to the viewport edges so admins always
  // see when they're "in another user's shoes" — regardless of scroll position or content
  // height. Rendered as a fixed overlay (not `ring-inset` on the layout div, which would
  // hug the content area and miss the bottom of long pages). The Exit pill lives in Header.
  const isMirroring = !!user?.mirroredBy;

  // Expose the flag at the document root so view-only side-effect helpers can no-op without
  // each one being threaded `mirroredBy` explicitly. Source of truth: `user.mirroredBy`.
  // Consumers: `getSocket()` broadcasts (`agent:state_update`), push-ack on /push/ack, etc.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isMirroring) document.documentElement.setAttribute('data-mirror', '1');
    else document.documentElement.removeAttribute('data-mirror');
    return () => {
      if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-mirror');
    };
  }, [isMirroring]);

  // Full-screen "Mirroring …" / "Exiting …" overlay during the start/stop transition.
  // The same DashboardLayout wraps both `/hr/*` (where Start Mirror is triggered) and `/admin/*`
  // (the redirect target), so the overlay persists across the redirect — no flash of the old
  // page between submit and the new identity rendering.
  const mirrorIntent = navigation.formData?.get('intent');
  const isMirrorTransition =
    navigation.state !== 'idle' &&
    (mirrorIntent === 'mirror' || mirrorIntent === 'exitMirror');
  const mirrorTransitionLabel = mirrorIntent === 'exitMirror' ? 'Exiting mirror…' : 'Entering mirror mode…';

  return (
    <div className="min-h-screen bg-app-canvas text-app-fg">
      {isMirroring && (
        <div
          className="fixed inset-0 pointer-events-none z-[80] border-4 border-success-500 dark:border-success-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)]"
          aria-hidden
        />
      )}
      {isMirrorTransition && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-app-elevated px-8 py-7 shadow-2xl border border-success-500/40 max-w-sm mx-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-full border-4 border-success-200 dark:border-success-900/40" />
              <div className="absolute inset-0 w-14 h-14 rounded-full border-4 border-transparent border-t-success-500 animate-spin" />
              <svg
                className="absolute inset-0 m-auto w-6 h-6 text-success-600 dark:text-success-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-app-fg">{mirrorTransitionLabel}</p>
              <p className="text-xs text-app-fg-muted mt-1">
                {mirrorIntent === 'exitMirror'
                  ? 'Restoring your admin session…'
                  : 'Switching context to view the app as the selected user.'}
              </p>
            </div>
          </div>
        </div>
      )}
      <NavProgressBar />
      <Sidebar
        groups={navGroups}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={handleToggleCollapse}
        onMobileClose={() => setMobileOpen(false)}
        activePathname={
          isRouteLoading && navigation.location ? navigation.location.pathname : undefined
        }
        notificationCount={notificationCount}
        isDarkTheme={isDarkTheme}
      />
      <Header
        user={user}
        sidebarCollapsed={collapsed}
        isDarkTheme={isDarkTheme}
        notificationsPromise={notificationsPromise}
        realtimeNotifications={realtimeNotifications}
        realtimeCount={realtimeCount}
        socketConnected={isConnected}
        onMobileMenuToggle={() => setMobileOpen(!mobileOpen)}
        onRemoveRealtimeNotification={removeRealtimeNotification}
        onPruneServerKnown={pruneServerKnown}
        onClearRealtimeNotifications={clearRealtimeNotifications}
        branches={branches}
        currentBranchId={user?.currentBranchId}
        mirroredBy={user?.mirroredBy ?? null}
      />

      <IosInstallBanner />

      {/* Dismissible push notification prompt — full-width modal */}
      <Modal
        open={showPushBanner}
        onClose={dismissPushPrompt}
        maxWidth="max-w-md"
        backdropBlur
        aria-labelledby="push-prompt-title"
        aria-describedby="push-prompt-desc"
        contentClassName="bg-app-elevated border border-app-border p-0 overflow-hidden shadow-xl"
      >
        <div className="flex items-start gap-4 p-4 sm:p-5 md:p-6">
          <div className="flex-shrink-0 w-11 h-11 rounded-full bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-brand-600 dark:text-brand-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="push-prompt-title" className="text-base font-semibold text-app-fg">
              Enable push notifications
            </h2>
            <p id="push-prompt-desc" className="text-sm text-app-fg-muted mt-1">
              Stay updated on orders and alerts in real time.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={pushEnabling}
                onClick={async () => {
                  setPushEnabling(true);
                  try {
                    await subscribePush();
                    setShowPushBanner(false);
                  } catch (err) {
                    console.error('[push] subscribe failed:', err);
                    setShowPushBanner(false);
                  } finally {
                    setPushEnabling(false);
                  }
                }}
              >
                Enable
              </Button>
              <NavLink
                to="/admin/settings?tab=push"
                className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                onClick={() => setShowPushBanner(false)}
              >
                Manage in settings
              </NavLink>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissPushPrompt}
            className="flex-shrink-0 rounded-lg p-1 text-app-fg-muted hover:text-app-fg hover:bg-app-canvas/80 dark:hover:bg-surface-800 transition-colors -mt-1 -mr-1"
            aria-label="Dismiss"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </Modal>

      {/* App update modal — forced, no dismiss, shown when a new service worker is waiting */}
      {updateReady && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
          <div className="w-full max-w-sm rounded-2xl bg-app-surface shadow-2xl overflow-hidden">
            {/* Top accent */}
            <div className="bg-brand-600 px-6 py-5 text-white text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
                {updating ? (
                  <svg className="w-7 h-7 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5.64 19.36A9 9 0 0 1 4 12a9 9 0 0 1 9-9c2.39 0 4.57.94 6.17 2.47" />
                    <path d="M18.36 4.64A9 9 0 0 1 20 12a9 9 0 0 1-9 9c-2.39 0-4.57-.94-6.17-2.47" />
                  </svg>
                ) : (
                  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                )}
              </div>
              <h2 className="text-lg font-bold">
                {updating ? 'Updating…' : 'Update Required'}
              </h2>
              <p className="text-sm text-white/80 mt-1">
                {updating ? 'Installing new version' : 'A new version of Yannis is ready'}
              </p>
            </div>

            {/* Body */}
            <div className="px-6 py-5 text-center">
              {updating ? (
                <div className="space-y-3">
                  {/* Progress bar */}
                  <div className="h-2 w-full rounded-full bg-app-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all duration-300 ease-out"
                      style={{ width: `${updateProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-app-fg-muted">
                    {updateProgress < 40
                      ? 'Activating new service worker…'
                      : updateProgress < 75
                        ? 'Loading latest assets…'
                        : updateProgress < 95
                          ? 'Almost done…'
                          : 'Reloading app…'}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-app-fg-muted leading-relaxed">
                  To keep your data accurate and avoid errors, please update to the latest version now. This only takes a second.
                </p>
              )}
            </div>

            {/* Action */}
            <div className="px-6 pb-6">
              <button
                disabled={updating}
                onClick={() => {
                  setUpdating(true);
                  setUpdateProgress(0);

                  // Animate progress: fast to 30% immediately, then slow crawl to 90%, reload finishes it
                  let progress = 0;
                  const tick = () => {
                    progress = progress < 30
                      ? progress + 10
                      : progress < 60
                        ? progress + 4
                        : progress < 85
                          ? progress + 1.5
                          : progress < 92
                            ? progress + 0.5
                            : progress;
                    setUpdateProgress(Math.min(Math.round(progress), 92));
                    if (progress < 92) setTimeout(tick, progress < 30 ? 80 : progress < 60 ? 120 : 200);
                  };
                  setTimeout(tick, 50);

                  // Tell the waiting SW to take over
                  if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.ready.then((reg) => {
                      if (reg.waiting) {
                        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                      }
                    });
                  }

                  // Jump to 100% then reload
                  setTimeout(() => {
                    setUpdateProgress(100);
                    setTimeout(() => window.location.reload(), 400);
                  }, 1800);
                }}
                className="w-full rounded-xl bg-brand-600 py-3.5 text-sm font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed hover:bg-brand-700 active:bg-brand-800"
              >
                {updating ? 'Updating…' : 'Update now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
      <main
        className={`pt-[var(--header-height)] min-h-screen transition-all duration-300 pb-[var(--bottom-nav-height)] md:pb-0
          ${collapsed ? 'lg:pl-[var(--sidebar-collapsed-width)]' : 'lg:pl-[var(--sidebar-width)]'}
        `}
      >
      <PullToRefresh>
        <div className="p-4 lg:p-6">
          <div
            className={`relative transition-all duration-300 ${isRouteLoading ? 'min-h-[calc(100vh-var(--header-height)-3rem)]' : ''}`}
            aria-busy={isRouteLoading}
            aria-live="polite"
          >
            {isRouteLoading && (
              <div className="absolute inset-0 z-20 bg-app-canvas p-4 lg:p-6">
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
      </PullToRefresh>
      </main>
      <BottomNav
        barItems={barItems}
        allItems={allNavItemsForModal}
        allGroups={allNavGroupsForModal}
        currentPathname={location.pathname}
        moreOpen={moreNavOpen}
        onMoreOpenChange={(open) => {
          try {
            if (open) sessionStorage.setItem(MORE_OPEN_KEY, Date.now().toString());
            else sessionStorage.removeItem(MORE_OPEN_KEY);
          } catch {}
          setMoreNavOpen(open);
        }}
      />
      {moreNavOpen && (
        <BottomNavMoreModal
          open={moreNavOpen}
          onClose={() => {
            try {
              sessionStorage.removeItem(MORE_OPEN_KEY);
            } catch {}
            setMoreNavOpen(false);
          }}
          allItems={allNavItemsForModal}
          allGroups={allNavGroupsForModal}
          currentPathname={location.pathname}
          footer={
            !isInstalled ? (
              <NavLink
                to="/admin/settings#install-app"
                prefetch="intent"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(MORE_OPEN_KEY);
                  } catch {}
                  setMoreNavOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm text-app-fg-muted hover:bg-app-hover"
              >
                <span className="flex-1 font-medium text-app-fg">Install app</span>
                <span className="text-xs text-app-fg-muted">Add to home screen</span>
              </NavLink>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

export function DashboardLayout(props: DashboardLayoutProps) {
  // Mirror Mode is view-only: tell the notifications context to no-op every mark-read so
  // the admin's clicks don't bleed into the target user's data.
  const isMirroring = !!props.user?.mirroredBy;
  return (
    <ToastProvider>
      <NotificationsStateProvider
        actionUrl={props.notificationsActionUrl ?? '/admin'}
        readOnly={isMirroring}
      >
        <BranchScopeGuardProvider
          role={props.user?.role}
          currentBranchId={props.user?.currentBranchId ?? null}
          branches={props.branches ?? []}
        >
          <DashboardLayoutInner {...props} />
          {/* Phase 22 — login-time onboarding nudge. Suppressed during mirroring
              (the inner component sets data-mirror on <html>). Skip persists
              for the session via sessionStorage. */}
          <OnboardingNudge enabled={!isMirroring && !!props.user} />
        </BranchScopeGuardProvider>
      </NotificationsStateProvider>
    </ToastProvider>
  );
}
