import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { getCurrentUser } from '~/lib/api.server';

/**
 * /admin/profile — pivots to the current user's UserDetailPage at /hr/users/<id>.
 *
 * The route exists so the user dropdown's "My Profile" link can be a stable, role-agnostic
 * URL. The HR loader already has self-view access (any authenticated user may open their own
 * profile) and the page hides destructive admin actions when `isSelfView` is set.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/auth?redirectTo=${url.pathname}`);
  }
  throw redirect(`/hr/users/${user.id}`);
}

export default function AdminProfileRedirect() {
  return null;
}
