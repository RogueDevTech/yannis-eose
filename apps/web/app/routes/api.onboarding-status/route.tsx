import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getCurrentUser, getSessionCookie } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';

/**
 * Resource route — returns the caller's onboarding status as JSON.
 *
 * Used by the login-time `<OnboardingNudge>` modal in the dashboard layout.
 * The nudge can't hit `/trpc/onboarding.get` directly from the browser
 * because the web app and API live on different origins; tRPC URLs only
 * resolve when called server-side via `apiRequest`. This route proxies
 * the call so the client gets a same-origin URL that works in dev + prod.
 *
 * Returns `{ status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED' }`,
 * or `{ status: null }` when the caller is unauthenticated / the API is
 * unreachable. The nudge treats null as "don't show the modal".
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ status: null }, { status: 200 });

  // Admin-class users don't have a personal HR onboarding record to fill in —
  // this flow is for rank-and-file staff. Always return null so the nudge
  // never fires for SuperAdmin / Admin, even if a future caller forgets to
  // gate on the client side.
  if (isAdminLevel(user)) return json({ status: null }, { status: 200 });

  const cookie = getSessionCookie(request);
  if (!cookie) return json({ status: null }, { status: 200 });

  const res = await apiRequest<unknown>('/trpc/onboarding.get', {
    method: 'GET',
    cookie,
  });
  if (!res.ok) return json({ status: null }, { status: 200 });

  const status =
    (res.data as { result?: { data?: { status?: string } } })?.result?.data?.status ?? null;
  return json({ status }, { status: 200 });
}
