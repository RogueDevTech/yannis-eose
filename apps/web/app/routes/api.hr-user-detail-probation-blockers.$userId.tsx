import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';

/**
 * Live blockers snapshot for the Terminate Probation modal.
 *
 * Shape:
 *   { activeOrderCount, pendingCallbackCount, pendingPayoutCount, canTerminate }
 *
 * The actual authority gate is server-side in `users.getTerminationBlockers` —
 * this route just forwards the cookie and shapes the response for the modal.
 * Not cached: HR is making a destructive decision, they want fresh numbers.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) {
    return json({ activeOrderCount: 0, pendingCallbackCount: 0, pendingPayoutCount: 0, canTerminate: false });
  }

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { cookie } = gate;
  const res = await apiRequest<unknown>(
    `/trpc/users.getTerminationBlockers?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );

  if (!res.ok) {
    return json({ activeOrderCount: 0, pendingCallbackCount: 0, pendingPayoutCount: 0, canTerminate: false });
  }

  const data = res.data as {
    result?: {
      data?: {
        activeOrderCount?: number;
        pendingCallbackCount?: number;
        pendingPayoutCount?: number;
        canTerminate?: boolean;
      };
    };
  };
  const row = data?.result?.data ?? {};

  return json({
    activeOrderCount: row.activeOrderCount ?? 0,
    pendingCallbackCount: row.pendingCallbackCount ?? 0,
    pendingPayoutCount: row.pendingPayoutCount ?? 0,
    canTerminate: row.canTerminate ?? false,
  });
}
