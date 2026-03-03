import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { getCurrentUser } from '~/lib/api.server';

/**
 * Root index — redirects authenticated users to /admin, others to /auth.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const user = await getCurrentUser(request);
    return redirect(user ? '/admin' : '/auth');
  } catch {
    return redirect('/auth');
  }
}

export default function Index() {
  return null;
}
