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
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { SortMenu } from '~/components/ui/sort-menu';
import { SearchInput } from '~/components/ui/search-input';
import { Pagination } from '~/components/ui/pagination';
import {
  deliveryRateColorClass,
  delinquencyRateColorClass,
} from '~/lib/rate-color';
import type { LogisticsProviderRow } from './team-types';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { NairaPrice } from '~/components/ui/naira-price';

export interface LogisticsTeamPageProps {
  providers: LogisticsProviderRow[];
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
  page?: number;
  totalPages?: number;
  /** URL-driven rows-per-page — feeds the `<Pagination>` per-page picker. */
  limit?: number;
  totalCount?: number;
  unfilteredCount?: number;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

const STATUS_SPLIT_HELP =
  'Assigned orders in this period, shown as a share by current order status (delivered, agent assigned, in transit, returned, etc.). Bar segments add up to 100% of assigned count.';

const SORT_MENU_OPTIONS = [
  {
    value: 'name',
    label: 'Provider',
    description: 'Logistics company name (alphabetical).',
    ascLabel: 'A → Z',
    descLabel: 'Z → A',
    defaultDir: 'asc' as const,
  },
  {
    value: 'assigned',
    label: 'Assigned',
    description: 'Total orders allocated to this provider.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'delivered',
    label: 'Delivered',
    description: 'Orders this provider successfully delivered.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'deliveryRate',
    label: 'Delivery rate',
    description: 'Delivered ÷ assigned, as a percentage.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'delinquencyRate',
    label: 'Delinquency rate',
    description: 'Returned + partial + write-off ÷ assigned.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'asc' as const,
  },
  {
    value: 'returned',
    label: 'Returned',
    description: 'Orders the customer rejected or sent back.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'locations',
    label: 'Locations',
    description: 'Number of physical sites under this provider.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
];

/** Tailwind color class for each status segment of the stacked mix bar. */
function statusBgClass(status: string): string {
  switch (status) {
    case 'DELIVERED':
    case 'REMITTED':
      return 'bg-success-500';
    case 'PARTIALLY_DELIVERED':
      return 'bg-warning-500';
    case 'RETURNED':
    case 'WRITTEN_OFF':
      return 'bg-danger-500';
    case 'IN_TRANSIT':
    case 'DISPATCHED':
      return 'bg-brand-500';
    case 'AGENT_ASSIGNED':
      return 'bg-app-fg-muted';
    case 'CANCELLED':
    case 'DELETED':
      return 'bg-app-border';
    case 'RESTOCKED':
      return 'bg-success-300';
    default:
      return 'bg-app-border';
  }
}

function humanStatus(status: string): string {
  if (status === 'AGENT_ASSIGNED') return 'Agent assigned';
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
        title="No agent-assigned orders in this period"
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

/** Mobile card row — kept inline since it's not reused elsewhere. */
function ProviderCard({ row, detailTo }: { row: LogisticsProviderRow; detailTo: string }) {
  return (
    <div className="card p-4">
      <div className="min-w-0 mb-3">
        <div className="font-medium text-app-fg truncate">{row.providerName}</div>
        <div className="text-xs text-app-fg-muted">
          {row.locationCount} location{row.locationCount === 1 ? '' : 's'}
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

      <div className="text-xs mb-3">
        <div className="text-app-fg-muted">Remitted</div>
        <div className="font-semibold tabular-nums text-app-fg">
          <NairaPrice amount={row.remittedAmount} zeroAsDash />
        </div>
        {(Number(row.pendingRemittanceAmount) > 0 || Number(row.disputedRemittanceAmount) > 0) && (
          <div className="flex flex-wrap gap-1 mt-1 text-micro">
            {Number(row.pendingRemittanceAmount) > 0 && (
              <span className="px-1 py-0.5 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400">
                Pending <NairaPrice amount={row.pendingRemittanceAmount} />
              </span>
            )}
            {Number(row.disputedRemittanceAmount) > 0 && (
              <span className="px-1 py-0.5 rounded bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400">
                Disputed <NairaPrice amount={row.disputedRemittanceAmount} />
              </span>
            )}
          </div>
        )}
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

      <div className="space-y-1" title={STATUS_SPLIT_HELP}>
        <div className="text-xs text-app-fg-muted">Order status split</div>
        <StatusMixBar breakdown={row.statusBreakdown} totalAssigned={row.totalAssigned} />
      </div>

      <div className="mt-4 pt-3 border-t border-app-border flex justify-end">
        <TableActionButton to={detailTo} variant="primary">
          View
        </TableActionButton>
      </div>
    </div>
  );
}

export function LogisticsTeamPage({
  providers,
  dateFilters,
  page = 1,
  totalPages = 1,
  limit,
  totalCount = 0,
  unfilteredCount = 0,
  q = '',
  sortBy: sortByFromLoader = 'deliveryRate',
  sortDir: sortDirFromLoader = 'desc',
}: LogisticsTeamPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const listQuerySuffix = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `?${qs}` : '';
  }, [searchParams]);
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
          <div className="font-medium text-app-fg truncate min-w-0">{p.providerName}</div>
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
        key: 'remitted',
        header: 'Remitted',
        align: 'right',
        nowrap: true,
        render: (p) => {
          const pending = Number(p.pendingRemittanceAmount) || 0;
          const disputed = Number(p.disputedRemittanceAmount) || 0;
          return (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-sm font-medium text-app-fg tabular-nums">
                <NairaPrice amount={p.remittedAmount} zeroAsDash />
              </span>
              {(pending > 0 || disputed > 0) && (
                <div className="flex items-center gap-1 text-micro tabular-nums">
                  {pending > 0 && (
                    <span
                      className="px-1 py-0.5 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400"
                      title="Pending Finance review"
                    >
                      Pending <NairaPrice amount={p.pendingRemittanceAmount} />
                    </span>
                  )}
                  {disputed > 0 && (
                    <span
                      className="px-1 py-0.5 rounded bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400"
                      title="Disputed by Finance"
                    >
                      Disputed <NairaPrice amount={p.disputedRemittanceAmount} />
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        },
      },
      {
        key: 'statusMix',
        header: (
          <span title={STATUS_SPLIT_HELP} className="cursor-help border-b border-dotted border-app-fg-muted/60">
            Order status split
          </span>
        ),
        minWidth: 'min-w-[180px]',
        render: (p) => <StatusMixBar breakdown={p.statusBreakdown} totalAssigned={p.totalAssigned} />,
      },
      {
        key: 'actions',
        header: '',
        tight: true,
        nowrap: true,
        render: (p) => (
          <TableActionButton to={`/admin/logistics/team/${p.providerId}${listQuerySuffix}`} variant="primary">
            View
          </TableActionButton>
        ),
      },
    ];
  }, [listQuerySuffix]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics Agent Analysis"
        mobileInlineActions
        description="View provider delivery performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Logistics agent tools"
            sheetSubtitle={<span>Sort and date range</span>}
            triggerAriaLabel="Logistics agent toolbar and date range"
            filtersBadgeCount={logisticsTeamToolbarFilterBadge}
            filters={
              <SortMenu
                value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
                onChange={(next) =>
                  mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
                }
                defaultValue={{ sortBy: 'deliveryRate', sortDir: 'desc' }}
                options={SORT_MENU_OPTIONS}
                className="w-full justify-center"
              />
            }
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
          />
        }
      />

      <MobileDateFilterRow
        startDate={dateFilters.startDate}
        endDate={dateFilters.endDate}
        periodAllTime={dateFilters.periodAllTime}
      />

      <OverviewStatStrip
        mobileGrid
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
          hideMobileSheet
          badgeCount={logisticsTeamToolbarFilterBadge}
          sheetSubtitle={<span>Sort options apply immediately</span>}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                value={searchQuery}
                onChange={(v) => setSearchQuery(v)}
                placeholder="Search by provider name…"
                withSubmitButton
                wrapperClassName="min-w-0 flex-1"
                name="q"
                autoComplete="off"
              />
            </form>
          }
          desktopInlineFilters={
            <SortMenu
              value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
              onChange={(next) =>
                mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
              }
              defaultValue={{ sortBy: 'deliveryRate', sortDir: 'desc' }}
              options={SORT_MENU_OPTIONS}
            />
          }
          sheetFilterBody={
            <SortMenu
              value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
              onChange={(next) =>
                mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
              }
              defaultValue={{ sortBy: 'deliveryRate', sortDir: 'desc' }}
              options={SORT_MENU_OPTIONS}
              className="w-full justify-center"
            />
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
                <ProviderCard
                  key={p.providerId}
                  row={p}
                  detailTo={`/admin/logistics/team/${p.providerId}${listQuerySuffix}`}
                />
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
              <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
