import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultThisMonthRange } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { CashFlowLoadingShell } from '~/features/accounting/AccountingDeferredLoadingShells';
import { CashFlowPage, type CashFlowPageProps } from '~/features/accounting/CashFlowPage';

export const meta: MetaFunction = () => [{ title: 'Cash Flow — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

const EMPTY: CashFlowPageProps = {
  accounts: [],
  totals: { opening: 0, inflow: 0, outflow: 0, closing: 0 },
  period: { startDate: null, endDate: null },
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
  const shell = { filters: { startDate, endDate, periodAllTime: false } };

  const pageData = (async () => {
    const input = encodeURIComponent(JSON.stringify({ startDate, endDate }));
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.cashFlow?input=${input}`,
      { method: 'GET', cookie },
    );
    const data = res.ok
      ? ((res.data as { result?: { data?: CashFlowPageProps } })?.result?.data ?? EMPTY)
      : EMPTY;
    return { ...data, filters: { startDate, endDate } };
  })();

  return defer({ shell, pageData });
}

export default function CashFlowRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<CashFlowLoadingShell filters={shell.filters} />}
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => <CashFlowPage {...data} filters={data.filters} />}
    </CachedAwait>
  );
}
