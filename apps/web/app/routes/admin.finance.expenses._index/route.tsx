import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, requireAccountingEnabled, parsePerPage } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { ExpenseSubmissionsPage, type ExpenseRow } from '~/features/finance/ExpenseSubmissionsPage';

export const meta: MetaFunction = () => [{ title: 'Expense Submissions — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

interface ListResponse {
  expenses: ExpenseRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY: ListResponse = {
  expenses: [],
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

  const shell = { canWrite: true };

  const pageData = (async () => {
    const [expensesRes, accountsRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/generalLedger.listExpenses?input=${encodeURIComponent(
          JSON.stringify({
            page,
            limit: perPage,
            ...(status && { status }),
          }),
        )}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/generalLedger.listAccounts?input=${encodeURIComponent(
          JSON.stringify({ includeInactive: false }),
        )}`,
        { method: 'GET', cookie },
      ),
    ]);

    const expenses: ListResponse = expensesRes.ok
      ? ((expensesRes.data as { result?: { data?: ListResponse } })?.result?.data ?? EMPTY)
      : EMPTY;

    type RawAccount = AccountOption & { isGroup?: boolean };
    const accountsList: AccountOption[] = accountsRes.ok
      ? ((accountsRes.data as { result?: { data?: RawAccount[] } })?.result?.data ?? [])
          .filter((a) => !a.isGroup)
      : [];

    return { ...expenses, accounts: accountsList };
  })();

  return defer({ shell, pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  requireAccountingEnabled();
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'submitExpense') {
    const res = await apiRequest<unknown>('/trpc/generalLedger.submitExpense', {
      method: 'POST',
      cookie,
      body: {
        vendorName: formData.get('vendorName')?.toString() ?? '',
        description: formData.get('description')?.toString() ?? '',
        amount: formData.get('amount')?.toString() ?? '0',
        receiptUrl: formData.get('receiptUrl')?.toString() || undefined,
        branchId: formData.get('branchId')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to submit expense') }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'approveExpense') {
    const res = await apiRequest<unknown>('/trpc/generalLedger.approveExpense', {
      method: 'POST',
      cookie,
      body: {
        expenseId: formData.get('expenseId')?.toString() ?? '',
        glAccountId: formData.get('glAccountId')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to approve expense') }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'rejectExpense') {
    const res = await apiRequest<unknown>('/trpc/generalLedger.rejectExpense', {
      method: 'POST',
      cookie,
      body: {
        expenseId: formData.get('expenseId')?.toString() ?? '',
        reason: formData.get('reason')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reject expense') }, { status: 400 });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function ExpenseSubmissionsRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <ExpenseSubmissionsPage
          expenses={[]}
          pagination={EMPTY.pagination}
          accounts={[]}
          canWrite={shell.canWrite}
        />
      }
    >
      {(data) => (
        <ExpenseSubmissionsPage
          expenses={data.expenses}
          pagination={data.pagination}
          accounts={data.accounts}
          canWrite={shell.canWrite}
        />
      )}
    </CachedAwait>
  );
}
