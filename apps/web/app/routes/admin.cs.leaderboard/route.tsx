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
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (!periodAllTime && !startDate && !endDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]!;
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]!;
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

  const csLeaderboard = await apiRequest<unknown>(
    `/trpc/orders.csLeaderboard?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  ).then(parseCSLeaderboard).catch((): CSLeaderboardEntry[] => []);

  return {
    csLeaderboard,
    leaderboardPeriod,
    filters,
  };
}

export default function CSLeaderboardRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <CSLeaderboardPage
      csLeaderboard={data.csLeaderboard}
      leaderboardPeriod={data.leaderboardPeriod as 'this_month' | 'all_time'}
      filters={data.filters}
    />
  );
}
