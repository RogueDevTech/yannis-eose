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

  // Multi-branch selection: comma-separated IDs from the checkbox switcher.
  // CEO directive 2026-06-10 — combine 2+ branches to see combined data.
  const selectedRaw = form.get('selectedBranchIds')?.toString() ?? '';
  const selectedBranchIds = selectedRaw ? selectedRaw.split(',').filter(Boolean) : null;

  // Call the NestJS controller endpoint (not the tRPC procedure) so the API
  // can re-issue the signed bundle cookie alongside the Redis session update.
  // Without that re-issuance, the bundle cookie keeps the old currentBranchId
  // for up to BUNDLE_TTL_SECONDS, and branch switches appear to do nothing
  // for ~60s (especially visible during mirror mode).
  const switchRes = await apiRequest('/auth/switch-branch', {
    method: 'POST',
    cookie,
    body: { branchId, selectedBranchIds },
  });

  if (!switchRes.ok) {
    return json({ error: extractApiErrorMessage(switchRes.data, 'Failed to switch branch') }, { status: safeStatus(switchRes.status) });
  }

  // Defense in depth: also call /auth/me so the canonical bundle re-issuer
  // runs against the just-updated Redis session. /auth/me is the path that
  // every loader's fast-path falls through to anyway, so its cookie is the
  // one we want the browser to start the next navigation with. Without this
  // second call, the layout's React state on the same /admin URL was picking
  // up the new currentBranchId but rendering an empty sidebar — forwarding
  // the /auth/me bundle keeps the sidebar's user identity in lock-step.
  const meRes = await apiRequest('/auth/me', { method: 'POST', cookie });

  // Prefer the /auth/me Set-Cookie when present (most-recent bundle), else
  // fall back to the switch-branch one. Either way the cookie name is
  // identical so the browser keeps only the latest.
  const headers = new Headers();
  const sourceCookies = meRes.ok && meRes.setCookies.length > 0 ? meRes.setCookies : switchRes.setCookies;
  for (const c of sourceCookies) {
    headers.append('Set-Cookie', c);
  }

  if (next) return redirect(next, { headers });
  const referer = request.headers.get('referer') ?? '/admin';
  return redirect(referer, { headers });
}

// No GET — this route only handles POST
export function loader() {
  return redirect('/admin');
}
