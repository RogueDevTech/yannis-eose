import { Suspense } from 'react';
import { defer, type LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Await, useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { FinancePayoutPage, type BatchDetail } from '~/features/finance/FinancePayoutPage';
import { FinancePayoutLoadingShell } from '~/features/finance/FinanceDeferredLoadingShells';
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

  const payoutShell = { status: status as '' | 'PENDING_FINANCE' | 'PAID' };

  const pageData = (async () => {
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

    let selectedBatch: BatchDetail | null = null;
    if (batchId) {
      const batchRes = await apiRequest<unknown>('/trpc/hr.getBatch', {
        method: 'POST',
        cookie,
        body: { batchId },
      });
      selectedBatch = batchRes.ok
        ? ((batchRes.data as { result?: { data?: BatchDetail } })?.result?.data ?? null)
        : null;
    }

    return { batches, selectedBatch, status };
  })();

  return defer({ payoutShell, pageData });
}

export default function AdminFinancePayoutRoute() {
  const { payoutShell, pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<FinancePayoutLoadingShell status={payoutShell.status} />}>
      <Await resolve={pageData}>
        {(data) => (
          <FinancePayoutPage
            batches={data.batches}
            selectedBatch={data.selectedBatch}
            status={data.status as '' | PayrollBatchStatus}
          />
        )}
      </Await>
    </Suspense>
  );
}
