import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, requireAccountingEnabled, defaultThisMonthRange } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { ProfitAndLossPage, type ProfitAndLossPageProps } from '~/features/accounting/ProfitAndLossPage';

export const meta: MetaFunction = () => [{ title: 'Profit & Loss — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

const EMPTY: ProfitAndLossPageProps = {
  income: [],
  expense: [],
  totalIncome: 0,
  totalExpense: 0,
  netProfit: 0,
  period: { startDate: null, endDate: null },
};

export async function loader({ request }: LoaderFunctionArgs) {
  requireAccountingEnabled();
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const defaults = defaultThisMonthRange();
  const startDate = url.searchParams.get('startDate') || defaults.startDate;
  const endDate = url.searchParams.get('endDate') || defaults.endDate;
  const consolidated = url.searchParams.get('consolidated') === 'true';

  const pageData = (async () => {
    if (consolidated) {
      const input = encodeURIComponent(JSON.stringify({ startDate, endDate }));
      const res = await apiRequest<unknown>(
        `/trpc/generalLedger.consolidatedPL?input=${input}`,
        { method: 'GET', cookie },
      );
      const data = res.ok
        ? ((res.data as { result?: { data?: ProfitAndLossPageProps } })?.result?.data ?? EMPTY)
        : EMPTY;
      return { ...data, consolidated: true };
    }

    const input = encodeURIComponent(JSON.stringify({ startDate, endDate }));
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.profitAndLoss?input=${input}`,
      { method: 'GET', cookie },
    );
    const data = res.ok
      ? ((res.data as { result?: { data?: ProfitAndLossPageProps } })?.result?.data ?? EMPTY)
      : EMPTY;
    return { ...data, consolidated: false };
  })();

  return defer({ pageData });
}

export default function ProfitLossRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<ProfitAndLossPage {...EMPTY} />}>
      {(data) => <ProfitAndLossPage {...data} consolidated={data.consolidated} />}
    </CachedAwait>
  );
}
