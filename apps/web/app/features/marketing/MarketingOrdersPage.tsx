import { useState, useEffect } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { STATUS_COLORS, STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';
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
}: MarketingOrdersPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            {isMediaBuyer ? 'My Orders' : 'Marketing Orders'}
          </h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
            {isMediaBuyer
              ? 'Track your campaign orders and conversion funnel'
              : 'View orders across all media buyers'}
          </p>
        </div>
        <button
          onClick={() =>
            exportToCsv(
              orders.map((o) => ({
                id: o.id,
                customer: o.customerName,
                phone: o.customerPhoneDisplay,
                status: o.status,
                amount: o.totalAmount ?? '',
                created: new Date(o.createdAt).toLocaleDateString(),
              })),
              [
                { key: 'id', label: 'Order ID' },
                { key: 'customer', label: 'Customer' },
                { key: 'phone', label: 'Phone' },
                { key: 'status', label: 'Status' },
                { key: 'amount', label: 'Amount' },
                { key: 'created', label: 'Created' },
              ],
              `marketing-orders-${new Date().toISOString().split('T')[0]}.csv`,
            )
          }
          className="btn-secondary btn-sm"
        >
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Unprocessed</p>
          <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">{unprocessedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Confirmed</p>
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">{confirmedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Delivered</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">{deliveredCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Delivery Rate</p>
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
          <button type="submit" className="btn-secondary btn-sm">
            Search
          </button>
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
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                <th className="table-header">Phone</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Status</th>
                <th className="table-header">Created</th>
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
                  <td className="table-cell font-mono text-sm">{order.customerPhoneDisplay}</td>
                  <td className="table-cell text-right font-medium">
                    {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                  </td>
                  <td className="table-cell">
                    <span className={STATUS_COLORS[order.status] ?? 'badge'}>
                      {formatStatus(order.status)}
                    </span>
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">
                    {new Date(order.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && (
          <div className="py-12 text-center text-surface-700 dark:text-surface-500">
            No orders found
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Link
            to={buildQueryString({ page: page - 1 })}
            className={`btn-secondary btn-sm ${page <= 1 ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Previous
          </Link>
          <span className="text-sm text-surface-700 dark:text-surface-500">
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
