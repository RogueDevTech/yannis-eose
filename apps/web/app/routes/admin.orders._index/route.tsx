import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

/**
 * Backwards compatibility: /admin/orders redirects to /admin/cs/orders
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.toString();
  const redirectTo = search ? `/admin/cs/orders?${search}` : '/admin/cs/orders';
  throw redirect(redirectTo);
}
