import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { useLiveIndicator } from '~/hooks/useSocket';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { PageHeader } from '~/components/ui/page-header';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { Pagination } from '~/components/ui/pagination';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OrdersChartView } from '~/components/ui/orders-chart-view';
import { STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';
import { exportToCsv } from '~/lib/csv-export';
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
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
  /** CPA (Cost Per Acquisition) = Total Ad Spend / Total Orders — from marketing.metrics for current date range. */
  cpa?: number | null;
  /** Total approved ad spend in the period — from marketing.metrics. */
  totalAdSpend?: number | null;
  /** Daily order count series for the "Orders over time" chart (from `orders.timeSeriesByCreated`). */
  dailyCounts?: Array<{ date: string; orderCount: number }>;
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
  filters,
  liveEvents,
  cpa,
  totalAdSpend: _totalAdSpend,
  dailyCounts,
}: MarketingOrdersPageProps) {
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const liveState = useLiveIndicator(liveEvents ?? []);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [showChartView, setShowChartView] = useState(false);

  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

  const buildQueryString = (overrides: { page?: number; status?: string; search?: string }) => {
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
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  };

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
          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              onClick={() =>
                exportToCsv(
                  orders.map((o) => ({
                    id: o.id,
                    customer: o.customerName,
                    ...(showMediaBuyerColumn && { mediaBuyer: o.mediaBuyerName ?? '—' }),
                    status: o.status,
                    amount: o.totalAmount ?? '',
                    created: new Date(o.createdAt).toLocaleDateString(),
                  })),
                  [
                    { key: 'id', label: 'Order ID' },
                    { key: 'customer', label: 'Customer' },
                    ...(showMediaBuyerColumn ? [{ key: 'mediaBuyer', label: 'Media Buyer' }] : []),
                    { key: 'status', label: 'Status' },
                    { key: 'amount', label: 'Amount' },
                    { key: 'created', label: 'Created' },
                  ],
                  `marketing-orders-${new Date().toISOString().split('T')[0]}.csv`,
                )
              }
              variant="secondary"
              size="sm"
            >
              Export CSV
            </Button>
          </div>
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

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-stretch sm:items-center">
        <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1 min-w-0">
          <SearchInput
            placeholder="Search by customer or order ID..."
            value={searchQuery}
            onChange={(val) => setSearchQuery(val)}
            wrapperClassName="flex-1 min-w-0"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <FormSelect
          value={selectedStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          options={statusOptions}
          wrapperClassName="w-auto min-w-[11rem]"
        />
      </div>

      {showChartView ? (
        <OrdersChartView
          statusCounts={statusCounts}
          total={ordersInPeriodTotal}
          scopeLabel="Marketing orders"
          dailyCounts={dailyCounts}
        />
      ) : (
      <div className="card p-0 overflow-hidden scroll-mt-4">
        <div className="px-4 py-3 border-b border-app-border">
          <h2 className="text-lg font-semibold text-app-fg">Orders ({total})</h2>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                {showMediaBuyerColumn && <th className="table-header">Media buyer</th>}
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Status</th>
                <th className="table-header">Created</th>
                <th className="table-header text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="table-row">
                  <td className="table-cell">
                    <OrderIdBadge id={order.id} linkTo={`/admin/orders/${order.id}`} />
                  </td>
                  <td className="table-cell font-medium text-app-fg">
                    {order.customerName}
                  </td>
                  {showMediaBuyerColumn && (
                    <td className="table-cell text-app-fg-muted">
                      {order.mediaBuyerId ? (
                        <Link
                          to={`/hr/users/${order.mediaBuyerId}`}
                          className="text-brand-500 hover:text-brand-600 font-medium hover:underline"
                        >
                          {order.mediaBuyerName ?? 'View user'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className="table-cell text-right font-medium">
                    <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
                  </td>
                  <td className="table-cell">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="table-cell text-app-fg-muted">
                    {new Date(order.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="table-cell text-center">
                    <Link
                      to={`/admin/orders/${order.id}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && (
          <div className="hidden md:block">
            <EmptyState
              title="No orders match your filters"
              description="Try adjusting your status filter or search query"
              variant="card"
            />
          </div>
        )}

        <div className="md:hidden space-y-3 px-1 py-3">
          {orders.length === 0 && (
            <EmptyState
              title="No orders match your filters"
              description="Try adjusting your status filter or search query"
              variant="card"
            />
          )}
          {orders.map((order) => (
            <Link
              key={order.id}
              to={`/admin/orders/${order.id}`}
              className="block rounded-lg border border-app-border bg-app-elevated p-4 hover:bg-app-hover/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-app-fg">{order.customerName}</span>
                <OrderStatusBadge status={order.status} />
              </div>
              {showMediaBuyerColumn && order.mediaBuyerName && (
                <div className="text-sm mb-0.5">
                  {order.mediaBuyerId ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/hr/users/${order.mediaBuyerId}`);
                      }}
                      className="text-brand-500 hover:text-brand-600 hover:underline text-left"
                    >
                      {order.mediaBuyerName}
                    </button>
                  ) : (
                    <span className="text-app-fg-muted">{order.mediaBuyerName}</span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-end text-sm">
                <span className="font-medium text-app-fg">
                  <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
                </span>
              </div>
              <div className="flex items-center justify-between mt-1 text-xs text-app-fg-muted">
                <OrderIdBadge id={order.id} textClassName="text-app-fg-muted" />
                <span>
                  {new Date(order.createdAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </Link>
          ))}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-app-border px-4 py-3">
            <Pagination page={page} totalPages={totalPages} pageParam="page" />
          </div>
        )}
      </div>
      )}
    </div>
  );
}
