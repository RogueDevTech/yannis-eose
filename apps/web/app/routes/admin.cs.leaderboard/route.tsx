import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { defer, type LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, defaultThisMonthRange } from '~/lib/api.server';
import { CSLeaderboardPage } from '~/features/leaderboards/CSLeaderboardPage';
import { CSLeaderboardLoadingShell } from '~/features/cs/CSDeferredLoadingShells';
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
    const range = defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }
  const leaderboardPeriodResolved = (periodAllTime ? 'all_time' : 'this_month') as 'this_month' | 'all_time';
  const filters = { startDate: startDate ?? '', endDate: endDate ?? '', periodAllTime };

  const input: { period: 'this_month' | 'all_time'; startDate?: string; endDate?: string } = {
    period: leaderboardPeriodResolved,
  };
  if (startDate) input.startDate = startDate;
  if (endDate) input.endDate = endDate;

  const csLeaderboardShell = { filters, leaderboardPeriod: leaderboardPeriodResolved };

  const pageData = (async () => {
    const csLeaderboard = await apiRequest<unknown>(
      `/trpc/orders.csLeaderboard?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie },
    )
      .then(parseCSLeaderboard)
      .catch((): CSLeaderboardEntry[] => []);

    return {
      csLeaderboard,
      leaderboardPeriod: leaderboardPeriodResolved,
      filters,
    };
  })();

  return defer({ csLeaderboardShell, pageData });
}

export default function CSLeaderboardRoute() {
  const { csLeaderboardShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={
        <CSLeaderboardLoadingShell
          filters={csLeaderboardShell.filters}
          leaderboardPeriod={csLeaderboardShell.leaderboardPeriod}
        />
      }>
      {(data) => (
          <CSLeaderboardPage
            csLeaderboard={data.csLeaderboard}
            leaderboardPeriod={data.leaderboardPeriod}
            filters={data.filters}
          />
        )}
    </CachedAwait>
  );
}
