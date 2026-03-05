import { useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import type { DeliveryConfirmationRequest } from './types';

interface DeliveryConfirmationsPageProps {
  requests: DeliveryConfirmationRequest[];
  total: number;
  page: number;
  limit: number;
  statusFilter?: string;
}

export function DeliveryConfirmationsPage({
  requests,
  total,
  page,
  limit,
  statusFilter = 'PENDING',
}: DeliveryConfirmationsPageProps) {
  const fetcher = useFetcher();
  const [rejectModal, setRejectModal] = useState<{ requestId: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useFetcherToast(fetcher.data, { successMessage: 'Action completed' });

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Delivery confirmations</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            Approve or reject delivery confirmations submitted by riders and 3PL.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/logistics/delivery-confirmations?status=PENDING">
            <Button variant={statusFilter === 'PENDING' ? 'primary' : 'secondary'} size="sm">
              Pending {statusFilter === 'PENDING' ? `(${total})` : ''}
            </Button>
          </Link>
          <Link to="/admin/logistics/delivery-confirmations?status=">
            <Button variant={statusFilter === '' ? 'primary' : 'secondary'} size="sm">
              All
            </Button>
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-50 dark:bg-surface-800/80 border-b border-surface-200 dark:border-surface-700">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-surface-600 dark:text-surface-400 uppercase">Order / Customer</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-600 dark:text-surface-400 uppercase">Requested by</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-600 dark:text-surface-400 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-surface-600 dark:text-surface-400 uppercase">Requested at</th>
                {statusFilter === 'PENDING' && (
                  <th className="px-4 py-3 text-xs font-medium text-surface-600 dark:text-surface-400 uppercase">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {requests.map((req) => {
                const order = req.order;
                const newStatus = (req.payload?.newStatus as string) ?? 'DELIVERED';
                return (
                  <tr key={req.id} className="hover:bg-surface-50/50 dark:hover:bg-surface-800/50">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <Link
                          to={`/admin/logistics/orders/${req.orderId}`}
                          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
                        >
                          {req.orderId.slice(0, 8)}…
                        </Link>
                        {order && (
                          <span className="text-xs text-surface-600 dark:text-surface-400">
                            {order.customerName}
                            {order.deliveryAddress ? ` · ${order.deliveryAddress.slice(0, 40)}…` : ''}
                          </span>
                        )}
                        <span className="text-xs text-surface-500 dark:text-surface-500 mt-0.5">{newStatus}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-surface-800 dark:text-surface-200">
                      {req.requesterName ?? req.requestedBy.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          req.status === 'PENDING'
                            ? 'text-amber-600 dark:text-amber-400'
                            : req.status === 'APPROVED'
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-600 dark:text-red-400'
                        }
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-surface-600 dark:text-surface-400">
                      {new Date(req.requestedAt).toLocaleString('en-NG', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    {statusFilter === 'PENDING' && req.status === 'PENDING' && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="approve" />
                            <input type="hidden" name="requestId" value={req.id} />
                            <Button type="submit" variant="success" size="sm" disabled={fetcher.state !== 'idle'}>
                              Approve
                            </Button>
                          </fetcher.Form>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => { setRejectModal({ requestId: req.id }); setRejectReason(''); }}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {requests.length === 0 && (
          <div className="px-4 py-12 text-center text-surface-600 dark:text-surface-400">
            {statusFilter === 'PENDING' ? 'No pending delivery confirmations.' : 'No delivery confirmation requests.'}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link to={`/admin/logistics/delivery-confirmations?status=${statusFilter}&page=${page - 1}`}>
              <Button variant="secondary" size="sm">Previous</Button>
            </Link>
          )}
          <span className="py-2 text-sm text-surface-600 dark:text-surface-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link to={`/admin/logistics/delivery-confirmations?status=${statusFilter}&page=${page + 1}`}>
              <Button variant="secondary" size="sm">Next</Button>
            </Link>
          )}
        </div>
      )}

      {/* Reject reason modal */}
      {rejectModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setRejectModal(null)} />
          <div className="fixed inset-x-0 top-[20vh] z-50 mx-auto max-w-md px-4">
            <div className="rounded-xl bg-white dark:bg-surface-800 shadow-2xl border border-surface-200 dark:border-surface-700 p-6 space-y-4">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Reject delivery confirmation</h3>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Reason <span className="text-surface-500">(optional)</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="input min-h-[80px]"
                  placeholder="Reason for rejection..."
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={() => setRejectModal(null)}>
                  Cancel
                </Button>
                <fetcher.Form method="post" onSubmit={() => setRejectModal(null)}>
                  <input type="hidden" name="intent" value="reject" />
                  <input type="hidden" name="requestId" value={rejectModal.requestId} />
                  <input type="hidden" name="reason" value={rejectReason} />
                  <Button type="submit" variant="danger" size="sm" loading={fetcher.state !== 'idle'}>
                    Reject
                  </Button>
                </fetcher.Form>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
