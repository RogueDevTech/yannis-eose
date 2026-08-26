import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { requireRole } from '~/lib/api.server';

export const meta: MetaFunction = () => [
  { title: 'Import orders — Yannis EOSE' },
];

// The legacy inline order importer (OrdersImportPage) has been retired in favour
// of the single resumable importer at /admin/sales/orders/bulk-import, which
// resolves product / media buyer / CS / branch / currency per row from the sheet
// (no job-level dropdowns) and runs in the background. This route now permanently
// redirects so old links and bookmarks land on the current importer.
export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ['SUPER_ADMIN', 'SUPPORT']);
  return redirect('/admin/sales/orders/bulk-import');
}
