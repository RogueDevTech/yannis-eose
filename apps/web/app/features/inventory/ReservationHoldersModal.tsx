import { useEffect, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OverdueAllocationBadge } from '~/components/ui/overdue-allocation-badge';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { ReservationHoldersData } from '~/routes/api.inventory-reservations';

type LoadResult = { ok: true; data: ReservationHoldersData } | { ok: false; error: string };
type ReleaseResult = { success: boolean; error?: string; message?: string; warning?: string | null };

/**
 * Reserved stock breakdown for one product at one logistics location: the
 * orders holding it and how long each has waited. Reservations release
 * automatically after the company's N days; with
 * `inventory.reservations.release` a user can release selected orders early.
 * Released orders keep their status.
 */
export function ReservationHoldersModal({
  productId,
  locationId,
  productName,
  locationName,
  canRelease,
  onClose,
}: {
  productId: string;
  locationId: string;
  productName: string;
  locationName: string;
  canRelease: boolean;
  onClose: () => void;
}) {
  const loadFetcher = useFetcher<LoadResult>();
  const closeFetcher = useFetcher<ReleaseResult>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');

  const loadUrl = `/api/inventory-reservations?productId=${encodeURIComponent(productId)}&locationId=${encodeURIComponent(locationId)}`;
  useEffect(() => {
    loadFetcher.load(loadUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUrl]);

  useFetcherToast(closeFetcher.data);
  // After a release: refresh this list and the inventory page behind it
  // (the hook revalidates + busts the cached loader). The modal stays open.
  useCloseOnFetcherSuccess(closeFetcher, () => {
    setSelected(new Set());
    setReason('');
    loadFetcher.load(loadUrl);
  });

  const result = loadFetcher.data;
  const data = result && result.ok ? result.data : null;
  const orders = data?.orders ?? [];
  const overdueCount = useMemo(() => orders.filter((o) => o.overdue).length, [orders]);
  const allIds = useMemo(() => orders.map((o) => o.orderId), [orders]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const loading = loadFetcher.state === 'loading' && !data;
  const submitting = closeFetcher.state !== 'idle';

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" contentClassName="p-5 space-y-4 bg-app-elevated">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-app-fg leading-snug">Reserved: {productName}</h3>
          <p className="text-sm text-app-fg-muted mt-0.5 truncate">{locationName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors shrink-0"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loading && <p className="text-sm text-app-fg-muted">Loading orders…</p>}
      {result && !result.ok && <p className="text-sm text-danger-600">{result.error}</p>}

      {data && (
        <>
          <p className="text-sm text-app-fg-muted">
            {data.reserved} reserved, held by {orders.length} {orders.length === 1 ? 'order' : 'orders'} with logistics.
            {overdueCount > 0 && <> {overdueCount} past the limit, released within the hour.</>}
          </p>
          <p className="text-xs text-app-fg-muted">
            {data.releaseAfterDays > 0
              ? `Reserved stock is released automatically after ${data.releaseAfterDays} days with logistics. The order keeps its status.`
              : 'Automatic release is off for this company.'}
          </p>
          {data.unlinkedReserved > 0 && (
            <p className="rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-300">
              {data.unlinkedReserved} reserved with no order behind them. This is a count error, not a real hold.
            </p>
          )}

          {orders.length === 0 ? (
            <p className="text-sm text-app-fg-muted">No orders hold this stock.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-app-border divide-y divide-app-border">
              {canRelease && (
                <label className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-app-fg-muted bg-app-bg">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
                  />
                  Select all
                </label>
              )}
              {orders.map((o) => (
                <div key={o.orderId} className="flex items-center gap-3 px-3 py-2">
                  {canRelease && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${o.orderNumber}`}
                      checked={selected.has(o.orderId)}
                      onChange={() => toggle(o.orderId)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        to={`/admin/orders/${o.orderId}`}
                        className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        {o.orderNumber}
                      </Link>
                      <OrderStatusBadge status={o.status} expanded />
                      {o.overdue && <OverdueAllocationBadge status={o.status} allocatedAt={o.allocatedAt} thresholdDays={data.releaseAfterDays} />}
                    </div>
                    <p className="text-xs text-app-fg-muted truncate">
                      {o.daysWaiting != null ? `${o.daysWaiting} days with logistics` : 'No allocation date'}
                      {o.closerName ? ` · ${o.closerName}` : ''}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums text-app-fg shrink-0">x{o.quantity}</span>
                </div>
              ))}
            </div>
          )}

          {canRelease && selected.size > 0 && (
            <closeFetcher.Form method="post" action="/api/inventory-reservations" className="space-y-3 border-t border-app-border pt-3">
              {[...selected].map((id) => (
                <input key={id} type="hidden" name="orderIds" value={id} />
              ))}
              <p className="text-xs text-app-fg-muted">
                The stock becomes available again. The orders stay with logistics; delivering one later still deducts its stock.
              </p>
              <Textarea
                name="reason"
                label="Reason"
                rows={2}
                maxLength={500}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. 3PL confirmed these were never dispatched"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setSelected(new Set())} disabled={submitting}>
                  Clear
                </Button>
                <Button type="submit" variant="primary" disabled={submitting || reason.trim().length < 10}>
                  {submitting ? 'Releasing…' : `Release stock (${selected.size})`}
                </Button>
              </div>
            </closeFetcher.Form>
          )}
        </>
      )}
    </Modal>
  );
}
