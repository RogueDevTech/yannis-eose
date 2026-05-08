import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import { defer, type LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
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
  payrollPendingFinanceCount: 0,
  approvalsPendingCount: 0,
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const startDateRaw = url.searchParams.get('startDate') || undefined;
  const endDateRaw = url.searchParams.get('endDate') || undefined;
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
  const periodAllTime = url.searchParams.get('period') === 'all_time';
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
    const profitInput = {
      groupBy: 'product' as const,
      startDate,
      endDate,
      ...(branchId && { branchId }),
      ...(mediaBuyerId && { mediaBuyerId }),
      includeProductBreakdown: true,
    };
    const remitInput = JSON.stringify({ page: 1, limit: 1 });
    const payrollInput = JSON.stringify({ status: 'PENDING_FINANCE' as const });
    const approvalInput = JSON.stringify({ status: 'PENDING' as const, page: 1, limit: 1 });

    const [profitRes, remitRes, payrollRes, approvalRes, branchesRes, buyersRes] = await Promise.all([
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
      // Picklists for the filter bar. Both are best-effort — finance still
      // sees the (filterless) report if either lookup fails.
      apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }).catch(() => ({
        ok: false,
        status: 0,
        data: null,
      })),
      apiRequest<unknown>(
        '/trpc/users.list?input=' +
          encodeURIComponent(
            JSON.stringify({ role: 'MEDIA_BUYER', status: 'ACTIVE', page: 1, limit: 200 }),
          ),
        { method: 'GET', cookie },
      ).catch(() => ({ ok: false, status: 0, data: null })),
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

    const branches = branchesRes.ok
      ? ((branchesRes.data as {
          result?: { data?: Array<{ id: string; name: string }> };
        })?.result?.data ?? []).map((b) => ({ id: b.id, name: b.name }))
      : [];

    const mediaBuyers = buyersRes.ok
      ? ((buyersRes.data as {
          result?: { data?: { users?: Array<{ id: string; name: string }> } };
        })?.result?.data?.users ?? []).map((u) => ({ id: u.id, name: u.name }))
      : [];

    return {
      profit: profitData ?? emptyProfit,
      pulse,
      filters: financeShell.filters,
      branches,
      mediaBuyers,
    };
  })();

  return defer({ financeShell, pageData });
}

export default function FinanceRoute() {
  const { financeShell, pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<FinanceOverviewLoadingShell filters={financeShell.filters} />}>
      <Await resolve={pageData}>
        {(data) => <FinancePage data={data} />}
      </Await>
    </Suspense>
  );
}
