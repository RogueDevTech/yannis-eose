import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { requirePermission } from '~/lib/api.server';
import { ImportPage } from '~/features/data/ImportPage';

export const meta: MetaFunction = () => [
  { title: 'Import — Yannis EOSE' },
];

/**
 * Import type picker. Each card links to that type's own page (orders lives at
 * `/admin/data/import/orders`), so this route only gates the permission — it no
 * longer needs the product / media buyer / CS lists, which are loaded by the
 * importer page that actually uses them.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'data.import');
  return json({});
}

export default function ImportRoute() {
  return <ImportPage />;
}
