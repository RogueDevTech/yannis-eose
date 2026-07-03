import { useLoaderData } from '@remix-run/react';
import { defer, type LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange } from '~/lib/api.server';
import { FinancePage } from '~/features/finance/FinancePage';
import { FinanceOverviewLoadingShell } from '~/features/finance/FinanceDeferredLoadingShells';
import type {
  ProfitReport,
  FinanceOverviewLoaderData,
  FinanceOverviewPulse,
} from '~/features/finance/types';

export const meta: MetaFunction = () => [{ title: 'Finance — Yannis EOSE' }];

const emptyProfit: ProfitReport = {
  revenue: 0,
  landedCost: 0,
  deliveryFee: 0,
  adSpend: 0,
  commission: 0,
  fulfillmentCost: 0,
  operationalLoss: 0,
  trueProfit: 0,
  orderCount: 0,
  margin: 0,
};

const emptyPulse: FinanceOverviewPulse = {
  awaitingCash: 0,
  awaitingOrderCount: 0,
  pendingRemittanceAmount: 0,
  pendingRemittanceBatchCount: 0,
  disputedRemittanceBatchCount: 0,
  disputedRemittanceAmount: 0,
  totalRemitted: 0,
  totalRemittedCount: 0,
  receivedAmount: 0,
  receivedCount: 0,
  deliveredCount: 0,
  deliveredAmount: 0,
  deliveredNetAmount: 0,
  grossOrderValue: 0,
  totalDeliveryFees: 0,
  deliveryFeeCount: 0,
  totalCommitmentFees: 0,
  commitmentFeeCount: 0,
  totalPosFees: 0,
  posFeeCount: 0,
  totalFailedDeliveryCosts: 0,
  failedDeliveryCount: 0,
  payrollPendingFinanceCount: 0,
  approvalsPendingCount: 0,
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  // Default to this month (Lagos timezone) when no date params and not explicitly all_time.
  const defaults = defaultThisMonthRange();
  const startDateRaw = url.searchParams.get('startDate') || (periodAllTime ? undefined : defaults.startDate);
  const endDateRaw = url.searchParams.get('endDate') || (periodAllTime ? undefined : defaults.endDate);
  // Time-aware filter — when present, compose with the date so the API window
  // is the precise moment the user picked instead of being bumped to 23:59.
  const startTime = url.searchParams.get('startTime') || undefined;
  const endTime = url.searchParams.get('endTime') || undefined;
  const composeBound = (date?: string, time?: string): string | undefined => {
    if (!date) return undefined;
    if (!time) return date;
    return `${date}T${time}:00`;
  };
  const startDate = composeBound(startDateRaw, startTime);
  const endDate = composeBound(endDateRaw, endTime);
  // Optional dimensional slice — branch and/or media buyer.
  const branchId = url.searchParams.get('branchId') || undefined;
  const mediaBuyerId = url.searchParams.get('mediaBuyerId') || undefined;

  const financeShell = {
    filters: {
      startDate: startDateRaw ?? '',
      endDate: endDateRaw ?? '',
      startTime: startTime ?? '',
      endTime: endTime ?? '',
      branchId: branchId ?? '',
      mediaBuyerId: mediaBuyerId ?? '',
      periodAllTime,
    },
  };

  const pageData = (async (): Promise<FinanceOverviewLoaderData> => {
    // One bundle endpoint replaces 6 parallel HTTP calls (profitReport,
    // listDeliveryRemittances, listMonthlyPayrolls, listApprovalRequests,
    // branches.list, users.list[MEDIA_BUYER]). Same 6 service calls run in
    // parallel server-side; the wire trip is single.
    const bundleInput = encodeURIComponent(
      JSON.stringify({
        startDate,
        endDate,
        ...(branchId && { branchId }),
        ...(mediaBuyerId && { mediaBuyerId }),
      }),
    );
    const bundleRes = await apiRequest<unknown>(
      `/trpc/finance.overviewPageBundle?input=${bundleInput}`,
      { method: 'GET', cookie },
    );

    type BreakdownRow = { productId?: string; locationId?: string | null; productName?: string; locationName?: string; totalAmount: string; orderCount: number };
    type BundleData = {
      profit: ProfitReport | null;
      remittanceSummary: Record<string, string | number> | null;
      payrollBatchCount: number;
      approvalsPendingCount: number;
      branches: Array<{ id: string; name: string }>;
      mediaBuyers: Array<{ id: string; name: string }>;
      fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string; sentCount: number; completedCount: number; disputedCount: number } | null;
      byProduct: BreakdownRow[];
      byLocation: BreakdownRow[];
    };
    const bundle = bundleRes.ok
      ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
      : null;

    const remSummary = bundle?.remittanceSummary;
    let pulse: FinanceOverviewPulse = {
      ...emptyPulse,
      awaitingCash: Number(remSummary?.awaitingAmount ?? 0),
      awaitingOrderCount: Number(remSummary?.awaitingCount ?? 0),
      pendingRemittanceAmount: Number(remSummary?.pendingAmount ?? 0),
      pendingRemittanceBatchCount: Number(remSummary?.pendingCount ?? 0),
      disputedRemittanceBatchCount: Number(remSummary?.disputedCount ?? 0),
      disputedRemittanceAmount: Number(remSummary?.disputedAmount ?? 0),
      totalRemitted: Number(remSummary?.totalRemitted ?? 0),
      totalRemittedCount: Number(remSummary?.totalCount ?? 0),
      receivedAmount: Number(remSummary?.receivedAmount ?? 0),
      receivedCount: Number(remSummary?.receivedCount ?? 0),
      deliveredCount: Number(remSummary?.deliveredCount ?? 0),
      deliveredAmount: Number(remSummary?.deliveredAmount ?? 0),
      deliveredNetAmount: Number(remSummary?.deliveredNetAmount ?? 0),
      grossOrderValue: Number(remSummary?.grossOrderValue ?? 0),
      totalDeliveryFees: Number(remSummary?.totalDeliveryFees ?? 0),
      deliveryFeeCount: Number(remSummary?.deliveryFeeCount ?? 0),
      totalCommitmentFees: Number(remSummary?.totalCommitmentFees ?? 0),
      commitmentFeeCount: Number(remSummary?.commitmentFeeCount ?? 0),
      totalPosFees: Number(remSummary?.totalPosFees ?? 0),
      posFeeCount: Number(remSummary?.posFeeCount ?? 0),
      totalFailedDeliveryCosts: Number(remSummary?.totalFailedDeliveryCosts ?? 0),
      failedDeliveryCount: Number(remSummary?.failedDeliveryCount ?? 0),
      payrollPendingFinanceCount: bundle?.payrollBatchCount ?? 0,
      approvalsPendingCount: bundle?.approvalsPendingCount ?? 0,
    };

    return {
      profit: bundle?.profit ?? emptyProfit,
      pulse,
      filters: financeShell.filters,
      branches: bundle?.branches ?? [],
      mediaBuyers: bundle?.mediaBuyers ?? [],
      fundingSummary: bundle?.fundingSummary ?? { totalSent: '0', totalCompleted: '0', totalDisputed: '0', sentCount: 0, completedCount: 0, disputedCount: 0 },
      byProduct: (bundle?.byProduct ?? []).map((r) => ({
        productId: r.productId ?? '',
        productName: r.productName ?? '',
        totalAmount: r.totalAmount,
        orderCount: r.orderCount,
      })),
      byLocation: (bundle?.byLocation ?? []).map((r) => ({
        locationId: r.locationId ?? '',
        locationName: r.locationName ?? '',
        totalAmount: r.totalAmount,
        orderCount: r.orderCount,
      })),
    };
  })();

  return defer({ financeShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function FinanceRoute() {
  const { financeShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<FinanceOverviewLoadingShell filters={financeShell.filters} />}
      loaderShell={{ financeShell }}
      deferredKey="pageData"
    >
      {(data) => <FinancePage data={data} />}
    </CachedAwait>
  );
}
