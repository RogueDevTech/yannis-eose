import { DeferredSection } from '~/components/ui/deferred-section';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { Spinner } from '~/components/ui/spinner';
import { useNavigation } from '@remix-run/react';
import type { CSLeaderboardEntry } from '~/features/cs/types';

interface CSLeaderboardPageProps {
  csLeaderboard: CSLeaderboardEntry[];
  leaderboardPeriod: 'this_month' | 'all_time';
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
}

function formatAvgCall(seconds: number): string {
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function CSLeaderboardPage({
  csLeaderboard,
  leaderboardPeriod,
  filters = { startDate: '', endDate: '', periodAllTime: false },
}: CSLeaderboardPageProps) {
  const periodLabel = leaderboardPeriod === 'all_time' ? 'all time' : (filters.startDate && filters.endDate ? `${filters.startDate} – ${filters.endDate}` : 'this month');
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';

  return (
    <div className="space-y-6 px-3 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">CS Leaderboard</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-1">
            CS agent performance ranked by delivery rate ({periodLabel}).
          </p>
        </div>
        <DateFilterBar
          startDate={dateFilters.startDate}
          endDate={dateFilters.endDate}
          periodAllTime={dateFilters.periodAllTime}
        />
        {isFilterLoading && (
          <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
            <Spinner size="sm" className="shrink-0" />
          </span>
        )}
      </div>

      <DeferredSection resolve={csLeaderboard} skeleton="list">
        {(lb: CSLeaderboardEntry[]) => {
          if (lb.length === 0) {
            return (
              <div className="card p-8 text-center">
                <p className="text-sm text-surface-700 dark:text-surface-200">No CS agent data for {periodLabel}.</p>
              </div>
            );
          }
          return (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 sm:px-4 sm:py-3 border-b border-surface-100 dark:border-surface-800">
                <h2 className="text-base font-semibold text-surface-900 dark:text-white sm:text-lg">CS Agent Performance</h2>
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                  Ranked by delivery rate ({periodLabel})
                </p>
              </div>
              <div className="space-y-4 px-4 py-4">
                {lb.map((e, idx) => {
                  const rank = idx + 1;
                  const isTopThree = rank <= 3;
                  return (
                    <div
                      key={e.agentId}
                      className={`rounded-lg border border-surface-100 bg-white p-4 dark:border-surface-800 dark:bg-surface-900/50 ${isTopThree ? 'bg-surface-50/80 dark:bg-surface-800/40' : ''}`}
                    >
                      {/* Mobile: stacked layout. Desktop: single row */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                        {/* Rank + trophy + name — full width on mobile, then primary pill */}
                        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-200 dark:bg-surface-700 font-mono text-sm font-medium text-surface-700 dark:text-surface-300">
                            #{rank}
                          </span>
                          {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                          <p className={`min-w-0 flex-1 truncate text-sm font-medium text-surface-900 dark:text-white sm:flex-none ${isTopThree ? 'font-semibold' : ''}`}>
                            {e.agentName}
                          </p>
                        </div>
                        {/* Primary metric pill — right-aligned on mobile */}
                        <div className="flex shrink-0 justify-end sm:order-last">
                          <span
                            className={`inline-block rounded-full px-3 py-1.5 text-sm font-bold ${
                              e.deliveryRate >= 70
                                ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                                : e.deliveryRate >= 50
                                  ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
                                  : 'bg-surface-100 text-surface-800 dark:bg-surface-700 dark:text-surface-200'
                            }`}
                          >
                            {e.deliveryRate.toFixed(1)}% del.
                          </span>
                        </div>
                        {/* Metrics: 2-col grid on mobile, inline on desktop */}
                        <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:flex sm:flex-1 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
                          <span className="text-surface-600 dark:text-surface-400">
                            Engaged <strong className="text-surface-900 dark:text-white">{e.ordersEngaged}</strong>
                          </span>
                          <span className="text-success-600 dark:text-success-400">
                            Confirmed <strong>{e.ordersConfirmed}</strong>
                          </span>
                          <span className="text-brand-600 dark:text-brand-400 font-medium">
                            Delivered <strong>{e.ordersDelivered}</strong>
                          </span>
                          <span className="text-surface-600 dark:text-surface-400">
                            Calls <strong className="text-surface-900 dark:text-white">{e.callsMade}</strong>
                          </span>
                          <span className="text-surface-600 dark:text-surface-400">
                            Conf. <strong className="text-surface-900 dark:text-white">{e.confirmationRate.toFixed(1)}%</strong>
                          </span>
                          <span className="text-surface-600 dark:text-surface-400">
                            Avg call <strong className="text-surface-900 dark:text-white">{formatAvgCall(e.avgCallDurationSeconds)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }}
      </DeferredSection>
    </div>
  );
}
