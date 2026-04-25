import { Suspense } from 'react';
import { useLoaderData, useRouteLoaderData, Await } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, DEFERRED_LOADER_TIMEOUT_MS, defaultThisMonthRange } from '~/lib/api.server';
import { extractTrpc } from '~/lib/trpc-extract.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { DeferredError } from '~/components/ui/deferred-section';
import { DashboardPage } from '~/features/dashboard/DashboardPage';
import { DashboardSkeleton } from '~/features/dashboard/DashboardSkeleton';
import { AdminQuickDashboard, type QuickOverviewData } from '~/features/dashboard/AdminQuickDashboard';
import type { DashboardData, DashboardLoaderData, OrdersAndCounts } from '~/features/dashboard/types';

const defaultMetrics: DashboardData['metrics'] = { totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0, confirmationRate: 0, cpa: 0, trueRoas: 0, deliveryRate: 0 };
const defaultProfit: DashboardData['profit'] = { revenue: 0, landedCost: 0, deliveryFee: 0, adSpend: 0, commission: 0, fulfillmentCost: 0, operationalLoss: 0, trueProfit: 0, orderCount: 0, margin: 0 };

const defaultQuickOverview: QuickOverviewData = {
  marketing: { today: { newOrders: 0, confirmed: 0, delivered: 0, cancelled: 0 } },
  cs: { closerCount: 0, totalPending: 0, idleCount: 0, unassigned: 0 },
  pendingApprovals: 0,
};

/** Roles that need marketing.metrics */
const ROLES_NEED_METRICS = ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_AGENT', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'];
/** Roles that need finance.profitReport */
const ROLES_NEED_PROFIT = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'];
/** Roles that need users.list (totalUsers) */
const ROLES_NEED_USERS = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];
/** Roles that need products.list (totalProducts) */
const ROLES_NEED_PRODUCTS = ['SUPER_ADMIN', 'ADMIN', 'STOCK_MANAGER'];
/** Roles that need hr.payoutSummary */
const ROLES_NEED_PAYOUT = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];

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
  const ordersCountsInput = JSON.stringify({ startDate, endDate, ...mediaBuyerIdParam });
  const metricsInput = JSON.stringify({ startDate, endDate, ...mediaBuyerIdParam });
  const profitInput = JSON.stringify({ groupBy: 'product', startDate, endDate });

  // SUPER_ADMIN + ADMIN: lightweight landing. The heavy Executive Overview with profit
  // aggregation, time series, charts, and leaderboards now lives at /admin/ceo. Landing on
  // /admin hits ONE tRPC call (dashboard.quickOverview) and renders in <200ms.
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
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

  const needsMetrics = role && ROLES_NEED_METRICS.includes(role);
  const needsProfit = role && ROLES_NEED_PROFIT.includes(role);
  const needsUsers = role && ROLES_NEED_USERS.includes(role);
  const needsProducts = role && ROLES_NEED_PRODUCTS.includes(role);
  const needsPayout = role && ROLES_NEED_PAYOUT.includes(role);

  const metricsP = needsMetrics
    ? apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(metricsInput)}`, deferredOpt)
    : Promise.resolve({ ok: true, data: { result: { data: defaultMetrics } } });
  const profitP = needsProfit
    ? apiRequest<unknown>(`/trpc/finance.profitReport?input=${encodeURIComponent(profitInput)}`, deferredOpt)
    : Promise.resolve({ ok: true, data: { result: { data: defaultProfit } } });
  const usersP = needsUsers
    ? apiRequest<unknown>('/trpc/users.list?input=%7B%22limit%22%3A1%7D', deferredOpt)
    : Promise.resolve({ ok: false, data: {} });
  const productsP = needsProducts
    ? apiRequest<unknown>('/trpc/products.list?input=%7B%22limit%22%3A1%7D', deferredOpt)
    : Promise.resolve({ ok: false, data: {} });
  const payoutP = needsPayout
    ? apiRequest<unknown>('/trpc/hr.payoutSummary', deferredOpt)
    : Promise.resolve({ ok: false, data: {} });

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
      metrics: metricsP.then(r => extractTrpc(r, defaultMetrics)).catch(() => defaultMetrics),
      profit: profitP.then(r => extractTrpc(r, defaultProfit)).catch(() => defaultProfit),
      totalUsers: usersP.then(r => {
        const d = r.ok ? (r.data as { result?: { data?: { pagination: { total: number } } } })?.result?.data : null;
        return d?.pagination?.total ?? 0;
      }).catch(() => 0),
      totalProducts: productsP.then(r => {
        const d = r.ok ? (r.data as { result?: { data?: { pagination: { total: number } } } })?.result?.data : null;
        return d?.pagination?.total ?? 0;
      }).catch(() => 0),
      payoutSummary: payoutP.then(r => {
        return r.ok ? (r.data as { result?: { data?: Record<string, { count: number; total: string }> } })?.result?.data ?? {} : {};
      }).catch(() => ({})),
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
    return (
      <Suspense fallback={<DashboardSkeleton />}>
        <Await resolve={loaderData.data} errorElement={<DeferredError />}>
          {(data) => (
            <AdminQuickDashboard
              data={data}
              userName={userName}
              role={role ?? 'ADMIN'}
            />
          )}
        </Await>
      </Suspense>
    );
  }
  const { ordersAndCounts: _ordersPromise, ...restData } = loaderData.data;
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Await resolve={_ordersPromise} errorElement={<DeferredError />}>
        {(ordersAndCounts) => (
          <DashboardPage
            data={{ ...restData, ...ordersAndCounts }}
            role={role}
            userName={userName}
            filters={loaderData.filters}
          />
        )}
      </Await>
    </Suspense>
  );
}
