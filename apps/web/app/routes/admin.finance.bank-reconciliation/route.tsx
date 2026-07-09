import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, requireAccountingEnabled } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import {
  BankReconciliationPage,
  type BankReconciliationPageProps,
} from '~/features/accounting/BankReconciliationPage';

export const meta: MetaFunction = () => [{ title: 'Bank Reconciliation — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

const EMPTY: BankReconciliationPageProps = {
  reconciliations: [],
  pagination: { page: 1, limit: 25, total: 0 },
  bankAccounts: [],
  detail: null,
};

export async function loader({ request }: LoaderFunctionArgs) {
  requireAccountingEnabled();
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const selectedId = url.searchParams.get('id');
  const page = parseInt(url.searchParams.get('page') || '1', 10);

  const pageData = (async () => {
    // Fetch list and bank accounts in parallel
    const listInput = encodeURIComponent(JSON.stringify({ page, limit: 25 }));
    const accountsInput = encodeURIComponent(JSON.stringify({ includeInactive: false }));

    const [listRes, accountsRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/generalLedger.listBankReconciliations?input=${listInput}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/generalLedger.listAccounts?input=${accountsInput}`,
        { method: 'GET', cookie },
      ),
    ]);

    const listData = listRes.ok
      ? (listRes.data as { result?: { data?: { reconciliations: unknown[]; pagination: unknown } } })
          ?.result?.data
      : null;

    const allAccounts = accountsRes.ok
      ? ((accountsRes.data as { result?: { data?: unknown[] } })?.result?.data ?? [])
      : [];

    // Filter to BANK accounts only
    const bankAccounts = (allAccounts as Array<{
      id: string;
      code: string;
      name: string;
      accountType: string | null;
      isGroup: boolean;
    }>).filter((a) => a.accountType === 'BANK' && !a.isGroup);

    let detail = null;
    if (selectedId) {
      const detailInput = encodeURIComponent(
        JSON.stringify({ reconciliationId: selectedId }),
      );
      const detailRes = await apiRequest<unknown>(
        `/trpc/generalLedger.getBankReconciliation?input=${detailInput}`,
        { method: 'GET', cookie },
      );
      if (detailRes.ok) {
        detail = (detailRes.data as { result?: { data?: unknown } })?.result?.data ?? null;
      }
    }

    return {
      reconciliations: (listData?.reconciliations ?? []) as BankReconciliationPageProps['reconciliations'],
      pagination: (listData?.pagination ?? { page, limit: 25, total: 0 }) as BankReconciliationPageProps['pagination'],
      bankAccounts: bankAccounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
      detail: detail as BankReconciliationPageProps['detail'],
    };
  })();

  return defer({ pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.write',
  });
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent') as string;

  if (intent === 'createReconciliation') {
    const res = await apiRequest<unknown>(
      '/trpc/generalLedger.createBankReconciliation',
      {
        method: 'POST',
        cookie,
        body: {
          bankAccountId: form.get('bankAccountId') as string,
          statementDate: form.get('statementDate') as string,
          statementBalance: parseFloat(form.get('statementBalance') as string),
          statementLines: JSON.parse(form.get('statementLines') as string),
        },
      },
    );
    return json({ success: res.ok, error: res.ok ? null : 'Failed to create reconciliation.' });
  }

  if (intent === 'matchLine') {
    const res = await apiRequest<unknown>(
      '/trpc/generalLedger.matchBankReconLine',
      {
        method: 'POST',
        cookie,
        body: {
          lineId: form.get('lineId') as string,
          glEntryId: form.get('glEntryId') as string,
        },
      },
    );
    return json({ success: res.ok });
  }

  if (intent === 'unmatchLine') {
    const res = await apiRequest<unknown>(
      '/trpc/generalLedger.unmatchBankReconLine',
      {
        method: 'POST',
        cookie,
        body: { lineId: form.get('lineId') as string },
      },
    );
    return json({ success: res.ok });
  }

  if (intent === 'completeReconciliation') {
    const res = await apiRequest<unknown>(
      '/trpc/generalLedger.completeBankReconciliation',
      {
        method: 'POST',
        cookie,
        body: { reconciliationId: form.get('reconciliationId') as string },
      },
    );
    return json({ success: res.ok });
  }

  return json({ success: false, error: 'Unknown intent.' });
}

export default function BankReconciliationRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<BankReconciliationPage {...EMPTY} />}>
      {(data) => <BankReconciliationPage {...data} />}
    </CachedAwait>
  );
}
