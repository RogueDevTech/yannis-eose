import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

/** /admin/analytics → /admin/analytics/audit */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.toString();
  return redirect(search ? `/admin/analytics/audit?${search}` : '/admin/analytics/audit');
}
