import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { Spinner } from '~/components/ui/spinner';
import { useLiveIndicator } from '~/hooks/useSocket';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
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
}

export function MarketingOrdersPage({
  orders,
  total,
  totalPages,
  page,
  limit,
  statusCounts,
  statusFilter,
  searchFilter,
  isMediaBuyer,
  showMediaBuyerColumn = false,
  filters,
  liveEvents,
}: MarketingOrdersPageProps) {
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const liveState = useLiveIndicator(liveEvents ?? []);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');

  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

  const buildQueryString = (overrides: { page?: number; status?: string; search?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.page !== undefined) params.set('page', String(overrides.page));
    if (overrides.status !== undefined) {
      if (overrides.status === 'ALL' || !overrides.status) params.delete('status');
      else params.set('status', overrides.status);
    }
    if (overrides.search !== undefined) {
      if (overrides.search) params.set('search', overrides.search);
      else params.delete('search');
    }
    // Preserve date filter params (startDate, endDate, period)
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  };

  const unprocessedCount = statusCounts['UNPROCESSED'] ?? 0;
  const confirmedCount = statusCounts['CONFIRMED'] ?? 0;
  const deliveredCount = statusCounts['DELIVERED'] ?? 0;
  const deliveryRate = total > 0 ? ((statusCounts['DELIVERED'] ?? 0) / total * 100).toFixed(1) : '0';

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    setSearchParams(buildQueryString({ status: status === 'ALL' ? undefined : status, page: 1 }));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(buildQueryString({ search: searchQuery || undefined, page: 1 }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
              {isMediaBuyer ? 'My Orders' : 'Marketing Orders'}
            </h1>
            <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
              {isMediaBuyer
                ? 'Track your campaign orders and conversion funnel'
                : 'View orders across all media buyers'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            {liveEvents != null && liveEvents.length > 0 && (
              <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
            )}
            <div className="flex items-center min-h-[2rem] rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 pl-2.5 pr-2 py-1">
              <DateFilterBar
                startDate={dateFilters.startDate}
                endDate={dateFilters.endDate}
                periodAllTime={dateFilters.periodAllTime}
              />
            </div>
            <div className="flex items-center gap-2 border-surface-200 dark:border-surface-700 sm:border-l sm:pl-4">
              <Button
                onClick={() =>
                  exportToCsv(
                    orders.map((o) => ({
                      id: o.id,
                      customer: o.customerName,
                      ...(showMediaBuyerColumn && { mediaBuyer: o.mediaBuyerName ?? '—' }),
                      phone: o.customerPhoneDisplay,
                      status: o.status,
                      amount: o.totalAmount ?? '',
                      created: new Date(o.createdAt).toLocaleDateString(),
                    })),
                    [
                      { key: 'id', label: 'Order ID' },
                      { key: 'customer', label: 'Customer' },
                      ...(showMediaBuyerColumn ? [{ key: 'mediaBuyer', label: 'Media Buyer' }] : []),
                      { key: 'phone', label: 'Phone' },
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
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Unprocessed</p>
          <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">{unprocessedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Confirmed</p>
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">{confirmedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Delivered</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">{deliveredCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Delivery Rate</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{deliveryRate}%</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1">
          <input
            type="search"
            placeholder="Search by customer or order ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input flex-1"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <select
          value={selectedStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="input w-auto"
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status === 'ALL' ? 'All Statuses' : formatStatus(status)}
            </option>
          ))}
        </select>
        {isFilterLoading && (
          <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
            <Spinner size="sm" className="shrink-0" />
          </span>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                {showMediaBuyerColumn && <th className="table-header">Media buyer</th>}
                <th className="table-header">Phone</th>
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
                    <Link
                      to={`/admin/orders/${order.id}`}
                      className="text-brand-500 hover:text-brand-600 font-medium"
                    >
                      {order.id.slice(0, 8)}...
                    </Link>
                  </td>
                  <td className="table-cell font-medium text-surface-900 dark:text-surface-100">
                    {order.customerName}
                  </td>
                  {showMediaBuyerColumn && (
                    <td className="table-cell text-surface-800 dark:text-surface-200">
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
                  <td className="table-cell font-mono text-sm">{order.customerPhoneDisplay}</td>
                  <td className="table-cell text-right font-medium">
                    {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                  </td>
                  <td className="table-cell">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-200">
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
          <div className="py-12 text-center text-surface-700 dark:text-surface-300">
            No orders found
          </div>
        )}

        {/* Mobile */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {orders.map((order) => (
            <Link
              key={order.id}
              to={`/admin/orders/${order.id}`}
              className="block p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-surface-900 dark:text-surface-100">{order.customerName}</span>
                <OrderStatusBadge status={order.status} />
              </div>
              {showMediaBuyerColumn && order.mediaBuyerName && (
                <div className="text-xs mb-0.5">
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
                    <span className="text-surface-600 dark:text-surface-400">{order.mediaBuyerName}</span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-surface-700 dark:text-surface-300 font-mono text-xs">{order.customerPhoneDisplay}</span>
                <span className="font-medium text-surface-900 dark:text-surface-100">
                  {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1 text-xs text-surface-700 dark:text-surface-300">
                <span>{order.id.slice(0, 8)}...</span>
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
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Link
            to={buildQueryString({ page: page - 1 })}
            className={`btn-secondary btn-sm ${page <= 1 ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Previous
          </Link>
          <span className="text-sm text-surface-700 dark:text-surface-300">
            Page {page} of {totalPages}
          </span>
          <Link
            to={buildQueryString({ page: page + 1 })}
            className={`btn-secondary btn-sm ${page >= totalPages ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  );
}
