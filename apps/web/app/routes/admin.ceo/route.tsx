import type { LoaderFunctionArgs } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { CEODashboardPage } from '~/features/ceo/CEODashboardPage';
import type { CEODashboardData } from '~/features/ceo/types';

interface BranchBreakdownRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  totalOrders: number;
  deliveredOrders: number;
  activeOrders: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'ceo.overview');
  const cookie = getSessionCookie(request);

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

  const input = JSON.stringify({ startDate, endDate });
  const [res, branchBreakdownRes] = await Promise.all([
    apiRequest<{ result?: { data?: CEODashboardData } }>(
      `/trpc/dashboard.ceoOverview?input=${encodeURIComponent(input)}`,
      { method: 'GET', cookie },
    ),
    apiRequest<{ result?: { data?: BranchBreakdownRow[] } }>(
      `/trpc/dashboard.ceoBranchBreakdown?input=${encodeURIComponent(input)}`,
      { method: 'GET', cookie },
    ),
  ]);

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

  const branchBreakdown: BranchBreakdownRow[] = branchBreakdownRes.ok
    ? (branchBreakdownRes.data?.result?.data ?? [])
    : [];

  return { data, filters, branchBreakdown };
}

export default function CEODashboardRoute() {
  const { data, filters, branchBreakdown } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);

  return (
    <CEODashboardPage
      data={data as CEODashboardData}
      filters={filters}
      branchBreakdown={branchBreakdown as BranchBreakdownRow[]}
      showBackToDashboard
    />
  );
}
