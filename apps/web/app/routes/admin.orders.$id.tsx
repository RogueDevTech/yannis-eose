import { useState } from 'react';
import { Link, useParams } from '@remix-run/react';
import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => [
  { title: 'Order Detail — Yannis EOSE' },
];

// State machine visualization
const STATUS_FLOW = [
  'UNPROCESSED',
  'CS_ENGAGED',
  'CONFIRMED',
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
] as const;

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  UNPROCESSED: { bg: 'bg-warning-50 dark:bg-warning-700/20', text: 'text-warning-700 dark:text-warning-500', dot: 'bg-warning-500' },
  CS_ENGAGED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-700 dark:text-info-500', dot: 'bg-info-500' },
  CONFIRMED: { bg: 'bg-brand-50 dark:bg-brand-700/20', text: 'text-brand-700 dark:text-brand-400', dot: 'bg-brand-500' },
  CANCELLED: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-700 dark:text-danger-500', dot: 'bg-danger-500' },
  ALLOCATED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-700 dark:text-info-500', dot: 'bg-info-500' },
  DISPATCHED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-700 dark:text-info-500', dot: 'bg-info-500' },
  IN_TRANSIT: { bg: 'bg-brand-50 dark:bg-brand-700/20', text: 'text-brand-700 dark:text-brand-400', dot: 'bg-brand-500' },
  DELIVERED: { bg: 'bg-success-50 dark:bg-success-700/20', text: 'text-success-700 dark:text-success-500', dot: 'bg-success-500' },
  COMPLETED: { bg: 'bg-success-50 dark:bg-success-700/20', text: 'text-success-700 dark:text-success-500', dot: 'bg-success-500' },
  RETURNED: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-700 dark:text-danger-500', dot: 'bg-danger-500' },
};

