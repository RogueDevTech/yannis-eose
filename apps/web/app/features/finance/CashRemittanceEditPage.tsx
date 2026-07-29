import { useMemo, useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { AmountInput } from '~/components/ui/amount-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { PageHeader } from '~/components/ui/page-header';
import { useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import type { DeliveryRemittanceDetail } from './DeliveryRemittancesPage';

type RemittanceOrder = DeliveryRemittanceDetail['orders'][number];

function lineAmount(o: RemittanceOrder): number {
  const raw = o.invoice?.totalAmount ?? o.totalAmount;
  return raw != null && raw !== '' ? Number(raw) : 0;
}

/** "0" / null / negative saved values render as an empty input. */
function savedAmount(value: string | null | undefined): string {
  return value != null && Number(value) > 0 ? String(Number(value)) : '';
}

interface CashRemittanceEditPageProps {
  detail: DeliveryRemittanceDetail;
}

/**
 * Full-page edit for an existing cash remittance batch. Mirrors the create
 * page layout (orders + costs left, sticky summary right) so create and edit
 * feel like the same flow. Batch membership is fixed after creation: this page
 * edits fees, costs, and notes only.
 */
export function CashRemittanceEditPage({ detail }: CashRemittanceEditPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const { toast } = useToast();
  const navigate = useNavigate();
  const detailPath = `/admin/finance/delivery-remittances/${detail.id}`;

  const [deliveryFees, setDeliveryFees] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const o of detail.orders) {
      const fee = savedAmount(o.deliveryFee);
      if (fee) initial[o.id] = fee;
    }
    return initial;
  });
  const [commitmentFee, setCommitmentFee] = useState(() => savedAmount(detail.commitmentFee));
  const [posFee, setPosFee] = useState(() => savedAmount(detail.posFee));
  const [failedDeliveryCost, setFailedDeliveryCost] = useState(() => savedAmount(detail.failedDeliveryCost));
  const [discount, setDiscount] = useState(() => savedAmount(detail.discount));
  const [waybillCost, setWaybillCost] = useState(() => savedAmount(detail.waybillCost));
  const [batchNote, setBatchNote] = useState(detail.notes ?? '');
  const [showExtraCosts, setShowExtraCosts] = useState(true);

  const handleSuccess = () => {
    toast.success('Remittance updated');
    // Full navigation so the cached detail loader refetches the new figures.
    window.location.replace(detailPath);
  };
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  const locationLabel = detail.locationName
    ? detail.locationProviderName
      ? `${detail.locationName}: ${detail.locationProviderName}`
      : detail.locationName
    : null;

  const totalOrderAmount = useMemo(
    () => detail.orders.reduce((acc, o) => acc + lineAmount(o), 0),
    [detail.orders],
  );

  const totalDeliveryFees = useMemo(
    () => detail.orders.reduce((acc, o) => acc + (parseFloat(deliveryFees[o.id] ?? '0') || 0), 0),
    [detail.orders, deliveryFees],
  );

  const totalCommitmentFee = parseFloat(commitmentFee) || 0;
  const totalPosFee = parseFloat(posFee) || 0;
  const totalFailedDeliveryCost = parseFloat(failedDeliveryCost) || 0;
  const totalDiscount = parseFloat(discount) || 0;
  const totalWaybillCost = parseFloat(waybillCost) || 0;
  const totalExtraCosts = totalCommitmentFee + totalPosFee + totalFailedDeliveryCost + totalDiscount + totalWaybillCost;
  const totalAmount = totalOrderAmount - totalDeliveryFees - totalExtraCosts;

  const submitting = fetcher.state !== 'idle';
  const n = detail.orders.length;

  const handleSubmit = () => {
    const fd = new FormData();
    fd.set('intent', 'updateRemittance');
    fd.set('id', detail.id);
    // Notes sent even when empty so the server can clear them.
    fd.set('notes', batchNote.trim());
    // Every order's fee is sent ("0" when cleared) so old values can be zeroed.
    const feesMap: Record<string, string> = {};
    for (const o of detail.orders) {
      const fee = deliveryFees[o.id]?.trim();
      feesMap[o.id] = fee && parseFloat(fee) >= 0 ? fee : '0';
    }
    fd.set('deliveryFees', JSON.stringify(feesMap));
    fd.set('commitmentFee', totalCommitmentFee > 0 ? totalCommitmentFee.toFixed(2) : '0');
    fd.set('posFee', totalPosFee > 0 ? totalPosFee.toFixed(2) : '0');
    fd.set('failedDeliveryCost', totalFailedDeliveryCost > 0 ? totalFailedDeliveryCost.toFixed(2) : '0');
    fd.set('discount', totalDiscount > 0 ? totalDiscount.toFixed(2) : '0');
    fd.set('waybillCost', totalWaybillCost > 0 ? totalWaybillCost.toFixed(2) : '0');
    fetcher.submit(fd, { method: 'POST' });
  };

  const error = fetcherSurface.errorMatchingIntent('updateRemittance');
  const hasDeductions = totalDeliveryFees > 0 || totalExtraCosts > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit Cash Remittance"
        mobileInlineActions
        description={
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            {locationLabel && (
              <>
                <span>{locationLabel}</span>
                <span className="text-app-fg-muted">·</span>
              </>
            )}
            <span>{n} order{n === 1 ? '' : 's'} in batch</span>
            {totalOrderAmount > 0 && (
              <>
                <span className="text-app-fg-muted">·</span>
                <NairaPrice amount={totalOrderAmount} className="font-semibold text-app-fg" />
              </>
            )}
          </span>
        }
        backTo={detailPath}
      />

      {error && (
        <div className="rounded-md bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700/50 px-3 py-2">
          <p className="text-sm text-danger-700 dark:text-danger-300">{error}</p>
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

            <ul className="space-y-3 px-4 pb-4">
              {detail.orders.map((o) => {
                const orderAmt = lineAmount(o);
                const fee = parseFloat(deliveryFees[o.id] ?? '0') || 0;
                const netAmount = orderAmt - fee;
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

                    {fee > 0 && (
                      <div className="flex items-center justify-between gap-3 pt-1 border-t border-app-border/50">
                        <span className="text-xs text-app-fg-muted">Net remittance</span>
                        <span className="text-sm font-semibold tabular-nums text-brand-600 dark:text-brand-400">
                          {netAmount > 0 ? <NairaPrice amount={netAmount} /> : '—'}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
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

        {/* Right column — summary + submit (sticky on desktop) */}
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

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => navigate(detailPath)}
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
              disabled={submitting}
              loading={submitting}
            >
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
