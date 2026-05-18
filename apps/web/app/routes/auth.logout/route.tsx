import { redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie } from '~/lib/api.server';

/**
 * Logout action — calls API to invalidate session, clears cookie, redirects to login.
 * This is a resource route (no UI) — triggered by a form POST.
 */
export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const headers = new Headers();

  if (cookie) {
    const res = await apiRequest('/auth/logout', { method: 'POST', cookie });
    for (const c of res.setCookies) {
      headers.append('Set-Cookie', c);
    }
  }

  if (!headers.has('Set-Cookie')) {
    const domain =
      process.env['NODE_ENV'] === 'production' ? process.env['SESSION_COOKIE_DOMAIN']?.trim() : undefined;
    const domainPart = domain ? `; Domain=${domain}` : '';
    const securePart = process.env['NODE_ENV'] === 'production' ? '; Secure; SameSite=Strict' : '; SameSite=Lax';
    headers.set(
      'Set-Cookie',
      `yannis_session=; Path=/${domainPart}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${securePart}`,
    );
  }

  return redirect('/auth', { headers });
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
