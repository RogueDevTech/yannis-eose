import { useMemo } from 'react';
import { Link, useNavigation } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { TableActionButton } from '~/components/ui/table-action-button';
import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';

// ── Types ────────────────────────────────────────────────────────────

export interface FollowUpBranchRow {
  branchId: string | null;
  branchName: string | null;
  totalOrders: number;
  unprocessed: number;
  assigned: number;
  confirmed: number;
  delivered: number;
  deliveredRevenue: string;
  confirmationRate: number;
  deliveryRate: number;
}

/** Kept for backward compat — old batch shape (unused in new UI). */
export interface FollowUpBatchesPageData {
  batches: FollowUpBranchRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface Props {
  branches: FollowUpBranchRow[];
  startDate?: string;
  endDate?: string;
  periodAllTime?: boolean;
  isCloser?: boolean;
  deferredLoading?: boolean;
}

export function FollowUpBatchesPage({
  branches: branchesRaw,
  startDate = '',
  endDate = '',
  periodAllTime = false,
  isCloser = false,
  deferredLoading = false,
}: Props) {
  const branches = branchesRaw ?? [];
  const showSkeleton = deferredLoading;
  const navigation = useNavigation();
  const isRevalidating = navigation.state === 'loading' && !deferredLoading;

  const totalOrders = branches.reduce((s, b) => s + b.totalOrders, 0);
  const totalUnassigned = branches.reduce((s, b) => s + b.unprocessed, 0);
  const totalAssigned = branches.reduce((s, b) => s + (b.assigned ?? 0), 0);
  const totalConfirmed = branches.reduce((s, b) => s + b.confirmed, 0);
  const totalDelivered = branches.reduce((s, b) => s + b.delivered, 0);
  const totalRevenue = branches.reduce((s, b) => s + (Number(b.deliveredRevenue) || 0), 0);

  const buildOrdersLink = (branchId: string | null) => {
    const params = new URLSearchParams({ view: 'orders' });
    if (branchId) params.set('branchId', branchId);
    else params.set('unassigned', '1');
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (periodAllTime) params.set('period', 'all_time');
    return `/admin/cs/follow-up?${params.toString()}`;
  };

  const columns: CompactTableColumn<FollowUpBranchRow>[] = useMemo(
    () => [
      {
        key: 'branch',
        header: 'Branch',
        hideable: false,
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[8rem]" />
          : (b) => (
              <Link
                to={buildOrdersLink(b.branchId)}
                className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
              >
                {b.branchName ?? 'Unassigned'}
              </Link>
            ),
      },
      {
        key: 'orders',
        header: 'Total',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[3rem]" />
          : (b) => <span className="text-sm tabular-nums font-semibold text-app-fg">{b.totalOrders}</span>,
      },
      {
        key: 'unprocessed',
        header: 'Unassigned',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[3rem]" />
          : (b) => <span className="text-sm tabular-nums text-warning-600 dark:text-warning-400">{b.unprocessed}</span>,
      },
      {
        key: 'assigned',
        header: 'Assigned',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[3rem]" />
          : (b) => <span className="text-sm tabular-nums text-info-600 dark:text-info-400">{b.assigned}</span>,
      },
      {
        key: 'confirmed',
        header: 'Confirmed',
        align: 'right',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[4rem]" />
          : (b) => (
              <span className="text-sm tabular-nums text-brand-600 dark:text-brand-400">
                {b.confirmed} <span className="text-xs opacity-70">({b.confirmationRate}%)</span>
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
              <span className="text-sm tabular-nums text-success-600 dark:text-success-400">
                {b.delivered} <span className="text-xs opacity-70">({b.deliveryRate}%)</span>
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
        key: 'actions',
        header: '',
        align: 'right',
        hideable: false,
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[3rem]" />
          : (b) => (
              <TableActionButton to={buildOrdersLink(b.branchId)} variant="primary">
                View
              </TableActionButton>
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
        description={isCloser ? 'Follow-up orders assigned to you.' : 'Follow-up orders by branch.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Follow-up tools"
            saveFilterKey
            desktop={
              <>
                <DateFilterBar startDate={startDate} endDate={endDate} periodAllTime={periodAllTime} chrome="pill" />
                <PageRefreshButton />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={startDate}
        endDate={endDate}
        periodAllTime={periodAllTime}
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Batches', value: String(branches.length), valueClassName: 'text-app-fg' },
          { label: 'Total', value: totalOrders.toString(), valueClassName: 'text-app-fg' },
          { label: 'Unassigned', value: totalUnassigned.toString(), valueClassName: 'text-warning-600 dark:text-warning-400' },
          { label: 'Assigned', value: totalAssigned.toString(), valueClassName: 'text-info-600 dark:text-info-400' },
          { label: 'Confirmed', value: totalConfirmed.toString(), valueClassName: 'text-brand-600 dark:text-brand-400' },
          { label: 'Delivered', value: totalDelivered.toString(), valueClassName: 'text-success-600 dark:text-success-400' },
          { label: 'Revenue', value: formatNaira(totalRevenue), valueClassName: 'text-app-fg tabular-nums' },
        ]}
      />

      {branches.length === 0 && !showSkeleton ? (
        <EmptyState
          title="No follow-up orders"
          description="Configure follow-up rules to auto-pull stale orders."
          action={
            <Link to="/admin/settings/follow-up-config" className="btn-primary btn-sm inline-flex items-center gap-1.5">
              Go to config
            </Link>
          }
        />
      ) : (
        <CompactTable<FollowUpBranchRow>
          columnVisibilityKey="admin.cs.follow-up-batches"
          columns={columns}
          rows={showSkeleton ? Array.from({ length: 3 }, (_, i) => ({ branchId: `sk-${i}`, branchName: null, totalOrders: 0, unprocessed: 0, assigned: 0, confirmed: 0, delivered: 0, deliveredRevenue: '0', confirmationRate: 0, deliveryRate: 0 })) : branches}
          rowKey={(b) => b.branchId ?? '__unassigned'}
          loading={isRevalidating}
          loadingVariant="overlay"
          renderMobileCard={(b) => (
            <Link
              to={buildOrdersLink(b.branchId)}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate">
                  {b.branchName ?? 'Unassigned'}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-app-fg">{b.totalOrders} orders</span>
              </div>
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <span className="text-warning-600 dark:text-warning-400">{b.unprocessed} unassigned</span>
                <span className="text-info-600 dark:text-info-400">{b.assigned} assigned</span>
                <span className="text-brand-600 dark:text-brand-400">{b.confirmed} confirmed</span>
                <span className="text-success-600 dark:text-success-400">{b.delivered} delivered</span>
              </div>
            </Link>
          )}
        />
      )}
    </div>
  );
}
