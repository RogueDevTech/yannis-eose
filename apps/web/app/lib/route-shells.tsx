import type { ReactNode } from 'react';
import type { ListOrdersScheduleKind } from '@yannis/shared';
import {
  BranchDetailLoadingShell,
  BranchesListLoadingShell,
} from '~/features/branches/BranchesDeferredLoadingShells';
import { CEODashboardSkeleton } from '~/features/ceo/CEODashboardSkeleton';
import {
  CSLeaderboardLoadingShell,
  CSMessageTemplatesLoadingShell,
  CSOrdersLoadingShell,
  CSTeamLoadingShell,
} from '~/features/cs/CSDeferredLoadingShells';
import { CSOverviewSkeleton } from '~/features/cs/CSOverviewSkeleton';
import { DashboardSkeleton } from '~/features/dashboard/DashboardSkeleton';
import {
  DeliveryRemittanceDetailLoadingShell,
  DeliveryRemittancesLoadingShell,
  FinanceDisbursementsLoadingShell,
  FinanceOverviewLoadingShell,
  FinancePayoutLoadingShell,
} from '~/features/finance/FinanceDeferredLoadingShells';
import {
  CommissionPlansLoadingShell,
  GeneratePayrollLoadingShell,
  HRUsersListLoadingShell,
  MonthlyPayrollsLoadingShell,
  StaffOnboardingDocsLoadingShell,
  UserCreateEditLoadingShell,
  UserOnboardingLoadingShell,
} from '~/features/hr/HRDeferredLoadingShells';
import {
  CategoriesLoadingShell,
  InventoryLevelDetailLoadingShell,
  InventoryOverviewLoadingShell,
  ShipmentDetailLoadingShell,
  ShipmentsListLoadingShell,
  WarehouseShipmentsLoadingShell,
  WarehousesListLoadingShell,
} from '~/features/inventory/InventoryDeferredLoadingShells';
import {
  LogisticsPartnersLoadingShell,
  LogisticsProviderDetailLoadingShell,
  LogisticsRemittancesLoadingShell,
  LogisticsTeamLoadingShell,
  LogisticsTransfersLoadingShell,
  TransfersLoadingShell,
} from '~/features/logistics/LogisticsDeferredLoadingShells';
import { LogisticsOrdersPage } from '~/features/logistics/LogisticsOrdersPage';
import {
  MarketingAdSpendLoadingShell,
  MarketingCrossFunnelLoadingShell,
  MarketingFormsLoadingShell,
  MarketingFundingLoadingShell,
  MarketingLeaderboardLoadingShell,
  MarketingOrdersLoadingShell,
  MarketingTeamLoadingShell,
} from '~/features/marketing/MarketingDeferredLoadingShells';
import { MarketingOverviewLoadingShell } from '~/features/marketing/MarketingOverviewLoadingShell';
import { OrderDetailSkeleton } from '~/features/orders/OrderDetailSkeleton';
import {
  ProductDetailLoadingShell,
  ProductsHubLoadingShell,
} from '~/features/products/ProductsDeferredLoadingShells';
import { RoleTemplatesLoadingShell } from '~/features/settings/SettingsDeferredLoadingShells';
import { UserDetailShellSkeleton } from '~/features/users/UserDetailShellSkeleton';

interface ShellEntry {
  match: RegExp;
  render: (match: RegExpMatchArray, sp: URLSearchParams) => ReactNode;
}

// URL-driven date-filter defaults used by most shells. The transition skeleton only
// shows for ~50–500 ms, so even when a search param is missing, falling back to
// "all time" produces a reasonable-looking DateFilterBar.
function parseDateFilters(sp: URLSearchParams): {
  startDate: string;
  endDate: string;
  periodAllTime: boolean;
} {
  const hasDateParams =
    sp.has('startDate') || sp.has('endDate') || sp.has('period');
  const periodAllTime = sp.get('period') === 'all_time' || !hasDateParams;
  if (periodAllTime) return { startDate: '', endDate: '', periodAllTime: true };
  return {
    startDate: sp.get('startDate') ?? '',
    endDate: sp.get('endDate') ?? '',
    periodAllTime: false,
  };
}

