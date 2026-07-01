import { Link, useFetcher, useNavigate } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { EmptyState } from '~/components/ui/empty-state';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { Checkbox } from '~/components/ui/checkbox';
import { AssignCloserModal } from '~/components/ui/assign-closer-modal';
import { SmartPick } from '~/components/ui/smart-pick';
import { Pagination } from '~/components/ui/pagination';
import { SearchInput } from '~/components/ui/search-input';
import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useMemo, useState, useCallback } from 'react';
import { formatStatus } from '~/features/shared/order-status';

export interface FollowUpBatchDetailData {
  id: string;
  name: string;
  source: string;
  branchName: string | null;
  createdByName: string | null;
  orderCount: number;
  assignmentMode: string;
  batchStatus?: string;
  groupId: string | null;
  groupName: string | null;
  groupMembers: Array<{ userId: string; userName: string }>;
  createdAt: string;
  items: Array<{
    itemId: string;
    orderId: string;
    originalStatus: string;
    assignedCsId: string | null;
    assignedCsName: string | null;
    addedAt: string;
    orderStatus: string;
    orderNumber: number;
    customerName: string;
    totalAmount: string | null;
    orderCreatedAt: string;
    followUpSourceOrderId: string | null;
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

export interface BatchDetailBundle {
  detail: FollowUpBatchDetailData | null;
  closers: Array<{ agentId: string; agentName: string }>;
}

interface Props {
  data: FollowUpBatchDetailData | null;
  closers?: Array<{ agentId: string; agentName: string }>;
  deferredLoading?: boolean;
  isCloser?: boolean;
  userId?: string;
}

const formatNaira = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const DEFAULT_PAGE_SIZE = 50;

export function FollowUpBatchDetailPage({ data, closers = [], deferredLoading = false, isCloser = false, userId }: Props) {
  const showSkeleton = deferredLoading;
  // Build closer options: prefer group members if a group is set, fall back to all closers
  const groupMembers = data?.groupMembers ?? [];
  const closerOptions = groupMembers.length > 0
    ? groupMembers.map((m) => ({ value: m.userId, label: m.userName }))
    : closers.map((c) => ({ value: c.agentId, label: c.agentName }));
  // Closers are read-only — no assign/delete/select
  const canAssign = !isCloser && closerOptions.length > 0;
  const canDelete = !isCloser;
  const isReverted = data?.batchStatus === 'REVERTED';
  const SAFE_STATUSES = new Set(['UNPROCESSED', 'CS_ASSIGNED', 'DELETED', 'CANCELLED']);
  const hasWorkedOrders = (data?.items ?? []).some((i) => !SAFE_STATUSES.has(i.orderStatus));

  // Selection
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignAgentIds, setAssignAgentIds] = useState<Set<string>>(new Set());

  // Delete batch
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const deleteFetcher = useFetcher<{ success?: boolean; error?: string; deleted?: boolean; reverted?: number; skipped?: number }>();
  const navigate = useNavigate();
  useFetcherToast(deleteFetcher.data, { successMessage: 'Batch deleted and orders reverted' });
  useCloseOnFetcherSuccess(deleteFetcher, () => {
    setDeleteConfirmOpen(false);
    navigate('/admin/cs/follow-up');
  });

  // Search + status filter + pagination (client-side)
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [assignmentFilter, setAssignmentFilter] = useState<'ALL' | 'ASSIGNED' | 'UNASSIGNED'>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Closers only see their own assigned orders
  const allItems = useMemo(() => {
    const items = data?.items ?? [];
    if (isCloser && userId) return items.filter((i) => i.assignedCsId === userId);
    return items;
  }, [data?.items, isCloser, userId]);

  // Unique statuses for the filter dropdown
  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of allItems) {
      counts.set(i.orderStatus, (counts.get(i.orderStatus) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => ({ value: status, label: `${formatStatus(status)} (${count})` }));
  }, [allItems]);

