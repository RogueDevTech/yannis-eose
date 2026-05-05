import { useEffect, useMemo, useState } from 'react';
import { Link, useFetcher, useLocation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { DescriptionList } from '~/components/ui/description-list';
import { Textarea } from '~/components/ui/textarea';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import {
  CompactTable,
  CompactTableActions,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import type { DescriptionItem } from '~/components/ui/description-list';
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
  const [activeReceiptIndex, setActiveReceiptIndex] = useState(0);
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

  const summaryItems: DescriptionItem[] = [
    {
      label: 'Batch ID',
      value: <span className="font-mono text-xs break-all">{detail.id}</span>,
    },
    {
      label: 'Logistics location',
      value: locationLine,
    },
    {
      label: 'Recorded by',
      value: recordedByLabel,
    },
  ];
  if (detail.receivedAt) {
    summaryItems.push({
      label: 'Marked received',
      value: `${new Date(detail.receivedAt).toLocaleString('en-NG')}${
        detail.receivedByName ? ` · ${detail.receivedByName}` : ''
      }`,
    });
  }
  summaryItems.push({
    label: 'Accountant notes',
    value: detail.notes?.trim() || '',
    fullWidth: true,
    hideIfEmpty: true,
  });

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
          <>
            <PageRefreshButton />
            <Link to={listBackHref} className="btn-secondary btn-sm inline-flex">
              Back to list
            </Link>
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

      <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={detail.status} label={STATUS_LABEL[detail.status] ?? detail.status} />
          <span className="text-xs text-app-fg-muted">
            Sent {new Date(detail.sentAt).toLocaleString('en-NG')} · by {recordedByLabel}
          </span>
        </div>
        <DescriptionList layout="grid" divided className="text-sm" items={summaryItems} />
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
          <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover flex items-center justify-center min-h-[min(50vh,28rem)]">
            <img
              src={(detail.receiptUrls ?? [])[activeReceiptIndex]}
              alt={`Receipt ${activeReceiptIndex + 1}`}
              className="w-full max-h-[min(70vh,40rem)] object-contain"
            />
          </div>
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
