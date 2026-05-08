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

    // Single bundled call — replaces 4 parallel tRPC HTTP round-trips.
    const bundleInput = encodeURIComponent(
      JSON.stringify({
        recentLimit: 8,
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(locationId && { logisticsLocationId: locationId }),
      }),
    );
    const bundleRes = await apiRequest<unknown>(
      `/trpc/orders.tplDashboardBundle?input=${bundleInput}`,
      { method: 'GET', cookie },
    );
    type BundleData = {
      recentOrders: Array<{
        id: string;
        customerName: string;
        status: string;
        totalAmount: string | null;
        createdAt: string;
        preferredDeliveryDate: string | null;
      }>;
      statusCounts: Record<string, number>;
      totalOrders: number;
      inTransitTransfers: number;
      returnsQueue: number;
    };
    const bundle = bundleRes.ok
      ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
      : null;

    return {
      recentOrders: bundle?.recentOrders ?? [],
      orderCounts: bundle?.statusCounts ?? {},
      totalOrders: bundle?.totalOrders ?? 0,
      inTransitTransfers: bundle?.inTransitTransfers ?? 0,
      returnsQueue: bundle?.returnsQueue ?? 0,
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
