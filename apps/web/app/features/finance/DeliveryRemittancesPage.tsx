import { useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useFetcherToast } from '~/components/ui/toast';

export interface DeliveryRemittanceListItem {
  id: string;
  logisticsLocationId: string;
  sentBy: string;
  receiptUrls: string[];
  status: string;
  sentAt: string;
  locationName: string | null;
  orderCount: number;
  disputeReason?: string | null;
}

export interface DeliveryRemittanceDetail extends DeliveryRemittanceListItem {
  orders: Array<{
    id: string;
    customerName: string;
    totalAmount: string | null;
    deliveredAt: string | null;
  }>;
}

export interface DeliveryRemittancesPageProps {
  remittances: DeliveryRemittanceListItem[];
  selectedDetail: DeliveryRemittanceDetail | null;
  hasApprovePermission: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

const STATUS_STYLE: Record<string, string> = {
  SENT: 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300',
  RECEIVED: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300',
  DISPUTED: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300',
};

/** Receipt Review Modal — must view receipts before approving/disputing */
function ReceiptReviewModal({
  detail,
  open,
  onClose,
  hasApprovePermission,
}: {
  detail: DeliveryRemittanceDetail;
  open: boolean;
  onClose: () => void;
  hasApprovePermission: boolean;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [disputeMode, setDisputeMode] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [receiptViewed, setReceiptViewed] = useState(false);
  const [activeReceiptIndex, setActiveReceiptIndex] = useState(0);

  useFetcherToast(fetcher.data, {
    successMessage: disputeMode ? 'Remittance disputed' : 'Remittance marked as received',
  });

  // Close modal on successful action
  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setDisputeMode(false);
      setDisputeReason('');
      setReceiptViewed(false);
      setActiveReceiptIndex(0);
    }
  }, [open]);

  if (!open) return null;

  const receipts = detail.receiptUrls ?? [];
  const totalAmount = detail.orders.reduce(
    (sum, o) => sum + (o.totalAmount != null ? Number(o.totalAmount) : 0),
    0,
  );
  const isSubmitting = fetcher.state === 'submitting';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      aria-modal="true"
      role="dialog"
      onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}
    >
      <div className="card w-full max-w-2xl max-h-[90dvh] overflow-hidden flex flex-col shadow-xl bg-white dark:bg-surface-900">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700 shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
              Review remittance
            </h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
              {detail.locationName ?? 'Unknown location'} &middot; {detail.orderCount} order(s) &middot; {new Date(detail.sentAt).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4">
          {/* Remittance Price */}
          <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
            <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">Remittance total</p>
            <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
              &#8358;{totalAmount.toLocaleString()}
            </p>
            <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
              Across {detail.orders.length} delivered order(s)
            </p>
          </div>

          {/* Receipt Viewer */}
          <div>
            <h4 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
              Payment receipt(s)
              {!receiptViewed && (
                <span className="ml-2 text-xs text-warning-600 dark:text-warning-400">
                  — View receipt to unlock actions
                </span>
              )}
            </h4>
            {receipts.length > 0 ? (
              <div className="space-y-2">
                {/* Receipt tabs */}
                {receipts.length > 1 && (
                  <div className="flex gap-1">
                    {receipts.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setActiveReceiptIndex(i)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          activeReceiptIndex === i
                            ? 'bg-brand-600 text-white'
                            : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                        }`}
                      >
                        Receipt {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                {/* Receipt display */}
                <div
                  className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden bg-surface-50 dark:bg-surface-800/50 cursor-pointer"
                  onClick={() => {
                    setReceiptViewed(true);
                    window.open(receipts[activeReceiptIndex], '_blank', 'noopener,noreferrer');
                  }}
                >
                  {/* Try to render as image; fallback to link */}
                  <img
                    src={receipts[activeReceiptIndex]}
                    alt={`Receipt ${activeReceiptIndex + 1}`}
                    className="w-full max-h-64 object-contain"
                    onError={(e) => {
                      // If not an image, hide it and show link
                      (e.target as HTMLImageElement).style.display = 'none';
                      const fallback = (e.target as HTMLImageElement).nextElementSibling;
                      if (fallback) (fallback as HTMLElement).style.display = 'flex';
                    }}
                    onLoad={() => setReceiptViewed(true)}
                  />
                  <div
                    className="items-center justify-center gap-2 p-6 hidden"
                  >
                    <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                    <span className="text-sm text-brand-600 dark:text-brand-400 font-medium">
                      Click to open receipt {activeReceiptIndex + 1}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  Click receipt to open in new tab
                </p>
              </div>
            ) : (
              <p className="text-sm text-surface-500 dark:text-surface-400 italic">No receipts attached</p>
            )}
          </div>

          {/* Orders list */}
          <div>
            <h4 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Orders included</h4>
            <div className="rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-800 overflow-hidden">
              {detail.orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs text-surface-400">{o.id.slice(0, 8)}</span>
                    <span className="text-surface-900 dark:text-white truncate">{o.customerName}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-surface-500 dark:text-surface-400">
                      {o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString() : '—'}
                    </span>
                    {o.totalAmount != null && (
                      <span className="font-medium text-surface-900 dark:text-white">
                        &#8358;{Number(o.totalAmount).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dispute reason input */}
          {disputeMode && (
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                Dispute reason <span className="text-danger-500">*</span>
              </label>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                rows={3}
                placeholder="Explain why this remittance is being disputed (min 10 chars)..."
                className="w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm px-3 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              />
              {disputeReason.length > 0 && disputeReason.length < 10 && (
                <p className="text-xs text-danger-500 mt-1">
                  At least 10 characters required ({disputeReason.length}/10)
                </p>
              )}
            </div>
          )}

          {/* Error display */}
          {fetcher.data?.error && (
            <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
              <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        {hasApprovePermission && detail.status === 'SENT' && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-surface-200 dark:border-surface-700 shrink-0">
            <div className="text-xs text-surface-500 dark:text-surface-400">
              {!receiptViewed && 'View the receipt above to unlock actions'}
            </div>
            <div className="flex items-center gap-2">
              {disputeMode ? (
                <>
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
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setDisputeMode(true)}
                    disabled={!receiptViewed || isSubmitting}
                    className="border-danger-300 text-danger-600 hover:bg-danger-50 dark:border-danger-700 dark:text-danger-400 dark:hover:bg-danger-900/20"
                  >
                    Not received
                  </Button>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="markReceived" />
                    <input type="hidden" name="deliveryRemittanceId" value={detail.id} />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={!receiptViewed || isSubmitting}
                      loading={isSubmitting}
                    >
                      Received
                    </Button>
                  </fetcher.Form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DeliveryRemittancesPage({
  remittances,
  selectedDetail,
  hasApprovePermission,
}: DeliveryRemittancesPageProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // Open modal when detail is loaded
  useEffect(() => {
    if (selectedDetail) setModalOpen(true);
  }, [selectedDetail]);

  const pending = remittances.filter((r) => r.status === 'SENT');
  const processed = remittances.filter((r) => r.status !== 'SENT');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Delivery remittances</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            3PL submit batches of delivered orders with payment receipts. Review receipts and confirm or dispute payment.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PageRefreshButton />
        </div>
      </div>

      {/* Pending remittances */}
      {pending.length > 0 && (
        <div className="card p-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
            Pending review ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((r) => (
              <a
                key={r.id}
                href={`?detail=${r.id}`}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-sm text-surface-500 dark:text-surface-400">
                    {r.id.slice(0, 8)}...
                  </span>
                  <span className="text-sm font-medium text-surface-900 dark:text-white truncate">
                    {r.locationName ?? 'Unknown location'}
                  </span>
                  <span className="text-xs text-surface-500 dark:text-surface-400">
                    {r.orderCount} order(s) &middot; {new Date(r.sentAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-surface-500 dark:text-surface-400">
                    {r.receiptUrls?.length ?? 0} receipt(s)
                  </span>
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE.SENT}`}>
                    {STATUS_LABEL.SENT}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Processed remittances */}
      {processed.length > 0 && (
        <div className="card p-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
            Received / Disputed ({processed.length})
          </h2>
          <div className="space-y-2">
            {processed.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 py-2 border-b border-surface-100 dark:border-surface-800 last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs text-surface-500 dark:text-surface-400">
                    {r.id.slice(0, 8)}...
                  </span>
                  <span className="text-sm text-surface-900 dark:text-white truncate">
                    {r.locationName ?? 'Unknown'}
                  </span>
                  <span className="text-xs text-surface-500 dark:text-surface-400">
                    {r.orderCount} order(s) &middot; {new Date(r.sentAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.status === 'DISPUTED' && r.disputeReason && (
                    <span className="text-xs text-danger-500 dark:text-danger-400 max-w-[200px] truncate" title={r.disputeReason}>
                      {r.disputeReason}
                    </span>
                  )}
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[r.status] ?? ''}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {remittances.length === 0 && (
        <p className="text-sm text-surface-500 dark:text-surface-400">No delivery remittances yet.</p>
      )}

      {/* Receipt Review Modal */}
      {selectedDetail && (
        <ReceiptReviewModal
          detail={selectedDetail}
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            // Clear the ?detail= param
            window.history.replaceState(null, '', window.location.pathname);
          }}
          hasApprovePermission={hasApprovePermission}
        />
      )}
    </div>
  );
}
