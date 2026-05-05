import { useLoaderData } from '@remix-run/react';
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { FinancePage } from '~/features/finance/FinancePage';
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
  payrollPendingFinanceCount: 0,
  approvalsPendingCount: 0,
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;
  const periodAllTime = url.searchParams.get('period') === 'all_time';

  const profitInput = {
    groupBy: 'product' as const,
    startDate,
    endDate,
    includeProductBreakdown: true,
  };
  const remitInput = JSON.stringify({ page: 1, limit: 1 });
  const payrollInput = JSON.stringify({ status: 'PENDING_FINANCE' as const });
  const approvalInput = JSON.stringify({ status: 'PENDING' as const, page: 1, limit: 1 });

  const [profitRes, remitRes, payrollRes, approvalRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/finance.profitReport?input=${encodeURIComponent(JSON.stringify(profitInput))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      '/trpc/logistics.listDeliveryRemittances?input=' + encodeURIComponent(remitInput),
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      '/trpc/hr.listMonthlyPayrolls?input=' + encodeURIComponent(payrollInput),
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      '/trpc/finance.listApprovalRequests?input=' + encodeURIComponent(approvalInput),
      { method: 'GET', cookie },
    ),
  ]);

  const profitData = profitRes.ok
    ? (profitRes.data as { result?: { data?: ProfitReport } })?.result?.data
    : null;

  let pulse: FinanceOverviewPulse = { ...emptyPulse };
  if (remitRes.ok) {
    const summary = (
      remitRes.data as { result?: { data?: { summary?: Record<string, string> } } }
    )?.result?.data?.summary;
    if (summary) {
      pulse = {
        ...pulse,
        awaitingCash: Number(summary.awaitingAmount ?? 0),
        awaitingOrderCount: Number(summary.awaitingCount ?? 0),
        pendingRemittanceAmount: Number(summary.pendingAmount ?? 0),
        pendingRemittanceBatchCount: Number(summary.pendingCount ?? 0),
        disputedRemittanceBatchCount: Number(summary.disputedCount ?? 0),
      };
    }
  }
  if (payrollRes.ok) {
    const batches =
      (payrollRes.data as { result?: { data?: { batches?: unknown[] } } })?.result?.data?.batches ?? [];
    pulse = { ...pulse, payrollPendingFinanceCount: batches.length };
  }
  if (approvalRes.ok) {
    const total =
      (approvalRes.data as { result?: { data?: { pagination?: { total: number } } } })?.result?.data
        ?.pagination?.total ?? 0;
    pulse = { ...pulse, approvalsPendingCount: total };
  }

  return json<FinanceOverviewLoaderData>({
    profit: profitData ?? emptyProfit,
    pulse,
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
  });
}

export default function FinanceRoute() {
  const data = useLoaderData<typeof loader>();
  return <FinancePage data={data} />;
}
