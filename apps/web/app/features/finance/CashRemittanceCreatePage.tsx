import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { AmountInput } from '~/components/ui/amount-input';
import { Checkbox } from '~/components/ui/checkbox';
import { NairaPrice } from '~/components/ui/naira-price';
import { PageHeader } from '~/components/ui/page-header';
import { useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import type { EligibleOrder } from './CashRemittanceCreateModal';

function lineAmount(o: EligibleOrder): number {
  const raw = o.invoice?.totalAmount ?? o.totalAmount;
  return raw != null && raw !== '' ? Number(raw) : 0;
}

interface CashRemittanceCreatePageProps {
  selectedOrders: EligibleOrder[];
  onBack: () => void;
}

export function CashRemittanceCreatePage({
  selectedOrders,
  onBack,
}: CashRemittanceCreatePageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [markReceivedNow, setMarkReceivedNow] = useState(false);
  const [deliveryFees, setDeliveryFees] = useState<Record<string, string>>({});
  const [commitmentFees, setCommitmentFees] = useState<Record<string, string>>({});
  const [posFees, setPosFees] = useState<Record<string, string>>({});
  const [failedDeliveryCosts, setFailedDeliveryCosts] = useState<Record<string, string>>({});
  const [orderNotes, setOrderNotes] = useState<Record<string, string>>({});
  const [expandedCosts, setExpandedCosts] = useState<Set<string>>(() => new Set());
  const [inlineError, setInlineError] = useState<string | null>(null);

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const o of selectedOrders) {
      if (o.deliveryFee != null && o.deliveryFee !== '' && parseFloat(o.deliveryFee) > 0) {
        initial[o.id] = o.deliveryFee;
      }
    }
    setDeliveryFees(initial);
  }, [selectedOrders]);

  const handleSuccess = useCallback(() => {
    toast.success(
      markReceivedNow
        ? `Remittance created and ${selectedOrders.length} order(s) marked Remitted`
        : `Remittance recorded with ${selectedOrders.length} order(s)`,
    );
    navigate('/admin/finance/delivery-remittances');
  }, [markReceivedNow, selectedOrders.length, navigate, toast]);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

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
      ? `${first.logisticsLocationName} — ${first.logisticsLocationProviderName}`
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

  const totalCommitmentFees = useMemo(
    () => selectedOrders.reduce((acc, o) => acc + (parseFloat(commitmentFees[o.id] ?? '0') || 0), 0),
    [selectedOrders, commitmentFees],
  );
  const totalPosFees = useMemo(
    () => selectedOrders.reduce((acc, o) => acc + (parseFloat(posFees[o.id] ?? '0') || 0), 0),
    [selectedOrders, posFees],
  );
  const totalFailedDeliveryCosts = useMemo(
    () => selectedOrders.reduce((acc, o) => acc + (parseFloat(failedDeliveryCosts[o.id] ?? '0') || 0), 0),
    [selectedOrders, failedDeliveryCosts],
  );
  const totalExtraCosts = totalCommitmentFees + totalPosFees + totalFailedDeliveryCosts;
  const totalAmount = totalOrderAmount - totalDeliveryFees - totalExtraCosts;

  const submitting = fetcher.state !== 'idle';
  const n = selectedOrders.length;

  const handleSubmit = () => {
    setInlineError(null);
    if (n === 0) { setInlineError('No orders selected.'); return; }
    if (multiLocationError) { setInlineError(multiLocationError); return; }

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
    if (totalCommitmentFees > 0) fd.set('commitmentFee', totalCommitmentFees.toFixed(2));
    if (totalPosFees > 0) fd.set('posFee', totalPosFees.toFixed(2));
    if (totalFailedDeliveryCosts > 0) fd.set('failedDeliveryCost', totalFailedDeliveryCosts.toFixed(2));
    // Combine per-order notes into the remittance description
    const allNotes = selectedOrders
      .map((o) => {
        const n = orderNotes[o.id]?.trim();
        return n ? `${o.invoice?.referenceFormatted ?? o.customerName}: ${n}` : '';
      })
      .filter(Boolean)
      .join('; ');
    if (allNotes) fd.set('notes', allNotes);
    fetcher.submit(fd, { method: 'POST' });
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
                  const deliveryFee = parseFloat(deliveryFees[o.id] ?? '0') || 0;
                  const commitment = parseFloat(commitmentFees[o.id] ?? '0') || 0;
                  const pos = parseFloat(posFees[o.id] ?? '0') || 0;
                  const failed = parseFloat(failedDeliveryCosts[o.id] ?? '0') || 0;
                  const orderAmt = lineAmount(o);
                  const lineCosts = deliveryFee + commitment + pos + failed;
                  const lineTotal = orderAmt - lineCosts;
                  const isExpanded = expandedCosts.has(o.id);

                  return (
                    <li key={o.id} className="rounded-xl border border-app-border bg-app-elevated p-4 shadow-sm space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-mono text-sm font-medium text-app-fg block truncate">
                            {o.invoice ? o.invoice.referenceFormatted : 'No invoice'}
                          </span>
                          <span className="text-xs text-app-fg-muted">{o.customerName}</span>
                        </div>
                        <span className="shrink-0 tabular-nums text-sm font-medium text-app-fg">
                          {orderAmt > 0 ? <NairaPrice amount={orderAmt} /> : '—'}
                        </span>
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

                      {!isExpanded ? (
                        <button
                          type="button"
                          onClick={() => setExpandedCosts((prev) => { const next = new Set(prev); next.add(o.id); return next; })}
                          className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                        >
                          + Add more costs
                        </button>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs text-app-fg-muted mb-1">Commitment fee</label>
                              <AmountInput
                                placeholder="0"
                                value={commitmentFees[o.id] ?? ''}
                                onChange={(raw) => setCommitmentFees((prev) => ({ ...prev, [o.id]: raw }))}
                                prefix="₦"
                                className="input w-full text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-app-fg-muted mb-1">POS fee</label>
                              <AmountInput
                                placeholder="0"
                                value={posFees[o.id] ?? ''}
                                onChange={(raw) => setPosFees((prev) => ({ ...prev, [o.id]: raw }))}
                                prefix="₦"
                                className="input w-full text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-app-fg-muted mb-1">Failed delivery</label>
                              <AmountInput
                                placeholder="0"
                                value={failedDeliveryCosts[o.id] ?? ''}
                                onChange={(raw) => setFailedDeliveryCosts((prev) => ({ ...prev, [o.id]: raw }))}
                                prefix="₦"
                                className="input w-full text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-app-fg-muted mb-1">Note (optional)</label>
                              <input
                                type="text"
                                value={orderNotes[o.id] ?? ''}
                                onChange={(e) => setOrderNotes((prev) => ({ ...prev, [o.id]: e.target.value }))}
                                placeholder="e.g. POS charge"
                                maxLength={500}
                                className="input w-full text-sm"
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedCosts((prev) => { const next = new Set(prev); next.delete(o.id); return next; })}
                            className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                          >
                            − Hide extra costs
                          </button>
                        </>
                      )}

                      {lineCosts > 0 && (
                        <div className="flex items-center justify-between gap-3 pt-1 border-t border-app-border/50">
                          <span className="text-xs text-app-fg-muted">Net remittance</span>
                          <span className="text-sm font-semibold tabular-nums text-brand-600 dark:text-brand-400">
                            {lineTotal > 0 ? <NairaPrice amount={lineTotal} /> : '—'}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
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
                {totalCommitmentFees > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">Commitment fees</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalCommitmentFees} />
                    </span>
                  </div>
                )}
                {totalPosFees > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">POS fees</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalPosFees} />
                    </span>
                  </div>
                )}
                {totalFailedDeliveryCosts > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">Failed delivery</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalFailedDeliveryCosts} />
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
                      Batch created as <span className="font-semibold">Pending</span> — Finance marks Received later.
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
    </div>
  );
}
