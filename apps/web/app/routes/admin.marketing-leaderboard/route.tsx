import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { MarketingLeaderboardPage } from '~/features/leaderboards/MarketingLeaderboardPage';
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
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';

  const mediaLeaderboardP = apiRequest<unknown>(
    `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify({ period: leaderboardPeriod }))}`,
    { method: 'GET', cookie },
  ).then(parseMediaLeaderboard).catch((): LeaderboardEntry[] => []);

  return {
    mediaBuyerLeaderboard: mediaLeaderboardP,
    leaderboardPeriod,
  };
}

export default function MarketingLeaderboardRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <MarketingLeaderboardPage
      mediaBuyerLeaderboard={data.mediaBuyerLeaderboard}
      leaderboardPeriod={data.leaderboardPeriod}
    />
  );
}
