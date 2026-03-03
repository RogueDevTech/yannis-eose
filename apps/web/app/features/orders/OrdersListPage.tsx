import { useState, useEffect, useRef } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { STATUS_COLORS, STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';
import { exportToCsv } from '~/lib/csv-export';
import type { Order } from './types';

// Status transitions that make sense for bulk operations
const BULK_TRANSITIONS: Record<string, string[]> = {
  UNPROCESSED: ['CANCELLED'],
  CONFIRMED: ['ALLOCATED'],
  ALLOCATED: ['DISPATCHED'],
  DISPATCHED: ['IN_TRANSIT'],
};

interface OrdersListPageProps {
  orders: Order[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  statusCounts: Record<string, number>;
  statusFilter?: string;
  searchFilter?: string;
  userRole?: string;
}

export function OrdersListPage({ orders, total, totalPages, page, limit, statusCounts, statusFilter, searchFilter, userRole }: OrdersListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');

  // Sync URL params to local state when loader data changes (e.g. back/forward)
  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

  // Track new/updated rows for 3s highlight effect (e.g. from socket refresh)
  const prevOrdersRef = useRef<Map<string, string>>(new Map());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevOrdersRef.current;
    const newIds = new Set<string>();
    const isFirstLoad = prev.size === 0;

    if (!isFirstLoad) {
      for (const order of orders) {
        const prevStatus = prev.get(order.id);
        if (!prevStatus) {
          newIds.add(order.id); // New order
        } else if (prevStatus !== order.status) {
          newIds.add(order.id); // Status changed
        }
      }
    }

    // Update ref for next comparison
    prevOrdersRef.current = new Map(orders.map((o) => [o.id, o.status]));

    if (newIds.size > 0) {
      setHighlightedIds((h) => new Set([...h, ...newIds]));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setHighlightedIds((h) => {
          const next = new Set(h);
          newIds.forEach((id) => next.delete(id));
          return next;
        });
        timeoutRef.current = null;
      }, 3000);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [orders]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ succeeded: number; failed: number; errors: string[] } | null>(null);
  const fetcher = useFetcher();

  // Server-side filtering via URL params; orders are already filtered by loader
  const filteredOrders = orders;

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

  // Checkbox handlers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOrders.map((o) => o.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkAction(null);
    setBulkResult(null);
  };

  // Determine what bulk transitions are available based on selected orders
  const selectedOrders = filteredOrders.filter((o) => selectedIds.has(o.id));
  const selectedStatuses = [...new Set(selectedOrders.map((o) => o.status))];
  const availableTransitions = selectedStatuses.length === 1
    ? BULK_TRANSITIONS[selectedStatuses[0]] ?? []
    : [];

  const isSubmitting = fetcher.state !== 'idle';

  // Handle fetcher response
  if (fetcher.data && !bulkResult) {
    const data = fetcher.data as { success?: boolean; succeeded?: number; failed?: number; results?: Array<{ orderId: string; success: boolean; error?: string }> };
    if (data.success !== undefined) {
      const errors = (data.results ?? [])
        .filter((r) => !r.success)
        .map((r) => `${r.orderId.slice(0, 8)}...: ${r.error ?? 'Unknown'}`);
      setBulkResult({
        succeeded: data.succeeded ?? 0,
        failed: data.failed ?? 0,
        errors,
      });
    }
  }

  const submitBulkTransition = (newStatus: string) => {
    setBulkResult(null);
    fetcher.submit(
      {
        intent: 'bulkTransition',
        orderIds: JSON.stringify([...selectedIds]),
        newStatus,
      },
      { method: 'post' },
    );
  };

  const submitBulkExport = () => {
    const exportData = selectedOrders.map((o) => ({
      id: o.id,
      customer: o.customerName,
      phone: o.customerPhoneDisplay,
      status: o.status,
      amount: o.totalAmount ?? '',
      created: new Date(o.createdAt).toLocaleDateString(),
    }));
    exportToCsv(
      exportData,
      [
        { key: 'id', label: 'Order ID' },
        { key: 'customer', label: 'Customer' },
        { key: 'phone', label: 'Phone' },
        { key: 'status', label: 'Status' },
        { key: 'amount', label: 'Amount' },
        { key: 'created', label: 'Created' },
      ],
      `orders-selected-${new Date().toISOString().split('T')[0]}.csv`,
    );
  };

  const canBulkAction = userRole === 'SUPER_ADMIN' || userRole === 'HEAD_OF_CS' || userRole === 'HEAD_OF_LOGISTICS' || userRole === 'WAREHOUSE_MANAGER';

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Orders</h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
            Manage and track all customer orders
          </p>
        </div>
        <button
          onClick={() => exportToCsv(
            filteredOrders.map((o) => ({
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
            `orders-${new Date().toISOString().split('T')[0]}.csv`,
          )}
          className="btn-secondary btn-sm"
        >
          Export CSV
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
      </div>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && canBulkAction && (
        <div className="card bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <button onClick={clearSelection} className="text-xs text-brand-500 hover:text-brand-600 underline">
                Clear
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Bulk Transition buttons */}
              {availableTransitions.map((status) => (
                <button
                  key={status}
                  onClick={() => submitBulkTransition(status)}
                  disabled={isSubmitting}
                  className="btn-primary btn-sm"
                >
                  {isSubmitting ? 'Processing...' : `Transition to ${formatStatus(status)}`}
                </button>
              ))}
              {selectedStatuses.length > 1 && (
                <span className="text-xs text-surface-800 dark:text-surface-400 italic">
                  Select orders with same status for bulk transition
                </span>
              )}
              {/* Export selected */}
              <button
                onClick={submitBulkExport}
                className="btn-secondary btn-sm"
              >
                Export Selected
              </button>
            </div>
          </div>
          {/* Bulk result summary */}
          {bulkResult && (
            <div className="mt-3 p-3 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
              <div className="flex items-center gap-3 text-sm">
                {bulkResult.succeeded > 0 && (
                  <span className="text-success-600 dark:text-success-400 font-medium">
                    {bulkResult.succeeded} succeeded
                  </span>
                )}
                {bulkResult.failed > 0 && (
                  <span className="text-danger-600 dark:text-danger-400 font-medium">
                    {bulkResult.failed} failed
                  </span>
                )}
              </div>
              {bulkResult.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {bulkResult.errors.map((err, i) => (
                    <p key={i} className="text-xs text-danger-600 dark:text-danger-400">
                      {err}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters bar */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <form
            method="get"
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setSearchParams((p) => {
                const next = new URLSearchParams(p);
                next.set('page', '1');
                if (searchQuery.trim()) next.set('search', searchQuery.trim());
                else next.delete('search');
                return next;
              });
            }}
          >
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              name="search"
              placeholder="Search by customer name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10 py-1.5 w-full"
            />
          </form>
          <select
            value={selectedStatus}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedStatus(v);
              setSelectedIds(new Set());
              setBulkResult(null);
              setSearchParams((p) => {
                const next = new URLSearchParams(p);
                next.set('page', '1');
                if (v === 'ALL') next.delete('status');
                else next.set('status', v);
                return next;
              });
            }}
            className="input w-full sm:w-48 py-1.5"
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status === 'ALL' ? 'All Statuses' : formatStatus(status)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders table */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {canBulkAction && (
                  <th className="table-header w-10">
                    <input
                      type="checkbox"
                      checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-brand-500 focus:ring-brand-500"
                    />
                  </th>
                )}
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                <th className="table-header">Phone</th>
                <th className="table-header">Status</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  className={`table-row ${selectedIds.has(order.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''} ${highlightedIds.has(order.id) ? 'row-new-highlight' : ''}`}
                >
                  {canBulkAction && (
                    <td className="table-cell w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(order.id)}
                        onChange={() => toggleSelect(order.id)}
                        className="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-brand-500 focus:ring-brand-500"
                      />
                    </td>
                  )}
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
                  <td className="table-cell font-mono text-sm">
                    {order.customerPhoneDisplay}
                  </td>
                  <td className="table-cell">
                    <span className={STATUS_COLORS[order.status] ?? 'badge'}>
                      {formatStatus(order.status)}
                    </span>
                  </td>
                  <td className="table-cell text-right font-medium">
                    {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
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
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={canBulkAction ? 7 : 6} className="px-4 py-12 text-center text-surface-700 dark:text-surface-500">
                    {orders.length === 0 ? 'No orders yet' : 'No orders found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {filteredOrders.map((order) => (
            <div key={order.id} className={`relative ${highlightedIds.has(order.id) ? 'row-new-highlight' : ''}`}>
              {canBulkAction && (
                <div className="absolute top-4 left-4 z-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(order.id)}
                    onChange={() => toggleSelect(order.id)}
                    className="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-brand-500 focus:ring-brand-500"
                  />
                </div>
              )}
              <Link
                to={`/admin/orders/${order.id}`}
                className={`block p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors ${canBulkAction ? 'pl-10' : ''} ${selectedIds.has(order.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-surface-900 dark:text-surface-100">
                    {order.customerName}
                  </span>
                  <span className={STATUS_COLORS[order.status] ?? 'badge'}>
                    {formatStatus(order.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm text-surface-800 dark:text-surface-400">
                  <span className="font-mono">{order.customerPhoneDisplay}</span>
                  <span className="font-medium text-surface-900 dark:text-surface-100">
                    {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                  </span>
                </div>
                <div className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                  {new Date(order.createdAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </Link>
            </div>
          ))}
          {filteredOrders.length === 0 && (
            <div className="p-8 text-center text-surface-700 dark:text-surface-500">
              {orders.length === 0 ? 'No orders yet' : 'No orders found'}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-surface-800 dark:text-surface-400">
          {total > 0
            ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} orders`
            : 'No orders'}
        </p>
        <div className="flex items-center gap-2">
          <Link
            to={page > 1 ? buildQueryString({ page: page - 1 }) || '?' : '#'}
            prefetch="intent"
            className={`btn-secondary btn-sm ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
            aria-disabled={page <= 1}
          >
            Previous
          </Link>
          <span className="text-sm text-surface-800 dark:text-surface-400 px-2">
            Page {page} of {totalPages || 1}
          </span>
          <Link
            to={page < totalPages ? buildQueryString({ page: page + 1 }) || '?' : '#'}
            prefetch="intent"
            className={`btn-secondary btn-sm ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
            aria-disabled={page >= totalPages}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
