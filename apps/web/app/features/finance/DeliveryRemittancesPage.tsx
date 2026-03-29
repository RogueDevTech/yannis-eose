import { useState, useEffect, useCallback } from 'react';
import { useFetcher, useSearchParams, Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageNotification } from '~/components/ui/page-notification';
import { useFetcherToast } from '~/components/ui/toast';
import { exportToCsv } from '~/lib/csv-export';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Textarea } from '~/components/ui/textarea';
import { Pagination } from '~/components/ui/pagination';

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

export interface DeliveryRemittanceSummary {
  totalRemitted: string;
  pendingAmount: string;
  receivedAmount: string;
  disputedAmount: string;
  totalCount: string;
  pendingCount: string;
  receivedCount: string;
  disputedCount: string;
}

export interface DeliveryRemittancesPageProps {
  remittances: DeliveryRemittanceListItem[];
  pagination: { total: number; totalPages: number; page: number };
  locations: Array<{ id: string; name: string }>;
  filters: { status: string; location: string; startDate: string; endDate: string; periodAllTime: boolean };
  hasApprovePermission: boolean;
  userMap: Record<string, string>;
  summary: DeliveryRemittanceSummary;
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};


/** Loading skeleton for the modal content */
function ModalLoadingSkeleton() {
  return (
    <div className="space-y-4 py-4 animate-pulse">
      {/* Price card skeleton */}
      <div className="rounded-lg bg-app-hover p-4 space-y-2">
        <div className="h-3 w-24 bg-app-hover rounded" />
        <div className="h-8 w-36 bg-app-hover rounded" />
        <div className="h-3 w-32 bg-app-hover rounded" />
      </div>
      {/* Receipt skeleton */}
      <div className="space-y-2">
        <div className="h-4 w-28 bg-app-hover rounded" />
        <div className="rounded-lg bg-app-hover h-48" />
      </div>
      {/* Orders skeleton */}
      <div className="space-y-2">
        <div className="h-4 w-24 bg-app-hover rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-app-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="h-4 w-28 bg-app-hover rounded" />
              <div className="h-4 w-20 bg-app-hover rounded" />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-3 w-16 bg-app-hover rounded" />
              <div className="h-3 w-24 bg-app-hover rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Receipt Review Modal — must view receipts before approving/disputing */
function ReceiptReviewModal({
  remittanceId,
  remittanceSummary,
  detail,
  isLoading,
  open,
  onClose,
  hasApprovePermission,
  userMap,
}: {
  remittanceId: string;
  remittanceSummary: DeliveryRemittanceListItem | null;
  detail: DeliveryRemittanceDetail | null;
  isLoading: boolean;
  open: boolean;
  onClose: () => void;
  hasApprovePermission: boolean;
  userMap: Record<string, string>;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [disputeMode, setDisputeMode] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [receiptViewed, setReceiptViewed] = useState(false);
  const [activeReceiptIndex, setActiveReceiptIndex] = useState(0);
  const [receiptImageError, setReceiptImageError] = useState(false);

  useFetcherToast(fetcher.data, {
    successMessage: disputeMode ? 'Remittance disputed' : 'Remittance marked as received',
  });

  // Close modal on successful action
  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data, onClose]);

  // Reset state when modal opens or when switching receipt tab
  useEffect(() => {
    if (open) {
      setDisputeMode(false);
      setDisputeReason('');
      setReceiptViewed(false);
      setActiveReceiptIndex(0);
      setReceiptImageError(false);
    }
  }, [open]);

  useEffect(() => {
    setReceiptImageError(false);
  }, [activeReceiptIndex]);

  if (!open) return null;

  const status = detail?.status ?? remittanceSummary?.status ?? 'SENT';
  const locationName = detail?.locationName ?? remittanceSummary?.locationName ?? 'Unknown location';
  const orderCount = detail?.orderCount ?? remittanceSummary?.orderCount ?? 0;
  const sentAt = detail?.sentAt ?? remittanceSummary?.sentAt ?? '';
  const sentBy = detail?.sentBy ?? remittanceSummary?.sentBy ?? '';

  const isSubmitting = fetcher.state === 'submitting';

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-5 pt-4 md:pt-5 pb-3 border-b border-app-border shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-app-fg">
              {status === 'SENT' ? 'Review remittance' : 'View remittance'}
            </h3>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {locationName} &middot; {orderCount} order(s) &middot; {sentAt ? new Date(sentAt).toLocaleString() : '—'}
              {sentBy && (
                <> &middot; by {userMap[sentBy] ?? sentBy.slice(0, 8) + '…'}</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-app-fg-muted hover:text-app-fg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        {isLoading || !detail ? (
          <div className="px-4 md:px-5 py-4">
            <ModalLoadingSkeleton />
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 md:px-5">
              {/* Remittance Price */}
              <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
                <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">Remittance total</p>
                <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
                  <NairaPrice amount={detail.orders.reduce((sum, o) => sum + (o.totalAmount != null ? Number(o.totalAmount) : 0), 0)} />
                </p>
                <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
                  Across {detail.orders.length} delivered order(s)
                </p>
              </div>

              {/* Receipt Viewer */}
              <div>
                <h4 className="text-sm font-medium text-app-fg-muted mb-2">
                  Payment receipt(s)
                  {detail.status === 'SENT' && !receiptViewed && (
                    <span className="ml-2 text-xs text-warning-600 dark:text-warning-400">
                      — View receipt to unlock actions
                    </span>
                  )}
                </h4>
                {(detail.receiptUrls ?? []).length > 0 ? (
                  <div className="space-y-2">
                    {/* Receipt tabs */}
                    {(detail.receiptUrls ?? []).length > 1 && (
                      <div className="flex gap-1">
                        {(detail.receiptUrls ?? []).map((_, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setActiveReceiptIndex(i)}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                              activeReceiptIndex === i
                                ? 'bg-brand-600 text-white'
                                : 'bg-app-hover text-app-fg-muted hover:bg-app-hover'
                            }`}
                          >
                            Receipt {i + 1}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Receipt display — use state for broken image so the page never crashes */}
                    <div
                      role="button"
                      tabIndex={0}
                      className="rounded-lg border border-app-border overflow-hidden bg-app-hover cursor-pointer flex items-center justify-center min-h-[12rem]"
                      onClick={() => {
                        setReceiptViewed(true);
                        const url = (detail.receiptUrls ?? [])[activeReceiptIndex];
                        if (url) window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          (e.currentTarget as HTMLElement).click();
                        }
                      }}
                    >
                      {receiptImageError ? (
                        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
                          <svg className="w-10 h-10 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008H12.75V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                          </svg>
                          <span className="text-sm text-app-fg-muted">Image unavailable</span>
                          <span className="text-xs text-brand-600 dark:text-brand-400 font-medium">Click to open receipt in new tab</span>
                        </div>
                      ) : (
                        <img
                          src={(detail.receiptUrls ?? [])[activeReceiptIndex]}
                          alt={`Receipt ${activeReceiptIndex + 1}`}
                          className="w-full max-h-64 object-contain"
                          onError={() => setReceiptImageError(true)}
                          onLoad={() => setReceiptViewed(true)}
                        />
                      )}
                    </div>
                    <p className="text-xs text-app-fg-muted">
                      Click receipt to open in new tab
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-app-fg-muted italic">No receipts attached</p>
                )}
              </div>

              {/* Orders list — grid so at least 3 per row on desktop */}
              <div>
                <h4 className="text-sm font-medium text-app-fg-muted mb-2">Orders included ({detail.orders.length})</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {detail.orders.map((o) => (
                    <Link
                      key={o.id}
                      to={`/admin/orders/${o.id}`}
                      className="block rounded-lg border border-app-border bg-app-hover p-2.5 hover:border-brand-300 dark:hover:border-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors min-w-0"
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span className="text-xs font-medium text-app-fg truncate min-w-0">{o.customerName}</span>
                        {o.totalAmount != null && (
                          <span className="text-xs font-semibold text-app-fg shrink-0">
                            <NairaPrice amount={o.totalAmount} />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-mono text-[10px] text-app-fg-muted truncate">{o.id.slice(0, 8)}</span>
                        <span className="text-[10px] text-app-fg-muted shrink-0">
                          {o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }) : '—'}
                        </span>
                      </div>
                      <span className="text-[10px] text-brand-600 dark:text-brand-400 font-medium mt-0.5 inline-block">View &rarr;</span>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Dispute reason input */}
              {disputeMode && (
                <div>
                  <Textarea
                    label="Dispute reason"
                    required
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    rows={3}
                    placeholder="Explain why this remittance is being disputed (min 10 chars)..."
                    error={disputeReason.length > 0 && disputeReason.length < 10 ? `At least 10 characters required (${disputeReason.length}/10)` : undefined}
                  />
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
              <div className="flex items-center justify-between gap-3 px-4 md:px-5 pt-3 pb-4 md:pb-5 border-t border-app-border shrink-0">
                <div className="text-xs text-app-fg-muted">
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
          </>
        )}
    </Modal>
  );
}

const STATUS_OPTIONS = ['', 'SENT', 'RECEIVED', 'DISPUTED'] as const;
const STATUS_FILTER_LABELS: Record<string, string> = {
  '': 'All',
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};


export function DeliveryRemittancesPage({
  remittances,
  pagination,
  locations,
  filters,
  hasApprovePermission,
  userMap,
  summary,
}: DeliveryRemittancesPageProps) {
  const [modalRemittanceId, setModalRemittanceId] = useState<string | null>(null);
  const [modalDetail, setModalDetail] = useState<DeliveryRemittanceDetail | null>(null);
  const [, setSearchParams] = useSearchParams();
  const [dismissedError, setDismissedError] = useState(false);
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const detailFetcher = useFetcher<{ _detailOnly?: boolean; detail?: DeliveryRemittanceDetail | null }>();

  useFetcherToast(fetcher.data, {
    successMessage: 'Remittance updated successfully',
  });

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  // When detailFetcher finishes loading, extract the detail
  useEffect(() => {
    if (detailFetcher.state === 'idle' && detailFetcher.data?._detailOnly) {
      setModalDetail(detailFetcher.data.detail ?? null);
    }
  }, [detailFetcher.state, detailFetcher.data]);

  const openModal = useCallback((remittanceId: string) => {
    setModalRemittanceId(remittanceId);
    setModalDetail(null);
    // Fetch detail via this route's loader with _detail param
    detailFetcher.load(`/admin/finance/delivery-remittances?_detail=${encodeURIComponent(remittanceId)}`);
  }, [detailFetcher]);

  const closeModal = useCallback(() => {
    setModalRemittanceId(null);
    setModalDetail(null);
  }, []);

  const { total, totalPages, page } = pagination;

  const handleStatusChange = (status: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (status === '' || status === 'ALL') next.delete('status');
      else next.set('status', status);
      return next;
    });
  };

  const handleLocationChange = (locationId: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!locationId) next.delete('location');
      else next.set('location', locationId);
      return next;
    });
  };

  const handleExportCsv = () => {
    exportToCsv(
      remittances.map((r) => ({
        id: r.id,
        location: r.locationName ?? '',
        sentBy: userMap[r.sentBy] ?? r.sentBy.slice(0, 8) + '…',
        orderCount: r.orderCount,
        status: STATUS_LABEL[r.status] ?? r.status,
        sentAt: new Date(r.sentAt).toLocaleString(),
      })),
      [
        { key: 'id', label: 'ID' },
        { key: 'location', label: 'Location' },
        { key: 'sentBy', label: 'Sent by' },
        { key: 'orderCount', label: 'Orders' },
        { key: 'status', label: 'Status' },
        { key: 'sentAt', label: 'Sent at' },
      ],
      `delivery-remittances-${new Date().toISOString().split('T')[0]}.csv`,
    );
  };

  const modalSummary = modalRemittanceId
    ? remittances.find((r) => r.id === modalRemittanceId) ?? null
    : null;

  const hasFilters = !!filters.status || !!filters.location;

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title="Delivery remittances"
        description="3PL submit batches of delivered orders with payment receipts. Review receipts and confirm or dispute payment."
        actions={
          <>
            <DateFilterBar
              startDate={filters.startDate}
              endDate={filters.endDate}
              periodAllTime={filters.periodAllTime}
            />
            <PageRefreshButton />
            <Button variant="secondary" size="sm" onClick={handleExportCsv}>
              Export CSV
            </Button>
          </>
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

      <OverviewStatStrip
        items={[
          {
            label: 'Total remitted',
            value: <NairaPrice amount={summary.totalRemitted} />,
            valueClassName: 'text-app-fg tabular-nums',
            title: `${Number(summary.totalCount)} remittance(s)`,
          },
          {
            label: 'Pending',
            value: <NairaPrice amount={summary.pendingAmount} />,
            valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums',
            title: `${Number(summary.pendingCount)} remittance(s)`,
          },
          {
            label: 'Received',
            value: <NairaPrice amount={summary.receivedAmount} />,
            valueClassName: 'text-success-600 dark:text-success-400 tabular-nums',
            title: `${Number(summary.receivedCount)} remittance(s)`,
          },
          {
            label: 'Disputed',
            value: <NairaPrice amount={summary.disputedAmount} />,
            valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: `${Number(summary.disputedCount)} remittance(s)`,
          },
        ]}
      />

      {/* Filter bar */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s || 'all'}
                type="button"
                onClick={() => handleStatusChange(s)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  filters.status === s
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-app-elevated text-app-fg-muted border-app-border hover:border-app-border-strong'
                }`}
              >
                {STATUS_FILTER_LABELS[s] ?? 'All'}
              </button>
            ))}
          </div>
          <FormSelect
            value={filters.location}
            onChange={(e) => handleLocationChange(e.target.value)}
            aria-label="Filter by location"
            className="w-full sm:w-52"
            options={[
              { value: '', label: 'All locations' },
              ...locations.map((loc) => ({ value: loc.id, label: loc.name })),
            ]}
          />
        </div>
      </div>

      {/* Table — desktop */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">ID</th>
                <th className="table-header">Location</th>
                <th className="table-header">Sent by</th>
                <th className="table-header text-right">Orders</th>
                <th className="table-header">Status</th>
                <th className="table-header">Sent at</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {remittances.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="table-cell">
                    <span className="font-mono text-xs text-app-fg-muted">{r.id.slice(0, 8)}…</span>
                  </td>
                  <td className="table-cell text-sm text-app-fg">
                    {r.locationName ?? '—'}
                  </td>
                  <td className="table-cell text-sm text-app-fg-muted">
                    {userMap[r.sentBy] ?? r.sentBy.slice(0, 8) + '…'}
                  </td>
                  <td className="table-cell text-right">{r.orderCount}</td>
                  <td className="table-cell">
                    <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
                  </td>
                  <td className="table-cell text-sm text-app-fg-muted">
                    {new Date(r.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="table-cell">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openModal(r.id)}
                    >
                      {r.status === 'SENT' ? 'Review' : 'View'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3 px-1">
          {remittances.map((r) => (
            <div key={r.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-app-fg-muted">{r.id.slice(0, 8)}…</span>
                <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
              </div>
              <div className="text-sm text-app-fg-muted">
                {r.locationName ?? '—'} · {r.orderCount} order(s) · {userMap[r.sentBy] ?? 'Unknown'}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>{new Date(r.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => openModal(r.id)}
                >
                  {r.status === 'SENT' ? 'Review' : 'View'}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {remittances.length === 0 && (
          <EmptyState
            title="No delivery remittances found"
            description={hasFilters ? 'Try adjusting your filters' : '3PL locations will appear here once they submit remittances'}
          />
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} pageParam="page" />
      )}

      {/* Receipt Review Modal — opens instantly, loads detail client-side */}
      {modalRemittanceId && (
        <ReceiptReviewModal
          remittanceId={modalRemittanceId}
          remittanceSummary={modalSummary}
          detail={modalDetail}
          isLoading={detailFetcher.state !== 'idle' || !modalDetail}
          open
          onClose={closeModal}
          hasApprovePermission={hasApprovePermission}
          userMap={userMap}
        />
      )}
    </div>
  );
}