function pad2Shell(n: number) {
  return String(n).padStart(2, '0');
}

/** Client-side default month — mirrors CS orders loader when no date params. */
function defaultThisMonthRangeClient(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${pad2Shell(d.getMonth() + 1)}-${pad2Shell(d.getDate())}`;
  return { startDate: iso(start), endDate: iso(end) };
}

/** Mirrors `defaultTodayRange()` in `api.server.ts` — marketing overview default. */
function defaultTodayRangeClient(): { startDate: string; endDate: string } {
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${pad2Shell(d.getMonth() + 1)}-${pad2Shell(d.getDate())}`;
  return { startDate: iso(now), endDate: iso(now) };
}

/** Finance list pages that default to this month when no explicit range (disbursements, cash remittances). */
function parseFinanceDefaultMonthDateFilters(sp: URLSearchParams): {
  startDate: string;
  endDate: string;
  periodAllTime: boolean;
} {
  const periodAllTime = sp.get('period') === 'all_time';
  let startDate = sp.get('startDate') ?? '';
  let endDate = sp.get('endDate') ?? '';
  if (!periodAllTime && !startDate && !endDate) {
    const d = defaultThisMonthRangeClient();
    startDate = d.startDate;
    endDate = d.endDate;
  }
  if (periodAllTime) {
    startDate = '';
    endDate = '';
  }
  return { startDate, endDate, periodAllTime };
}

/** URL-driven props for `CSOrdersLoadingShell` during dashboard route transitions. */
function parseCsOrdersLoadingShellFromSearchParams(sp: URLSearchParams): {
  filters: {
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    periodAllTime: boolean;
  };
  statusFilter?: string;
  searchFilter?: string;
  scheduleFilters: {
    calendarMonth: string;
    scheduleKind: ListOrdersScheduleKind | null;
    scheduleDate: string | null;
  };
} {
  const periodAllTime = sp.get('period') === 'all_time';
  let startDate = sp.get('startDate') ?? '';
  let endDate = sp.get('endDate') ?? '';
  let startTime = sp.get('startTime') ?? '';
  let endTime = sp.get('endTime') ?? '';
  if (!periodAllTime && !startDate && !endDate) {
    const d = defaultThisMonthRangeClient();
    startDate = d.startDate;
    endDate = d.endDate;
  }
  if (periodAllTime) {
    startDate = '';
    endDate = '';
    startTime = '';
    endTime = '';
  }
  if (!startDate) startTime = '';
  if (!endDate) endTime = '';

  const scheduleKindRaw = sp.get('scheduleKind');
  let scheduleKind: ListOrdersScheduleKind | null = null;
  if (
    scheduleKindRaw === 'callback_due' ||
    scheduleKindRaw === 'callback_on_day' ||
    scheduleKindRaw === 'delivery_on_day' ||
    scheduleKindRaw === 'delivery_overdue'
  ) {
    scheduleKind = scheduleKindRaw as ListOrdersScheduleKind;
  }
  const scheduleDateRaw = sp.get('scheduleDate');
  const scheduleDate =
    scheduleDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(scheduleDateRaw) ? scheduleDateRaw : null;
  const calendarMonthRaw = sp.get('calendarMonth');
  const now = new Date();
  const defaultCalendarMonth = `${now.getFullYear()}-${pad2Shell(now.getMonth() + 1)}`;
  let calendarMonth =
    calendarMonthRaw && /^\d{4}-\d{2}$/.test(calendarMonthRaw) ? calendarMonthRaw : defaultCalendarMonth;
  if (scheduleDate && !calendarMonthRaw) {
    calendarMonth = scheduleDate.slice(0, 7);
  }

  const statusRaw = sp.get('status') ?? undefined;
  const search = sp.get('search') ?? undefined;

  return {
    filters: { startDate, endDate, startTime, endTime, periodAllTime },
    statusFilter: statusRaw || undefined,
    searchFilter: search || undefined,
    scheduleFilters: {
      calendarMonth,
      scheduleKind,
      scheduleDate: scheduleKind === 'delivery_overdue' ? null : scheduleDate,
    },
  };
}

