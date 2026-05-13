import { useLoaderData, useRouteLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, DEFERRED_LOADER_TIMEOUT_MS, defaultThisMonthRange } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { DeferredError } from '~/components/ui/deferred-section';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { DashboardPage } from '~/features/dashboard/DashboardPage';
import { AdminQuickDashboardLoadingShell, DashboardSkeleton } from '~/features/dashboard/DashboardSkeleton';
import { AdminQuickDashboard, type QuickOverviewData } from '~/features/dashboard/AdminQuickDashboard';
import type { DashboardData, OrdersAndCounts } from '~/features/dashboard/types';

const defaultQuickOverview: QuickOverviewData = {
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
    const range = defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime };

  const mediaBuyerIdParam = role === 'MEDIA_BUYER' && user?.id ? { mediaBuyerId: user.id } : {};
  const assignedCsParam = role === 'CS_CLOSER' && user?.id ? { assignedCsId: user.id } : {};
  const ordersCountsInput = JSON.stringify({ startDate, endDate, ...mediaBuyerIdParam, ...assignedCsParam });

  // Admin-class landing: lightweight path. The heavy Executive Overview with profit
  // aggregation, time series, charts, and leaderboards now lives at /admin/ceo. Landing on
  // /admin hits ONE tRPC call (dashboard.quickOverview) and renders in <200ms.
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

  const pageData = Promise.all([ordersP, countsP]).then(([ordersRes, countsRes]): OrdersAndCounts => {
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
    };
  }).catch(() => ({ orderCounts: {} as Record<string, number>, totalOrders: 0, recentOrders: [] }));

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
          name: string;
          role: string;
          email: string;
          /** From the session bundle — true when this Media Buyer supervises the
           *  branch's marketing team. Unlocks the HoM-style dashboard layout. */
          isMarketingTeamSupervisorOnActiveBranch?: boolean;
          /** Symmetric for CS — true when this CS Closer supervises the branch's
           *  CS team. Unlocks the HoCS-style dashboard layout (team-aggregated
           *  metrics + Team Management card). */
          isCsTeamSupervisorOnActiveBranch?: boolean;
        };
      }
    | undefined;
  const role = parentData?.user?.role ?? null;
  const userName = parentData?.user?.name ?? 'User';
  const isMarketingTeamSupervisor =
    parentData?.user?.isMarketingTeamSupervisorOnActiveBranch === true;
  const isCsTeamSupervisor =
    parentData?.user?.isCsTeamSupervisorOnActiveBranch === true;
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);

  const adminRole = role ?? 'ADMIN';

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
          />
        ) : (
          <DashboardPage
            data={data as OrdersAndCounts}
            role={role}
            userName={userName}
            filters={loaderData.filters}
            isMarketingTeamSupervisor={isMarketingTeamSupervisor}
            isCsTeamSupervisor={isCsTeamSupervisor}
          />
        )}
    </CachedAwait>
  );
}
