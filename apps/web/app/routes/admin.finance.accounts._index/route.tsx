import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
} from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { ChartOfAccountsLoadingShell } from '~/features/accounting/AccountingDeferredLoadingShells';
import {
  ChartOfAccountsPage,
  type AccountRow,
} from '~/features/accounting/ChartOfAccountsPage';

export const meta: MetaFunction = () => [{ title: 'Chart of Accounts — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const perms = (user as { permissions?: string[] }).permissions ?? [];
  const canWrite = isAdminLevel(user) || user.role === 'FINANCE_OFFICER' || perms.includes('finance.ledger.write');

  const shell = { canWrite };

  const pageData = (async () => {
    const [accountsRes, jeRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/generalLedger.listAccounts?input=${encodeURIComponent(JSON.stringify({ includeInactive: true }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/generalLedger.listJournalEntries?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 1, search: 'Opening balances (cutover)' }))}`,
        { method: 'GET', cookie },
      ),
    ]);
    const accounts: AccountRow[] = accountsRes.ok
      ? ((accountsRes.data as { result?: { data?: AccountRow[] } })?.result?.data ?? [])
      : [];
    const jePayload = jeRes.ok
      ? (jeRes.data as { result?: { data?: { records?: unknown[] } } })?.result?.data
      : null;
    const hasOpeningBalances = (jePayload?.records?.length ?? 0) > 0;
    return { accounts, hasOpeningBalances };
  })();

  return defer({ shell, pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createAccount') {
    const accountTypeRaw = formData.get('accountType')?.toString() || '';
    const parentRaw = formData.get('parentAccountId')?.toString() || '';
    const body = {
      code: formData.get('code')?.toString() ?? '',
      name: formData.get('name')?.toString() ?? '',
      rootType: formData.get('rootType')?.toString() ?? '',
      accountType: accountTypeRaw || null,
      isGroup: formData.get('isGroup')?.toString() === 'true',
      parentAccountId: parentRaw || null,
    };
    const res = await apiRequest<unknown>('/trpc/generalLedger.createAccount', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data) }, { status: 400 });
    }
    return json({ success: true });
  }

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
      return json({ error: extractApiErrorMessage(res.data) }, { status: 400 });
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
      return json({ error: extractApiErrorMessage(res.data) }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'postOpening') {
    const payloadRaw = formData.get('payload')?.toString() ?? '{}';
    let payload: { postingDate?: string; lines?: Array<{ accountId: string; debit: number; credit: number }> };
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      return json({ error: 'Invalid payload' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/generalLedger.postOpeningBalances', {
      method: 'POST',
      cookie,
      body: payload,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to post opening balances') }, { status: 400 });
    }
    return json({ success: true, intent: 'postOpening' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function ChartOfAccountsRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<ChartOfAccountsLoadingShell />}
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => <ChartOfAccountsPage accounts={data.accounts} canWrite={shell.canWrite} hasOpeningBalances={data.hasOpeningBalances} />}
    </CachedAwait>
  );
}
