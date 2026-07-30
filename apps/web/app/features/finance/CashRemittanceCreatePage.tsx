import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { AmountInput } from '~/components/ui/amount-input';
import { Checkbox } from '~/components/ui/checkbox';
import { Modal } from '~/components/ui/modal';
import { NairaPrice } from '~/components/ui/naira-price';
import { PageHeader } from '~/components/ui/page-header';
import { useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import {
  readRemittanceBatchDraft,
  writeRemittanceBatchDraft,
  clearRemittanceBatch,
} from '~/hooks/usePersistedRemittanceSelection';
import type { EligibleOrder } from './eligible-order';

type DuplicateWarning = {
  orderId: string;
  customerName: string;
  productName: string;
  remittedOrderId: string;
  remittedDeliveredAt: string;
};

function lineAmount(o: EligibleOrder): number {
  const raw = o.invoice?.totalAmount ?? o.totalAmount;
  return raw != null && raw !== '' ? Number(raw) : 0;
}

interface CashRemittanceCreatePageProps {
  selectedOrders: EligibleOrder[];
  onBack: () => void;
  /** Drop one order from the batch (rewrites the ?orders= param + persisted batch). */
  onRemoveOrder: (orderId: string) => void;
}

export function CashRemittanceCreatePage({
  selectedOrders,
  onBack,
  onRemoveOrder,
}: CashRemittanceCreatePageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; duplicateWarnings?: DuplicateWarning[] }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [markReceivedNow, setMarkReceivedNow] = useState(true);
  const [deliveryFees, setDeliveryFees] = useState<Record<string, string>>({});
  // Batch-level extra costs (single input for the whole remittance)
  const [commitmentFee, setCommitmentFee] = useState('');
  const [posFee, setPosFee] = useState('');
  const [failedDeliveryCost, setFailedDeliveryCost] = useState('');
  const [discount, setDiscount] = useState('');
  const [waybillCost, setWaybillCost] = useState('');
  const [batchNote, setBatchNote] = useState('');
  const [showExtraCosts, setShowExtraCosts] = useState(true);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [duplicateWarnings, setDuplicateWarnings] = useState<DuplicateWarning[]>([]);

  // Skip persisting until after the mount hydration so an empty initial state
  // doesn't clobber a saved draft.
  const hydratedRef = useRef(false);

  // Restore the saved batch draft (fees, extra costs, note, toggle) so a finance
  // user who left mid-batch resumes exactly where they were. Runs once the
  // orders have actually loaded (they arrive from the loader), and keys off the
  // batch signature so the draft for THIS batch is restored.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (selectedOrders.length === 0) return; // wait for orders to load
    const orderIds = selectedOrders.map((o) => o.id);
    const draft = readRemittanceBatchDraft(orderIds);
    // Seed delivery fees from the order defaults, then let any saved edits win.
    const seeded: Record<string, string> = {};
    for (const o of selectedOrders) {
      if (o.deliveryFee != null && o.deliveryFee !== '' && parseFloat(o.deliveryFee) > 0) {
        seeded[o.id] = o.deliveryFee;
      }
    }
    setDeliveryFees({ ...seeded, ...draft.deliveryFees });
    setCommitmentFee(draft.commitmentFee);
    setPosFee(draft.posFee);
    setFailedDeliveryCost(draft.failedDeliveryCost);
    setDiscount(draft.discount);
    setWaybillCost(draft.waybillCost);
    setBatchNote(draft.batchNote);
    setMarkReceivedNow(draft.markReceivedNow);
    hydratedRef.current = true;
  }, [selectedOrders]);

  // When batch membership changes (order added/removed), fill defaults for any
  // newly-added order without wiping fees already entered for existing ones.
  useEffect(() => {
    if (!hydratedRef.current) return;
    setDeliveryFees((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(selectedOrders.map((o) => o.id));
      // Drop fees for orders no longer in the batch.
      for (const id of Object.keys(next)) {
        if (!ids.has(id)) { delete next[id]; changed = true; }
      }
      // Seed a default fee for a newly-added order that has one.
      for (const o of selectedOrders) {
        if (next[o.id] === undefined && o.deliveryFee != null && o.deliveryFee !== '' && parseFloat(o.deliveryFee) > 0) {
          next[o.id] = o.deliveryFee;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedOrders]);

  // Persist the batch draft on every change so leaving and returning restores it.
  useEffect(() => {
    if (!hydratedRef.current) return;
    writeRemittanceBatchDraft(
      {
        deliveryFees,
        commitmentFee,
        posFee,
        failedDeliveryCost,
        discount,
        waybillCost,
        batchNote,
        markReceivedNow,
      },
      selectedOrders.map((o) => o.id),
    );
  }, [deliveryFees, commitmentFee, posFee, failedDeliveryCost, discount, waybillCost, batchNote, markReceivedNow, selectedOrders]);

  const handleSuccess = useCallback(() => {
    // Batch is now recorded — wipe the ongoing-batch selection + draft so the
    // list page banner clears and nothing re-checks on return.
    clearRemittanceBatch();
    toast.success(
      markReceivedNow
        ? `Remittance created and ${selectedOrders.length} order(s) marked Remitted`
        : `Remittance recorded with ${selectedOrders.length} order(s)`,
    );
    navigate('/admin/finance/delivery-remittances');
  }, [markReceivedNow, selectedOrders.length, navigate, toast]);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  // Surface duplicate warnings from the backend (but not after a successful override)
  useEffect(() => {
    if (
      fetcher.state === 'idle' &&
      fetcher.data?.duplicateWarnings?.length &&
      !fetcher.data?.success
    ) {
      setDuplicateWarnings(fetcher.data.duplicateWarnings);
    }
  }, [fetcher.state, fetcher.data]);

  const multiLocationError = useMemo(() => {
    const locs = new Set(selectedOrders.map((o) => o.logisticsLocationId ?? ''));
    return locs.size > 1
      ? 'All selected orders must share the same logistics location. Create one remittance per location.'
      : null;
  }, [selectedOrders]);

  const locationLabel = useMemo(() => {
    const first = selectedOrders[0];
    if (!first) return null;
    return first.logisticsLocationProviderName
      ? `${first.logisticsLocationName}: ${first.logisticsLocationProviderName}`
      : first.logisticsLocationName;
  }, [selectedOrders]);

  const totalOrderAmount = useMemo(
    () => selectedOrders.reduce((acc, o) => acc + lineAmount(o), 0),
    [selectedOrders],
  );

  const totalDeliveryFees = useMemo(
    () => selectedOrders.reduce((acc, o) => {
      return acc + (parseFloat(deliveryFees[o.id] ?? '0') || 0);
    }, 0),
    [selectedOrders, deliveryFees],
  );

  const totalCommitmentFee = parseFloat(commitmentFee) || 0;
  const totalPosFee = parseFloat(posFee) || 0;
  const totalFailedDeliveryCost = parseFloat(failedDeliveryCost) || 0;
  const totalDiscount = parseFloat(discount) || 0;
  const totalWaybillCost = parseFloat(waybillCost) || 0;
  const totalExtraCosts = totalCommitmentFee + totalPosFee + totalFailedDeliveryCost + totalDiscount + totalWaybillCost;
  const totalAmount = totalOrderAmount - totalDeliveryFees - totalExtraCosts;

  const submitting = fetcher.state !== 'idle';
  const n = selectedOrders.length;

  const buildFormData = (skipDuplicateWarning = false): FormData => {
    const fd = new FormData();
    fd.set('intent', 'createRemittance');
    fd.set('orderIds', JSON.stringify(selectedOrders.map((o) => o.id)));
    fd.set('receiptUrls', JSON.stringify([]));
    fd.set('markReceivedNow', markReceivedNow ? 'true' : 'false');
    const feesMap: Record<string, string> = {};
    for (const o of selectedOrders) {
      const fee = deliveryFees[o.id]?.trim();
      if (fee && parseFloat(fee) > 0) feesMap[o.id] = fee;
    }
    if (Object.keys(feesMap).length > 0) {
      fd.set('deliveryFees', JSON.stringify(feesMap));
    }
    if (totalCommitmentFee > 0) fd.set('commitmentFee', totalCommitmentFee.toFixed(2));
    if (totalPosFee > 0) fd.set('posFee', totalPosFee.toFixed(2));
    if (totalFailedDeliveryCost > 0) fd.set('failedDeliveryCost', totalFailedDeliveryCost.toFixed(2));
    if (totalDiscount > 0) fd.set('discount', totalDiscount.toFixed(2));
    if (totalWaybillCost > 0) fd.set('waybillCost', totalWaybillCost.toFixed(2));
    if (batchNote.trim()) fd.set('notes', batchNote.trim());
    if (skipDuplicateWarning) fd.set('skipDuplicateWarning', 'true');
    return fd;
  };

  const handleSubmit = () => {
    setInlineError(null);
    if (n === 0) { setInlineError('No orders selected.'); return; }
    if (multiLocationError) { setInlineError(multiLocationError); return; }
    fetcher.submit(buildFormData(), { method: 'POST' });
  };

  const handleDuplicateOverride = () => {
    setDuplicateWarnings([]);
    fetcher.submit(buildFormData(true), { method: 'POST' });
  };

  const error = inlineError ?? fetcherSurface.errorMatchingIntent('createRemittance');
  const hasDeductions = totalDeliveryFees > 0 || totalExtraCosts > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Cash Remittance"
        mobileInlineActions
        description={
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            {locationLabel && (
              <>
                <span>{locationLabel}</span>
                <span className="text-app-fg-muted">·</span>
              </>
            )}
            <span>{n} order{n === 1 ? '' : 's'} selected</span>
            {totalOrderAmount > 0 && (
              <>
                <span className="text-app-fg-muted">·</span>
                <NairaPrice amount={totalOrderAmount} className="font-semibold text-app-fg" />
              </>
            )}
          </span>
        }
        backTo="/admin/finance/delivery-remittances"
      />

      {error && (
        <div className="rounded-md bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700/50 px-3 py-2">
          <p className="text-sm text-danger-700 dark:text-danger-300">{error}</p>
        </div>
      )}

      {multiLocationError && (
        <div className="rounded-md bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700/50 px-3 py-2">
          <p className="text-sm text-warning-700 dark:text-warning-300">{multiLocationError}</p>
        </div>
      )}

      {/* Two-column layout on desktop: orders list left, summary right */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
        {/* Left column — orders + costs */}
        <div className="space-y-4">
          {/* Orders card */}
          <div className="rounded-xl border border-app-border bg-app-elevated shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-app-fg">Invoices &amp; delivery costs</h3>
              <span className="text-xs text-app-fg-muted">{n} invoice{n === 1 ? '' : 's'}</span>
            </div>

            {n === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-app-fg-muted">No orders selected. Go back and select orders first.</p>
              </div>
            ) : (
              <ul className="space-y-3 px-4 pb-4">
                {selectedOrders.map((o) => {
                  const orderAmt = lineAmount(o);
                  return (
                    <li key={o.id} className="rounded-xl border border-app-border bg-app-elevated p-4 shadow-sm space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-mono text-sm font-medium text-app-fg block truncate">
                            {o.invoice ? o.invoice.referenceFormatted : 'No invoice'}
                          </span>
                          <span className="text-xs text-app-fg-muted">{o.customerName}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums text-sm font-medium text-app-fg">
                            {orderAmt > 0 ? <NairaPrice amount={orderAmt} /> : '—'}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRemoveOrder(o.id)}
                            disabled={submitting}
                            aria-label={`Remove ${o.invoice ? o.invoice.referenceFormatted : o.customerName} from batch`}
                            title="Remove from batch"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-app-fg-muted transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-app-fg-muted mb-1">Delivery cost</label>
                        <AmountInput
                          placeholder="0"
                          value={deliveryFees[o.id] ?? ''}
                          onChange={(raw) => setDeliveryFees((prev) => ({ ...prev, [o.id]: raw }))}
                          prefix="₦"
                          className="input w-full text-sm"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Batch-level extra costs */}
          <div className="rounded-xl border border-app-border bg-app-elevated shadow-sm overflow-hidden">
            {!showExtraCosts ? (
              <button
                type="button"
                onClick={() => setShowExtraCosts(true)}
                className="w-full px-4 py-3 text-left text-xs font-medium text-brand-600 dark:text-brand-400 hover:bg-app-hover transition-colors"
              >
                + Add extra costs
              </button>
            ) : (
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-app-fg">Extra costs</h3>
                  <button
                    type="button"
                    onClick={() => setShowExtraCosts(false)}
                    className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    Hide
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-app-fg-muted mb-1">Commitment fee</label>
                    <AmountInput
                      placeholder="0"
                      value={commitmentFee}
                      onChange={setCommitmentFee}
                      prefix="₦"
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-app-fg-muted mb-1">POS fee</label>
                    <AmountInput
                      placeholder="0"
                      value={posFee}
                      onChange={setPosFee}
                      prefix="₦"
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-app-fg-muted mb-1">Failed delivery</label>
                    <AmountInput
                      placeholder="0"
                      value={failedDeliveryCost}
                      onChange={setFailedDeliveryCost}
                      prefix="₦"
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-app-fg-muted mb-1">Discount</label>
                    <AmountInput
                      placeholder="0"
                      value={discount}
                      onChange={setDiscount}
                      prefix="₦"
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-app-fg-muted mb-1">Waybill sent/pickup</label>
                    <AmountInput
                      placeholder="0"
                      value={waybillCost}
                      onChange={setWaybillCost}
                      prefix="₦"
                      className="input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-app-fg-muted mb-1">Note (optional)</label>
                    <input
                      type="text"
                      value={batchNote}
                      onChange={(e) => setBatchNote(e.target.value)}
                      placeholder="e.g. POS charge"
                      maxLength={1000}
                      className="input w-full text-sm"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column — summary + toggle + submit (sticky on desktop) */}
        <div className="lg:sticky lg:top-[calc(var(--header-height)+0.5rem)] lg:max-h-[calc(100dvh-var(--header-height)-1rem)] lg:overflow-y-auto space-y-4">
          {/* Summary card */}
          <div className="rounded-xl border border-app-border bg-app-elevated p-4 shadow-sm space-y-3">
            <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">
              Remittance summary
            </p>

            {hasDeductions && (
              <div className="space-y-1.5 pb-3 border-b border-app-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-app-fg-muted">Order total</span>
                  <span className="text-sm tabular-nums text-app-fg-muted">
                    <NairaPrice amount={totalOrderAmount} />
                  </span>
                </div>
                {totalDeliveryFees > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">Delivery costs</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalDeliveryFees} />
                    </span>
                  </div>
                )}
                {totalCommitmentFee > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">Commitment fee</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalCommitmentFee} />
                    </span>
                  </div>
                )}
                {totalPosFee > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">POS fee</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalPosFee} />
                    </span>
                  </div>
                )}
                {totalFailedDeliveryCost > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">Failed delivery</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalFailedDeliveryCost} />
                    </span>
                  </div>
                )}
                {totalDiscount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">Discount</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalDiscount} />
                    </span>
                  </div>
                )}
                {totalWaybillCost > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">Waybill sent/pickup</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalWaybillCost} />
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-app-fg">Remittance due</span>
              <span className="text-xl font-bold text-brand-700 dark:text-brand-300">
                <NairaPrice amount={totalAmount} />
              </span>
            </div>

            <p className="text-xs text-app-fg-muted">
              {hasDeductions
                ? `Net from ${n} order(s) after deductions`
                : `Sum of ${n} order(s)`}
            </p>
          </div>

          {/* Mark Received toggle */}
          <label
            className={`block rounded-xl border p-4 cursor-pointer transition-colors ${
              markReceivedNow
                ? 'border-brand-500 ring-1 ring-brand-500/30 bg-brand-50 dark:bg-brand-900/15'
                : 'border-app-border bg-app-elevated hover:border-brand-300 dark:hover:border-brand-700'
            }`}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                checked={markReceivedNow}
                onChange={(e) => setMarkReceivedNow(e.target.checked)}
                className="!w-5 !h-5 !border-2 !bg-app-bg mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-app-fg">Mark Received now</span>
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
                      Orders flip <span className="font-semibold">DELIVERED → REMITTED</span> in the same step.
                    </>
                  ) : (
                    <>
                      Batch created as <span className="font-semibold">Pending</span>. Finance marks Received later.
                    </>
                  )}
                </p>
              </div>
            </div>
          </label>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={onBack}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={handleSubmit}
              disabled={submitting || n === 0 || !!multiLocationError}
              loading={submitting}
            >
              {markReceivedNow
                ? `Submit & complete (${n})`
                : `Record remittance (${n})`}
            </Button>
          </div>
        </div>
      </div>

      {/* Duplicate remittance warning modal */}
      <Modal
        open={duplicateWarnings.length > 0}
        onClose={() => setDuplicateWarnings([])}
        maxWidth="max-w-md"
        contentClassName="p-5 space-y-4"
      >
        <h3 className="text-base font-semibold text-warning-600 dark:text-warning-400">
          Possible duplicate remittance
        </h3>
        <p className="text-sm text-app-fg-muted">
          The following orders match a customer and product that was already remitted this month.
          Review before proceeding.
        </p>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {duplicateWarnings.map((w, i) => (
            <div key={i} className="rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50/50 dark:bg-warning-950/20 px-3 py-2">
              <p className="text-sm font-medium text-app-fg">{w.customerName}</p>
              <p className="text-xs text-app-fg-muted">
                {w.productName} was already remitted on{' '}
                {w.remittedDeliveredAt
                  ? new Date(w.remittedDeliveredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                  : 'unknown date'}
              </p>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setDuplicateWarnings([])}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleDuplicateOverride}
            loading={submitting}
          >
            Proceed anyway
          </Button>
        </div>
      </Modal>
    </div>
  );
}
