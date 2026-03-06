import { Suspense } from 'react';
import { useLoaderData, useRouteLoaderData, Await } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser } from '~/lib/api.server';
import { extractTrpc } from '~/lib/trpc-extract.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { RouteLoader } from '~/components/ui/route-loader';
import { DeferredError } from '~/components/ui/deferred-section';
import { DashboardPage } from '~/features/dashboard/DashboardPage';
import { CEODashboardPage } from '~/features/ceo/CEODashboardPage';
import type { DashboardData, DashboardLoaderData, OrdersAndCounts } from '~/features/dashboard/types';
import type { CEODashboardData, CEODashboardFilters } from '~/features/ceo/types';

const defaultMetrics: DashboardData['metrics'] = { totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, cpa: 0, trueRoas: 0, deliveryRate: 0 };
const defaultProfit: DashboardData['profit'] = { revenue: 0, landedCost: 0, deliveryFee: 0, adSpend: 0, commission: 0, fulfillmentCost: 0, operationalLoss: 0, trueProfit: 0, orderCount: 0, margin: 0 };

const defaultCEOData: CEODashboardData = {
  revenue: 0,
  trueProfit: 0,
  margin: 0,
  costBreakdown: { landedCost: 0, deliveryFee: 0, adSpend: 0, commission: 0, fulfillmentCost: 0, operationalLoss: 0 },
  orderPipeline: { total: 0, active: 0, delivered: 0, cancelled: 0, returned: 0, statusCounts: {} },
  marketing: { totalSpend: 0, cpa: 0, roas: 0, deliveryRate: 0 },
  csTeam: { agentCount: 0, pendingOrders: 0, utilization: 0 },
  payroll: { totalPaid: 0, totalPending: 0, staffCount: 0 },
  invoiceSummary: {},
};

