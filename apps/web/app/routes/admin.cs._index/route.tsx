import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

/**
 * Redirect shim — `/admin/cs` (the old CS department index) 301s to
 * `/admin/sales`. See `admin.cs.$/route.tsx` for the sub-path shim.
 * Remove once `/admin/cs/*` traffic has dried up.
 */
export function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  return redirect(`/admin/sales${search}`, 301);
}
