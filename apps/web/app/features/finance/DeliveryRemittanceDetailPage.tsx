import { useEffect, useMemo, useState } from 'react';
import { Link, useFetcher, useLocation, useSearchParams } from '@remix-run/react';
import { generateInvoicePdf } from '~/lib/invoice-pdf';
import { InvoicePreviewModal } from '~/components/ui/invoice-preview-modal';
import { ReceiptPreviewModal } from '~/components/ui/receipt-preview-modal';
import type { OrderInvoice } from '~/features/orders/types';
import { Button } from '~/components/ui/button';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { Textarea } from '~/components/ui/textarea';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import {
  CompactTable,
  CompactTableActions,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import type { DeliveryRemittanceDetail } from './DeliveryRemittancesPage';
import { CashRemittanceEditModal } from './CashRemittanceEditModal';

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

type RemittanceOrderRow = DeliveryRemittanceDetail['orders'][number];

export function DeliveryRemittanceDetailPage({
  detail,
  hasApprovePermission,
  userMap,
}: DeliveryRemittanceDetailPageProps) {
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [disputeMode, setDisputeMode] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [dismissedError, setDismissedError] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<OrderInvoice | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<{ url: string; label: string } | null>(null);
  const [showEditModal, setShowEditModal] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get('edit') === 'true';
  });

  const closeEditModal = () => {
    closeEditModal();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('edit');
      return next;
    }, { replace: true });
  };

  const listBackHref =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof (location.state as { from?: unknown }).from === 'string'
      ? (location.state as { from: string }).from
      : '/admin/finance/delivery-remittances?tab=remittances';

  useFetcherToast(fetcher.data, {
    successMessage: disputeMode ? 'Remittance disputed' : 'Remittance marked as received',
  });

  const actionError = fetcher.data?.error;
  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  const isSubmitting = fetcher.state === 'submitting';

  const totalOrderAmount = detail.orders.reduce(
    (sum, order) => sum + (order.totalAmount != null ? Number(order.totalAmount) : 0),
    0,
  );
  const totalDeliveryFees = detail.orders.reduce(
    (sum, order) => sum + (order.deliveryFee != null ? Number(order.deliveryFee) : 0),
    0,
  );
  const commitmentFee = Number(detail.commitmentFee ?? 0);
  const posFee = Number(detail.posFee ?? 0);
  const failedDeliveryCost = Number(detail.failedDeliveryCost ?? 0);
  const totalExtraCosts = commitmentFee + posFee + failedDeliveryCost;
  const remittanceTotal = totalOrderAmount - totalDeliveryFees - totalExtraCosts;

  const recordedByLabel =
    detail.sentByName?.trim() || userMap[detail.sentBy] || `${detail.sentBy.slice(0, 8)}…`;

  const locationLine =
    detail.locationName != null
      ? detail.locationProviderName != null
        ? `${detail.locationName}: ${detail.locationProviderName}`
        : detail.locationName
      : 'Unknown location';

  const orderColumns = useMemo((): CompactTableColumn<RemittanceOrderRow>[] => {
    return [
      {
        key: 'customer',
        header: 'Customer',
        hideable: false,
        render: (o) => (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-app-fg truncate max-w-[12rem]" title={o.customerName}>
              {o.customerName}
            </span>
            {o.isDuplicate && (
              <a
                href={`/admin/finance/delivery-remittances/duplicates/${o.duplicateOfId ?? o.id}`}
                className="shrink-0 rounded bg-warning-100 dark:bg-warning-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-800/40"
                title="Compare duplicate orders"
              >
                Duplicate
              </a>
            )}
          </div>
        ),
      },
      {
        key: 'orderId',
        header: 'Order',
        nowrap: true,
        render: (o) => (
          <OrderIdBadge id={o.id} orderNumber={o.orderNumber} ellipsis="" textClassName="font-mono text-xs text-app-fg-muted" />
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (o) => <OrderStatusBadge status={o.status} showDot={false} className="!text-xs" />,
      },
      {
        key: 'delivered',
        header: 'Delivered',
        nowrap: true,
        render: (o) => (
          <span className="text-sm text-app-fg-muted whitespace-nowrap">
            {o.deliveredAt
              ? new Date(o.deliveredAt).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '—'}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        nowrap: true,
        render: (o) => {
          const amt = o.totalAmount != null ? Number(o.totalAmount) : 0;
          const fee = o.deliveryFee != null ? Number(o.deliveryFee) : 0;
          if (amt === 0) return <span className="text-app-fg-muted">—</span>;
          return (
            <div className="text-right">
              <NairaPrice amount={amt} className="text-sm font-medium tabular-nums" />
              {fee > 0 && (
                <p className="text-xs tabular-nums text-danger-600 dark:text-danger-400">
                  -<NairaPrice amount={fee} /> delivery
                </p>
              )}
            </div>
          );
        },
      },
      {
        key: 'invoice',
        header: 'Invoice',
        nowrap: true,
        render: (o) =>
          o.invoice ? (
            <CompactTableActions className="justify-start">
              <TableActionButton
                variant="neutral"
                title="View invoice"
                onClick={() => setInvoicePreview(o.invoice)}
              >
                {o.invoice.referenceFormatted}
              </TableActionButton>
              <TableActionButton
                variant="neutral"
                title="Download PDF"
                onClick={() => {
                  if (o.invoice) void generateInvoicePdf(o.invoice);
                }}
              >
                PDF
              </TableActionButton>
            </CompactTableActions>
          ) : (
            <span className="text-xs text-app-fg-muted">No invoice</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        hideable: false,
        mobileShowLabel: false,
        render: (o) => (
          <TableRowActionsSheet
            ariaLabel={`Actions for ${o.customerName}`}
            sheetTitle={o.customerName}
            actions={[
              ...(o.isDuplicate ? [{ key: 'compare', kind: 'link' as const, label: 'Compare duplicates', to: `/admin/finance/delivery-remittances/duplicates/${o.duplicateOfId ?? o.id}` }] : []),
              { key: 'view', kind: 'link', label: 'Order', to: `/admin/orders/${o.id}` },
              ...(o.invoice
                ? [
                    { key: 'invoice', kind: 'button' as const, label: 'Invoice', onClick: () => setInvoicePreview(o.invoice) },
                    { key: 'pdf', kind: 'button' as const, label: 'Download PDF', onClick: () => { if (o.invoice) void generateInvoicePdf(o.invoice); } },
                  ]
                : []),
            ]}
          />
        ),
      },
    ];
  }, []);

  return (
    <div className="space-y-5 w-full min-w-0">
      <PageHeader
        backTo={listBackHref}
        title={detail.status === 'SENT' ? 'Review cash remittance' : 'Cash remittance'}
        mobileInlineActions
        description={
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span>{locationLine}</span>
            <span className="text-app-fg-muted">·</span>
            <span>{detail.orders.length} order(s)</span>
            <span className="text-app-fg-muted">·</span>
            <NairaPrice amount={remittanceTotal} className="font-semibold text-app-fg" />
          </span>
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Cash remittance toolbar"
            saveFilterKey
            desktop={
              <>
                <PageRefreshButton />
                {hasApprovePermission && (
                  <Button variant="secondary" size="sm" onClick={() => setShowEditModal(true)}>
                    Edit
                  </Button>
                )}
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <PageRefreshButton />
                {hasApprovePermission && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowEditModal(true);
                    }}
                  >
                    Edit batch
                  </Button>
                )}
              </>
            )}
          />
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

      <div className="rounded-xl border border-app-border bg-app-elevated p-3 md:p-4 shadow-sm space-y-3">
        {/* Desktop: single flex-wrap row. Mobile: stacked grid for readability. */}
        <div className="hidden md:flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <StatusBadge status={detail.status} label={STATUS_LABEL[detail.status] ?? detail.status} />
          <span className="text-app-fg-muted">
            Sent {new Date(detail.sentAt).toLocaleString('en-NG')} · by {recordedByLabel}
          </span>
          <span className="h-3 w-px bg-app-border" aria-hidden />
          <span className="text-app-fg-muted">
            <span className="font-medium text-app-fg-muted/80">Batch ID</span>{' '}
            <span className="font-mono text-app-fg break-all">{detail.id}</span>
          </span>
          <span className="h-3 w-px bg-app-border" aria-hidden />
          <span className="text-app-fg-muted">
            <span className="font-medium text-app-fg-muted/80">Location</span>{' '}
            <span className="text-app-fg">{locationLine}</span>
          </span>
          <span className="h-3 w-px bg-app-border" aria-hidden />
          <span className="text-app-fg-muted">
            <span className="font-medium text-app-fg-muted/80">Recorded by</span>{' '}
            <span className="text-app-fg">{recordedByLabel}</span>
          </span>
          {detail.receivedAt ? (
            <>
              <span className="h-3 w-px bg-app-border" aria-hidden />
              <span className="text-app-fg-muted">
                <span className="font-medium text-app-fg-muted/80">Received</span>{' '}
                <span className="text-app-fg">
                  {new Date(detail.receivedAt).toLocaleString('en-NG')}
                  {detail.receivedByName ? ` · ${detail.receivedByName}` : ''}
                </span>
              </span>
            </>
          ) : null}
        </div>
        {/* Mobile: compact stacked layout */}
        <div className="md:hidden space-y-2">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={detail.status} label={STATUS_LABEL[detail.status] ?? detail.status} />
            <span className="text-xs text-app-fg-muted">{new Date(detail.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <div>
              <dt className="text-app-fg-muted/80 font-medium">Location</dt>
              <dd className="text-app-fg mt-0.5">{locationLine}</dd>
            </div>
            <div>
              <dt className="text-app-fg-muted/80 font-medium">Recorded by</dt>
              <dd className="text-app-fg mt-0.5">{recordedByLabel}</dd>
            </div>
            {detail.receivedAt ? (
              <div className="col-span-2">
                <dt className="text-app-fg-muted/80 font-medium">Received</dt>
                <dd className="text-app-fg mt-0.5">
                  {new Date(detail.receivedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                  {detail.receivedByName ? ` · ${detail.receivedByName}` : ''}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
        {detail.notes?.trim() ? (
          <p className="text-xs text-app-fg-muted">
            <span className="font-medium text-app-fg-muted/80">Notes:</span>{' '}
            <span className="text-app-fg">{detail.notes}</span>
          </p>
        ) : null}
        <div className="pt-2 border-t border-app-border flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-lg font-bold text-brand-700 dark:text-brand-300 tabular-nums">
            <NairaPrice amount={remittanceTotal} />
          </span>
          {(totalDeliveryFees > 0 || totalExtraCosts > 0) ? (
            <span className="text-xs text-app-fg-muted tabular-nums">
              <NairaPrice amount={totalOrderAmount} /> gross
              {totalDeliveryFees > 0 && <> · -<NairaPrice amount={totalDeliveryFees} /> delivery</>}
              {commitmentFee > 0 && <> · -<NairaPrice amount={commitmentFee} /> commitment</>}
              {posFee > 0 && <> · -<NairaPrice amount={posFee} /> POS</>}
              {failedDeliveryCost > 0 && <> · -<NairaPrice amount={failedDeliveryCost} /> failed</>}
            </span>
          ) : null}
          <span className="text-xs text-brand-500 dark:text-brand-400">
            {detail.orders.length} order(s)
          </span>
        </div>
        {/* Receipts inline */}
        {(detail.receiptUrls ?? []).length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-app-fg-muted/80">Receipts:</span>
            {(detail.receiptUrls ?? []).map((url, i) => {
              const label = (detail.receiptUrls ?? []).length > 1 ? `Receipt ${i + 1}` : 'Receipt';
              return (
                <button
                  key={url}
                  type="button"
                  onClick={() => setReceiptPreview({ url, label })}
                  className="text-brand-600 dark:text-brand-400 hover:underline"
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}
        {detail.status === 'DISPUTED' && detail.disputeReason ? (
          <div className="rounded-md border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-900/20 p-2.5 text-sm text-danger-700 dark:text-danger-300">
            {detail.disputeReason}
          </div>
        ) : null}
      </div>

      {hasApprovePermission && detail.status === 'SENT' ? (
        <div className="rounded-xl border border-app-border bg-app-elevated p-3 md:p-4 shadow-sm space-y-2">
          <p className="text-sm text-app-fg-muted">
            Mark received when cash matches, or dispute if it does not.
          </p>
          {disputeMode ? (
            <>
              <Textarea
                label="Dispute reason"
                required
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                rows={2}
                placeholder="Why is this disputed? (min 10 chars)"
                error={
                  disputeReason.length > 0 && disputeReason.length < 10
                    ? `${disputeReason.length}/10 chars`
                    : undefined
                }
              />
              <div className="flex flex-wrap gap-2">
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
            <div className="flex flex-wrap gap-2">
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

      <div className="space-y-2">
        <div className="px-1">
          <h2 className="text-base font-semibold text-app-fg">Orders in this batch</h2>
          <p className="text-sm text-app-fg-muted mt-0.5">{detail.orders.length} linked order(s)</p>
        </div>
        <CompactTable<RemittanceOrderRow>
          columnVisibilityKey="admin.finance.remittance-detail"
          caption="Orders linked to this cash remittance"
          columns={orderColumns}
          rows={detail.orders}
          rowKey={(o) => o.id}
          emptyTitle="No orders on this remittance"
          renderMobileCard={(o) => (
            <Link
              to={`/admin/orders/${o.id}`}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-app-fg truncate" title={o.customerName}>
                    {o.customerName}
                  </p>
                  <OrderIdBadge id={o.id} orderNumber={o.orderNumber} ellipsis="" textClassName="font-mono text-mini text-app-fg-muted" />
                </div>
                <div className="shrink-0 text-right">
                  {o.totalAmount != null ? (
                    <NairaPrice
                      amount={Number(o.totalAmount)}
                      className="text-sm font-semibold text-app-fg tabular-nums"
                    />
                  ) : (
                    <span className="text-sm text-app-fg-muted">—</span>
                  )}
                  {o.deliveryFee != null && Number(o.deliveryFee) > 0 && (
                    <p className="text-mini tabular-nums text-danger-600 dark:text-danger-400">
                      -<NairaPrice amount={Number(o.deliveryFee)} /> delivery
                    </p>
                  )}
                  <p className="text-mini text-app-fg-muted">
                    {o.deliveredAt
                      ? new Date(o.deliveredAt).toLocaleDateString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <OrderStatusBadge status={o.status} showDot={false} className="!text-xs" />
                <span className="text-xs text-app-fg-muted">
                  {o.invoice ? o.invoice.referenceFormatted : 'No invoice'}
                </span>
              </div>
            </Link>
          )}
        />
      </div>

      <InvoicePreviewModal invoice={invoicePreview} onClose={() => setInvoicePreview(null)} />

      <ReceiptPreviewModal
        open={receiptPreview != null}
        onClose={() => setReceiptPreview(null)}
        receiptUrl={receiptPreview?.url ?? ''}
        title={receiptPreview ? `Remittance ${receiptPreview.label.toLowerCase()}` : 'Receipt'}
        imageAlt={receiptPreview?.label ?? 'Receipt'}
      />

      {hasApprovePermission && (
        <CashRemittanceEditModal
          open={showEditModal}
          onClose={() => closeEditModal()}
          detail={detail}
          onSuccess={() => {
            // Remove ?edit from URL and reload to pick up fresh data
            const url = new URL(window.location.href);
            url.searchParams.delete('edit');
            window.location.replace(url.toString());
          }}
        />
      )}
    </div>
  );
}