/** Dashboard transition → `/admin/logistics/orders` (URL-only; mirrors loader defaults). */
function parseLogisticsOrdersTransitionPage(sp: URLSearchParams) {
  const periodAllTime = sp.get('period') === 'all_time';
  let startDate = sp.get('startDate') ?? '';
  let endDate = sp.get('endDate') ?? '';
  if (!periodAllTime && !startDate && !endDate) {
    const d = defaultThisMonthRangeClient();
    startDate = d.startDate;
    endDate = d.endDate;
  }
  if (periodAllTime) {
    startDate = '';
    endDate = '';
  }
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10));
  const rawPer = parseInt(sp.get('perPage') || '40', 10);
  const limit = [20, 40, 50, 100].includes(rawPer) ? rawPer : 40;
  return {
    deferredLoading: true,
    orders: [],
    total: 0,
    totalPages: 1,
    page,
    limit,
    statusFilter: sp.get('status') || 'ALL',
    searchFilter: sp.get('search') ?? '',
    statusCounts: {} as Record<string, number>,
    locations: [],
    riders: [] as Array<{ id: string; name: string; logisticsLocationId: string | null }>,
    filters: { startDate, endDate, periodAllTime },
    isTplManagerScoped: false,
    canEditDeliveryDate: false,
    allocationOnDetailOnly: true,
    orderDetailBasePath: '/admin/orders',
    pageDescription:
      'Confirmed and in-flight orders. Open one to allocate, dispatch, or confirm delivery.',
  };
}

