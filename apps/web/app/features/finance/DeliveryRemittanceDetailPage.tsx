import { useEffect, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { Textarea } from '~/components/ui/textarea';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import type { DeliveryRemittanceDetail } from './DeliveryRemittancesPage';

interface DeliveryRemittanceDetailPageProps {
  detail: DeliveryRemittanceDetail;
  hasApprovePermission: boolean;
  userMap: Record<string, string>;
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

export function DeliveryRemittanceDetailPage({
  detail,
  hasApprovePermission,
  userMap,
}: DeliveryRemittanceDetailPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [disputeMode, setDisputeMode] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [activeReceiptIndex, setActiveReceiptIndex] = useState(0);
  const [dismissedError, setDismissedError] = useState(false);

  useFetcherToast(fetcher.data, {
    successMessage: disputeMode ? 'Remittance disputed' : 'Remittance marked as received',
  });

  const actionError = fetcher.data?.error;
  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  const isSubmitting = fetcher.state === 'submitting';
  const remittanceTotal = detail.orders.reduce(
    (sum, order) => sum + (order.totalAmount != null ? Number(order.totalAmount) : 0),
    0,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail.status === 'SENT' ? 'Review cash remittance' : 'Cash remittance'}
        description={`${detail.locationName ?? 'Unknown location'} · ${detail.orderCount} order(s)`}
        actions={
          <Link to="/admin/finance/delivery-remittances" className="btn-secondary btn-sm inline-flex">
            Back to list
          </Link>
        }
      />

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} label={STATUS_LABEL[detail.status] ?? detail.status} />
              <span className="text-xs text-app-fg-muted">
                {new Date(detail.sentAt).toLocaleString('en-NG')} · by{' '}
                {userMap[detail.sentBy] ?? `${detail.sentBy.slice(0, 8)}…`}
              </span>
            </div>
            <div>
              <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">
                Remittance total
              </p>
              <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
                <NairaPrice amount={remittanceTotal} />
              </p>
              <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
                Across {detail.orders.length} delivered order(s)
              </p>
            </div>
            {detail.status === 'DISPUTED' && detail.disputeReason ? (
              <div className="rounded-md border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-900/20 p-3 text-sm text-danger-700 dark:text-danger-300">
                {detail.disputeReason}
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
            {(detail.receiptUrls ?? []).length > 1 ? (
              <div className="flex flex-wrap gap-1">
                {(detail.receiptUrls ?? []).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveReceiptIndex(i)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      activeReceiptIndex === i
                        ? 'bg-brand-600 text-white'
                        : 'bg-app-hover text-app-fg-muted hover:text-app-fg'
                    }`}
                  >
                    Receipt {i + 1}
                  </button>
                ))}
              </div>
            ) : null}

            {(detail.receiptUrls ?? []).length > 0 ? (
              <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover flex items-center justify-center min-h-[16rem]">
                <img
                  src={(detail.receiptUrls ?? [])[activeReceiptIndex]}
                  alt={`Receipt ${activeReceiptIndex + 1}`}
                  className="w-full max-h-[32rem] object-contain"
                />
              </div>
            ) : (
              <p className="text-sm text-app-fg-muted italic">No receipts attached</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-app-border bg-app-elevated p-4">
            <h3 className="text-sm font-medium text-app-fg-muted mb-2">
              Orders included ({detail.orders.length})
            </h3>
            <div className="space-y-2 max-h-[26rem] overflow-auto">
              {detail.orders.map((o) => (
                <Link
                  key={o.id}
                  to={`/admin/orders/${o.id}`}
                  className="block rounded-lg border border-app-border p-2.5 hover:border-brand-300 dark:hover:border-brand-600 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium text-app-fg truncate min-w-0">{o.customerName}</span>
                    {o.totalAmount != null ? (
                      <span className="text-xs font-semibold text-app-fg shrink-0">
                        <NairaPrice amount={o.totalAmount} />
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <OrderIdBadge
                      id={o.id}
                      ellipsis=""
                      textClassName="font-mono text-[10px] text-app-fg-muted truncate"
                    />
                    <span className="text-[10px] text-app-fg-muted shrink-0">
                      {o.deliveredAt
                        ? new Date(o.deliveredAt).toLocaleDateString('en-NG', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {hasApprovePermission && detail.status === 'SENT' ? (
            <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              {disputeMode ? (
                <>
                  <Textarea
                    label="Dispute reason"
                    required
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    rows={3}
                    placeholder="Explain why this remittance is disputed (min 10 chars)..."
                    error={
                      disputeReason.length > 0 && disputeReason.length < 10
                        ? `At least 10 characters required (${disputeReason.length}/10)`
                        : undefined
                    }
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDisputeMode(false);
                        setDisputeReason('');
                      }}
                      disabled={isSubmitting}
                    >
                      Back
                    </Button>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="dispute" />
                      <input type="hidden" name="deliveryRemittanceId" value={detail.id} />
                      <input type="hidden" name="disputeReason" value={disputeReason} />
                      <Button
                        type="submit"
                        variant="danger"
                        size="sm"
                        disabled={isSubmitting || disputeReason.length < 10}
                        loading={isSubmitting}
                      >
                        Confirm dispute
                      </Button>
                    </fetcher.Form>
                  </div>
                </>
              ) : (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setDisputeMode(true)}
                    disabled={isSubmitting}
                    className="border-danger-300 text-danger-600 hover:bg-danger-50 dark:border-danger-700 dark:text-danger-400 dark:hover:bg-danger-900/20"
                  >
                    Not received
                  </Button>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="markReceived" />
                    <input type="hidden" name="deliveryRemittanceId" value={detail.id} />
                    <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} loading={isSubmitting}>
                      Received
                    </Button>
                  </fetcher.Form>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
