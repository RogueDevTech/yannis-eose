import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { getCurrentUser } from '~/lib/api.server';

/**
 * Root index — redirects authenticated users by role: TPL_MANAGER → /tpl, others → /admin.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return redirect('/auth');
    if (user.role === 'TPL_MANAGER') return redirect('/tpl');
    return redirect('/admin');
  } catch (e) {
    if (e instanceof Response) throw e;
    return redirect('/auth');
  }
}

export default function Index() {
  return null;
}
