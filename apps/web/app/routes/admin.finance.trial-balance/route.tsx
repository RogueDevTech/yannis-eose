import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, requireAccountingEnabled } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
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

export async function loader({ request }: LoaderFunctionArgs) {
  requireAccountingEnabled();
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const asOfDate = url.searchParams.get('asOfDate') || '';

  const shell = { filters: { asOfDate } };

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
    return { ...data, filters: { asOfDate } };
  })();

  return defer({ shell, pageData });
}

export default function TrialBalanceRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<TrialBalancePage accounts={[]} totals={EMPTY.totals} filters={shell.filters} />}
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
