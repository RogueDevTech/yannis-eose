import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, requireAccountingEnabled } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import {
  TaxReturnsPage,
  type VatTransaction,
} from '~/features/accounting/TaxReturnsPage';

export const meta: MetaFunction = () => [{ title: 'Tax Returns — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

interface VatReturnResponse {
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  transactions: VatTransaction[];
}

const EMPTY: VatReturnResponse = {
  outputVat: 0,
  inputVat: 0,
  netVatPayable: 0,
  periodStart: '',
  periodEnd: '',
  transactionCount: 0,
  transactions: [],
};

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
    // Both dates required for VAT return query.
    if (!startDate || !endDate) {
      return { ...EMPTY, filters: { startDate, endDate } };
    }
    const input = { startDate, endDate };
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.vatReturnSummary?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );
    const data: VatReturnResponse = res.ok
      ? ((res.data as { result?: { data?: VatReturnResponse } })?.result?.data ?? EMPTY)
      : EMPTY;
    return { ...data, filters: { startDate, endDate } };
  })();

  return defer({ shell, pageData });
}

export default function TaxReturnsRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <TaxReturnsPage
          outputVat={0}
          inputVat={0}
          netVatPayable={0}
          periodStart=""
          periodEnd=""
          transactionCount={0}
          transactions={[]}
          filters={shell.filters}
        />
      }
    >
      {(data) => (
        <TaxReturnsPage
          outputVat={data.outputVat}
          inputVat={data.inputVat}
          netVatPayable={data.netVatPayable}
          periodStart={data.periodStart}
          periodEnd={data.periodEnd}
          transactionCount={data.transactionCount}
          transactions={data.transactions}
          filters={data.filters}
        />
      )}
    </CachedAwait>
  );
}
