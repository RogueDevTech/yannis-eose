import { DeferredSection } from '~/components/ui/deferred-section';
import { Collapsible } from '~/components/ui/collapsible';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Pagination } from '~/components/ui/pagination';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
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
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const [searchParams, setSearchParams] = useSearchParams();
  const pageParam = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  return (
    <div className="space-y-6 px-3 sm:px-0">
      <PageHeader
        title="Sales Leaderboard"
        mobileInlineActions
        description="Rank closer performance by delivery rate."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Leaderboard tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="CS leaderboard date range"
            desktop={
              <>
                <PageRefreshButton />
                <div className="flex min-h-[2rem] items-center rounded-md border border-app-border bg-app-hover py-1 pl-2.5 pr-2">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                  />
                </div>
              </>
            }
            sheet={() => (
              <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                <DateFilterBar
                  startDate={dateFilters.startDate}
                  endDate={dateFilters.endDate}
                  periodAllTime={dateFilters.periodAllTime}
                  triggerLayout="blockCenter"
                />
              </div>
            )}
          />
        }
      />

      <DeferredSection resolve={csLeaderboard} skeleton="list">
        {(lb: CSLeaderboardEntry[]) => {
          if (lb.length === 0) {
            return (
              <TableLoadingOverlay show={isFilterLoading}>
                <div className="card p-8 text-center">
                  <p className="text-sm text-app-fg-muted">No closer data for {periodLabel}.</p>
                </div>
              </TableLoadingOverlay>
            );
          }
          // 10/page client-side. Rank still reflects global position so #1 stays #1 regardless of page.
          const totalPages = Math.max(1, Math.ceil(lb.length / LEADERBOARD_PAGE_SIZE));
          const safePage = Math.min(page, totalPages);
          const startIdx = (safePage - 1) * LEADERBOARD_PAGE_SIZE;
          const pagedLb = lb.slice(startIdx, startIdx + LEADERBOARD_PAGE_SIZE);
          return (
            <TableLoadingOverlay show={isFilterLoading}>
            <div className="card p-0">
              <div className="space-y-3 px-3 py-3 md:space-y-4 md:px-4 md:py-4">
                {pagedLb.map((e, idx) => {
                  const rank = startIdx + idx + 1;
                  const isTopThree = rank <= 3;
                  const deliveryPillClass =
                    e.deliveryRate >= 70
                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                      : e.deliveryRate >= 50
                        ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
                        : 'bg-app-hover text-app-fg';
                  const trigger = (
                    <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-sm font-medium text-app-fg-muted">
                          #{rank}
                        </span>
                        {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-sm font-medium leading-snug text-app-fg whitespace-normal md:truncate ${
                              isTopThree ? 'font-semibold' : ''
                            }`}
                          >
                            {e.agentName}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 pl-10 md:block md:pl-0">
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-bold md:px-3 md:py-1.5 md:text-sm ${deliveryPillClass}`}
                        >
                          {e.deliveryRate.toFixed(1)}% del.
                        </span>
                      </div>
                    </div>
                  );
                  const details = (
                    <div className="grid w-full grid-cols-2 gap-x-3 gap-y-2 border-t border-app-border pt-2.5 text-sm sm:flex sm:flex-1 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
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
                  );
                  return (
                    <div
                      key={e.agentId}
                      className={`rounded-lg border border-app-border bg-app-elevated p-3 md:p-4 ${isTopThree ? 'bg-app-hover' : ''}`}
                    >
                      <div className="md:hidden">
                        <Collapsible
                          trigger={trigger}
                          triggerClassName="items-start sm:items-center hover:opacity-100"
                          contentClassName="pt-2.5"
                        >
                          {details}
                        </Collapsible>
                      </div>
                      <div className="hidden md:block">
                        {trigger}
                        {details}
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