// Order MATTERS — more specific patterns must come before generic ones, since the
// resolver returns the first match. In particular, literal-segment paths (e.g. `/new`,
// `/edit`, `/shipments`, `/warehouses`) must come before catch-all dynamic segments at
// the same depth (e.g. `:id`).
const entries: ShellEntry[] = [
  // ── HR ──────────────────────────────────────────────────────────────────────
  { match: /^\/hr\/users\/new$/, render: () => <UserCreateEditLoadingShell mode="create" /> },
  {
    match: /^\/hr\/users\/[^/]+\/edit$/,
    render: () => <UserCreateEditLoadingShell mode="edit" />,
  },
  {
    match: /^\/hr\/users\/[^/]+\/onboarding$/,
    render: () => <UserOnboardingLoadingShell />,
  },
  // /hr/users/:id intentionally has NO transition shell. The route renders
  // <CachedAwait fallback={<UserDetailShellSkeleton />}> which owns the
  // loading state cleanly — registering the same skeleton here too caused a
  // double-flicker on first visit (transition skeleton mounts → loader
  // returns → Outlet swaps in → CachedAwait remounts the same skeleton at a
  // new tree position → unmount/remount visible as a flash).
  // NavProgressBar at the top covers the brief deferred-loader window.
  { match: /^\/hr\/users$/, render: () => <HRUsersListLoadingShell /> },
  { match: /^\/hr\/payroll\/generate$/, render: () => <GeneratePayrollLoadingShell /> },
  { match: /^\/hr\/payroll$/, render: () => <MonthlyPayrollsLoadingShell /> },
  { match: /^\/hr\/plans$/, render: () => <CommissionPlansLoadingShell /> },
  {
    match: /^\/hr\/staff-onboarding-documents$/,
    render: () => <StaffOnboardingDocsLoadingShell />,
  },

  // ── Admin / Finance ─────────────────────────────────────────────────────────
  {
    match: /^\/admin\/finance\/staff-accounts\/new$/,
    render: () => <UserCreateEditLoadingShell mode="create" />,
  },
  {
    match: /^\/admin\/finance\/staff-accounts\/[^/]+$/,
    render: () => <UserDetailShellSkeleton />,
  },
  {
    match: /^\/admin\/finance\/staff-accounts$/,
    render: () => <HRUsersListLoadingShell />,
  },
  {
    match: /^\/admin\/finance\/delivery-remittances\/([^/]+)$/,
    render: (m) => <DeliveryRemittanceDetailLoadingShell remittanceId={m[1]!} />,
  },
  {
    match: /^\/admin\/finance\/delivery-remittances$/,
    render: (_m, sp) => {
      const dates = parseFinanceDefaultMonthDateFilters(sp);
      return (
        <DeliveryRemittancesLoadingShell
          filters={{
            ...dates,
            status: sp.get('status') ?? '',
            location: sp.get('location') ?? '',
            sentBy: sp.get('sentBy') ?? '',
            eligibleQ: sp.get('q') ?? '',
          }}
        />
      );
    },
  },
  {
    match: /^\/admin\/finance\/disbursements$/,
    render: (_m, sp) => {
      const dates = parseFinanceDefaultMonthDateFilters(sp);
      return (
        <FinanceDisbursementsLoadingShell
          filters={{
            ...dates,
            status: sp.get('status') ?? '',
            receiver: sp.get('receiver') ?? '',
            search: sp.get('search') ?? '',
            balancesSearch: sp.get('balancesSearch') ?? '',
            balancesRole: sp.get('balancesRole') ?? '',
            balancesStatus: sp.get('balancesStatus') ?? '',
          }}
        />
      );
    },
  },
  {
    match: /^\/admin\/finance\/overview$/,
    render: (_m, sp) => <FinanceOverviewLoadingShell filters={parseDateFilters(sp)} />,
  },
  {
    match: /^\/admin\/finance\/payout$/,
    render: (_m, sp) => {
      const raw = sp.get('status');
      const status: '' | 'PAID' | 'PENDING_FINANCE' =
        raw === 'PAID' || raw === 'PENDING_FINANCE' ? raw : '';
      return <FinancePayoutLoadingShell status={status} />;
    },
  },

  // ── Admin / Inventory ───────────────────────────────────────────────────────
  {
    match: /^\/admin\/shipments\/receive$/,
    render: () => <ShipmentsListLoadingShell />,
  },
  {
    match: /^\/admin\/shipments\/[^/]+$/,
    render: () => <ShipmentDetailLoadingShell />,
  },
  {
    match: /^\/admin\/shipments$/,
    render: () => <ShipmentsListLoadingShell />,
  },
  {
    match: /^\/admin\/inventory\/warehouses\/[^/]+$/,
    render: () => <WarehouseShipmentsLoadingShell />,
  },
  {
    match: /^\/admin\/inventory\/warehouses$/,
    render: () => <WarehousesListLoadingShell />,
  },
  {
    match: /^\/admin\/inventory\/[^/]+$/,
    render: () => <InventoryLevelDetailLoadingShell />,
  },
  { match: /^\/admin\/inventory$/, render: () => <InventoryOverviewLoadingShell /> },
  { match: /^\/admin\/categories$/, render: () => <CategoriesLoadingShell /> },

  // ── Admin / Logistics ───────────────────────────────────────────────────────
  {
    match: /^\/admin\/logistics\/team\/[^/]+$/,
    render: () => <LogisticsProviderDetailLoadingShell />,
  },
  {
    match: /^\/admin\/logistics\/team$/,
    render: (_m, sp) => <LogisticsTeamLoadingShell dateFilters={parseDateFilters(sp)} />,
  },
  {
    match: /^\/admin\/logistics\/orders$/,
    render: (_m, sp) => <LogisticsOrdersPage {...parseLogisticsOrdersTransitionPage(sp)} />,
  },
  { match: /^\/admin\/logistics\/partners$/, render: () => <LogisticsPartnersLoadingShell /> },
  {
    match: /^\/admin\/logistics\/remittances$/,
    render: () => <LogisticsRemittancesLoadingShell />,
  },
  {
    match: /^\/admin\/logistics\/transfers$/,
    render: (_m, sp) => <LogisticsTransfersLoadingShell filters={parseDateFilters(sp)} />,
  },
  {
    match: /^\/admin\/transfers$/,
    render: (_m, sp) => <TransfersLoadingShell filters={parseDateFilters(sp)} />,
  },

  // ── Admin / Marketing ───────────────────────────────────────────────────────
  // Many marketing shells take session-derived flags (`isMediaBuyer`, `canDistribute`, etc.)
  // which we don't know at the layout level. We pass safe defaults — the chrome (header,
  // tabs, table headers) renders correctly; only role-gated CTAs may briefly show their
  // default state for the ~50–500 ms transition window.
  {
    match: /^\/admin\/marketing\/overview$/,
    render: (_m, sp) => {
      const periodAllTime = sp.get('period') === 'all_time';
      let startDate = sp.get('startDate') ?? '';
      let endDate = sp.get('endDate') ?? '';
      if (!periodAllTime && !startDate && !endDate) {
        const d = defaultTodayRangeClient();
        startDate = d.startDate;
        endDate = d.endDate;
      }
      if (periodAllTime) {
        startDate = '';
        endDate = '';
      }
      const leaderboardPeriod: 'this_month' | 'all_time' = periodAllTime ? 'all_time' : 'this_month';
      return (
        <MarketingOverviewLoadingShell
          leaderboardPeriod={leaderboardPeriod}
          filters={{ startDate, endDate, periodAllTime }}
        />
      );
    },
  },
  {
    match: /^\/admin\/marketing\/team$/,
    render: (_m, sp) => <MarketingTeamLoadingShell dateFilters={parseDateFilters(sp)} />,
  },
  {
    match: /^\/admin\/marketing\/ad-spend$/,
    render: (_m, sp) => (
      <MarketingAdSpendLoadingShell
        filters={parseDateFilters(sp)}
        viewMode="admin"
        canApproveAdSpend={false}
      />
    ),
  },
  {
    match: /^\/admin\/marketing\/funding$/,
    render: (_m, sp) => (
      <MarketingFundingLoadingShell
        filters={parseDateFilters(sp)}
        canDistribute={false}
        isMediaBuyer={false}
        canRequestFunding={false}
        canSendFunding={false}
      />
    ),
  },
  {
    match: /^\/admin\/marketing\/forms$/,
    render: () => <MarketingFormsLoadingShell isMediaBuyer={false} />,
  },
  {
    match: /^\/admin\/marketing\/leaderboard$/,
    render: (_m, sp) => {
      const periodAllTime = sp.get('period') === 'all_time';
      let startDate = sp.get('startDate') ?? '';
      let endDate = sp.get('endDate') ?? '';
      if (!periodAllTime && !startDate && !endDate) {
        const d = defaultThisMonthRangeClient();
        startDate = d.startDate;
        endDate = d.endDate;
      }
      if (periodAllTime) {
        startDate = '';
        endDate = '';
      }
      const leaderboardPeriod: 'this_month' | 'all_time' = periodAllTime ? 'all_time' : 'this_month';
      return (
        <MarketingLeaderboardLoadingShell
          filters={{ startDate, endDate, periodAllTime }}
          leaderboardPeriod={leaderboardPeriod}
        />
      );
    },
  },
  {
    match: /^\/admin\/marketing\/cross-funnel$/,
    render: (_m, sp) => (
      <MarketingCrossFunnelLoadingShell
        filters={{ ...parseDateFilters(sp), productId: sp.get('productId') ?? '' }}
      />
    ),
  },
  {
    match: /^\/admin\/marketing\/orders$/,
    render: (_m, sp) => {
      const periodAllTime = sp.get('period') === 'all_time';
      let startDate = sp.get('startDate') ?? '';
      let endDate = sp.get('endDate') ?? '';
      if (!periodAllTime && !startDate && !endDate) {
        const d = defaultThisMonthRangeClient();
        startDate = d.startDate;
        endDate = d.endDate;
      }
      if (periodAllTime) {
        startDate = '';
        endDate = '';
      }
      return (
        <MarketingOrdersLoadingShell
          filters={{ startDate, endDate, periodAllTime }}
          isMediaBuyer={false}
          showMediaBuyerColumn={false}
        />
      );
    },
  },

  // ── Admin / CS ──────────────────────────────────────────────────────────────
  { match: /^\/admin\/cs\/queue$/, render: () => <CSOverviewSkeleton /> },
  {
    match: /^\/admin\/cs\/team$/,
    render: (_m, sp) => {
      const dateFilters = parseDateFilters(sp);
      const q = (sp.get('q') ?? '').trim();
      const activityRaw = sp.get('activity') ?? 'ALL';
      const backlogRaw = sp.get('backlog') ?? 'ALL';
      const activityFilter = ['ALL', 'ACTIVE', 'IDLE'].includes(activityRaw) ? activityRaw : 'ALL';
      const backlogFilter = ['ALL', 'HAS_PENDING', 'NO_PENDING'].includes(backlogRaw) ? backlogRaw : 'ALL';
      return (
        <CSTeamLoadingShell
          dateFilters={dateFilters}
          q={q}
          activityFilter={activityFilter}
          backlogFilter={backlogFilter}
        />
      );
    },
  },
  {
    match: /^\/admin\/cs\/orders$/,
    render: (_m, sp) => {
      const p = parseCsOrdersLoadingShellFromSearchParams(sp);
      return <CSOrdersLoadingShell {...p} isCSCloser={false} showCSCloserColumn={false} />;
    },
  },
  {
    match: /^\/admin\/cs\/leaderboard$/,
    render: (_m, sp) => {
      const periodAllTime = sp.get('period') === 'all_time';
      let startDate = sp.get('startDate') ?? '';
      let endDate = sp.get('endDate') ?? '';
      if (!periodAllTime && !startDate && !endDate) {
        const d = defaultThisMonthRangeClient();
        startDate = d.startDate;
        endDate = d.endDate;
      }
      if (periodAllTime) {
        startDate = '';
        endDate = '';
      }
      const leaderboardPeriod: 'this_month' | 'all_time' = periodAllTime ? 'all_time' : 'this_month';
      return (
        <CSLeaderboardLoadingShell
          filters={{ startDate, endDate, periodAllTime }}
          leaderboardPeriod={leaderboardPeriod}
        />
      );
    },
  },
  {
    match: /^\/admin\/cs\/message-templates$/,
    render: () => <CSMessageTemplatesLoadingShell />,
  },

  // ── Admin / Branches / Orders / Products / Settings / CEO / Index ───────────
  { match: /^\/admin\/branches\/[^/]+$/, render: () => <BranchDetailLoadingShell /> },
  { match: /^\/admin\/branches$/, render: () => <BranchesListLoadingShell /> },
  { match: /^\/admin\/orders\/[^/]+$/, render: () => <OrderDetailSkeleton /> },
  { match: /^\/admin\/products\/[^/]+$/, render: () => <ProductDetailLoadingShell /> },
  {
    match: /^\/admin\/products$/,
    render: (_m, sp) => {
      const raw = sp.get('tab');
      const initialTab: 'product' | 'offers' = raw === 'offers' ? 'offers' : 'product';
      return <ProductsHubLoadingShell initialTab={initialTab} />;
    },
  },
  { match: /^\/admin\/settings\/role-templates$/, render: () => <RoleTemplatesLoadingShell /> },
  { match: /^\/admin\/ceo$/, render: () => <CEODashboardSkeleton /> },
  { match: /^\/admin$/, render: () => <DashboardSkeleton /> },
];

/**
 * Resolve the destination route's loading shell from `pathname` + `search`. Returns
 * `null` when no pattern matches — `DashboardLayout` falls through to `<Outlet />`
 * (old page lingers) in that case.
 */
export function getShellForPath(
  pathname: string,
  search: string = '',
): ReactNode | null {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const entry of entries) {
    const m = pathname.match(entry.match);
    if (m) return entry.render(m, sp);
  }
  return null;
}
