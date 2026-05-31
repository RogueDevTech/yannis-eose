import { Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { EmptyState } from '~/components/ui/empty-state';
import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { useMemo } from 'react';

export interface FollowUpBatchDetailData {
  id: string;
  name: string;
  source: string;
  branchName: string | null;
  createdByName: string | null;
  orderCount: number;
  createdAt: string;
  items: Array<{
    itemId: string;
    orderId: string;
    originalStatus: string;
    addedAt: string;
    orderStatus: string;
    customerName: string;
    totalAmount: string | null;
    orderCreatedAt: string;
  }>;
  analytics: {
    statusCounts: Record<string, number>;
    confirmed: number;
    delivered: number;
    confirmationRate: number;
    deliveryRate: number;
    totalRevenue: string;
    deliveredRevenue: string;
  };
}

interface Props {
  data: FollowUpBatchDetailData | null;
  deferredLoading?: boolean;
}

const formatNaira = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

export function FollowUpBatchDetailPage({ data, deferredLoading = false }: Props) {
  const showSkeleton = deferredLoading;

  type ItemRow = NonNullable<FollowUpBatchDetailData>['items'][number];

  const columns: CompactTableColumn<ItemRow>[] = useMemo(
    () => [
      {
        key: 'customer',
        header: 'Customer',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[9rem]" />
          : (item) => (
              <Link to={`/admin/orders/${item.orderId}`} className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline truncate block max-w-[12rem]">
                {item.customerName}
              </Link>
            ),
      },
      {
        key: 'originalStatus',
        header: 'Was',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[5rem]" />
          : (item) => <OrderStatusBadge status={item.originalStatus} expanded />,
      },
      {
        key: 'currentStatus',
        header: 'Now',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[5rem]" />
          : (item) => <OrderStatusBadge status={item.orderStatus} expanded />,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[5rem]" />
          : (item) => <NairaPrice amount={item.totalAmount ? Number(item.totalAmount) : null} />,
      },
      {
        key: 'date',
        header: 'Added',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[6rem]" />
          : (item) => (
              <span className="text-xs text-app-fg-muted">
                {new Date(item.addedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: showSkeleton
          ? () => null
          : (item) => (
              <TableRowActionsSheet
                ariaLabel={`Actions for ${item.customerName}`}
                sheetTitle={item.customerName}
                actions={[
                  { key: 'view', kind: 'link', label: 'View order', to: `/admin/orders/${item.orderId}` },
                ]}
              />
            ),
      },
    ],
    [showSkeleton],
  );

  if (!data && !deferredLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Batch not found" backTo="/admin/cs/follow-up" />
        <EmptyState title="Batch not found" description="This follow-up batch doesn't exist or was deleted." />
      </div>
    );
  }

  const analytics = data?.analytics;
  const items = data?.items ?? [];

  // Status funnel for the stat strip
  const unprocessed = analytics?.statusCounts.UNPROCESSED ?? 0;
  const csEngaged = (analytics?.statusCounts.CS_ASSIGNED ?? 0) + (analytics?.statusCounts.CS_ENGAGED ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={data?.name ?? 'Loading…'}
        backTo="/admin/cs/follow-up"
        mobileInlineActions
        description={
          data
            ? `${data.orderCount} orders from ${data.source} · ${data.branchName ?? 'No branch'} · by ${data.createdByName ?? '—'} on ${new Date(data.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`
            : undefined
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Batch tools"
            desktop={<PageRefreshButton />}
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: `Total (${data?.orderCount ?? 0})`, value: formatNaira(Number(analytics?.totalRevenue ?? 0)), valueClassName: 'text-app-fg tabular-nums' },
          { label: `Unprocessed (${unprocessed})`, value: data ? `${unprocessed}` : '—', valueClassName: unprocessed > 0 ? 'text-warning-600 dark:text-warning-400 tabular-nums' : 'text-app-fg tabular-nums' },
          { label: `In progress (${csEngaged})`, value: data ? `${csEngaged}` : '—', valueClassName: 'text-info-600 dark:text-info-400 tabular-nums' },
          { label: `Confirmed (${analytics?.confirmed ?? 0})`, value: data ? `${analytics?.confirmationRate ?? 0}%` : '—', valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
          { label: `Delivered (${analytics?.delivered ?? 0})`, value: data ? `${analytics?.deliveryRate ?? 0}%` : '—', valueClassName: 'text-brand-600 dark:text-brand-400 tabular-nums' },
          { label: 'Revenue recovered', value: formatNaira(Number(analytics?.deliveredRevenue ?? 0)), valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
        ]}
      />

      {items.length === 0 && !showSkeleton ? (
        <EmptyState title="No orders" description="This batch has no orders." />
      ) : (
        <CompactTable<ItemRow>
          columns={columns}
          rows={showSkeleton ? Array.from({ length: 5 }, (_, i) => ({ itemId: `sk-${i}`, orderId: '', originalStatus: '', addedAt: '', orderStatus: '', customerName: '', totalAmount: null, orderCreatedAt: '' })) : items}
          rowKey={(r) => r.itemId}
          renderMobileCard={(item) => (
            <Link
              to={`/admin/orders/${item.orderId}`}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate">{item.customerName}</span>
                <OrderStatusBadge status={item.orderStatus} expanded />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>Was: <OrderStatusBadge status={item.originalStatus} expanded /></span>
                <NairaPrice amount={item.totalAmount ? Number(item.totalAmount) : null} />
              </div>
            </Link>
          )}
        />
      )}
    </div>
  );
}
