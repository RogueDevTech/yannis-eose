import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';

// Moved to /admin/accounting/journal-entries/new
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search ?? '';
  return redirect(`/admin/accounting/journal-entries/new${search}`);
}
