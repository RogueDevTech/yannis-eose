import { useState, useMemo, useCallback } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { FilterPills } from '~/components/ui/filter-pills';
import { CompactTable, type CompactTableColumn, CompactTableActionButton } from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';

export interface FollowUpPageData {
  orders: Array<{
    id: string;
    status: string;
    customerName: string;
    customerPhoneDisplay?: string;
    totalAmount: string | null;
    createdAt: string;
    mediaBuyerName?: string | null;
    branchName?: string | null;
    branchId?: string | null;
    assignedCsName?: string | null;
  }>;
  total: number;
  totalPages: number;
  branches: Array<{ id: string; name: string; code?: string }>;
}

interface FollowUpPageProps extends FollowUpPageData {
  filters: { status: string; branchId: string; search: string; page: number };
  deferredLoading?: boolean;
}

const STATUS_OPTIONS = [
  { label: 'Deleted', value: 'DELETED' },
  { label: 'Delivered', value: 'DELIVERED' },
  { label: 'Remitted', value: 'REMITTED' },
  { label: 'All closed', value: 'ALL_CLOSED' },
];

export function FollowUpPage({
  orders,
  total,
  totalPages,
  branches,
  filters,
  deferredLoading = false,
}: FollowUpPageProps) {
  const { busy: isLoaderRefetchBusy, primeSamePathRefetch } = useLoaderRefetchBusy();
  const showSkeletonRows = deferredLoading || isLoaderRefetchBusy;
  const [searchParams, remixSetSearchParams] = useSearchParams();
  const setSearchParams = useCallback(
    (...args: Parameters<typeof remixSetSearchParams>) => {
      primeSamePathRefetch();
      remixSetSearchParams(...args);
    },
    [remixSetSearchParams, primeSamePathRefetch],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [targetBranchId, setTargetBranchId] = useState('');
  const [searchQuery, setSearchQuery] = useState(filters.search);

  const reassignFetcher = useFetcher<{ success?: boolean; error?: string; succeeded?: number; failed?: number }>();

  useFetcherToast(reassignFetcher.data, {
    successMessage: `${reassignFetcher.data?.succeeded ?? 0} order(s) reassigned for follow-up`,
    errorKey: 'error',
  });
  useCloseOnFetcherSuccess(reassignFetcher, () => {
    setReassignModalOpen(false);
    setTargetBranchId('');
    setSelectedIds(new Set());
  });

  const clearSelection = () => setSelectedIds(new Set());

  const handleStatusChange = (status: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('status', status);
      next.set('page', '1');
      return next;
    });
    clearSelection();
  };

  const handleBranchChange = (branchId: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (branchId) next.set('branchId', branchId);
      else next.delete('branchId');
      next.set('page', '1');
      return next;
    });
    clearSelection();
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (searchQuery.trim()) next.set('search', searchQuery.trim());
      else next.delete('search');
      next.set('page', '1');
      return next;
    });
  };

  const branchOptions = useMemo(
    () => [
      { value: '', label: 'All branches' },
      ...branches.map((b) => ({ value: b.id, label: b.name })),
    ],
    [branches],
  );

  const targetBranchOptions = useMemo(
    () => branches.map((b) => ({ value: b.id, label: b.name })),
    [branches],
  );

  const columns: CompactTableColumn<FollowUpPageData['orders'][number]>[] = useMemo(
    () => [
      {
        key: 'orderId',
        header: 'Order ID',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (order) => <OrderIdBadge id={order.id} orderNumber={order.orderNumber} linkTo={`/admin/orders/${order.id}`} />,
      },
      {
        key: 'customer',
        header: 'Customer',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[9rem]" />
          : (order) => (
              <span className="text-sm font-medium text-app-fg truncate max-w-[14rem] block">
                {order.customerName}
              </span>
            ),
      },
      {
        key: 'branch',
        header: 'Branch',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (order) => (
              <span className="text-xs text-app-fg-muted">{order.branchName ?? '—'}</span>
            ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[5rem]" />
          : (order) => (
              <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
            ),
      },
      {
        key: 'status',
        header: 'Status',
        align: 'center',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[5rem]" />
          : (order) => <OrderStatusBadge status={order.status} />,
      },
      {
        key: 'date',
        header: 'Date',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (order) => (
              <span className="text-xs text-app-fg-muted">
                {new Date(order.createdAt).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: showSkeletonRows
          ? () => null
          : (order) => (
              <CompactTableActionButton to={`/admin/orders/${order.id}`} tone="brand">
                View
              </CompactTableActionButton>
            ),
      },
    ],
    [showSkeletonRows],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow Up"
        mobileInlineActions
        description="Re-engage closed orders by reassigning them to a branch."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Follow-up tools"
            desktop={<PageRefreshButton />}
            sheet={null}
          />
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <FilterPills
          variant="tab"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={handleStatusChange}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchableSelect
          id="follow-up-branch-filter"
          value={filters.branchId}
          onChange={handleBranchChange}
          options={branchOptions}
          placeholder="All branches"
          searchPlaceholder="Search branches…"
          controlSize="sm"
          wrapperClassName="w-full sm:w-56"
        />
        <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by customer name…"
            className="flex-1"
          />
        </form>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="card bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <button onClick={clearSelection} className="text-xs text-brand-500 hover:text-brand-600 underline">
                Clear
              </button>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setReassignModalOpen(true)}
              disabled={reassignFetcher.state === 'submitting'}
            >
              Reassign for follow-up
            </Button>
          </div>
        </div>
      )}

      {/* Orders table */}
      {orders.length === 0 && !showSkeletonRows ? (
        <EmptyState
          title="No orders found"
          description="Try changing the status filter or branch."
        />
      ) : (
        <CompactTable
          columns={columns}
          data={showSkeletonRows ? Array.from({ length: 10 }, (_, i) => ({ id: `sk-${i}`, status: '', customerName: '', totalAmount: null, createdAt: '', branchName: null, branchId: null })) as FollowUpPageData['orders'] : orders}
          keyExtractor={(row) => row.id}
          loading={showSkeletonRows}
          loadingVariant="overlay"
          selection={{
            selectedIds,
            onToggle: (id, selected) => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (selected) next.add(id);
                else next.delete(id);
                return next;
              });
            },
            onToggleAll: (selectAll) => {
              if (selectAll) setSelectedIds(new Set(orders.map((o) => o.id)));
              else setSelectedIds(new Set());
            },
          }}
        />
      )}

      {totalPages > 1 && (
        <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            {total > 0
              ? `Showing ${orders.length} of ${total} orders`
              : 'No orders'}
          </p>
          <Pagination
            currentPage={filters.page}
            totalPages={totalPages}
            buildHref={(p) => {
              const params = new URLSearchParams(searchParams);
              params.set('page', String(p));
              return `?${params.toString()}`;
            }}
          />
        </div>
      )}

      {/* Reassign Modal */}
      <Modal
        open={reassignModalOpen}
        onClose={() => { setReassignModalOpen(false); setTargetBranchId(''); }}
        maxWidth="max-w-sm"
        title="Reassign for follow-up"
        contentClassName="p-6 space-y-4"
      >
        <p className="text-sm text-app-fg-muted">
          {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} will be reassigned to the selected branch for follow-up. Status resets to Unprocessed. Media buyer credit is cleared.
        </p>
        <SearchableSelect
          id="follow-up-target-branch"
          label="Destination branch"
          value={targetBranchId}
          onChange={(v) => setTargetBranchId(v)}
          options={targetBranchOptions}
          placeholder="Select branch"
          searchPlaceholder="Search branches…"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => { setReassignModalOpen(false); setTargetBranchId(''); }}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!targetBranchId || reassignFetcher.state === 'submitting'}
            loading={reassignFetcher.state === 'submitting'}
            loadingText="Reassigning…"
            onClick={() => {
              reassignFetcher.submit(
                {
                  intent: 'followUpReassign',
                  orderIds: JSON.stringify([...selectedIds]),
                  targetBranchId,
                },
                { method: 'post' },
              );
            }}
          >
            Reassign {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
