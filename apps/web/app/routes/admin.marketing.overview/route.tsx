import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultTodayRange } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { canViewAllBranches } from '~/lib/rbac';
import { usePageRefreshOnEvent, usePollingFallback } from '~/hooks/useSocket';
import { MarketingOverviewPage } from '~/features/marketing/MarketingOverviewPage';
import type {
  Metrics,
  LeaderboardEntry,
  FundingBalanceRow,
  MarketingOverviewRecentOrder,
} from '~/features/marketing/types';
import type { LiveActivityItem } from '~/features/cs/types';

// order:status_changed is handled in-place by MarketingOverviewPage (hybrid — no DB round-trip).
// Only order:new triggers revalidation since it adds a row the client doesn't have yet.
const MARKETING_OVERVIEW_LIVE_EVENTS = ['order:new'] as const;

export const meta: MetaFunction = () => [
  { title: 'Live Activities — Yannis EOSE' },
];

function parseMetrics(res: { ok: boolean; data: unknown }): Metrics {
  const data = res.ok
    ? (res.data as { result?: { data?: Metrics } })?.result?.data
    : null;
  return data ?? { totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0, confirmationRate: 0, cpa: 0, trueRoas: 0, deliveryRate: 0 };
}

function parseLeaderboard(res: { ok: boolean; data: unknown }): LeaderboardEntry[] {
  const data = res.ok
    ? (res.data as { result?: { data?: LeaderboardEntry[] } })?.result?.data
    : null;
  return data ?? [];
}

function parseBalancesList(res: { ok: boolean; data: unknown }): FundingBalanceRow[] {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return [];
  const result = raw.result as { data?: FundingBalanceRow[]; json?: FundingBalanceRow[] } | undefined;
  const data = result?.data ?? result?.json;
  return Array.isArray(data) ? data : [];
}

function parseRecentOrders(res: { ok: boolean; data: unknown }): MarketingOverviewRecentOrder[] {
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: { orders?: Array<{ id: string; status: string; createdAt: string; totalAmount: string | null; customerName: string; mediaBuyerName?: string | null }> } } })?.result?.data;
  const orders = data?.orders ?? [];
  return orders.map((o) => ({
    id: o.id,
    status: o.status,
    createdAt: o.createdAt,
    totalAmount: o.totalAmount ?? null,
    customerName: o.customerName,
    mediaBuyerName: o.mediaBuyerName ?? null,
  }));
}

const defaultToday = defaultTodayRange;

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
    permission: 'marketing.teamOverview',
  });
  const cookie = getSessionCookie(request);
  // Re-narrow viewer for currentBranchId / scope helpers (the helper return type is intentionally
  // minimal — getCurrentUser actually returns the wider session shape).
  const viewerSession = viewer as typeof viewer & {
    currentBranchId?: string | null;
    scopeOrgWideHead?: boolean;
  };

  const url = new URL(request.url);
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const period = url.searchParams.get('period') ?? undefined;
  const periodAllTime = period === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultToday();
    startDate = def.startDate;
    endDate = def.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const leaderboardPeriod = periodAllTime ? 'all_time' : 'this_month';

  const metricsInput = { ...(startDate && { startDate }), ...(endDate && { endDate }) };
  const leaderboardInput: { period: 'this_month' | 'all_time'; startDate?: string; endDate?: string } = {
    period: leaderboardPeriod,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };

  const recentOrdersListInput: { limit: number; sortBy: string; sortOrder: string; startDate?: string; endDate?: string } = {
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  };

  // Live activity scope — same logic as `routes/admin.marketing.overview.activity`. Media Buyers
  // see their own funnel; admin-class / org-wide HoM (with marketing.scope.global) see org-wide;
  // everyone else is scoped to their active branch.
  const liveActivityScope: { limit: number; mediaBuyerId?: string; branchId?: string } = (() => {
    const limit = 60;
    if (viewer.role === 'MEDIA_BUYER') return { limit, mediaBuyerId: viewer.id };
    if (canViewAllBranches(viewerSession)) return { limit };
    if (viewer.role === 'HEAD_OF_MARKETING' || viewer.role === 'SUPER_ADMIN' || viewer.role === 'ADMIN') return { limit };
    if (viewerSession.currentBranchId) return { limit, branchId: viewerSession.currentBranchId };
    return { limit };
  })();

  // Permission gate: cart.listActivity accepts `cart.read` OR `marketing.read`. The page-level
  // permission `marketing.teamOverview` doesn't grant either — but in practice every viewer who
  // gets past the page guard above ALSO has `marketing.read` (HoM / Marketing template) or is
  // admin-class (bypass). Leave the canonical check here for safety; if it ever fails we degrade
  // to an empty feed rather than block the page.
  const viewerPerms = (viewer.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canQueryLiveActivity =
    viewer.role === 'SUPER_ADMIN' ||
    viewer.role === 'ADMIN' ||
    viewerPerms.includes(canonicalPermissionCode('cart.read')) ||
    viewerPerms.includes(canonicalPermissionCode('marketing.read'));

  const metricsP = apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(JSON.stringify(metricsInput))}`, { method: 'GET', cookie });
  const leaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
    { method: 'GET', cookie },
  );
  const balancesP = apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie });
  const recentOrdersP = apiRequest<unknown>(
    `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(recentOrdersListInput))}`,
    { method: 'GET', cookie },
  );
  const liveActivityP = canQueryLiveActivity
    ? apiRequest<unknown>(
        `/trpc/cart.listActivity?input=${encodeURIComponent(JSON.stringify(liveActivityScope))}`,
        { method: 'GET', cookie },
      )
    : Promise.resolve({ ok: false, status: 0, data: null } as { ok: false; status: number; data: null });
  const [metricsRes, leaderboardRes, balancesRes, recentOrdersRes, liveActivityRes] = await Promise.all([
    metricsP,
    leaderboardP,
    balancesP,
    recentOrdersP,
    liveActivityP,
  ]);

  const metrics = parseMetrics(metricsRes);
  const leaderboard = parseLeaderboard(leaderboardRes);
  const balancesList = parseBalancesList(balancesRes);
  const recentOrders = parseRecentOrders(recentOrdersRes);
  const liveActivity: LiveActivityItem[] = liveActivityRes.ok
    ? (liveActivityRes.data as { result?: { data?: LiveActivityItem[] } })?.result?.data ?? []
    : [];

  return {
    metrics,
    leaderboard,
    balancesList,
    leaderboardPeriod,
    recentOrders,
    liveActivity,
    liveEvents: [...MARKETING_OVERVIEW_LIVE_EVENTS],
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
  };
}

export default function MarketingOverviewRoute() {
  const data = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...MARKETING_OVERVIEW_LIVE_EVENTS]);
  usePollingFallback(30_000); // fallback: poll every 30s when socket is disconnected
  return <MarketingOverviewPage {...data} leaderboardPeriod={data.leaderboardPeriod as 'this_month' | 'all_time'} />;
}
