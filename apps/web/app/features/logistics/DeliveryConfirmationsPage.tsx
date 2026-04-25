import { useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { Modal } from '~/components/ui/modal';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Textarea } from '~/components/ui/textarea';
import { Pagination } from '~/components/ui/pagination';
import type { DeliveryConfirmationRequest } from './types';

interface DeliveryConfirmationsPageProps {
  requests: DeliveryConfirmationRequest[];
  total: number;
  page: number;
  limit: number;
  statusFilter?: string;
  orderCounts?: Record<string, number>;
}

const PIPELINE_STAGES = [
  { key: 'CONFIRMED', label: 'Awaiting Allocation', color: 'text-warning-600 dark:text-warning-400' },
  { key: 'ALLOCATED', label: 'Allocated', color: 'text-brand-600 dark:text-brand-400' },
  { key: 'DISPATCHED', label: 'Dispatched', color: 'text-info-600 dark:text-info-400' },
  { key: 'IN_TRANSIT', label: 'In Transit', color: 'text-brand-600 dark:text-brand-400' },
  { key: 'DELIVERED', label: 'Delivered', color: 'text-success-600 dark:text-success-400' },
  { key: 'RETURNED', label: 'Returns', color: 'text-danger-600 dark:text-danger-400' },
] as const;

export function DeliveryConfirmationsPage({
  requests,
  total,
  page,
  limit,
  statusFilter = 'PENDING',
  orderCounts = {},
}: DeliveryConfirmationsPageProps) {
  const fetcher = useFetcher();
  const [rejectModal, setRejectModal] = useState<{ requestId: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useFetcherToast(fetcher.data, { successMessage: 'Action completed' });

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery confirmations"
        description="Approve or reject delivery confirmations submitted by riders and 3PL."
        actions={
          <>
            <PageRefreshButton />
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
          </>
        }
      />

      {/* Order Pipeline — same card style as dashboard bottom */}
      <div className="card">
        <h2 className="text-lg font-semibold text-app-fg mb-4">Order Pipeline</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {PIPELINE_STAGES.map(({ key, label, color }) => {
            const value = orderCounts[key] ?? 0;
            return (
              <div key={key} className="text-center p-3 rounded-lg bg-app-hover">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-sm text-app-fg-muted mt-0.5">{label}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {requests.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Order / Customer</th>
                    <th className="table-header">Requested by</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Requested at</th>
                    {statusFilter === 'PENDING' && (
                      <th className="table-header text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => {
                    const order = req.order;
                    const newStatus = (req.payload?.newStatus as string) ?? 'DELIVERED';
                    return (
                      <tr key={req.id} className="table-row">
                        <td className="table-cell whitespace-normal">
                          <div className="flex flex-col">
                            <OrderIdBadge
                              id={req.orderId}
                              ellipsis="…"
                              linkTo={`/admin/logistics/orders/${req.orderId}`}
                              textClassName="font-medium text-brand-500 hover:text-brand-600"
                            />
                            {order && (
                              <span className="text-xs text-app-fg-muted">
                                {order.customerName}
                                {order.deliveryAddress ? ` · ${order.deliveryAddress.slice(0, 40)}…` : ''}
                              </span>
                            )}
                            <span className="text-xs text-app-fg-muted dark:text-app-fg-muted mt-0.5">{newStatus}</span>
                          </div>
                        </td>
                        <td className="table-cell text-app-fg-muted">
                          {req.requesterName ?? req.requestedBy.slice(0, 8)}
                        </td>
                        <td className="table-cell">
                          <StatusBadge status={req.status} showDot />
                        </td>
                        <td className="table-cell text-app-fg-muted">
                          {new Date(req.requestedAt).toLocaleString('en-NG', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        {statusFilter === 'PENDING' && req.status === 'PENDING' && (
                          <td className="table-cell text-right">
                            <div className="flex gap-2 justify-end">
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
          </>
        ) : (
          <EmptyState
            title={statusFilter === 'PENDING' ? 'No pending confirmations' : 'No confirmation requests'}
            description={statusFilter === 'PENDING' ? 'No pending delivery confirmations.' : 'No delivery confirmation requests.'}
            variant="card"
          />
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} pageParam="page" />

      {/* Reject reason modal */}
      {rejectModal && (
        <Modal open onClose={() => setRejectModal(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-6 flex flex-col max-h-[80dvh] overflow-hidden border border-app-border bg-app-elevated">
              <h3 className="text-lg font-semibold text-app-fg shrink-0">Reject delivery confirmation</h3>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
                <Textarea
                  label="Reason (optional)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Reason for rejection..."
                />
              </div>
              <div className="flex gap-2 justify-end shrink-0 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
        </Modal>
      )}
    </div>
  );
}
