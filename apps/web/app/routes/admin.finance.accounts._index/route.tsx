import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import {
  ChartOfAccountsPage,
  type AccountRow,
} from '~/features/accounting/ChartOfAccountsPage';

export const meta: MetaFunction = () => [{ title: 'Chart of Accounts — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);

  const shell = { canWrite: true };

  const pageData = (async () => {
    const input = encodeURIComponent(JSON.stringify({ includeInactive: false }));
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.listAccounts?input=${input}`,
      { method: 'GET', cookie },
    );
    const accounts: AccountRow[] = res.ok
      ? ((res.data as { result?: { data?: AccountRow[] } })?.result?.data ?? [])
      : [];
    return { accounts };
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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function ChartOfAccountsRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<ChartOfAccountsPage accounts={[]} canWrite={shell.canWrite} />}
    >
      {(data) => <ChartOfAccountsPage accounts={data.accounts} canWrite={shell.canWrite} />}
    </CachedAwait>
  );
}
