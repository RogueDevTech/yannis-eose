import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';

// Accounting pages moved from /admin/finance/* to /admin/accounting/*.
// Preserve old bookmarks/links with a permanent-ish redirect (carries query string).
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search ?? '';
  return redirect(`/admin/accounting/assets${search}`);
}
