import { DeferredSection } from '~/components/ui/deferred-section';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { Spinner } from '~/components/ui/spinner';
import { useNavigation } from '@remix-run/react';
import type { LeaderboardEntry } from '~/features/marketing/types';

const HIGH_CPA_THRESHOLD = 5000;

interface MarketingLeaderboardPageProps {
  mediaBuyerLeaderboard: LeaderboardEntry[];
  leaderboardPeriod: 'this_month' | 'all_time';
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
}

export function MarketingLeaderboardPage({
  mediaBuyerLeaderboard,
  leaderboardPeriod,
  filters = { startDate: '', endDate: '', periodAllTime: false },
}: MarketingLeaderboardPageProps) {
  const periodLabel = leaderboardPeriod === 'all_time' ? 'all time' : (filters.startDate && filters.endDate ? `${filters.startDate} – ${filters.endDate}` : 'this month');
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';

  return (
    <div className="space-y-6 px-3 sm:px-0">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Marketing Leaderboard</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-1">
            Media buyer performance ranked by True ROAS ({periodLabel}).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
      </div>

      <DeferredSection resolve={mediaBuyerLeaderboard} skeleton="list">
        {(lb: LeaderboardEntry[]) => {
          if (lb.length === 0) {
            return (
              <div className="card p-8 text-center">
                <p className="text-sm text-surface-700 dark:text-surface-200">No media buyer data for {periodLabel}.</p>
              </div>
            );
          }
          return (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 sm:px-4 sm:py-3 border-b border-surface-100 dark:border-surface-800">
                <h2 className="text-base font-semibold text-surface-900 dark:text-white sm:text-lg">Media Buyer Performance</h2>
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                  Ranked by True ROAS ({periodLabel})
                </p>
              </div>
              <div className="space-y-4 px-4 py-4">
                {lb.map((b, idx) => {
                  const rank = idx + 1;
                  const isTopThree = rank <= 3;
                  const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
                  return (
                    <div
                      key={b.mediaBuyerId}
                      className={`rounded-lg border border-surface-100 bg-white p-4 dark:border-surface-800 dark:bg-surface-900/50 ${
                        isTopThree ? 'bg-surface-50/80 dark:bg-surface-800/40' : ''
                      } ${isHighCpa ? 'border-warning-200 bg-warning-50/50 dark:border-warning-800/50 dark:bg-warning-900/10' : ''}`}
                    >
                      {/* Mobile: stacked layout. Desktop: single row */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                        {/* Rank + trophy + name + email */}
                        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-200 dark:bg-surface-700 font-mono text-sm font-medium text-surface-700 dark:text-surface-300">
                            #{rank}
                          </span>
                          {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                          <div className="min-w-0 flex-1 sm:flex-none">
                            <p className={`truncate text-sm font-medium text-surface-900 dark:text-white ${isTopThree ? 'font-semibold' : ''}`}>
                              {b.name}
                            </p>
                            <p className="truncate text-xs text-surface-600 dark:text-surface-400">{b.email}</p>
                          </div>
                        </div>
                        {/* Primary metric pill — right-aligned on mobile */}
                        <div className="flex shrink-0 justify-end sm:order-last">
                          <span
                            className={`inline-block rounded-full px-3 py-1.5 text-sm font-bold ${
                              b.trueRoas >= 2
                                ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                                : b.trueRoas >= 1
                                  ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
                                  : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
                            }`}
                          >
                            {b.trueRoas.toFixed(2)}x ROAS
                          </span>
                        </div>
                        {/* Metrics: 2-col grid on mobile, inline on desktop */}
                        <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:flex sm:flex-1 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
                          <span className="text-surface-600 dark:text-surface-400 font-medium">
                            {'\u20A6'}{Math.round(b.totalSpend).toLocaleString()} spend
                          </span>
                          <span className="text-surface-600 dark:text-surface-400">
                            Orders <strong className="text-surface-900 dark:text-white">{b.totalOrders}</strong>
                          </span>
                          <span className="text-success-600 dark:text-success-400">
                            Delivered <strong>{b.deliveredOrders}</strong>
                          </span>
                          <span className="text-surface-600 dark:text-surface-400 font-medium">
                            {'\u20A6'}{Math.round(b.deliveredRevenue).toLocaleString()} revenue
                          </span>
                          <span className={isHighCpa ? 'text-danger-600 dark:text-danger-400' : 'text-surface-600 dark:text-surface-400'}>
                            CPA <strong>{'\u20A6'}{Math.round(b.cpa).toLocaleString()}</strong>
                          </span>
                          <span className="text-surface-600 dark:text-surface-400">
                            Del. rate <strong className="text-surface-900 dark:text-white">{b.deliveryRate.toFixed(1)}%</strong>
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