  // Filter by search + status + assignment
  const filteredItems = useMemo(() => {
    let result = allItems;
    if (statusFilter !== 'ALL') {
      result = result.filter((i) => i.orderStatus === statusFilter);
    }
    if (assignmentFilter === 'ASSIGNED') {
      result = result.filter((i) => !!i.assignedCsId);
    } else if (assignmentFilter === 'UNASSIGNED') {
      result = result.filter((i) => !i.assignedCsId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.customerName.toLowerCase().includes(q) ||
          (i.assignedCsName ?? '').toLowerCase().includes(q) ||
          i.orderId.includes(q),
      );
    }
    return result;
  }, [allItems, search, statusFilter, assignmentFilter]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleItem = useCallback((id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedItemIds(new Set()), []);

  // Single-item assignment
  const [singleAssignItem, setSingleAssignItem] = useState<string | null>(null);
  const [singleAssignCloserId, setSingleAssignCloserId] = useState('');

  const singleFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(singleFetcher.data, { successMessage: 'Assigned' });
  useCloseOnFetcherSuccess(singleFetcher, () => setSingleAssignItem(null));

  const bulkFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(bulkFetcher.data, { successMessage: 'Assigned' });
  useCloseOnFetcherSuccess(bulkFetcher, () => {
    setAssignModalOpen(false);
    setSelectedItemIds(new Set());
  });

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
        key: 'assignedTo',
        header: 'Assigned to',
        render: showSkeleton
          ? () => <TableCellTextPulse className="w-[6rem]" />
          : (item) => (
              <span className="text-xs text-app-fg-muted">
                {item.assignedCsName ?? (
                  canAssign ? (
                    <button
                      type="button"
                      onClick={() => { setSingleAssignItem(item.itemId); setSingleAssignCloserId(''); }}
                      className="text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      Assign
                    </button>
                  ) : '—'
                )}
              </span>
            ),
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
                  { key: 'view', kind: 'link', label: 'View', to: `/admin/orders/${item.orderId}` },
                  ...(canAssign && !item.assignedCsId
                    ? [{ key: 'assign', kind: 'button' as const, label: 'Assign', onClick: () => { setSingleAssignItem(item.itemId); setSingleAssignCloserId(''); } }]
                    : []),
                ]}
              />
            ),
      },
    ],
    [showSkeleton, canAssign],
  );

  if (!data && !deferredLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Batch not found" backTo="/admin/cs/follow-up" />
        <EmptyState title="Batch not found" description="This follow-up batch doesn't exist or was deleted." />
      </div>
    );
  }

  // For closers, compute stats from their filtered items; managers use server analytics
  const analytics = data?.analytics;
  const closerStatusCounts = useMemo(() => {
    if (!isCloser) return null;
    const counts: Record<string, number> = {};
    for (const i of allItems) counts[i.orderStatus] = (counts[i.orderStatus] ?? 0) + 1;
    return counts;
  }, [isCloser, allItems]);
  const effectiveCounts = isCloser ? closerStatusCounts! : (analytics?.statusCounts ?? {});
  const unprocessed = effectiveCounts.UNPROCESSED ?? 0;
  const csEngaged = (effectiveCounts.CS_ASSIGNED ?? 0) + (effectiveCounts.CS_ENGAGED ?? 0);
  const closerConfirmedSet = new Set(['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED']);
  const closerDeliveredSet = new Set(['DELIVERED', 'REMITTED']);
  const confirmedCount = isCloser ? allItems.filter((i) => closerConfirmedSet.has(i.orderStatus)).length : (analytics?.confirmed ?? 0);
  const deliveredCount = isCloser ? allItems.filter((i) => closerDeliveredSet.has(i.orderStatus)).length : (analytics?.delivered ?? 0);
  const totalForRate = allItems.length || 1;
  const confirmationRate = isCloser ? Math.round((confirmedCount / totalForRate) * 100) : (analytics?.confirmationRate ?? 0);
  const deliveryRate = isCloser ? Math.round((deliveredCount / totalForRate) * 100) : (analytics?.deliveryRate ?? 0);
  const assignedCount = allItems.filter((i) => i.assignedCsId).length;

  const selectableItems = filteredItems;

  return (
    <div className="space-y-4">
      <PageHeader
        title={data?.name ?? 'Loading…'}
        backTo="/admin/cs/follow-up"
        mobileInlineActions
        description={
          data
            ? isCloser
              ? `${allItems.length} order${allItems.length !== 1 ? 's' : ''} assigned to you.`
              : `${data.orderCount} orders from ${data.source} · ${data.branchName ?? 'No branch'}${data.groupName ? ` · Group: ${data.groupName}` : ''} · ${data.assignmentMode === 'EQUAL' ? 'Auto-assigned' : 'Manual assignment'}${isReverted ? ' · REVERTED' : ''}`
            : undefined
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Batch tools"
            saveFilterKey
            desktop={
              <>
                {selectedItemIds.size > 0 && canAssign && (
                  <button
                    type="button"
                    onClick={() => { setAssignModalOpen(true); setAssignAgentIds(new Set()); }}
                    className="btn-primary btn-sm inline-flex items-center gap-1.5"
                  >
                    Assign {selectedItemIds.size} order{selectedItemIds.size !== 1 ? 's' : ''}
                  </button>
                )}
                <PageRefreshButton />
                {canDelete && !isReverted && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="btn-danger btn-sm inline-flex items-center gap-1.5"
                  >
                    Delete batch
                  </button>
                )}
              </>
            }
            sheet={
              <>
                {selectedItemIds.size > 0 && canAssign && (
                  <button
                    type="button"
                    onClick={() => { setAssignModalOpen(true); setAssignAgentIds(new Set()); }}
                    className="btn-primary w-full inline-flex items-center justify-center"
                  >
                    Assign {selectedItemIds.size} order{selectedItemIds.size !== 1 ? 's' : ''}
                  </button>
                )}
                {canDelete && !isReverted && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="btn-danger w-full inline-flex items-center justify-center mt-2"
                  >
                    Delete batch
                  </button>
                )}
              </>
            }
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total', value: (isCloser ? allItems.length : (data?.orderCount ?? 0)).toLocaleString(), valueClassName: 'text-app-fg tabular-nums' },
          { label: 'Unprocessed', value: data ? unprocessed.toLocaleString() : '—', valueClassName: unprocessed > 0 ? 'text-warning-600 dark:text-warning-400 tabular-nums' : 'text-app-fg tabular-nums' },
          { label: 'In progress', value: data ? csEngaged.toLocaleString() : '—', valueClassName: 'text-info-600 dark:text-info-400 tabular-nums' },
          { label: 'Confirmed', value: data ? `${confirmedCount} (${confirmationRate}%)` : '—', valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
          { label: 'Delivered', value: data ? `${deliveredCount} (${deliveryRate}%)` : '—', valueClassName: 'text-brand-600 dark:text-brand-400 tabular-nums' },
          ...(canAssign
            ? [{ label: 'Assigned', value: data ? `${assignedCount}/${allItems.length}` : '—', valueClassName: assignedCount === allItems.length ? 'text-success-600 dark:text-success-400 tabular-nums' : 'text-warning-600 dark:text-warning-400 tabular-nums' }]
            : []),
        ]}
      />

      {/* Filters + Search + Smart Pick */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Search by name, order ID, or closer..."
            withSubmitButton
            wrapperClassName="min-w-0 flex-1 max-w-sm"
          />
          <FormSelect
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            options={[
              { value: 'ALL', label: `All statuses (${allItems.length})` },
              ...statusOptions,
            ]}
            wrapperClassName="w-auto min-w-[10rem]"
          />
          {canAssign && (
            <FormSelect
              value={assignmentFilter}
              onChange={(e) => { setAssignmentFilter(e.target.value as 'ALL' | 'ASSIGNED' | 'UNASSIGNED'); setPage(1); }}
              options={[
                { value: 'ALL', label: 'All assignments' },
                { value: 'ASSIGNED', label: `Assigned (${assignedCount})` },
                { value: 'UNASSIGNED', label: `Unassigned (${allItems.length - assignedCount})` },
              ]}
              wrapperClassName="w-auto min-w-[10rem]"
            />
          )}
        </div>
        {!isCloser && (
          <SmartPick
            total={selectableItems.length}
            selectedCount={selectedItemIds.size}
            onPick={(count) => {
              const ids = selectableItems.slice(0, count).map((i) => i.itemId);
              setSelectedItemIds(new Set(ids));
            }}
            onClear={clearSelection}
            itemNoun="orders"
          />
        )}
      </div>

      {/* Selection bar */}
      {selectedItemIds.size > 0 && (
        <div className="rounded-lg border border-brand-500/30 bg-brand-50/10 px-3 py-2 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-brand-600 dark:text-brand-400">
            {selectedItemIds.size} order{selectedItemIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            {canAssign && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => { setAssignModalOpen(true); setAssignAgentIds(new Set()); }}
              >
                Assign selected
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      {filteredItems.length === 0 && !showSkeleton ? (
        <EmptyState
          title={search ? 'No matching orders' : 'No orders'}
          description={search ? 'Try a different search term.' : 'This batch has no orders.'}
        />
      ) : (
        <CompactTable<ItemRow>
          columns={columns}
          rows={showSkeleton ? Array.from({ length: 5 }, (_, i) => ({ itemId: `sk-${i}`, orderId: '', originalStatus: '', assignedCsId: null, assignedCsName: null, addedAt: '', orderStatus: '', orderNumber: 0, customerName: '', totalAmount: null, orderCreatedAt: '', followUpSourceOrderId: null })) : paginatedItems}
          rowKey={(r) => r.itemId}
          selection={isCloser ? undefined : {
            selectedIds: selectedItemIds,
            getRowId: (item) => item.itemId,
            onToggle: (id) => toggleItem(id),
            onToggleAll: (selectAll) => {
              if (selectAll) {
                setSelectedItemIds((prev) => {
                  const next = new Set(prev);
                  for (const i of paginatedItems) next.add(i.itemId);
                  return next;
                });
              } else {
                setSelectedItemIds((prev) => {
                  const next = new Set(prev);
                  for (const i of paginatedItems) next.delete(i.itemId);
                  return next;
                });
              }
            },
            isSelectable: () => true,
          }}
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
              {item.assignedCsName && (
                <div className="text-xs text-app-fg-muted">Assigned: {item.assignedCsName}</div>
              )}
            </Link>
          )}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredItems.length)} of {filteredItems.length} orders
          </p>
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>
      )}

      {/* ── Single Assign Modal ────────────────────── */}
      <AssignCloserModal
        open={!!singleAssignItem}
        onClose={() => setSingleAssignItem(null)}
        selectedCount={1}
        options={closerOptions}
        selectedIds={new Set(singleAssignCloserId ? [singleAssignCloserId] : [])}
        onToggle={(id) => setSingleAssignCloserId((prev) => prev === id ? '' : id)}
        onSubmit={() => {
          if (!singleAssignCloserId || !singleAssignItem) return;
          singleFetcher.submit(
            { intent: 'assignBatchItem', batchItemId: singleAssignItem, csCloserId: singleAssignCloserId },
            { method: 'post' },
          );
        }}
        isSubmitting={singleFetcher.state === 'submitting'}
        mode="assign"
      />

      {/* ── Bulk Assign Modal ────────────────────── */}
      <AssignCloserModal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        selectedCount={selectedItemIds.size}
        options={closerOptions}
        selectedIds={assignAgentIds}
        onToggle={(id) => {
          setAssignAgentIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
        onSubmit={() => {
          const closerIds = [...assignAgentIds];
          if (closerIds.length === 0) return;
          bulkFetcher.submit(
            {
              intent: 'bulkAssignBatchItems',
              itemIds: JSON.stringify([...selectedItemIds]),
              csCloserIds: JSON.stringify(closerIds),
            },
            { method: 'post' },
          );
        }}
        isSubmitting={bulkFetcher.state === 'submitting'}
        mode="assign"
      />

      {/* ── Delete Batch Confirmation Modal ────────────────────── */}
      <Modal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        maxWidth="max-w-sm"
        contentClassName="p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-app-fg">Delete batch</h3>
        {(() => {
          const UNTOUCHED = new Set(['UNPROCESSED', 'CS_ASSIGNED', 'DELETED', 'CANCELLED']);
          const workedCount = allItems.filter((i) => !UNTOUCHED.has(i.orderStatus)).length;
          const revertCount = allItems.length - workedCount;
          return (
            <div className="space-y-2 text-sm text-app-fg-muted">
              <p>This will mark <strong>{data?.name}</strong> as reverted.</p>
              {revertCount > 0 && (
                <p>{revertCount} untouched order{revertCount !== 1 ? 's' : ''} will be reverted to their original state.</p>
              )}
              {workedCount > 0 && (
                <p className="text-app-fg">{workedCount} order{workedCount !== 1 ? 's have' : ' has'} been worked on — they will remain with their assigned closer as normal orders.</p>
              )}
            </div>
          );
        })()}
        {deleteFetcher.data?.error && (
          <p className="text-sm text-danger-600 dark:text-danger-400">{deleteFetcher.data.error}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="danger"
            loading={deleteFetcher.state === 'submitting'}
            loadingText="Deleting…"
            onClick={() => {
              if (!data) return;
              deleteFetcher.submit(
                { intent: 'deleteBatch', batchId: data.id },
                { method: 'post' },
              );
            }}
          >
            Delete batch
          </Button>
        </div>
      </Modal>
    </div>
  );
}
