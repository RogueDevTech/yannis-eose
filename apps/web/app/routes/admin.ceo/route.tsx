import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { CEODashboardPage } from '~/features/ceo/CEODashboardPage';
import type { CEODashboardData } from '~/features/ceo/types';

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'ceo.overview');
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

  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime };

  const input = JSON.stringify({ startDate, endDate });
  const res = await apiRequest<{ result?: { data?: CEODashboardData } }>(
    `/trpc/dashboard.ceoOverview?input=${encodeURIComponent(input)}`,
    { method: 'GET', cookie },
  );

  const data: CEODashboardData = res.ok && res.data?.result?.data
    ? res.data.result.data
    : {
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

  return json({ data, filters });
}

export default function CEODashboardRoute() {
  const { data, filters } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);

  return (
    <CEODashboardPage
      data={data as CEODashboardData}
      filters={filters}
      showBackToDashboard
    />
  );
}
