import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { AmountInput } from '~/components/ui/amount-input';
import { FileUpload, type FileUploadUploadState } from '~/components/ui/file-upload';
import { Checkbox } from '~/components/ui/checkbox';
import { NairaPrice } from '~/components/ui/naira-price';
import { ASSET_FOLDERS } from '~/lib/object-storage';
import { useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import type { OrderInvoice } from '~/features/orders/types';

export interface EligibleOrder {
  id: string;
  customerName: string;
  totalAmount: string | null;
  /** Delivery fee already set on the order (e.g. by CS closer). */
  deliveryFee: string | null;
  deliveredAt: string | null;
  logisticsLocationId: string | null;
  logisticsLocationName: string | null;
  logisticsLocationProviderName: string | null;
  /** Auto-generated invoice when present (CONFIRM side effect); null for legacy rows. */
  invoice: OrderInvoice | null;
}

function lineAmount(o: EligibleOrder): number {
  const raw = o.invoice?.totalAmount ?? o.totalAmount;
  return raw != null && raw !== '' ? Number(raw) : 0;
}

interface CashRemittanceCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** Rows chosen on Awaiting remittance — shown read-only (invoice + amount only). */
  selectedOrders: EligibleOrder[];
  /** Remix action URL on the parent route (handles the `createRemittance` intent). */
  actionUrl: string;
  onSuccess?: () => void;
}

