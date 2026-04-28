import { useEffect, useState } from 'react';
import { Link, useFetcher, useNavigation, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useFetcherToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { Modal } from '~/components/ui/modal';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Tabs } from '~/components/ui/tabs';
import { FormSelect } from '~/components/ui/form-select';
import type { AllocatedDeliveryOrder, DeliveryConfirmationRequest } from './types';

interface DeliveryConfirmationsPageProps {
  requests: DeliveryConfirmationRequest[];
  total: number;
  page: number;
  limit: number;
  activeTab?: 'requests' | 'allocated';
  requestStatusFilter?: string;
  orderCounts?: Record<string, number>;
  allocatedOrders?: AllocatedDeliveryOrder[];
  canAdjustOrder?: boolean;
}

const REQUEST_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

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
  activeTab = 'requests',
  requestStatusFilter = 'PENDING',
  orderCounts = {},
  allocatedOrders = [],
  canAdjustOrder = false,
}: DeliveryConfirmationsPageProps) {
  const fetcher = useFetcher();
  const navigation = useNavigation();
  const isLoaderRefetchBusy = useLoaderRefetchBusy();
  const [searchParams, setSearchParams] = useSearchParams();
  const [uiTab, setUiTab] = useState<'requests' | 'allocated'>(activeTab);
  const [approveModal, setApproveModal] = useState<{ requestId: string; orderId: string } | null>(null);

  useFetcherToast(fetcher.data, { successMessage: 'Action completed' });

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const showingFrom = total > 0 ? (page - 1) * limit + 1 : 0;
  const showingTo = total > 0 ? Math.min(page * limit, total) : 0;
  const allocatedCount = allocatedOrders.length;
  const isRequestsTab = uiTab === 'requests';
  const isAllocatedTab = uiTab === 'allocated';
  useEffect(() => {
    if (navigation.state === 'idle') {
      setUiTab(activeTab);
    }
  }, [activeTab, navigation.state]);

  const handleTabChange = (value: string) => {
    const nextTab = value === 'allocated' ? 'allocated' : 'requests';
    setUiTab(nextTab);
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'allocated') {
      next.set('tab', 'allocated');
    } else {
      next.delete('tab');
    }
    next.delete('page');
    setSearchParams(next);
  };

  const handleRequestStatusChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === '') {
      next.set('requestStatus', '');
    } else {
      next.set('requestStatus', value);
    }
    next.delete('page');
    setSearchParams(next);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery confirmations"
        description="Approve or reject delivery confirmations submitted by riders and 3PL."
        actions={
          <>
            <PageRefreshButton />
          </>
        }
      />

      <OverviewStatStrip
        items={PIPELINE_STAGES.map(({ key, label, color }) => ({
          label,
          value: (orderCounts[key] ?? 0).toLocaleString(),
          valueClassName: color,
          title: `${label} orders`,
        }))}
      />

      <Tabs
        value={uiTab}
        onChange={handleTabChange}
        tabs={[
          { value: 'requests', label: `Confirmation requests (${total})` },
          { value: 'allocated', label: `Allocated orders (${allocatedCount})` },
        ]}
      />

      {isAllocatedTab && (
      <div className="card p-0">
        <div className="px-4 py-3 border-b border-app-border bg-app-elevated/50">
          <h2 className="text-sm font-semibold text-app-fg">Allocated orders ready for delivery</h2>
          <p className="text-xs text-app-fg-muted mt-0.5">
            CS and logistics can confirm delivery directly from here.
          </p>
        </div>
        <TableLoadingOverlay show={isAllocatedTab && isLoaderRefetchBusy} minHeightClassName="min-h-[12rem]">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                <th className="table-header">Order status</th>
                <th className="table-header text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allocatedOrders.map((order) => (
                <tr key={order.id} className="table-row">
                  <td className="table-cell">
                    <OrderIdBadge id={order.id} ellipsis="…" />
                  </td>
                  <td className="table-cell whitespace-normal">
                    <div className="flex flex-col">
                      <span className="font-medium text-app-fg">{order.customerName}</span>
                      {order.deliveryAddress && (
                        <span className="text-xs text-app-fg-muted">
                          {order.deliveryAddress.slice(0, 56)}
                          {order.deliveryAddress.length > 56 ? '…' : ''}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={order.status} showDot />
                  </td>
                  <td className="table-cell">
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      <Link to={`/admin/logistics/orders/${order.id}`} className="btn-secondary btn-sm">
                        View
                      </Link>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="markDelivered" />
                        <input type="hidden" name="orderId" value={order.id} />
                        <Button type="submit" variant="success" size="sm" disabled={fetcher.state !== 'idle'}>
                          Mark delivered
                        </Button>
                      </fetcher.Form>
                      {canAdjustOrder && (
                        <Link to={`/admin/logistics/orders/${order.id}`} className="btn-warning btn-sm">
                          Adjust order
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {allocatedOrders.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      title="No allocated orders"
                      description="Orders in ALLOCATED status will appear here for direct delivery confirmation."
                      variant="card"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="md:hidden space-y-3 px-1 py-1">
          {allocatedOrders.map((order) => (
            <div key={order.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <OrderIdBadge id={order.id} ellipsis="…" />
                <StatusBadge status={order.status} showDot />
              </div>
              <div>
                <p className="text-sm font-medium text-app-fg">{order.customerName}</p>
                {order.deliveryAddress && (
                  <p className="text-xs text-app-fg-muted mt-0.5">
                    {order.deliveryAddress.slice(0, 84)}
                    {order.deliveryAddress.length > 84 ? '…' : ''}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-app-border">
                <Link to={`/admin/logistics/orders/${order.id}`} className="btn-secondary btn-sm">
                  View
                </Link>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="markDelivered" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <Button type="submit" variant="success" size="sm" disabled={fetcher.state !== 'idle'}>
                    Mark delivered
                  </Button>
                </fetcher.Form>
                {canAdjustOrder && (
                  <Link to={`/admin/logistics/orders/${order.id}`} className="btn-warning btn-sm">
                    Adjust order
                  </Link>
                )}
              </div>
            </div>
          ))}
          {allocatedOrders.length === 0 && (
            <EmptyState
              title="No allocated orders"
              description="Orders in ALLOCATED status will appear here for direct delivery confirmation."
              variant="card"
            />
          )}
        </div>
        </TableLoadingOverlay>
      </div>
      )}

      {isRequestsTab && (
      <div className="card p-0">
        <div className="px-4 py-3 border-b border-app-border bg-app-elevated/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-app-fg">Delivery confirmation requests</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">
              Review approval requests submitted by riders and 3PL partners.
            </p>
          </div>
          <FormSelect
            aria-label="Request status"
            controlSize="sm"
            wrapperClassName="sm:w-44"
            value={requestStatusFilter}
            onChange={(event) => handleRequestStatusChange(event.target.value)}
            options={REQUEST_STATUS_OPTIONS}
          />
        </div>
        <TableLoadingOverlay show={isRequestsTab && isLoaderRefetchBusy} minHeightClassName="min-h-[12rem]">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                <th className="table-header">Requested by</th>
                <th className="table-header">Request status</th>
                <th className="table-header">Transition</th>
                <th className="table-header">Requested at</th>
                <th className="table-header text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => {
                const order = req.order;
                const newStatus = (req.payload?.newStatus as string) ?? 'DELIVERED';
                const canReview = requestStatusFilter === 'PENDING' && req.status === 'PENDING';
                return (
                  <tr key={req.id} className="table-row">
                    <td className="table-cell">
                      <OrderIdBadge id={req.orderId} ellipsis="…" />
                    </td>
                    <td className="table-cell whitespace-normal">
                      <div className="flex flex-col">
                        <span className="font-medium text-app-fg">{order?.customerName ?? '—'}</span>
                        {order?.deliveryAddress && (
                          <span className="text-xs text-app-fg-muted">
                            {order.deliveryAddress.slice(0, 56)}
                            {order.deliveryAddress.length > 56 ? '…' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-app-fg-muted">
                      {req.requesterName ?? 'Unknown user'}
                    </td>
                    <td className="table-cell">
                      <StatusBadge status={req.status} showDot />
                    </td>
                    <td className="table-cell text-app-fg-muted">{newStatus}</td>
                    <td className="table-cell text-app-fg-muted">
                      {new Date(req.requestedAt).toLocaleDateString('en-NG', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="table-cell">
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <Link to={`/admin/logistics/orders/${req.orderId}`} className="btn-secondary btn-sm">
                          View
                        </Link>
                        {canReview && (
                          <>
                            <Button
                              type="button"
                              variant="success"
                              size="sm"
                              disabled={fetcher.state !== 'idle'}
                              onClick={() => setApproveModal({ requestId: req.id, orderId: req.orderId })}
                            >
                                Approve
                            </Button>
                            {canAdjustOrder && (
                              <Link to={`/admin/logistics/orders/${req.orderId}`} className="btn-warning btn-sm">
                                Adjust order
                              </Link>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title={requestStatusFilter === 'PENDING' ? 'No pending confirmations' : 'No confirmation requests'}
                      description={requestStatusFilter === 'PENDING' ? 'No pending delivery confirmations.' : 'No delivery confirmation requests.'}
                      variant="card"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3 px-1 py-1">
          {requests.map((req) => {
            const order = req.order;
            const newStatus = (req.payload?.newStatus as string) ?? 'DELIVERED';
            const canReview = requestStatusFilter === 'PENDING' && req.status === 'PENDING';
            return (
              <div key={req.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <OrderIdBadge id={req.orderId} ellipsis="…" />
                  <StatusBadge status={req.status} showDot />
                </div>
                <div>
                  <p className="text-sm font-medium text-app-fg">{order?.customerName ?? '—'}</p>
                  {order?.deliveryAddress && (
                    <p className="text-xs text-app-fg-muted mt-0.5">
                      {order.deliveryAddress.slice(0, 84)}
                      {order.deliveryAddress.length > 84 ? '…' : ''}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-app-fg-muted">Requested by</p>
                    <p className="text-app-fg">{req.requesterName ?? 'Unknown user'}</p>
                  </div>
                  <div>
                    <p className="text-app-fg-muted">Transition</p>
                    <p className="text-app-fg">{newStatus}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-app-fg-muted">Requested at</p>
                    <p className="text-app-fg">
                      {new Date(req.requestedAt).toLocaleDateString('en-NG', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-app-border">
                  <Link to={`/admin/logistics/orders/${req.orderId}`} className="btn-secondary btn-sm">
                    View
                  </Link>
                  {canReview && (
                    <>
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        disabled={fetcher.state !== 'idle'}
                        onClick={() => setApproveModal({ requestId: req.id, orderId: req.orderId })}
                      >
                          Approve
                      </Button>
                      {canAdjustOrder && (
                        <Link to={`/admin/logistics/orders/${req.orderId}`} className="btn-warning btn-sm">
                          Adjust order
                        </Link>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {requests.length === 0 && (
            <EmptyState
              title={requestStatusFilter === 'PENDING' ? 'No pending confirmations' : 'No confirmation requests'}
              description={requestStatusFilter === 'PENDING' ? 'No pending delivery confirmations.' : 'No delivery confirmation requests.'}
              variant="card"
            />
          )}
        </div>
        </TableLoadingOverlay>
      </div>
      )}

      {isRequestsTab && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            {total > 0 ? `Showing ${showingFrom}–${showingTo} of ${total} confirmations` : 'No confirmations'}
          </p>
          <Pagination page={page} totalPages={totalPages} pageParam="page" />
        </div>
      )}

      {/* Approve confirmation modal */}
      {approveModal && (
        <Modal open onClose={() => setApproveModal(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-6 flex flex-col max-h-[80dvh] overflow-hidden border border-app-border bg-app-elevated">
              <h3 className="text-lg font-semibold text-app-fg shrink-0">Approve delivery confirmation</h3>
              <p className="text-sm text-app-fg-muted mt-2">
                This will mark the request as approved and proceed with the delivery transition for this order.
              </p>
              <div className="flex gap-2 justify-end shrink-0 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Button type="button" variant="secondary" size="sm" onClick={() => setApproveModal(null)}>
                  Cancel
                </Button>
                <fetcher.Form method="post" onSubmit={() => setApproveModal(null)}>
                  <input type="hidden" name="intent" value="approve" />
                  <input type="hidden" name="requestId" value={approveModal.requestId} />
                  <Button type="submit" variant="success" size="sm" loading={fetcher.state !== 'idle'}>
                    Confirm approve
                  </Button>
                </fetcher.Form>
              </div>
        </Modal>
      )}
    </div>
  );
}
