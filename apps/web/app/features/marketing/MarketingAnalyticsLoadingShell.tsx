import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';

export interface MarketingAnalyticsLoadingShellProps {
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  /** Detail mode (per-form page): show the form-name header + back button, hide the
   * forms table + cross-funnel skeletons that only exist on the global page. */
  detail?: boolean;
}

const STAT_LABELS = ['Unique form views', 'All form views', 'Avg time on form', 'Conversion', 'Matched to a view'];

function Pulse({ className }: { className: string }) {
  return <div className={`rounded bg-app-hover animate-pulse ${className}`} />;
}

/** Skeleton rows matching a CompactTable / data table block. */
function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-3 py-2 border-b border-app-border">
        <Pulse className="h-3 w-24" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-app-border last:border-0">
          <Pulse className="h-4 flex-1 max-w-[10rem]" />
          <Pulse className="h-4 w-12" />
          <Pulse className="h-4 w-12" />
          <Pulse className="h-4 w-14" />
          <Pulse className="h-6 w-14 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** First paint while `analyticsData` streams: real header + filters; strips, tables, and
 * chart cards pulse in the SAME layout the loaded page uses (trend → funnel+donut →
 * forms table → cross-funnel). Detail mode drops the two global-only sections. */
export function MarketingAnalyticsLoadingShell({ filters, detail = false }: MarketingAnalyticsLoadingShellProps) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title={detail ? 'Form' : 'Analytics'}
        {...(detail ? { backTo: '/admin/marketing/analytics' } : {})}
        mobileInlineActions
        description={detail ? 'Analytics for this form.' : 'Form landings, traffic by form, and conversion.'}
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

      {/* Trend card — full width, leads the page. */}
      <div className="card overflow-hidden">
        <Pulse className="h-5 w-40 mb-3" />
        <Pulse className="h-72 w-full" />
      </div>

      {/* Funnel + top-forms donut grid. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <Pulse className="h-4 w-36 mb-1" />
          <Pulse className="h-3 w-56 mb-3" />
          <Pulse className="h-64 w-full" />
        </div>
        <div className="card overflow-hidden">
          <Pulse className="h-4 w-40 mb-1" />
          <Pulse className="h-3 w-52 mb-3" />
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="w-40 h-40 rounded-full bg-app-hover animate-pulse shrink-0" />
            <div className="w-full sm:flex-1 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Pulse key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Global-only sections: all-forms table + cross-funnel. */}
      {!detail && (
        <>
          <div className="space-y-2">
            <Pulse className="h-4 w-24" />
            <Pulse className="h-3 w-48" />
            <TableSkeleton rows={5} />
          </div>

          <div className="card overflow-hidden">
            <Pulse className="h-4 w-44 mb-1" />
            <Pulse className="h-3 w-72 mb-3" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-app-border bg-app-elevated p-3">
                  <Pulse className="h-3 w-20 mb-2" />
                  <Pulse className="h-6 w-12" />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
