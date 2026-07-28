import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';

/**
 * The standalone Chart of Accounts page was folded into Account Config
 * (`/admin/finance/account-mappings`) as its "Accounts" tab. Redirect any
 * old links (including OpeningBalances back-navigation) there.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const search = url.search ?? '';
  return redirect(`/admin/finance/account-mappings${search}`);
}
