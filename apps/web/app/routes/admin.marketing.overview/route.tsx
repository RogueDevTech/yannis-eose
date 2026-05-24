import { useLoaderData } from '@remix-run/react';
import { defer, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, defaultTodayRange } from '~/lib/api.server';
import { usePageRefreshOnEvent, usePollingFallback } from '~/hooks/useSocket';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { MarketingOverviewPage } from '~/features/marketing/MarketingOverviewPage';
import { MarketingOverviewLoadingShell } from '~/features/marketing/MarketingOverviewLoadingShell';
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

const defaultToday = defaultTodayRange;

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
    permission: 'marketing.teamOverview',
    orMarketingTeamSupervisorOnBranch: true,
  });
  const cookie = getSessionCookie(request);

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

  // Single bundled call — replaces 5 parallel tRPC HTTP round-trips
  // (marketing.metrics + marketing.leaderboard + marketing.listFundingBalances
  // + orders.list (recent) + cart.listActivity). Same fan-out runs server-side.
  const bundleInput = encodeURIComponent(
    JSON.stringify({
      period: leaderboardPeriod,
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      recentOrdersLimit: 20,
      liveActivityLimit: 60,
    }),
  );
  const overviewData = apiRequest<unknown>(
    `/trpc/marketing.overviewPageBundle?input=${bundleInput}`,
    { method: 'GET', cookie },
  ).then((bundleRes) => {
    type BundleData = {
      metrics: Metrics;
      leaderboard: LeaderboardEntry[];
      balancesList: FundingBalanceRow[];
      recentOrders: {
        orders?: Array<{
          id: string;
          status: string;
          createdAt: string;
          totalAmount: string | null;
          customerName: string;
          mediaBuyerName?: string | null;
        }>;
      };
      liveActivity: LiveActivityItem[];
      abandonedCartCount: number;
    };
    const bundle = bundleRes.ok
      ? ((bundleRes.data as { result?: { data?: BundleData } })?.result?.data ?? null)
      : null;

    const metrics: Metrics = bundle?.metrics ?? {
      totalSpend: 0,
      totalOrders: 0,
      deliveredOrders: 0,
      deliveredRevenue: 0,
      confirmedOrders: 0,
      confirmationRate: 0,
      cpa: 0,
      trueRoas: 0,
      deliveryRate: 0,
    };
    const leaderboard: LeaderboardEntry[] = bundle?.leaderboard ?? [];
    const balancesList: FundingBalanceRow[] = bundle?.balancesList ?? [];
    const recentOrders: MarketingOverviewRecentOrder[] = (bundle?.recentOrders?.orders ?? []).map(
      (o) => ({
        id: o.id,
        status: o.status,
        createdAt: o.createdAt,
        totalAmount: o.totalAmount ?? null,
        customerName: o.customerName,
        mediaBuyerName: o.mediaBuyerName ?? null,
      }),
    );
    const liveActivity: LiveActivityItem[] = bundle?.liveActivity ?? [];
    const abandonedCartCount: number = bundle?.abandonedCartCount ?? 0;

    return {
      metrics,
      leaderboard,
      balancesList,
      recentOrders,
      liveActivity,
      abandonedCartCount,
    };
  });

  const overviewShell = {
    leaderboardPeriod,
    liveEvents: [...MARKETING_OVERVIEW_LIVE_EVENTS],
    filters: {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      periodAllTime,
    },
  };

  return defer({
    overviewShell,
    overviewData,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function MarketingOverviewRoute() {
  const { overviewShell, overviewData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent([...MARKETING_OVERVIEW_LIVE_EVENTS]);
  usePollingFallback(30_000); // fallback: poll every 30s when socket is disconnected
  const leaderboardPeriod = overviewShell.leaderboardPeriod as 'this_month' | 'all_time';
  return (
    <CachedAwait
      resolve={overviewData}
      fallback={
        <MarketingOverviewLoadingShell
          leaderboardPeriod={leaderboardPeriod}
          filters={overviewShell.filters}
          liveEvents={overviewShell.liveEvents}
        />
      }
      loaderShell={{ overviewShell }}
      deferredKey="overviewData"
    >
      {(payload) => (
        <MarketingOverviewPage
          {...payload}
          leaderboardPeriod={leaderboardPeriod}
          filters={overviewShell.filters}
          liveEvents={overviewShell.liveEvents}
        />
      )}
    </CachedAwait>
  );
}
