import { useLoaderData } from '@remix-run/react';
import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { FinancePage } from '~/features/finance/FinancePage';
import type { Invoice, ProfitReport, ApprovalRequest, BudgetWithUtilization, FinanceStreamData } from '~/features/finance/types';
import { handleExportReportAction } from '~/lib/export-report.server';

export const meta: MetaFunction = () => [
  { title: 'Finance — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const invoiceStatus = url.searchParams.get('invoiceStatus') || undefined;
  const approvalStatus = url.searchParams.get('approvalStatus') || undefined;

  const profitInput = { groupBy: 'product' as const, startDate, endDate };

  // Start ALL fetches concurrently
  const invoicesPromise = apiRequest<unknown>(
    `/trpc/finance.listInvoices?input=${encodeURIComponent(JSON.stringify({
      status: invoiceStatus,
      startDate,
      endDate,
    }))}`,
    { method: 'GET', cookie },
  );

  const profitPromise = apiRequest<unknown>(
    `/trpc/finance.profitReport?input=${encodeURIComponent(JSON.stringify(profitInput))}`,
    { method: 'GET', cookie },
  );

  const overviewPromise = apiRequest<unknown>(
    '/trpc/finance.invoiceSummary',
    { method: 'GET', cookie },
  );

  const approvalsPromise = apiRequest<unknown>(
    `/trpc/finance.listApprovalRequests?input=${encodeURIComponent(JSON.stringify({
      status: approvalStatus,
    }))}`,
    { method: 'GET', cookie },
  );

  const budgetsPromise = apiRequest<unknown>(
    '/trpc/finance.listBudgetsWithUtilization',
    { method: 'GET', cookie },
  );

  // Await only critical data: invoices + profit
  const [invoicesRes, profitRes] = await Promise.all([invoicesPromise, profitPromise]);

  const invoicesData = invoicesRes.ok
    ? (invoicesRes.data as { result?: { data?: { invoices: Invoice[]; pagination: { total: number } } } })?.result?.data
    : null;

  const profitData = profitRes.ok
    ? (profitRes.data as { result?: { data?: ProfitReport } })?.result?.data
    : null;

  // Stream secondary data — don't await, return as promises for DeferredSection
  const invoiceSummary = overviewPromise.then((res) => {
    if (!res.ok) return {};
    return (res.data as { result?: { data?: Record<string, { count: number; total: string }> } })?.result?.data ?? {};
  }).catch(() => ({} as Record<string, { count: number; total: string }>));

  const approvalsParsed = approvalsPromise.then((res) => {
    if (!res.ok) return { requests: [] as ApprovalRequest[], total: 0 };
    const d = (res.data as { result?: { data?: { requests: ApprovalRequest[]; pagination: { total: number } } } })?.result?.data;
    return { requests: d?.requests ?? [], total: d?.pagination?.total ?? 0 };
  }).catch(() => ({ requests: [] as ApprovalRequest[], total: 0 }));

  const budgets = budgetsPromise.then((res) => {
    if (!res.ok) return [];
    return (res.data as { result?: { data?: BudgetWithUtilization[] } })?.result?.data ?? [];
  }).catch(() => [] as BudgetWithUtilization[]);

  const approvals = approvalsParsed.then((p) => p.requests);
  const totalApprovals = approvalsParsed.then((p) => p.total);
  const pendingApprovals = approvalsParsed.then((p) =>
    p.requests.filter((r) => r.status === 'PENDING' || r.status === 'QUERIED').length,
  );
  const pendingApprovalsValue = approvalsParsed.then((p) =>
    p.requests
      .filter((r) => r.status === 'PENDING' || r.status === 'QUERIED')
      .reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
  );

  return defer({
    invoices: invoicesData?.invoices ?? [],
    totalInvoices: invoicesData?.pagination?.total ?? 0,
    profit: profitData ?? { revenue: 0, landedCost: 0, deliveryFee: 0, adSpend: 0, commission: 0, fulfillmentCost: 0, operationalLoss: 0, trueProfit: 0, orderCount: 0, margin: 0 },
    filters: { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime, invoiceStatus: invoiceStatus ?? '', approvalStatus: approvalStatus ?? '' },
    invoiceSummary,
    approvals,
    totalApprovals,
    pendingApprovals,
    pendingApprovalsValue,
    budgets,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;

  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createInvoice') {
    const lineItemsRaw = formData.get('lineItems')?.toString();
    let lineItems: { description: string; quantity: number; unitPrice: string }[] = [];
    try {
      lineItems = JSON.parse(lineItemsRaw ?? '[]');
    } catch {
      return json({ error: 'Invalid line items format' }, { status: 400 });
    }

    if (lineItems.length === 0) {
      return json({ error: 'At least one line item is required' }, { status: 400 });
    }

    const recipientInfo = {
      name: formData.get('recipientName')?.toString() ?? '',
      address: formData.get('recipientAddress')?.toString() || undefined,
      email: formData.get('recipientEmail')?.toString() || undefined,
    };

    const res = await apiRequest<unknown>('/trpc/finance.createInvoice', {
      method: 'POST',
      cookie,
      body: {
        orderId: formData.get('orderId')?.toString() || undefined,
        recipientInfo,
        lineItems,
        taxRate: formData.get('taxRate')?.toString() || undefined,
        dueDate: formData.get('dueDate')?.toString() || undefined,
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create invoice' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'updateInvoiceStatus') {
    const res = await apiRequest<unknown>('/trpc/finance.updateInvoiceStatus', {
      method: 'POST',
      cookie,
      body: {
        invoiceId: formData.get('invoiceId')?.toString() ?? '',
        status: formData.get('status')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update invoice status' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'processApproval') {
    const requestId = formData.get('requestId')?.toString() ?? '';
    const action = formData.get('action')?.toString() ?? '';
    const reason = formData.get('reason')?.toString() ?? '';

    if (!requestId || !action || !reason || reason.length < 5) {
      return json({ error: 'A reason of at least 5 characters is required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/finance.processApproval', {
      method: 'POST',
      cookie,
      body: { requestId, action, reason },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to process approval' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'flagOverdueInvoices') {
    const res = await apiRequest<unknown>('/trpc/finance.flagOverdueInvoices', {
      method: 'POST',
      cookie,
      body: {},
    });
    if (!res.ok) {
      return json({ error: 'Failed to flag overdue invoices' }, { status: safeStatus(res.status) });
    }
    return json({ success: true, flagged: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FinanceRoute() {
  const data = useLoaderData<typeof loader>() as unknown as FinanceStreamData;
  return <FinancePage data={data} />;
}
