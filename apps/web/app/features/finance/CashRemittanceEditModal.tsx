import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { AmountInput } from '~/components/ui/amount-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import type { DeliveryRemittanceDetail } from './DeliveryRemittancesPage';

interface CashRemittanceEditModalProps {
  open: boolean;
  onClose: () => void;
  detail: DeliveryRemittanceDetail;
  onSuccess?: () => void;
}

function orderLineAmount(o: DeliveryRemittanceDetail['orders'][number]): number {
  const raw = o.invoice?.totalAmount ?? o.totalAmount;
  return raw != null && raw !== '' ? Number(raw) : 0;
}

export function CashRemittanceEditModal({
  open,
  onClose,
  detail,
  onSuccess,
}: CashRemittanceEditModalProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const [notes, setNotes] = useState(detail.notes ?? '');
  const [deliveryFees, setDeliveryFees] = useState<Record<string, string>>({});
  const [commitmentFee, setCommitmentFee] = useState('');
  const [posFee, setPosFee] = useState('');
  const [failedDeliveryCost, setFailedDeliveryCost] = useState('');
  const [showExtraCosts, setShowExtraCosts] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Pre-populate from the existing detail when modal opens
  useEffect(() => {
    if (open) {
      setNotes(detail.notes ?? '');
      setCommitmentFee(Number(detail.commitmentFee ?? 0) > 0 ? String(Number(detail.commitmentFee)) : '');
      setPosFee(Number(detail.posFee ?? 0) > 0 ? String(Number(detail.posFee)) : '');
      setFailedDeliveryCost(Number(detail.failedDeliveryCost ?? 0) > 0 ? String(Number(detail.failedDeliveryCost)) : '');
      const hasExtras =
        Number(detail.commitmentFee ?? 0) > 0 ||
        Number(detail.posFee ?? 0) > 0 ||
        Number(detail.failedDeliveryCost ?? 0) > 0;
      setShowExtraCosts(hasExtras);

      const initial: Record<string, string> = {};
      for (const o of detail.orders) {
        if (o.deliveryFee != null && o.deliveryFee !== '' && parseFloat(o.deliveryFee) > 0) {
          initial[o.id] = String(Number(o.deliveryFee));
        }
      }
      setDeliveryFees(initial);
      setInlineError(null);
    }
  }, [open, detail]);

  const handleSuccess = useCallback(() => {
    onSuccess?.();
    onClose();
  }, [onSuccess, onClose]);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  const totalOrderAmount = useMemo(
    () => detail.orders.reduce((acc, o) => acc + orderLineAmount(o), 0),
    [detail.orders],
  );

  const totalDeliveryFees = useMemo(
    () => detail.orders.reduce((acc, o) => {
      return acc + (parseFloat(deliveryFees[o.id] ?? '0') || 0);
    }, 0),
    [detail.orders, deliveryFees],
  );

  const parsedCommitmentFee = parseFloat(commitmentFee) || 0;
  const parsedPosFee = parseFloat(posFee) || 0;
  const parsedFailedDeliveryCost = parseFloat(failedDeliveryCost) || 0;
  const totalExtraCosts = parsedCommitmentFee + parsedPosFee + parsedFailedDeliveryCost;
  const totalAmount = totalOrderAmount - totalDeliveryFees - totalExtraCosts;

  const submitting = fetcher.state !== 'idle';

  const handleSubmit = () => {
    setInlineError(null);

    const fd = new FormData();
    fd.set('intent', 'updateRemittance');
    fd.set('id', detail.id);

    // Notes (send even if empty to clear)
    fd.set('notes', notes.trim());

    // Delivery fees
    const feesMap: Record<string, string> = {};
    for (const o of detail.orders) {
      const fee = deliveryFees[o.id]?.trim();
      // Always send, even zero, so the server can clear old values
      feesMap[o.id] = fee && parseFloat(fee) >= 0 ? fee : '0';
    }
    fd.set('deliveryFees', JSON.stringify(feesMap));

    // Batch-level costs
    fd.set('commitmentFee', parsedCommitmentFee > 0 ? commitmentFee : '0');
    fd.set('posFee', parsedPosFee > 0 ? posFee : '0');
    fd.set('failedDeliveryCost', parsedFailedDeliveryCost > 0 ? failedDeliveryCost : '0');

    fetcher.submit(fd, {
      method: 'POST',
      action: '/admin/finance/delivery-remittances/edit',
    });
  };

  const error = inlineError ?? fetcherSurface.errorMatchingIntent('updateRemittance');
  const n = detail.orders.length;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      maxWidth="max-w-lg"
      contentClassName="p-0 max-h-[92dvh] flex flex-col"
    >
      <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-app-fg">Edit cash remittance</h2>
          <p className="text-xs text-app-fg-muted mt-0.5">
            Update delivery fees, costs, and notes for this batch.
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
            <h3 className="text-sm font-semibold text-app-fg">Orders in this batch</h3>
            <span className="text-xs text-app-fg-muted">{n} order{n === 1 ? '' : 's'}</span>
          </div>

          <ul className="rounded-lg border border-app-border divide-y divide-app-border overflow-hidden">
            {detail.orders.map((o) => {
              const fee = parseFloat(deliveryFees[o.id] ?? '0') || 0;
              const orderAmt = orderLineAmount(o);
              const lineTotal = orderAmt - fee;
              return (
                <li key={o.id} className="bg-app-elevated px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-app-fg min-w-0 truncate">
                      {o.invoice ? (
                        <span className="font-mono">{o.invoice.referenceFormatted}</span>
                      ) : (
                        o.customerName
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-sm text-app-fg">
                      {orderAmt > 0 ? <NairaPrice amount={orderAmt} /> : '--'}
                    </span>
                  </div>
                  <div>
                    <label className="block text-xs text-app-fg-muted mb-1">Delivery cost</label>
                    <AmountInput
                      placeholder="0"
                      value={deliveryFees[o.id] ?? ''}
                      onChange={(raw) =>
                        setDeliveryFees((prev) => ({ ...prev, [o.id]: raw }))
                      }
                      prefix="N"
                      className="input input-sm w-full"
                    />
                  </div>
                  {fee > 0 && (
                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-app-border/50">
                      <span className="text-xs text-app-fg-muted">Net remittance</span>
                      <span className="text-sm font-semibold tabular-nums text-brand-600 dark:text-brand-400">
                        {lineTotal > 0 ? <NairaPrice amount={lineTotal} /> : '--'}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
            {/* Collapsible extra costs */}
            <li className="bg-app-elevated px-3 py-2.5 space-y-2">
              {!showExtraCosts ? (
                <button
                  type="button"
                  onClick={() => setShowExtraCosts(true)}
                  className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                >
                  + Add more costs
                </button>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-app-fg-muted">Other costs</span>
                    <button
                      type="button"
                      onClick={() => setShowExtraCosts(false)}
                      className="text-micro text-app-fg-muted hover:text-app-fg"
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
                        prefix="N"
                        className="input input-sm w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-app-fg-muted mb-1">POS fee</label>
                      <AmountInput
                        placeholder="0"
                        value={posFee}
                        onChange={setPosFee}
                        prefix="N"
                        className="input input-sm w-full"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-app-fg-muted mb-1">Failed delivery</label>
                      <AmountInput
                        placeholder="0"
                        value={failedDeliveryCost}
                        onChange={setFailedDeliveryCost}
                        prefix="N"
                        className="input input-sm w-full"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-app-fg-muted mb-1">Description (optional)</label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        placeholder="e.g. POS charge for card payment, commitment fee deducted by logistics"
                        maxLength={1000}
                        className="input input-sm w-full resize-none"
                      />
                    </div>
                  </div>
                </>
              )}
            </li>
          </ul>

          <div className="rounded-md bg-app-hover px-3 py-2 space-y-1">
            {(totalDeliveryFees > 0 || totalExtraCosts > 0) && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-app-fg-muted">Order total</span>
                  <span className="text-sm tabular-nums text-app-fg-muted">
                    <NairaPrice amount={totalOrderAmount} />
                  </span>
                </div>
                {totalDeliveryFees > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-app-fg-muted">Delivery costs</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={totalDeliveryFees} />
                    </span>
                  </div>
                )}
                {parsedCommitmentFee > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-app-fg-muted">Commitment fee</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={parsedCommitmentFee} />
                    </span>
                  </div>
                )}
                {parsedPosFee > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-app-fg-muted">POS fee</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={parsedPosFee} />
                    </span>
                  </div>
                )}
                {parsedFailedDeliveryCost > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-app-fg-muted">Failed delivery</span>
                    <span className="text-sm tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={parsedFailedDeliveryCost} />
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-app-fg">Remittance due</span>
              <span className="font-semibold">
                <NairaPrice amount={totalAmount} />
              </span>
            </div>
          </div>
        </div>

        {/* Notes outside extra costs when they're hidden */}
        {!showExtraCosts && (
          <div>
            <label className="block text-xs text-app-fg-muted mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. POS charge for card payment, commitment fee deducted by logistics"
              maxLength={1000}
              className="input input-sm w-full resize-none"
            />
          </div>
        )}

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
          disabled={submitting}
          loading={submitting}
        >
          Save changes
        </Button>
      </div>
    </Modal>
  );
}
