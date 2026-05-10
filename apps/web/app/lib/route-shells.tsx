import type { ReactNode } from 'react';
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
  LogisticsOrdersLoadingShell,
  LogisticsPartnersLoadingShell,
  LogisticsProviderDetailLoadingShell,
  LogisticsRemittancesLoadingShell,
  LogisticsTeamLoadingShell,
  LogisticsTransfersLoadingShell,
  TransfersLoadingShell,
} from '~/features/logistics/LogisticsDeferredLoadingShells';
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
      const dates = parseDateFilters(sp);
      return (
        <DeliveryRemittancesLoadingShell
          filters={{
            ...dates,
            status: sp.get('status') ?? '',
            location: sp.get('location') ?? '',
            sentBy: sp.get('sentBy') ?? '',
            eligibleQ: sp.get('eligibleQ') ?? '',
          }}
        />
      );
    },
  },
  {
    match: /^\/admin\/finance\/disbursements$/,
    render: (_m, sp) => {
      const dates = parseDateFilters(sp);
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
    match: /^\/admin\/inventory\/shipments\/[^/]+$/,
    render: () => <ShipmentDetailLoadingShell />,
  },
  {
    match: /^\/admin\/inventory\/shipments$/,
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
    render: (_m, sp) => <LogisticsOrdersLoadingShell filters={parseDateFilters(sp)} />,
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
      const rawPeriod = sp.get('leaderboardPeriod');
      const leaderboardPeriod: 'this_month' | 'all_time' =
        rawPeriod === 'all_time' ? 'all_time' : 'this_month';
      return (
        <MarketingOverviewLoadingShell
          leaderboardPeriod={leaderboardPeriod}
          filters={parseDateFilters(sp)}
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
      const rawPeriod = sp.get('leaderboardPeriod');
      const leaderboardPeriod: 'this_month' | 'all_time' =
        rawPeriod === 'all_time' ? 'all_time' : 'this_month';
      return (
        <MarketingLeaderboardLoadingShell
          filters={parseDateFilters(sp)}
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
    render: (_m, sp) => (
      <MarketingOrdersLoadingShell
        filters={parseDateFilters(sp)}
        isMediaBuyer={false}
        showMediaBuyerColumn={false}
      />
    ),
  },

  // ── Admin / CS ──────────────────────────────────────────────────────────────
  { match: /^\/admin\/cs\/queue$/, render: () => <CSOverviewSkeleton /> },
  {
    match: /^\/admin\/cs\/team$/,
    render: (_m, sp) => <CSTeamLoadingShell dateFilters={parseDateFilters(sp)} />,
  },
  {
    match: /^\/admin\/cs\/orders$/,
    render: (_m, sp) => (
      <CSOrdersLoadingShell filters={parseDateFilters(sp)} isCSCloser={false} />
    ),
  },
  {
    match: /^\/admin\/cs\/leaderboard$/,
    render: (_m, sp) => {
      const rawPeriod = sp.get('leaderboardPeriod');
      const leaderboardPeriod: 'this_month' | 'all_time' =
        rawPeriod === 'all_time' ? 'all_time' : 'this_month';
      return (
        <CSLeaderboardLoadingShell
          filters={parseDateFilters(sp)}
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
