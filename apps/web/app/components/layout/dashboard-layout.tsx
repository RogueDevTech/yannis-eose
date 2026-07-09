import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigation } from '@remix-run/react';
import { Sidebar, SidebarIcons, type SidebarGroup } from './sidebar';
import { Header } from './header';
import {
  BottomNav,
  BottomNavMoreModal,
  type BottomNavItem,
  type BottomNavGroup,
} from './bottom-nav';
import { useSocket, useRealtimeNotifications, useForceLogoutOnRevoke } from '~/hooks/useSocket';
import { ToastProvider } from '~/components/ui/toast';
import { NotificationsStateProvider, useNotificationsState } from '~/contexts/notifications-state';
import { IosInstallBanner } from '~/components/ui/ios-install-banner';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { usePushSubscription } from '~/hooks/usePushSubscription';
import { usePwaInstall } from '~/hooks/usePwaInstall';
import { NavProgressBar } from '~/components/ui/nav-progress-bar';
import { getFullLoaderEntry } from '~/lib/loader-cache';
import { getShellForPath } from '~/lib/route-shells';
import { playNotificationSound, unlockAudioContext } from '~/lib/notification-sound';
import { isNotificationSoundEnabled } from '~/lib/notification-sound-preference';
import { useAppTheme } from '~/hooks/useAppTheme';
import { PullToRefresh } from '~/components/ui/pull-to-refresh';
import { BranchScopeGuardProvider } from '~/contexts/branch-scope-action-guard';
import { BranchesCatalogProvider, BranchGroupsCatalogProvider } from '~/contexts/branches-catalog-context';
import { OnboardingNudge } from './onboarding-nudge';
import { canAccessGlobalAuditLog, isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import {
  LoginModalGateProvider,
  type OnboardingModalGate,
  useLoginModalGate,
} from '~/contexts/login-modal-gate';
import { SearchModal, useSearchShortcut } from '~/components/ui/search-modal';

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
    id: string;
    name: string;
    role: string;
    email: string;
    permissions?: string[];
    currentBranchId?: string | null;
    /**
     * When set, the layout renders the Mirror Mode chrome (green border + Exit pill in the
     * header). The actor seeing the app is the original admin in `mirroredBy.id` — the rest
     * of the session impersonates the target user.
     */
    mirroredBy?: { id: string; name: string; role: string } | null;
    /** From `/auth/me` — login onboarding nudge skips users HR has approved. */
    staffOnboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
    /** Branch marketing supervisor — nav parity with `marketing.teamOverview` surfaces. */
    isMarketingTeamSupervisorOnActiveBranch?: boolean;
  } | null;
  notificationsPromise: NotificationsPromise;
  /** Route action URL for notification mark-read (e.g. /admin or /hr). */
  notificationsActionUrl?: string;
  /** Available branches for the branch switcher. Only shown when length > 1. */
  branches?: Array<{ id: string; name: string; code: string; groupId?: string | null; groupName?: string | null }>;
  /** Branch groups for SuperAdmin header group switcher. */
  branchGroups?: Array<{ id: string; name: string; status?: string }>;
  /**
   * False while `/admin` layout is still streaming `branches.list` — branch switcher shows a
   * skeleton and org-wide branch guard does not attach submit interception yet.
   */
  branchesHydrationReady?: boolean;
  /** When set with `isBlocked: true`, shows a non-dismissable modal forcing the MB to fill ad spend. */
  adSpendBacklog?: { missingDates: string[]; isBlocked: boolean } | null;
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
  /**
   * Dev-only group: hidden entirely unless `window.__ENV.ENABLE_ACCOUNTING` is
   * true. Used to ship in-test sections (Accounting ledger) dark to prod. The
   * matching route loaders also 404 when the flag is off (defense in depth).
   */
  devOnly?: boolean;
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
        // HoM / admin-class: same pattern as Live Activities — role fallback if session
        // permission bitmask/decoding is stale; Media Buyers still need marketing.orders.
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
      },
      {
        label: 'Funding',
        href: '/admin/marketing/funding',
        icon: SidebarIcons.marketing,
        permission: 'marketing.read',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
      },
      {
        label: 'Expenses',
        href: '/admin/marketing/expenses',
        icon: SidebarIcons.marketing,
        permission: 'marketing.read',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
      },
      {
        label: 'Forms',
        href: '/admin/marketing/forms',
        icon: SidebarIcons.campaigns,
        permission: 'marketing.campaigns',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
      },
      {
        label: 'Leaderboard',
        href: '/admin/marketing/leaderboard',
        icon: SidebarIcons.leaderboards,
        permission: 'marketing.leaderboard',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
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
        href: '/admin/sales/queue',
        icon: SidebarIcons.cs,
        permission: 'cs.teamOverview',
      },
      {
        label: 'Team Analysis',
        href: '/admin/sales/team',
        icon: SidebarIcons.cs,
        permission: 'cs.teamOverview',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
      },
      {
        label: 'Funnel Orders',
        href: '/admin/sales/orders',
        icon: SidebarIcons.orders,
        permission: 'orders.read',
      },
      {
        label: 'Offline Orders',
        href: '/admin/sales/offline-orders',
        icon: SidebarIcons.orders,
        permission: 'orders.read',
      },
      {
        label: 'Cart Orders',
        href: '/admin/sales/cart-orders',
        icon: SidebarIcons.orders,
        permission: 'orders.read',
      },
      {
        label: 'Follow Up Orders',
        href: '/admin/cs/follow-up',
        icon: SidebarIcons.orders,
        permission: 'orders.followUp',
        roles: ['CS_CLOSER'],
      },
      {
        label: 'Leaderboard',
        href: '/admin/sales/leaderboard',
        icon: SidebarIcons.leaderboards,
        permission: 'cs.leaderboard',
      },
      {
        label: 'Message Templates',
        href: '/admin/sales/message-templates',
        icon: SidebarIcons.notifications,
        // Sales closers need to author + use templates; HoCS / Admins manage shared ones via
        // the same page (cs.teamOverview). Ownership-based edit gating is enforced server-side.
        permission: 'cs.teamOverview',
        roles: ['CS_CLOSER'],
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
        permission: 'logistics.providers.view',
      },
      {
        label: 'Partner stock transfers',
        href: '/admin/logistics/transfers',
        icon: SidebarIcons.transfers,
        permission: 'logistics.partner_transfers.view',
      },
      {
        label: 'Orders',
        labelShort: 'Logistics',
        href: '/admin/logistics/orders',
        icon: SidebarIcons.orders,
        permission: 'logistics.read',
      },
      {
        label: 'Logistics Analysis',
        href: '/admin/logistics/team',
        icon: SidebarIcons.leaderboards,
        permission: 'logistics.teamOverview',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS', 'STOCK_MANAGER'],
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
        // HEAD_OF_CS sees inventory read-only by role so CS can plan against
        // stock when confirming orders. HEAD_OF_MARKETING was previously here
        // too but was removed by CEO directive — Marketing should plan
        // against ad-spend / funding, not raw stock; Stock Manager and admins
        // own inventory visibility.
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
      },
      {
        label: 'Shipments',
        href: '/admin/shipments',
        icon: SidebarIcons.inventory,
        permission: 'inventory.shipments.read',
      },
      {
        label: 'Our warehouse',
        href: '/admin/inventory/warehouses',
        icon: SidebarIcons.inventory,
        permission: 'inventory.read',
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
        // Renamed from "Ledger" — this is a synthetic activity feed (revenue,
        // remittances, ad spend, payroll), NOT the double-entry ledger. The
        // real ledger lives under the "Accounting" group below.
        label: 'Financial Activity',
        href: '/admin/finance/ledger',
        icon: SidebarIcons.remittances,
        permission: 'finance.read',
      },
      {
        // Sidebar gate is OR(permission, roles). Listing `permission: 'users.read'`
        // here let HoM in (they hold `users.read` for team management).
        // CEO directive 2026-05-10: HoM does NOT manage staff accounts.
        // Roles-only restricts to HR_MANAGER + FINANCE_OFFICER (+ admin-class
        // via `navBypass`). The page itself is also gated by
        // `requireStaffAccountsAccess` so an unauthorized user typing the URL
        // is redirected anyway.
        label: 'Staff Accounts',
        href: '/admin/finance/staff-accounts',
        icon: SidebarIcons.users,
        roles: ['HR_MANAGER', 'FINANCE_OFFICER'],
      },
    ],
  },
  {
    group: 'Accounting',
    // Dev-only until the double-entry ledger is fully tested. Hidden in prod
    // unless ENABLE_ACCOUNTING=true; the route loaders also 404 when off.
    devOnly: true,
    items: [
      {
        label: 'Chart of Accounts',
        href: '/admin/finance/accounts',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Journal Entries',
        href: '/admin/finance/journal-entries',
        icon: SidebarIcons.remittances,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Trial Balance',
        href: '/admin/finance/trial-balance',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Profit & Loss',
        href: '/admin/finance/profit-loss',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Balance Sheet',
        href: '/admin/finance/balance-sheet',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Cash Flow',
        href: '/admin/finance/cash-flow',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Aging (AR/AP)',
        href: '/admin/finance/aging',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Opening Balances',
        href: '/admin/finance/opening-balances',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.write',
      },
      {
        label: 'Asset Register',
        href: '/admin/finance/assets',
        icon: SidebarIcons.inventory,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Expenses',
        href: '/admin/finance/expenses',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Budget Report',
        href: '/admin/finance/budget-report',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'WHT Certificates',
        href: '/admin/finance/wht-certificates',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Tax Returns',
        href: '/admin/finance/tax-returns',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
      },
      {
        label: 'Bank Reconciliation',
        href: '/admin/finance/bank-reconciliation',
        icon: SidebarIcons.finance,
        permission: 'finance.ledger.read',
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
      // Commission Plans: separate page so HoCS / HoLogistics can manage their own dept's plans
      // (CEO directive 2026-04-26, refined later — HEAD_OF_MARKETING was removed; Marketing
      // commission plans are managed by HR / admin only). Backend `hr.listPlans` /
      // `hr.createPlan` / `hr.updatePlan` auto-scope per viewer.
      {
        label: 'Commission Plans',
        href: '/hr/plans',
        icon: SidebarIcons.leaderboards,
        permission: 'hr.read',
        roles: ['HEAD_OF_CS', 'HEAD_OF_LOGISTICS'],
      },
      // /hr/users is the HR-owned staff directory. Gated on `hr.read` (HR_MANAGER + admins);
      // Head of Marketing / Head of CS hold `users.read` for other features but must not see
      // this link — they manage their team from the Marketing / Sales team pages instead.
      { label: 'Users', href: '/hr/users', icon: SidebarIcons.users, permission: 'hr.read' },
      // Permission-first: link appears only with hr.onboarding.* on the session (or admin-class).
      // Do not add HR_MANAGER (or any role) as a sidebar bypass — grant the caps via template / overrides.
      {
        label: 'Staff Onboarding',
        href: '/hr/staff-onboarding-documents',
        icon: SidebarIcons.orders,
        permission: 'hr.onboarding.read',
      },
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
        // Org-wide heads see this entry too so they can drill into branches
        // they're a department head for and manage their team via
        // `branches.teams.*`. Inside each branch they only see + act on
        // controls the API gates them on (team CRUD for their dept; branch
        // CRUD itself stays admin / Branch Admin).
        roles: ['HEAD_OF_MARKETING', 'HEAD_OF_CS', 'HEAD_OF_LOGISTICS'],
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
        // Visible to anyone holding at least one approve code. SuperAdmin / ADMIN
        // bypass via the standard permission middleware. Submitters (Sales Closers
        // tracking their own price-change requests) reach the page via direct URL
        // — we don't surface the sidebar link unless they can approve something.
        // Head of Logistics: default approver for CS order price / archive requests
        // (ROLE_PERMISSIONS); surface the link for the role like the Remix loader.
        permission: 'permission_requests.user_creation.approve',
        roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS'],
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

/**
 * Role-shaped nav label overrides (UI only).
 *
 * The label MUST mirror the data-scope rule, not the permission. The orders
 * router only narrows the result set to the actor's own orders when:
 *   - role === 'CS_CLOSER'     (assignedCsId = self)
 *   - role === 'MEDIA_BUYER'  (mediaBuyerId = self)
 *
 * Heads / admins / SuperAdmin all carry the relevant permissions but see ALL
 * orders, so calling it "My Orders" for them is misleading. Keep the override
 * keyed on the rank-and-file role specifically.
 */
function getDisplayLabel(
  item: NavItemDef,
  user: { role: string; permissions?: string[]; isMarketingTeamSupervisorOnActiveBranch?: boolean } | null,
): string {
  const role = user?.role ?? '';
  const isMarketingSupervisor = user?.isMarketingTeamSupervisorOnActiveBranch === true;
  if (item.href === '/admin/sales/orders' && role === 'CS_CLOSER') return 'My Orders';
  // For MEDIA_BUYER who is also a marketing team supervisor, the marketing
  // orders page is HoM-like (their team's orders, not just theirs) — keep the
  // generic "Orders" label there. The "My Orders" override is only for the
  // rank-and-file MB whose page truly is self-only.
  if (item.href === '/admin/marketing/orders' && role === 'MEDIA_BUYER' && !isMarketingSupervisor) return 'My Orders';
  return item.label;
}

/** Label for mobile (bottom nav + More modal): uses labelShort when set. */
function getDisplayLabelMobile(
  item: NavItemDef,
  user: { role: string; permissions?: string[]; isMarketingTeamSupervisorOnActiveBranch?: boolean } | null,
): string {
  return item.labelShort ?? getDisplayLabel(item, user);
}

/** Login-time onboarding modal — until HR approves (see `/auth/me` `staffOnboardingStatus`). */
function showLoginOnboardingNudge(user: {
  role: string;
  staffOnboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
} | null): boolean {
  return !!user && !isAdminLevel(user) && user.staffOnboardingStatus !== 'APPROVED';
}

/** Session + bitmask expose canonical codes; `navStructure` uses catalog keys — align both. */
function buildCanonicalPermSet(permissions: readonly string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const p of permissions ?? []) {
    set.add(canonicalPermissionCode(p));
  }
  return set;
}

function permSetHas(set: Set<string>, catalogOrLegacyCode: string): boolean {
  return set.has(canonicalPermissionCode(catalogOrLegacyCode));
}

function getNavGroupsForUser(
  user: {
    role: string;
    permissions?: string[];
    currentBranchId?: string | null;
    isMarketingTeamSupervisorOnActiveBranch?: boolean;
  } | null,
  options?: { forMobile?: boolean },
): SidebarGroup[] {
  const result: SidebarGroup[] = [];
  const permSet = buildCanonicalPermSet(user?.permissions);
  // Broad sidebar visibility: SuperAdmin (system role) or explicit CEO/overview capability.
  const navBypass = user?.role === 'SUPER_ADMIN' || user?.role === 'SUPPORT' || permSetHas(permSet, 'ceo.overview');
  const role = user?.role ?? '';
  const forMobile = options?.forMobile === true;

  const isLogisticsOnly = role === 'TPL_MANAGER';
  const logisticsHiddenGroups = ['Catalog', 'HR', 'Analytics', 'Finance'];
  /** Head of Logistics sees Finance overview but not the full logistics-hidden set. */
  const isHoLogistics = role === 'HEAD_OF_LOGISTICS';
  const hoLogisticsHiddenGroups = ['Catalog', 'HR', 'Analytics'];

  for (const groupDef of navStructure) {
    // Dev-only groups (e.g. Accounting) are hidden unless the env flag is on.
    // `window.__ENV` is undefined during SSR — treat that as "off" so the group
    // never flashes before hydration in prod.
    if (
      groupDef.devOnly &&
      !(typeof window !== 'undefined' && window.__ENV?.ENABLE_ACCOUNTING === true)
    )
      continue;
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
    // Head of Logistics: hide Catalog, HR, Analytics but keep Finance.
    if (isHoLogistics && groupDef.group != null && hoLogisticsHiddenGroups.includes(groupDef.group))
      continue;

    const visibleItems = groupDef.items
      .filter((item) => {
        if (item.href === '/admin/analytics/audit') {
          return canAccessGlobalAuditLog(user);
        }
        if (item.href === '/hr/staff-onboarding-documents') {
          if (user?.role === 'SUPER_ADMIN') return true;
          return (
            permSetHas(permSet, 'hr.onboarding.read') ||
            permSetHas(permSet, 'hr.onboarding.write') ||
            permSetHas(permSet, 'hr.onboarding.approve')
          );
        }
        // Permission Requests: any of the 6 approve codes → see the link. Submitters
        // (Sales Closer / Media Buyer / etc.) can still reach the page by URL — the
        // server-side scope shows them only their own rows; we just don't surface
        // the sidebar entry for them.
        if (item.href === '/admin/permission-requests') {
          if (user?.role === 'SUPER_ADMIN') return true;
          if (user?.role === 'HEAD_OF_LOGISTICS') return true;
          return (
            permSetHas(permSet, 'permission_requests.user_creation.approve') ||
            permSetHas(permSet, 'permission_requests.role_change.approve') ||
            permSetHas(permSet, 'permission_requests.permission_grant.approve') ||
            permSetHas(permSet, 'permission_requests.product_archive.approve') ||
            permSetHas(permSet, 'permission_requests.order_line_price.approve') ||
            permSetHas(permSet, 'permission_requests.order_deletion.approve') ||
            permSetHas(permSet, 'permission_requests.delivered_order_deletion.approve')
          );
        }
        // Disbursements: Finance → HoM only; HoM must not see this (they use Marketing → Funding).
        if (item.href === '/admin/finance/disbursements' && role === 'HEAD_OF_MARKETING')
          return false;
        // No permission AND no roles allowlist → visible to all authed users.
        // When `roles` is set without `permission`, the item is restricted to those roles.
        if (!item.permission && !item.roles) return true;
        if (navBypass) return true;
        if (item.roles?.includes(user?.role ?? '')) return true;
        if (item.permission && permSetHas(permSet, item.permission)) return true;
        // Marketing team supervisor on the active branch: full HoM-like sidebar
        // for marketing surfaces (Live Activities, Team Analysis, Orders, Funding,
        // Ads Expense, Forms, Leaderboard). Backend procedures scope the data
        // to their team via `applySupervisorScope` / `applyMarketingSupervisorScope`,
        // so granting sidebar visibility here is safe — they can't reach data
        // outside their supervised MBs even if the link is exposed.
        if (
          MARKETING_SUPERVISOR_NAV_HREFS.has(item.href) &&
          user?.isMarketingTeamSupervisorOnActiveBranch === true
        )
          return true;
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

/**
 * Sidebar items that a Marketing team supervisor on the active branch sees
 * even without the underlying HoM permission. Excluded by design:
 *   - /admin/branches/* — branch management stays admin-class
 *   - /admin/marketing/cross-funnel — already visible to all MEDIA_BUYERs via role
 */
const MARKETING_SUPERVISOR_NAV_HREFS: ReadonlySet<string> = new Set([
  '/admin/marketing/overview',
  '/admin/marketing/team',
  '/admin/marketing/orders',
  '/admin/marketing/funding',
  '/admin/marketing/expenses',
  '/admin/marketing/forms',
  '/admin/marketing/leaderboard',
]);

/** Priority hrefs for bottom nav per role (max 5). Order matters. */
const BOTTOM_NAV_PRIORITY_BY_ROLE: Record<string, string[]> = {
  SUPER_ADMIN: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/sales/queue',
    '/admin/logistics/orders',
    '/admin/finance/overview',
  ],
  ADMIN: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/sales/queue',
    '/admin/logistics/orders',
    '/admin/finance/overview',
  ],
  SUPPORT: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/sales/queue',
    '/admin/logistics/orders',
    '/admin/finance/overview',
  ],
  HEAD_OF_MARKETING: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/marketing/team',
    '/admin/marketing/funding',
    '/admin/marketing/expenses',
  ],
  MEDIA_BUYER: [
    '/admin',
    '/admin/marketing/overview',
    '/admin/marketing/orders',
    '/admin/marketing/funding',
    '/admin/marketing/expenses',
  ],
  HEAD_OF_CS: [
    '/admin',
    '/admin/sales/queue',
    '/admin/sales/team',
    '/admin/sales/orders',
    '/admin/sales/leaderboard',
  ],
  CS_CLOSER: ['/admin', '/admin/sales/queue', '/admin/sales/orders', '/admin/sales/leaderboard'],
  HEAD_OF_LOGISTICS: [
    '/admin',
    '/admin/shipments',
    '/admin/logistics/orders',
    '/admin/logistics/partners',
    '/admin/logistics/transfers',
    '/admin/finance/overview',
  ],
  TPL_MANAGER: [
    '/admin',
    '/admin/logistics/orders',
    '/admin/logistics/partners',
  ],
  FINANCE_OFFICER: [
    '/admin',
    '/admin/finance/overview',
    '/admin/finance/delivery-remittances',
    '/admin/finance/disbursements',
  ],
  STOCK_MANAGER: ['/admin', '/admin/inventory', '/admin/shipments', '/admin/transfers'],
  HR_MANAGER: ['/admin', '/hr/payroll', '/hr/users'],
};

const FLAT_NAV_ITEMS = navStructure.flatMap((g) => g.items);

function getBottomNavItemsForUser(
  user: {
    role: string;
    permissions?: string[];
    currentBranchId?: string | null;
    isMarketingTeamSupervisorOnActiveBranch?: boolean;
  } | null,
): BottomNavItem[] {
  if (!user) return [];
  const role = user.role ?? '';
  const priorityHrefs = BOTTOM_NAV_PRIORITY_BY_ROLE[role];
  if (priorityHrefs) {
    const permSet = buildCanonicalPermSet(user.permissions);
    const navBypass = user.role === 'SUPER_ADMIN' || permSetHas(permSet, 'ceo.overview');
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
        (!!item.permission && permSetHas(permSet, item.permission)) ||
        (item.href === '/admin/analytics/audit' && canAccessGlobalAuditLog(user)) ||
        (item.href === '/hr/staff-onboarding-documents' &&
          (user.role === 'SUPER_ADMIN' ||
            permSetHas(permSet, 'hr.onboarding.read') ||
            permSetHas(permSet, 'hr.onboarding.write') ||
            permSetHas(permSet, 'hr.onboarding.approve'))) ||
        (item.href === '/admin/permission-requests' &&
          (user.role === 'SUPER_ADMIN' ||
            user.role === 'HEAD_OF_LOGISTICS' ||
            permSetHas(permSet, 'permission_requests.user_creation.approve') ||
            permSetHas(permSet, 'permission_requests.role_change.approve') ||
            permSetHas(permSet, 'permission_requests.permission_grant.approve') ||
            permSetHas(permSet, 'permission_requests.product_archive.approve') ||
            permSetHas(permSet, 'permission_requests.order_line_price.approve') ||
            permSetHas(permSet, 'permission_requests.order_deletion.approve') ||
            permSetHas(permSet, 'permission_requests.delivered_order_deletion.approve'))) ||
        (MARKETING_SUPERVISOR_NAV_HREFS.has(item.href) &&
          user.isMarketingTeamSupervisorOnActiveBranch === true &&
          !!user.currentBranchId);
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
  branchGroups,
  branchesHydrationReady = true,
  adSpendBacklog,
}: DashboardLayoutProps) {
  const { onboardingGate } = useLoginModalGate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useSearchShortcut(() => setSearchOpen(true));
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);
  const { subscribe: subscribePush, permissionState, isSupported } = usePushSubscription(user?.id ?? null, { readOnly: user?.role === 'SUPPORT' });
  const pushPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Seed localStorage from server-persisted preferences on mount so a new
  // browser/device picks up the user's saved theme + font scale immediately
  // instead of defaulting until the async fetchClientConfig resolves.
  useEffect(() => {
    if (!user) return;
    try {
      const serverTheme = (user as { appTheme?: string | null }).appTheme;
      const serverFontScale = (user as { fontScale?: string | null }).fontScale;
      if (serverTheme && typeof serverTheme === 'string') {
        const stored = localStorage.getItem('yannis_app_theme');
        if (!stored || stored !== serverTheme) {
          localStorage.setItem('yannis_app_theme', serverTheme);
        }
      }
      if (serverFontScale && typeof serverFontScale === 'string') {
        const stored = localStorage.getItem('yannis_font_scale');
        if (!stored || stored !== serverFontScale) {
          localStorage.setItem('yannis_font_scale', serverFontScale);
          // Apply immediately to avoid flash
          const scales: Record<string, number> = { base: 14, large: 15.75, xlarge: 17.5 };
          if (scales[serverFontScale]) {
            document.documentElement.style.fontSize = `${scales[serverFontScale]}px`;
            document.documentElement.dataset.fontScale = serverFontScale;
          }
        }
      }
    } catch { /* localStorage unavailable */ }
  }, [user]);

  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const { isConnected } = useSocket();
  // Hard-logout the browser if the server revokes the user's sessions
  // (deactivation, status change). Without this the user can keep clicking
  // around in already-rendered UI even though every API call is 401-ing.
  useForceLogoutOnRevoke();
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
    const handler = () => {
      // Silently activate the waiting SW — it takes over on next navigation.
      // No blocking modal needed (removed 2026-05-25).
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((reg) => {
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        });
      }
    };
    window.addEventListener('yannis:sw-update-ready', handler);

    // When the new SW activates and claims this tab, reload on next navigation
    // so the user gets fresh bundles without interrupting their current work.
    const msgHandler = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        // Mark that a reload is needed — the next Remix navigation will trigger it.
        window.__yannisSwUpdated = true;
      }
    };
    navigator.serviceWorker?.addEventListener('message', msgHandler);

    return () => {
      window.removeEventListener('yannis:sw-update-ready', handler);
      navigator.serviceWorker?.removeEventListener('message', msgHandler);
    };
  }, []);

  useEffect(() => {
    // If the SW updated while the user was on the previous page, do a hard
    // reload so the fresh bundles are picked up. This fires once per SW update
    // cycle — not on every navigation.
    if ((window as unknown as Record<string, unknown>).__yannisSwUpdated) {
      delete (window as unknown as Record<string, unknown>).__yannisSwUpdated;
      window.location.reload();
      return;
    }

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

  // Push prompt: only after onboarding nudge has finished (gate === 'clear'), so both never stack.
  useEffect(() => {
    if (pushPromptTimerRef.current) {
      clearTimeout(pushPromptTimerRef.current);
      pushPromptTimerRef.current = null;
    }
    if (onboardingGate !== 'clear') {
      setShowPushBanner(false);
      return;
    }
    if (
      !isSupported ||
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'default' ||
      localStorage.getItem('yannis_push_banner_dismissed')
    ) {
      return;
    }
    pushPromptTimerRef.current = setTimeout(() => {
      pushPromptTimerRef.current = null;
      setShowPushBanner(true);
    }, 2000);
    return () => {
      if (pushPromptTimerRef.current) {
        clearTimeout(pushPromptTimerRef.current);
        pushPromptTimerRef.current = null;
      }
    };
  }, [isSupported, onboardingGate]);

  // If permission was already granted (e.g. returning user), sync the subscription to the DB once.
  // Guarded by a ref so it only fires once per mount even if subscribePush identity changes.
  // SUPPORT role is read-only — skip the mutation to avoid a 403.
  const isReadOnlyRole = user?.role === 'SUPPORT';
  const didAutoSubscribeRef = useRef(false);
  useEffect(() => {
    if (permissionState === 'granted' && !didAutoSubscribeRef.current && !isReadOnlyRole) {
      didAutoSubscribeRef.current = true;
      subscribePush().catch(() => {});
    }
  }, [permissionState, subscribePush, isReadOnlyRole]);

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
        () => { if (isNotificationSoundEnabled()) playNotificationSound(); };
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
      if (isNotificationSoundEnabled()) playNotificationSound();
    }
    prevRealtimeCountRef.current = realtimeCount;
  }, [realtimeCount]);

  const navGroups = getNavGroupsForUser(user);
  const bottomNavItems = getBottomNavItemsForUser(user);

  // The mobile "More" modal MUST mirror the desktop sidebar exactly — same groups, same items,
  // same role/permission filtering. We derive it from the same `navGroups` the sidebar uses
  // (instead of calling `getNavGroupsForUser` again with `forMobile: true`) so any future drift
  // in that helper can't split desktop and mobile out of sync. Labels swap to `labelShort` here
  // via a lookup against the source `navStructure`, since `navGroups` has already been label-resolved
  // for desktop.
  const navItemDefByHref = new Map(navStructure.flatMap((g) => g.items).map((item) => [item.href, item]));
  const allNavGroupsForModal: BottomNavGroup[] = navGroups.map((g) => ({
    group: g.group,
    items: g.items.map((item) => {
      const def = navItemDefByHref.get(item.href);
      return {
        label: def?.labelShort ?? item.label,
        href: item.href,
        icon: item.icon,
      };
    }),
  }));
  const allNavItemsForModal: BottomNavItem[] = allNavGroupsForModal.flatMap((g) => g.items);
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

  // Skip the transition skeleton when the destination URL already has cached
  // loader data (`cachedClientLoader` will render it on the same tick — no
  // network roundtrip, so a skeleton flash would be a regression). Only show
  // the skeleton on cache misses where the user actually has to wait.
  const destFullPath = navigation.location
    ? navigation.location.pathname + navigation.location.search
    : null;
  const destHasCachedPayload =
    destFullPath != null && getFullLoaderEntry(destFullPath) !== null;
  const showTransitionSkeleton = isRouteLoading && !destHasCachedPayload;

  // Filter the branches catalog to only the active company group.
  // When selectedBranchIds is set (header group selection), page-level
  // dropdowns should only show branches within that group.
  const selectedBranchIds = (user as { selectedBranchIds?: string[] | null })?.selectedBranchIds;
  const catalogBranches = useMemo(() => {
    if (selectedBranchIds && selectedBranchIds.length > 0) {
      const selectedSet = new Set(selectedBranchIds);
      return (branches ?? []).filter((b) => selectedSet.has(b.id));
    }
    return branches ?? [];
  }, [branches, selectedBranchIds]);

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
  const isSupportRole = user?.role === 'SUPPORT';

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

  // Read-only form interception: SUPPORT role + Mirror Mode.
  // Intercepts all POST form submissions before they reach the server and shows
  // a modal explaining why. Mirror-mode forms (data-mirror-allow) and branch
  // switching are exempt.
  const isReadOnly = isSupportRole || isMirroring;
  const [readOnlyBlockModalOpen, setReadOnlyBlockModalOpen] = useState(false);
  const [backlogExpanded, setBacklogExpanded] = useState(false);

  useEffect(() => {
    if (!isReadOnly || typeof document === 'undefined') return;
    const handler = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form) return;
      // Allow mirror start/stop and branch switching
      if (form.hasAttribute('data-mirror-allow')) return;
      if (form.action?.includes('switchBranch')) return;
      // Allow logout — personal session action, not a data mutation
      if (form.action?.includes('/auth/logout')) return;
      // Allow search forms (GET method)
      if (form.method?.toUpperCase() === 'GET') return;
      e.preventDefault();
      e.stopPropagation();
      setReadOnlyBlockModalOpen(true);
    };
    document.addEventListener('submit', handler, true);
    return () => document.removeEventListener('submit', handler, true);
  }, [isReadOnly]);

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
      {isSupportRole && !isMirroring && (
        <div
          className="fixed inset-0 pointer-events-none z-[80] border-4 border-slate-400 dark:border-slate-500 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]"
          aria-hidden
        />
      )}
      {/* Read-only block modal — SUPPORT role or Mirror Mode */}
      <Modal
        open={readOnlyBlockModalOpen}
        onClose={() => setReadOnlyBlockModalOpen(false)}
        maxWidth="max-w-sm"
        contentClassName="p-6"
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isSupportRole ? 'bg-slate-100 dark:bg-slate-800' : 'bg-success-100 dark:bg-success-900/30'}`}>
            <svg className={`w-6 h-6 ${isSupportRole ? 'text-slate-500' : 'text-success-600 dark:text-success-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-app-fg">
            {isSupportRole ? 'Read-only mode' : 'Mirror mode is read-only'}
          </h3>
          <p className="text-sm text-app-fg-muted">
            {isSupportRole
              ? 'The Support role is view-only. You can browse all data but cannot make changes. Contact an admin if something needs to be updated.'
              : `You are currently viewing the app as another user. Exit mirror mode to make changes.`}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-1"
            onClick={() => setReadOnlyBlockModalOpen(false)}
          >
            Got it
          </Button>
        </div>
      </Modal>
      {/* Ad Spend Backlog — non-dismissable modal for Media Buyers with unfilled dates */}
      {(() => {
        const isOnAllowedPage =
          location.pathname.startsWith('/admin/marketing/expenses') ||
          location.pathname.startsWith('/admin/marketing/funding');
        // TODO: remove `|| isMirroring` — temporary bypass for testing via mirror mode
        const showAdSpendBlock =
          adSpendBacklog?.isBlocked === true &&
          !isOnAllowedPage &&
          (user?.role === 'MEDIA_BUYER' || isMirroring);
        if (!showAdSpendBlock) return null;
        const dates = adSpendBacklog!.missingDates;
        const displayLimit = 10;
        const shown = backlogExpanded ? dates : dates.slice(0, displayLimit);
        const remaining = backlogExpanded ? 0 : dates.length - displayLimit;
        const fmt = new Intl.DateTimeFormat('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
        return (
          <>
          {/* Heavy overlay so page content is fully obscured */}
          <div className="fixed inset-0 z-[89] bg-black/80 backdrop-blur-sm" aria-hidden />
          <Modal open onClose={() => {}} maxWidth="max-w-md" contentClassName="p-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-warning-100 dark:bg-warning-900/30 flex items-center justify-center">
                <svg className="w-6 h-6 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-app-fg">Ad Spend Backlog</h3>
                <p className="text-sm text-app-fg-muted mt-1">
                  You have {dates.length} unfilled ad expense {dates.length === 1 ? 'date' : 'dates'}. Please fill them before continuing.
                </p>
              </div>
              <div className="w-full max-h-48 overflow-y-auto rounded-lg border border-app-border bg-app-hover/50 p-3">
                <ul className="space-y-1 text-sm">
                  {shown.map((d) => (
                    <li key={d}>
                      <Link
                        to={`/admin/marketing/expenses/new?date=${d}`}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 text-brand-400 hover:bg-brand-600/10 hover:text-brand-300 transition-colors"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-warning-500 flex-shrink-0" />
                        {fmt.format(new Date(`${d}T12:00:00+01:00`))}
                        <span className="ml-auto text-xs font-medium text-brand-400 flex-shrink-0">Record</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => setBacklogExpanded(true)}
                    className="text-xs text-brand-400 hover:text-brand-300 mt-2 transition-colors"
                  >
                    + {remaining} more {remaining === 1 ? 'date' : 'dates'}
                  </button>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full">
                <Link
                  to="/admin/marketing/expenses"
                  className="flex-1 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
                >
                  Go to Expenses
                </Link>
                <Link
                  to="/admin/marketing/funding"
                  className="flex-1 inline-flex items-center justify-center rounded-lg border border-app-border bg-app-elevated px-4 py-2.5 text-sm font-medium text-app-fg hover:bg-app-hover transition-colors"
                >
                  Go to Funding
                </Link>
              </div>
            </div>
          </Modal>
          </>
        );
      })()}
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
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      <NavProgressBar />
      <Sidebar
        groups={navGroups}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={handleToggleCollapse}
        onMobileClose={() => setMobileOpen(false)}
        activePathname={
          // While a loader is in flight, point at the destination URL so the
          // sidebar marks the target as active before the page renders. When
          // idle, fall back to the current location — passing it explicitly
          // (rather than letting NavLink's built-in isActive run) lets the
          // sidebar do longest-prefix-match across siblings, so deep routes
          // like `/admin/settings/role-templates` only highlight their own
          // entry, not the `/admin/settings` parent.
          isRouteLoading && navigation.location ? navigation.location.pathname : location.pathname
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
        branchGroups={branchGroups}
        branchesHydrationReady={branchesHydrationReady}
        currentBranchId={user?.currentBranchId}
        selectedBranchIds={(user as { selectedBranchIds?: string[] | null })?.selectedBranchIds ?? undefined}
        mirroredBy={user?.mirroredBy ?? null}
        onSearchOpen={() => setSearchOpen(true)}
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

      {/* SW update: silently activate the waiting worker on next navigation instead
           of blocking the user with a forced modal (removed 2026-05-25). */}

      {/* Main content area */}
      <main
        className={`pt-[var(--header-height)] min-h-screen transition-all duration-300 pb-[var(--bottom-nav-height)] md:pb-0
          ${collapsed ? 'lg:pl-[var(--sidebar-collapsed-width)]' : 'lg:pl-[var(--sidebar-width)]'}
        `}
      >
      <PullToRefresh>
        <div className="p-4 lg:p-6">
          <div
            className="relative transition-all duration-300"
            aria-busy={isRouteLoading}
            aria-live="polite"
          >
            <BranchesCatalogProvider value={catalogBranches}>
            <BranchGroupsCatalogProvider value={branchGroups ?? []}>
              {/* Cross-route nav swap — when the user clicks a sidebar link, render the
                  destination route's own loading shell (matched by pathname against the
                  registry in `~/lib/route-shells.tsx`) so Skeleton #1 == Skeleton #2 and
                  static chrome (tab labels, stat-strip labels, table headers) is visible
                  on the same tick as the click. If the destination has no registered shell,
                  fall through to `<Outlet />` and let the old page linger — `NavProgressBar`
                  + the in-route Suspense fallback own the rest. Gated on cache miss so
                  `cachedClientLoader` revisits never flash a skeleton over cached data. */}
              {showTransitionSkeleton
                ? (getShellForPath(
                    navigation.location!.pathname,
                    navigation.location!.search,
                  ) ?? <Outlet />)
                : <Outlet />}
            </BranchGroupsCatalogProvider>
            </BranchesCatalogProvider>
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
  const onboardingNudgeEnabled = !isMirroring && showLoginOnboardingNudge(props.user);
  const [onboardingGate, setOnboardingGate] = useState<OnboardingModalGate>(() =>
    onboardingNudgeEnabled ? 'pending' : 'clear',
  );

  useEffect(() => {
    if (!onboardingNudgeEnabled) setOnboardingGate('clear');
  }, [onboardingNudgeEnabled]);

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
          branchesHydrationReady={props.branchesHydrationReady ?? true}
        >
          <LoginModalGateProvider value={{ onboardingGate, setOnboardingGate }}>
            <DashboardLayoutInner {...props} />
            {/* Phase 22 — login-time onboarding nudge. Suppressed for:
                - Mirror Mode (inner component sets data-mirror on <html>)
                - Admin-class users (SuperAdmin / Admin) — they don't have a
                  personal HR record to fill in; this is for staff members.
                Skip persists for the session via sessionStorage.
                Gate coordinates with the push prompt so only one modal shows at a time. */}
            <OnboardingNudge enabled={onboardingNudgeEnabled} />
          </LoginModalGateProvider>
        </BranchScopeGuardProvider>
      </NotificationsStateProvider>
    </ToastProvider>
  );
}
