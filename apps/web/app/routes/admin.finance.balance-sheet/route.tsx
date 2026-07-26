import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultThisMonthRange } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { BalanceSheetLoadingShell } from '~/features/accounting/AccountingDeferredLoadingShells';
import { BalanceSheetPage, type BalanceSheetPageProps } from '~/features/accounting/BalanceSheetPage';

export const meta: MetaFunction = () => [{ title: 'Balance Sheet — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

const EMPTY: BalanceSheetPageProps = {
  assets: [],
  liabilities: [],
  equity: [],
  retainedEarnings: 0,
  totalAssets: 0,
  totalLiabilities: 0,
  totalEquity: 0,
  balanced: true,
  asOfDate: null,
};

export async function loader({ request }: LoaderFunctionArgs) {
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
  const shell = { filters: { startDate, endDate, periodAllTime: false } };

  // Balance sheet is point-in-time: use endDate as the "as of" date so the
  // DateFilterBar preset (e.g. "This month") maps to end-of-period.
  const asOfDate = endDate;

  const pageData = (async () => {
    if (consolidated) {
      const input: Record<string, unknown> = {};
      if (asOfDate) input.asOfDate = asOfDate;
      const res = await apiRequest<unknown>(
        `/trpc/generalLedger.consolidatedBS?input=${encodeURIComponent(JSON.stringify(input))}`,
        { method: 'GET', cookie },
      );
      const data = res.ok
        ? ((res.data as { result?: { data?: BalanceSheetPageProps } })?.result?.data ?? EMPTY)
        : EMPTY;
      return { ...data, consolidated: true, filters: { startDate, endDate } };
    }

    const input: Record<string, unknown> = {};
    if (asOfDate) input.asOfDate = asOfDate;
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.balanceSheet?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );
    const data = res.ok
      ? ((res.data as { result?: { data?: BalanceSheetPageProps } })?.result?.data ?? EMPTY)
      : EMPTY;
    return { ...data, consolidated: false, filters: { startDate, endDate } };
  })();

  return defer({ shell, pageData });
}

export default function BalanceSheetRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<BalanceSheetLoadingShell filters={shell.filters} />}
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => <BalanceSheetPage {...data} consolidated={data.consolidated} filters={data.filters} />}
    </CachedAwait>
  );
}
