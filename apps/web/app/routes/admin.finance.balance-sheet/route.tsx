import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requireAccountingEnabled, requirePermissionOrRoles } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
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
  requireAccountingEnabled();
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const asOfDate = url.searchParams.get('asOfDate') || '';
  const consolidated = url.searchParams.get('consolidated') === 'true';

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
      return { ...data, consolidated: true, filters: { asOfDate } };
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
    return { ...data, consolidated: false, filters: { asOfDate } };
  })();

  return defer({ pageData });
}

export default function BalanceSheetRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<BalanceSheetPage {...EMPTY} />}>
      {(data) => <BalanceSheetPage {...data} consolidated={data.consolidated} filters={data.filters} />}
    </CachedAwait>
  );
}
