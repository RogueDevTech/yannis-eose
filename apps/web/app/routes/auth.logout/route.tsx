import { redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie } from '~/lib/api.server';

/**
 * Logout action — calls API to invalidate session, clears cookie, redirects to login.
 * This is a resource route (no UI) — triggered by a form POST.
 */
export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);

  if (cookie) {
    await apiRequest('/auth/logout', { method: 'POST', cookie });
  }

  // Clear the cookie on the client side and redirect to login
  return redirect('/auth', {
    headers: {
      'Set-Cookie': 'yannis_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly',
    },
  });
}

/**
 * If someone navigates to /auth/logout directly via GET, redirect to auth.
 */
export function loader(_args: LoaderFunctionArgs) {
  return redirect('/auth');
}

export default function LogoutRedirect() {
  return null;
}
