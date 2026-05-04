import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
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
import { OrdersChartView } from '~/components/ui/orders-chart-view';
import { ExportModal, type ExportModalPicklists } from '~/components/ui/export-modal';
import { STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import type { Order } from '~/features/orders/types';

interface MarketingOrdersPageProps {
  orders: Order[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  statusCounts: Record<string, number>;
  statusFilter?: string;
  searchFilter?: string;
  isMediaBuyer: boolean;
  /** Show Media buyer column (HoM and SuperAdmin only). */
  showMediaBuyerColumn?: boolean;
  /** For "Filter by media buyer" (HoM / Admin / SuperAdmin). */
  mediaBuyersForFilter?: Array<{ id: string; name: string }>;
  marketingExportPicklists?: Partial<ExportModalPicklists>;
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
  /** CPA (Cost Per Acquisition) = Total Ad Spend / Total Orders — from marketing.metrics for current date range. */
  cpa?: number | null;
  /** Total approved ad spend in the period — from marketing.metrics. */
  totalAdSpend?: number | null;
  /** Daily order count series for the "Orders over time" chart (from `orders.timeSeriesByCreated`). */
  dailyCounts?: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
}

export function MarketingOrdersPage({
  orders,
  total,
  totalPages,
  page,
  limit: _limit,
  statusCounts,
  statusFilter,
  searchFilter,
  isMediaBuyer,
  showMediaBuyerColumn = false,
  mediaBuyersForFilter = [],
  marketingExportPicklists,
  filters,
  liveEvents,
  cpa,
  totalAdSpend: _totalAdSpend,
  dailyCounts,
}: MarketingOrdersPageProps) {
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const safeTotalPages = Math.max(1, totalPages);
  const liveState = useLiveIndicator(liveEvents ?? []);
  const [searchParams, setSearchParams] = useSearchParams();
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

  const mediaBuyerFilterOptions = useMemo(
    () => [
      { value: 'ALL', label: 'All media buyers' },
      ...mediaBuyersForFilter.map((b) => ({ value: b.id, label: b.name })),
    ],
    [mediaBuyersForFilter],
  );

  const ordersInPeriodTotal = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
  const unprocessedCount = statusCounts['UNPROCESSED'] ?? 0;
  const confirmedCount = statusCounts['CONFIRMED'] ?? 0;
  const deliveredCount = statusCounts['DELIVERED'] ?? 0;
  const deliveryRate = total > 0 ? ((statusCounts['DELIVERED'] ?? 0) / total * 100).toFixed(1) : '0';

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    setSearchParams(buildQueryString({ status, page: 1 }));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(buildQueryString({ search: searchQuery.trim(), page: 1 }));
  };

  const statusOptions = STATUS_OPTIONS.map((status) => ({
    value: status,
    label: status === 'ALL'
      ? `All Statuses (${ordersInPeriodTotal})`
      : `${formatStatus(status)} (${statusCounts[status] ?? 0})`,
  }));

  const ordersToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (selectedStatus !== 'ALL') n += 1;
    const mb = searchParams.get('mediaBuyerId') || 'ALL';
    if (showMediaBuyerColumn && mediaBuyersForFilter.length > 0 && mb !== 'ALL') n += 1;
    return n;
  }, [selectedStatus, showMediaBuyerColumn, mediaBuyersForFilter.length, searchParams]);

  const marketingOrderColumns: CompactTableColumn<Order>[] = useMemo(() => {
    const cols: CompactTableColumn<Order>[] = [
      {
        key: 'id',
        header: 'Order ID',
        render: (order) => <OrderIdBadge id={order.id} linkTo={`/admin/orders/${order.id}`} />,
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (order) => <span className="font-medium text-app-fg">{order.customerName}</span>,
      },
    ];
    if (showMediaBuyerColumn) {
      cols.push({
        key: 'mediaBuyer',
        header: 'Media buyer',
        render: (order) =>
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
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (order) => (
          <span className="font-medium">
            <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (order) => <OrderStatusBadge status={order.status} />,
      },
      {
        key: 'created',
        header: 'Created',
        nowrap: true,
        render: (order) => (
          <span className="text-app-fg-muted">
            {new Date(order.createdAt).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'center',
        tight: true,
        render: (order) => <CompactTableActionButton to={`/admin/orders/${order.id}`}>View</CompactTableActionButton>,
      },
    );
    return cols;
  }, [showMediaBuyerColumn]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={isMediaBuyer ? 'My Orders' : 'Marketing Orders'}
        description={
          isMediaBuyer
            ? 'Track your campaign orders and conversion funnel'
            : 'View orders across all media buyers'
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
                <Button onClick={() => setShowExportModal(true)} variant="secondary" size="sm">
                  Generate report
                </Button>
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
              </>
            )}
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Total', value: total, valueClassName: 'text-app-fg' },
          { label: 'Unprocessed', value: unprocessedCount, valueClassName: 'text-warning-600 dark:text-warning-400' },
          { label: 'Confirmed', value: confirmedCount, valueClassName: 'text-brand-600 dark:text-brand-400' },
          { label: 'Delivered', value: deliveredCount, valueClassName: 'text-success-600 dark:text-success-400' },
          { label: 'Delivery Rate', value: <>{deliveryRate}%</>, valueClassName: 'text-app-fg' },
          {
            label: 'CPA',
            value: cpa != null ? <>{'\u20A6'}{Number(cpa).toLocaleString(undefined, { maximumFractionDigits: 0 })}</> : '\u2014',
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
              wrapperClassName="min-w-0 flex-1"
            />
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
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
            {showMediaBuyerColumn && mediaBuyersForFilter.length > 0 ? (
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
            {showMediaBuyerColumn && mediaBuyersForFilter.length > 0 ? (
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
          </>
        }
      />

      {showChartView ? (
        <OrdersChartView
          statusCounts={statusCounts}
          total={ordersInPeriodTotal}
          scopeLabel="Marketing orders"
          dailyCounts={dailyCounts}
        />
      ) : (
      <div className="card p-0 scroll-mt-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border">
          <h2 className="text-lg font-semibold text-app-fg">Orders ({total})</h2>
        </div>
        <CompactTable<Order>
          withCard={false}
          columns={marketingOrderColumns}
          rows={orders}
          rowKey={(order) => order.id}
          emptyTitle="No orders match your filters"
          emptyDescription="Try adjusting your status filter or search query"
          pagination={
            safeTotalPages > 1
              ? {
                  page,
                  totalPages: safeTotalPages,
                  pageParam: 'page',
                  wrapperClassName: 'border-t border-app-border px-4 py-3 flex justify-center',
                }
              : undefined
          }
        />
      </div>
      )}

      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.marketing_orders}
        picklists={marketingExportPicklists}
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
    </div>
  );
}
