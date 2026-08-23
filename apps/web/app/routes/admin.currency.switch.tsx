import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

const ALLOWED_NEXT_PREFIXES = ['/admin', '/hr', '/tpl', '/auth'] as const;

/** Same-origin path guard for the optional `next` field (open-redirect safe). */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  for (const prefix of ALLOWED_NEXT_PREFIXES) {
    if (raw === prefix || raw.startsWith(`${prefix}/`) || raw.startsWith(`${prefix}?`)) {
      return raw;
    }
  }
  return null;
}

/**
 * Multi-country VIEW switch action — mirrors admin.branches.switch.
 * Called by the top-bar HeaderCountrySwitcher. POSTs to `/auth/switch-currency`
 * (updates the Redis session + re-issues the signed bundle cookie), then also
 * hits `/auth/me` so the canonical bundle re-issuer runs, forwarding Set-Cookie.
 * Empty `code` clears the view (all allowed countries).
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return redirect('/auth');

  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const raw = form.get('code')?.toString() ?? '';
  const code = raw === '' ? null : raw.toUpperCase();
  const next = safeNext(form.get('next')?.toString() ?? null);

  const switchRes = await apiRequest('/auth/switch-currency', {
    method: 'POST',
    cookie,
    body: { code },
  });

  if (!switchRes.ok) {
    return json(
      { error: extractApiErrorMessage(switchRes.data, 'Failed to switch country') },
      { status: safeStatus(switchRes.status) },
    );
  }

  // Re-issue the canonical bundle cookie (same rationale as branch switch).
  const meRes = await apiRequest('/auth/me', { method: 'POST', cookie });

  const headers = new Headers();
  const sourceCookies = meRes.ok && meRes.setCookies.length > 0 ? meRes.setCookies : switchRes.setCookies;
  for (const c of sourceCookies) {
    headers.append('Set-Cookie', c);
  }

  if (next) return redirect(next, { headers });
  const referer = request.headers.get('referer') ?? '/admin';
  return redirect(referer, { headers });
}

export function loader() {
  return redirect('/admin');
}
