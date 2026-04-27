import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

/**
 * Branch switch action — called by the sidebar BranchSwitcher component.
 * POSTs to branches.switchBranch tRPC procedure, which updates the Redis session.
 * After success, redirects back to the referring page so the new branch context takes effect.
 */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return redirect('/auth');

  const cookie = getSessionCookie(request);
  const form = await request.formData();
  // Empty string means "All Branches" (null context) — only SuperAdmin can do this
  const raw = form.get('branchId')?.toString() ?? '';
  const branchId = raw === '' ? null : raw;

  const res = await apiRequest('/trpc/branches.switchBranch', {
    method: 'POST',
    cookie,
    body: { branchId },
  });

  if (!res.ok) {
    return json({ error: extractApiErrorMessage(res.data, 'Failed to switch branch') }, { status: safeStatus(res.status) });
  }

  // Redirect back to referer or admin home so the new branch context loads
  const referer = request.headers.get('referer') ?? '/admin';
  return redirect(referer);
}

// No GET — this route only handles POST
export function loader() {
  return redirect('/admin');
}
