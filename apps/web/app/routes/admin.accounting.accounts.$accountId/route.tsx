import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermissionOrRoles,
  defaultThisMonthRange,
  parsePerPage,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { isAdminLevel } from '~/lib/rbac';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import {
  AccountDetailPage,
  type AccountInfo,
  type LedgerEntryRow,
} from '~/features/accounting/AccountDetailPage';
import { AccountDetailLoadingShell } from '~/features/accounting/AccountingDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Account Detail — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

interface LedgerResponse {
  account: AccountInfo;
  entries: LedgerEntryRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  summary: { totalDebit: string; totalCredit: string; netBalance: string; entryCount: number };
}

const EMPTY: LedgerResponse = {
  account: {
    id: '',
    code: '',
    name: 'Loading...',
    rootType: 'ASSET',
    accountType: null,
    isGroup: false,
    isActive: true,
    balance: '0',
    parentAccountId: null,
  },
  entries: [],
  pagination: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
  summary: { totalDebit: '0', totalCredit: '0', netBalance: '0', entryCount: 0 },
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER', 'ACCOUNTANT'],
    permission: 'accounting.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const accountId = params.accountId ?? '';
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const defaults = defaultThisMonthRange();
  const startDate = url.searchParams.get('startDate') || (periodAllTime ? undefined : defaults.startDate);
  const endDate = url.searchParams.get('endDate') || (periodAllTime ? undefined : defaults.endDate);

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 50 });

  const perms = (user as { permissions?: string[] } | null)?.permissions ?? [];
  const canWrite = isAdminLevel(user) || user?.role === 'FINANCE_OFFICER' || perms.includes('accounting.write');

  const filters = {
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    periodAllTime,
  };

  const shell = { filters, canWrite };

  const pageData = (async () => {
    const input: Record<string, unknown> = {
      accountId,
      page,
      limit: perPage,
    };
    if (!periodAllTime) {
      if (startDate) input.startDate = startDate;
      if (endDate) input.endDate = endDate;
    }

    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.getAccountLedger?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );

    const data: LedgerResponse = res.ok
      ? ((res.data as { result?: { data?: LedgerResponse } })?.result?.data ?? EMPTY)
      : EMPTY;

    return { ...data, filters, canWrite };
  })();

  return defer({ shell, pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'updateAccount') {
    const body = {
      accountId: formData.get('accountId')?.toString() ?? '',
      name: formData.get('name')?.toString()?.trim() ?? '',
    };
    const res = await apiRequest<unknown>('/trpc/generalLedger.updateAccount', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update account') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'deactivateAccount') {
    const body = {
      accountId: formData.get('accountId')?.toString() ?? '',
    };
    const res = await apiRequest<unknown>('/trpc/generalLedger.deactivateAccount', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to deactivate account') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AccountDetailRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<AccountDetailLoadingShell filters={shell.filters} />}
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => (
        <AccountDetailPage
          account={data.account}
          entries={data.entries}
          pagination={data.pagination}
          summary={data.summary}
          filters={data.filters}
          canWrite={data.canWrite}
        />
      )}
    </CachedAwait>
  );
}