/** Roles that need marketing.metrics */
const ROLES_NEED_METRICS = ['SUPER_ADMIN', 'HEAD_OF_CS', 'CS_AGENT', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'];
/** Roles that need finance.profitReport */
const ROLES_NEED_PROFIT = ['SUPER_ADMIN', 'FINANCE_OFFICER'];
/** Roles that need users.list (totalUsers) */
const ROLES_NEED_USERS = ['SUPER_ADMIN', 'HR_MANAGER'];
/** Roles that need products.list (totalProducts) */
const ROLES_NEED_PRODUCTS = ['SUPER_ADMIN', 'WAREHOUSE_MANAGER'];
/** Roles that need hr.payoutSummary */
const ROLES_NEED_PAYOUT = ['SUPER_ADMIN', 'HR_MANAGER'];

export async function loader({ request }: LoaderFunctionArgs) {
  const cookie = getSessionCookie(request);
  const user = await getCurrentUser(request);
  const role = user?.role ?? null;

  // #region agent log
  fetch('http://127.0.0.1:7446/ingest/fef61901-cf82-4188-853f-f0e1d3885547', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'aaca2c' },
    body: JSON.stringify({
      sessionId: 'aaca2c',
      location: 'admin._index/route.tsx:loader',
      message: 'Admin index loader ran',
      data: { path: new URL(request.url).pathname, role },
      timestamp: Date.now(),
      hypothesisId: 'H3',
    }),
  }).catch(() => {});
  // #endregion

  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;

  const rawTopic = url.searchParams.get('topic');
  const topic = rawTopic === 'media_buyers' || rawTopic === 'cs' ? rawTopic : 'orders';

  if (!periodAllTime && !startDate && !endDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]!;
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]!;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime, topic };

  const ceoInput = JSON.stringify({ startDate, endDate });
  const ordersCountsInput = JSON.stringify({ startDate, endDate });
  const metricsInput = JSON.stringify({ startDate, endDate });
  const profitInput = JSON.stringify({ groupBy: 'product', startDate, endDate });

  // SuperAdmin: CEO Executive Overview — deferred for navigate-first
  if (role === 'SUPER_ADMIN') {
    const ceoPromise = apiRequest<{ result?: { data?: CEODashboardData } }>(
      `/trpc/dashboard.ceoOverview?input=${encodeURIComponent(ceoInput)}`,
      { method: 'GET', cookie },
    ).then((res) =>
      res.ok && res.data?.result?.data ? res.data.result.data : defaultCEOData
    ).catch(() => defaultCEOData);

    const timeSeriesPromise = apiRequest<{ result?: { data?: { date: string; revenue: number; orderCount: number; createdCount: number }[] } }>(
      `/trpc/dashboard.ceoOverviewTimeSeries?input=${encodeURIComponent(ceoInput)}`,
      { method: 'GET', cookie },
    ).then((res) =>
      res.ok && Array.isArray(res.data?.result?.data) ? res.data.result.data : []
    ).catch(() => []);

    const orderPipelineChartPromise = apiRequest<{ result?: { data?: { volume: number; csEngaged: number; confirmed: number; logisticsDistributed: number; delivered: number } } }>(
      `/trpc/dashboard.orderPipelineChart?input=${encodeURIComponent(ceoInput)}`,
      { method: 'GET', cookie },
    ).then((res) =>
      res.ok && res.data?.result?.data ? res.data.result.data : { volume: 0, csEngaged: 0, confirmed: 0, logisticsDistributed: 0, delivered: 0 }
    ).catch(() => ({ volume: 0, csEngaged: 0, confirmed: 0, logisticsDistributed: 0, delivered: 0 }));

    const leaderboardInput = JSON.stringify({ period: 'this_month', startDate, endDate });
    const mediaBuyersPromise =
      topic === 'media_buyers'
        ? apiRequest<{ result?: { data?: Array<{ mediaBuyerId: string; name: string; email?: string; totalSpend: number; totalOrders: number; deliveredOrders: number; deliveredRevenue: number; cpa: number; trueRoas: number; deliveryRate: number }> } }>(
            `/trpc/marketing.leaderboard?input=${encodeURIComponent(leaderboardInput)}`,
            { method: 'GET', cookie },
          ).then((res) =>
            res.ok && Array.isArray(res.data?.result?.data) ? res.data.result.data : []
          ).catch(() => [])
        : Promise.resolve([]);

    const csWorkloadsPromise =
      topic === 'cs'
        ? apiRequest<{ result?: { data?: Array<{ agentId: string; agentName: string; capacity: number; pendingCount: number; lastActionAt?: string | null }> } }>(
            '/trpc/orders.csWorkloads?input=%7B%7D',
            { method: 'GET', cookie },
          ).then((res) =>
            res.ok && Array.isArray(res.data?.result?.data) ? res.data.result.data : []
          ).catch(() => [])
        : Promise.resolve([]);

    const dataPromise = Promise.all([
      ceoPromise,
      timeSeriesPromise,
      orderPipelineChartPromise,
      mediaBuyersPromise,
      csWorkloadsPromise,
    ])
      .then(([ceoData, timeSeries, orderPipelineChart, mediaBuyerLeaderboard, csWorkloads]) => {
        try {
          const base = {
            ...defaultCEOData,
            ...ceoData,
            timeSeries: Array.isArray(timeSeries) ? timeSeries : [],
            orderPipelineChart:
              orderPipelineChart && typeof orderPipelineChart === 'object'
                ? orderPipelineChart
                : { volume: 0, csEngaged: 0, confirmed: 0, logisticsDistributed: 0, delivered: 0 },
          };
          if (topic === 'media_buyers') {
            return { ...base, chartTopicData: { mediaBuyerLeaderboard: Array.isArray(mediaBuyerLeaderboard) ? mediaBuyerLeaderboard : [] } };
          }
          if (topic === 'cs') {
            return { ...base, chartTopicData: { csWorkloads: Array.isArray(csWorkloads) ? csWorkloads : [] } };
          }
          return base;
        } catch {
          return {
            ...defaultCEOData,
            timeSeries: [],
            orderPipelineChart: { volume: 0, csEngaged: 0, confirmed: 0, logisticsDistributed: 0, delivered: 0 },
          };
        }
      })
      .catch(() => ({
        ...defaultCEOData,
        timeSeries: [],
        orderPipelineChart: { volume: 0, csEngaged: 0, confirmed: 0, logisticsDistributed: 0, delivered: 0 },
      }));
    return defer({ variant: 'ceo' as const, data: dataPromise, filters });
  }

  // All other roles: role-specific dashboard — all deferred for navigate-first
  const ordersP = apiRequest<unknown>('/trpc/orders.list?input=' + encodeURIComponent(JSON.stringify({ page: 1, limit: 10 })), { method: 'GET', cookie });
  const countsP = apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(ordersCountsInput)}`, { method: 'GET', cookie });

  const needsMetrics = role && ROLES_NEED_METRICS.includes(role);
  const needsProfit = role && ROLES_NEED_PROFIT.includes(role);
  const needsUsers = role && ROLES_NEED_USERS.includes(role);
  const needsProducts = role && ROLES_NEED_PRODUCTS.includes(role);
  const needsPayout = role && ROLES_NEED_PAYOUT.includes(role);

  const metricsP = needsMetrics
    ? apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(metricsInput)}`, { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: defaultMetrics } } });
  const profitP = needsProfit
    ? apiRequest<unknown>(`/trpc/finance.profitReport?input=${encodeURIComponent(profitInput)}`, { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: defaultProfit } } });
  const usersP = needsUsers
    ? apiRequest<unknown>('/trpc/users.list?input=%7B%22limit%22%3A1%7D', { method: 'GET', cookie })
    : Promise.resolve({ ok: false, data: {} });
  const productsP = needsProducts
    ? apiRequest<unknown>('/trpc/products.list?input=%7B%22limit%22%3A1%7D', { method: 'GET', cookie })
    : Promise.resolve({ ok: false, data: {} });
  const payoutP = needsPayout
    ? apiRequest<unknown>('/trpc/hr.payoutSummary', { method: 'GET', cookie })
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

  if (loaderData.variant === 'ceo') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Await resolve={loaderData.data} errorElement={<DeferredError />}>
          {(data) => (
            <CEODashboardPage
              data={data}
              filters={loaderData.filters as CEODashboardFilters}
              showBackToDashboard={false}
            />
          )}
        </Await>
      </Suspense>
    );
  }
  const { ordersAndCounts: _ordersPromise, ...restData } = loaderData.data;
  return (
    <Suspense fallback={<RouteLoader />}>
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
