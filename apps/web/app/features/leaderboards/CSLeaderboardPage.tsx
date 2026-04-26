import { DeferredSection } from '~/components/ui/deferred-section';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { Pagination } from '~/components/ui/pagination';
import { Spinner } from '~/components/ui/spinner';
import { useNavigation, useSearchParams } from '@remix-run/react';
import type { CSLeaderboardEntry } from '~/features/cs/types';

const LEADERBOARD_PAGE_SIZE = 10;

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
  const [searchParams, setSearchParams] = useSearchParams();
  const pageParam = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  return (
    <div className="space-y-6 px-3 sm:px-0">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-app-fg">CS Leaderboard</h1>
          <p className="text-sm text-app-fg-muted mt-1">
            Closer performance ranked by delivery rate ({periodLabel}).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateFilterBar
            startDate={dateFilters.startDate}
            endDate={dateFilters.endDate}
            periodAllTime={dateFilters.periodAllTime}
          />
          {isFilterLoading && (
            <span className="flex items-center text-app-fg-muted" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
        </div>
      </div>

      <DeferredSection resolve={csLeaderboard} skeleton="list">
        {(lb: CSLeaderboardEntry[]) => {
          if (lb.length === 0) {
            return (
              <div className="card p-8 text-center">
                <p className="text-sm text-app-fg-muted">No closer data for {periodLabel}.</p>
              </div>
            );
          }
          // 10/page client-side. Rank still reflects global position so #1 stays #1 regardless of page.
          const totalPages = Math.max(1, Math.ceil(lb.length / LEADERBOARD_PAGE_SIZE));
          const safePage = Math.min(page, totalPages);
          const startIdx = (safePage - 1) * LEADERBOARD_PAGE_SIZE;
          const pagedLb = lb.slice(startIdx, startIdx + LEADERBOARD_PAGE_SIZE);
          return (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 sm:px-4 sm:py-3 border-b border-app-border">
                <h2 className="text-base font-semibold text-app-fg sm:text-lg">Closer performance</h2>
                <p className="text-xs text-app-fg-muted mt-0.5">
                  Ranked by delivery rate ({periodLabel}) · {lb.length} closer{lb.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="space-y-4 px-4 py-4">
                {pagedLb.map((e, idx) => {
                  const rank = startIdx + idx + 1;
                  const isTopThree = rank <= 3;
                  return (
                    <div
                      key={e.agentId}
                      className={`rounded-lg border border-app-border bg-app-elevated p-4 ${isTopThree ? 'bg-app-hover' : ''}`}
                    >
                      {/* Mobile: stacked layout. Desktop: single row */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                        {/* Rank + trophy + name — full width on mobile, then primary pill */}
                        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-sm font-medium text-app-fg-muted">
                            #{rank}
                          </span>
                          {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                          <p className={`min-w-0 flex-1 truncate text-sm font-medium text-app-fg sm:flex-none ${isTopThree ? 'font-semibold' : ''}`}>
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
                                  : 'bg-app-hover text-app-fg'
                            }`}
                          >
                            {e.deliveryRate.toFixed(1)}% del.
                          </span>
                        </div>
                        {/* Metrics: 2-col grid on mobile, inline on desktop */}
                        <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:flex sm:flex-1 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
                          <span className="text-app-fg-muted">
                            Engaged <strong className="text-app-fg">{e.ordersEngaged}</strong>
                          </span>
                          <span className="text-success-600 dark:text-success-400">
                            Confirmed <strong>{e.ordersConfirmed}</strong>
                          </span>
                          <span className="text-brand-600 dark:text-brand-400 font-medium">
                            Delivered <strong>{e.ordersDelivered}</strong>
                          </span>
                          <span className="text-app-fg-muted">
                            Calls <strong className="text-app-fg">{e.callsMade}</strong>
                          </span>
                          <span className="text-app-fg-muted">
                            Conf. <strong className="text-app-fg">{e.confirmationRate.toFixed(1)}%</strong>
                          </span>
                          <span className="text-app-fg-muted">
                            Avg call <strong className="text-app-fg">{formatAvgCall(e.avgCallDurationSeconds)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div className="border-t border-app-border px-4 py-3 flex items-center justify-between">
                  <p className="text-xs text-app-fg-muted">
                    Showing {startIdx + 1}–{Math.min(startIdx + LEADERBOARD_PAGE_SIZE, lb.length)} of {lb.length}
                  </p>
                  <Pagination
                    page={safePage}
                    totalPages={totalPages}
                    onPageChange={(nextPage) => {
                      const next = new URLSearchParams(searchParams);
                      next.set('page', String(nextPage));
                      setSearchParams(next, { replace: true });
                    }}
                  />
                </div>
              )}
            </div>
          );
        }}
      </DeferredSection>
    </div>
  );
}
