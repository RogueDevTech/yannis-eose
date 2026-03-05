import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { MarketingOverviewPage } from '~/features/marketing/MarketingOverviewPage';
import type {
  Metrics,
  LeaderboardEntry,
  FundingBalanceRow,
  MarketingOverviewRecentOrder,
} from '~/features/marketing/types';

const MARKETING_OVERVIEW_LIVE_EVENTS = ['order:new', 'order:status_changed'] as const;

export const meta: MetaFunction = () => [
  { title: 'Live Activities — Yannis EOSE' },
];

function parseMetrics(res: { ok: boolean; data: unknown }): Metrics {
  const data = res.ok
    ? (res.data as { result?: { data?: Metrics } })?.result?.data
    : null;
  return data ?? { totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, cpa: 0, trueRoas: 0, deliveryRate: 0 };
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

function defaultThisMonth(): { startDate: string; endDate: string } {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]!;
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]!;
  return { startDate, endDate };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'HEAD_OF_MARKETING'],
    permission: 'marketing.teamOverview',
  });
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const period = url.searchParams.get('period') ?? undefined;
  const periodAllTime = period === 'all_time';
  if (!periodAllTime && !startDate && !endDate) {
    const def = defaultThisMonth();
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

  const metricsP = apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(JSON.stringify(metricsInput))}`, { method: 'GET', cookie });
  const leaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(leaderboardInput))}`,
    { method: 'GET', cookie },
  );
  const balancesP = apiRequest<unknown>('/trpc/marketing.listFundingBalances', { method: 'GET', cookie });
  const recentOrdersP = apiRequest<unknown>(
    `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify({ limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }))}`,
    { method: 'GET', cookie },
  );

  const [metricsRes, leaderboardRes, balancesRes, recentOrdersRes] = await Promise.all([
    metricsP,
    leaderboardP,
    balancesP,
    recentOrdersP,
  ]);

  const metrics = parseMetrics(metricsRes);
  const leaderboard = parseLeaderboard(leaderboardRes);
  const balancesList = parseBalancesList(balancesRes);
  const recentOrders = parseRecentOrders(recentOrdersRes);

  return {
    metrics,
    leaderboard,
    balancesList,
    leaderboardPeriod,
    recentOrders,
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
  return <MarketingOverviewPage {...data} leaderboardPeriod={data.leaderboardPeriod as 'this_month' | 'all_time'} />;
}
