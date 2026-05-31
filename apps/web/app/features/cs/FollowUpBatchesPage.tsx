import { Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { useMemo } from 'react';

export interface FollowUpBatchesPageData {
  batches: Array<{
    id: string;
    name: string;
    source: string;
    branchName: string | null;
    createdByName: string | null;
    orderCount: number;
    confirmed: number;
    delivered: number;
    deliveredRevenue: string;
    confirmationRate: number;
    deliveryRate: number;
    createdAt: string;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface Props extends FollowUpBatchesPageData {
  page: number;
  deferredLoading?: boolean;
}

export function FollowUpBatchesPage({
  batches,
  pagination,
  page,
  deferredLoading = false,
}: Props) {
  const showSkeleton = deferredLoading;

  // Aggregate stats across all visible batches
  const totalOrders = batches.reduce((s, b) => s + b.orderCount, 0);
  const totalConfirmed = batches.reduce((s, b) => s + b.confirmed, 0);
  const totalDelivered = batches.reduce((s, b) => s + b.delivered, 0);
  const totalRevenue = batches.reduce((s, b) => s + (Number(b.deliveredRevenue) || 0), 0);

  type BatchRow = FollowUpBatchesPageData['batches'][number];

  const columns: CompactTableColumn<BatchRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Batch',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[10rem]" />
          : (b) => (
              <Link to={`/admin/cs/follow-up/${b.id}`} className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
                {b.name}
              </Link>
            ),
      },
      {
        key: 'source',
        header: 'Source',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[5rem]" />
          : (b) => (
              <span className="text-xs text-app-fg-muted capitalize">{b.source}</span>
            ),
      },
      {
        key: 'branch',
        header: 'Branch',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[6rem]" />
          : (b) => <span className="text-xs text-app-fg-muted">{b.branchName ?? '—'}</span>,
      },
      {
        key: 'orders',
        header: 'Orders',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[3rem]" />
          : (b) => <span className="text-sm tabular-nums text-app-fg">{b.orderCount}</span>,
      },
      {
        key: 'confirmed',
        header: 'Confirmed',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[4rem]" />
          : (b) => (
              <span className="text-sm tabular-nums text-app-fg">
                {b.confirmed} <span className="text-app-fg-muted text-xs">({b.confirmationRate}%)</span>
              </span>
            ),
      },
      {
        key: 'delivered',
        header: 'Delivered',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[4rem]" />
          : (b) => (
              <span className="text-sm tabular-nums text-app-fg">
                {b.delivered} <span className="text-app-fg-muted text-xs">({b.deliveryRate}%)</span>
              </span>
            ),
      },
      {
        key: 'revenue',
        header: 'Revenue',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[5rem]" />
          : (b) => <NairaPrice amount={Number(b.deliveredRevenue) || 0} />,
      },
      {
        key: 'date',
        header: 'Created',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[6rem]" />
          : (b) => (
              <div className="text-xs text-app-fg-muted">
                <div>{new Date(b.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                {b.createdByName && <div className="truncate max-w-[8rem]">{b.createdByName}</div>}
              </div>
            ),
      },
    ],
    [showSkeleton],
  );

  const formatNaira = (n: number) =>
    new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow Up"
        mobileInlineActions
        description="Track batches of reopened orders and their conversion performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Follow-up tools"
            desktop={
              <>
                <PageRefreshButton />
                <Link to="/admin/cs/follow-up?view=create" className="btn-primary btn-sm inline-flex items-center gap-1.5">
                  + Create follow-up
                </Link>
              </>
            }
            sheet={
              <Link to="/admin/cs/follow-up?view=create" className="btn-primary w-full inline-flex items-center justify-center">
                + Create follow-up
              </Link>
            }
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: `Batches (${pagination.total})`, value: pagination.total.toString() },
          { label: `Orders (${totalOrders})`, value: totalOrders.toString() },
          { label: `Confirmed (${totalConfirmed})`, value: totalOrders > 0 ? `${Math.round((totalConfirmed / totalOrders) * 100)}%` : '—', valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
          { label: `Delivered (${totalDelivered})`, value: totalOrders > 0 ? `${Math.round((totalDelivered / totalOrders) * 100)}%` : '—', valueClassName: 'text-brand-600 dark:text-brand-400 tabular-nums' },
          { label: 'Revenue recovered', value: formatNaira(totalRevenue), valueClassName: 'text-app-fg tabular-nums' },
        ]}
      />

      {batches.length === 0 && !showSkeleton ? (
        <EmptyState
          title="No follow-up batches"
          description="Create your first follow-up batch to start tracking order recovery."
          action={
            <Link to="/admin/cs/follow-up?view=create" className="btn-primary btn-sm inline-flex items-center gap-1.5">
              + Create follow-up
            </Link>
          }
        />
      ) : (
        <CompactTable<BatchRow>
          columns={columns}
          rows={showSkeleton ? Array.from({ length: 5 }, (_, i) => ({ id: `sk-${i}`, name: '', source: '', branchName: null, createdByName: null, orderCount: 0, confirmed: 0, delivered: 0, deliveredRevenue: '0', confirmationRate: 0, deliveryRate: 0, createdAt: '' })) : batches}
          rowKey={(b) => b.id}
          renderMobileCard={(b) => (
            <Link
              to={`/admin/cs/follow-up/${b.id}`}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate">{b.name}</span>
                <span className="shrink-0 text-xs text-app-fg-muted capitalize">{b.source}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>{b.branchName ?? '—'}</span>
                <span>{b.orderCount} orders</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-success-600 dark:text-success-400">{b.confirmationRate}% confirmed</span>
                <span className="text-brand-600 dark:text-brand-400">{b.deliveryRate}% delivered</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <NairaPrice amount={Number(b.deliveredRevenue) || 0} />
                <span>{new Date(b.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</span>
              </div>
            </Link>
          )}
        />
      )}

      {pagination.totalPages > 1 && (
        <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            Showing {batches.length} of {pagination.total} batches
          </p>
          <Pagination page={page} totalPages={pagination.totalPages} pageParam="page" />
        </div>
      )}
    </div>
  );
}
