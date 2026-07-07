import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { CachedAwait } from '~/components/ui/cached-await';
import { JournalEntryCreatePage } from '~/features/accounting/JournalEntryCreatePage';

export const meta: MetaFunction = () => [{ title: 'New Journal Entry — Accounting — Yannis EOSE' }];

interface AccountOpt {
  id: string;
  code: string;
  name: string;
  isGroup: boolean;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.write',
  });
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const input = encodeURIComponent(JSON.stringify({ includeInactive: false }));
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.listAccounts?input=${input}`,
      { method: 'GET', cookie },
    );
    const accounts: AccountOpt[] = res.ok
      ? ((res.data as { result?: { data?: AccountOpt[] } })?.result?.data ?? [])
      : [];
    return { accounts };
  })();

  return defer({ pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createEntry') {
    let payload: unknown;
    try {
      payload = JSON.parse(formData.get('payload')?.toString() ?? '{}');
    } catch {
      return json({ error: 'Malformed entry payload.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/generalLedger.createJournalEntry', {
      method: 'POST',
      cookie,
      body: payload,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to post entry') }, { status: 400 });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function JournalEntryCreateRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<JournalEntryCreatePage accounts={[]} />}>
      {(data) => <JournalEntryCreatePage accounts={data.accounts} />}
    </CachedAwait>
  );
}
