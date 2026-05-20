import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { CombinedImportPage } from '../../features/logistics/CombinedImportPage';
import type { ProviderInfo } from '../../features/logistics/combined-import-shared';

export const meta: MetaFunction = () => [
  { title: 'Import providers & locations — Yannis EOSE' },
];

/**
 * Loader for `/admin/logistics/partners/import-combined`. Loads all active
 * 3PL providers so the resolver can mark which providers already exist
 * (and pass their IDs to the server for find-or-create idempotency).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'logistics.write');
  const cookie = getSessionCookie(request);

  const providersInput = JSON.stringify({ page: 1, limit: 500, kind: 'THIRD_PARTY' });
  const res = await apiRequest<unknown>(
    `/trpc/logistics.listProviders?input=${encodeURIComponent(providersInput)}`,
    { method: 'GET', cookie },
  );
  let providers: ProviderInfo[] = [];
  if (res.ok) {
    const data = res.data as {
      result?: {
        data?: {
          providers?: Array<{ id: string; name: string; status?: string }>;
        };
      };
    };
    providers = (data?.result?.data?.providers ?? [])
      .filter((p) => p.status !== 'INACTIVE')
      .map((p) => ({ id: p.id, name: p.name, status: p.status ?? 'ACTIVE' }));
  }

  return json({ providers });
}

export default function CombinedImportRoute() {
  const { providers } = useLoaderData<typeof loader>();
  return <CombinedImportPage providers={providers} />;
}
