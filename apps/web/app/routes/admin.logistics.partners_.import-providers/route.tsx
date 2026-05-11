import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { requirePermission } from '~/lib/api.server';
import { ProvidersImportPage } from '../../features/logistics/ProvidersImportPage';

export const meta: MetaFunction = () => [
  { title: 'Import logistics companies — Yannis EOSE' },
];

/**
 * Loader for `/admin/logistics/partners/import-providers` — gates on
 * `logistics.write` (matches the underlying createProvider permission). No
 * external data needed; the editor validates against pure rules.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'logistics.write');
  return json({});
}

export default function ProvidersImportRoute() {
  return <ProvidersImportPage />;
}
