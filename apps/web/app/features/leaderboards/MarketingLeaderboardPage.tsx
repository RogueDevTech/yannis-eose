import { DeferredSection } from '~/components/ui/deferred-section';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Pagination } from '~/components/ui/pagination';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import type { LeaderboardEntry } from '~/features/marketing/types';

const HIGH_CPA_THRESHOLD = 5000;

function roasPillClass(trueRoas: number, greenThreshold: number): string {
  return trueRoas >= greenThreshold
    ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
    : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400';
}

interface MarketingLeaderboardPageProps {
  mediaBuyerLeaderboard: LeaderboardEntry[];
  leaderboardPeriod: 'this_month' | 'all_time';
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  /** Org-wide profitability thresholds — colors the ROAS pill (green ≥ threshold, red below). */
  profitabilityConfig?: { targetRoas: number; greenThreshold: number };
}

export function MarketingLeaderboardPage({
  mediaBuyerLeaderboard,
  leaderboardPeriod,
  filters = { startDate: '', endDate: '', periodAllTime: false },
  profitabilityConfig = { targetRoas: 3, greenThreshold: 2.5 },
}: MarketingLeaderboardPageProps) {
  const greenThreshold = profitabilityConfig.greenThreshold;
  const periodLabel = leaderboardPeriod === 'all_time' ? 'all time' : (filters.startDate && filters.endDate ? `${filters.startDate} – ${filters.endDate}` : 'this month');
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const [searchParams, setSearchParams] = useSearchParams();
  const pageParam = Number(searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const [pageSize, setPageSize] = useState(10);
  const [peekEntry, setPeekEntry] = useState<(LeaderboardEntry & { rank: number }) | null>(null);

  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing Leaderboard"
        mobileInlineActions
        description="Compare media buyer performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Leaderboard tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Marketing leaderboard date range"
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
          // Client-side paged. Rank stays global so #1 is #1 across pages.
          const totalPages = Math.max(1, Math.ceil(lb.length / pageSize));
          const safePage = Math.min(page, totalPages);
          const startIdx = (safePage - 1) * pageSize;
          const pagedLb = lb.slice(startIdx, startIdx + pageSize);
          return (
            <TableLoadingOverlay show={isFilterLoading}>
            <div className="-mx-4 bg-app-elevated border-y border-app-border overflow-hidden sm:mx-0 sm:rounded-xl sm:border sm:shadow-card">
              <div className="space-y-1.5 px-2 py-2 md:space-y-3 md:px-4 md:py-4">
                {pagedLb.map((b, idx) => {
                  const rank = startIdx + idx + 1;
                  const isTopThree = rank <= 3;
                  const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
                  const roasClass = roasPillClass(b.trueRoas, greenThreshold);
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
                            {b.name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 pl-10 md:block md:pl-0">
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-bold md:px-3 md:py-1.5 md:text-sm ${roasClass}`}
                          title={`Green at ≥ ${greenThreshold}x ROAS · target ${profitabilityConfig.targetRoas}x`}
                        >
                          {b.trueRoas.toFixed(2)}x ROAS
                        </span>
                      </div>
                    </div>
                  );
                  const details = (
                    <div className="grid w-full grid-cols-2 gap-x-3 gap-y-2 border-t border-app-border pt-2.5 text-sm sm:flex sm:flex-1 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
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
                  );
                  return (
                    <div
                      key={b.mediaBuyerId}
                      className={`rounded-lg border border-app-border bg-app-elevated md:p-4 ${
                        isTopThree ? 'bg-app-hover' : ''
                      } ${isHighCpa ? 'border-warning-200 bg-warning-50/50 dark:border-warning-800/50 dark:bg-warning-900/10' : ''}`}
                    >
                      {/* Mobile: slim tappable card → peek modal */}
                      <button
                        type="button"
                        onClick={() => setPeekEntry({ ...b, rank })}
                        className="md:hidden w-full p-3 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-xs font-medium text-app-fg-muted">
                            #{rank}
                          </span>
                          {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app-fg">{b.name}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${roasClass}`}>
                            {b.trueRoas.toFixed(2)}x
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-app-fg-muted tabular-nums mt-1 pl-[calc(1.75rem+0.5rem)]">
                          <span>{b.totalOrders} orders</span>
                          <span>{b.deliveredOrders} delivered</span>
                          <span>CR {b.confirmationRate.toFixed(0)}%</span>
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
              <div className="border-t border-app-border px-4 py-3 flex items-center justify-between">
                <p className="text-xs text-app-fg-muted">
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
          const b = peekEntry;
          const roasClass = roasPillClass(b.trueRoas, greenThreshold);
          const isHighCpa = b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0;
          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-sm font-bold text-app-fg-muted">
                  #{b.rank}
                </span>
                {b.rank <= 3 && <LeaderboardTrophy rank={b.rank as 1 | 2 | 3} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-app-fg truncate">{b.name}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${roasClass}`}>
                  {b.trueRoas.toFixed(2)}x ROAS
                </span>
              </div>

              {/* Stats */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Ad spend</span>
                  <span className="font-medium text-app-fg">{'\u20A6'}{Math.round(b.totalSpend).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Revenue</span>
                  <span className="font-medium text-app-fg">{'\u20A6'}{Math.round(b.deliveredRevenue).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Orders</span>
                  <span className="font-medium text-app-fg">{b.totalOrders}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Confirmed</span>
                  <span className="font-medium text-success-600 dark:text-success-400">{b.confirmedOrders}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Delivered</span>
                  <span className="font-medium text-success-600 dark:text-success-400">{b.deliveredOrders}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">CPA</span>
                  <span className={`font-medium ${isHighCpa ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}>
                    {'\u20A6'}{Math.round(b.cpa).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Confirmation rate</span>
                  <span className="font-medium text-app-fg">{b.confirmationRate.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Delivery rate</span>
                  <span className="font-medium text-app-fg">{b.deliveryRate.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
