import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { DotSeparator, DualValue } from '~/components/ui/dot-separator';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { FilterPills } from '~/components/ui/filter-pills';
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
import type { LogisticsProviderRow, LogisticsLocationRow } from './team-types';
import { FormSelect } from '~/components/ui/form-select';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Modal } from '~/components/ui/modal';
import { TableActionButton } from '~/components/ui/table-action-button';
import { NairaPrice } from '~/components/ui/naira-price';
import { formatNaira } from '~/lib/format-amount';

export interface LogisticsTeamPageProps {
  providers: LogisticsProviderRow[];
  locations?: LogisticsLocationRow[];
  productOptions?: { id: string; name: string }[];
  productId?: string | null;
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

function checkProviderConsistency(p: LogisticsProviderRow) {
  const expected = p.stockReceived - p.stockSold - p.stockTransferredOut + p.stockAdjusted - p.stockWrittenOff - (p.reservedStock ?? 0);
  const diff = p.availableStock - expected;
  return { expected, diff, isConsistent: diff === 0 };
}

function generateProviderReport(p: LogisticsProviderRow, filters?: { productName?: string; startDate?: string; endDate?: string; periodAllTime?: boolean }): string {
  const c = checkProviderConsistency(p);
  const lines: string[] = [];
  lines.push(`STOCK RECONCILIATION REPORT`);
  lines.push(`==========================`);
  lines.push(`Provider: ${p.providerName}`);
  lines.push(`Locations: ${p.locationCount}`);
  if (filters?.productName) lines.push(`Product: ${filters.productName}`);
  if (filters?.periodAllTime) {
    lines.push(`Period: All time`);
  } else if (filters?.startDate && filters?.endDate) {
    lines.push(`Period: ${filters.startDate} to ${filters.endDate}`);
  }
  lines.push(`Generated: ${new Date().toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })}`);
  lines.push('');
  lines.push(`STOCK FLOW`);
  lines.push(`----------`);
  lines.push(`Received:            ${(p.stockReceived + p.stockAdjusted).toLocaleString()} units`);
  lines.push(`Sold (Delivered):    ${p.stockSold.toLocaleString()} units`);
  lines.push(`Transferred Out:     ${p.stockTransferredOut > 0 ? '−' : ''}${p.stockTransferredOut.toLocaleString()} units`);
  lines.push(`Reserved:            ${(p.reservedStock ?? 0).toLocaleString()} units`);
  lines.push('');
  lines.push(`BALANCE`);
  lines.push(`-------`);
  lines.push(`Expected Available:  ${c.expected.toLocaleString()} units`);
  lines.push(`Actual Available:    ${p.availableStock.toLocaleString()} units`);
  lines.push(`Status:              ${c.isConsistent ? '✓ CONSISTENT' : `✗ INCONSISTENT (${c.diff > 0 ? '+' : ''}${c.diff.toLocaleString()} units)`}`);
  if (!c.isConsistent) {
    lines.push('');
    if (c.diff > 0) {
      lines.push(`There are ${c.diff.toLocaleString()} more units than expected.`);
      lines.push(`Possible causes: unrecorded intake, positive adjustment not captured.`);
    } else {
      lines.push(`There are ${Math.abs(c.diff).toLocaleString()} fewer units than expected.`);
      lines.push(`Possible causes: unrecorded sale, stock loss, damage not written off.`);
    }
  }
  lines.push('');
  lines.push(`ORDER PERFORMANCE`);
  lines.push(`-----------------`);
  lines.push(`Total Assigned:      ${p.totalAssigned.toLocaleString()} orders`);
  lines.push(`Delivered:           ${p.delivered.toLocaleString()} orders`);
  lines.push(`Returned:            ${p.returned.toLocaleString()} orders`);
  lines.push(`Units Delivered:     ${p.unitsDelivered.toLocaleString()} units`);
  lines.push(`Delivery Rate:       ${p.totalAssigned > 0 ? `${Math.round(p.deliveryRate)}%` : '0%'}`);
  lines.push(`Delinquency Rate:    ${p.totalAssigned > 0 ? `${Math.round(p.delinquencyRate)}%` : '0%'}`);
  lines.push('');
  lines.push(`REMITTANCE`);
  lines.push(`----------`);
  lines.push(`Remitted:            ${formatNaira(p.remittedAmount)}`);
  lines.push(`Pending:             ${formatNaira(p.pendingRemittanceAmount)}`);
  if (Number(p.disputedRemittanceAmount) > 0) lines.push(`Disputed:            ${formatNaira(p.disputedRemittanceAmount)}`);
  lines.push('');
  lines.push(`--- End of Report ---`);
  return lines.join('\n');
}

function downloadReport(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
    value: 'unitsDelivered',
    label: 'Units delivered',
    description: 'Total units (bottles) in delivered orders.',
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
  {
    value: 'owingAmount',
    label: 'Owing',
    description: 'Delivered orders not yet on a remittance batch.',
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
        <div className="font-medium text-app-fg truncate">
          {row.providerName}
          <span className="text-xs text-app-fg-muted ml-1.5">({row.locationCount})</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs mb-3">
        <div>
          <div className="text-app-fg-muted">Available stock</div>
          <div className={`font-semibold tabular-nums ${row.availableStock === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>{row.availableStock.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-app-fg-muted">Assigned</div>
          <div className="font-semibold tabular-nums">{row.totalAssigned}</div>
        </div>
        <div>
          <div className="text-app-fg-muted">Delivered</div>
          <div className="font-semibold tabular-nums">{row.delivered}</div>
        </div>
        <div>
          <div className="text-app-fg-muted">Units delivered</div>
          <div className="font-semibold tabular-nums">{row.unitsDelivered.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-app-fg-muted">Returned</div>
          <div className="font-semibold tabular-nums">{row.returned}</div>
        </div>
      </div>

      <div className="text-xs mb-3">
        <div className="text-app-fg-muted">Remitted</div>
        <div className="font-semibold tabular-nums text-app-fg">
          <NairaPrice amount={row.remittedAmount} />
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
            {row.totalAssigned > 0 ? `${Math.round(row.deliveryRate)}%` : '0%'}
          </div>
        </div>
        <div>
          <div className="text-app-fg-muted">Delinquency</div>
          <div className={`font-semibold tabular-nums ${delinquencyRateColorClass(row.delinquencyRate)}`}>
            {row.totalAssigned > 0 ? `${Math.round(row.delinquencyRate)}%` : '0%'}
          </div>
        </div>
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
  locations: locationRows = [],
  productOptions = [],
  productId: activeProductId = null,
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
  const [peekProvider, setPeekProvider] = useState<LogisticsProviderRow | null>(null);
  const [reportProvider, setReportProvider] = useState<LogisticsProviderRow | null>(null);
  const [reportView, setReportView] = useState<'summary' | 'breakdown'>('summary');
  const [reportLocation, setReportLocation] = useState<LogisticsLocationRow | null>(null);
  const [showAggregateReport, setShowAggregateReport] = useState(false);
  const [viewType, setViewType] = useState<'company' | 'location'>('company');

  // Client-side search for locations (providers are filtered server-side)
  const filteredLocations = useMemo(() => {
    if (!q.trim()) return locationRows;
    const lower = q.trim().toLowerCase();
    return locationRows.filter((l) => l.locationName.toLowerCase().includes(lower) || l.providerName.toLowerCase().includes(lower));
  }, [locationRows, q]);

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
    if (sortByFromLoader !== 'assigned') n += 1;
    if (sortDirFromLoader !== 'desc') n += 1;
    if (activeProductId) n += 1;
    return n;
  }, [sortByFromLoader, sortDirFromLoader, activeProductId]);

  const showSearchEmpty = unfilteredCount > 0 && providers.length === 0;

  // Top-strip rollups across the displayed slice — when sliced by search we
  // still show totals over `providers` so the numbers track what's visible.
  const activeCount = providers.filter((p) => p.status === 'ACTIVE').length;
  const totalAssigned = providers.reduce((acc, p) => acc + p.totalAssigned, 0);
  const totalDelivered = providers.reduce((acc, p) => acc + p.delivered, 0);
  const totalUnitsDelivered = providers.reduce((acc, p) => acc + p.unitsDelivered, 0);
  const totalDelinquent = providers.reduce(
    (acc, p) => acc + p.returned + p.partiallyDelivered + p.writtenOff,
    0,
  );
  const totalRemitted = providers.reduce((acc, p) => acc + (Number(p.remittedAmount) || 0), 0);
  const totalPending = providers.reduce((acc, p) => acc + (Number(p.pendingRemittanceAmount) || 0), 0);
  const totalOwing = providers.reduce((acc, p) => acc + (Number(p.owingAmount) || 0), 0);
  const totalAvailableStock = providers.reduce((acc, p) => acc + p.availableStock, 0);
  const totalReservedStock = providers.reduce((acc, p) => acc + (p.reservedStock ?? 0), 0);
  const totalStockReceived = providers.reduce((acc, p) => acc + p.stockReceived, 0);
  const totalStockSold = providers.reduce((acc, p) => acc + p.stockSold, 0);
  const totalStockTransferred = providers.reduce((acc, p) => acc + p.stockTransferredOut, 0);
  const totalStockAdjusted = providers.reduce((acc, p) => acc + p.stockAdjusted, 0);
  const totalStockWrittenOff = providers.reduce((acc, p) => acc + p.stockWrittenOff, 0);
  const totalStockDispatched = providers.reduce((acc, p) => acc + p.stockDispatched, 0);
  const expectedStock = totalStockReceived - totalStockSold - totalStockTransferred + totalStockAdjusted - totalStockWrittenOff - totalReservedStock;
  const stockDiff = totalAvailableStock - expectedStock;
  const stockBalanced = stockDiff === 0;
  const inconsistentProviders = providers.filter((p) => { const e = p.stockReceived - p.stockSold - p.stockTransferredOut + p.stockAdjusted - p.stockWrittenOff - (p.reservedStock ?? 0); return p.availableStock !== e; }).length;
  const overallDeliveryRate = totalAssigned > 0 ? (totalDelivered / totalAssigned) * 100 : 0;
  const overallDelinquencyRate =
    totalAssigned > 0 ? (totalDelinquent / totalAssigned) * 100 : 0;

  const providerColumns = useMemo((): CompactTableColumn<LogisticsProviderRow>[] => {
    return [
      {
        key: 'provider',
        header: 'Provider',
        render: (p) => (
          <div className="min-w-0">
            <span className="font-medium text-app-fg truncate">{p.providerName}</span>
            <span className="text-xs text-app-fg-muted ml-1.5">({p.locationCount})</span>
          </div>
        ),
      },
      {
        key: 'availableStock',
        header: 'Available stock',
        align: 'right',
        nowrap: true,
        render: (p) => (p.reservedStock ?? 0) > 0 ? (
          <DualValue
            className="font-medium"
            left={<span className={p.availableStock === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}>{p.availableStock.toLocaleString()}</span>}
            right={<span className="text-warning-600 dark:text-warning-400 font-normal text-xs">{p.reservedStock!.toLocaleString()}</span>}
          />
        ) : (
          <span className={`tabular-nums font-medium ${p.availableStock === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>{p.availableStock.toLocaleString()}</span>
        ),
      },
      {
        key: 'stockStatus',
        header: 'Stock status',
        align: 'center',
        nowrap: true,
        render: (p) => {
          const expected = p.stockReceived - p.stockSold - p.stockTransferredOut + p.stockAdjusted - p.stockWrittenOff - (p.reservedStock ?? 0);
          const diff = p.availableStock - expected;
          const ok = diff === 0;
          return (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ok ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'}`}
              title={ok ? 'Stock is balanced' : `${Math.abs(diff).toLocaleString()} units ${diff > 0 ? 'over' : 'under'} expected`}
            >
              {ok ? '✓ Balanced' : `✗ ${Math.abs(diff).toLocaleString()} off`}
            </span>
          );
        },
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
        render: (p) => (
          <DualValue
            left={<span className="text-app-fg">{p.delivered.toLocaleString()}</span>}
            right={<span className={deliveryRateColorClass(p.deliveryRate)}>{p.totalAssigned > 0 ? `${Math.round(p.deliveryRate)}%` : '0%'}</span>}
          />
        ),
      },
      {
        key: 'remitted',
        header: 'Remitted',
        align: 'right',
        nowrap: true,
        render: (p) => {
          const pending = Number(p.pendingRemittanceAmount) || 0;
          return pending > 0 ? (
            <DualValue
              className="font-medium"
              left={<span className="text-success-600 dark:text-success-400"><NairaPrice amount={p.remittedAmount} /></span>}
              right={<span className="text-warning-600 dark:text-warning-400"><NairaPrice amount={p.pendingRemittanceAmount} /></span>}
            />
          ) : (
            <span className="text-success-600 dark:text-success-400 font-medium tabular-nums"><NairaPrice amount={p.remittedAmount} /></span>
          );
        },
      },
      {
        key: 'owingAmount',
        header: 'Owing',
        align: 'right',
        nowrap: true,
        render: (p) => {
          const amount = Number(p.owingAmount) || 0;
          const cnt = p.owingCount ?? 0;
          if (amount <= 0) return <span className="text-app-fg-muted tabular-nums">₦0</span>;
          return (
            <DualValue
              left={<span className="text-danger-600 dark:text-danger-400 font-medium"><NairaPrice amount={amount} /></span>}
              right={<span className="text-app-fg-muted">{cnt} order{cnt !== 1 ? 's' : ''}</span>}
            />
          );
        },
      },
      {
        key: 'delinquencyRate',
        header: 'Delinquency',
        align: 'right',
        nowrap: true,
        render: (p) => {
          const count = p.returned + p.partiallyDelivered + p.writtenOff;
          return (
            <DualValue
              left={<span className="text-app-fg">{count.toLocaleString()}</span>}
              right={<span className={delinquencyRateColorClass(p.delinquencyRate)}>{p.totalAssigned > 0 ? `${Math.round(p.delinquencyRate)}%` : '0%'}</span>}
            />
          );
        },
      },
      {
        key: 'actions',
        header: '',
        tight: true,
        nowrap: true,
        render: (p) => (
          <div className="flex items-center gap-1.5">
            <TableActionButton onClick={() => setReportProvider(p)} variant="neutral">
              Report
            </TableActionButton>
            <TableActionButton to={`/admin/logistics/team/${p.providerId}${listQuerySuffix}`} variant="primary">
              Details
            </TableActionButton>
          </div>
        ),
      },
    ];
  }, [listQuerySuffix]);

  const locationColumns = useMemo((): CompactTableColumn<LogisticsLocationRow>[] => [
    {
      key: 'location',
      header: 'Location',
      render: (l) => (
        <div className="min-w-0">
          <span className="font-medium text-app-fg truncate">{l.locationName}</span>
          <span className="text-app-fg-muted mx-1 text-[0.6em]">·</span>
          <span className="text-xs text-app-fg-muted">{l.providerName}</span>
        </div>
      ),
    },
    {
      key: 'availableStock',
      header: 'Available stock',
      align: 'right',
      nowrap: true,
      render: (l) => (
        <span className="tabular-nums font-medium">
          <span className={l.availableStock === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}>{l.availableStock.toLocaleString()}</span>
          {(l.reservedStock ?? 0) > 0 && (
            <>
              <span className="text-app-fg-muted mx-1">·</span>
              <span className="text-warning-600 dark:text-warning-400 font-normal text-xs">{l.reservedStock.toLocaleString()}</span>
            </>
          )}
        </span>
      ),
    },
    {
      key: 'stockStatus',
      header: 'Stock status',
      align: 'center',
      nowrap: true,
      render: (l) => {
        const expected = l.stockReceived - l.stockSold - l.stockTransferredOut + l.stockAdjusted - l.stockWrittenOff - (l.reservedStock ?? 0);
        const diff = l.availableStock - expected;
        const ok = diff === 0;
        return (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ok ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'}`} title={ok ? 'Stock is balanced' : `${Math.abs(diff).toLocaleString()} units ${diff > 0 ? 'over' : 'under'} expected`}>
            {ok ? '✓ Balanced' : `✗ ${Math.abs(diff).toLocaleString()} off`}
          </span>
        );
      },
    },
    {
      key: 'assigned',
      header: 'Assigned',
      align: 'right',
      nowrap: true,
      cellClassName: 'tabular-nums text-app-fg',
      render: (l) => l.totalAssigned,
    },
    {
      key: 'delivered',
      header: 'Delivered',
      align: 'right',
      nowrap: true,
      render: (l) => (
        <span className="tabular-nums">
          <span className="text-app-fg">{l.delivered.toLocaleString()}</span>
          <span className="text-app-fg-muted mx-1">·</span>
          <span className={deliveryRateColorClass(l.deliveryRate)}>{l.totalAssigned > 0 ? `${Math.round(l.deliveryRate)}%` : '—'}</span>
        </span>
      ),
    },
    {
      key: 'remitted',
      header: 'Remitted',
      align: 'right',
      nowrap: true,
      render: (l) => {
        const pending = Number(l.pendingRemittanceAmount) || 0;
        return (
          <span className="tabular-nums">
            <span className="text-success-600 dark:text-success-400 font-medium"><NairaPrice amount={l.remittedAmount} zeroAsDash /></span>
            {pending > 0 && (
              <>
                <span className="text-app-fg-muted mx-1">·</span>
                <span className="text-warning-600 dark:text-warning-400 font-medium"><NairaPrice amount={l.pendingRemittanceAmount} /></span>
              </>
            )}
          </span>
        );
      },
    },
    {
      key: 'delinquencyRate',
      header: 'Delinquency',
      align: 'right',
      nowrap: true,
      render: (l) => {
        const count = l.returned + l.partiallyDelivered + l.writtenOff;
        return (
          <span className="tabular-nums">
            <span className="text-app-fg">{count.toLocaleString()}</span>
            <span className="text-app-fg-muted mx-1">·</span>
            <span className={delinquencyRateColorClass(l.delinquencyRate)}>{l.totalAssigned > 0 ? `${Math.round(l.delinquencyRate)}%` : '—'}</span>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      tight: true,
      nowrap: true,
      render: (l) => (
        <div className="flex items-center gap-1.5">
          <TableActionButton onClick={() => setReportLocation(l)} variant="neutral">
            Report
          </TableActionButton>
          <TableActionButton to={`/admin/logistics/team/${l.providerId}?locationId=${l.locationId}${listQuerySuffix ? `&${listQuerySuffix.substring(1)}` : ''}`} variant="primary">
            Details
          </TableActionButton>
        </div>
      ),
    },
  ], [listQuerySuffix]);

  // Location-view stat strip aggregates
  const locActiveCount = filteredLocations.filter((l) => l.status === 'ACTIVE').length;
  const locTotalAvailable = filteredLocations.reduce((a, l) => a + l.availableStock, 0);
  const locTotalReserved = filteredLocations.reduce((a, l) => a + (l.reservedStock ?? 0), 0);
  const locTotalAssigned = filteredLocations.reduce((a, l) => a + l.totalAssigned, 0);
  const locTotalDelivered = filteredLocations.reduce((a, l) => a + l.delivered, 0);
  const locTotalUnits = filteredLocations.reduce((a, l) => a + l.unitsDelivered, 0);
  const locDeliveryRate = locTotalAssigned > 0 ? (locTotalDelivered / locTotalAssigned) * 100 : 0;
  const locInconsistent = filteredLocations.filter((l) => { const e = l.stockReceived - l.stockSold - l.stockTransferredOut + l.stockAdjusted - l.stockWrittenOff - (l.reservedStock ?? 0); return l.availableStock !== e; }).length;
  const locTotalRemitted = filteredLocations.reduce((a, l) => a + (Number(l.remittedAmount) || 0), 0);
  const locTotalPending = filteredLocations.reduce((a, l) => a + (Number(l.pendingRemittanceAmount) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics Agent Analysis"
        mobileInlineActions
        description="View provider delivery performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Logistics agent toolbar and date range"
            saveFilterKey
            filtersBadgeCount={logisticsTeamToolbarFilterBadge}
            filters={
              <SortMenu
                value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
                onChange={(next) =>
                  mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
                }
                defaultValue={{ sortBy: 'assigned', sortDir: 'desc' }}
                options={SORT_MENU_OPTIONS}
                className="w-full justify-center"
              />
            }
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime} chrome="pill" />
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowAggregateReport(true)}>
                  Generate report
                </Button>
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
        items={viewType === 'company' ? [
          { label: 'Active providers', value: activeCount, valueClassName: 'text-app-fg' },
          { label: 'Total assigned', value: totalAssigned, valueClassName: 'text-app-fg' },
          { label: 'Available stock', value: totalAvailableStock.toLocaleString(), valueClassName: totalAvailableStock === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400' },
          { label: 'Stock status', value: (<span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${stockBalanced ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'}`}>{stockBalanced ? '✓ Balanced' : `✗ ${inconsistentProviders} off`}</span>), plainValue: true },
          { label: 'Delivered', value: totalDelivered.toLocaleString(), valueClassName: 'text-app-fg' },
          { label: 'Delivery rate', value: totalAssigned > 0 ? `${Math.round(overallDeliveryRate)}%` : '0%', valueClassName: deliveryRateColorClass(overallDeliveryRate) },
          { label: 'Remitted', value: formatNaira(totalRemitted), valueClassName: 'text-success-600 dark:text-success-400' },
          ...(totalPending > 0 ? [{ label: 'Pending', value: formatNaira(totalPending), valueClassName: 'text-warning-600 dark:text-warning-400' }] : []),
          ...(totalOwing > 0 ? [{ label: 'Owing', value: formatNaira(totalOwing), valueClassName: 'text-danger-600 dark:text-danger-400' }] : []),
        ] : [
          { label: 'Locations', value: filteredLocations.length, valueClassName: 'text-app-fg' },
          { label: 'Total assigned', value: locTotalAssigned, valueClassName: 'text-app-fg' },
          { label: 'Available stock', value: locTotalAvailable.toLocaleString(), valueClassName: locTotalAvailable === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400' },
          ...(locTotalReserved > 0 ? [{ label: 'Reserved', value: locTotalReserved.toLocaleString(), valueClassName: 'text-warning-600 dark:text-warning-400' }] : []),
          { label: 'Stock status', value: (<span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${locInconsistent === 0 ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400' : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'}`}>{locInconsistent === 0 ? '✓ Balanced' : `✗ ${locInconsistent} off`}</span>), plainValue: true },
          { label: 'Delivered', value: locTotalDelivered.toLocaleString(), valueClassName: 'text-app-fg' },
          { label: 'Delivery rate', value: locTotalAssigned > 0 ? `${Math.round(locDeliveryRate)}%` : '0%', valueClassName: deliveryRateColorClass(locDeliveryRate) },
          { label: 'Remitted', value: formatNaira(locTotalRemitted), valueClassName: 'text-success-600 dark:text-success-400' },
          ...(locTotalPending > 0 ? [{ label: 'Pending', value: formatNaira(locTotalPending), valueClassName: 'text-warning-600 dark:text-warning-400' }] : []),
        ]}
      />

      <div>
        <ToolbarFiltersCollapsible
          className="mb-4 !border-0 !px-0 !py-0"
          hideMobileSheet
          badgeCount={logisticsTeamToolbarFilterBadge}
          searchRow={
            <div className="flex min-w-0 gap-2 flex-1 flex-wrap sm:flex-nowrap">
              <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 flex-1">
                <SearchInput
                  value={searchQuery}
                  onChange={(v) => setSearchQuery(v)}
                  placeholder={viewType === 'company' ? 'Search by provider name…' : 'Search by location name…'}
                  withSubmitButton
                  wrapperClassName="min-w-0 flex-1"
                  name="q"
                  autoComplete="off"
                />
              </form>
              <FormSelect
                value={viewType}
                onChange={(e) => setViewType(e.target.value as 'company' | 'location')}
                className="w-auto shrink-0"
              >
                <option value="company">By Logistics company</option>
                <option value="location">By Logistics location</option>
              </FormSelect>
              {productOptions.length > 0 && (
                <div className="relative shrink-0">
                  {activeProductId && (
                    <FilterDismiss onClear={() => {
                      const params = new URLSearchParams(searchParams);
                      params.delete('productId');
                      params.delete('page');
                      setSearchParams(params);
                    }} />
                  )}
                  <FormSelect
                    value={activeProductId ?? ''}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams);
                      if (e.target.value) { params.set('productId', e.target.value); } else { params.delete('productId'); }
                      params.delete('page');
                      setSearchParams(params);
                    }}
                    className="w-auto"
                  >
                    <option value="">All products</option>
                    {productOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </FormSelect>
                </div>
              )}
              <div className="hidden md:block relative shrink-0">
                {(sortByFromLoader !== 'assigned' || sortDirFromLoader !== 'desc') && (
                  <FilterDismiss onClear={() => mergeListParams({ sortBy: 'assigned', sortDir: 'desc', page: 1 })} />
                )}
                <SortMenu
                  value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
                  onChange={(next) => mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })}
                  defaultValue={{ sortBy: 'assigned', sortDir: 'desc' }}
                  options={SORT_MENU_OPTIONS}
                />
              </div>
            </div>
          }
          desktopInlineFilters={null}
          sheetFilterBody={
            <div className="relative">
              {(sortByFromLoader !== 'assigned' || sortDirFromLoader !== 'desc') && (
                <FilterDismiss
                  onClear={() =>
                    mergeListParams({ sortBy: 'assigned', sortDir: 'desc', page: 1 })
                  }
                />
              )}
              <SortMenu
                value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
                onChange={(next) =>
                  mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
                }
                defaultValue={{ sortBy: 'assigned', sortDir: 'desc' }}
                options={SORT_MENU_OPTIONS}
                className="w-full justify-center"
              />
            </div>
          }
        />

        {totalCount > 0 && (q || sortByFromLoader !== 'assigned' || sortDirFromLoader !== 'desc') && (
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
            {viewType === 'company' ? (
            <CompactTable
              columns={providerColumns}
              rows={providers}
              rowKey={(p) => p.providerId}
              className="md:min-w-[1100px]"
              renderMobileCard={(p) => (
                <button
                  type="button"
                  onClick={() => setPeekProvider(p)}
                  className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
                >
                  {/* Row 1: name + delivery rate */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-app-fg">{p.providerName}</span>
                    <span className={`shrink-0 text-xs font-bold tabular-nums ${deliveryRateColorClass(p.deliveryRate)}`}>
                      {p.totalAssigned > 0 ? `${Math.round(p.deliveryRate)}% DR` : '0%'}
                    </span>
                  </div>
                  {/* Row 2: assigned + delivered + units + locations */}
                  <div className="flex items-center gap-3 text-xs text-app-fg-muted tabular-nums">
                    <span>{p.totalAssigned} assigned</span>
                    <span>{p.delivered} delivered</span>
                    <span>{p.unitsDelivered.toLocaleString()} units</span>
                    <span>{p.locationCount} loc.</span>
                  </div>
                </button>
              )}
            />
            ) : (
            <CompactTable
              columns={locationColumns}
              rows={filteredLocations}
              rowKey={(l) => l.locationId}
              className="md:min-w-[900px]"
              renderMobileCard={(l) => (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-app-fg">{l.locationName}</span>
                    <span className={`shrink-0 text-xs font-bold tabular-nums ${l.availableStock === 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                      {l.availableStock.toLocaleString()} avail.
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-app-fg-muted tabular-nums">
                    <span>{l.providerName}</span>
                    <span>{l.totalAssigned} assigned</span>
                    <span>{l.delivered} delivered</span>
                  </div>
                </div>
              )}
            />
            )}

            {totalPages > 1 && (
              <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-sm text-app-fg-muted">
                  {totalCount > 0 && limit
                    ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, totalCount)} of ${totalCount} providers`
                    : totalCount > 0
                      ? `Showing ${providers.length} of ${totalCount} providers`
                      : 'No providers'}
                </p>
                <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} pageSizeParam="perPage" />
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile peek modal */}
      <Modal
        open={!!peekProvider}
        onClose={() => setPeekProvider(null)}
        maxWidth="max-w-sm"
        contentClassName="p-5"
      >
        {peekProvider && (() => {
          const p = peekProvider;
          return (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-app-fg">{p.providerName}</p>
                <p className="text-xs text-app-fg-muted">{p.locationCount} location{p.locationCount === 1 ? '' : 's'}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Assigned</span>
                  <span className="font-medium tabular-nums">{p.totalAssigned}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Delivered</span>
                  <DualValue
                    className="font-medium"
                    left={<span>{p.delivered.toLocaleString()}</span>}
                    right={<span className={deliveryRateColorClass(p.deliveryRate)}>{p.totalAssigned > 0 ? `${Math.round(p.deliveryRate)}%` : '0%'}</span>}
                  />
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Units delivered</span>
                  <span className="font-medium tabular-nums">{p.unitsDelivered.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Delinquency</span>
                  <DualValue
                    className="font-medium"
                    left={<span>{(p.returned + p.partiallyDelivered + p.writtenOff).toLocaleString()}</span>}
                    right={<span className={delinquencyRateColorClass(p.delinquencyRate)}>{p.totalAssigned > 0 ? `${Math.round(p.delinquencyRate)}%` : '0%'}</span>}
                  />
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Remitted</span>
                  {Number(p.pendingRemittanceAmount) > 0 ? (
                    <DualValue
                      className="font-medium"
                      left={<span className="text-success-600 dark:text-success-400"><NairaPrice amount={p.remittedAmount} /></span>}
                      right={<span className="text-warning-600 dark:text-warning-400"><NairaPrice amount={p.pendingRemittanceAmount} /></span>}
                    />
                  ) : (
                    <span className="font-medium tabular-nums text-success-600 dark:text-success-400"><NairaPrice amount={p.remittedAmount} /></span>
                  )}
                </div>
              </div>
              <div className="pt-1 border-t border-app-border">
                <Link
                  to={`/admin/logistics/team/${p.providerId}${listQuerySuffix}`}
                  prefetch="intent"
                  className="btn-primary btn-sm inline-flex w-full items-center justify-center"
                  onClick={() => setPeekProvider(null)}
                >
                  View details
                </Link>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Stock Reconciliation Report Modal */}
      {reportProvider && (() => {
        const p = reportProvider;
        const c = checkProviderConsistency(p);
        const dateStr = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const activeProductName = activeProductId ? productOptions.find((pr) => pr.id === activeProductId)?.name : undefined;
        const reportFilters = { productName: activeProductName, startDate: dateFilters.startDate || undefined, endDate: dateFilters.endDate || undefined, periodAllTime: dateFilters.periodAllTime };
        const subtitleParts = [
          `${p.providerName}: ${p.locationCount} location${p.locationCount === 1 ? '' : 's'}`,
          ...(activeProductName ? [`Product: ${activeProductName}`] : []),
          ...(dateFilters.periodAllTime ? ['All time'] : dateFilters.startDate && dateFilters.endDate ? [`${dateFilters.startDate} to ${dateFilters.endDate}`] : []),
        ];
        return (
        <Modal open onClose={() => { setReportProvider(null); setReportView('summary'); }} contentClassName="p-0 flex flex-col" maxWidth="max-w-md">
          <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3 shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-app-fg">Stock Reconciliation Report</h2>
              <p className="text-xs text-app-fg-muted mt-0.5">{subtitleParts.join(' · ')}</p>
            </div>
            <button type="button" onClick={() => { setReportProvider(null); setReportView('summary'); }} className="text-app-fg-muted hover:text-app-fg mt-0.5"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg></button>
          </div>
          <div className="px-5 pt-3 pb-1 shrink-0">
            <FilterPills value={reportView} onChange={(v) => setReportView(v as 'summary' | 'breakdown')} options={[{ value: 'summary', label: 'Summary' }, { value: 'breakdown', label: 'Breakdown' }]} />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">
            {reportView === 'summary' ? (
              <pre className="text-xs font-mono bg-app-hover/40 rounded-lg p-5 whitespace-pre-wrap text-app-fg leading-relaxed">{generateProviderReport(p, reportFilters)}</pre>
            ) : (
              <div className="space-y-5">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Stock Flow</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Received</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{(p.stockReceived + p.stockAdjusted).toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Sold (Delivered)</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums text-brand-600 dark:text-brand-400">{p.stockSold.toLocaleString()}</td></tr>
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Transferred Out</td><td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${p.stockTransferredOut > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{p.stockTransferredOut > 0 ? '−' : ''}{p.stockTransferredOut.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Reserved</td><td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${(p.reservedStock ?? 0) > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{(p.reservedStock ?? 0).toLocaleString()}</td></tr>
                  </tbody></table></div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Balance</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Expected Available</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{c.expected.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Actual Available</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{p.availableStock.toLocaleString()}</td></tr>
                    {!c.isConsistent && <tr className="bg-danger-50 dark:bg-danger-900/10"><td className="px-4 py-2.5 text-danger-700 dark:text-danger-400 font-medium">Discrepancy</td><td className="px-4 py-2.5 text-right font-bold text-danger-700 dark:text-danger-400 tabular-nums">{c.diff > 0 ? '+' : ''}{c.diff.toLocaleString()}</td></tr>}
                  </tbody></table></div>
                  <div className={`flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm ${c.isConsistent ? 'bg-success-50 dark:bg-success-900/10 text-success-800 dark:text-success-300' : 'bg-danger-50 dark:bg-danger-900/10 text-danger-800 dark:text-danger-300'}`}>
                    <span className="text-base mt-0.5">{c.isConsistent ? '✓' : '✗'}</span>
                    <div>
                      {c.isConsistent ? <p>All stock is accounted for.</p> : <><p><strong>{Math.abs(c.diff).toLocaleString()}</strong> {c.diff > 0 ? 'more' : 'fewer'} units than expected.</p><Link to={`/admin/logistics/team/${p.providerId}`} className="mt-1.5 inline-block text-brand-600 dark:text-brand-400 text-xs font-medium hover:underline">View full reconciliation →</Link></>}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Order Performance</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Total Assigned</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{p.totalAssigned.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Delivered</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{p.delivered.toLocaleString()}</td></tr>
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Units Delivered</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{p.unitsDelivered.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Delivery Rate</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{p.totalAssigned > 0 ? `${Math.round(p.deliveryRate)}%` : '0%'}</td></tr>
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Returned</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg-muted tabular-nums">{p.returned.toLocaleString()}</td></tr>
                  </tbody></table></div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Remittance</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Remitted</td><td className="px-4 py-2.5 text-right font-semibold text-success-600 dark:text-success-400 tabular-nums">{formatNaira(p.remittedAmount)}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Pending</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums"><span className={Number(p.pendingRemittanceAmount) > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg-muted'}>{formatNaira(p.pendingRemittanceAmount)}</span></td></tr>
                    {Number(p.disputedRemittanceAmount) > 0 && <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Disputed</td><td className="px-4 py-2.5 text-right font-semibold text-danger-600 dark:text-danger-400 tabular-nums">{formatNaira(p.disputedRemittanceAmount)}</td></tr>}
                  </tbody></table></div>
                </div>
              </div>
            )}
          </div>
          <div className="px-5 py-4 border-t border-app-border flex justify-end gap-2 shrink-0">
            <Button type="button" variant="secondary" onClick={() => { setReportProvider(null); setReportView('summary'); }}>Close</Button>
            <Button type="button" variant="primary" onClick={() => { const safeName = p.providerName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-'); downloadReport(`stock-report-${safeName}-${new Date().toISOString().slice(0, 10)}.txt`, generateProviderReport(p)); }}>Download report</Button>
          </div>
        </Modal>
        );
      })()}

      {/* Location Report Modal */}
      {reportLocation && (() => {
        const l = reportLocation;
        const expected = l.stockReceived - l.stockSold - l.stockTransferredOut + l.stockAdjusted - l.stockWrittenOff - (l.reservedStock ?? 0);
        const diff = l.availableStock - expected;
        const isConsistent = diff === 0;
        const activeProductName = activeProductId ? productOptions.find((pr) => pr.id === activeProductId)?.name : undefined;
        const subtitleParts = [
          `${l.locationName} · ${l.providerName}`,
          ...(activeProductName ? [`Product: ${activeProductName}`] : []),
          ...(dateFilters.periodAllTime ? ['All time'] : dateFilters.startDate && dateFilters.endDate ? [`${dateFilters.startDate} to ${dateFilters.endDate}`] : []),
        ];
        const buildLocationReport = () => {
          const lines: string[] = [];
          lines.push('STOCK RECONCILIATION REPORT');
          lines.push('==========================');
          lines.push(`Location: ${l.locationName}`);
          lines.push(`Provider: ${l.providerName}`);
          if (activeProductName) lines.push(`Product: ${activeProductName}`);
          if (dateFilters.periodAllTime) lines.push('Period: All time');
          else if (dateFilters.startDate && dateFilters.endDate) lines.push(`Period: ${dateFilters.startDate} to ${dateFilters.endDate}`);
          lines.push(`Generated: ${new Date().toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })}`);
          lines.push('');
          lines.push('STOCK FLOW');
          lines.push('----------');
          lines.push(`Received:            ${(l.stockReceived + l.stockAdjusted).toLocaleString()} units`);
          lines.push(`Sold (Delivered):    ${l.stockSold.toLocaleString()} units`);
          lines.push(`Transferred Out:     ${l.stockTransferredOut > 0 ? '−' : ''}${l.stockTransferredOut.toLocaleString()} units`);
          lines.push(`Reserved:            ${(l.reservedStock ?? 0).toLocaleString()} units`);
          lines.push('');
          lines.push('BALANCE');
          lines.push('-------');
          lines.push(`Expected Available:  ${expected.toLocaleString()} units`);
          lines.push(`Actual Available:    ${l.availableStock.toLocaleString()} units`);
          lines.push(`Status:              ${isConsistent ? '✓ CONSISTENT' : `✗ INCONSISTENT (${diff > 0 ? '+' : ''}${diff.toLocaleString()} units)`}`);
          lines.push('');
          lines.push('ORDER PERFORMANCE');
          lines.push('-----------------');
          lines.push(`Total Assigned:      ${l.totalAssigned.toLocaleString()} orders`);
          lines.push(`Delivered:           ${l.delivered.toLocaleString()} orders`);
          lines.push(`Units Delivered:     ${l.unitsDelivered.toLocaleString()} units`);
          lines.push(`Delivery Rate:       ${l.totalAssigned > 0 ? `${Math.round(l.deliveryRate)}%` : '—'}`);
          lines.push('');
          lines.push('REMITTANCE');
          lines.push('----------');
          lines.push(`Remitted:            ${formatNaira(l.remittedAmount)}`);
          lines.push(`Pending:             ${formatNaira(l.pendingRemittanceAmount)}`);
          lines.push('');
          lines.push('--- End of Report ---');
          return lines.join('\n');
        };
        return (
        <Modal open onClose={() => { setReportLocation(null); setReportView('summary'); }} contentClassName="p-0 flex flex-col" maxWidth="max-w-md">
          <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3 shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-app-fg">Stock Reconciliation Report</h2>
              <p className="text-xs text-app-fg-muted mt-0.5">{subtitleParts.join(' · ')}</p>
            </div>
            <button type="button" onClick={() => { setReportLocation(null); setReportView('summary'); }} className="text-app-fg-muted hover:text-app-fg mt-0.5"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg></button>
          </div>
          <div className="px-5 pt-3 pb-1 shrink-0">
            <FilterPills value={reportView} onChange={(v) => setReportView(v as 'summary' | 'breakdown')} options={[{ value: 'summary', label: 'Summary' }, { value: 'breakdown', label: 'Breakdown' }]} />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">
            {reportView === 'summary' ? (
              <pre className="text-xs font-mono bg-app-hover/40 rounded-lg p-5 whitespace-pre-wrap text-app-fg leading-relaxed">{buildLocationReport()}</pre>
            ) : (
              <div className="space-y-5">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Stock Flow</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Received</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{(l.stockReceived + l.stockAdjusted).toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Sold (Delivered)</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums text-brand-600 dark:text-brand-400">{l.stockSold.toLocaleString()}</td></tr>
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Transferred Out</td><td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${l.stockTransferredOut > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{l.stockTransferredOut > 0 ? '−' : ''}{l.stockTransferredOut.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Reserved</td><td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${(l.reservedStock ?? 0) > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>{(l.reservedStock ?? 0).toLocaleString()}</td></tr>
                  </tbody></table></div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Balance</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Expected Available</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{expected.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Actual Available</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{l.availableStock.toLocaleString()}</td></tr>
                    {!isConsistent && <tr className="bg-danger-50 dark:bg-danger-900/10"><td className="px-4 py-2.5 text-danger-700 dark:text-danger-400 font-medium">Discrepancy</td><td className="px-4 py-2.5 text-right font-bold text-danger-700 dark:text-danger-400 tabular-nums">{diff > 0 ? '+' : ''}{diff.toLocaleString()}</td></tr>}
                  </tbody></table></div>
                  <div className={`flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm ${isConsistent ? 'bg-success-50 dark:bg-success-900/10 text-success-800 dark:text-success-300' : 'bg-danger-50 dark:bg-danger-900/10 text-danger-800 dark:text-danger-300'}`}>
                    <span className="text-base mt-0.5">{isConsistent ? '✓' : '✗'}</span>
                    <p>{isConsistent ? 'All stock is accounted for.' : `${Math.abs(diff).toLocaleString()} ${diff > 0 ? 'more' : 'fewer'} units than expected.`}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Order Performance</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Total Assigned</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{l.totalAssigned.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Delivered</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{l.delivered.toLocaleString()}</td></tr>
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Units Delivered</td><td className="px-4 py-2.5 text-right font-semibold text-app-fg tabular-nums">{l.unitsDelivered.toLocaleString()}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Delivery Rate</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{l.totalAssigned > 0 ? `${Math.round(l.deliveryRate)}%` : '—'}</td></tr>
                  </tbody></table></div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">Remittance</h3>
                  <div className="rounded-lg border border-app-border overflow-hidden"><table className="w-full text-sm"><tbody className="divide-y divide-app-border">
                    <tr className="bg-app-hover/50"><td className="px-4 py-2.5 text-app-fg-muted">Remitted</td><td className="px-4 py-2.5 text-right font-semibold text-success-600 dark:text-success-400 tabular-nums">{formatNaira(l.remittedAmount)}</td></tr>
                    <tr><td className="px-4 py-2.5 text-app-fg-muted">Pending</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums"><span className={Number(l.pendingRemittanceAmount) > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg-muted'}>{formatNaira(l.pendingRemittanceAmount)}</span></td></tr>
                  </tbody></table></div>
                </div>
              </div>
            )}
          </div>
          <div className="px-5 py-4 border-t border-app-border flex justify-end gap-2 shrink-0">
            <Button type="button" variant="secondary" onClick={() => { setReportLocation(null); setReportView('summary'); }}>Close</Button>
            <Button type="button" variant="primary" onClick={() => { const safeName = l.locationName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-'); downloadReport(`stock-report-${safeName}-${new Date().toISOString().slice(0, 10)}.txt`, buildLocationReport()); }}>Download report</Button>
          </div>
        </Modal>
        );
      })()}

      {/* Aggregate Logistics Report Modal */}
      {showAggregateReport && (() => {
        const activeProductName = activeProductId ? productOptions.find((pr) => pr.id === activeProductId)?.name : undefined;
        const reportFilters = { productName: activeProductName, startDate: dateFilters.startDate || undefined, endDate: dateFilters.endDate || undefined, periodAllTime: dateFilters.periodAllTime };
        const buildReportText = () => {
          const lines: string[] = [];
          lines.push('LOGISTICS ANALYSIS REPORT');
          lines.push('========================');
          lines.push(`View: ${viewType === 'company' ? 'By Company' : 'By Location'}`);
          if (reportFilters.productName) lines.push(`Product: ${reportFilters.productName}`);
          if (reportFilters.periodAllTime) lines.push('Period: All time');
          else if (reportFilters.startDate && reportFilters.endDate) lines.push(`Period: ${reportFilters.startDate} to ${reportFilters.endDate}`);
          lines.push(`Generated: ${new Date().toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' })}`);
          lines.push('');
          if (viewType === 'company') {
            lines.push(`Providers: ${providers.length}`);
            lines.push('');
            for (const p of providers) {
              lines.push(generateProviderReport(p, reportFilters));
              lines.push('');
            }
          } else {
            lines.push(`Locations: ${filteredLocations.length}`);
            lines.push('');
            for (const l of filteredLocations) {
              const expected = l.stockReceived - l.stockSold - l.stockTransferredOut + l.stockAdjusted - l.stockWrittenOff - (l.reservedStock ?? 0);
              const diff = l.availableStock - expected;
              lines.push(`${l.locationName} (${l.providerName})`);
              lines.push(`  Received: ${l.stockReceived.toLocaleString()} | Sold: ${l.stockSold.toLocaleString()} | Transferred: ${l.stockTransferredOut.toLocaleString()}`);
              lines.push(`  Available: ${l.availableStock.toLocaleString()} | Expected: ${expected.toLocaleString()} | ${diff === 0 ? '✓ Balanced' : `✗ ${diff > 0 ? '+' : ''}${diff.toLocaleString()} off`}`);
              lines.push(`  Assigned: ${l.totalAssigned} | Delivered: ${l.delivered} | Remitted: ${formatNaira(l.remittedAmount)}`);
              lines.push('');
            }
          }
          return lines.join('\n');
        };
        const subtitleParts = [
          viewType === 'company' ? `${providers.length} providers` : `${filteredLocations.length} locations`,
          ...(activeProductName ? [`Product: ${activeProductName}`] : []),
          ...(dateFilters.periodAllTime ? ['All time'] : dateFilters.startDate && dateFilters.endDate ? [`${dateFilters.startDate} to ${dateFilters.endDate}`] : []),
        ];
        return (
          <Modal open onClose={() => setShowAggregateReport(false)} contentClassName="p-0 flex flex-col" maxWidth="max-w-md">
            <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3 shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-app-fg">Logistics Analysis Report</h2>
                <p className="text-xs text-app-fg-muted mt-0.5">{subtitleParts.join(' · ')}</p>
              </div>
              <button type="button" onClick={() => setShowAggregateReport(false)} className="text-app-fg-muted hover:text-app-fg mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">
              <pre className="text-xs font-mono bg-app-hover/40 rounded-lg p-5 whitespace-pre-wrap text-app-fg leading-relaxed">{buildReportText()}</pre>
            </div>
            <div className="px-5 py-4 border-t border-app-border flex justify-end gap-2 shrink-0">
              <Button type="button" variant="secondary" onClick={() => setShowAggregateReport(false)}>Close</Button>
              <Button type="button" variant="primary" onClick={() => {
                const safeName = viewType === 'company' ? 'by-company' : 'by-location';
                downloadReport(`logistics-report-${safeName}-${new Date().toISOString().slice(0, 10)}.txt`, buildReportText());
              }}>Download report</Button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
