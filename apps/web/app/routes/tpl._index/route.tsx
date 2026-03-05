import { defer } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { useLoaderData, useRouteLoaderData, Await } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser } from '~/lib/api.server';
import { RouteLoader } from '~/components/ui/route-loader';
import { DeferredError } from '~/components/ui/deferred-section';
import { DashboardPage } from '~/features/dashboard/DashboardPage';
import type { DashboardData, DashboardLoaderData, OrdersAndCounts } from '~/features/dashboard/types';

const defaultMetrics: DashboardData['metrics'] = { totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, cpa: 0, trueRoas: 0, deliveryRate: 0 };
const defaultProfit: DashboardData['profit'] = { revenue: 0, landedCost: 0, deliveryFee: 0, adSpend: 0, commission: 0, fulfillmentCost: 0, operationalLoss: 0, trueProfit: 0, orderCount: 0, margin: 0 };

export const meta: MetaFunction = () => [
  { title: '3PL Dashboard — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]!;
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]!;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime, topic: 'orders' as const };

  const ordersCountsInput = JSON.stringify({ startDate, endDate });
  const listInput = JSON.stringify({
    page: 1,
    limit: 10,
    ...(user?.logisticsLocationId && user.role === 'TPL_MANAGER' ? { logisticsLocationId: user.logisticsLocationId } : {}),
  });

  const ordersP = apiRequest<unknown>(`/trpc/orders.list?input=${encodeURIComponent(listInput)}`, { method: 'GET', cookie });
  const countsP = apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(ordersCountsInput)}`, { method: 'GET', cookie });
  const countsInputExtra = user?.role === 'TPL_MANAGER' && user?.logisticsLocationId
    ? { logisticsLocationId: user.logisticsLocationId }
    : {};
  const countsP2 = Object.keys(countsInputExtra).length
    ? apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(JSON.stringify({ ...countsInputExtra, startDate, endDate }))}`, { method: 'GET', cookie })
    : countsP;

  const ordersAndCountsPromise = Promise.all([ordersP, countsP2]).then(([ordersRes, countsRes]): OrdersAndCounts => {
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
    filters,
    data: {
      ordersAndCounts: ordersAndCountsPromise,
      metrics: Promise.resolve(defaultMetrics),
      profit: Promise.resolve(defaultProfit),
      totalUsers: Promise.resolve(0),
      totalProducts: Promise.resolve(0),
      payoutSummary: Promise.resolve({}),
    } satisfies DashboardLoaderData,
  });
}

export default function TplDashboard() {
  const loaderData = useLoaderData<typeof loader>();
  const parentData = useRouteLoaderData('routes/tpl') as { user: { name: string; role: string; email: string } } | undefined;
  const role = parentData?.user?.role ?? 'TPL_MANAGER';
  const userName = parentData?.user?.name ?? 'User';
  const { ordersAndCounts: ordersPromise } = loaderData.data;

  return (
    <Suspense fallback={<RouteLoader />}>
      <Await resolve={ordersPromise} errorElement={<DeferredError />}>
        {(ordersAndCounts) => (
          <DashboardPage
            data={{
              ...ordersAndCounts,
              metrics: defaultMetrics,
              profit: defaultProfit,
              totalUsers: 0,
              totalProducts: 0,
              payoutSummary: {},
            }}
            role={role}
            userName={userName}
            filters={loaderData.filters}
          />
        )}
      </Await>
    </Suspense>
  );
}
