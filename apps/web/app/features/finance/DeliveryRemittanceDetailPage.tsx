import { useEffect, useMemo, useState } from 'react';
import { Link, useFetcher, useLocation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Breadcrumb } from '~/components/ui/breadcrumb';
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

type RemittanceOrderRow = DeliveryRemittanceDetail['orders'][number];

export function DeliveryRemittanceDetailPage({
  detail,
  hasApprovePermission,
  userMap,
}: DeliveryRemittanceDetailPageProps) {
  const location = useLocation();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [disputeMode, setDisputeMode] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [dismissedError, setDismissedError] = useState(false);

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
  const remittanceTotal = detail.orders.reduce(
    (sum, order) => sum + (order.totalAmount != null ? Number(order.totalAmount) : 0),
    0,
  );

  const recordedByLabel =
    detail.sentByName?.trim() || userMap[detail.sentBy] || `${detail.sentBy.slice(0, 8)}…`;

  const locationLine =
    detail.locationName != null
      ? detail.locationProviderName != null
        ? `${detail.locationName} — ${detail.locationProviderName}`
        : detail.locationName
      : 'Unknown location';

  const orderColumns = useMemo((): CompactTableColumn<RemittanceOrderRow>[] => {
    return [
      {
        key: 'customer',
        header: 'Customer',
        render: (o) => (
          <span className="text-sm font-medium text-app-fg truncate max-w-[14rem]" title={o.customerName}>
            {o.customerName}
          </span>
        ),
      },
      {
        key: 'orderId',
        header: 'Order',
        nowrap: true,
        render: (o) => (
          <OrderIdBadge id={o.id} ellipsis="" textClassName="font-mono text-xs text-app-fg-muted" />
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
        render: (o) =>
          o.totalAmount != null ? (
            <NairaPrice amount={Number(o.totalAmount)} className="text-sm font-medium tabular-nums" />
          ) : (
            <span className="text-app-fg-muted">—</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (o) => (
          <CompactTableActions className="justify-end">
            <TableActionButton to={`/admin/orders/${o.id}`} variant="primary">
              View
            </TableActionButton>
          </CompactTableActions>
        ),
      },
    ];
  }, []);

  const breadcrumbCurrent =
    detail.status === 'SENT' ? 'Review remittance' : `Remittance · ${detail.id.slice(0, 8)}…`;

  return (
    <div className="space-y-5 w-full min-w-0">
      <Breadcrumb
        className="mb-1"
        items={[
          { label: 'Finance', to: '/admin/finance/overview' },
          { label: 'Cash remittances', to: listBackHref },
          { label: breadcrumbCurrent },
        ]}
      />

      <PageHeader
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
            sheetTitle="Cash remittance tools"
            sheetSubtitle={<span>Refresh and navigation</span>}
            triggerAriaLabel="Cash remittance toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Link to={listBackHref} className="btn-secondary btn-sm inline-flex">
                  Back to list
                </Link>
              </>
            }
            sheet={
              <Link to={listBackHref} className="btn-secondary btn-sm w-full justify-center">
                Back to list
              </Link>
            }
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

      <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm space-y-4">
        {/* Status + all metadata in a single flex-wrap row. Each pair is inline
            (label + value), separators are vertical bars. Wraps on narrow
            viewports — order matches the visual hierarchy: status first, then
            who/when sent it, then identifying fields, then settlement timing. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
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
                <span className="font-medium text-app-fg-muted/80">Marked received</span>{' '}
                <span className="text-app-fg">
                  {new Date(detail.receivedAt).toLocaleString('en-NG')}
                  {detail.receivedByName ? ` · ${detail.receivedByName}` : ''}
                </span>
              </span>
            </>
          ) : null}
        </div>
        {detail.notes?.trim() ? (
          <div className="text-sm text-app-fg-muted">
            <span className="font-medium text-app-fg-muted/80">Accountant notes:</span>{' '}
            <span className="text-app-fg">{detail.notes}</span>
          </div>
        ) : null}
        <div className="pt-1 border-t border-app-border">
          <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">
            Remittance total
          </p>
          <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
            <NairaPrice amount={remittanceTotal} />
          </p>
          <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
            Sum of {detail.orders.length} linked order(s) (includes REMITTED after settlement)
          </p>
        </div>
        {detail.status === 'DISPUTED' && detail.disputeReason ? (
          <div className="rounded-md border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-900/20 p-3 text-sm text-danger-700 dark:text-danger-300">
            {detail.disputeReason}
          </div>
        ) : null}
      </div>

      {hasApprovePermission && detail.status === 'SENT' ? (
        <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-app-fg">Settlement</h2>
          <p className="text-sm text-app-fg-muted">
            Mark received when cash matches this batch, or dispute with a reason if it does not.
          </p>
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

      <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm space-y-3">
        <h2 className="text-base font-semibold text-app-fg">Receipts</h2>
        {/* Receipts open on demand — embedding the image inline made the page
            heavy on long batches with multiple attachments and pushed the
            "Orders in this batch" table below the fold. Tap to open in a new
            tab when needed. */}
        {(detail.receiptUrls ?? []).length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {(detail.receiptUrls ?? []).map((url, i) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:underline"
                >
                  {(detail.receiptUrls ?? []).length > 1
                    ? `View receipt ${i + 1}`
                    : 'View receipt'}
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-app-fg-muted italic">No receipts attached</p>
        )}
      </div>

      <div className="rounded-xl border border-app-border bg-app-elevated p-0 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-app-border">
          <h2 className="text-base font-semibold text-app-fg">Orders in this batch</h2>
          <p className="text-sm text-app-fg-muted mt-0.5">{detail.orders.length} linked order(s)</p>
        </div>
        <CompactTable<RemittanceOrderRow>
          caption="Orders linked to this cash remittance"
          columns={orderColumns}
          rows={detail.orders}
          rowKey={(o) => o.id}
          withCard={false}
          className="min-w-[720px]"
          emptyTitle="No orders on this remittance"
        />
      </div>
    </div>
  );
}
