import { Suspense } from 'react';
import { useLoaderData, useRouteLoaderData, Await } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, DEFERRED_LOADER_TIMEOUT_MS, defaultThisMonthRange } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { DeferredError } from '~/components/ui/deferred-section';
import { DashboardPage } from '~/features/dashboard/DashboardPage';
import { AdminQuickDashboardLoadingShell, DashboardSkeleton } from '~/features/dashboard/DashboardSkeleton';
import { AdminQuickDashboard, type QuickOverviewData } from '~/features/dashboard/AdminQuickDashboard';
import type { DashboardData, DashboardLoaderData, OrdersAndCounts } from '~/features/dashboard/types';

const defaultQuickOverview: QuickOverviewData = {
  marketing: { today: { newOrders: 0, confirmed: 0, delivered: 0, cancelled: 0 } },
  cs: { closerCount: 0, totalPending: 0, idleCount: 0, unassigned: 0 },
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
    const quickPromise = apiRequest<{ result?: { data?: QuickOverviewData } }>(
      '/trpc/dashboard.quickOverview',
      deferredOpt,
    ).then((res) =>
      res.ok && res.data?.result?.data ? res.data.result.data : defaultQuickOverview
    ).catch(() => defaultQuickOverview);

    return defer({ variant: 'admin_quick' as const, data: quickPromise, filters });
  }

  // All other roles: role-specific dashboard — all deferred for navigate-first
  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const ordersListInput: { page: number; limit: number; startDate?: string; endDate?: string } = { page: 1, limit: 10 };
  if (!periodAllTime && startDate) ordersListInput.startDate = startDate;
  if (!periodAllTime && endDate) ordersListInput.endDate = endDate;
  const ordersP = apiRequest<unknown>('/trpc/orders.list?input=' + encodeURIComponent(JSON.stringify(ordersListInput)), deferredOpt);
  const countsP = apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(ordersCountsInput)}`, deferredOpt);

  const ordersAndCountsPromise = Promise.all([ordersP, countsP]).then(([ordersRes, countsRes]): OrdersAndCounts => {
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
    data: {
      ordersAndCounts: ordersAndCountsPromise,
    } satisfies DashboardLoaderData,
  });
}

export default function AdminDashboard() {
  const loaderData = useLoaderData<typeof loader>();
  const parentData = useRouteLoaderData('routes/admin') as { user: { name: string; role: string; email: string } } | undefined;
  const role = parentData?.user?.role ?? null;
  const userName = parentData?.user?.name ?? 'User';
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);

  if (loaderData.variant === 'admin_quick') {
    const adminRole = role ?? 'ADMIN';
    return (
      <Suspense fallback={<AdminQuickDashboardLoadingShell userName={userName} role={adminRole} />}>
        <Await resolve={loaderData.data} errorElement={<DeferredError />}>
          {(data) => (
            <AdminQuickDashboard
              data={data}
              userName={userName}
              role={adminRole}
            />
          )}
        </Await>
      </Suspense>
    );
  }
  const { ordersAndCounts: _ordersPromise } = loaderData.data;
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Await resolve={_ordersPromise} errorElement={<DeferredError />}>
        {(ordersAndCounts) => (
          <DashboardPage
            data={ordersAndCounts}
            role={role}
            userName={userName}
            filters={loaderData.filters}
          />
        )}
      </Await>
    </Suspense>
  );
}
