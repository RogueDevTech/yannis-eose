import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { CompactTable, type CompactTableColumn, CompactTableActionButton } from '~/components/ui/compact-table';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import { Pagination } from '~/components/ui/pagination';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { FormSelect } from '~/components/ui/form-select';
import { SmartPick } from '~/components/ui/smart-pick';
import { Checkbox } from '~/components/ui/checkbox';
import type { PendingCart } from '~/features/cs/types';
import type { CartPrefill } from '~/features/orders/CreateOfflineOrderModal';

const CreateOfflineOrderModal = lazy(() =>
  import('~/features/orders/CreateOfflineOrderModal').then((m) => ({ default: m.CreateOfflineOrderModal })),
);

const ABANDONED_CART_STATUS = 'ABANDONED_CART';

export interface FollowUpPageData {
  orders: Array<{
    id: string;
    orderNumber?: number | null;
    status: string;
    customerName: string;
    customerPhoneDisplay?: string;
    totalAmount: string | null;
    createdAt: string;
    mediaBuyerName?: string | null;
    branchName?: string | null;
    branchId?: string | null;
    assignedCsName?: string | null;
    assignedCsId?: string | null;
  }>;
  total: number;
  totalPages: number;
  closers: Array<{ agentId: string; agentName: string }>;
  statusCounts: Record<string, number>;
  products: Array<{ id: string; name: string }>;
  abandonedCarts: PendingCart[];
  abandonedCartsTotal: number;
  abandonedCartsTotalPages: number;
}

interface FollowUpFilters {
  statuses: string;
  search: string;
  assignedCsId: string;
  olderThanDays: string;
  page: number;
}

interface FollowUpPageProps extends FollowUpPageData {
  filters: FollowUpFilters;
  deferredLoading?: boolean;
}

const STATUS_CHOICES = [
  { value: 'DELETED', label: 'Deleted' },
  { value: 'CS_ASSIGNED', label: 'CS Assigned' },
  { value: 'CS_ENGAGED', label: 'CS Engaged' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'AGENT_ASSIGNED', label: 'Agent Assigned' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'IN_TRANSIT', label: 'In Transit' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'REMITTED', label: 'Remitted' },
  { value: ABANDONED_CART_STATUS, label: 'Abandoned Carts' },
] as const;

const AGE_OPTIONS = [
  { value: '', label: 'Any age' },
  { value: '3', label: 'Older than 3 days' },
  { value: '7', label: 'Older than 7 days' },
  { value: '14', label: 'Older than 14 days' },
  { value: '30', label: 'Older than 30 days' },
  { value: '60', label: 'Older than 60 days' },
  { value: '90', label: 'Older than 90 days' },
];

