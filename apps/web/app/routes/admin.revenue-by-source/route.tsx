import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, defaultThisMonthRange } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';

/** Per-source revenue for the dashboard "with revenue" toggle. Lazy resource route:
 *  fetched only when the toggle is switched on, so the default dashboard load is
 *  unaffected. Mirrors the scope/permission of the CEO overview (SUPER_ADMIN / ADMIN). */
export type RevenueBySourceEntry = { gross: number; net: number };
export type RevenueBySourcePayload = {
  delivered: Record<string, RevenueBySourceEntry>;
  remitted: Record<string, RevenueBySourceEntry>;
  error?: string;
};

const EMPTY: RevenueBySourcePayload = { delivered: {}, remitted: {} };

export async function loader({ request }: LoaderFunctionArgs) {
  // Admin-class gate mirrors the CEO dashboard: SUPER_ADMIN / ADMIN / SUPPORT.
  // Use isAdminLevel (not raw role checks) so SUPPORT isn't locked out. The tRPC
  // procedure's permissionProcedure('ceo.overview') remains the real authority.
  const user = await getCurrentUser(request);
  if (!isAdminLevel(user)) {
    return json({ ...EMPTY, error: 'Forbidden' } satisfies RevenueBySourcePayload, { status: 403 });
  }

  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;

  if (!periodAllTime && !startDate && !endDate) {
    const range = defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const input = JSON.stringify({ ...(startDate && { startDate }), ...(endDate && { endDate }) });
  const res = await apiRequest<{ result?: { data?: RevenueBySourcePayload } }>(
    `/trpc/dashboard.revenueBySource?input=${encodeURIComponent(input)}`,
    { method: 'GET', cookie },
  );

  const data = res.ok ? res.data?.result?.data : null;
  return json(data ?? EMPTY);
}

export default function AdminRevenueBySourceRoute() {
  return null;
}
