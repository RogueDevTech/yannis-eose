import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

const ALLOWED_NEXT_PREFIXES = ['/admin', '/hr', '/tpl', '/rider', '/auth'] as const;

/**
 * Same-origin path guard for the optional `next` field. Accepts only relative
 * paths under one of the allowed app prefixes — guards against open-redirect
 * (e.g. `next=https://attacker.example.com`) or smuggling protocol-relative
 * URLs (e.g. `next=//attacker.example.com`).
 */
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
 * Branch switch action — called by the sidebar BranchSwitcher component AND
 * the BranchScopeGuardProvider modal.
 *
 * POSTs to branches.switchBranch tRPC procedure (which updates the Redis
 * session). On success, redirects to:
 *   1. `next` form field — when present and same-origin, used by the
 *      pre-flight branch picker so a single click on "+ New Form" resolves
 *      to (pick branch -> land on the builder).
 *   2. The referer header — sidebar switcher path, returns user to the page
 *      they were already viewing.
 *   3. `/admin` — final fallback.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return redirect('/auth');

  const cookie = getSessionCookie(request);
  const form = await request.formData();
  // Empty string means "All Branches" (null context) — only SuperAdmin can do this
  const raw = form.get('branchId')?.toString() ?? '';
  const branchId = raw === '' ? null : raw;
  const next = safeNext(form.get('next')?.toString() ?? null);

  const res = await apiRequest('/trpc/branches.switchBranch', {
    method: 'POST',
    cookie,
    body: { branchId },
  });

  if (!res.ok) {
    return json({ error: extractApiErrorMessage(res.data, 'Failed to switch branch') }, { status: safeStatus(res.status) });
  }

  if (next) return redirect(next);
  const referer = request.headers.get('referer') ?? '/admin';
  return redirect(referer);
}

// No GET — this route only handles POST
export function loader() {
  return redirect('/admin');
}
