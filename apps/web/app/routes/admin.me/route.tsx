import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { getCurrentUser } from '~/lib/api.server';

/** Legacy URL: preferences and push now live under `/admin/settings`. */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) {
    const dest = new URL(request.url).pathname + new URL(request.url).search;
    throw redirect(`/auth?redirectTo=${encodeURIComponent(dest)}`);
  }
  const url = new URL(request.url);
  const next = new URL('/admin/settings', url.origin);
  const tab = url.searchParams.get('tab');
  if (tab === 'notifications') {
    next.searchParams.set('tab', 'push');
  } else if (tab === 'profile') {
    next.searchParams.set('tab', 'profile');
  }
  throw redirect(next.pathname + next.search);
}

export default function LegacyAdminMeRedirect() {
  return null;
}
