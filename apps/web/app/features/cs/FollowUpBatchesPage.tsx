import { useCallback, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Tabs } from '~/components/ui/tabs';
import { Modal } from '~/components/ui/modal';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import { Pagination } from '~/components/ui/pagination';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Spinner } from '~/components/ui/spinner';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { FollowUpGroupsPanel, GroupFormModal } from '~/features/cs/FollowUpGroupsPage';
import type { FollowUpGroupItem, CloserWithBranches } from '~/features/cs/FollowUpGroupsPage';
import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import type { FollowUpBatchDetailData } from './FollowUpBatchDetailPage';

export interface FollowUpBatchesPageData {
  batches: Array<{
    id: string;
    name: string;
    source: string;
    branchName: string | null;
    groupName: string | null;
    createdByName: string | null;
    orderCount: number;
    confirmed: number;
    delivered: number;
    deliveredRevenue: string;
    confirmationRate: number;
    deliveryRate: number;
    batchStatus?: string;
    createdAt: string;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface Props extends FollowUpBatchesPageData {
  page: number;
  startDate?: string;
  endDate?: string;
  periodAllTime?: boolean;
  isCloser?: boolean;
  groups?: FollowUpGroupItem[];
  closers?: CloserWithBranches[];
  deferredLoading?: boolean;
}

export function FollowUpBatchesPage({
  batches: batchesRaw,
  pagination: paginationRaw,
  page,
  startDate = '',
  endDate = '',
  periodAllTime = false,
  isCloser = false,
  groups = [],
  closers = [],
  deferredLoading = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<'batches' | 'groups'>('batches');
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const createGroupFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(createGroupFetcher.data, { successMessage: 'Group created' });
  useCloseOnFetcherSuccess(createGroupFetcher, () => {
    setCreateGroupOpen(false);
    setActiveTab('groups');
  });
  const batches = batchesRaw ?? [];
  const pagination = paginationRaw ?? { page: 1, limit: 20, total: 0, totalPages: 1 };
  const showSkeleton = deferredLoading;

  // Aggregate stats across all visible batches
  const totalOrders = batches.reduce((s, b) => s + b.orderCount, 0);
  const totalConfirmed = batches.reduce((s, b) => s + b.confirmed, 0);
  const totalDelivered = batches.reduce((s, b) => s + b.delivered, 0);
  const totalRevenue = batches.reduce((s, b) => s + (Number(b.deliveredRevenue) || 0), 0);

  type BatchRow = FollowUpBatchesPageData['batches'][number];

  // ── Peek modal state ──────────────────────────────────
  const [peekBatchId, setPeekBatchId] = useState<string | null>(null);
  const [peekData, setPeekData] = useState<FollowUpBatchDetailData | null>(null);
  const [peekLoading, setPeekLoading] = useState(false);

  const openPeek = useCallback((id: string) => {
    setPeekBatchId(id);
    setPeekData(null);
    setPeekLoading(true);
    const input = encodeURIComponent(JSON.stringify({ batchId: id }));
    fetch(`${window.__ENV?.API_URL ?? ''}/trpc/orders.getFollowUpBatchDetail?input=${input}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((json) => {
        const d = (json as { result?: { data?: FollowUpBatchDetailData } })?.result?.data ?? null;
        setPeekData(d);
      })
      .catch(() => setPeekData(null))
      .finally(() => setPeekLoading(false));
  }, []);

  const closePeek = useCallback(() => {
    setPeekBatchId(null);
    setPeekData(null);
  }, []);

  const columns: CompactTableColumn<BatchRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Batch',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[10rem]" />
          : (b) => (
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={() => openPeek(b.id)} className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline text-left">
                  {b.name}
                </button>
                {b.batchStatus === 'REVERTED' && (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">Reverted</span>
                )}
              </span>
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
        key: 'group',
        header: 'Group',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[6rem]" />
          : (b) => <span className="text-xs text-app-fg-muted">{b.groupName ?? '—'}</span>,
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
              <span className="text-xs text-app-fg-muted">
                {new Date(b.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
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
          : (b) => (
              <TableRowActionsSheet
                ariaLabel={`Actions for ${b.name}`}
                sheetTitle={b.name}
                actions={[
                  { key: 'view', kind: 'link', label: 'View', to: `/admin/cs/follow-up/${b.id}` },
                ]}
              />
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
        description={isCloser ? 'Batches assigned to you.' : 'Track batches, groups, and conversion performance.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Follow-up tools"
            desktop={
              <>
                {!isCloser && <DateFilterBar startDate={startDate} endDate={endDate} periodAllTime={periodAllTime} chrome="pill" />}
                <PageRefreshButton />
                {!isCloser && (
                  <button
                    type="button"
                    onClick={() => setCreateGroupOpen(true)}
                    className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                  >
                    + New group
                  </button>
                )}
                {!isCloser && (
                  <Link to="/admin/cs/follow-up?view=create" className="btn-primary btn-sm inline-flex items-center gap-1.5">
                    + Create batch
                  </Link>
                )}
              </>
            }
            sheet={
              isCloser ? undefined : (
                <>
                  <button
                    type="button"
                    onClick={() => setCreateGroupOpen(true)}
                    className="btn-secondary w-full inline-flex items-center justify-center"
                  >
                    + New group
                  </button>
                  <Link to="/admin/cs/follow-up?view=create" className="btn-primary w-full inline-flex items-center justify-center mt-2">
                    + Create batch
                  </Link>
                </>
              )
            }
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Batches', value: pagination.total.toString() },
          { label: 'Orders', value: totalOrders.toString() },
          { label: 'Confirmed', value: totalOrders > 0 ? `${Math.round((totalConfirmed / totalOrders) * 100)}%` : '—', valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
          { label: 'Delivered', value: totalOrders > 0 ? `${Math.round((totalDelivered / totalOrders) * 100)}%` : '—', valueClassName: 'text-brand-600 dark:text-brand-400 tabular-nums' },
          { label: 'Revenue', value: formatNaira(totalRevenue), valueClassName: 'text-app-fg tabular-nums' },
          { label: 'Groups', value: groups.length.toString() },
        ]}
      />

      {!isCloser && (
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v as 'batches' | 'groups')}
          tabs={[
            { value: 'batches', label: 'Batches' },
            { value: 'groups', label: 'Groups', badge: groups.length || undefined },
          ]}
        />
      )}

      {activeTab === 'groups' ? (
        <FollowUpGroupsPanel groups={groups} closers={closers} deferredLoading={deferredLoading} />
      ) : (
      <>

      {batches.length === 0 && !showSkeleton ? (
        <EmptyState
          title="No follow-up batches"
          description="Create your first follow-up batch to start tracking order recovery."
          action={
            <Link to="/admin/cs/follow-up?view=create" className="btn-primary btn-sm inline-flex items-center gap-1.5">
              + Create batch
            </Link>
          }
        />
      ) : (
        <CompactTable<BatchRow>
          columns={columns}
          rows={showSkeleton ? Array.from({ length: 5 }, (_, i) => ({ id: `sk-${i}`, name: '', source: '', branchName: null, groupName: null, createdByName: null, orderCount: 0, confirmed: 0, delivered: 0, deliveredRevenue: '0', confirmationRate: 0, deliveryRate: 0, batchStatus: 'ACTIVE', createdAt: '' })) : batches}
          rowKey={(b) => b.id}
          renderMobileCard={(b) => (
            <button
              type="button"
              onClick={() => openPeek(b.id)}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate">
                  {b.name}
                  {b.batchStatus === 'REVERTED' && (
                    <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">Reverted</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-app-fg-muted capitalize">{b.source}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>{b.branchName ?? '—'}{b.groupName ? ` · ${b.groupName}` : ''}</span>
                <span>{b.orderCount} orders</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-success-600 dark:text-success-400">{b.confirmationRate}% confirmed</span>
                <span className="text-brand-600 dark:text-brand-400">{b.deliveryRate}% delivered</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>{new Date(b.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</span>
              </div>
            </button>
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
      </>
      )}
      {/* ── Batch detail peek modal ────────────────────── */}
      <Modal
        open={!!peekBatchId}
        onClose={closePeek}
        maxWidth="max-w-lg"
        contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-app-border shrink-0">
          <div>
            <h3 className="text-base font-semibold text-app-fg">{peekData?.name ?? 'Loading…'}</h3>
            {peekData && (
              <p className="text-xs text-app-fg-muted mt-0.5">
                {peekData.orderCount} orders · {peekData.source} · {peekData.branchName ?? 'No branch'}
              </p>
            )}
          </div>
          <button type="button" onClick={closePeek} className="text-app-fg-muted hover:text-app-fg p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {peekLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : peekData ? (
            <div className="space-y-0">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-px bg-app-border">
                {[
                  { label: 'Confirmed', value: `${peekData.analytics.confirmed} (${peekData.analytics.confirmationRate}%)`, cls: 'text-success-600 dark:text-success-400' },
                  { label: 'Delivered', value: `${peekData.analytics.delivered} (${peekData.analytics.deliveryRate}%)`, cls: 'text-brand-600 dark:text-brand-400' },
                ].map((s) => (
                  <div key={s.label} className="bg-app-elevated px-4 py-2.5 text-center">
                    <p className="text-micro font-medium text-app-fg-muted uppercase tracking-wider">{s.label}</p>
                    <p className={`text-sm font-semibold tabular-nums ${s.cls}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Order items */}
              <div className="divide-y divide-app-border">
                {peekData.items.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-app-fg-muted">No orders in this batch.</p>
                ) : (
                  peekData.items.map((item) => (
                    <Link
                      key={item.itemId}
                      to={`/admin/orders/${item.orderId}`}
                      onClick={closePeek}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-app-hover transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-app-fg truncate">{item.customerName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <OrderStatusBadge status={item.originalStatus} />
                          <svg className="w-3 h-3 text-app-fg-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                          </svg>
                          <OrderStatusBadge status={item.orderStatus} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <NairaPrice amount={item.totalAmount ? Number(item.totalAmount) : null} />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-app-fg-muted">Batch not found.</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-app-border p-3 shrink-0 flex gap-2">
          <Link
            to={`/admin/cs/follow-up/${peekBatchId}`}
            onClick={closePeek}
            className="btn-primary btn-sm flex-1 justify-center inline-flex items-center"
          >
            View full page
          </Link>
          <button type="button" onClick={closePeek} className="btn-secondary btn-sm flex-1 justify-center">
            Close
          </button>
        </div>
      </Modal>

      {/* ── Create Group Modal (always mounted, works from any tab) ── */}
      <GroupFormModal
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        closers={closers}
        fetcher={createGroupFetcher}
        intent="createFollowUpGroup"
        title="New Follow-Up Group"
      />
    </div>
  );
}
