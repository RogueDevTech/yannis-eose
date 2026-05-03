import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { EmptyState } from '~/components/ui/empty-state';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { Pagination } from '~/components/ui/pagination';
import {
  deliveryRateColorClass,
  delinquencyRateColorClass,
} from '~/lib/rate-color';
import type { LogisticsProviderRow } from './team-types';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';

export interface LogisticsTeamPageProps {
  providers: LogisticsProviderRow[];
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
  page?: number;
  totalPages?: number;
  totalCount?: number;
  unfilteredCount?: number;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

const SORT_BY_OPTIONS = [
  { value: 'name', label: 'Provider' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'deliveryRate', label: 'Delivery rate' },
  { value: 'delinquencyRate', label: 'Delinquency rate' },
  { value: 'returned', label: 'Returned' },
  { value: 'locations', label: 'Locations' },
];

/** Tailwind color class for each status segment of the stacked mix bar. */
function statusBgClass(status: string): string {
  switch (status) {
    case 'DELIVERED':
    case 'COMPLETED':
      return 'bg-success-500';
    case 'PARTIALLY_DELIVERED':
      return 'bg-warning-500';
    case 'RETURNED':
    case 'WRITTEN_OFF':
      return 'bg-danger-500';
    case 'IN_TRANSIT':
    case 'DISPATCHED':
      return 'bg-brand-500';
    case 'ALLOCATED':
      return 'bg-app-fg-muted';
    case 'CANCELLED':
      return 'bg-app-border';
    case 'RESTOCKED':
      return 'bg-success-300';
    default:
      return 'bg-app-border';
  }
}

function humanStatus(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Tiny stacked horizontal bar showing the per-status mix for a provider. */
function StatusMixBar({
  breakdown,
  totalAssigned,
}: {
  breakdown: LogisticsProviderRow['statusBreakdown'];
  totalAssigned: number;
}) {
  if (totalAssigned === 0) {
    return (
      <div
        className="h-1.5 w-full rounded-full bg-app-hover"
        title="No orders allocated in this period"
      />
    );
  }
  const tooltip = breakdown
    .map((b) => `${humanStatus(b.status)}: ${b.count} (${b.pct.toFixed(1)}%)`)
    .join('· ');
  return (
    <div
      className="h-1.5 w-full rounded-full overflow-hidden flex bg-app-hover"
      title={tooltip}
    >
      {breakdown.map((b) => (
        <div
          key={b.status}
          className={statusBgClass(b.status)}
          style={{ width: `${b.pct}%` }}
          aria-label={`${humanStatus(b.status)} ${b.pct.toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

function providerInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Mobile card row — kept inline since it's not reused elsewhere. */
function ProviderCard({ row }: { row: LogisticsProviderRow }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5 min-w-0 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-brand-600 dark:text-brand-400">
            {providerInitials(row.providerName)}
          </span>
        </div>
        <div className="min-w-0">
          <div className="font-medium text-app-fg truncate">{row.providerName}</div>
          <div className="text-xs text-app-fg-muted">
            {row.locationCount} location{row.locationCount === 1 ? '' : 's'} · {row.status}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs mb-3">
        <div>
          <div className="text-app-fg-muted">Assigned</div>
          <div className="font-semibold tabular-nums">{row.totalAssigned}</div>
        </div>
        <div>
          <div className="text-app-fg-muted">Delivered</div>
          <div className="font-semibold tabular-nums">{row.delivered}</div>
        </div>
        <div>
          <div className="text-app-fg-muted">Returned</div>
          <div className="font-semibold tabular-nums">{row.returned}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs mb-3">
        <div>
          <div className="text-app-fg-muted">Delivery rate</div>
          <div className={`font-semibold tabular-nums ${deliveryRateColorClass(row.deliveryRate)}`}>
            {row.totalAssigned > 0 ? `${Math.round(row.deliveryRate)}%` : '—'}
          </div>
        </div>
        <div>
          <div className="text-app-fg-muted">Delinquency</div>
          <div className={`font-semibold tabular-nums ${delinquencyRateColorClass(row.delinquencyRate)}`}>
            {row.totalAssigned > 0 ? `${Math.round(row.delinquencyRate)}%` : '—'}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-app-fg-muted">Status mix</div>
        <StatusMixBar breakdown={row.statusBreakdown} totalAssigned={row.totalAssigned} />
      </div>
    </div>
  );
}

export function LogisticsTeamPage({
  providers,
  dateFilters,
  page = 1,
  totalPages = 1,
  totalCount = 0,
  unfilteredCount = 0,
  q = '',
  sortBy: sortByFromLoader = 'deliveryRate',
  sortDir: sortDirFromLoader = 'desc',
}: LogisticsTeamPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(q);

  useEffect(() => {
    setSearchQuery(q);
  }, [q]);

  const mergeListParams = (overrides: {
    q?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    page?: number;
  }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.q !== undefined) {
      const trimmed = overrides.q.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
    }
    if (overrides.sortBy !== undefined) params.set('sortBy', overrides.sortBy);
    if (overrides.sortDir !== undefined) params.set('sortDir', overrides.sortDir);
    if (overrides.page !== undefined) {
      if (overrides.page <= 1) params.delete('page');
      else params.set('page', String(overrides.page));
    }
    setSearchParams(params);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mergeListParams({ q: searchQuery, page: 1 });
  };

  const logisticsTeamToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (sortByFromLoader !== 'deliveryRate') n += 1;
    if (sortDirFromLoader !== 'desc') n += 1;
    return n;
  }, [sortByFromLoader, sortDirFromLoader]);

  const showSearchEmpty = unfilteredCount > 0 && providers.length === 0;

  // Top-strip rollups across the displayed slice — when sliced by search we
  // still show totals over `providers` so the numbers track what's visible.
  const activeCount = providers.filter((p) => p.status === 'ACTIVE').length;
  const totalAssigned = providers.reduce((acc, p) => acc + p.totalAssigned, 0);
  const totalDelivered = providers.reduce((acc, p) => acc + p.delivered, 0);
  const totalDelinquent = providers.reduce(
    (acc, p) => acc + p.returned + p.partiallyDelivered + p.writtenOff,
    0,
  );
  const overallDeliveryRate = totalAssigned > 0 ? (totalDelivered / totalAssigned) * 100 : 0;
  const overallDelinquencyRate =
    totalAssigned > 0 ? (totalDelinquent / totalAssigned) * 100 : 0;

  const providerColumns = useMemo((): CompactTableColumn<LogisticsProviderRow>[] => {
    return [
      {
        key: 'provider',
        header: 'Provider',
        render: (p) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-brand-600 dark:text-brand-400">
                {providerInitials(p.providerName)}
              </span>
            </div>
            <div className="min-w-0">
              <div className="font-medium text-app-fg truncate">{p.providerName}</div>
              <div className="text-xs text-app-fg-muted">{p.status}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'locations',
        header: 'Locations',
        align: 'right',
        nowrap: true,
        cellClassName: 'tabular-nums text-app-fg-muted',
        render: (p) => p.locationCount,
      },
      {
        key: 'assigned',
        header: 'Assigned',
        align: 'right',
        nowrap: true,
        cellClassName: 'tabular-nums text-app-fg',
        render: (p) => p.totalAssigned,
      },
      {
        key: 'delivered',
        header: 'Delivered',
        align: 'right',
        nowrap: true,
        cellClassName: 'tabular-nums text-app-fg',
        render: (p) => p.delivered,
      },
      {
        key: 'deliveryRate',
        header: 'Delivery rate',
        align: 'right',
        nowrap: true,
        cellClassName: (p) => `tabular-nums ${deliveryRateColorClass(p.deliveryRate)}`,
        render: (p) => (p.totalAssigned > 0 ? `${Math.round(p.deliveryRate)}%` : '—'),
      },
      {
        key: 'delinquencyRate',
        header: 'Delinquency rate',
        align: 'right',
        nowrap: true,
        cellClassName: (p) => `tabular-nums ${delinquencyRateColorClass(p.delinquencyRate)}`,
        render: (p) => (p.totalAssigned > 0 ? `${Math.round(p.delinquencyRate)}%` : '—'),
      },
      {
        key: 'returned',
        header: 'Returned',
        align: 'right',
        nowrap: true,
        cellClassName: 'tabular-nums text-app-fg-muted',
        render: (p) => p.returned,
      },
      {
        key: 'inTransit',
        header: 'In transit',
        align: 'right',
        nowrap: true,
        cellClassName: 'tabular-nums text-app-fg-muted',
        render: (p) => p.inTransit,
      },
      {
        key: 'statusMix',
        header: 'Status mix',
        minWidth: 'min-w-[180px]',
        render: (p) => <StatusMixBar breakdown={p.statusBreakdown} totalAssigned={p.totalAssigned} />,
      },
    ];
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics Team Analysis"
        description="Logistics provider delivery rates, delinquency, and order-status breakdown for the selected period."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Logistics team tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Logistics team toolbar and date range"
            desktop={
              <>
                <div className="flex shrink-0 items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" disabled title="Export coming soon">
                  Generate report
                </Button>
                <PageRefreshButton />
              </>
            }
            sheet={
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
              </>
            }
          />
        }
      />

      <OverviewStatStrip
        showScrollControls={false}
        items={[
          {
            label: 'Active providers',
            value: activeCount,
            valueClassName: 'text-app-fg',
          },
          {
            label: 'Total assigned',
            value: totalAssigned,
            valueClassName: 'text-app-fg',
          },
          {
            label: 'Delivered',
            value: totalDelivered,
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: 'Delivery rate',
            value: totalAssigned > 0 ? `${Math.round(overallDeliveryRate)}%` : '—',
            valueClassName: deliveryRateColorClass(overallDeliveryRate),
          },
          {
            label: 'Delinquency rate',
            value: totalAssigned > 0 ? `${Math.round(overallDelinquencyRate)}%` : '—',
            valueClassName: delinquencyRateColorClass(overallDelinquencyRate),
          },
        ]}
      />

      <div>
        <ToolbarFiltersCollapsible
          className="mb-4 !border-0 px-0 py-0"
          badgeCount={logisticsTeamToolbarFilterBadge}
          sheetSubtitle={<span>Sort options apply immediately</span>}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                value={searchQuery}
                onChange={(v) => setSearchQuery(v)}
                placeholder="Search by provider name…"
                wrapperClassName="min-w-0 flex-1"
                name="q"
                autoComplete="off"
              />
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          }
          desktopInlineFilters={
            <>
              <FormSelect
                aria-label="Sort providers by"
                value={sortByFromLoader}
                onChange={(e) => {
                  const next = e.target.value;
                  const nextDir: 'asc' | 'desc' = next === 'name' ? 'asc' : 'desc';
                  mergeListParams({ sortBy: next, sortDir: nextDir, page: 1 });
                }}
                options={SORT_BY_OPTIONS}
                wrapperClassName="w-auto min-w-[12rem]"
              />
              <FormSelect
                aria-label="Sort order"
                value={sortDirFromLoader}
                onChange={(e) =>
                  mergeListParams({ sortDir: e.target.value as 'asc' | 'desc', page: 1 })
                }
                options={[
                  { value: 'asc', label: 'Ascending' },
                  { value: 'desc', label: 'Descending' },
                ]}
                wrapperClassName="w-auto min-w-[8rem]"
              />
            </>
          }
          sheetFilterBody={
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Sort by</span>
                <FormSelect
                  aria-label="Sort providers by"
                  value={sortByFromLoader}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextDir: 'asc' | 'desc' = next === 'name' ? 'asc' : 'desc';
                    mergeListParams({ sortBy: next, sortDir: nextDir, page: 1 });
                  }}
                  options={SORT_BY_OPTIONS}
                  wrapperClassName="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Order</span>
                <FormSelect
                  aria-label="Sort order"
                  value={sortDirFromLoader}
                  onChange={(e) =>
                    mergeListParams({ sortDir: e.target.value as 'asc' | 'desc', page: 1 })
                  }
                  options={[
                    { value: 'asc', label: 'Ascending' },
                    { value: 'desc', label: 'Descending' },
                  ]}
                  wrapperClassName="w-full"
                />
              </div>
            </>
          }
        />

        {totalCount > 0 && (q || sortByFromLoader !== 'deliveryRate' || sortDirFromLoader !== 'desc') && (
          <p className="text-xs text-app-fg-muted mb-3" aria-live="polite">
            {totalCount} provider{totalCount === 1 ? '' : 's'}
            {q ? ` matching "${q}"` : ''}
          </p>
        )}

        {providers.length === 0 && !showSearchEmpty ? (
          <div className="card">
            <EmptyState
              title="No logistics providers yet"
              description="Add a logistics company from /admin/logistics/partners to see it here."
            />
          </div>
        ) : showSearchEmpty ? (
          <div className="card">
            <EmptyState
              title="No matching providers"
              description="Try a different name or clear the search field."
            />
          </div>
        ) : (
          <>
            {/* Mobile: card layout */}
            <div className="md:hidden grid grid-cols-1 gap-3">
              {providers.map((p) => (
                <ProviderCard key={p.providerId} row={p} />
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block">
              <CompactTable
                columns={providerColumns}
                rows={providers}
                rowKey={(p) => p.providerId}
                className="min-w-[1100px]"
              />
            </div>

            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} pageParam="page" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
