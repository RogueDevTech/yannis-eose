import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

/** Single entry for /admin/marketing → /admin/marketing/funding */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.toString();
  return redirect(search ? `/admin/marketing/funding?${search}` : '/admin/marketing/funding');
}