export function FollowUpPage({
  orders,
  total,
  totalPages,
  closers,
  statusCounts,
  products,
  abandonedCarts,
  abandonedCartsTotal,
  abandonedCartsTotalPages,
  filters,
  deferredLoading = false,
}: FollowUpPageProps) {
  const { busy: isLoaderRefetchBusy, primeSamePathRefetch } = useLoaderRefetchBusy();
  const showSkeletonRows = deferredLoading || isLoaderRefetchBusy;
  const [, remixSetSearchParams] = useSearchParams();
  const setSearchParams = useCallback(
    (...args: Parameters<typeof remixSetSearchParams>) => {
      primeSamePathRefetch();
      remixSetSearchParams(...args);
    },
    [remixSetSearchParams, primeSamePathRefetch],
  );

  const activeStatuses = useMemo(() => new Set(filters.statuses.split(',').filter(Boolean)), [filters.statuses]);
  const isCartView = activeStatuses.size === 1 && activeStatuses.has(ABANDONED_CART_STATUS);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(filters.search);
  const [convertCartPrefill, setConvertCartPrefill] = useState<CartPrefill | null>(null);

  useEffect(() => { setSelectedIds(new Set()); }, [filters.statuses, filters.assignedCsId, filters.olderThanDays]);

  const reopenFetcher = useFetcher<{ success?: boolean; error?: string; succeeded?: number; failed?: number }>();
  useFetcherToast(reopenFetcher.data, {
    successMessage: `${reopenFetcher.data?.succeeded ?? 0} order(s) reopened for follow-up`,
  });
  useCloseOnFetcherSuccess(reopenFetcher, () => {
    setReopenModalOpen(false);
    setSelectedIds(new Set());
  });

  const toggleStatus = (status: string) => {
    // Abandoned carts is exclusive — clicking it selects only it, clicking another clears it
    if (status === ABANDONED_CART_STATUS) {
      setSearchParams((p) => {
        const params = new URLSearchParams(p);
        if (isCartView) {
          params.delete('statuses');
        } else {
          params.set('statuses', ABANDONED_CART_STATUS);
        }
        params.set('page', '1');
        params.delete('assignedCsId');
        return params;
      });
      return;
    }
    // If currently on cart view, switch to the clicked order status
    if (isCartView) {
      setSearchParams((p) => {
        const params = new URLSearchParams(p);
        params.set('statuses', status);
        params.set('page', '1');
        return params;
      });
      return;
    }
    const next = new Set(activeStatuses);
    next.delete(ABANDONED_CART_STATUS);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    setSearchParams((p) => {
      const params = new URLSearchParams(p);
      if (next.size === 0) params.delete('statuses');
      else params.set('statuses', [...next].join(','));
      params.set('page', '1');
      return params;
    });
  };

  const handleCloserChange = (closerId: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (closerId) next.set('assignedCsId', closerId);
      else next.delete('assignedCsId');
      next.set('page', '1');
      return next;
    });
  };

  const handleAgeChange = (days: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (days) next.set('olderThanDays', days);
      else next.delete('olderThanDays');
      next.set('page', '1');
      return next;
    });
  };

  const handleSearchSubmit = () => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (searchQuery.trim()) next.set('search', searchQuery.trim());
      else next.delete('search');
      next.set('page', '1');
      return next;
    });
  };

  const closerOptions = useMemo(
    () => [
      { value: '', label: 'All closers' },
      ...closers.map((c) => ({ value: c.agentId, label: c.agentName })),
    ],
    [closers],
  );

  // ── Order columns ──
  const orderColumns: CompactTableColumn<FollowUpPageData['orders'][number]>[] = useMemo(
    () => [
      {
        key: 'orderId',
        header: 'Order',
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
              <span className="text-sm font-medium text-app-fg">
                {order.customerName}
                {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                  <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
                )}
              </span>
            ),
      },
      {
        key: 'status',
        header: 'Status',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[5rem]" />
          : (order) => <OrderStatusBadge status={order.status} expanded />,
      },
      {
        key: 'closer',
        header: 'Closer',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (order) => (
              <span className="text-xs text-app-fg-muted truncate max-w-[10rem] block">
                {order.assignedCsName ?? '—'}
              </span>
            ),
      },
      {
        key: 'branch',
        header: 'Branch',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[6rem]" />
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
        key: 'date',
        header: 'Created',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[6rem]" />
          : (order) => (
              <span className="text-xs text-app-fg-muted">
                {new Date(order.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: showSkeletonRows
          ? () => null
          : (order) => (
              <TableRowActionsSheet
                ariaLabel={`Actions for ${order.customerName}`}
                sheetTitle={order.customerName}
                actions={[
                  { key: 'view', kind: 'link', label: 'View order', to: `/admin/orders/${order.id}` },
                ]}
              />
            ),
      },
    ],
    [showSkeletonRows],
  );

  // ── Abandoned cart columns ──
  const cartColumns: CompactTableColumn<PendingCart>[] = useMemo(
    () => [
      {
        key: 'customer',
        header: 'Customer',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[9rem]" />
          : (cart) => (
              <span className="text-sm font-medium text-app-fg">
                {cart.customerName || '(No name)'}
              </span>
            ),
      },
      {
        key: 'phone',
        header: 'Phone',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (cart) => (
              <span className="text-xs text-app-fg-muted">{cart.customerPhoneDisplay || '—'}</span>
            ),
      },
      {
        key: 'product',
        header: 'Product',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[8rem]" />
          : (cart) => (
              <span className="text-xs text-app-fg-muted truncate max-w-[12rem] block">
                {cart.productName ?? '—'}
                {cart.offerLabel ? ` (${cart.offerLabel})` : ''}
              </span>
            ),
      },
      {
        key: 'campaign',
        header: 'Campaign',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (cart) => (
              <span className="text-xs text-app-fg-muted truncate max-w-[10rem] block">
                {cart.campaignName ?? '—'}
              </span>
            ),
      },
      {
        key: 'date',
        header: 'Dropped',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[6rem]" />
          : (cart) => (
              <span className="text-xs text-app-fg-muted">
                {new Date(cart.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: showSkeletonRows
          ? () => null
          : (cart) => (
              <CompactTableActionButton
                tone="brand"
                onClick={() => setConvertCartPrefill({
                  cartId: cart.id,
                  customerName: cart.customerName,
                  customerPhone: cart.customerPhone ?? undefined,
                  customerAddress: cart.customerAddress ?? undefined,
                  deliveryAddress: cart.deliveryAddress ?? undefined,
                  deliveryState: cart.deliveryState ?? undefined,
                  deliveryNotes: cart.deliveryNotes ?? undefined,
                  customerGender: cart.customerGender ?? undefined,
                  preferredDeliveryDate: cart.preferredDeliveryDate ?? undefined,
                  customerEmail: cart.customerEmail ?? undefined,
                  paymentMethod: cart.paymentMethod ?? undefined,
                  productId: cart.productId ?? undefined,
                  offerLabel: cart.offerLabel ?? undefined,
                  quantity: cart.quantity ?? undefined,
                })}
              >
                Convert
              </CompactTableActionButton>
            ),
      },
    ],
    [showSkeletonRows],
  );

  const activeFilterCount =
    (filters.assignedCsId ? 1 : 0) +
    (filters.olderThanDays ? 1 : 0) +
    (filters.search ? 1 : 0);

  // Current view data
  const viewTotal = isCartView ? abandonedCartsTotal : total;
  const viewTotalPages = isCartView ? abandonedCartsTotalPages : totalPages;
  const viewItems = isCartView ? abandonedCarts : orders;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow Up"
        mobileInlineActions
        description="Pull orders from any status back into the pipeline."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Follow-up tools"
            sheetSubtitle={<span>Filters and actions</span>}
            triggerAriaLabel="Follow-up tools"
            filtersBadgeCount={activeFilterCount}
            desktop={<PageRefreshButton />}
            filters={
              <>
                {!isCartView && (
                  <SearchableSelect
                    id="follow-up-mobile-closer"
                    value={filters.assignedCsId}
                    onChange={handleCloserChange}
                    options={closerOptions}
                    placeholder="All closers"
                    searchPlaceholder="Search closers…"
                  />
                )}
                <FormSelect
                  id="follow-up-mobile-age"
                  value={filters.olderThanDays}
                  onChange={(e) => handleAgeChange(e.target.value)}
                  options={AGE_OPTIONS}
                />
              </>
            }
          />
        }
      />

      {/* ── Status chips with counts ─────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-app-fg-muted">Filter by status</p>
        <div className="flex flex-wrap gap-2">
          {STATUS_CHOICES.map((s) => {
            const active = activeStatuses.has(s.value);
            const count = statusCounts[s.value] ?? 0;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleStatus(s.value)}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border',
                  active
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-app-canvas text-app-fg-muted border-app-border hover:border-app-fg-muted/50',
                ].join(' ')}
              >
                {active ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="w-3 h-3 rounded-sm border border-current opacity-50" />
                )}
                {s.label}
                <span className={`tabular-nums ${active ? 'text-white/70' : 'text-app-fg-muted/60'}`}>
                  {count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filters row ──────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {!isCartView && (
          <SearchableSelect
            id="follow-up-closer"
            value={filters.assignedCsId}
            onChange={handleCloserChange}
            options={closerOptions}
            placeholder="All closers"
            searchPlaceholder="Search closers…"
            controlSize="sm"
            wrapperClassName="w-full sm:w-48"
          />
        )}
        <FormSelect
          id="follow-up-age"
          value={filters.olderThanDays}
          onChange={(e) => handleAgeChange(e.target.value)}
          options={AGE_OPTIONS}
        />
        <div className="flex-1">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={isCartView ? 'Search customer name…' : 'Search customer…'}
            controlSize="sm"
            withSubmitButton
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearchSubmit(); } }}
          />
        </div>
      </div>

      {/* ── Summary strip ────────────────────────────────── */}
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: isCartView ? 'Abandoned carts' : 'Matched', value: viewTotal.toLocaleString() },
          { label: 'Selected', value: selectedIds.size.toLocaleString(), valueClassName: selectedIds.size > 0 ? 'text-brand-500' : undefined },
        ]}
      />

      {/* ── Smart Pick ─────────────────────────────────── */}
      {viewItems.length > 0 && !isCartView && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <SmartPick
              total={Math.min(viewTotal, orders.length)}
              selectedCount={selectedIds.size}
              onPick={(count) => {
                setSelectedIds(new Set(orders.slice(0, count).map((o) => o.id)));
              }}
              onClear={() => setSelectedIds(new Set())}
              itemNoun="orders"
            />
            {viewTotal > 0 && (
              <label className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={selectedIds.size === orders.length && orders.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(orders.map((o) => o.id)));
                    else setSelectedIds(new Set());
                  }}
                />
                <span className="font-medium text-app-fg">
                  {selectedIds.size === orders.length && orders.length > 0
                    ? `${selectedIds.size.toLocaleString()} selected`
                    : `Select all ${viewTotal.toLocaleString()} matching`}
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk action bar ──────────────────────────────── */}
      {selectedIds.size > 0 && !isCartView && (
        <div className="card bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-brand-500 hover:text-brand-600 underline">
                Clear
              </button>
            </div>
            <Button variant="primary" size="sm" onClick={() => setReopenModalOpen(true)}>
              Reopen for follow-up
            </Button>
          </div>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────── */}
      {viewItems.length === 0 && !showSkeletonRows ? (
        <EmptyState
          title={isCartView ? 'No abandoned carts' : 'No orders match'}
          description={isCartView ? 'No abandoned carts found for the current filters.' : 'Adjust the status chips or filters to find orders for follow-up.'}
        />
      ) : isCartView ? (
        <CompactTable<PendingCart>
          columns={cartColumns}
          rows={showSkeletonRows ? Array.from({ length: 10 }, (_, i) => ({ id: `sk-${i}`, customerName: '', customerPhoneDisplay: '', productName: null, campaignName: null, offerLabel: null, updatedAt: '' })) as PendingCart[] : abandonedCarts}
          rowKey={(row) => row.id}
          renderMobileCard={(cart) => (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate">{cart.customerName || '(No name)'}</span>
                <span className="shrink-0 rounded-full bg-warning-50 dark:bg-warning-900/30 border border-warning-200 dark:border-warning-700 px-2 py-0.5 text-micro font-medium text-warning-700 dark:text-warning-400">Abandoned</span>
              </div>
              <p className="text-xs text-app-fg-muted truncate">{cart.productName ?? '—'}{cart.offerLabel ? ` (${cart.offerLabel})` : ''}</p>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>{cart.campaignName ?? '—'}</span>
                <span>{new Date(cart.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</span>
              </div>
              <CompactTableActionButton
                tone="brand"
                onClick={() => setConvertCartPrefill({
                  cartId: cart.id,
                  customerName: cart.customerName,
                  customerPhone: cart.customerPhone ?? undefined,
                  productId: cart.productId ?? undefined,
                  offerLabel: cart.offerLabel ?? undefined,
                  quantity: cart.quantity ?? undefined,
                })}
              >
                Convert to order
              </CompactTableActionButton>
            </div>
          )}
        />
      ) : (
        <CompactTable
          columns={orderColumns}
          rows={showSkeletonRows ? Array.from({ length: 10 }, (_, i) => ({ id: `sk-${i}`, status: '', customerName: '', totalAmount: null, createdAt: '', branchName: null, branchId: null })) as FollowUpPageData['orders'] : orders}
          rowKey={(row) => row.id}
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
          renderMobileCard={(order) => (
            <Link
              to={`/admin/orders/${order.id}`}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate">
                  {order.customerName}
                  {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                    <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
                  )}
                </span>
                <OrderStatusBadge status={order.status} expanded />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>{order.branchName ?? '—'}</span>
                <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>{order.assignedCsName ?? 'Unassigned'}</span>
                <span>{new Date(order.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</span>
              </div>
            </Link>
          )}
        />
      )}

      {viewTotalPages > 1 && (
        <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            Showing {viewItems.length} of {viewTotal} {isCartView ? 'carts' : 'orders'}
          </p>
          <Pagination page={filters.page} totalPages={viewTotalPages} pageParam="page" />
        </div>
      )}

      {/* ── Reopen Modal ─────────────────────────────────── */}
      <Modal
        open={reopenModalOpen}
        onClose={() => setReopenModalOpen(false)}
        maxWidth="max-w-sm"
        contentClassName="p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-app-fg">Reopen for follow-up</h3>
        <p className="text-sm text-app-fg-muted">
          {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} will be reset to <strong>Unprocessed</strong> and re-enter the CS queue. All order data and history are preserved.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setReopenModalOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={reopenFetcher.state === 'submitting'}
            loading={reopenFetcher.state === 'submitting'}
            loadingText="Reopening…"
            onClick={() => {
              reopenFetcher.submit(
                {
                  intent: 'reopenForFollowUp',
                  orderIds: JSON.stringify([...selectedIds]),
                },
                { method: 'post' },
              );
            }}
          >
            Reopen {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </Modal>

      {/* ── Convert Cart → Order Modal ───────────────────── */}
      {convertCartPrefill && (
        <Suspense fallback={null}>
          <CreateOfflineOrderModal
            open
            onClose={() => setConvertCartPrefill(null)}
            products={products}
            cartPrefill={convertCartPrefill}
          />
        </Suspense>
      )}
    </div>
  );
}
