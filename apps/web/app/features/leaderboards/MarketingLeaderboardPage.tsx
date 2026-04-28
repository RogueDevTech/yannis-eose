import { DeferredSection } from '~/components/ui/deferred-section';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { PageHeader } from '~/components/ui/page-header';
import { Pagination } from '~/components/ui/pagination';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import type { LeaderboardEntry } from '~/features/marketing/types';

const HIGH_CPA_THRESHOLD = 5000;
const LEADERBOARD_PAGE_SIZE = 10;

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
  const isFilterLoading = useLoaderRefetchBusy();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageParam = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing Leaderboard"
        description={`Media buyer performance ranked by True ROAS (${periodLabel}).`}
        actions={
          <>
            <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0">
              <DateFilterBar
                startDate={dateFilters.startDate}
                endDate={dateFilters.endDate}
                periodAllTime={dateFilters.periodAllTime}
              />
            </div>
          </>
        }
      />

      <DeferredSection resolve={mediaBuyerLeaderboard} skeleton="list">
        {(lb: LeaderboardEntry[]) => {
          if (lb.length === 0) {
            return (
              <TableLoadingOverlay show={isFilterLoading}>
                <div className="card p-8 text-center">
                  <p className="text-sm text-app-fg-muted">No media buyer data for {periodLabel}.</p>
                </div>
              </TableLoadingOverlay>
            );
          }
          // 10/page client-side. Rank stays global so #1 is #1 across pages.
          const totalPages = Math.max(1, Math.ceil(lb.length / LEADERBOARD_PAGE_SIZE));
          const safePage = Math.min(page, totalPages);
          const startIdx = (safePage - 1) * LEADERBOARD_PAGE_SIZE;
          const pagedLb = lb.slice(startIdx, startIdx + LEADERBOARD_PAGE_SIZE);
          return (
            <TableLoadingOverlay show={isFilterLoading}>
            <div className="card p-0">
              <div className="px-4 py-3 sm:px-4 sm:py-3 border-b border-app-border">
                <h2 className="text-base font-semibold text-app-fg sm:text-lg">Media Buyer Performance</h2>
                <p className="text-xs text-app-fg-muted mt-0.5">
                  Ranked by True ROAS ({periodLabel}) · {lb.length} buyer{lb.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="space-y-4 px-4 py-4">
                {pagedLb.map((b, idx) => {
                  const rank = startIdx + idx + 1;
                  const isTopThree = rank <= 3;
                  const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
                  return (
                    <div
                      key={b.mediaBuyerId}
                      className={`rounded-lg border border-app-border bg-app-elevated p-4 ${
                        isTopThree ? 'bg-app-hover' : ''
                      } ${isHighCpa ? 'border-warning-200 bg-warning-50/50 dark:border-warning-800/50 dark:bg-warning-900/10' : ''}`}
                    >
                      {/* Mobile: stacked layout. Desktop: single row */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                        {/* Rank + trophy + name + email */}
                        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-sm font-medium text-app-fg-muted">
                            #{rank}
                          </span>
                          {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                          <div className="min-w-0 flex-1 sm:flex-none">
                            <p className={`truncate text-sm font-medium text-app-fg ${isTopThree ? 'font-semibold' : ''}`}>
                              {b.name}
                            </p>
                            <p className="truncate text-xs text-app-fg-muted">{b.email}</p>
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
                          <span className="text-app-fg-muted font-medium">
                            {'\u20A6'}{Math.round(b.totalSpend).toLocaleString()} spend
                          </span>
                          <span className="text-app-fg-muted">
                            Orders <strong className="text-app-fg">{b.totalOrders}</strong>
                          </span>
                          <span className="text-success-600 dark:text-success-400">
                            Delivered <strong>{b.deliveredOrders}</strong>
                          </span>
                          <span className="text-success-600 dark:text-success-400">
                            Confirmed <strong>{b.confirmedOrders}</strong>
                          </span>
                          <span className="text-app-fg-muted font-medium">
                            {'\u20A6'}{Math.round(b.deliveredRevenue).toLocaleString()} revenue
                          </span>
                          <span className={isHighCpa ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg-muted'}>
                            CPA <strong>{'\u20A6'}{Math.round(b.cpa).toLocaleString()}</strong>
                          </span>
                          <span className="text-app-fg-muted">
                            Del. rate <strong className="text-app-fg">{b.deliveryRate.toFixed(1)}%</strong>
                          </span>
                          <span className="text-app-fg-muted">
                            Conf. rate <strong className="text-app-fg">{b.confirmationRate.toFixed(1)}%</strong>
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
            </TableLoadingOverlay>
          );
        }}
      </DeferredSection>
    </div>
  );
}
