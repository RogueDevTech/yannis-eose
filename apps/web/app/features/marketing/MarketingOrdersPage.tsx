import { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { Await, Link, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { formatOrderTimestamp } from '~/lib/format-date';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { useLiveIndicator } from '~/hooks/useSocket';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { Pagination } from '~/components/ui/pagination';
import { OrdersChartView } from '~/components/ui/orders-chart-view-lazy';
import { ExportModal, type ExportModalPicklists } from '~/components/ui/export-modal';
import { STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import type { Order } from '~/features/orders/types';
import { orderDetailHref } from '~/lib/order-detail-return';
import { DeferredError } from '~/components/ui/deferred-section';
import {
  OrdersChartViewShellSkeleton,
  StatValuePulse,
  TableCellTextPulse,
} from '~/components/ui/deferred-skeletons';

const DEFERRED_PLACEHOLDER_ROW_COUNT = 10;
const DEFERRED_PLACEHOLDER_ROWS: Order[] = Array.from(
  { length: DEFERRED_PLACEHOLDER_ROW_COUNT },
  (_, i) => ({
    id: `__marketing_orders_deferred_${i}`,
    customerName: '',
    customerPhoneDisplay: '',
    status: 'UNPROCESSED',
    totalAmount: null,
    createdAt: '1970-01-01T00:00:00.000Z',
    assignedCsId: null,
  }),
);

/** Status dropdown labels before streamed counts hydrate (same order as full options). */
const MARKETING_ORDERS_STATUS_OPTIONS_BASE = STATUS_OPTIONS.map((status) => ({
  value: status,
  label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
}));

/** Streamed after `orders.list`: counts, metrics, chart series, export picklists + buyer filter options. */
export type MarketingOrdersSecondaryPayload = {
  statusCounts: Record<string, number>;
  cpa: number | null;
  totalAdSpend: number | null;
  dailyCounts: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
  marketingExportPicklists?: Partial<ExportModalPicklists>;
  mediaBuyersForFilter: Array<{ id: string; name: string }>;
  /** Always populated — Media Buyers + HoM/admin filter by Product on this table. */
  productsForFilter: Array<{ id: string; name: string }>;
  /** Always populated — Form (campaign) filter so a Media Buyer can isolate a single funnel. */
  campaignsForFilter: Array<{ id: string; name: string }>;
};

interface MarketingOrdersPageProps {
  orders: Order[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  secondary: Promise<MarketingOrdersSecondaryPayload>;
  statusFilter?: string;
  searchFilter?: string;
  isMediaBuyer: boolean;
  /** Show Media buyer column (HoM and SuperAdmin only). */
  showMediaBuyerColumn?: boolean;
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
  /**
   * When false (default), the Generate report button is hidden. Server still
   * enforces `orders.export` on the actual download.
   */
  canExport?: boolean;
  /**
   * When true, the page renders its real chrome but swaps row data + pagination
   * for pulse skeletons — used as the route-level Suspense fallback so the layout
   * stays mounted while the orders list streams in.
   */
  deferredLoading?: boolean;
}

export function MarketingOrdersPage({
  orders,
  total,
  totalPages,
  page,
  limit,
  secondary,
  statusFilter,
  searchFilter,
  isMediaBuyer,
  showMediaBuyerColumn = false,
  filters,
  liveEvents,
  canExport = false,
  deferredLoading = false,
}: MarketingOrdersPageProps) {
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const { busy: isLoaderRefetchBusy, primeSamePathRefetch } = useLoaderRefetchBusy();
  // Treat both the initial Suspense fallback AND any same-path loader refetch
  // (filter / pagination / status change) as "loading" — the table swaps to
  // skeleton rows in both cases instead of dimming with the overlay spinner.
  const showSkeletonRows = deferredLoading || isLoaderRefetchBusy;
  const liveState = useLiveIndicator(liveEvents ?? []);
  const [searchParams, remixSetSearchParams] = useSearchParams();
  const setSearchParams = useCallback(
    (...args: Parameters<typeof remixSetSearchParams>) => {
      primeSamePathRefetch();
      remixSetSearchParams(...args);
    },
    [remixSetSearchParams, primeSamePathRefetch],
  );
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [showChartView, setShowChartView] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

  const buildQueryString = (overrides: { page?: number; status?: string; search?: string; mediaBuyerId?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.page !== undefined) params.set('page', String(overrides.page));
    // Always pass `status` when changing the status filter (including ALL) so the URL stays in sync.
    if (overrides.status !== undefined) {
      if (overrides.status === 'ALL' || !overrides.status) params.delete('status');
      else params.set('status', overrides.status);
    }
    // Always pass `search` when submitting the search form (including empty to clear).
    if (overrides.search !== undefined) {
      if (overrides.search) params.set('search', overrides.search);
      else params.delete('search');
    }
    if (overrides.mediaBuyerId !== undefined) {
      if (overrides.mediaBuyerId && overrides.mediaBuyerId !== 'ALL') params.set('mediaBuyerId', overrides.mediaBuyerId);
      else params.delete('mediaBuyerId');
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    setSearchParams(buildQueryString({ status, page: 1 }));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(buildQueryString({ search: searchQuery.trim(), page: 1 }));
  };

  const ordersToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (selectedStatus !== 'ALL') n += 1;
    const mb = searchParams.get('mediaBuyerId') || 'ALL';
    if (showMediaBuyerColumn && mb !== 'ALL') n += 1;
    if ((searchParams.get('productId') || '').length > 0) n += 1;
    if ((searchParams.get('campaignId') || '').length > 0) n += 1;
    return n;
  }, [selectedStatus, showMediaBuyerColumn, searchParams]);

  const marketingOrderColumns: CompactTableColumn<Order>[] = useMemo(() => {
    const cols: CompactTableColumn<Order>[] = [
      {
        key: 'id',
        header: 'Order ID',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (order) => <OrderIdBadge id={order.id} linkTo={orderDetailHref('/admin/orders', order.id, 'marketing')} />,
      },
      {
        key: 'customer',
        header: 'Customer',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[9rem] max-w-[min(14rem,100%)]" />
          : (order) => <span className="font-medium text-app-fg">{order.customerName}</span>,
      },
    ];
    if (showMediaBuyerColumn) {
      cols.push({
        key: 'mediaBuyer',
        header: 'Media buyer',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (order) =>
              order.mediaBuyerId ? (
                <Link
                  to={`/hr/users/${order.mediaBuyerId}`}
                  className="text-brand-500 hover:text-brand-600 font-medium hover:underline"
                >
                  {order.mediaBuyerName ?? 'View user'}
                </Link>
              ) : (
                <span className="text-app-fg-muted">—</span>
              ),
      });
    }
    cols.push(
      {
        key: 'product',
        header: 'Product',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[10rem] max-w-[min(16rem,100%)]" />
          : (order) => {
              const name = order.primaryProductName?.trim();
              const extra =
                (order.itemCount ?? 0) > 1 ? ` · +${(order.itemCount ?? 0) - 1} more` : '';
              return name ? (
                <span className="text-sm text-app-fg truncate">
                  {name}
                  {extra ? <span className="text-app-fg-muted">{extra}</span> : null}
                </span>
              ) : (
                <span className="text-app-fg-muted">—</span>
              );
            },
      },
      {
        key: 'campaign',
        header: 'Form',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[8rem]" />
          : (order) => (
              <span className="text-sm text-app-fg-muted truncate">
                {order.campaignName?.trim() ? order.campaignName : '—'}
              </span>
            ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: showSkeletonRows
          ? () => (
              <span className="inline-flex w-full justify-start md:justify-end">
                <TableCellTextPulse className="w-[4.5rem]" />
              </span>
            )
          : (order) => (
              <span className="font-medium">
                <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
              </span>
            ),
      },
      {
        key: 'status',
        header: 'Status',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[5.5rem]" />
          : (order) => <OrderStatusBadge status={order.status} />,
      },
      {
        key: 'created',
        header: 'Created',
        nowrap: true,
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[9rem]" />
          : (order) => (
              <span className="text-app-fg-muted whitespace-nowrap">
                {formatOrderTimestamp(order.createdAt)}
              </span>
            ),
      },
      {
        key: 'actions',
        header: '',
        align: 'center',
        tight: true,
        mobileShowLabel: false,
        render: showSkeletonRows
          ? () => <CompactTableActionButton disabled>View</CompactTableActionButton>
          : (order) => (
              <CompactTableActionButton to={orderDetailHref('/admin/orders', order.id, 'marketing')}>View</CompactTableActionButton>
            ),
      },
    );
    return cols;
  }, [showMediaBuyerColumn, showSkeletonRows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={isMediaBuyer ? 'My Orders' : 'Marketing Orders'}
        mobileInlineActions
        description={
          isMediaBuyer
            ? 'Track your campaign orders.'
            : 'View orders by media buyer.'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Marketing orders tools"
            sheetSubtitle={<span>Date range, chart toggle, and export</span>}
            triggerAriaLabel="Orders toolbar and date range"
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
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowChartView((v) => !v)}
                >
                  {showChartView ? 'View as data' : 'View data in chart'}
                </Button>
                {canExport && (
                  <Suspense
                    fallback={
                      <Button type="button" variant="secondary" size="sm" disabled>
                        Generate report…
                      </Button>
                    }
                  >
                    <Await resolve={secondary}>
                      {() => (
                        <Button onClick={() => setShowExportModal(true)} variant="secondary" size="sm">
                          Generate report
                        </Button>
                      )}
                    </Await>
                  </Suspense>
                )}
                <PageRefreshButton />
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowChartView((v) => !v);
                  }}
                >
                  {showChartView ? 'View as data' : 'View data in chart'}
                </Button>
                {canExport && (
                  <Suspense
                    fallback={
                      <Button type="button" variant="secondary" size="sm" className="w-full justify-center" disabled>
                        Generate report…
                      </Button>
                    }
                  >
                    <Await resolve={secondary}>
                      {() => (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full justify-center"
                          onClick={() => {
                            closeSheet();
                            setShowExportModal(true);
                          }}
                        >
                          Generate report
                        </Button>
                      )}
                    </Await>
                  </Suspense>
                )}
              </>
            )}
          />
        }
      />

      <Suspense
        fallback={
          <>
            <OverviewStatStrip
              items={[
                { label: 'Total', value: total, valueClassName: 'text-app-fg' },
                { label: 'Unprocessed', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Confirmed', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Delivered', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Delivery Rate', value: <StatValuePulse className="min-w-[3rem]" /> },
                { label: 'CPA', value: <StatValuePulse className="min-w-[4rem]" /> },
              ]}
            />

            <ToolbarFiltersCollapsible
              badgeCount={ordersToolbarFilterBadge}
              sheetSubtitle={<span>Status and media buyer apply immediately</span>}
              searchRow={
                <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
                  <SearchInput
                    placeholder="Search by customer or order ID..."
                    value={searchQuery}
                    onChange={(val) => setSearchQuery(val)}
                    withSubmitButton
                    wrapperClassName="min-w-0 flex-1"
                  />
                </form>
              }
              desktopInlineFilters={
                <>
                  <FormSelect
                    value={selectedStatus}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={MARKETING_ORDERS_STATUS_OPTIONS_BASE}
                    wrapperClassName="w-auto min-w-[11rem]"
                  />
                  {showMediaBuyerColumn ? (
                    <div
                      className="h-9 w-full min-w-0 rounded-md border border-app-border bg-app-hover/90 animate-pulse sm:w-56"
                      aria-hidden
                    />
                  ) : null}
                </>
              }
              sheetFilterBody={
                <>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Status</span>
                    <FormSelect
                      value={selectedStatus}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      options={MARKETING_ORDERS_STATUS_OPTIONS_BASE}
                      wrapperClassName="w-full"
                    />
                  </div>
                  {showMediaBuyerColumn ? (
                    <div className="space-y-1.5">
                      <span className="text-xs font-medium text-app-fg-muted">Media buyer</span>
                      <div className="h-10 w-full rounded-md border border-app-border bg-app-hover/90 animate-pulse" aria-hidden />
                    </div>
                  ) : null}
                </>
              }
            />
          </>
        }
      >
        <Await resolve={secondary} errorElement={<DeferredError />}>
          {(ins) => {
            const mediaBuyerFilterOptions = [
              { value: 'ALL', label: 'All media buyers' },
              ...ins.mediaBuyersForFilter.map((b) => ({ value: b.id, label: b.name })),
            ];
            const statusCounts = ins.statusCounts;
            const ordersInPeriodTotal = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
            const unprocessedCount = statusCounts['UNPROCESSED'] ?? 0;
            const csAssignedCount = statusCounts['CS_ASSIGNED'] ?? 0;
            const unconfirmedCount = statusCounts['CS_ENGAGED'] ?? 0;
            // "Confirmed" rolls up the full post-confirmation in-flight pipeline
            // so this count matches the OrderStatusBadge default.
            const confirmedCount =
              (statusCounts['CONFIRMED'] ?? 0) +
              (statusCounts['AGENT_ASSIGNED'] ?? 0) +
              (statusCounts['DISPATCHED'] ?? 0) +
              (statusCounts['IN_TRANSIT'] ?? 0);
            const deliveredCount = statusCounts['DELIVERED'] ?? 0;
            const remittedCount = statusCounts['REMITTED'] ?? 0;
            const deliveryRate =
              total > 0 ? (((statusCounts['DELIVERED'] ?? 0) / total) * 100).toFixed(1) : '0';
            const statusOptions = STATUS_OPTIONS.map((status) => ({
              value: status,
              label:
                status === 'ALL'
                  ? `All Statuses (${ordersInPeriodTotal})`
                  : `${formatStatus(status)} (${statusCounts[status] ?? 0})`,
            }));

            return (
              <>
                <OverviewStatStrip
                  items={[
                    { label: 'Total', value: total, valueClassName: 'text-app-fg' },
                    {
                      label: 'Unassigned',
                      value: unprocessedCount,
                      valueClassName: 'text-warning-600 dark:text-warning-400',
                    },
                    {
                      label: 'Assigned',
                      value: csAssignedCount,
                      valueClassName: 'text-info-600 dark:text-info-400',
                    },
                    {
                      label: 'Unconfirmed',
                      value: unconfirmedCount,
                      valueClassName: 'text-cyan-600 dark:text-cyan-400',
                    },
                    {
                      label: 'Confirmed',
                      value: confirmedCount,
                      valueClassName: 'text-brand-600 dark:text-brand-400',
                    },
                    {
                      label: 'Delivered',
                      value: deliveredCount,
                      valueClassName: 'text-success-600 dark:text-success-400',
                    },
                    {
                      label: 'Cash Remitted',
                      value: remittedCount,
                      valueClassName: 'text-green-600 dark:text-green-400',
                    },
                    { label: 'Delivery Rate', value: <>{deliveryRate}%</>, valueClassName: 'text-app-fg' },
                    {
                      label: 'CPA',
                      value:
                        ins.cpa != null ? (
                          <>
                            {'\u20A6'}
                            {Number(ins.cpa).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </>
                        ) : (
                          '\u2014'
                        ),
                      valueClassName: 'text-app-fg',
                    },
                  ]}
                />

                <ToolbarFiltersCollapsible
                  badgeCount={ordersToolbarFilterBadge}
                  sheetSubtitle={<span>Status and media buyer apply immediately</span>}
                  searchRow={
                    <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
                      <SearchInput
                        placeholder="Search by customer or order ID..."
                        value={searchQuery}
                        onChange={(val) => setSearchQuery(val)}
                        withSubmitButton
                        wrapperClassName="min-w-0 flex-1"
                      />
                    </form>
                  }
                  desktopInlineFilters={
                    <>
                      <FormSelect
                        value={selectedStatus}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        options={statusOptions}
                        wrapperClassName="w-auto min-w-[11rem]"
                      />
                      {showMediaBuyerColumn && ins.mediaBuyersForFilter.length > 0 ? (
                        <SearchableSelect
                          id="marketing-orders-filter-buyer"
                          value={searchParams.get('mediaBuyerId') || 'ALL'}
                          onChange={(v) => {
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.set('page', '1');
                              if (v && v !== 'ALL') next.set('mediaBuyerId', v);
                              else next.delete('mediaBuyerId');
                              return next;
                            });
                          }}
                          options={mediaBuyerFilterOptions}
                          wrapperClassName="w-full min-w-0 sm:w-56"
                          placeholder="All media buyers"
                          searchPlaceholder="Search buyers…"
                        />
                      ) : null}
                      {ins.productsForFilter.length > 0 ? (
                        <SearchableSelect
                          id="marketing-orders-filter-product"
                          value={searchParams.get('productId') || 'ALL'}
                          onChange={(v) => {
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.set('page', '1');
                              if (v && v !== 'ALL') next.set('productId', v);
                              else next.delete('productId');
                              return next;
                            });
                          }}
                          options={[
                            { value: 'ALL', label: 'All products' },
                            ...ins.productsForFilter.map((p) => ({ value: p.id, label: p.name })),
                          ]}
                          wrapperClassName="w-full min-w-0 sm:w-48"
                          placeholder="All products"
                          searchPlaceholder="Search products…"
                        />
                      ) : null}
                      {ins.campaignsForFilter.length > 0 ? (
                        <SearchableSelect
                          id="marketing-orders-filter-form"
                          value={searchParams.get('campaignId') || 'ALL'}
                          onChange={(v) => {
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.set('page', '1');
                              if (v && v !== 'ALL') next.set('campaignId', v);
                              else next.delete('campaignId');
                              return next;
                            });
                          }}
                          options={[
                            { value: 'ALL', label: 'All forms' },
                            ...ins.campaignsForFilter.map((c) => ({ value: c.id, label: c.name })),
                          ]}
                          wrapperClassName="w-full min-w-0 sm:w-48"
                          placeholder="All forms"
                          searchPlaceholder="Search forms…"
                        />
                      ) : null}
                    </>
                  }
                  sheetFilterBody={
                    <>
                      <div className="space-y-1.5">
                        <span className="text-xs font-medium text-app-fg-muted">Status</span>
                        <FormSelect
                          value={selectedStatus}
                          onChange={(e) => handleStatusChange(e.target.value)}
                          options={statusOptions}
                          wrapperClassName="w-full"
                        />
                      </div>
                      {showMediaBuyerColumn && ins.mediaBuyersForFilter.length > 0 ? (
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-app-fg-muted">Media buyer</span>
                          <SearchableSelect
                            id="marketing-orders-filter-buyer-sheet"
                            value={searchParams.get('mediaBuyerId') || 'ALL'}
                            onChange={(v) => {
                              setSearchParams((p) => {
                                const next = new URLSearchParams(p);
                                next.set('page', '1');
                                if (v && v !== 'ALL') next.set('mediaBuyerId', v);
                                else next.delete('mediaBuyerId');
                                return next;
                              });
                            }}
                            options={mediaBuyerFilterOptions}
                            wrapperClassName="w-full"
                            placeholder="All media buyers"
                            searchPlaceholder="Search buyers…"
                          />
                        </div>
                      ) : null}
                      {ins.productsForFilter.length > 0 ? (
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-app-fg-muted">Product</span>
                          <SearchableSelect
                            id="marketing-orders-filter-product-sheet"
                            value={searchParams.get('productId') || 'ALL'}
                            onChange={(v) => {
                              setSearchParams((p) => {
                                const next = new URLSearchParams(p);
                                next.set('page', '1');
                                if (v && v !== 'ALL') next.set('productId', v);
                                else next.delete('productId');
                                return next;
                              });
                            }}
                            options={[
                              { value: 'ALL', label: 'All products' },
                              ...ins.productsForFilter.map((p) => ({ value: p.id, label: p.name })),
                            ]}
                            wrapperClassName="w-full"
                            placeholder="All products"
                            searchPlaceholder="Search products…"
                          />
                        </div>
                      ) : null}
                      {ins.campaignsForFilter.length > 0 ? (
                        <div className="space-y-1.5">
                          <span className="text-xs font-medium text-app-fg-muted">Form</span>
                          <SearchableSelect
                            id="marketing-orders-filter-form-sheet"
                            value={searchParams.get('campaignId') || 'ALL'}
                            onChange={(v) => {
                              setSearchParams((p) => {
                                const next = new URLSearchParams(p);
                                next.set('page', '1');
                                if (v && v !== 'ALL') next.set('campaignId', v);
                                else next.delete('campaignId');
                                return next;
                              });
                            }}
                            options={[
                              { value: 'ALL', label: 'All forms' },
                              ...ins.campaignsForFilter.map((c) => ({ value: c.id, label: c.name })),
                            ]}
                            wrapperClassName="w-full"
                            placeholder="All forms"
                            searchPlaceholder="Search forms…"
                          />
                        </div>
                      ) : null}
                    </>
                  }
                />
              </>
            );
          }}
        </Await>
      </Suspense>

      {showChartView ? (
        showSkeletonRows ? (
          <OrdersChartViewShellSkeleton />
        ) : (
          <Suspense fallback={<OrdersChartViewShellSkeleton />}>
            <Await resolve={secondary} errorElement={<DeferredError />}>
              {(ins) => {
                const ordersInPeriodTotal = Object.values(ins.statusCounts).reduce((sum, n) => sum + n, 0);
                return (
                  <OrdersChartView
                    statusCounts={ins.statusCounts}
                    total={ordersInPeriodTotal}
                    scopeLabel="Marketing orders"
                    dailyCounts={ins.dailyCounts}
                  />
                );
              }}
            </Await>
          </Suspense>
        )
      ) : (
      <>
      <div className="card scroll-mt-4 overflow-hidden p-0">
        <CompactTable<Order>
          withCard={false}
          columns={marketingOrderColumns}
          rows={showSkeletonRows ? DEFERRED_PLACEHOLDER_ROWS : orders}
          rowKey={(order) => order.id}
          emptyTitle="No orders match your filters"
          emptyDescription="Try adjusting your status filter or search query"
        />
      </div>
      {/* Pagination — same layout as CS Orders list; page size is fixed at 20 in the route loader.
          We deliberately gate the skeleton on `deferredLoading` (initial Suspense fallback) NOT
          `showSkeletonRows` (which also goes true on `isLoaderRefetchBusy`). Reason: the pointerdown
          handler in `useLoaderRefetchBusy` calls `flushSync(setArmed(true))` synchronously, which
          would re-render this section between the click's pointerdown and click events. If the real
          `<Pagination>` is replaced with non-interactive skeleton bars in that gap, the browser
          loses its click target and the navigation never fires — pagination clicks silently no-op.
          Keep Pagination mounted across refetches so click handlers stay alive. */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {deferredLoading ? (
          <>
            <p className="text-sm m-0 min-h-[1.25rem] flex items-center">
              <span
                className="inline-block h-4 w-52 max-w-[90vw] rounded-md bg-app-border/75 dark:bg-app-border/60 animate-pulse sm:w-72"
                aria-hidden
              />
            </p>
            <div className="flex items-center gap-2 shrink-0" aria-hidden>
              <span className="inline-block h-8 w-[4.5rem] rounded-lg bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
              <span className="inline-block h-8 w-28 rounded-lg bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
              <span className="inline-block h-8 w-[4.5rem] rounded-lg bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-app-fg-muted">
              {total > 0
                ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} orders`
                : 'No orders'}
            </p>
            <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} />
          </>
        )}
      </div>
      </>
      )}

      <Suspense fallback={null}>
        <Await resolve={secondary}>
          {(s) => (
            <ExportModal
              open={showExportModal}
              onClose={() => setShowExportModal(false)}
              config={EXPORT_CONFIGS.marketing_orders}
              picklists={s.marketingExportPicklists}
              initialFilters={{
                status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
                search: searchQuery || undefined,
                mediaBuyerId: searchParams.get('mediaBuyerId') || undefined,
                ...(dateFilters.periodAllTime
                  ? { periodAllTime: true as const }
                  : dateFilters.startDate && dateFilters.endDate
                    ? { startDate: dateFilters.startDate, endDate: dateFilters.endDate }
                    : {}),
              }}
            />
          )}
        </Await>
      </Suspense>
    </div>
  );
}
