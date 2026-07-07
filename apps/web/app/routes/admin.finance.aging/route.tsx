import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { AgingPage, type AgingPageProps } from '~/features/accounting/AgingPage';

export const meta: MetaFunction = () => [{ title: 'Aging — Accounting — Yannis EOSE' }];

export { cachedClientLoader as clientLoader };

const emptyFor = (kind: 'RECEIVABLE' | 'PAYABLE', asOfDate: string): AgingPageProps => ({
  kind,
  asOfDate,
  parties: [],
  totals: { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0 },
});

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE';
  const asOfDate = url.searchParams.get('asOfDate') || '';

  const shell = { kind, asOfDate };

  const pageData = (async () => {
    const input: Record<string, unknown> = { kind };
    if (asOfDate) input.asOfDate = asOfDate;
    const res = await apiRequest<unknown>(
      `/trpc/generalLedger.aging?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    );
    return res.ok
      ? ((res.data as { result?: { data?: AgingPageProps } })?.result?.data ?? emptyFor(kind, asOfDate))
      : emptyFor(kind, asOfDate);
  })();

  return defer({ shell, pageData });
}

export default function AgingRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<AgingPage {...emptyFor(shell.kind, shell.asOfDate)} />}>
      {(data) => <AgingPage {...data} />}
    </CachedAwait>
  );
}
