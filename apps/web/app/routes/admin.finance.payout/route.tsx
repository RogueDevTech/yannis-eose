import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { FinancePayoutPage } from '~/features/finance/FinancePayoutPage';
import { ListFilterPersistence } from '~/components/list-filter-persistence';
import { ALLOWLIST_FINANCE_PAYOUT, LIST_FILTER_SCOPES } from '~/lib/list-filter-persistence-scopes';
import type { MonthlyPayrollGroup, PayrollBatch, PayrollBatchStatus } from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'Payout — Finance — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const statusRaw = (url.searchParams.get('status') ?? '') as '' | PayrollBatchStatus;
  const status = statusRaw === 'PENDING_FINANCE' || statusRaw === 'PAID' ? statusRaw : '';
  const batchId = url.searchParams.get('batchId');

  const listInput: { status?: PayrollBatchStatus } = {};
  if (status) listInput.status = status;
  const listRes = await apiRequest<unknown>(
    `/trpc/hr.listMonthlyPayrolls?input=${encodeURIComponent(JSON.stringify(listInput))}`,
    { method: 'GET', cookie },
  );

  const byMonth = listRes.ok
    ? ((listRes.data as { result?: { data?: { byMonth: MonthlyPayrollGroup[] } } })?.result?.data?.byMonth ?? [])
    : [];
  const batches = byMonth.flatMap((group) => group.items) as PayrollBatch[];

  let selectedBatch: unknown = null;
  if (batchId) {
    const batchRes = await apiRequest<unknown>('/trpc/hr.getBatch', {
      method: 'POST',
      cookie,
      body: { batchId },
    });
    selectedBatch = batchRes.ok ? (batchRes.data as { result?: { data?: unknown } })?.result?.data ?? null : null;
  }

  return json({ batches, selectedBatch, status });
}

export default function AdminFinancePayoutRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <>
      <ListFilterPersistence scope={LIST_FILTER_SCOPES.financePayout} allowlist={ALLOWLIST_FINANCE_PAYOUT} />
    <FinancePayoutPage
      batches={data.batches}
      selectedBatch={data.selectedBatch as Parameters<typeof FinancePayoutPage>[0]['selectedBatch']}
      status={data.status as '' | PayrollBatchStatus}
    />
    </>
  );
}
