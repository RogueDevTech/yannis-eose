import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { MarketingOverviewPage } from '~/features/marketing/MarketingOverviewPage';
import type {
  Metrics,
  LeaderboardEntry,
} from '~/features/marketing/types';

export const meta: MetaFunction = () => [
  { title: 'Team Overview — Yannis EOSE' },
];

function parseMetrics(res: { ok: boolean; data: unknown }): Metrics {
  const data = res.ok
    ? (res.data as { result?: { data?: Metrics } })?.result?.data
    : null;
  return data ?? { totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, cpa: 0, trueRoas: 0, deliveryRate: 0 };
}

function parseFundingSummary(res: { ok: boolean; data: unknown }) {
  const data = res.ok
    ? (res.data as { result?: { data?: { totalSent: string; totalCompleted: string; totalDisputed: string } } })?.result?.data
    : null;
  return data ?? { totalSent: '0', totalCompleted: '0', totalDisputed: '0' };
}

function parseLeaderboard(res: { ok: boolean; data: unknown }): LeaderboardEntry[] {
  const data = res.ok
    ? (res.data as { result?: { data?: LeaderboardEntry[] } })?.result?.data
    : null;
  return data ?? [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'marketing.teamOverview');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';

  const metricsP = apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(JSON.stringify({}))}`, { method: 'GET', cookie });
  const summaryP = apiRequest<unknown>('/trpc/marketing.fundingSummary', { method: 'GET', cookie });
  const leaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify({ period: leaderboardPeriod }))}`,
    { method: 'GET', cookie },
  );

  const [metricsRes, summaryRes, leaderboardRes] = await Promise.all([
    metricsP,
    summaryP,
    leaderboardP,
  ]);

  const metrics = parseMetrics(metricsRes);
  const fundingSummary = parseFundingSummary(summaryRes);
  const leaderboard = parseLeaderboard(leaderboardRes);

  return {
    metrics,
    fundingSummary,
    leaderboard,
    leaderboardPeriod,
  };
}

export default function MarketingOverviewRoute() {
  const data = useLoaderData<typeof loader>();
  return <MarketingOverviewPage {...data} />;
}
