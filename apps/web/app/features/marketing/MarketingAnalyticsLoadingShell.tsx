import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';

export interface MarketingAnalyticsLoadingShellProps {
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
}

const STAT_LABELS = ['Landings', 'Total loads', 'Avg time on form', 'Conversion', 'Matched to a view'];

/** First paint while `analyticsData` streams: real header + filters; strips and chart cards pulse. */
export function MarketingAnalyticsLoadingShell({ filters }: MarketingAnalyticsLoadingShellProps) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Analytics"
        mobileInlineActions
        description="Form landings, traffic by form, and conversion."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Filters"
            triggerAriaLabel="Analytics filters"
            desktop={
              <DateFilterBar
                startDate={filters?.startDate ?? ''}
                endDate={filters?.endDate ?? ''}
                periodAllTime={filters?.periodAllTime ?? false}
                chrome="pill"
              />
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters?.startDate ?? ''}
        endDate={filters?.endDate ?? ''}
        periodAllTime={filters?.periodAllTime ?? false}
      />

      <OverviewStatStripSkeleton count={STAT_LABELS.length} labels={STAT_LABELS} />

      {/* Funnel card */}
      <div className="card overflow-hidden">
        <div className="h-5 w-40 rounded bg-app-hover animate-pulse mb-2" />
        <div className="h-3 w-64 rounded bg-app-hover animate-pulse mb-4" />
        <div className="h-64 w-full rounded bg-app-hover animate-pulse" />
      </div>

      {/* Trend + top forms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <div className="h-4 w-36 rounded bg-app-hover animate-pulse mb-3" />
          <div className="h-72 w-full rounded bg-app-hover animate-pulse" />
        </div>
        <div className="card overflow-hidden">
          <div className="h-4 w-36 rounded bg-app-hover animate-pulse mb-3" />
          <div className="h-80 w-full rounded bg-app-hover animate-pulse" />
        </div>
      </div>
    </div>
  );
}
