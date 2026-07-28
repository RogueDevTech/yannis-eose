import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';

// Moved to /admin/accounting/accounts/:accountId
export async function loader({ request, params }: LoaderFunctionArgs) {
  const search = new URL(request.url).search ?? '';
  return redirect(`/admin/accounting/accounts/${params['accountId'] ?? ''}${search}`);
}
