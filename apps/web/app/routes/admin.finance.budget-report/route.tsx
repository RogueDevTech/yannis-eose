import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, requireAccountingEnabled } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import {
  BudgetVsActualPage,
  type BudgetVsActualRow,
} from '~/features/accounting/BudgetVsActualPage';

export const meta: MetaFunction = () => [{ title: 'Budget Report — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

interface BudgetVsActualResponse {
  rows: BudgetVsActualRow[];
}

const EMPTY: BudgetVsActualResponse = { rows: [] };

export async function loader({ request }: LoaderFunctionArgs) {
  requireAccountingEnabled();
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';

  const shell = { filters: { startDate, endDate } };

  const pageData = (async () => {
    const input: Record<string, unknown> = {};
    if (startDate) input.startDate = startDate;
    if (endDate) input.endDate = endDate;
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.budgetVsActual?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );
    const data = res.ok
      ? ((res.data as { result?: { data?: BudgetVsActualRow[] } })?.result?.data ?? [])
      : [];
    return { rows: data as BudgetVsActualRow[], filters: { startDate, endDate } };
  })();

  return defer({ shell, pageData });
}

export default function BudgetReportRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<BudgetVsActualPage rows={[]} filters={shell.filters} />}
    >
      {(data) => (
        <BudgetVsActualPage
          rows={data.rows}
          filters={data.filters}
        />
      )}
    </CachedAwait>
  );
}
