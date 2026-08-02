import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, defaultThisMonthRange } from '~/lib/api.server';

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
  const user = await getCurrentUser(request);
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
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