export function CashRemittanceCreateModal({
  open,
  onClose,
  selectedOrders,
  actionUrl,
  onSuccess,
}: CashRemittanceCreateModalProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const { toast } = useToast();
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [uploadState, setUploadState] = useState<FileUploadUploadState>('idle');
  const [notes, setNotes] = useState('');
  const [markReceivedNow, setMarkReceivedNow] = useState(false);
  const [deliveryFees, setDeliveryFees] = useState<Record<string, string>>({});
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Pre-populate delivery fees from orders that already have one set (e.g. by CS closer).
  useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const o of selectedOrders) {
        if (o.deliveryFee != null && o.deliveryFee !== '' && parseFloat(o.deliveryFee) > 0) {
          initial[o.id] = o.deliveryFee;
        }
      }
      setDeliveryFees(initial);
    }
  }, [open, selectedOrders]);

  useEffect(() => {
    if (!open) {
      setReceiptUrls([]);
      setUploadState('idle');
      setNotes('');
      setMarkReceivedNow(false);
      setDeliveryFees({});
      setInlineError(null);
    }
  }, [open]);

  const selectedIds = useMemo(() => new Set(selectedOrders.map((o) => o.id)), [selectedOrders]);

  const handleRemittanceSuccess = useCallback(() => {
    toast.success(
      markReceivedNow
        ? `Remittance created and ${selectedIds.size} order(s) marked Remitted`
        : `Remittance recorded with ${selectedIds.size} order(s)`,
    );
    onSuccess?.();
    onClose();
  }, [markReceivedNow, selectedIds.size, onSuccess, onClose, toast]);
  useCloseOnFetcherSuccess(fetcher, handleRemittanceSuccess);

  const multiLocationError = useMemo(() => {
    const locs = new Set(selectedOrders.map((o) => o.logisticsLocationId ?? ''));
    return locs.size > 1
      ? 'All selected orders must share the same logistics location. Create one remittance per location.'
      : null;
  }, [selectedOrders]);

  const totalAmount = useMemo(
    () => selectedOrders.reduce((acc, o) => {
      const fee = parseFloat(deliveryFees[o.id] ?? '0') || 0;
      return acc + lineAmount(o) + fee;
    }, 0),
    [selectedOrders, deliveryFees],
  );

  const submitting = fetcher.state !== 'idle';

  const handleSubmit = () => {
    setInlineError(null);
    if (selectedOrders.length === 0) {
      setInlineError('No orders selected.');
      return;
    }
    if (multiLocationError) {
      setInlineError(multiLocationError);
      return;
    }
    if (uploadState === 'uploading') {
      setInlineError('Wait for the receipt upload to finish.');
      return;
    }

    const fd = new FormData();
    fd.set('intent', 'createRemittance');
    fd.set('orderIds', JSON.stringify(selectedOrders.map((o) => o.id)));
    fd.set('receiptUrls', JSON.stringify(receiptUrls));
    if (notes.trim()) fd.set('notes', notes.trim());
    fd.set('markReceivedNow', markReceivedNow ? 'true' : 'false');
    // Collect non-zero delivery fees
    const feesMap: Record<string, string> = {};
    for (const o of selectedOrders) {
      const fee = deliveryFees[o.id]?.trim();
      if (fee && parseFloat(fee) > 0) feesMap[o.id] = fee;
    }
    if (Object.keys(feesMap).length > 0) {
      fd.set('deliveryFees', JSON.stringify(feesMap));
    }
    fetcher.submit(fd, { method: 'POST', action: actionUrl });
  };

  const error = inlineError ?? fetcherSurface.errorMatchingIntent('createRemittance');
  const n = selectedOrders.length;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      maxWidth="max-w-lg"
      contentClassName="p-0 max-h-[92dvh] flex flex-col"
    >
      <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-app-fg">Create cash remittance</h2>
          <p className="text-xs text-app-fg-muted mt-0.5">
            Confirm the selected invoices, attach the cash receipt, and optionally mark received now.
          </p>
        </div>
        <button
          type="button"
          onClick={submitting ? undefined : onClose}
          className="text-app-fg-muted hover:text-app-fg shrink-0"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-app-fg">Selected invoices</h3>
            <span className="text-xs text-app-fg-muted">{n} invoice{n === 1 ? '' : 's'}</span>
          </div>

          {n === 0 ? (
            <p className="text-sm text-app-fg-muted rounded-lg border border-app-border bg-app-hover px-3 py-3">
              No orders in this remittance. Close and select rows on Awaiting remittance.
            </p>
          ) : (
            <ul className="rounded-lg border border-app-border divide-y divide-app-border overflow-hidden">
              {selectedOrders.map((o) => {
                const fee = parseFloat(deliveryFees[o.id] ?? '0') || 0;
                const lineTotal = lineAmount(o) + fee;
                return (
                  <li key={o.id} className="bg-app-elevated px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm font-medium text-app-fg min-w-0 truncate">
                        {o.invoice ? o.invoice.referenceFormatted : 'No invoice'}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {lineTotal > 0 ? <NairaPrice amount={lineTotal} /> : '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-1">
                      <AmountInput
                        placeholder="Delivery fee"
                        value={deliveryFees[o.id] ?? ''}
                        onChange={(raw) =>
                          setDeliveryFees((prev) => ({ ...prev, [o.id]: raw }))
                        }
                        prefix="₦"
                        className="input input-sm w-full"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between rounded-md bg-app-hover px-3 py-2">
            <span className="text-sm text-app-fg-muted">Total</span>
            <span className="font-semibold">
              <NairaPrice amount={totalAmount} />
            </span>
          </div>

          {multiLocationError && (
            <p className="text-xs text-warning-700 dark:text-warning-300">{multiLocationError}</p>
          )}
        </div>

        <div className="space-y-2">
          <FileUpload
            folder={ASSET_FOLDERS.RECEIPTS}
            onUpload={(url) => setReceiptUrls((prev) => [...prev, url])}
            onUploadStateChange={(s) => setUploadState(s)}
            label="Upload receipt(s) (optional)"
            size="sm"
          />
          {receiptUrls.length > 0 && (
            <ul className="text-xs text-app-fg-muted space-y-1">
              {receiptUrls.map((url, idx) => (
                <li key={url} className="flex items-center justify-between gap-2">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-500 hover:text-brand-600 truncate"
                  >
                    Receipt {idx + 1}
                  </a>
                  <button
                    type="button"
                    onClick={() => setReceiptUrls((prev) => prev.filter((u) => u !== url))}
                    className="text-app-fg-muted hover:text-danger-600"
                    aria-label={`Remove receipt ${idx + 1}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Textarea
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. dropped off by John"
            maxLength={1000}
          />
        </div>

        <label
          className={`block rounded-lg border p-3 cursor-pointer transition-colors ${
            markReceivedNow
              ? 'border-brand-500 ring-1 ring-brand-500/30 bg-brand-50 dark:bg-brand-900/15'
              : 'border-app-border bg-app-elevated hover:border-brand-300 dark:hover:border-brand-700'
          }`}
        >
          <div className="flex items-start gap-3">
            <Checkbox
              checked={markReceivedNow}
              onChange={(e) => setMarkReceivedNow(e.target.checked)}
              // Override default 16px / app-elevated bg — the card behind this
              // checkbox is also app-elevated (or brand-tinted when on), which
              // made the unchecked box vanish. Bigger size + thicker border +
              // app-bg fill restores visibility in both states.
              className="!w-5 !h-5 !border-2 !bg-app-bg mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-app-fg">
                  Mark Received now
                </span>
                <span
                  className={`text-micro font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    markReceivedNow
                      ? 'bg-brand-600 text-white'
                      : 'bg-app-hover text-app-fg-muted'
                  }`}
                >
                  {markReceivedNow ? 'On' : 'Off'}
                </span>
              </div>
              <p className="text-xs text-app-fg-muted mt-1">
                {markReceivedNow ? (
                  <>
                    Batch will be created <span className="font-semibold text-success-700 dark:text-success-400">AND</span>{' '}
                    immediately Received. Orders flip{' '}
                    <span className="font-semibold">DELIVERED → REMITTED</span> in the same step.
                  </>
                ) : (
                  <>
                    Batch will be created as <span className="font-semibold">Pending</span> — Finance reviews and marks
                    Received later. Toggle on only if cash is already in hand.
                  </>
                )}
              </p>
            </div>
          </div>
        </label>

        {error && (
          <div className="rounded-md bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700/50 px-3 py-2">
            <p className="text-sm text-danger-700 dark:text-danger-300">{error}</p>
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-app-border flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={
            submitting ||
            n === 0 ||
            !!multiLocationError ||
            uploadState === 'uploading'
          }
          loading={submitting}
        >
          {markReceivedNow
            ? `Submit & complete ${n} order${n === 1 ? '' : 's'}`
            : `Record remittance (${n} order${n === 1 ? '' : 's'})`}
        </Button>
      </div>
    </Modal>
  );
}
