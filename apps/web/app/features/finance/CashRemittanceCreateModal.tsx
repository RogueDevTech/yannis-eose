import { useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { TextInput } from '~/components/ui/text-input';
import { FileUpload, type FileUploadUploadState } from '~/components/ui/file-upload';
import { Checkbox } from '~/components/ui/checkbox';
import { NairaPrice } from '~/components/ui/naira-price';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { useToast } from '~/components/ui/toast';

export interface EligibleOrder {
  id: string;
  customerName: string;
  totalAmount: string | null;
  deliveredAt: string | null;
  logisticsLocationId: string | null;
  logisticsLocationName: string | null;
}

interface CashRemittanceCreateModalProps {
  open: boolean;
  onClose: () => void;
  eligibleOrders: EligibleOrder[];
  /** Total eligible orders on the server — exposed so the modal can warn when only a slice is shown. */
  eligibleTotal: number;
  /** Remix action URL on the parent route (handles the `createRemittance` intent). */
  actionUrl: string;
  onSuccess?: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function CashRemittanceCreateModal({
  open,
  onClose,
  eligibleOrders,
  eligibleTotal,
  actionUrl,
  onSuccess,
}: CashRemittanceCreateModalProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [uploadState, setUploadState] = useState<FileUploadUploadState>('idle');
  const [notes, setNotes] = useState('');
  const [markReceivedNow, setMarkReceivedNow] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Reset state on close so a stale selection doesn't carry into the next open.
  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setSearch('');
      setLocationFilter('');
      setReceiptUrls([]);
      setUploadState('idle');
      setNotes('');
      setMarkReceivedNow(false);
      setInlineError(null);
    }
  }, [open]);

  // Close + toast on success — failed submits stay open with the error.
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      toast.success(
        markReceivedNow
          ? `Remittance created and ${selectedIds.size} order(s) marked Completed`
          : `Remittance recorded with ${selectedIds.size} order(s)`,
      );
      onSuccess?.();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  // Server returns ALL orders' single-location requirement — pre-validate
  // client-side so the user gets feedback before submit.
  const selectedOrders = useMemo(
    () => eligibleOrders.filter((o) => selectedIds.has(o.id)),
    [eligibleOrders, selectedIds],
  );
  const distinctLocations = useMemo(() => {
    return new Set(selectedOrders.map((o) => o.logisticsLocationId ?? ''));
  }, [selectedOrders]);
  const multiLocationError = distinctLocations.size > 1
    ? 'All selected orders must share the same logistics location. Create one remittance per location.'
    : null;

  const totalAmount = useMemo(() => {
    return selectedOrders.reduce((acc, o) => acc + (o.totalAmount ? Number(o.totalAmount) : 0), 0);
  }, [selectedOrders]);

  // Available locations derived from the eligible list — gives a quick filter
  // without an extra round-trip.
  const locationOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of eligibleOrders) {
      if (o.logisticsLocationId && o.logisticsLocationName) {
        map.set(o.logisticsLocationId, o.logisticsLocationName);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [eligibleOrders]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eligibleOrders.filter((o) => {
      if (locationFilter && o.logisticsLocationId !== locationFilter) return false;
      if (!q) return true;
      return (
        o.customerName.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        (o.logisticsLocationName ?? '').toLowerCase().includes(q)
      );
    });
  }, [eligibleOrders, search, locationFilter]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredOrders.map((o) => o.id)));
  };

  const allFilteredSelected =
    filteredOrders.length > 0 && filteredOrders.every((o) => selectedIds.has(o.id));

  const submitting = fetcher.state !== 'idle';
  const fetcherError = fetcher.data?.error ?? null;

  const handleSubmit = () => {
    setInlineError(null);
    if (selectedIds.size === 0) {
      setInlineError('Select at least one delivered order.');
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
    fd.set('orderIds', JSON.stringify([...selectedIds]));
    fd.set('receiptUrls', JSON.stringify(receiptUrls));
    if (notes.trim()) fd.set('notes', notes.trim());
    fd.set('markReceivedNow', markReceivedNow ? 'true' : 'false');
    fetcher.submit(fd, { method: 'POST', action: actionUrl });
  };

  const error = inlineError ?? fetcherError;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      maxWidth="max-w-3xl"
      contentClassName="p-0 max-h-[92dvh] flex flex-col"
    >
      <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-app-fg">Create cash remittance</h2>
          <p className="text-xs text-app-fg-muted mt-0.5">
            Pick delivered orders, attach the cash receipt, and optionally close them out now.
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
        {/* Section 1 — Pick orders */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-app-fg">1. Delivered orders</h3>
            <span className="text-xs text-app-fg-muted">
              {selectedIds.size} of {filteredOrders.length} selected · {eligibleTotal} eligible total
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <TextInput
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, ID, or location"
            />
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="form-select"
            >
              <option value="">All locations</option>
              {locationOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-app-border overflow-hidden">
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-app-hover sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">
                      <Checkbox
                        checked={allFilteredSelected}
                        onChange={(e) => toggleAll(e.target.checked)}
                        aria-label="Select all visible"
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-app-fg-muted">
                      Customer
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-app-fg-muted">
                      Location
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-app-fg-muted">
                      Delivered
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-app-fg-muted">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-app-fg-muted">
                        {eligibleTotal === 0
                          ? 'No delivered orders awaiting remittance.'
                          : 'No orders match the current filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((o) => (
                      <tr key={o.id} className="border-t border-app-border hover:bg-app-hover/40">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={selectedIds.has(o.id)}
                            onChange={() => toggle(o.id)}
                            aria-label={`Select ${o.customerName}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-app-fg">
                          <div className="font-medium truncate max-w-[14rem]">{o.customerName}</div>
                          <div className="text-[11px] font-mono text-app-fg-muted">
                            {o.id.slice(0, 8)}…
                          </div>
                        </td>
                        <td className="px-3 py-2 text-app-fg-muted">{o.logisticsLocationName ?? '—'}</td>
                        <td className="px-3 py-2 text-app-fg-muted">{formatDate(o.deliveredAt)}</td>
                        <td className="px-3 py-2 text-right">
                          {o.totalAmount ? <NairaPrice amount={Number(o.totalAmount)} /> : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-app-hover px-3 py-2">
            <span className="text-sm text-app-fg-muted">
              Selected: {selectedIds.size} order{selectedIds.size === 1 ? '' : 's'}
            </span>
            <span className="font-semibold">
              <NairaPrice amount={totalAmount} />
            </span>
          </div>

          {multiLocationError && (
            <p className="text-xs text-warning-700 dark:text-warning-300">{multiLocationError}</p>
          )}
        </div>

        {/* Section 2 — Receipt + comment */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-app-fg">2. Receipt &amp; notes</h3>
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

        {/* Section 3 — Mark received now */}
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
                Cash already in hand. Submitting will mark the remittance Completed AND flip every
                selected order from <span className="font-semibold">DELIVERED</span> to{' '}
                <span className="font-semibold">COMPLETED</span> in the same step.
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
          disabled={submitting || selectedIds.size === 0 || !!multiLocationError || receiptUrls.length === 0 || uploadState === 'uploading'}
          loading={submitting}
        >
          {markReceivedNow
            ? `Submit & complete ${selectedIds.size} order${selectedIds.size === 1 ? '' : 's'}`
            : `Record remittance (${selectedIds.size} order${selectedIds.size === 1 ? '' : 's'})`}
        </Button>
      </div>
    </Modal>
  );
}
