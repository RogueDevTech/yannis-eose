import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { FileUpload, type FileUploadUploadState } from '~/components/ui/file-upload';
import { Checkbox } from '~/components/ui/checkbox';
import { NairaPrice } from '~/components/ui/naira-price';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import type { OrderInvoice } from '~/features/orders/types';

export interface EligibleOrder {
  id: string;
  customerName: string;
  totalAmount: string | null;
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
  const [inlineError, setInlineError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReceiptUrls([]);
      setUploadState('idle');
      setNotes('');
      setMarkReceivedNow(false);
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
    () => selectedOrders.reduce((acc, o) => acc + lineAmount(o), 0),
    [selectedOrders],
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
    if (receiptUrls.length === 0) {
      setInlineError('Upload at least one payment receipt.');
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
              {selectedOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-app-elevated">
                  <span className="font-mono text-sm font-medium text-app-fg min-w-0 truncate">
                    {o.invoice ? o.invoice.referenceFormatted : 'No invoice'}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {lineAmount(o) > 0 ? <NairaPrice amount={lineAmount(o)} /> : '—'}
                  </span>
                </li>
              ))}
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
            folder={S3_FOLDERS.RECEIPTS}
            onUpload={(url) => setReceiptUrls((prev) => [...prev, url])}
            onUploadStateChange={(s) => setUploadState(s)}
            label="Upload receipt(s)"
            required
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional notes (e.g. cash dropped off by John, reconciled to bank deposit)"
            maxLength={1000}
          />
        </div>

        <div className="rounded-lg border border-app-border bg-app-elevated p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox
              checked={markReceivedNow}
              onChange={(e) => setMarkReceivedNow(e.target.checked)}
            />
            <div>
              <span className="text-sm font-medium text-app-fg">
                Mark this remittance Received now
              </span>
              <p className="text-xs text-app-fg-muted mt-0.5">
                Cash already in hand. Submitting will mark the remittance received AND flip every
                selected order from <span className="font-semibold">DELIVERED</span> to{' '}
                <span className="font-semibold">REMITTED</span> in the same step.
              </p>
            </div>
          </label>
        </div>

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
            receiptUrls.length === 0 ||
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
