
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { Await, useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getSessionCookie,
  requirePermission,
  defaultThisMonthRange,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { CEODashboardPage } from '~/features/ceo/CEODashboardPage';
import type { CEODashboardData } from '~/features/ceo/types';
import { CEODashboardSkeleton } from '~/features/ceo/CEODashboardSkeleton';

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
  // Marketing branch (campaign attribution) is the default view because the
  // existing "Branch Breakdown" sat above the Marketing block and CEO read it
  // as a media-buyer scoreboard. Servicing toggle is an additive lens.
  const branchScope: 'marketing' | 'servicing' =
    url.searchParams.get('branchScope') === 'servicing' ? 'servicing' : 'marketing';

  if (!periodAllTime && !startDate && !endDate) {
    const range = defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime, branchScope };

  const input = JSON.stringify({ startDate, endDate, branchScope });

  const pageData = (async (): Promise<{
    data: CEODashboardData;
    branchBreakdown: BranchBreakdownRow[];
  }> => {
    const res = await apiRequest<{
      result?: { data?: { overview?: CEODashboardData; branchBreakdown?: BranchBreakdownRow[] } };
    }>(`/trpc/dashboard.ceoOverviewBundle?input=${encodeURIComponent(input)}`, { method: 'GET', cookie });

    const bundle = res.ok ? res.data?.result?.data : undefined;

    const data: CEODashboardData = bundle?.overview ?? {
      revenue: 0,
      trueProfit: 0,
      margin: 0,
      costBreakdown: {
        landedCost: 0,
        deliveryFee: 0,
        adSpend: 0,
        commission: 0,
        fulfillmentCost: 0,
        operationalLoss: 0,
      },
      orderPipeline: { total: 0, active: 0, delivered: 0, cancelled: 0, returned: 0, statusCounts: {} },
      marketing: { totalSpend: 0, cpa: 0, roas: 0, deliveryRate: 0 },
      csTeam: { agentCount: 0, pendingOrders: 0, utilization: 0 },
      payroll: { totalPaid: 0, totalPending: 0, staffCount: 0 },
      invoiceSummary: {},
      revenueByPeriod: { today: 0, thisWeek: 0, thisMonth: 0 },
      deliveriesByProduct: [],
      stockPerProduct: [],
      activeStaffCount: 0,
    };

    const branchBreakdown: BranchBreakdownRow[] = bundle?.branchBreakdown ?? [];

    return { data, branchBreakdown };
  })();

  return defer({
    ceoShell: { filters },
    pageData,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

/**
 * User-triggered refresh of the finance materialized views that back this page.
 * Returns once the refresh completes; the client revalidates the loader after, which
 * re-reads `dashboard.ceoOverview` against the now-fresh views.
 */
export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'ceo.overview');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'refreshExecutiveData') {
    const res = await apiRequest<{
      result?: { data?: { success: boolean; refreshedAt: string; durationMs: number; failedViews: string[] } };
    }>('/trpc/dashboard.refreshExecutiveData', { method: 'POST', cookie, body: {} });
    if (!res.ok) {
      return json(
        { success: false, error: extractApiErrorMessage(res.data, 'Failed to refresh executive data') },
        { status: safeStatus(res.status) },
      );
    }
    const result = res.data?.result?.data;
    return json({
      success: true,
      refreshedAt: result?.refreshedAt ?? new Date().toISOString(),
      durationMs: result?.durationMs ?? 0,
      failedViews: result?.failedViews ?? [],
    });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function CEODashboardRoute() {
  const { ceoShell, pageData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);

  return (
    <CachedAwait
      resolve={pageData}
      fallback={<CEODashboardSkeleton />}
      loaderShell={{ ceoShell }}
      deferredKey="pageData"
    >
        {(p) => (
          <CEODashboardPage
            data={p.data as CEODashboardData}
            filters={ceoShell.filters}
            branchBreakdown={p.branchBreakdown as BranchBreakdownRow[]}
            branchScope={ceoShell.filters.branchScope}
            showBackToDashboard
          />
        )}
      </CachedAwait>
  );
}
