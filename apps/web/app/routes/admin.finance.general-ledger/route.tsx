import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requireAccountingEnabled,
  requirePermissionOrRoles,
  parsePerPage,
  defaultThisMonthRange,
} from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { GeneralLedgerPage, type GeneralLedgerPageProps } from '~/features/accounting/GeneralLedgerPage';

export const meta: MetaFunction = () => [{ title: 'General Ledger — Finance — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

type JournalEntryRow = GeneralLedgerPageProps['records'][number];

interface ListResponse {
  records: JournalEntryRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

const EMPTY: ListResponse = {
  records: [],
  pagination: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
};

export async function loader({ request }: LoaderFunctionArgs) {
  requireAccountingEnabled();
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 50 });
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const defaults = defaultThisMonthRange();
  const startDate = url.searchParams.get('startDate') || defaults.startDate;
  const endDate = url.searchParams.get('endDate') || defaults.endDate;

  const shell = {
    filters: {
      startDate,
      endDate,
      status: status ?? '',
      search: search ?? '',
    },
  };

  const pageData = (async () => {
    const input = encodeURIComponent(
      JSON.stringify({
        page,
        limit: perPage,
        ...(status ? { status } : {}),
        ...(search ? { search } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      }),
    );
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.listJournalEntries?input=${input}`,
      { method: 'GET', cookie },
    );
    const data: ListResponse = res.ok
      ? ((res.data as { result?: { data?: ListResponse } })?.result?.data ?? EMPTY)
      : EMPTY;
    return data;
  })();

  return defer({ shell, pageData });
}

export default function GeneralLedgerRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <GeneralLedgerPage
          records={[]}
          pagination={EMPTY.pagination}
          filters={shell.filters}
        />
      }
    >
      {(data) => (
        <GeneralLedgerPage
          records={data.records}
          pagination={data.pagination}
          filters={shell.filters}
        />
      )}
    </CachedAwait>
  );
}
