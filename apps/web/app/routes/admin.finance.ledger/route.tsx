import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
  defaultThisMonthRange,
  parsePerPage,
} from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { GeneralLedgerPage } from '~/features/finance/GeneralLedgerPage';
import { GeneralLedgerLoadingShell } from '~/features/finance/FinanceDeferredLoadingShells';
import type { GeneralLedgerLoaderData, GeneralLedgerEntry } from '~/features/finance/types';

export const meta: MetaFunction = () => [{ title: 'General Ledger — Finance — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

type LedgerResponse = {
  entries: GeneralLedgerEntry[];
  total: number;
  page: number;
  totalPages: number;
  summary: {
    totalCredits: string;
    totalDebits: string;
    closingBalance: string;
    openingBalance?: string;
  };
};

const EMPTY_LEDGER: LedgerResponse = {
  entries: [],
  total: 0,
  page: 1,
  totalPages: 1,
  summary: { totalCredits: '0', totalDebits: '0', closingBalance: '0' },
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  // Date filters — default to this month
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const defaults = defaultThisMonthRange();
  const startDate = url.searchParams.get('startDate') || (periodAllTime ? undefined : defaults.startDate);
  const endDate = url.searchParams.get('endDate') || (periodAllTime ? undefined : defaults.endDate);

  const filters = {
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    periodAllTime,
  };

  const userId = url.searchParams.get('userId') || '';
  const entryTypeFilter = url.searchParams.get('entryType') || 'all';
  const searchFilter = url.searchParams.get('search') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 100 });

  const shell = { filters, selectedUserId: userId, entryTypeFilter, searchFilter };

  const pageData = (async (): Promise<GeneralLedgerLoaderData> => {
    // Fetch users list in parallel with ledger
    const usersRes = await apiRequest<unknown>(
      `/trpc/finance.generalLedgerUsers`,
      { method: 'GET', cookie },
    );
    const users: Array<{ id: string; name: string; role: string }> = usersRes.ok
      ? ((usersRes.data as { result?: { data?: Array<{ id: string; name: string; role: string }> } })?.result?.data ?? [])
      : [];

    const selectedUserName = userId ? (users.find((u) => u.id === userId)?.name ?? '') : '';

    // Build ledger input
    const ledgerInput: Record<string, unknown> = {
      entryType: entryTypeFilter,
      page,
      limit: perPage,
    };
    if (userId) ledgerInput.userId = userId;
    if (searchFilter) ledgerInput.search = searchFilter;
    if (!periodAllTime) {
      if (startDate) ledgerInput.startDate = startDate;
      if (endDate) ledgerInput.endDate = endDate;
    }

    const res = await apiRequest<unknown>(
      `/trpc/finance.generalLedger?input=${encodeURIComponent(JSON.stringify(ledgerInput))}`,
      { method: 'GET', cookie },
    );

    const ledger: LedgerResponse = res.ok
      ? ((res.data as { result?: { data?: LedgerResponse } })?.result?.data ?? EMPTY_LEDGER)
      : EMPTY_LEDGER;

    return {
      ...ledger,
      limit: perPage,
      users,
      selectedUserId: userId,
      selectedUserName,
      filters,
      entryTypeFilter,
      searchFilter,
    };
  })();

  return defer({ shell, pageData });
}

export default function GeneralLedgerRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <GeneralLedgerLoadingShell
          filters={shell.filters}
        />
      }
    >
      {(data) => <GeneralLedgerPage {...(data as GeneralLedgerLoaderData)} />}
    </CachedAwait>
  );
}
