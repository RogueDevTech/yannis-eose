import { useState, useEffect } from 'react';
import { useFetcher, Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { FileUpload } from '~/components/ui/file-upload';
import { Modal } from '~/components/ui/modal';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { useFetcherToast } from '~/components/ui/toast';

export interface RemittanceRecord {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  productId: string;
  productName: string;
  quantitySent: number;
  quantityReceived: number | null;
  receiptUrl: string;
  status: string;
  sentAt: string;
  fromLocationName: string;
  toLocationName: string;
  shrinkageReason: string | null;
}

export interface DeliveryRemittanceRecord {
  id: string;
  logisticsLocationId: string;
  sentBy: string;
  receiptUrls: string[];
  status: string;
  sentAt: string;
  locationName: string | null;
  orderCount: number;
}

export interface DeliveryRemittanceEligibleOrder {
  id: string;
  customerName: string;
  totalAmount: string | null;
  deliveredAt: string | null;
}

export interface RemitPageProps {
  remittances: RemittanceRecord[];
  products: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  userLocationId: string | null;
  deliveryRemittances: DeliveryRemittanceRecord[];
  eligibleOrders: DeliveryRemittanceEligibleOrder[];
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending receipt',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

const DELIVERY_REMIT_STATUS: Record<string, string> = {
  SENT: 'Pending (Finance to confirm)',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

export function RemitPage({
  remittances,
  products,
  locations,
  userLocationId,
  deliveryRemittances,
  eligibleOrders,
}: RemitPageProps) {
  const fetcher = useFetcher();
  const [receiptUploaded, setReceiptUploaded] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [deliveryReceiptUrls, setDeliveryReceiptUrls] = useState<string[]>([]);
  const [remittanceReceiptModal, setRemittanceReceiptModal] = useState<RemittanceRecord | null>(null);

  useFetcherToast(fetcher.data, {
    successMessage:
      fetcher.formData?.get('intent') === 'createDeliveryRemittance'
        ? 'Delivery remittance submitted'
        : 'Remittance submitted',
  });

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean }).success && fetcher.formData?.get('intent') === 'createDeliveryRemittance') {
      setSelectedOrderIds(new Set());
      setDeliveryReceiptUrls([]);
    }
  }, [fetcher.data, fetcher.formData?.get('intent')]);

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllOrders = () => {
    setSelectedOrderIds(new Set(eligibleOrders.map((o) => o.id)));
  };

  const clearOrderSelection = () => {
    setSelectedOrderIds(new Set());
  };

  const addDeliveryReceipt = (url: string) => {
    setDeliveryReceiptUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
  };

  const toLocationOptions = userLocationId
    ? locations.filter((l) => l.id !== userLocationId)
    : locations;

  const isSubmitting = fetcher.state === 'submitting';

  const isSubmittingDelivery = fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'createDeliveryRemittance';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Remit</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Stock transfer to warehouse, or delivery remittance (batch delivered orders + payment receipts for Finance).
        </p>
      </div>

      {/* Delivery remittance: select orders + payment receipts → Finance marks received */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">Delivery remittance</h2>
        <p className="text-sm text-surface-600 dark:text-surface-400 mb-4">
          Select the delivered orders you want to include in this remittance and attach payment receipt(s). Finance will review and mark as received (end of day).
        </p>
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="createDeliveryRemittance" />
          <input type="hidden" name="orderIds" value={JSON.stringify([...selectedOrderIds])} />
          <input type="hidden" name="receiptUrls" value={JSON.stringify(deliveryReceiptUrls)} />
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
                Select orders to remit
                {eligibleOrders.length > 0 && (
                  <span className="font-normal text-surface-500 dark:text-surface-400 ml-1">
                    ({eligibleOrders.length} available)
                  </span>
                )}
              </label>
              {eligibleOrders.length > 0 && (
                <div className="flex items-center gap-2">
                  <PageRefreshButton />
                  <button
                    type="button"
                    onClick={selectAllOrders}
                    disabled={isSubmittingDelivery}
                    className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
                  >
                    Select all
                  </button>
                  <span className="text-surface-400">·</span>
                  <button
                    type="button"
                    onClick={clearOrderSelection}
                    disabled={isSubmittingDelivery}
                    className="text-xs font-medium text-surface-600 dark:text-surface-400 hover:underline disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {eligibleOrders.length === 0 ? (
              <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 px-4 py-4 text-sm text-surface-600 dark:text-surface-400">
                <p className="font-medium text-surface-700 dark:text-surface-300 mb-1">No delivered orders available to remit</p>
                <p className="mb-2">
                  Orders delivered at your location will appear here once they are marked as Delivered and not yet included in a remittance.
                </p>
                <Link to="/tpl/orders" className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
                  View orders →
                </Link>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-800">
                {eligibleOrders.map((order) => (
                  <label
                    key={order.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedOrderIds.has(order.id)}
                      onChange={() => toggleOrder(order.id)}
                      disabled={isSubmittingDelivery}
                    />
                    <span className="font-mono text-xs text-surface-500 dark:text-surface-400 shrink-0 w-20 truncate" title={order.id}>
                      {order.id.slice(0, 8)}…
                    </span>
                    <span className="text-sm text-surface-900 dark:text-white truncate min-w-0">{order.customerName}</span>
                    <span className="text-xs text-surface-500 dark:text-surface-400 shrink-0">
                      {order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString() : '—'}
                    </span>
                    {order.totalAmount != null && (
                      <span className="text-xs font-medium text-surface-700 dark:text-surface-300 shrink-0">
                        ₦{Number(order.totalAmount).toLocaleString()}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
            {eligibleOrders.length > 0 && selectedOrderIds.size > 0 && (
              <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                {selectedOrderIds.size} order(s) selected for this remittance
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
              Payment receipt(s) (required)
            </label>
            <FileUpload
              folder={S3_FOLDERS.RECEIPTS}
              label="Upload receipt"
              required={deliveryReceiptUrls.length === 0}
              onUpload={addDeliveryReceipt}
            />
            {deliveryReceiptUrls.length > 0 && (
              <p className="text-xs text-success-600 dark:text-success-400 mt-1">
                {deliveryReceiptUrls.length} receipt(s) attached
              </p>
            )}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={isSubmittingDelivery}
            loadingText="Submitting..."
            disabled={
              isSubmittingDelivery || selectedOrderIds.size === 0 || deliveryReceiptUrls.length === 0
            }
          >
            Submit delivery remittance
          </Button>
        </fetcher.Form>
        {deliveryRemittances.length > 0 && (
          <div className="mt-6 pt-4 border-t border-surface-200 dark:border-surface-700">
            <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Your delivery remittances</h3>
            <ul className="space-y-2 text-sm">
              {deliveryRemittances.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      r.status === 'RECEIVED'
                        ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300'
                        : r.status === 'DISPUTED'
                          ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300'
                          : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300'
                    }`}
                  >
                    {DELIVERY_REMIT_STATUS[r.status] ?? r.status}
                  </span>
                  <span className="text-surface-600 dark:text-surface-400">
                    {r.orderCount} order(s) · {new Date(r.sentAt).toLocaleDateString()}
                  </span>
                  {(r.receiptUrls ?? []).length > 0 && (
                    <span className="flex items-center gap-1.5 flex-wrap">
                      {(r.receiptUrls ?? []).map((url, i) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-600 dark:text-brand-400 hover:underline text-xs"
                        >
                          View receipt{(r.receiptUrls?.length ?? 0) > 1 ? ` ${i + 1}` : ''}
                        </a>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Stock transfer to warehouse */}
      <div className="card p-6 max-w-lg">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Stock transfer to warehouse</h2>
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="createRemittance" />
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Product</label>
            <select
              name="productId"
              required
              className="input w-full"
              disabled={isSubmitting}
            >
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Send to location</label>
            <select
              name="toLocationId"
              required
              className="input w-full"
              disabled={isSubmitting}
            >
              <option value="">Select warehouse / location</option>
              {toLocationOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Quantity sent</label>
            <input
              type="number"
              name="quantitySent"
              min={1}
              required
              className="input w-full"
              disabled={isSubmitting}
            />
          </div>
          <FileUpload
            folder={S3_FOLDERS.RECEIPTS}
            name="receiptUrl"
            label="Receipt (required)"
            required
            onUpload={(url) => setReceiptUploaded(!!url)}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={isSubmitting}
            loadingText="Submitting..."
            disabled={isSubmitting || !receiptUploaded}
          >
            Submit remittance
          </Button>
        </fetcher.Form>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Your remittances</h2>
        {remittances.length === 0 ? (
          <p className="text-sm text-surface-600 dark:text-surface-400">No remittances yet.</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200 dark:border-surface-700">
                    <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Product</th>
                    <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">To</th>
                    <th className="text-right py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Qty</th>
                    <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Status</th>
                    <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Sent</th>
                    <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {remittances.map((r) => (
                    <tr key={r.id} className="border-b border-surface-100 dark:border-surface-800">
                      <td className="py-2 px-3 text-surface-900 dark:text-white">{r.productName}</td>
                      <td className="py-2 px-3 text-surface-800 dark:text-surface-200">{r.toLocationName}</td>
                      <td className="py-2 px-3 text-right">
                        {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : r.quantitySent}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            r.status === 'RECEIVED'
                              ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300'
                              : r.status === 'DISPUTED'
                                ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300'
                                : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300'
                          }`}
                        >
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-surface-600 dark:text-surface-400">
                        {new Date(r.sentAt).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-3">
                        <Button type="button" variant="ghost" size="sm" className="text-brand-600 dark:text-brand-400 hover:underline h-auto p-0" onClick={() => setRemittanceReceiptModal(r)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-3 px-1">
              {remittances.map((r) => (
                <div key={r.id} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-medium text-surface-900 dark:text-white">{r.productName}</p>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                        r.status === 'RECEIVED'
                          ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300'
                          : r.status === 'DISPUTED'
                            ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300'
                            : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300'
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <div className="text-sm text-surface-800 dark:text-surface-200 space-y-0.5 mb-2">
                    <div>To: {r.toLocationName}</div>
                    <div>Qty: {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : r.quantitySent}</div>
                    <div>Sent: {new Date(r.sentAt).toLocaleDateString()}</div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="btn-ghost btn-sm" onClick={() => setRemittanceReceiptModal(r)}>
                    View receipt
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Remittance receipt modal */}
      {remittanceReceiptModal?.receiptUrl && (
        <Modal open onClose={() => setRemittanceReceiptModal(null)} maxWidth="max-w-lg" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
          <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700 shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Remittance receipt</h3>
            <button type="button" onClick={() => setRemittanceReceiptModal(null)} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
              <p className="font-medium text-surface-900 dark:text-white">{remittanceReceiptModal.productName}</p>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                To: {remittanceReceiptModal.toLocationName}
              </p>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
                Qty: {remittanceReceiptModal.quantityReceived != null ? `${remittanceReceiptModal.quantityReceived} / ${remittanceReceiptModal.quantitySent}` : remittanceReceiptModal.quantitySent} · Sent {new Date(remittanceReceiptModal.sentAt).toLocaleDateString()} · {STATUS_LABEL[remittanceReceiptModal.status] ?? remittanceReceiptModal.status}
              </p>
            </div>
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden bg-surface-50 dark:bg-surface-800/50">
              <img
                src={remittanceReceiptModal.receiptUrl}
                alt="Remittance receipt"
                className="w-full max-h-[400px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  const fallback = (e.target as HTMLImageElement).nextElementSibling;
                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                }}
              />
              <div className="items-center justify-center gap-2 p-8 hidden">
                <span className="text-sm text-surface-500 dark:text-surface-400">Receipt image could not be loaded</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-surface-200 dark:border-surface-700 shrink-0 px-4 sm:px-5 pb-4">
            <a href={remittanceReceiptModal.receiptUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
              Open in new tab
            </a>
            <Button variant="secondary" size="sm" onClick={() => setRemittanceReceiptModal(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
