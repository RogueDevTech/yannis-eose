import { useState } from 'react';
import { Link } from '@remix-run/react';
import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => [
  { title: 'Orders — Yannis EOSE' },
];

// Status badge color map
const STATUS_COLORS: Record<string, string> = {
  UNPROCESSED: 'badge-warning',
  CS_ENGAGED: 'badge-info',
  CONFIRMED: 'badge-brand',
  CANCELLED: 'badge-danger',
  ALLOCATED: 'badge-info',
  DISPATCHED: 'badge-info',
  IN_TRANSIT: 'badge-brand',
  DELIVERED: 'badge-success',
  PARTIALLY_DELIVERED: 'badge-warning',
  RETURNED: 'badge-danger',
  RESTOCKED: 'badge-info',
  WRITTEN_OFF: 'badge-danger',
  COMPLETED: 'badge-success',
};

// Status display names
function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

// Mock data — will be replaced with tRPC calls
const MOCK_ORDERS = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    customerName: 'John Doe',
    customerPhoneDisplay: '0803****1234',
    status: 'UNPROCESSED',
    totalAmount: '15000.00',
    createdAt: '2026-03-01T10:30:00Z',
    assignedCsId: null,
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    customerName: 'Jane Smith',
    customerPhoneDisplay: '0901****5678',
    status: 'CS_ENGAGED',
    totalAmount: '25000.00',
    createdAt: '2026-03-01T09:15:00Z',
    assignedCsId: 'agent-1',
  },
  {
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    customerName: 'Bob Johnson',
    customerPhoneDisplay: '0812****9012',
    status: 'CONFIRMED',
    totalAmount: '8500.00',
    createdAt: '2026-02-28T14:45:00Z',
    assignedCsId: 'agent-2',
  },
  {
    id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
    customerName: 'Alice Brown',
    customerPhoneDisplay: '0705****3456',
    status: 'DELIVERED',
    totalAmount: '32000.00',
    createdAt: '2026-02-27T08:00:00Z',
    assignedCsId: 'agent-1',
  },
  {
    id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
    customerName: 'Charlie Wilson',
    customerPhoneDisplay: '0908****7890',
    status: 'IN_TRANSIT',
    totalAmount: '12000.00',
    createdAt: '2026-02-26T16:20:00Z',
    assignedCsId: 'agent-3',
  },
];

const STATUS_OPTIONS = [
  'ALL',
  'UNPROCESSED',
  'CS_ENGAGED',
  'CONFIRMED',
  'CANCELLED',
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'COMPLETED',
];

export default function OrdersPage() {
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOrders = MOCK_ORDERS.filter((order) => {
    if (selectedStatus !== 'ALL' && order.status !== selectedStatus) return false;
    if (searchQuery && !order.customerName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Orders</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
            Manage and track all customer orders
          </p>
        </div>
      </div>

      {/* Filters bar */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search by customer name or order ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10 py-1.5"
            />
          </div>

          {/* Status filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
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
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
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
                  <td className="table-cell font-mono text-sm">
                    {order.customerPhoneDisplay}
                  </td>
                  <td className="table-cell">
                    <span className={STATUS_COLORS[order.status] ?? 'badge'}>
                      {formatStatus(order.status)}
                    </span>
                  </td>
                  <td className="table-cell text-right font-medium">
                    &#8358;{Number(order.totalAmount).toLocaleString()}
                  </td>
                  <td className="table-cell text-surface-500 dark:text-surface-400">
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
                  <td colSpan={6} className="px-4 py-12 text-center text-surface-400 dark:text-surface-500">
                    No orders found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {filteredOrders.map((order) => (
            <Link
              key={order.id}
              to={`/admin/orders/${order.id}`}
              className="block p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-surface-900 dark:text-surface-100">
                  {order.customerName}
                </span>
                <span className={STATUS_COLORS[order.status] ?? 'badge'}>
                  {formatStatus(order.status)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm text-surface-500 dark:text-surface-400">
                <span className="font-mono">{order.customerPhoneDisplay}</span>
                <span className="font-medium text-surface-900 dark:text-surface-100">
                  &#8358;{Number(order.totalAmount).toLocaleString()}
                </span>
              </div>
              <div className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                {new Date(order.createdAt).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </Link>
          ))}
          {filteredOrders.length === 0 && (
            <div className="p-8 text-center text-surface-400 dark:text-surface-500">
              No orders found
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-surface-500 dark:text-surface-400">
          Showing {filteredOrders.length} of {MOCK_ORDERS.length} orders
        </p>
        <div className="flex items-center gap-2">
          <button className="btn-secondary btn-sm" disabled>
            Previous
          </button>
          <span className="text-sm text-surface-500 dark:text-surface-400 px-2">Page 1 of 1</span>
          <button className="btn-secondary btn-sm" disabled>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
