import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { Link, useFetcher, useNavigate, useSearchParams } from '@remix-run/react';
import { clipName } from '~/lib/clip-name';
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
import { DateInput } from '~/components/ui/date-input';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { FormSelect } from '~/components/ui/form-select';
import { SmartPick } from '~/components/ui/smart-pick';
import { TextInput } from '~/components/ui/text-input';
import { useBranchesCatalog } from '~/contexts/branches-catalog-context';
import { Checkbox } from '~/components/ui/checkbox';
import { fetchOrdersMatchingIds, ORDERS_DEEP_SELECT_MAX } from '~/lib/trpc-browser';
import type { PendingCart } from '~/features/cs/types';
import type { CartPrefill } from '~/features/orders/CreateOfflineOrderModal';
import { STATUS_LABELS } from '~/features/shared/order-status';

const CreateOfflineOrderModal = lazy(() =>
  import('~/features/orders/CreateOfflineOrderModal').then((m) => ({ default: m.CreateOfflineOrderModal })),
);

const ABANDONED_CART_STATUS = 'ABANDONED_CART';

export interface FollowUpGroupOption {
  id: string;
  name: string;
  memberCount: number;
  members: Array<{ userId: string; userName: string }>;
}

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
    isFollowUp?: boolean;
  }>;
  total: number;
  totalPages: number;
  closers: Array<{ agentId: string; agentName: string }>;
  statusCounts: Record<string, number>;
  products: Array<{ id: string; name: string }>;
  abandonedCarts: PendingCart[];
  abandonedCartsTotal: number;
  abandonedCartsTotalPages: number;
  groups?: FollowUpGroupOption[];
}

interface FollowUpFilters {
  statuses: string;
  search: string;
  assignedCsId: string;
  olderThanDays: string;
  startDate: string;
  endDate: string;
  page: number;
}

interface FollowUpPageProps extends FollowUpPageData {
  filters: FollowUpFilters;
  deferredLoading?: boolean;
  bulkSelectAllMatchingInput?: string;
}

const STATUS_CHOICES = [
  { value: 'DELETED', label: STATUS_LABELS.DELETED },
  { value: 'CS_ASSIGNED', label: STATUS_LABELS.CS_ASSIGNED },
  { value: 'CS_ENGAGED', label: STATUS_LABELS.CS_ENGAGED },
  { value: 'CONFIRMED', label: STATUS_LABELS.CONFIRMED },
  { value: 'AGENT_ASSIGNED', label: STATUS_LABELS.AGENT_ASSIGNED },
  { value: 'DELIVERED', label: STATUS_LABELS.DELIVERED },
  { value: 'REMITTED', label: STATUS_LABELS.REMITTED },
  { value: ABANDONED_CART_STATUS, label: 'Abandoned Carts' },
] as const;

const CUSTOM_RANGE_VALUE = '__custom__';

const AGE_OPTIONS = [
  { value: '', label: 'Any age' },
  { value: '3', label: 'Older than 3 days' },
  { value: '7', label: 'Older than 7 days' },
  { value: '14', label: 'Older than 14 days' },
  { value: '30', label: 'Older than 30 days' },
  { value: '60', label: 'Older than 60 days' },
  { value: '90', label: 'Older than 90 days' },
  { value: CUSTOM_RANGE_VALUE, label: 'Custom range…' },
];

