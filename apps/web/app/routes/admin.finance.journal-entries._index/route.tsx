import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requireAccountingEnabled, requirePermissionOrRoles, parsePerPage } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
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
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;

  const shell = {
    canWrite: true,
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
  requireAccountingEnabled();
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function JournalEntriesRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<JournalEntriesPage records={[]} pagination={EMPTY.pagination} canWrite={shell.canWrite} filters={shell.filters} />}
    >
      {(data) => (
        <JournalEntriesPage
          records={data.records}
          pagination={data.pagination}
          canWrite={shell.canWrite}
          filters={shell.filters}
        />
      )}
    </CachedAwait>
  );
}