// Mock order data — will be replaced with tRPC getById
const MOCK_ORDER = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  customerName: 'John Doe',
  customerPhoneDisplay: '0803****1234',
  customerAddress: '15 Marina Road, Lagos Island',
  deliveryAddress: '23 Ikeja Street, GRA, Ikeja',
  status: 'CS_ENGAGED',
  totalAmount: '15000.00',
  deliveryFee: '1500.00',
  deliveryNotes: 'Call before delivery',
  createdAt: '2026-03-01T10:30:00Z',
  confirmedAt: null,
  allocatedAt: null,
  dispatchedAt: null,
  deliveredAt: null,
  assignedCsId: 'agent-1',
  orderItems: [
    { id: '1', productId: 'p-1', quantity: 2, unitPrice: '5000.00' },
    { id: '2', productId: 'p-2', quantity: 1, unitPrice: '5000.00' },
  ],
  callLogs: [
    {
      id: 'cl-1',
      callStatus: 'COMPLETED',
      durationSeconds: 45,
      startedAt: '2026-03-01T10:35:00Z',
    },
  ],
  allowedTransitions: ['CONFIRMED', 'CANCELLED'],
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const order = MOCK_ORDER;
  const [cancelReason, setCancelReason] = useState('');

  const currentStatusIndex = STATUS_FLOW.indexOf(
    order.status as (typeof STATUS_FLOW)[number],
  );

  return (
    <div className="space-y-4">
      {/* Breadcrumb + back */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          to="/admin/orders"
          className="text-surface-500 dark:text-surface-400 hover:text-brand-500 transition-colors"
        >
          Orders
        </Link>
        <span className="text-surface-300 dark:text-surface-600">/</span>
        <span className="text-surface-900 dark:text-surface-100 font-medium">
          {id?.slice(0, 8)}...
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            {order.customerName}
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 font-mono mt-0.5">
            {order.customerPhoneDisplay}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${STATUS_COLORS[order.status]?.bg} ${STATUS_COLORS[order.status]?.text}`}>
            <span className={`status-dot ${STATUS_COLORS[order.status]?.dot}`} />
            {order.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column: details + items */}
        <div className="lg:col-span-2 space-y-4">
          {/* Status Timeline */}
          <div className="card">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
              Order Progress
            </h2>
            <div className="flex items-center overflow-x-auto pb-2">
              {STATUS_FLOW.map((status, idx) => {
                const isPast = idx < currentStatusIndex;
                const isCurrent = idx === currentStatusIndex;
                const isFuture = idx > currentStatusIndex;

                return (
                  <div key={status} className="flex items-center min-w-0">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          isCurrent
                            ? 'bg-brand-500 text-white ring-4 ring-brand-100 dark:ring-brand-900'
                            : isPast
                            ? 'bg-success-500 text-white'
                            : 'bg-surface-200 dark:bg-surface-700 text-surface-400 dark:text-surface-500'
                        }`}
                      >
                        {isPast ? (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <span
                        className={`text-2xs mt-1 whitespace-nowrap ${
                          isCurrent
                            ? 'text-brand-600 dark:text-brand-400 font-semibold'
                            : isPast
                            ? 'text-success-600 dark:text-success-500'
                            : 'text-surface-400 dark:text-surface-500'
                        }`}
                      >
                        {status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {idx < STATUS_FLOW.length - 1 && (
                      <div
                        className={`h-0.5 w-8 lg:w-12 mx-1 flex-shrink-0 ${
                          isPast
                            ? 'bg-success-500'
                            : 'bg-surface-200 dark:bg-surface-700'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Order Items */}
          <div className="card">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
              Order Items
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Product</th>
                    <th className="table-header text-center">Qty</th>
                    <th className="table-header text-right">Unit Price</th>
                    <th className="table-header text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.orderItems.map((item) => (
                    <tr key={item.id} className="table-row">
                      <td className="table-cell font-medium text-surface-900 dark:text-surface-100">
                        {item.productId}
                      </td>
                      <td className="table-cell text-center">{item.quantity}</td>
                      <td className="table-cell text-right">
                        &#8358;{Number(item.unitPrice).toLocaleString()}
                      </td>
                      <td className="table-cell text-right font-medium">
                        &#8358;{(item.quantity * Number(item.unitPrice)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-surface-200 dark:border-surface-700">
                    <td colSpan={3} className="table-cell font-semibold text-surface-900 dark:text-surface-100 text-right">
                      Total
                    </td>
                    <td className="table-cell text-right font-bold text-surface-900 dark:text-white">
                      &#8358;{Number(order.totalAmount).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Call Logs */}
          {order.callLogs.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
                Call History
              </h2>
              <div className="space-y-2">
                {order.callLogs.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-800"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        call.callStatus === 'COMPLETED' ? 'bg-success-50 dark:bg-success-700/20 text-success-600' : 'bg-danger-50 dark:bg-danger-700/20 text-danger-600'
                      }`}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-surface-100">
                          {call.callStatus}
                        </p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">
                          {new Date(call.startedAt).toLocaleString('en-NG')}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-mono text-surface-600 dark:text-surface-300">
                      {call.durationSeconds}s
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: actions + info */}
        <div className="space-y-4">
          {/* Actions */}
          <div className="card">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
              Actions
            </h2>
            <div className="space-y-2">
              {order.allowedTransitions.includes('CONFIRMED') && (
                <button className="btn-primary w-full" disabled={order.callLogs.length === 0}>
                  Confirm Order
                </button>
              )}
              {order.allowedTransitions.includes('CANCELLED') && (
                <div className="space-y-2">
                  <textarea
                    placeholder="Cancellation reason (min 10 characters)..."
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    className="input text-sm"
                    rows={2}
                  />
                  <button
                    className="btn-danger w-full"
                    disabled={cancelReason.length < 10}
                  >
                    Cancel Order
                  </button>
                </div>
              )}
              {order.allowedTransitions.includes('CS_ENGAGED') && (
                <button className="btn-primary w-full">
                  Call Customer
                </button>
              )}
            </div>
          </div>

          {/* Order Info */}
          <div className="card">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
              Details
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-surface-500 dark:text-surface-400">Customer Address</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{order.customerAddress}</dd>
              </div>
              <div>
                <dt className="text-surface-500 dark:text-surface-400">Delivery Address</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{order.deliveryAddress}</dd>
              </div>
              <div>
                <dt className="text-surface-500 dark:text-surface-400">Delivery Fee</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">&#8358;{Number(order.deliveryFee).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-surface-500 dark:text-surface-400">Delivery Notes</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{order.deliveryNotes}</dd>
              </div>
              <div>
                <dt className="text-surface-500 dark:text-surface-400">Created</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">
                  {new Date(order.createdAt).toLocaleString('en-NG')}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
