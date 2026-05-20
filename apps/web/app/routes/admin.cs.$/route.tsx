import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

/**
 * Redirect shim — the CS department was renamed to Sales (CEO 2026-05-19).
 * Every old `/admin/cs/<sub>` URL 301s to `/admin/sales/<sub>` so existing
 * bookmarks, deep-links, and notification links keep working. Query string
 * is preserved. Remove once analytics show no traffic on `/admin/cs/*`.
 */
export function loader({ params, request }: LoaderFunctionArgs) {
  const splat = params['*'] ?? '';
  const search = new URL(request.url).search;
  return redirect(`/admin/sales/${splat}${search}`, 301);
}
