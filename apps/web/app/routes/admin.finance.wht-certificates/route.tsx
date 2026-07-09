import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, requireAccountingEnabled } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import {
  WhtCertificatesPage,
  type WhtDeductionRow,
} from '~/features/accounting/WhtCertificatesPage';

export const meta: MetaFunction = () => [{ title: 'WHT Certificates — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

interface ListWhtResponse {
  records: WhtDeductionRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

const EMPTY: ListWhtResponse = {
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
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';
  const page = Number(url.searchParams.get('page') || '1');

  const shell = { filters: { startDate, endDate } };

  const pageData = (async () => {
    const input: Record<string, unknown> = { page, limit: 50 };
    if (startDate) input.startDate = startDate;
    if (endDate) input.endDate = endDate;
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.listWht?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );
    const data: ListWhtResponse = res.ok
      ? ((res.data as { result?: { data?: ListWhtResponse } })?.result?.data ?? EMPTY)
      : EMPTY;
    return { ...data, filters: { startDate, endDate } };
  })();

  return defer({ shell, pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  requireAccountingEnabled();
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.write',
  });
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent');

  if (intent === 'recordWht') {
    const input = {
      vendorName: String(form.get('vendorName') || ''),
      grossAmount: Number(form.get('grossAmount') || 0),
      whtRate: Number(form.get('whtRate') || 5),
      paymentDate: String(form.get('paymentDate') || ''),
      description: String(form.get('description') || '') || undefined,
    };
    const res = await apiRequest<unknown>(
      '/trpc/generalLedger.recordWht',
      { method: 'POST', cookie, body: JSON.stringify(input) },
    );
    return json({ success: res.ok, error: res.ok ? null : 'Failed to record WHT deduction' });
  }

  if (intent === 'generateCertificate') {
    const deductionId = String(form.get('deductionId') || '');
    const res = await apiRequest<unknown>(
      '/trpc/generalLedger.generateWhtCertificate',
      { method: 'POST', cookie, body: JSON.stringify({ deductionId }) },
    );
    return json({ success: res.ok, error: res.ok ? null : 'Failed to generate certificate' });
  }

  return json({ success: false, error: 'Unknown intent' });
}

export default function WhtCertificatesRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={
        <WhtCertificatesPage
          records={[]}
          pagination={EMPTY.pagination}
          filters={shell.filters}
        />
      }
    >
      {(data) => (
        <WhtCertificatesPage
          records={data.records}
          pagination={data.pagination}
          filters={data.filters}
        />
      )}
    </CachedAwait>
  );
}
