import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
  parsePerPage,
  getCurrentUser,
} from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { JournalEntriesLoadingShell } from '~/features/accounting/AccountingDeferredLoadingShells';
import {
  JournalEntriesPage,
  type JournalEntryRow,
} from '~/features/accounting/JournalEntriesPage';

export const meta: MetaFunction = () => [{ title: 'Journal Entries — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

interface ListResponse {
  records: JournalEntryRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

const EMPTY: ListResponse = {
  records: [],
  pagination: { total: 0, page: 1, pageSize: 50, totalPages: 1 },
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER', 'ACCOUNTANT'],
    permission: 'accounting.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 50 });

  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;

  const canApprove =
    isAdminLevel(user) || user.role === 'FINANCE_OFFICER';

  const perms = (user as { permissions?: string[] }).permissions ?? [];
  const canWrite = isAdminLevel(user) || user.role === 'FINANCE_OFFICER' || perms.includes('accounting.write');

  const shell = {
    canWrite,
    canApprove,
    filters: { status: status ?? '', search: search ?? '', startDate: startDate ?? '', endDate: endDate ?? '' },
  };

  const pageData = (async () => {
    const input = encodeURIComponent(JSON.stringify({
      page,
      limit: perPage,
      ...(status ? { status } : {}),
      ...(search ? { search } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    }));
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

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const user = await getCurrentUser(request);
  const canApprove =
    user != null && (isAdminLevel(user) || user.role === 'FINANCE_OFFICER');

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'reverseEntry') {
    const res = await apiRequest<unknown>('/trpc/generalLedger.reverseJournalEntry', {
      method: 'POST',
      cookie,
      body: {
        journalEntryId: formData.get('journalEntryId')?.toString() ?? '',
        reason: formData.get('reason')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Reversal failed') }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'approveEntry') {
    if (!canApprove) {
      return json({ error: 'Not authorized to approve journal entries' }, { status: 403 });
    }
    const res = await apiRequest<unknown>('/trpc/generalLedger.approveJournalEntry', {
      method: 'POST',
      cookie,
      body: {
        journalEntryId: formData.get('journalEntryId')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Approval failed') }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'rejectEntry') {
    if (!canApprove) {
      return json({ error: 'Not authorized to reject journal entries' }, { status: 403 });
    }
    const reason = formData.get('reason')?.toString()?.trim() ?? '';
    if (!reason) {
      return json({ error: 'Rejection reason is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/generalLedger.rejectJournalEntry', {
      method: 'POST',
      cookie,
      body: {
        journalEntryId: formData.get('journalEntryId')?.toString() ?? '',
        reason,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Rejection failed') }, { status: 400 });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function JournalEntriesRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <JournalEntriesLoadingShell
          filters={{
            startDate: shell.filters.startDate,
            endDate: shell.filters.endDate,
            periodAllTime: !shell.filters.startDate && !shell.filters.endDate,
          }}
        />
      }
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => (
        <JournalEntriesPage
          records={data.records}
          pagination={data.pagination}
          canWrite={shell.canWrite}
          canApprove={shell.canApprove}
          filters={shell.filters}
        />
      )}
    </CachedAwait>
  );
}
