import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { CSLeaderboardPage } from '~/features/leaderboards/CSLeaderboardPage';
import type { CSLeaderboardEntry } from '~/features/cs/types';

export const meta: MetaFunction = () => [
  { title: 'CS Leaderboard — Yannis EOSE' },
];

function parseCSLeaderboard(res: { ok: boolean; data: unknown }): CSLeaderboardEntry[] {
  const data = res.ok
    ? (res.data as { result?: { data?: CSLeaderboardEntry[] } })?.result?.data
    : null;
  return data ?? [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'cs.leaderboard');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const leaderboardPeriod = url.searchParams.get('period') === 'all_time' ? 'all_time' : 'this_month';

  const csLeaderboardP = apiRequest<unknown>(
    `/trpc/orders.csLeaderboard?input=${encodeURIComponent(JSON.stringify({ period: leaderboardPeriod }))}`,
    { method: 'GET', cookie },
  ).then(parseCSLeaderboard).catch((): CSLeaderboardEntry[] => []);

  return {
    csLeaderboard: csLeaderboardP,
    leaderboardPeriod,
  };
}

export default function CSLeaderboardRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <CSLeaderboardPage
      csLeaderboard={data.csLeaderboard}
      leaderboardPeriod={data.leaderboardPeriod}
    />
  );
}
