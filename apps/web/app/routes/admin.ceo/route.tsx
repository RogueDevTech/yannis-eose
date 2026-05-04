import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermission,
  defaultThisMonthRange,
  safeStatus,
} from '~/lib/api.server';
import { canAccessGlobalAuditLog } from '~/lib/rbac';
import { extractApiErrorMessage } from '~/lib/api-error';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { CEODashboardPage } from '~/features/ceo/CEODashboardPage';
import { ListFilterPersistence } from '~/components/list-filter-persistence';
import { ALLOWLIST_CEO_DASHBOARD, LIST_FILTER_SCOPES } from '~/lib/list-filter-persistence-scopes';
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
  const me = await getCurrentUser(request);
  const canViewAuditLink = me ? canAccessGlobalAuditLog(me) : false;
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

  return { data, filters, branchBreakdown, canViewAuditLink };
}

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
    const res = await apiRequest<{ result?: { data?: { success: boolean; refreshedAt: string; durationMs: number; failedViews: string[] } } }>(
      '/trpc/dashboard.refreshExecutiveData',
      { method: 'POST', cookie, body: {} },
    );
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
  const { data, filters, branchBreakdown, canViewAuditLink } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['order:new', 'order:status_changed']);

  return (
    <>
      <ListFilterPersistence scope={LIST_FILTER_SCOPES.ceoDashboard} allowlist={ALLOWLIST_CEO_DASHBOARD} />
    <CEODashboardPage
      data={data as CEODashboardData}
      filters={filters}
      branchBreakdown={branchBreakdown as BranchBreakdownRow[]}
      showBackToDashboard
      canViewAuditLink={canViewAuditLink}
    />
    </>
  );
}
