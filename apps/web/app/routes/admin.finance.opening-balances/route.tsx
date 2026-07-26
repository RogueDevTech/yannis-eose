import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { CachedAwait } from '~/components/ui/cached-await';
import { OpeningBalancesLoadingShell } from '~/features/accounting/AccountingDeferredLoadingShells';
import { OpeningBalancesPage } from '~/features/accounting/OpeningBalancesPage';

export const meta: MetaFunction = () => [{ title: 'Opening Balances — Accounting — Yannis EOSE' }];

interface AccountOpt {
  id: string;
  code: string;
  name: string;
  isGroup: boolean;
  rootType: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.write',
  });
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const [accountsRes, jeRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/generalLedger.listAccounts?input=${encodeURIComponent(JSON.stringify({ includeInactive: false }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/generalLedger.listJournalEntries?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 1, search: 'Opening balances (cutover)' }))}`,
        { method: 'GET', cookie },
      ),
    ]);
    const accounts: AccountOpt[] = accountsRes.ok
      ? ((accountsRes.data as { result?: { data?: AccountOpt[] } })?.result?.data ?? [])
      : [];

    // Check if opening balances already posted
    const jePayload = jeRes.ok
      ? (jeRes.data as { result?: { data?: { records?: Array<{ id: string; postingDate: string }> } } })?.result?.data
      : null;
    const existingJE = jePayload?.records?.[0] ?? null;

    // If posted, fetch the GL lines for that JE to pre-fill
    let postedLines: Array<{ accountId: string; debit: number; credit: number }> = [];
    if (existingJE) {
      const detailRes = await apiRequest<unknown>(
        `/trpc/generalLedger.getJournalEntry?input=${encodeURIComponent(JSON.stringify({ journalEntryId: existingJE.id }))}`,
        { method: 'GET', cookie },
      );
      if (detailRes.ok) {
        const detail = (detailRes.data as { result?: { data?: { lines?: Array<{ accountId: string; debit: string; credit: string }> } } })?.result?.data;
        postedLines = (detail?.lines ?? []).map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        }));
      }
    }

    return {
      accounts,
      alreadyPosted: !!existingJE,
      postedDate: existingJE?.postingDate ?? null,
      postedLines,
    };
  })();

  return defer({ pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'postOpening') {
    let payload: unknown;
    try {
      payload = JSON.parse(formData.get('payload')?.toString() ?? '{}');
    } catch {
      return json({ error: 'Malformed payload.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/generalLedger.postOpeningBalances', {
      method: 'POST',
      cookie,
      body: payload,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to post opening balances') }, { status: 400 });
    }
    return redirect('/admin/finance/accounts');
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function OpeningBalancesRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<OpeningBalancesLoadingShell />} deferredKey="pageData">
      {(data) => (
        <OpeningBalancesPage
          accounts={data.accounts}
          alreadyPosted={data.alreadyPosted}
          postedDate={data.postedDate}
          postedLines={data.postedLines}
        />
      )}
    </CachedAwait>
  );
}
