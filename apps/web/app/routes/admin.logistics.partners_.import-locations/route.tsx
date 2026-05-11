import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { LocationsImportPage } from '../../features/logistics/LocationsImportPage';
import type { ProviderInfo } from '../../features/logistics/locations-import-shared';

export const meta: MetaFunction = () => [
  { title: 'Import logistics locations — Yannis EOSE' },
];

/**
 * Loader for `/admin/logistics/partners/import-locations`. Loads ALL active
 * 3PL providers up-front so the per-row provider picker resolves names → IDs
 * inline without an extra round-trip per keystroke.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'logistics.write');
  const cookie = getSessionCookie(request);

  // Pull a generous page of providers — multi-hundred 3PL counts are unlikely
  // and the import editor needs the full list for provider resolution.
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

export default function LocationsImportRoute() {
  const { providers } = useLoaderData<typeof loader>();
  return <LocationsImportPage providers={providers} />;
}
