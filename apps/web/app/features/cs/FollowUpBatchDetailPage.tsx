import { Link, useFetcher } from '@remix-run/react';
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
import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useMemo, useState, useCallback } from 'react';

export interface FollowUpBatchDetailData {
  id: string;
  name: string;
  source: string;
  branchName: string | null;
  createdByName: string | null;
  orderCount: number;
  assignmentMode: string;
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
  const isManualMode = data?.assignmentMode === 'MANUAL';
  const hasGroup = !!data?.groupId;
  const groupMembers = data?.groupMembers ?? [];

  // Selection for manual bulk assignment
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignCloserId, setAssignCloserId] = useState('');

  const toggleItem = useCallback((id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!data) return;
    const unassignedItems = data.items.filter((i) => !i.assignedCsId);
    if (selectedItemIds.size === unassignedItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(unassignedItems.map((i) => i.itemId)));
    }
  }, [data, selectedItemIds.size]);

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
      // Checkbox column for manual assignment
      ...(isManualMode && hasGroup
        ? [
            {
              key: 'select' as const,
              header: (
                <Checkbox
                  checked={data ? selectedItemIds.size === data.items.filter((i) => !i.assignedCsId).length && selectedItemIds.size > 0 : false}
                  onChange={toggleAll}
                />
              ),
              tight: true,
              render: showSkeleton
                ? () => null
                : (item: ItemRow) =>
                    item.assignedCsId ? (
                      <span className="text-xs text-success-600 dark:text-success-400">&#10003;</span>
                    ) : (
                      <Checkbox
                        checked={selectedItemIds.has(item.itemId)}
                        onChange={() => toggleItem(item.itemId)}
                      />
                    ),
            } satisfies CompactTableColumn<ItemRow>,
          ]
        : []),
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
                  isManualMode && hasGroup ? (
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
                  { key: 'view', kind: 'link', label: 'View order', to: `/admin/orders/${item.orderId}` },
                  ...(isManualMode && hasGroup && !item.assignedCsId
                    ? [{ key: 'assign', kind: 'button' as const, label: 'Assign closer', onClick: () => { setSingleAssignItem(item.itemId); setSingleAssignCloserId(''); } }]
                    : []),
                ]}
              />
            ),
      },
    ],
    [showSkeleton, isManualMode, hasGroup, selectedItemIds, data],
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
  const unprocessed = analytics?.statusCounts.UNPROCESSED ?? 0;
  const csEngaged = (analytics?.statusCounts.CS_ASSIGNED ?? 0) + (analytics?.statusCounts.CS_ENGAGED ?? 0);
  const assignedCount = items.filter((i) => i.assignedCsId).length;
  const unassignedCount = items.length - assignedCount;

  return (
    <div className="space-y-4">
      <PageHeader
        title={data?.name ?? 'Loading…'}
        backTo="/admin/cs/follow-up"
        mobileInlineActions
        description={
          data
            ? `${data.orderCount} orders from ${data.source} · ${data.branchName ?? 'No branch'}${data.groupName ? ` · Group: ${data.groupName}` : ''} · ${data.assignmentMode === 'EQUAL' ? 'Auto-assigned' : 'Manual assignment'}`
            : undefined
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Batch tools"
            desktop={
              <>
                {isManualMode && hasGroup && selectedItemIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => { setAssignModalOpen(true); setAssignCloserId(''); }}
                    className="btn-primary btn-sm inline-flex items-center gap-1.5"
                  >
                    Assign {selectedItemIds.size} order{selectedItemIds.size !== 1 ? 's' : ''}
                  </button>
                )}
                <PageRefreshButton />
              </>
            }
            sheet={
              isManualMode && hasGroup && selectedItemIds.size > 0 ? (
                <button
                  type="button"
                  onClick={() => { setAssignModalOpen(true); setAssignCloserId(''); }}
                  className="btn-primary w-full inline-flex items-center justify-center"
                >
                  Assign {selectedItemIds.size} order{selectedItemIds.size !== 1 ? 's' : ''}
                </button>
              ) : undefined
            }
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total', value: (data?.orderCount ?? 0).toLocaleString(), valueClassName: 'text-app-fg tabular-nums' },
          { label: 'Unprocessed', value: data ? unprocessed.toLocaleString() : '—', valueClassName: unprocessed > 0 ? 'text-warning-600 dark:text-warning-400 tabular-nums' : 'text-app-fg tabular-nums' },
          { label: 'In progress', value: data ? csEngaged.toLocaleString() : '—', valueClassName: 'text-info-600 dark:text-info-400 tabular-nums' },
          { label: 'Confirmed', value: data ? `${analytics?.confirmed ?? 0} (${analytics?.confirmationRate ?? 0}%)` : '—', valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
          { label: 'Delivered', value: data ? `${analytics?.delivered ?? 0} (${analytics?.deliveryRate ?? 0}%)` : '—', valueClassName: 'text-brand-600 dark:text-brand-400 tabular-nums' },
          ...(hasGroup
            ? [{ label: 'Assigned', value: data ? `${assignedCount}/${items.length}` : '—', valueClassName: assignedCount === items.length ? 'text-success-600 dark:text-success-400 tabular-nums' : 'text-warning-600 dark:text-warning-400 tabular-nums' }]
            : []),
        ]}
      />

      {items.length === 0 && !showSkeleton ? (
        <EmptyState title="No orders" description="This batch has no orders." />
      ) : (
        <CompactTable<ItemRow>
          columns={columns}
          rows={showSkeleton ? Array.from({ length: 5 }, (_, i) => ({ itemId: `sk-${i}`, orderId: '', originalStatus: '', assignedCsId: null, assignedCsName: null, addedAt: '', orderStatus: '', customerName: '', totalAmount: null, orderCreatedAt: '' })) : items}
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
              {item.assignedCsName && (
                <div className="text-xs text-app-fg-muted">Assigned: {item.assignedCsName}</div>
              )}
            </Link>
          )}
        />
      )}

      {/* ── Single Assign Modal ────────────────────── */}
      <Modal
        open={!!singleAssignItem}
        onClose={() => setSingleAssignItem(null)}
        maxWidth="max-w-sm"
        contentClassName="p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-app-fg">Assign closer</h3>
        <FormSelect
          label="Select closer"
          value={singleAssignCloserId}
          onChange={(e) => setSingleAssignCloserId(e.target.value)}
          options={[
            { value: '', label: 'Select a closer…' },
            ...groupMembers.map((m) => ({ value: m.userId, label: m.userName })),
          ]}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setSingleAssignItem(null)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={singleFetcher.state === 'submitting' || !singleAssignCloserId}
            loading={singleFetcher.state === 'submitting'}
            loadingText="Assigning…"
            onClick={() => {
              singleFetcher.submit(
                { intent: 'assignBatchItem', batchItemId: singleAssignItem!, csCloserId: singleAssignCloserId },
                { method: 'post' },
              );
            }}
          >
            Assign
          </Button>
        </div>
      </Modal>

      {/* ── Bulk Assign Modal ────────────────────── */}
      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        maxWidth="max-w-sm"
        contentClassName="p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-app-fg">
          Assign {selectedItemIds.size} order{selectedItemIds.size !== 1 ? 's' : ''}
        </h3>
        <p className="text-sm text-app-fg-muted">
          Orders will be distributed round-robin across the selected closer{groupMembers.length !== 1 ? 's' : ''}.
        </p>
        <FormSelect
          label="Assign to"
          value={assignCloserId}
          onChange={(e) => setAssignCloserId(e.target.value)}
          options={[
            { value: '', label: 'All group members (round-robin)' },
            ...groupMembers.map((m) => ({ value: m.userId, label: m.userName })),
          ]}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setAssignModalOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={bulkFetcher.state === 'submitting'}
            loading={bulkFetcher.state === 'submitting'}
            loadingText="Assigning…"
            onClick={() => {
              const closerIds = assignCloserId
                ? [assignCloserId]
                : groupMembers.map((m) => m.userId);
              bulkFetcher.submit(
                {
                  intent: 'bulkAssignBatchItems',
                  itemIds: JSON.stringify([...selectedItemIds]),
                  csCloserIds: JSON.stringify(closerIds),
                },
                { method: 'post' },
              );
            }}
          >
            Assign
          </Button>
        </div>
      </Modal>
    </div>
  );
}
