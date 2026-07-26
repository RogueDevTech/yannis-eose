import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { TrialBalanceLoadingShell } from '~/features/accounting/AccountingDeferredLoadingShells';
import {
  TrialBalancePage,
  type TrialBalanceRow,
} from '~/features/accounting/TrialBalancePage';

export const meta: MetaFunction = () => [{ title: 'Trial Balance — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

interface TrialBalanceResponse {
  accounts: TrialBalanceRow[];
  totals: { totalDebit: number; totalCredit: number; balanced: boolean };
}

const EMPTY: TrialBalanceResponse = {
  accounts: [],
  totals: { totalDebit: 0, totalCredit: 0, balanced: true },
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const startDate = url.searchParams.get('startDate') || monthStart();
  const endDate = url.searchParams.get('endDate') || today();

  // Trial balance uses endDate as the "as of" date
  const asOfDate = periodAllTime ? '' : endDate;

  const shell = { filters: { startDate, endDate, periodAllTime } };

  const pageData = (async () => {
    const input: Record<string, unknown> = {};
    if (asOfDate) input.asOfDate = asOfDate;
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.trialBalance?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );
    const data: TrialBalanceResponse = res.ok
      ? ((res.data as { result?: { data?: TrialBalanceResponse } })?.result?.data ?? EMPTY)
      : EMPTY;
    return { ...data, filters: { startDate, endDate, periodAllTime } };
  })();

  return defer({ shell, pageData });
}

export default function TrialBalanceRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<TrialBalanceLoadingShell filters={shell.filters} />}
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => (
        <TrialBalancePage
          accounts={data.accounts}
          totals={data.totals}
          filters={data.filters}
        />
      )}
    </CachedAwait>
  );
}
