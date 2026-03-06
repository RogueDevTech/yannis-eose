import { useState, useEffect } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { DeferredSection } from '~/components/ui/deferred-section';
import { FileUpload } from '~/components/ui/file-upload';
import { useFetcherToast } from '~/components/ui/toast';
import { S3_FOLDERS } from '~/lib/s3-upload';
import type { OrderDetail, HistoryEntry } from '~/features/orders/types';
import type { Location } from '~/features/logistics/types';

export interface RiderOption {
  id: string;
  name: string;
  logisticsLocationId: string | null;
}

export interface LogisticsOrderDetailPageProps {
  order: OrderDetail;
  history: Promise<HistoryEntry[]>;
  locations: Location[];
  riders: RiderOption[];
  /** Back link (e.g. "/tpl/orders" for TPL, "/admin/logistics/orders" for admin) */
  backLink?: string;
  /** When provided (e.g. TPL), only these locations in allocate dropdown */
  allocatableLocations?: Location[];
}

const DEFAULT_BACK_LINK = '/admin/logistics/orders';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDeliveryDate(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function LogisticsOrderDetailPage({
  order,
  history,
  locations,
  riders,
  backLink = DEFAULT_BACK_LINK,
  allocatableLocations: allocatableLocationsProp,
}: LogisticsOrderDetailPageProps) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher.data, { successMessage: 'Order updated' });

  const [deliveryProofUrl, setDeliveryProofUrl] = useState('');
  const [deliveryCost, setDeliveryCost] = useState('');
  const [partialDeliveryProofUrl, setPartialDeliveryProofUrl] = useState('');
  const [partialDeliveryCost, setPartialDeliveryCost] = useState('');

  useEffect(() => {
    setDeliveryProofUrl('');
    setDeliveryCost('');
    setPartialDeliveryProofUrl('');
    setPartialDeliveryCost('');
  }, [order.id]);

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean }).success) {
      setDeliveryProofUrl('');
      setDeliveryCost('');
      setPartialDeliveryProofUrl('');
      setPartialDeliveryCost('');
    }
  }, [fetcher.data]);

  const allowed = order.allowedTransitions ?? [];
  const ridersForOrder =
    order.logisticsLocationId && order.status === 'ALLOCATED'
      ? riders.filter((r) => r.logisticsLocationId === order.logisticsLocationId)
      : riders;
  const allocatableLocations = allocatableLocationsProp ?? locations.filter((l) => l.status === 'ACTIVE');

  const isSubmitting = fetcher.state === 'submitting';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={backLink}
            className="p-1.5 rounded-lg text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-200"
            aria-label="Back to Logistics Orders"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-surface-900 dark:text-white truncate font-mono">
              {order.id.slice(0, 8)}...
            </h1>
            <OrderStatusBadge status={order.status} />
          </div>
        </div>
      </div>

      {/* Customer info */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">Customer</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-surface-600 dark:text-surface-400">Name: </span>
            <span className="font-medium text-surface-900 dark:text-surface-100">{order.customerName}</span>
          </div>
          <div>
            <span className="text-surface-600 dark:text-surface-400">Phone: </span>
            <span className="font-medium text-surface-900 dark:text-surface-100">{order.customerPhoneDisplay}</span>
          </div>
          {order.customerAddress && (
            <div className="sm:col-span-2">
              <span className="text-surface-600 dark:text-surface-400">Address: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">{order.customerAddress}</span>
            </div>
          )}
          {order.deliveryAddress && (
            <div className="sm:col-span-2">
              <span className="text-surface-600 dark:text-surface-400">Delivery address: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">{order.deliveryAddress}</span>
            </div>
          )}
          {order.deliveryNotes && (
            <div className="sm:col-span-2">
              <span className="text-surface-600 dark:text-surface-400">Delivery notes: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">{order.deliveryNotes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Order items */}
      {order.orderItems && order.orderItems.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">Items</h2>
          <div className="space-y-2">
            {order.orderItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-surface-900 dark:text-surface-100">
                    {item.productName ?? item.productId.slice(0, 8)}
                  </span>
                  <span className="text-surface-600 dark:text-surface-400 ml-2">x{item.quantity}</span>
                </div>
                <span className="font-medium text-surface-900 dark:text-surface-100">
                  ₦{(Number(item.unitPrice) * item.quantity).toLocaleString()}
                </span>
              </div>
            ))}
            {order.totalAmount && (
              <div className="flex items-center justify-between text-sm pt-2 border-t border-surface-200 dark:border-surface-700">
                <span className="font-semibold text-surface-900 dark:text-white">Total</span>
                <span className="font-bold text-surface-900 dark:text-white">
                  ₦{Number(order.totalAmount).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delivery info */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">Delivery</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {order.preferredDeliveryDate && (
            <div>
              <span className="text-surface-600 dark:text-surface-400">Preferred date: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">
                {formatDeliveryDate(order.preferredDeliveryDate)}
              </span>
            </div>
          )}
          {order.logisticsLocationName && (
            <div>
              <span className="text-surface-600 dark:text-surface-400">Location: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">{order.logisticsLocationName}</span>
            </div>
          )}
          {order.riderName && (
            <div>
              <span className="text-surface-600 dark:text-surface-400">Rider: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">{order.riderName}</span>
            </div>
          )}
          {order.allocatedAt && (
            <div>
              <span className="text-surface-600 dark:text-surface-400">Allocated: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">{formatDate(order.allocatedAt)}</span>
            </div>
          )}
          {order.dispatchedAt && (
            <div>
              <span className="text-surface-600 dark:text-surface-400">Dispatched: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">{formatDate(order.dispatchedAt)}</span>
            </div>
          )}
          {order.deliveredAt && (
            <div>
              <span className="text-surface-600 dark:text-surface-400">Delivered: </span>
              <span className="font-medium text-surface-900 dark:text-surface-100">{formatDate(order.deliveredAt)}</span>
            </div>
          )}
          {(order.status === 'DELIVERED' || order.status === 'COMPLETED' || order.status === 'PARTIALLY_DELIVERED') && (
            <div className="sm:col-span-2 pt-2 border-t border-surface-200 dark:border-surface-700">
              <span className="text-surface-600 dark:text-surface-400">Remittance: </span>
              {order.remittanceStatus ? (
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                    order.remittanceStatus === 'RECEIVED'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : order.remittanceStatus === 'DISPUTED'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      order.remittanceStatus === 'RECEIVED'
                        ? 'bg-green-500'
                        : order.remittanceStatus === 'DISPUTED'
                          ? 'bg-red-500'
                          : 'bg-yellow-500'
                    }`}
                  />
                  {order.remittanceStatus === 'SENT'
                    ? 'Pending Confirmation'
                    : order.remittanceStatus === 'RECEIVED'
                      ? 'Received'
                      : order.remittanceStatus}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-surface-400" />
                  Not Remitted
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">Actions</h2>
        <div className="space-y-3">
          {order.status === 'CONFIRMED' && allowed.includes('ALLOCATED') && (
            <fetcher.Form method="post" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="intent" value="allocate" />
              <div>
                <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                  Allocate to location
                </label>
                <select
                  name="logisticsLocationId"
                  required
                  className="input py-1.5 min-w-[180px]"
                  disabled={isSubmitting}
                >
                  <option value="">Select location</option>
                  {allocatableLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                Allocate
              </Button>
            </fetcher.Form>
          )}

          {order.status === 'ALLOCATED' && allowed.includes('DISPATCHED') && (
            <fetcher.Form method="post" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="intent" value="dispatch" />
              <div>
                <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                  Assign rider
                </label>
                <select name="riderId" required className="input py-1.5 min-w-[180px]" disabled={isSubmitting}>
                  <option value="">{ridersForOrder.length === 0 ? 'No riders at location' : 'Select rider'}</option>
                  {ridersForOrder.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={isSubmitting}
                disabled={isSubmitting || ridersForOrder.length === 0}
              >
                Dispatch
              </Button>
            </fetcher.Form>
          )}

          {order.status === 'DISPATCHED' && allowed.includes('IN_TRANSIT') && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="transition" />
              <input type="hidden" name="newStatus" value="IN_TRANSIT" />
              <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                Mark In Transit
              </Button>
            </fetcher.Form>
          )}

          {order.status === 'IN_TRANSIT' && (
            <div className="space-y-2">
              {allowed.includes('DELIVERED') && (
                <fetcher.Form method="post" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="intent" value="transition" />
                  <input type="hidden" name="newStatus" value="DELIVERED" />
                  {deliveryProofUrl ? (
                    <input type="hidden" name="deliveryProofUrl" value={deliveryProofUrl} />
                  ) : null}
                  <div>
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                      Delivery cost (₦) — optional
                    </label>
                    <input
                      type="number"
                      name="deliveryFeeAddOn"
                      min={0}
                      step="0.01"
                      value={deliveryCost}
                      onChange={(e) => setDeliveryCost(e.target.value)}
                      className="input w-24 py-1.5"
                      placeholder="0"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="min-w-[180px]">
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                      Screenshot — optional
                    </label>
                    <FileUpload
                      folder={S3_FOLDERS.DELIVERY_PROOF}
                      onUpload={setDeliveryProofUrl}
                      accept="image/*"
                      label="Upload"
                    />
                  </div>
                  <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                    Mark Delivered
                  </Button>
                </fetcher.Form>
              )}
              {allowed.includes('PARTIALLY_DELIVERED') && (
                <fetcher.Form method="post" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="intent" value="transition" />
                  <input type="hidden" name="newStatus" value="PARTIALLY_DELIVERED" />
                  {partialDeliveryProofUrl ? (
                    <input type="hidden" name="deliveryProofUrl" value={partialDeliveryProofUrl} />
                  ) : null}
                  <div>
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                      Delivered qty
                    </label>
                    <input
                      type="number"
                      name="deliveredQuantity"
                      min={0}
                      required
                      className="input w-20 py-1.5"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                      Returned qty
                    </label>
                    <input
                      type="number"
                      name="returnedQuantity"
                      min={0}
                      required
                      className="input w-20 py-1.5"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                      Delivery cost (₦) — optional
                    </label>
                    <input
                      type="number"
                      name="deliveryFeeAddOn"
                      min={0}
                      step="0.01"
                      value={partialDeliveryCost}
                      onChange={(e) => setPartialDeliveryCost(e.target.value)}
                      className="input w-24 py-1.5"
                      placeholder="0"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="min-w-[180px]">
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                      Screenshot — optional
                    </label>
                    <FileUpload
                      folder={S3_FOLDERS.DELIVERY_PROOF}
                      onUpload={setPartialDeliveryProofUrl}
                      accept="image/*"
                      label="Upload"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                      Reason
                    </label>
                    <input
                      type="text"
                      name="reason"
                      className="input min-w-[140px] py-1.5"
                      placeholder="Partial delivery reason"
                      disabled={isSubmitting}
                    />
                  </div>
                  <Button type="submit" variant="secondary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                    Partially Delivered
                  </Button>
                </fetcher.Form>
              )}
              {allowed.includes('RETURNED') && (
                <fetcher.Form method="post" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="intent" value="transition" />
                  <input type="hidden" name="newStatus" value="RETURNED" />
                  <div>
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">
                      Reason
                    </label>
                    <input
                      type="text"
                      name="reason"
                      required
                      minLength={10}
                      className="input min-w-[200px] py-1.5"
                      placeholder="Return reason (min 10 chars)"
                      disabled={isSubmitting}
                    />
                  </div>
                  <Button type="submit" variant="secondary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                    Mark Returned
                  </Button>
                </fetcher.Form>
              )}
            </div>
          )}

          {order.status === 'RETURNED' && (
            <div className="flex flex-wrap gap-2">
              {allowed.includes('RESTOCKED') && (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="transition" />
                  <input type="hidden" name="newStatus" value="RESTOCKED" />
                  <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                    Restock
                  </Button>
                </fetcher.Form>
              )}
              {allowed.includes('WRITTEN_OFF') && (
                <fetcher.Form method="post" className="flex items-end gap-2">
                  <input type="hidden" name="intent" value="transition" />
                  <input type="hidden" name="newStatus" value="WRITTEN_OFF" />
                  <input
                    type="text"
                    name="reason"
                    required
                    minLength={10}
                    className="input min-w-[180px] py-1.5"
                    placeholder="Damage note (min 10 chars)"
                    disabled={isSubmitting}
                  />
                  <Button type="submit" variant="secondary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                    Write Off
                  </Button>
                </fetcher.Form>
              )}
            </div>
          )}

          {!['CONFIRMED', 'ALLOCATED', 'DISPATCHED', 'IN_TRANSIT', 'RETURNED'].includes(order.status) && (
            <p className="text-sm text-surface-600 dark:text-surface-400">No actions available for this status.</p>
          )}
        </div>
      </div>

      {/* History timeline (deferred) */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">History</h2>
        <DeferredSection resolve={history} skeleton="list">
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-sm text-surface-600 dark:text-surface-400">No history yet.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((entry) => (
                  <li key={entry.id} className="text-sm border-l-2 border-surface-200 dark:border-surface-700 pl-3 py-0.5">
                    <span className="text-surface-600 dark:text-surface-400">{formatDate(entry.validFrom)}</span>
                    <span className="text-surface-800 dark:text-surface-200 ml-2">
                      {entry.action}
                      {entry.changedBy && (
                        <span className="text-surface-500 dark:text-surface-400"> by {entry.changedBy}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </DeferredSection>
      </div>
    </div>
  );
}