export function FollowUpPage({
  orders = [],
  total = 0,
  totalPages = 1,
  closers = [],
  statusCounts = {},
  products = [],
  abandonedCarts = [],
  abandonedCartsTotal = 0,
  abandonedCartsTotalPages = 1,
  groups = [],
  filters,
  deferredLoading = false,
  bulkSelectAllMatchingInput,
}: FollowUpPageProps) {
  const navigate = useNavigate();
  const branchesCatalog = useBranchesCatalog();
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
  const noStatusSelected = activeStatuses.size === 0;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatchingActive, setSelectAllMatchingActive] = useState(false);
  const [selectAllMatchingLoading, setSelectAllMatchingLoading] = useState(false);
  const [selectAllMatchingCapped, setSelectAllMatchingCapped] = useState(false);
  const [selectAllMatchingError, setSelectAllMatchingError] = useState<string | null>(null);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(filters.search);
  const [convertCartPrefill, setConvertCartPrefill] = useState<CartPrefill | null>(null);
  const [peekOrder, setPeekOrder] = useState<FollowUpPageData['orders'][number] | null>(null);
  const [customDateModalOpen, setCustomDateModalOpen] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState(filters.startDate);
  const [draftEndDate, setDraftEndDate] = useState(filters.endDate);
  const hasCustomDateRange = Boolean(filters.startDate || filters.endDate);
  const [targetBranchId, setTargetBranchId] = useState('');
  const [batchName, setBatchName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [assignmentMode, setAssignmentMode] = useState<'MANUAL' | 'EQUAL'>('MANUAL');

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectAllMatchingActive(false);
    setSelectAllMatchingCapped(false);
    setSelectAllMatchingError(null);
  }, [filters.statuses, filters.assignedCsId, filters.olderThanDays, filters.search, filters.startDate, filters.endDate, filters.page]);

  const reopenFetcher = useFetcher<{ success?: boolean; error?: string; succeeded?: number; failed?: number }>();
  useFetcherToast(reopenFetcher.data, {
    successMessage: isCartView
      ? `${reopenFetcher.data?.succeeded ?? 0} cart(s) converted to orders`
      : `${reopenFetcher.data?.succeeded ?? 0} order(s) reopened for follow-up`,
  });
  useCloseOnFetcherSuccess(reopenFetcher, () => {
    setReopenModalOpen(false);
    clearSelection();
    navigate('/admin/cs/follow-up');
  });

  /** Set the status filter to exactly these statuses (used by the overview strip). */
  const selectStatuses = (statuses: string[]) => {
    setSearchParams((p) => {
      const params = new URLSearchParams(p);
      if (statuses.length === 0) params.delete('statuses');
      else params.set('statuses', statuses.join(','));
      params.set('page', '1');
      if (statuses.length === 1 && statuses[0] === ABANDONED_CART_STATUS) params.delete('assignedCsId');
      return params;
    });
  };

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
    if (days === CUSTOM_RANGE_VALUE) {
      setDraftStartDate(filters.startDate);
      setDraftEndDate(filters.endDate);
      setCustomDateModalOpen(true);
      return;
    }
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (days) next.set('olderThanDays', days);
      else next.delete('olderThanDays');
      // Clear custom dates when switching to a preset
      next.delete('startDate');
      next.delete('endDate');
      next.set('page', '1');
      return next;
    });
  };

  const applyCustomDateRange = () => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      // Custom range replaces olderThanDays
      next.delete('olderThanDays');
      if (draftStartDate) next.set('startDate', draftStartDate);
      else next.delete('startDate');
      if (draftEndDate) next.set('endDate', draftEndDate);
      else next.delete('endDate');
      next.set('page', '1');
      return next;
    });
    setCustomDateModalOpen(false);
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

  // Current view data — hoisted before smartPickCeiling so it's available.
  const viewTotal = isCartView ? abandonedCartsTotal : total;
  const viewTotalPages = isCartView ? abandonedCartsTotalPages : totalPages;
  const viewItems = isCartView ? abandonedCarts : orders;

  const smartPickCeiling = Math.min(viewTotal, isCartView ? abandonedCarts.length : ORDERS_DEEP_SELECT_MAX);

  async function selectAllMatchingFilter() {
    if (!bulkSelectAllMatchingInput || isCartView) return;
    setSelectAllMatchingLoading(true);
    setSelectAllMatchingError(null);
    try {
      const { ids, capped } = await fetchOrdersMatchingIds(bulkSelectAllMatchingInput);
      if (ids.length === 0) {
        setSelectAllMatchingError('Could not load matching orders. Try again.');
        return;
      }
      setSelectedIds(new Set(ids));
      setSelectAllMatchingActive(true);
      setSelectAllMatchingCapped(capped);
    } catch {
      setSelectAllMatchingError('Failed to load matching orders.');
    } finally {
      setSelectAllMatchingLoading(false);
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectAllMatchingActive(false);
    setSelectAllMatchingCapped(false);
    setSelectAllMatchingError(null);
  }

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
              <span className="text-sm font-medium text-app-fg" title={order.customerName}>
                {clipName(order.customerName)}
                {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                  <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
                )}
                {order.isFollowUp && (
                  <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-info-300 bg-info-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-info-600 dark:border-info-700 dark:bg-info-900/30 dark:text-info-400">Follow Up</span>
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
              <span className="text-sm font-medium text-app-fg" title={cart.customerName || undefined}>
                {clipName(cart.customerName) === '—' ? '(No name)' : clipName(cart.customerName)}
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
    (filters.olderThanDays || hasCustomDateRange ? 1 : 0) +
    (filters.search ? 1 : 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Create Follow-Up"
        backTo="/admin/cs/follow-up"
        mobileInlineActions
        description="Select orders or carts to reopen for follow-up."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Follow-up tools"
            filtersBadgeCount={activeFilterCount}
            desktop={
              <>
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  chrome="pill"
                />
                <PageRefreshButton />
              </>
            }
            filters={
              <>
                {!isCartView && (
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    <SearchableSelect
                      id="follow-up-mobile-closer"
                      value={filters.assignedCsId}
                      onChange={handleCloserChange}
                      options={closerOptions}
                      placeholder="All closers"
                      searchPlaceholder="Search closers…"
                      triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                      wrapperClassName="w-full"
                    />
                  </div>
                )}
                <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                  <FormSelect
                    id="follow-up-mobile-age"
                    value={hasCustomDateRange ? CUSTOM_RANGE_VALUE : filters.olderThanDays}
                    onChange={(e) => handleAgeChange(e.target.value)}
                    options={AGE_OPTIONS}
                    className="!bg-transparent !border-transparent !text-center" inlineChevron
                    controlSize="sm"
                    openAs="modal"
                    wrapperClassName="w-full"
                  />
                </div>
              </>
            }
          />
        }
      />

      {/* ── Summary strip ────────────────────────────────── */}
      {(() => {
        const allOrderStatuses = STATUS_CHOICES.filter((s) => s.value !== ABANDONED_CART_STATUS).map((s) => s.value);
        const isAllOrders = !isCartView && allOrderStatuses.every((s) => activeStatuses.has(s));
        return (
          <OverviewStatStrip
            mobileGrid
            items={[
              { label: 'All Orders', value: total.toLocaleString(), valueClassName: 'text-app-fg tabular-nums', active: isAllOrders, onClick: () => selectStatuses(isAllOrders ? [] : [...allOrderStatuses]) },
              { label: `Deleted (${(statusCounts['DELETED'] ?? 0).toLocaleString()})`, value: (statusCounts['DELETED'] ?? 0).toLocaleString(), valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums', active: !isAllOrders && activeStatuses.has('DELETED'), onClick: () => selectStatuses(['DELETED']) },
              { label: `Assigned (${(statusCounts['CS_ASSIGNED'] ?? 0).toLocaleString()})`, value: (statusCounts['CS_ASSIGNED'] ?? 0).toLocaleString(), valueClassName: 'text-brand-600 dark:text-brand-400 tabular-nums', active: !isAllOrders && activeStatuses.has('CS_ASSIGNED') && !activeStatuses.has('CS_ENGAGED'), onClick: () => selectStatuses(['CS_ASSIGNED']) },
              { label: `Engaged (${(statusCounts['CS_ENGAGED'] ?? 0).toLocaleString()})`, value: (statusCounts['CS_ENGAGED'] ?? 0).toLocaleString(), valueClassName: 'text-amber-600 dark:text-amber-400 tabular-nums', active: !isAllOrders && activeStatuses.has('CS_ENGAGED') && !activeStatuses.has('CS_ASSIGNED'), onClick: () => selectStatuses(['CS_ENGAGED']) },
              { label: `Unconfirmed (${((statusCounts['CS_ASSIGNED'] ?? 0) + (statusCounts['CS_ENGAGED'] ?? 0)).toLocaleString()})`, value: ((statusCounts['CS_ASSIGNED'] ?? 0) + (statusCounts['CS_ENGAGED'] ?? 0)).toLocaleString(), valueClassName: 'text-amber-600 dark:text-amber-400 tabular-nums', active: !isAllOrders && activeStatuses.has('CS_ASSIGNED') && activeStatuses.has('CS_ENGAGED') && activeStatuses.size === 2, onClick: () => selectStatuses(['CS_ASSIGNED', 'CS_ENGAGED']) },
              { label: `Confirmed (${(statusCounts['CONFIRMED'] ?? 0).toLocaleString()})`, value: (statusCounts['CONFIRMED'] ?? 0).toLocaleString(), valueClassName: 'text-success-600 dark:text-success-400 tabular-nums', active: !isAllOrders && activeStatuses.has('CONFIRMED'), onClick: () => selectStatuses(['CONFIRMED']) },
              { label: `Delivered (${(statusCounts['DELIVERED'] ?? 0).toLocaleString()})`, value: (statusCounts['DELIVERED'] ?? 0).toLocaleString(), valueClassName: 'text-info-600 dark:text-info-400 tabular-nums', active: !isAllOrders && activeStatuses.has('DELIVERED'), onClick: () => selectStatuses(['DELIVERED']) },
              { label: `Carts (${(statusCounts['ABANDONED_CART'] ?? 0).toLocaleString()})`, value: (statusCounts['ABANDONED_CART'] ?? 0).toLocaleString(), valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums', active: isCartView, onClick: () => selectStatuses(['ABANDONED_CART']) },
              { label: 'Selected', value: selectedIds.size.toLocaleString(), valueClassName: selectedIds.size > 0 ? 'text-brand-500 tabular-nums' : 'tabular-nums' },
            ]}
          />
        );
      })()}

      {/* ── Status chips with counts ─────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-app-fg-muted">Filter by status</p>
        <div className="flex flex-wrap gap-2">
          {/* Select All orders chip */}
          {(() => {
            const allOrderStatuses = STATUS_CHOICES.filter((s) => s.value !== ABANDONED_CART_STATUS).map((s) => s.value);
            const allOrderSelected = !isCartView && allOrderStatuses.every((s) => activeStatuses.has(s));
            return (
              <button
                type="button"
                onClick={() => {
                  if (allOrderSelected) selectStatuses([]);
                  else selectStatuses([...allOrderStatuses]);
                }}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border',
                  allOrderSelected
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-app-canvas text-app-fg-muted border-app-border hover:border-app-fg-muted/50',
                ].join(' ')}
              >
                {allOrderSelected ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="w-3 h-3 rounded-sm border border-current opacity-50" />
                )}
                All Orders
              </button>
            );
          })()}
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
        {/* Closer + age hidden on mobile — inside Actions sheet */}
        {!isCartView && (
          <div className="hidden sm:block">
            <SearchableSelect
              id="follow-up-closer"
              value={filters.assignedCsId}
              onChange={handleCloserChange}
              options={closerOptions}
              placeholder="All closers"
              searchPlaceholder="Search closers…"
              controlSize="sm"
              wrapperClassName="w-48"
            />
          </div>
        )}
        <div className="hidden sm:block">
          <FormSelect
            id="follow-up-age"
            value={hasCustomDateRange ? CUSTOM_RANGE_VALUE : filters.olderThanDays}
            onChange={(e) => handleAgeChange(e.target.value)}
            options={AGE_OPTIONS}
          />
        </div>
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


      {/* ── Smart Pick ─────────────────────────────────── */}
      {viewItems.length > 0 && !noStatusSelected && (
        <div className={`rounded-lg border px-3 py-2 ${
          selectAllMatchingActive
            ? 'border-warning-400 bg-warning-50 dark:border-warning-700 dark:bg-warning-900/20'
            : 'border-app-border bg-app-elevated'
        }`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <SmartPick
              total={smartPickCeiling}
              presets={[10, 20, 50, 100, 500, 1000]}
              selectedCount={selectedIds.size}
              onPick={async (count) => {
                const items = isCartView ? abandonedCarts : orders;
                // Fast path: requested count fits on the current page
                if (count <= items.length) {
                  if (selectAllMatchingActive) {
                    setSelectAllMatchingActive(false);
                    setSelectAllMatchingCapped(false);
                  }
                  setSelectedIds(new Set(items.slice(0, count).map((o) => o.id)));
                  return;
                }
                // Cross-page path: fetch matching IDs from the server
                if (!bulkSelectAllMatchingInput || isCartView) {
                  setSelectedIds(new Set(items.map((o) => o.id)));
                  return;
                }
                setSelectAllMatchingLoading(true);
                setSelectAllMatchingError(null);
                try {
                  const { ids, capped } = await fetchOrdersMatchingIds(bulkSelectAllMatchingInput);
                  if (ids.length === 0) {
                    setSelectAllMatchingError('Could not load matching orders. Try again.');
                    return;
                  }
                  const picked = ids.slice(0, count);
                  setSelectedIds(new Set(picked));
                  setSelectAllMatchingActive(picked.length > items.length);
                  setSelectAllMatchingCapped(capped);
                } catch {
                  setSelectAllMatchingError('Failed to load matching orders.');
                } finally {
                  setSelectAllMatchingLoading(false);
                }
              }}
              onClear={clearSelection}
              itemNoun={isCartView ? 'carts' : 'orders'}
            />
            {!isCartView && bulkSelectAllMatchingInput && viewTotal > 0 && (
              <label className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={selectAllMatchingActive}
                  disabled={selectAllMatchingLoading}
                  onChange={(e) => {
                    if (e.target.checked) selectAllMatchingFilter();
                    else clearSelection();
                  }}
                />
                <span className="font-medium text-app-fg">
                  {selectAllMatchingActive
                    ? `${selectedIds.size.toLocaleString()} selected across filter`
                    : `Select all ${viewTotal.toLocaleString()} matching`}
                </span>
                <span
                  className="inline-flex shrink-0 text-app-fg-muted"
                  title={selectAllMatchingActive
                    ? `Bulk actions will affect all ${selectedIds.size.toLocaleString()} selected orders.${
                        selectedIds.size > orders.length ? ` ${(selectedIds.size - orders.length).toLocaleString()} are not visible on this page.` : ''
                      }${selectAllMatchingCapped ? ` Capped at ${ORDERS_DEEP_SELECT_MAX} of ${viewTotal.toLocaleString()} matching.` : ''}`
                    : `Selects every order matching the current filter.${
                        viewTotal > ORDERS_DEEP_SELECT_MAX ? ` Capped at ${ORDERS_DEEP_SELECT_MAX} — narrow the filter to process more.` : ''
                      }`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
                  </svg>
                </span>
                {selectAllMatchingLoading && (
                  <span className="text-xs text-app-fg-muted">Loading…</span>
                )}
              </label>
            )}
            {isCartView && viewTotal > 0 && (
              <label className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={selectedIds.size === abandonedCarts.length && abandonedCarts.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(abandonedCarts.map((c) => c.id)));
                    else setSelectedIds(new Set());
                  }}
                />
                <span className="font-medium text-app-fg">
                  {selectedIds.size === abandonedCarts.length && abandonedCarts.length > 0
                    ? `${selectedIds.size.toLocaleString()} selected`
                    : `Select all ${abandonedCarts.length.toLocaleString()} on page`}
                </span>
              </label>
            )}
            {selectAllMatchingError && (
              <p className="w-full text-xs text-danger-600 dark:text-danger-400">
                {selectAllMatchingError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk action bar ──────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="card bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                {selectedIds.size} {isCartView ? 'cart' : 'order'}{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <button onClick={clearSelection} className="text-xs text-brand-500 hover:text-brand-600 underline">
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => {
                const today = new Date().toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
                setBatchName(`Follow Up — ${today}`);
                setReopenModalOpen(true);
              }}>
                Reopen for follow-up
              </Button>
              {isCartView && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const first = abandonedCarts.find((c) => selectedIds.has(c.id));
                    if (first) {
                      setConvertCartPrefill({
                        cartId: first.id,
                        customerName: first.customerName,
                        customerPhone: first.customerPhone ?? undefined,
                        customerAddress: first.customerAddress ?? undefined,
                        deliveryAddress: first.deliveryAddress ?? undefined,
                        deliveryState: first.deliveryState ?? undefined,
                        deliveryNotes: first.deliveryNotes ?? undefined,
                        customerGender: first.customerGender ?? undefined,
                        preferredDeliveryDate: first.preferredDeliveryDate ?? undefined,
                        customerEmail: first.customerEmail ?? undefined,
                        paymentMethod: first.paymentMethod ?? undefined,
                        productId: first.productId ?? undefined,
                        offerLabel: first.offerLabel ?? undefined,
                        quantity: first.quantity ?? undefined,
                      });
                    }
                  }}
                >
                  Convert to order
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────── */}
      {noStatusSelected && !showSkeletonRows ? (
        <EmptyState
          title="Select a status"
          description="Pick one or more statuses above to see orders for follow-up."
        />
      ) : viewItems.length === 0 && !showSkeletonRows ? (
        <EmptyState
          title={isCartView ? 'No abandoned carts' : 'No orders match'}
          description={isCartView ? 'No abandoned carts found for the current filters.' : 'Adjust the status chips or filters to find orders for follow-up.'}
        />
      ) : isCartView ? (
        <CompactTable<PendingCart>
          columns={cartColumns}
          rows={showSkeletonRows ? Array.from({ length: 10 }, (_, i) => ({ id: `sk-${i}`, customerName: '', customerPhoneDisplay: '', productName: null, campaignName: null, offerLabel: null, updatedAt: '' })) as PendingCart[] : abandonedCarts}
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
              if (selectAll) setSelectedIds(new Set(abandonedCarts.map((c) => c.id)));
              else setSelectedIds(new Set());
            },
          }}
          renderMobileCard={(cart) => (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate" title={cart.customerName || undefined}>{cart.customerName ? clipName(cart.customerName) : '(No name)'}</span>
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
              if (selectAllMatchingActive) {
                setSelectAllMatchingActive(false);
                setSelectAllMatchingCapped(false);
              }
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (selected) next.add(id);
                else next.delete(id);
                return next;
              });
            },
            onToggleAll: (selectAll) => {
              if (selectAllMatchingActive) {
                setSelectAllMatchingActive(false);
                setSelectAllMatchingCapped(false);
              }
              if (selectAll) setSelectedIds(new Set(orders.map((o) => o.id)));
              else setSelectedIds(new Set());
            },
          }}
          renderMobileCard={(order) => (
            <button
              type="button"
              onClick={() => setPeekOrder(order)}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate" title={order.customerName}>
                  {clipName(order.customerName)}
                  {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                    <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
                  )}
                  {order.isFollowUp && (
                    <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-info-300 bg-info-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-info-600 dark:border-info-700 dark:bg-info-900/30 dark:text-info-400">Follow Up</span>
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
            </button>
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

      {/* ── Peek Order Modal (mobile) ── */}
      {peekOrder && (
        <Modal
          open
          onClose={() => setPeekOrder(null)}
          maxWidth="max-w-sm"
          contentClassName="p-5 space-y-4"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-app-fg truncate" title={peekOrder.customerName}>{clipName(peekOrder.customerName)}</h3>
              <OrderStatusBadge status={peekOrder.status} expanded />
            </div>
            {peekOrder.orderNumber && (
              <OrderIdBadge id={peekOrder.id} orderNumber={peekOrder.orderNumber} />
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="block text-xs text-app-fg-muted">Amount</span>
                <NairaPrice amount={peekOrder.totalAmount ? Number(peekOrder.totalAmount) : null} />
              </div>
              <div>
                <span className="block text-xs text-app-fg-muted">Date</span>
                <span className="text-app-fg">{new Date(peekOrder.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
              <div>
                <span className="block text-xs text-app-fg-muted">Branch</span>
                <span className="text-app-fg">{peekOrder.branchName ?? '—'}</span>
              </div>
              <div>
                <span className="block text-xs text-app-fg-muted">Assigned CS</span>
                <span className="text-app-fg">{peekOrder.assignedCsName ?? 'Unassigned'}</span>
              </div>
              {peekOrder.mediaBuyerName && (
                <div>
                  <span className="block text-xs text-app-fg-muted">Media Buyer</span>
                  <span className="text-app-fg">{peekOrder.mediaBuyerName}</span>
                </div>
              )}
              {peekOrder.customerPhoneDisplay && (
                <div>
                  <span className="block text-xs text-app-fg-muted">Phone</span>
                  <span className="text-app-fg">{peekOrder.customerPhoneDisplay}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 pt-2 border-t border-app-border">
            <Link
              to={`/admin/orders/${peekOrder.id}`}
              className="btn-primary btn-sm flex-1 text-center inline-flex items-center justify-center"
              onClick={() => setPeekOrder(null)}
            >
              View full details
            </Link>
            <Button variant="secondary" size="sm" onClick={() => setPeekOrder(null)}>
              Close
            </Button>
          </div>
        </Modal>
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
          {isCartView ? (
            <>
              {selectedIds.size} abandoned cart{selectedIds.size !== 1 ? 's' : ''} will be converted into <strong>Unprocessed</strong> orders and assigned to the selected CS branch.
            </>
          ) : (
            <>
              {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} will be reset to <strong>Unprocessed</strong> and assigned to the selected CS branch.
            </>
          )}
        </p>
        <TextInput
          label="Batch name"
          value={batchName}
          onChange={(e) => setBatchName(e.target.value)}
          placeholder="e.g. Follow Up #1"
        />
        {branchesCatalog.length > 0 && (
          <FormSelect
            label="CS branch"
            value={targetBranchId}
            onChange={(e) => setTargetBranchId(e.target.value)}
            options={[
              { value: '', label: 'Select a branch…' },
              ...branchesCatalog.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` })),
            ]}
          />
        )}
        {groups.length > 0 && (
          <FormSelect
            label="Assign to group (optional)"
            value={selectedGroupId}
            onChange={(e) => {
              setSelectedGroupId(e.target.value);
              if (!e.target.value) setAssignmentMode('MANUAL');
            }}
            options={[
              { value: '', label: 'No group — assign later' },
              ...groups.map((g) => ({ value: g.id, label: `${g.name} (${g.memberCount} members)` })),
            ]}
          />
        )}
        {selectedGroupId && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-app-fg">Assignment mode</legend>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="assignmentMode"
                value="EQUAL"
                checked={assignmentMode === 'EQUAL'}
                onChange={() => setAssignmentMode('EQUAL')}
                className="accent-brand-500"
              />
              <span className="text-sm text-app-fg">Split equally — auto-assign orders to group members</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="assignmentMode"
                value="MANUAL"
                checked={assignmentMode === 'MANUAL'}
                onChange={() => setAssignmentMode('MANUAL')}
                className="accent-brand-500"
              />
              <span className="text-sm text-app-fg">Manual — assign individually from the batch detail</span>
            </label>
          </fieldset>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setReopenModalOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={reopenFetcher.state === 'submitting' || !targetBranchId || !batchName.trim()}
            loading={reopenFetcher.state === 'submitting'}
            loadingText={isCartView ? 'Converting…' : 'Reopening…'}
            onClick={() => {
              const originalStatuses: Record<string, string> = {};
              if (!isCartView) {
                for (const o of orders) {
                  if (selectedIds.has(o.id)) originalStatuses[o.id] = o.status;
                }
              }
              const submitData: Record<string, string> = {
                targetBranchId,
                batchName: batchName.trim(),
              };
              if (selectedGroupId) {
                submitData.groupId = selectedGroupId;
                submitData.assignmentMode = assignmentMode;
              }
              if (isCartView) {
                reopenFetcher.submit(
                  {
                    intent: 'bulkRecoverCarts',
                    cartIds: JSON.stringify([...selectedIds]),
                    ...submitData,
                  },
                  { method: 'post' },
                );
              } else {
                reopenFetcher.submit(
                  {
                    intent: 'reopenForFollowUp',
                    orderIds: JSON.stringify([...selectedIds]),
                    originalStatuses: JSON.stringify(originalStatuses),
                    ...submitData,
                  },
                  { method: 'post' },
                );
              }
            }}
          >
            {isCartView
              ? `Convert ${selectedIds.size} cart${selectedIds.size !== 1 ? 's' : ''} to orders`
              : `Reopen ${selectedIds.size} order${selectedIds.size !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </Modal>

      {/* ── Custom Date Range Modal ─────────────────────── */}
      <Modal
        open={customDateModalOpen}
        onClose={() => setCustomDateModalOpen(false)}
        maxWidth="max-w-sm"
        contentClassName="p-5 space-y-4"
      >
        <h3 className="text-base font-semibold text-app-fg">Custom date range</h3>
        <p className="text-sm text-app-fg-muted">Show orders created within this date range.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-app-fg-muted mb-1">From</label>
            <DateInput
              kind="date"
              value={draftStartDate}
              onChange={(e) => setDraftStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-app-fg-muted mb-1">To</label>
            <DateInput
              kind="date"
              value={draftEndDate}
              onChange={(e) => setDraftEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="primary" className="flex-1" onClick={applyCustomDateRange} disabled={!draftStartDate && !draftEndDate}>
            Apply
          </Button>
          <Button variant="secondary" onClick={() => setCustomDateModalOpen(false)}>
            Cancel
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
