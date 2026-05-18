import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

/** Single entry for /admin/cs → Live Activities (/admin/cs/queue) */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.toString();
  return redirect(search ? `/admin/cs/queue?${search}` : '/admin/cs/queue');
}
