import { defer } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData, useRouteLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser, defaultThisMonthRange } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { TplDashboardPage } from '~/features/tpl-dashboard/TplDashboardPage';
import type { TplDashboardData } from '~/features/tpl-dashboard/types';
import { TplDashboardLoadingShell } from '~/features/tpl/TplDeferredLoadingShells';

export const meta: MetaFunction = () => [
  { title: '3PL Dashboard — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
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

  const tplDashboardShell = {
    filters: { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime },
  };

  const pageData = (async () => {
    const user = await getCurrentUser(request);
    const cookie = getSessionCookie(request);

    const locationId = user?.role === 'TPL_MANAGER' && user?.logisticsLocationId
      ? user.logisticsLocationId
      : undefined;

    const countsInput: Record<string, unknown> = {};
    if (startDate) countsInput.startDate = startDate;
    if (endDate) countsInput.endDate = endDate;
    if (locationId) countsInput.logisticsLocationId = locationId;

    const listInput: Record<string, unknown> = {
      page: 1,
      limit: 8,
      sortBy: 'preferredDeliveryDate',
      sortOrder: 'asc',
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
    };
    if (locationId) listInput.logisticsLocationId = locationId;

    const ordersPromise = apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(listInput))}`,
      { method: 'GET', cookie },
    );
    const countsPromise = apiRequest<unknown>(
      `/trpc/orders.statusCounts?input=${encodeURIComponent(JSON.stringify(countsInput))}`,
      { method: 'GET', cookie },
    );
    const transfersPromise = apiRequest<unknown>(
      '/trpc/inventory.transfers',
      { method: 'GET', cookie },
    );
    const returnedPromise = apiRequest<unknown>(
      '/trpc/inventory.returnedOrders',
      { method: 'GET', cookie },
    );

    const [ordersRes, countsRes, transfersRes, returnedRes] = await Promise.all([
      ordersPromise,
      countsPromise,
      transfersPromise,
      returnedPromise,
    ]);

    const ordersData = ordersRes.ok
      ? (ordersRes.data as { result?: { data?: { orders: Array<Record<string, unknown>>; pagination: { total: number } } } })?.result?.data
      : null;
    const countsData = countsRes.ok
      ? (countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {}
      : {};

    const transfers = transfersRes.ok
      ? (transfersRes.data as { result?: { data?: Array<{ transferStatus: string }> } })?.result?.data ?? []
      : [];

    const returnedOrders = returnedRes.ok
      ? (returnedRes.data as { result?: { data?: Array<Record<string, unknown>> } })?.result?.data ?? []
      : [];

    const inTransitTransfers = transfers.filter((t) => t.transferStatus === 'IN_TRANSIT').length;

    return {
      recentOrders: (ordersData?.orders ?? []).map((o) => ({
        id: o.id as string,
        customerName: o.customerName as string,
        status: o.status as string,
        totalAmount: o.totalAmount as string | null,
        createdAt: o.createdAt as string,
        preferredDeliveryDate: (o.preferredDeliveryDate as string) ?? null,
      })),
      orderCounts: countsData,
      totalOrders: ordersData?.pagination?.total ?? 0,
      inTransitTransfers,
      returnsQueue: returnedOrders.length,
      filters: { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime },
    } satisfies TplDashboardData;
  })();

  return defer({ tplDashboardShell, pageData });
}

export default function TplDashboard() {
  const { tplDashboardShell, pageData } = useLoaderData<typeof loader>();
  const parentData = useRouteLoaderData('routes/tpl') as { user: { name: string; role: string; email: string } } | undefined;
  const userName = parentData?.user?.name ?? 'User';
  usePageRefreshOnEvent(['order:status_changed', 'transfer:created', 'stock:updated']);

  return (
    <Suspense fallback={<TplDashboardLoadingShell filters={tplDashboardShell.filters} />}>
      <Await resolve={pageData}>
        {(data) => <TplDashboardPage data={data} userName={userName} />}
      </Await>
    </Suspense>
  );
}
