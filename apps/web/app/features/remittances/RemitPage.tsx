import { useEffect, useMemo, useState } from 'react';
import { useFetcher, Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { FileUpload } from '~/components/ui/file-upload';
import { Modal } from '~/components/ui/modal';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { createRemittanceSchema, createDeliveryRemittanceSchema } from '@yannis/shared/validators';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { TextInput } from '~/components/ui/text-input';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import type { OrderInvoice } from '~/features/orders/types';

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
  fromProviderName: string | null;
  toProviderName: string | null;
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
  logisticsLocationId?: string | null;
  logisticsLocationName?: string | null;
  logisticsLocationProviderName?: string | null;
  invoice?: OrderInvoice | null;
}

export interface RemitPageProps {
  remittances: RemittanceRecord[];
  products: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; providerName?: string | null }>;
  userLocationId: string | null;
  deliveryRemittances: DeliveryRemittanceRecord[];
  eligibleOrders: DeliveryRemittanceEligibleOrder[];
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending receipt',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

function remittanceStatusPillClass(status: string): string {
  if (status === 'RECEIVED') {
    return 'inline-flex px-2 py-0.5 rounded text-xs font-medium bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300';
  }
  if (status === 'DISPUTED') {
    return 'inline-flex px-2 py-0.5 rounded text-xs font-medium bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300';
  }
  return 'inline-flex px-2 py-0.5 rounded text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300';
}

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
  const { toast } = useToast();
  const [transferReceiptUrl, setTransferReceiptUrl] = useState('');
  const [transferReceiptUploadState, setTransferReceiptUploadState] = useState<FileUploadUploadState>('idle');
  const [deliveryReceiptUploadState, setDeliveryReceiptUploadState] = useState<FileUploadUploadState>('idle');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [deliveryReceiptUrls, setDeliveryReceiptUrls] = useState<string[]>([]);
  const [remittanceReceiptModal, setRemittanceReceiptModal] = useState<RemittanceRecord | null>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedToLocationId, setSelectedToLocationId] = useState('');

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
      setDeliveryReceiptUploadState('idle');
    }
  }, [fetcher.data, fetcher.formData?.get('intent')]);

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean }).success && fetcher.formData?.get('intent') === 'createRemittance') {
      setTransferReceiptUrl('');
      setTransferReceiptUploadState('idle');
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

  const remittanceColumns: CompactTableColumn<RemittanceRecord>[] = useMemo(
    () => [
      {
        key: 'product',
        header: 'Product',
        render: (r) => <span className="text-app-fg">{r.productName}</span>,
      },
      {
        key: 'to',
        header: 'To',
        render: (r) => (
          <span className="text-app-fg-muted">
            {r.toProviderName ? `${r.toLocationName} — ${r.toProviderName}` : r.toLocationName}
          </span>
        ),
      },
      {
        key: 'qty',
        header: 'Qty',
        align: 'right',
        render: (r) => (
          <span className="tabular-nums">
            {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : r.quantitySent}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => (
          <span className={remittanceStatusPillClass(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</span>
        ),
      },
      {
        key: 'sentAt',
        header: 'Sent',
        render: (r) => <span className="text-app-fg-muted">{new Date(r.sentAt).toLocaleDateString()}</span>,
      },
      {
        key: 'receipt',
        header: 'Receipt',
        align: 'right',
        tight: true,
        render: (r) => (
          <CompactTableActionButton onClick={() => setRemittanceReceiptModal(r)}>View</CompactTableActionButton>
        ),
      },
    ],
    [],
  );

  const handleCreateDeliveryRemittanceSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fdRead = new FormData(formEl);
    let orderIds: unknown;
    let receiptUrls: unknown;
    try {
      orderIds = JSON.parse(fdRead.get('orderIds')?.toString() ?? '[]');
      receiptUrls = JSON.parse(fdRead.get('receiptUrls')?.toString() ?? '[]');
    } catch {
      toast.error('Cannot submit remittance', 'Invalid order or receipt data.');
      return;
    }
    const parsed = createDeliveryRemittanceSchema.safeParse({ orderIds, receiptUrls });
    if (!parsed.success) {
      toast.error('Cannot submit remittance', parsed.error.issues[0]?.message ?? 'Check orders and receipts.');
      return;
    }
    const fd = new FormData(formEl);
    fd.set('orderIds', JSON.stringify(parsed.data.orderIds));
    fd.set('receiptUrls', JSON.stringify(parsed.data.receiptUrls));
    fetcher.submit(fd, { method: 'post' });
  };

  const handleCreateRemittanceSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fdRead = new FormData(formEl);
    const qtyRaw = fdRead.get('quantitySent')?.toString().trim() ?? '';
    const parsed = createRemittanceSchema.safeParse({
      productId: fdRead.get('productId')?.toString() ?? '',
      toLocationId: fdRead.get('toLocationId')?.toString() ?? '',
      quantitySent: qtyRaw === '' ? NaN : Number(qtyRaw),
      receiptUrl: transferReceiptUrl.trim(),
    });
    if (!parsed.success) {
      toast.error('Cannot submit remittance', parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    const fd = new FormData(formEl);
    fd.set('receiptUrl', parsed.data.receiptUrl);
    fd.set('quantitySent', String(parsed.data.quantitySent));
    fetcher.submit(fd, { method: 'post' });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-app-fg">Remit</h1>
        <p className="text-sm text-app-fg-muted mt-0.5">
          Stock transfer to warehouse, or delivery remittance (batch delivered orders + payment receipts for Finance).
        </p>
      </div>

      {/* Delivery remittance: select orders + payment receipts → Finance marks received */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-app-fg mb-1">Delivery remittance</h2>
        <p className="text-sm text-app-fg-muted mb-4">
          Select the delivered orders you want to include in this remittance and attach payment receipt(s). Finance will review and mark as received (end of day).
        </p>
        <fetcher.Form
          method="post"
          className="space-y-4"
          onSubmit={handleCreateDeliveryRemittanceSubmit}
          noValidate
        >
          <input type="hidden" name="intent" value="createDeliveryRemittance" />
          <input type="hidden" name="orderIds" value={JSON.stringify([...selectedOrderIds])} />
          <input type="hidden" name="receiptUrls" value={JSON.stringify(deliveryReceiptUrls)} />
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="block text-sm font-medium text-app-fg-muted">
                Select orders to remit
                {eligibleOrders.length > 0 && (
                  <span className="font-normal text-app-fg-muted ml-1">
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
                    className="text-xs font-medium text-app-fg-muted hover:underline disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {eligibleOrders.length === 0 ? (
              <div className="rounded-lg border border-app-border bg-app-hover px-4 py-4 text-sm text-app-fg-muted">
                <p className="font-medium text-app-fg-muted mb-1">No delivered orders available to remit</p>
                <p className="mb-2">
                  Orders delivered at your location will appear here once they are marked as Delivered and not yet included in a remittance.
                </p>
                <Link to="/tpl/orders" className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
                  View orders →
                </Link>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-app-border divide-y divide-app-border">
                {eligibleOrders.map((order) => (
                  <label
                    key={order.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-app-hover/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedOrderIds.has(order.id)}
                      onChange={() => toggleOrder(order.id)}
                      disabled={isSubmittingDelivery}
                    />
                    <OrderIdBadge
                      id={order.id}
                      ellipsis="…"
                      className="shrink-0"
                      textClassName="font-mono text-xs text-app-fg-muted"
                    />
                    <span className="text-sm text-app-fg truncate min-w-0">{order.customerName}</span>
                    <span className="text-xs text-app-fg-muted shrink-0">
                      {order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString() : '—'}
                    </span>
                    {order.totalAmount != null && (
                      <span className="text-xs font-medium text-app-fg-muted shrink-0">
                        ₦{Number(order.totalAmount).toLocaleString()}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
            {eligibleOrders.length > 0 && selectedOrderIds.size > 0 && (
              <p className="text-xs text-app-fg-muted mt-1">
                {selectedOrderIds.size} order(s) selected for this remittance
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-app-fg-muted mb-1">
              Payment receipt(s) (required)
            </label>
            <FileUpload
              folder={S3_FOLDERS.RECEIPTS}
              label="Upload receipt"
              required={deliveryReceiptUrls.length === 0}
              onUpload={addDeliveryReceipt}
              onUploadStateChange={setDeliveryReceiptUploadState}
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
              isSubmittingDelivery ||
              deliveryReceiptUploadState === 'uploading' ||
              selectedOrderIds.size === 0 ||
              deliveryReceiptUrls.length === 0
            }
          >
            Submit delivery remittance
          </Button>
        </fetcher.Form>
        {deliveryRemittances.length > 0 && (
          <div className="mt-6 pt-4 border-t border-app-border">
            <h3 className="text-sm font-medium text-app-fg-muted mb-2">Your delivery remittances</h3>
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
                  <span className="text-app-fg-muted">
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
        <h2 className="text-lg font-semibold text-app-fg mb-4">Stock transfer to warehouse</h2>
        <fetcher.Form method="post" className="space-y-4" onSubmit={handleCreateRemittanceSubmit} noValidate>
          <input type="hidden" name="intent" value="createRemittance" />
          <input type="hidden" name="productId" value={selectedProductId} />
          <input type="hidden" name="toLocationId" value={selectedToLocationId} />
          <SearchableSelect
            id="remit-productId"
            label="Product"
            required
            value={selectedProductId}
            onChange={setSelectedProductId}
            disabled={isSubmitting}
            placeholder="Select product"
            searchPlaceholder="Search products..."
            options={products.map((p) => ({ value: p.id, label: p.name }))}
          />
          <SearchableSelect
            id="remit-toLocationId"
            label="Send to location"
            required
            value={selectedToLocationId}
            onChange={setSelectedToLocationId}
            disabled={isSubmitting}
            placeholder="Select warehouse / location"
            searchPlaceholder="Search locations..."
            options={toLocationOptions.map((l) => ({
              value: l.id,
              label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
            }))}
          />
          <TextInput
            type="number"
            name="quantitySent"
            label="Quantity sent"
            min={1}
            required
            disabled={isSubmitting}
          />
          <FileUpload
            folder={S3_FOLDERS.RECEIPTS}
            name="receiptUrl"
            label="Receipt (required)"
            required
            onUpload={(url) => setTransferReceiptUrl(url)}
            onUploadStateChange={setTransferReceiptUploadState}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={isSubmitting}
            loadingText="Submitting..."
            disabled={
              isSubmitting ||
              transferReceiptUploadState === 'uploading' ||
              !transferReceiptUrl.trim()
            }
          >
            Submit remittance
          </Button>
        </fetcher.Form>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-app-fg mb-3">Your remittances</h2>
        <CompactTable<RemittanceRecord>
          columns={remittanceColumns}
          rows={remittances}
          rowKey={(r) => r.id}
          emptyTitle="No remittances yet"
        />
      </div>

      {/* Remittance receipt modal */}
      {remittanceReceiptModal?.receiptUrl && (
        <Modal open onClose={() => setRemittanceReceiptModal(null)} maxWidth="max-w-lg" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-app-fg">Remittance receipt</h3>
            <button type="button" onClick={() => setRemittanceReceiptModal(null)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
              <p className="font-medium text-app-fg">{remittanceReceiptModal.productName}</p>
              <p className="text-sm text-app-fg-muted mt-1">
                To: {remittanceReceiptModal.toProviderName ? `${remittanceReceiptModal.toLocationName} — ${remittanceReceiptModal.toProviderName}` : remittanceReceiptModal.toLocationName}
              </p>
              <p className="text-sm text-app-fg-muted mt-0.5">
                Qty: {remittanceReceiptModal.quantityReceived != null ? `${remittanceReceiptModal.quantityReceived} / ${remittanceReceiptModal.quantitySent}` : remittanceReceiptModal.quantitySent} · Sent {new Date(remittanceReceiptModal.sentAt).toLocaleDateString()} · {STATUS_LABEL[remittanceReceiptModal.status] ?? remittanceReceiptModal.status}
              </p>
            </div>
            <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
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
                <span className="text-sm text-app-fg-muted">Receipt image could not be loaded</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-app-border shrink-0 px-4 sm:px-5 pb-4">
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
