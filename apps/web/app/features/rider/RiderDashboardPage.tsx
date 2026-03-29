import { useState, useEffect, useCallback } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { Tabs } from '~/components/ui/tabs';
import { useOnlineStatus, usePendingCount } from '~/hooks/useOnlineStatus';
import { queueDeliveryConfirmation } from '~/lib/offline-sync';
import type { Order } from './types';

interface RiderDashboardPageProps {
  orders: Order[];
  dispatchedOrders: Order[];
  total: number;
  dispatchedTotal: number;
  userId: string;
}

export function RiderDashboardPage({ orders, dispatchedOrders, total, dispatchedTotal }: RiderDashboardPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string | null }>();
  const isOnline = useOnlineStatus();
  const pendingCount = usePendingCount();

  useFetcherToast(fetcher.data, { successMessage: 'Delivery updated' });
  const [activeTab, setActiveTab] = useState<'transit' | 'pickup'>('transit');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'RETURNED' | 'IN_TRANSIT' | null>(null);
  const [reason, setReason] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [deliveredQty, setDeliveredQty] = useState('');
  const [returnedQty, setReturnedQty] = useState('');
  const [deliveryFeeAddOn, setDeliveryFeeAddOn] = useState('');

  // Auto-capture GPS on component mount
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGpsError('GPS not available on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsError(null);
      },
      (err) => {
        setGpsError(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  const fetcherError = fetcher.data?.error ?? null;
  const [dismissedError, setDismissedError] = useState(false);

  useEffect(() => {
    if (fetcherError) setDismissedError(false);
  }, [fetcherError]);

  // Reset form when fetcher succeeds
  useEffect(() => {
    if (fetcher.data?.success) {
      setSelectedOrder(null);
      setActionType(null);
      setReason('');
    }
  }, [fetcher.data]);

  const handleOfflineSubmit = useCallback(
    async (orderId: string, status: 'RETURNED') => {
      await queueDeliveryConfirmation({
        orderId,
        status,
        returnReason: reason || undefined,
      });
      setSelectedOrder(null);
      setActionType(null);
      setReason('');
    },
    [reason],
  );

  const isSubmitting = fetcher.state !== 'idle';

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-app-fg">
            My Deliveries
          </h1>
          <div className="flex items-center gap-2">
            {/* Online status badge */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                isOnline
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
              {isOnline ? 'Online' : 'Offline'}
            </span>
            {/* Pending offline count */}
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                {pendingCount} pending
              </span>
            )}
          </div>
        </div>

        <Tabs
          variant="pill"
          className="mt-3"
          value={activeTab}
          onChange={(v) => {
            setActiveTab(v as typeof activeTab);
            setSelectedOrder(null);
            setActionType(null);
          }}
          tabs={[
            { value: 'transit', label: `In Transit (${total})` },
            { value: 'pickup', label: `Pickup (${dispatchedTotal})` },
          ]}
        />
      </div>

      {/* GPS status */}
      {gpsError && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
          {gpsError}
        </div>
      )}
      {gps && (
        <div className="mb-4 rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-400">
          GPS: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
        </div>
      )}

      {/* Error from action */}
      {fetcherError && !dismissedError && (
        <PageNotification
          variant="error"
          message={fetcherError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
          className="mb-4"
        />
      )}

      {/* Empty state */}
      {activeTab === 'transit' && orders.length === 0 && (
        <div className="mt-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-app-hover">
            <svg className="h-8 w-8 text-app-fg-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-.752a2.25 2.25 0 0 0-1.342.447L13.5 12l-2.654-1.94A2.25 2.25 0 0 0 9.504 9.56H3.375c-.621 0-1.125.504-1.125 1.125v4.5c0 .621.504 1.125 1.125 1.125H6.75" />
            </svg>
          </div>
          <p className="text-app-fg-muted">No deliveries in transit</p>
        </div>
      )}
      {activeTab === 'pickup' && dispatchedOrders.length === 0 && (
        <div className="mt-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-app-hover">
            <svg className="h-8 w-8 text-app-fg-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25" />
            </svg>
          </div>
          <p className="text-app-fg-muted">No orders waiting for pickup</p>
        </div>
      )}

      {/* Pickup list (DISPATCHED orders) — rider confirms departure */}
      {activeTab === 'pickup' && (
        <div className="space-y-3">
          {dispatchedOrders.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border border-app-border bg-app-elevated p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-app-fg">{order.customerName}</p>
                  <p className="mt-0.5 text-xs text-app-fg-muted">{order.id.slice(0, 8)}...</p>
                </div>
                {order.totalAmount && (
                  <span className="text-sm font-semibold text-app-fg-muted">
                    &#8358;{parseFloat(order.totalAmount).toLocaleString()}
                  </span>
                )}
              </div>
              {order.deliveryAddress && (
                <p className="mt-2 text-sm text-app-fg-muted">{order.deliveryAddress}</p>
              )}
              {order.deliveryNotes && (
                <p className="mt-1 text-xs italic text-app-fg-muted">Note: {order.deliveryNotes}</p>
              )}
              <fetcher.Form method="POST" className="mt-3">
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="newStatus" value="IN_TRANSIT" />
                {gps && <input type="hidden" name="gpsLat" value={gps.lat.toString()} />}
                {gps && <input type="hidden" name="gpsLng" value={gps.lng.toString()} />}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50 active:bg-brand-700"
                  style={{ minHeight: '48px' }}
                >
                  {isSubmitting ? 'Starting...' : 'Start Delivery'}
                </button>
              </fetcher.Form>
            </div>
          ))}
        </div>
      )}

      {/* In Transit order list */}
      {activeTab === 'transit' && (
      <div className="space-y-3">
        {orders.map((order) => (
          <div
            key={order.id}
            className={`rounded-xl border p-4 transition-colors cursor-pointer ${
              selectedOrder?.id === order.id
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                : 'border-app-border bg-app-elevated'
            }`}
            onClick={() => {
              setSelectedOrder(selectedOrder?.id === order.id ? null : order);
              setActionType(null);
              setOtpInput('');
              setReason('');
              setDeliveredQty('');
              setReturnedQty('');
              setDeliveryFeeAddOn('');
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-app-fg">
                  {order.customerName}
                </p>
                <p className="mt-0.5 text-xs text-app-fg-muted">
                  {order.id.slice(0, 8)}...
                </p>
              </div>
              {order.totalAmount && (
                <span className="text-sm font-semibold text-app-fg-muted">
                  &#8358;{parseFloat(order.totalAmount).toLocaleString()}
                </span>
              )}
            </div>

            {order.deliveryAddress && (
              <p className="mt-2 text-sm text-app-fg-muted">
                {order.deliveryAddress}
              </p>
            )}
            {order.deliveryNotes && (
              <p className="mt-1 text-xs italic text-app-fg-muted">
                Note: {order.deliveryNotes}
              </p>
            )}

            {/* Expanded delivery form */}
            {selectedOrder?.id === order.id && (
              <div className="mt-4 border-t border-surface-200 pt-4 dark:border-surface-700">
                {/* v1: Only 3PL marks delivered. Rider can only mark Returned. */}
                {!actionType && (
                  <div className="space-y-2">
                    <p className="text-sm text-app-fg-muted">
                      Your 3PL manager will confirm delivery. If the customer rejects, mark as Returned below.
                    </p>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setActionType('RETURNED'); }}
                      className="w-full rounded-lg bg-red-600 py-3.5 text-sm font-semibold text-white active:bg-red-700"
                      style={{ minHeight: '48px' }}
                    >
                      Reject / Return
                    </button>
                  </div>
                )}

                {/* RETURNED form */}
                {actionType === 'RETURNED' && (
                  <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="block text-sm font-medium text-app-fg-muted">
                      Return Reason (min 10 characters)
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-app-border bg-white px-4 py-3 text-sm dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                      placeholder="Customer refused, wrong address, etc."
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setActionType(null)}
                        className="flex-1 rounded-lg border border-app-border py-3 text-sm font-medium text-app-fg-muted dark:border-surface-600 dark:text-surface-300"
                        style={{ minHeight: '48px' }}
                      >
                        Back
                      </button>
                      {isOnline ? (
                        <fetcher.Form method="POST" className="flex-1">
                          <input type="hidden" name="orderId" value={order.id} />
                          <input type="hidden" name="newStatus" value="RETURNED" />
                          <input type="hidden" name="reason" value={reason} />
                          {gps && <input type="hidden" name="gpsLat" value={gps.lat.toString()} />}
                          {gps && <input type="hidden" name="gpsLng" value={gps.lng.toString()} />}
                          <button
                            type="submit"
                            disabled={reason.length < 10 || isSubmitting}
                            className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-50 active:bg-red-700"
                            style={{ minHeight: '48px' }}
                          >
                            {isSubmitting ? 'Submitting...' : 'Submit Return'}
                          </button>
                        </fetcher.Form>
                      ) : (
                        <button
                          type="button"
                          disabled={reason.length < 10}
                          onClick={() => handleOfflineSubmit(order.id, 'RETURNED')}
                          className="flex-1 rounded-lg bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          style={{ minHeight: '48px' }}
                        >
                          Save Offline
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
