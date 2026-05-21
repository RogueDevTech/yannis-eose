import { useRef } from 'react';
import { Link } from '@remix-run/react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { useLiveIndicator } from '~/hooks/useSocket';

export interface MarketingOverviewLoadingShellProps {
  leaderboardPeriod: 'this_month' | 'all_time';
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  liveEvents?: string[];
}

function SkeletonLiveActivityCard() {
  return (
    <div
      className="shrink-0 w-64 rounded-xl border border-app-border bg-app-elevated p-4 space-y-3 animate-pulse"
      aria-hidden
    >
      <div className="flex justify-between gap-2">
        <div className="h-4 w-16 rounded bg-app-hover" />
        <div className="h-4 w-14 rounded-full bg-app-hover" />
      </div>
      <div className="h-3 w-full rounded bg-app-hover" />
      <div className="h-3 w-[75%] max-w-[12rem] rounded bg-app-hover" />
      <div className="h-8 w-full rounded-lg bg-app-hover" />
    </div>
  );
}

function SkeletonOrderCard() {
  return (
    <div
      className="shrink-0 w-64 rounded-xl border border-app-border bg-app-elevated p-3.5 pr-8 space-y-2 animate-pulse"
      aria-hidden
    >
      <div className="h-5 w-20 rounded-full bg-app-hover" />
      <div className="h-4 w-full rounded bg-app-hover" />
      <div className="h-6 w-28 rounded-full bg-app-hover" />
      <div className="h-3 w-24 rounded bg-app-hover" />
      <div className="h-3 w-32 rounded bg-app-hover" />
    </div>
  );
}

function SkeletonMediaBuyerCard() {
  return (
    <div
      className="shrink-0 w-48 rounded-xl border border-app-border bg-app-elevated p-2.5 space-y-2 animate-pulse"
      aria-hidden
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-app-hover shrink-0" />
        <div className="flex-1 space-y-1.5 min-w-0">
          <div className="h-3 w-24 rounded bg-app-hover" />
          <div className="h-2.5 w-28 rounded bg-app-hover" />
        </div>
      </div>
      <div className="flex gap-1.5">
        <div className="h-5 flex-1 rounded bg-app-hover" />
        <div className="h-5 w-16 rounded bg-app-hover" />
      </div>
      <div className="h-2.5 w-full rounded bg-app-hover" />
      <div className="h-1.5 w-full rounded-full bg-app-hover" />
    </div>
  );
}

/**
 * First paint while `overviewData` is streaming: real headings, filters, and card chrome;
 * only metric strips and scroll rows pulse (matches Live Activities layout).
 */
export function MarketingOverviewLoadingShell({
  leaderboardPeriod,
  filters,
  liveEvents,
}: MarketingOverviewLoadingShellProps) {
  const periodHint = leaderboardPeriod === 'all_time' ? 'all time' : 'selected period';
  const liveState = useLiveIndicator(liveEvents ?? []);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const scrollActivityStrip = (delta: number) => {
    activityScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const statLabels = [
    'Total Spend',
    'Total Orders',
    'Delivered',
    'Confirmed',
    'Avg CPA',
    'Delivery Rate',
    'Confirmation Rate',
    'True ROAS',
    'Del. Revenue',
  ];

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Live Activities"
        mobileInlineActions
        description="Track marketing activity and funding."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Marketing overview tools"
            sheetSubtitle={<span>Date range and refresh</span>}
            triggerAriaLabel="Marketing overview tools"
            mobileLeading={
              liveEvents != null && liveEvents.length > 0 ? (
                <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
              ) : null
            }
            desktop={
              <>
                {liveEvents != null && liveEvents.length > 0 && (
                  <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
                )}
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={filters?.startDate ?? ''}
                    endDate={filters?.endDate ?? ''}
                    periodAllTime={filters?.periodAllTime ?? false}
                  />
                </div>
                <PageRefreshButton />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters?.startDate ?? ''}
        endDate={filters?.endDate ?? ''}
        periodAllTime={filters?.periodAllTime ?? false}
      />

      <OverviewStatStripSkeleton count={statLabels.length} labels={statLabels} />

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-app-fg">Live activity</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">
              Loading cart and funnel activity…
            </p>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="hidden md:flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => scrollActivityStrip(-280)}
                className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
                aria-label="Scroll left"
              >
                <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scrollActivityStrip(280)}
                className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
                aria-label="Scroll right"
              >
                <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div
          ref={activityScrollRef}
          className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
        >
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonLiveActivityCard key={i} />
          ))}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-app-fg">Live orders</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">Loading recent orders…</p>
          </div>
          <Link
            to="/admin/marketing/orders"
            className="btn-primary btn-sm shrink-0 inline-flex items-center justify-center"
          >
            View all
          </Link>
        </div>
        <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonOrderCard key={i} />
          ))}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-app-fg">Media Buyer Performance</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">
              Loading rankings ({periodHint})…
            </p>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              disabled
              className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted opacity-50 cursor-not-allowed flex items-center justify-center"
              aria-label="Scroll left"
            >
              <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              disabled
              className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted opacity-50 cursor-not-allowed flex items-center justify-center"
              aria-label="Scroll right"
            >
              <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <Button type="button" variant="secondary" size="sm" disabled>
              View all
            </Button>
          </div>
        </div>
        <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonMediaBuyerCard key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
