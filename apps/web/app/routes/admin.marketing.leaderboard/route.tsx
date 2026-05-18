import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { defer, type LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange } from '~/lib/api.server';
import { MarketingLeaderboardPage } from '~/features/leaderboards/MarketingLeaderboardPage';
import { MarketingLeaderboardLoadingShell } from '~/features/marketing/MarketingDeferredLoadingShells';
import type { LeaderboardEntry } from '~/features/marketing/types';

export const meta: MetaFunction = () => [
  { title: 'Marketing Leaderboard — Yannis EOSE' },
];

function parseMediaLeaderboard(res: { ok: boolean; data: unknown }): LeaderboardEntry[] {
  const data = res.ok
    ? (res.data as { result?: { data?: LeaderboardEntry[] } })?.result?.data
    : null;
  return data ?? [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'marketing.leaderboard');
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
  const leaderboardPeriod = periodAllTime ? 'all_time' : 'this_month';
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime };

  const input: { period: 'this_month' | 'all_time'; startDate?: string; endDate?: string } = {
    period: leaderboardPeriod,
  };
  if (startDate) input.startDate = startDate;
  if (endDate) input.endDate = endDate;

  const leaderboardPeriodResolved = leaderboardPeriod as 'this_month' | 'all_time';
  const leaderboardShell = { filters, leaderboardPeriod: leaderboardPeriodResolved };

  const pageData = (async () => {
  const [leaderboardRes, profitabilityRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>('/trpc/marketing.profitabilityConfig', { method: 'GET', cookie }),
  ]);
  const mediaBuyerLeaderboard = parseMediaLeaderboard(leaderboardRes);
  const profitabilityConfig = profitabilityRes.ok
    ? (profitabilityRes.data as { result?: { data?: { targetRoas: number; greenThreshold: number } } })
        ?.result?.data ?? { targetRoas: 3, greenThreshold: 2.5 }
    : { targetRoas: 3, greenThreshold: 2.5 };

  return {
    mediaBuyerLeaderboard,
    leaderboardPeriod: leaderboardPeriodResolved,
    filters,
    profitabilityConfig,
  };
  })();

  return defer({ leaderboardShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function MarketingLeaderboardRoute() {
  const { leaderboardShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={
        <MarketingLeaderboardLoadingShell
          filters={leaderboardShell.filters}
          leaderboardPeriod={leaderboardShell.leaderboardPeriod}
        />
      }
        loaderShell={{ leaderboardShell }}
        deferredKey="pageData"
      >
      {(data) => (
          <MarketingLeaderboardPage
            mediaBuyerLeaderboard={data.mediaBuyerLeaderboard}
            leaderboardPeriod={data.leaderboardPeriod}
            filters={data.filters}
            profitabilityConfig={data.profitabilityConfig}
          />
        )}
    </CachedAwait>
  );
}
