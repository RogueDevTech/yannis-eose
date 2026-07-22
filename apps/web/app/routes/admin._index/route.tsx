import { useLoaderData, useRouteLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, DEFERRED_LOADER_TIMEOUT_MS, defaultTodayRange, defaultThisMonthRange } from '~/lib/api.server';
import { isAdminLevel, isSuperAdminOnly } from '~/lib/rbac';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { DeferredError } from '~/components/ui/deferred-section';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { DashboardPage } from '~/features/dashboard/DashboardPage';
import {
  AdminQuickDashboardLoadingShell,
  DashboardSkeleton,
  SuperAdminDashboardLoadingShell,
} from '~/features/dashboard/DashboardSkeleton';
import { AdminQuickDashboard, type QuickOverviewData } from '~/features/dashboard/AdminQuickDashboard';
import { SuperAdminDashboard } from '~/features/dashboard/SuperAdminDashboard';
import { DashboardSecondaryProvider } from '~/features/dashboard/dashboard-secondary-context';
import type { CEODashboardData } from '~/features/ceo/types';
import type { DashboardData, OrdersAndCounts } from '~/features/dashboard/types';

const defaultQuickOverview: QuickOverviewData = {
  statusCounts: {},
  offlineCount: 0,
  marketing: { today: { newOrders: 0, confirmed: 0, delivered: 0, cancelled: 0 } },
  cs: { unassigned: 0, engaged: 0, confirmed: 0, delivered: 0 },
  pendingApprovals: 0,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);
  const role = user?.role ?? null;

  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;

  if (!periodAllTime && !startDate && !endDate) {
    const useMonthDefault = role === 'CS_CLOSER' || role === 'HEAD_OF_CS' || role === 'HEAD_OF_LOGISTICS';
    const range = useMonthDefault ? defaultThisMonthRange() : defaultTodayRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const teamIdParam = url.searchParams.get('teamId') || undefined;
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime, ...(teamIdParam && { teamId: teamIdParam }) };
  const mediaBuyerIdParam = role === 'MEDIA_BUYER' && user?.id ? { mediaBuyerId: user.id } : {};
  const assignedCsParam = role === 'CS_CLOSER' && user?.id ? { assignedCsId: user.id } : {};
  // Finance sees ALL deliveries (follow-up + cart included) so
  // their dashboard "Delivered" stat matches Cash Remittances.
  // Stock Manager uses onlyGraduateNonMarketing (same as SuperAdmin TOTAL ORDERS).
  const includeAllDeliveries = role === 'FINANCE_OFFICER';
  const ordersCountsInput = JSON.stringify({
    startDate, endDate,
    ...mediaBuyerIdParam,
    ...assignedCsParam,
    isFollowUp: false,
    ...(includeAllDeliveries ? { excludeGraduated: false } : {}),
    ...(teamIdParam && { teamId: teamIdParam }),
  });

  // SuperAdmin: full CEO metrics directly on /admin (CEO directive 2026-05-18).
  // Uses ceoOverview which includes ROAS, revenue by period, deliveries by product,
  // stock per product, ad spend, CPA, delivery rate, active staff — all in one call.
  if (role && (isSuperAdminOnly({ role }) || role === 'SUPPORT')) {
    const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
    const ceoInput = JSON.stringify({ startDate, endDate });
    const pageData = apiRequest<{ result?: { data?: CEODashboardData } }>(
      `/trpc/dashboard.ceoOverview?input=${encodeURIComponent(ceoInput)}`,
      deferredOpt,
    ).then((res) => res.ok && res.data?.result?.data ? res.data.result.data : null)
     .catch(() => null);

    return defer({ variant: 'super_admin' as const, filters, pageData });
  }

  // Admin (non-SuperAdmin): lightweight quick overview.
  if (role && isAdminLevel({ role })) {
    const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
    const pageData = apiRequest<{ result?: { data?: QuickOverviewData } }>(
      '/trpc/dashboard.quickOverview',
      deferredOpt,
    ).then((res) =>
      res.ok && res.data?.result?.data ? res.data.result.data : defaultQuickOverview
    ).catch(() => defaultQuickOverview);

    return defer({ variant: 'admin_quick' as const, filters, pageData });
  }

  // All other roles: role-specific dashboard — all deferred for navigate-first
  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const ordersListInput: { page: number; limit: number; startDate?: string; endDate?: string } = { page: 1, limit: 10 };
  if (!periodAllTime && startDate) ordersListInput.startDate = startDate;
  if (!periodAllTime && endDate) ordersListInput.endDate = endDate;
  const ordersP = apiRequest<unknown>('/trpc/orders.list?input=' + encodeURIComponent(JSON.stringify(ordersListInput)), deferredOpt);
  const countsP = apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(ordersCountsInput)}`, deferredOpt);
  // Offline count for CS dashboard funnel strip (HoCS / CS supervisor).
  const needsOffline = role === 'HEAD_OF_CS' || role === 'CS_CLOSER';
  const suppInput = JSON.stringify({ startDate, endDate });
  const supplementaryP = needsOffline
    ? apiRequest<unknown>(`/trpc/orders.supplementaryCounts?input=${encodeURIComponent(suppInput)}`, deferredOpt)
        .then((r) => r.ok ? ((r.data as { result?: { data?: { offlineCount: number } } })?.result?.data?.offlineCount ?? 0) : 0)
        .catch(() => 0)
    : Promise.resolve(0);
  // Offline per-status counts for separate funnel strip
  const offlineCountsInput = JSON.stringify({ startDate, endDate, orderSource: 'offline', ...(teamIdParam && { teamId: teamIdParam }) });
  const offlineStatusP = needsOffline
    ? apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(offlineCountsInput)}`, deferredOpt)
        .then((r) => r.ok ? ((r.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}) : {})
        .catch(() => ({} as Record<string, number>))
    : Promise.resolve({} as Record<string, number>);

  // Fetch teams for the team filter dropdown (HoCS / supervisor)
  const primaryBranchId = (user as Record<string, unknown>)?.primaryBranchId as string | undefined;
  const teamsP = needsOffline && primaryBranchId
    ? apiRequest<unknown>(
        `/trpc/branches.listTeamsForFilter?input=${encodeURIComponent(JSON.stringify({ branchId: primaryBranchId, department: 'CS' }))}`,
        deferredOpt,
      ).then((r) => r.ok ? ((r.data as { result?: { data?: Array<{ id: string; name: string | null; department: string }> } })?.result?.data ?? []) : [])
       .catch(() => [] as Array<{ id: string; name: string | null; department: string }>)
    : Promise.resolve([] as Array<{ id: string; name: string | null; department: string }>);

  // Stock Manager: fetch totalOrdersCounts (onlyGraduateNonMarketing), funnel counts,
  // offline counts, and DFU counts — mirrors the SuperAdmin TOTAL ORDERS strip exactly.
  const isStockManager = role === 'STOCK_MANAGER';
  const smTotalInput = JSON.stringify({ startDate, endDate, onlyGraduateNonMarketing: true });
  const smTotalP = isStockManager
    ? apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(smTotalInput)}`, deferredOpt)
        .then((r) => r.ok ? ((r.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}) : {})
        .catch(() => ({} as Record<string, number>))
    : Promise.resolve(undefined);
  // Funnel counts (marketing forms only, excludes graduated + cart graduated)
  const smFunnelInput = JSON.stringify({ startDate, endDate, isFollowUp: false, orderSource: 'edge-form-and-import', excludeGraduated: true });
  const smFunnelP = isStockManager
    ? apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(smFunnelInput)}`, deferredOpt)
        .then((r) => r.ok ? ((r.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}) : {})
        .catch(() => ({} as Record<string, number>))
    : Promise.resolve(undefined);
  // Offline counts
  const smOfflineInput = JSON.stringify({ startDate, endDate, onlyOffline: true });
  const smOfflineP = isStockManager
    ? apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(smOfflineInput)}`, deferredOpt)
        .then((r) => r.ok ? ((r.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}) : {})
        .catch(() => ({} as Record<string, number>))
    : Promise.resolve(undefined);
  // Delivered follow-up counts (from orders table, order_source='delivered_follow_up')
  const smDfuInput = JSON.stringify({ startDate, endDate, orderSource: 'delivered_follow_up', excludeGraduated: false });
  const smDfuP = isStockManager
    ? apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(smDfuInput)}`, deferredOpt)
        .then((r) => r.ok ? ((r.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}) : {})
        .catch(() => ({} as Record<string, number>))
    : Promise.resolve(undefined);

  const pageData = Promise.all([ordersP, countsP, supplementaryP, offlineStatusP, teamsP, smTotalP, smFunnelP, smOfflineP, smDfuP]).then(([ordersRes, countsRes, offlineCount, offlineStatusCounts, teamsForFilter, smTotalCounts, smFunnelCounts, smOfflineCounts, smDfuCounts]): OrdersAndCounts => {
    const ordersData = ordersRes.ok
      ? (ordersRes.data as { result?: { data?: { orders: DashboardData['recentOrders']; pagination: { total: number } } } })?.result?.data
      : null;
    const countsData = countsRes.ok
      ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
      : {};
    return {
      orderCounts: countsData,
      totalOrders: ordersData?.pagination?.total ?? 0,
      recentOrders: ordersData?.orders ?? [],
      offlineCount,
      offlineStatusCounts,
      teamsForFilter,
      ...(smTotalCounts && { totalOrdersCounts: smTotalCounts }),
      ...(smFunnelCounts && { funnelCounts: smFunnelCounts }),
      ...(smOfflineCounts && { offlineOrdersCounts: smOfflineCounts }),
      ...(smDfuCounts && { dfuCounts: smDfuCounts }),
    };
  }).catch(() => ({ orderCounts: {} as Record<string, number>, totalOrders: 0, recentOrders: [], offlineCount: 0, offlineStatusCounts: {}, teamsForFilter: [] }));

  return defer({
    variant: 'dashboard' as const,
    filters,
    pageData,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function AdminDashboard() {
  const loaderData = useLoaderData<typeof loader>();
  const parentData = useRouteLoaderData('routes/admin') as
    | {
        user: {
          id: string;
          name: string;
          role: string;
          email: string;
          /** From the session bundle — true when this Media Buyer supervises the
           *  branch's marketing team. Unlocks the HoM-style dashboard layout. */
          isMarketingTeamSupervisorOnActiveBranch?: boolean;
          /** Symmetric for Sales — true when this Sales Closer supervises the branch's
           *  Sales team. Unlocks the HoCS-style dashboard layout (team-aggregated
           *  metrics + Team Management card). */
          isCsTeamSupervisorOnActiveBranch?: boolean;
        };
      }
    | undefined;
  const role = parentData?.user?.role ?? null;
  const userName = parentData?.user?.name ?? 'User';
  const userId = parentData?.user?.id ?? undefined;
  const isMarketingTeamSupervisor =
    role === 'HEAD_OF_MARKETING' ||
    parentData?.user?.isMarketingTeamSupervisorOnActiveBranch === true;
  const isCsTeamSupervisor =
    parentData?.user?.isCsTeamSupervisorOnActiveBranch === true;
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);

  const adminRole = role ?? 'ADMIN';

  if (loaderData.variant === 'super_admin') {
    return (
      <CachedAwait<CEODashboardData | null>
        resolve={loaderData.pageData as Promise<CEODashboardData | null>}
        fallback={
          <SuperAdminDashboardLoadingShell userName={userName} filters={loaderData.filters} />
        }
        loaderShell={{ variant: loaderData.variant, filters: loaderData.filters }}
        deferredKey="pageData"
        errorElement={() => <DeferredError />}
      >
        {(data) => (
          <DashboardSecondaryProvider filters={loaderData.filters}>
            <SuperAdminDashboard
              data={data}
              userName={userName}
              filters={loaderData.filters}
            />
          </DashboardSecondaryProvider>
        )}
      </CachedAwait>
    );
  }

  return (
    <CachedAwait<QuickOverviewData | OrdersAndCounts>
      resolve={loaderData.pageData as Promise<QuickOverviewData | OrdersAndCounts>}
      fallback={
        loaderData.variant === 'admin_quick' ? (
          <AdminQuickDashboardLoadingShell userName={userName} role={adminRole} />
        ) : (
          <DashboardSkeleton />
        )
      }
      loaderShell={{ variant: loaderData.variant, filters: loaderData.filters }}
      deferredKey="pageData"
      errorElement={() => <DeferredError />}
    >
      {(data) =>
        loaderData.variant === 'admin_quick' ? (
          <AdminQuickDashboard
            data={data as QuickOverviewData}
            userName={userName}
            role={adminRole}
            filters={loaderData.filters}
          />
        ) : (
          <DashboardPage
            data={data as OrdersAndCounts}
            role={role}
            userName={userName}
            userId={userId}
            filters={loaderData.filters}
            isMarketingTeamSupervisor={isMarketingTeamSupervisor}
            isCsTeamSupervisor={isCsTeamSupervisor}
          />
        )}
    </CachedAwait>
  );
}
