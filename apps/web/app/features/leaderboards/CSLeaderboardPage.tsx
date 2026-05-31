import { DeferredSection } from '~/components/ui/deferred-section';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Pagination } from '~/components/ui/pagination';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
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
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const [searchParams, setSearchParams] = useSearchParams();
  const pageParam = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const [pageSize, setPageSize] = useState(50);
  const [peekEntry, setPeekEntry] = useState<(CSLeaderboardEntry & { rank: number }) | null>(null);

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Leaderboard"
        mobileInlineActions
        description="Rank closer performance by delivery rate."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="CS leaderboard date range"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime} chrome="pill" />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={dateFilters.startDate}
        endDate={dateFilters.endDate}
        periodAllTime={dateFilters.periodAllTime}
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
          // Client-side paged. Rank still reflects global position so #1 stays #1 regardless of page.
          const totalPages = Math.max(1, Math.ceil(lb.length / pageSize));
          const safePage = Math.min(page, totalPages);
          const startIdx = (safePage - 1) * pageSize;
          const pagedLb = lb.slice(startIdx, startIdx + pageSize);
          return (
            <TableLoadingOverlay show={isFilterLoading}>
            <div className="-mx-4 bg-app-elevated border-y border-app-border overflow-hidden sm:mx-0 sm:rounded-xl sm:border sm:shadow-card">
              <div className="space-y-1.5 px-2 py-2 md:space-y-3 md:px-4 md:py-4">
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
                      className={`rounded-lg border border-app-border bg-app-elevated md:p-4 ${isTopThree ? 'bg-app-hover' : ''}`}
                    >
                      {/* Mobile: slim tappable card → peek modal */}
                      <button
                        type="button"
                        onClick={() => setPeekEntry({ ...e, rank })}
                        className="md:hidden w-full p-3 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-xs font-medium text-app-fg-muted">
                            #{rank}
                          </span>
                          {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app-fg">{e.agentName}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${deliveryPillClass}`}>
                            {e.deliveryRate.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-app-fg-muted tabular-nums mt-1 pl-[calc(1.75rem+0.5rem)]">
                          <span>{e.ordersDelivered} delivered</span>
                          <span>CR {e.confirmationRate.toFixed(0)}%</span>
                          <span>{e.callsMade} calls</span>
                        </div>
                      </button>
                      {/* Desktop: full inline layout */}
                      <div className="hidden md:block">
                        {trigger}
                        {details}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-app-border px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-sm text-app-fg-muted">
                  Showing {startIdx + 1}–{Math.min(startIdx + pageSize, lb.length)} of {lb.length}
                </p>
                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  onPageChange={goToPage}
                  pageSize={pageSize}
                  onPageSizeChange={(n) => {
                    setPageSize(n);
                    goToPage(1);
                  }}
                />
              </div>
            </div>
            </TableLoadingOverlay>
          );
        }}
      </DeferredSection>

      {/* Mobile peek modal */}
      <Modal
        open={!!peekEntry}
        onClose={() => setPeekEntry(null)}
        maxWidth="max-w-sm"
        contentClassName="p-5"
      >
        {peekEntry && (() => {
          const e = peekEntry;
          const deliveryPillClass =
            e.deliveryRate >= 70
              ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
              : e.deliveryRate >= 50
                ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
                : 'bg-app-hover text-app-fg';
          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-sm font-bold text-app-fg-muted">
                  #{e.rank}
                </span>
                {e.rank <= 3 && <LeaderboardTrophy rank={e.rank as 1 | 2 | 3} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-app-fg truncate">{e.agentName}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${deliveryPillClass}`}>
                  {e.deliveryRate.toFixed(1)}% del.
                </span>
              </div>

              {/* Stats */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Engaged</span>
                  <span className="font-medium text-app-fg">{e.ordersEngaged}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Confirmed</span>
                  <span className="font-medium text-success-600 dark:text-success-400">{e.ordersConfirmed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Delivered</span>
                  <span className="font-medium text-brand-600 dark:text-brand-400">{e.ordersDelivered}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Confirmation rate</span>
                  <span className="font-medium text-app-fg">{e.confirmationRate.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Delivery rate</span>
                  <span className="font-medium text-app-fg">{e.deliveryRate.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Calls made</span>
                  <span className="font-medium text-app-fg">{e.callsMade}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Avg call duration</span>
                  <span className="font-medium text-app-fg">{formatAvgCall(e.avgCallDurationSeconds)}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
