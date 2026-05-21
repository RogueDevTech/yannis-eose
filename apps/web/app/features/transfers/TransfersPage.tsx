import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Link, useFetcher, useNavigation, useSearchParams } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DescriptionList } from '~/components/ui/description-list';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { StatusBadge } from '~/components/ui/status-badge';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import {
  applyOptimisticPatches,
  isOptimisticPatched,
  useOptimisticListPatches,
} from '~/hooks/useOptimisticListPatches';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { Tabs } from '~/components/ui/tabs';
import { Spinner } from '~/components/ui/spinner';
import type { Transfer, Location, Product, InventoryLevel, TransfersStreamData } from './types';

/** Status options shown as filter pills. Order matches the lifecycle. */
const STATUS_FILTER_OPTIONS: { value: string; label: string; dotColor: string }[] = [
  { value: 'PENDING', label: 'Pending approval', dotColor: 'bg-warning-500' },
  { value: 'IN_TRANSIT', label: 'In transit', dotColor: 'bg-brand-500' },
  { value: 'RECEIVED', label: 'Received', dotColor: 'bg-success-500' },
  { value: 'DISPUTED', label: 'Disputed', dotColor: 'bg-danger-500' },
  { value: 'REJECTED', label: 'Rejected', dotColor: 'bg-danger-500' },
  { value: 'CANCELLED', label: 'Cancelled', dotColor: 'bg-app-fg-muted' },
];

function formatRecordedAt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TransfersPage({
  transfers,
  locations,
  products,
  levels,
  canInitiate = true,
  transfersPageVariant = 'stock',
}: TransfersStreamData) {
  const fetcher = useFetcher();
  const cancelFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const approveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const rejectFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const formDataFetcher = useFetcher<{
    ok: boolean;
    products: Product[];
    levels: InventoryLevel[];
    error: string | null;
  }>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [viewTransfer, setViewTransfer] = useState<Transfer | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Transfer | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<Transfer | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectInlineError, setRejectInlineError] = useState<string | null>(null);
  // Multi-product transfer: one source → one destination, N (product, quantity)
  // line rows. Quantity stays a string while editing (raw TextInput value);
  // it's parsed to a number on serialise.
  const [transferLines, setTransferLines] = useState<Array<{ productId: string; quantity: string }>>([
    { productId: '', quantity: '' },
  ]);
  const [selectedFromLocation, setSelectedFromLocation] = useState('');
  const [selectedToLocationId, setSelectedToLocationId] = useState('');
  const openedFromUrlRef = useRef<string | null>(null);

  const stripTransferIdFromUrl = useCallback(() => {
    if (!searchParams.has('transferId')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('transferId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const dismissTransferModal = useCallback(() => {
    setViewTransfer(null);
    stripTransferIdFromUrl();
  }, [stripTransferIdFromUrl]);

  /** Deep-link from audit (`?transferId=`) — opens the detail sheet once transfers load */
  useEffect(() => {
    const id = searchParams.get('transferId')?.trim() ?? '';
    if (!id) {
      openedFromUrlRef.current = null;
      return;
    }
    if (transfers.length === 0) return;
    if (openedFromUrlRef.current === id) return;
    const hit = transfers.find((t) => t.id === id);
    if (hit) {
      setViewTransfer(hit);
      openedFromUrlRef.current = id;
    }
  }, [searchParams, transfers]);

  const cancelSubmitting = cancelFetcher.state !== 'idle';
  const [cancelInlineError, setCancelInlineError] = useState<string | null>(null);
  const cancelFetcherError = (cancelFetcher.data as { error?: string } | undefined)?.error ?? null;
  // Local validation errors (e.g. "reason too short") win over stale fetcher
  // errors so the user always sees the most recent feedback.
  const cancelError = cancelInlineError ?? cancelFetcherError;
  useFetcherToast(cancelFetcher.data, { successMessage: 'Transfer cancelled' });

  // Close cancel modal + clear reason on a successful cancel — edge-triggered
  // via the shared hook (see CLAUDE.md → "Modal + Optimistic UI Pattern").
  const handleCancelSuccess = useCallback(() => {
    setCancelTarget(null);
    setCancelReason('');
    setViewTransfer(null);
    stripTransferIdFromUrl();
  }, [stripTransferIdFromUrl]);
  useCloseOnFetcherSuccess(cancelFetcher, handleCancelSuccess);

  const submitCancel = () => {
    if (!cancelTarget) return;
    if (cancelReason.trim().length < 10) {
      setCancelInlineError('Cancellation reason must be at least 10 characters.');
      return;
    }
    setCancelInlineError(null);
    const fd = new FormData();
    fd.set('intent', 'cancelTransfer');
    fd.set('transferId', cancelTarget.id);
    fd.set('reason', cancelReason.trim());
    cancelFetcher.submit(fd, { method: 'POST' });
  };

  // Approve / Reject — both share the same `inventory.approveTransfer`
  // permission server-side. Approve is a one-click action; Reject opens a
  // modal demanding a reason ≥ 10 chars (audit trail).
  useFetcherToast(approveFetcher.data, { successMessage: 'Transfer approved' });
  useFetcherToast(rejectFetcher.data, { successMessage: 'Transfer rejected' });

  const submitApprove = (transfer: Transfer) => {
    const fd = new FormData();
    fd.set('intent', 'approveTransfer');
    fd.set('transferId', transfer.id);
    approveFetcher.submit(fd, { method: 'POST' });
  };

  const rejectSubmitting = rejectFetcher.state !== 'idle';
  const rejectFetcherError = (rejectFetcher.data as { error?: string } | undefined)?.error ?? null;
  const rejectError = rejectInlineError ?? rejectFetcherError;
  const handleRejectSuccess = useCallback(() => {
    setRejectTarget(null);
    setRejectReason('');
    setRejectInlineError(null);
    setViewTransfer(null);
    stripTransferIdFromUrl();
  }, [stripTransferIdFromUrl]);
  useCloseOnFetcherSuccess(rejectFetcher, handleRejectSuccess);

  const submitReject = () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 10) {
      setRejectInlineError('Rejection reason must be at least 10 characters.');
      return;
    }
    setRejectInlineError(null);
    const fd = new FormData();
    fd.set('intent', 'rejectTransfer');
    fd.set('transferId', rejectTarget.id);
    fd.set('reason', rejectReason.trim());
    rejectFetcher.submit(fd, { method: 'POST' });
  };

  // Optimistic status flip on approve/reject — keeps the row in place while
  // the loader revalidates. Server is canonical (the server re-checks the
  // source-authority gate on submit and runs the inventory side effects).
  const buildApprovePatches = useCallback((fd: FormData, intent: string) => {
    if (intent !== 'approveTransfer') return null;
    const id = fd.get('transferId')?.toString();
    if (!id) return null;
    return [{ id, patch: { transferStatus: 'IN_TRANSIT' as const, canApprove: false } }];
  }, []);
  const buildRejectPatches = useCallback((fd: FormData, intent: string) => {
    if (intent !== 'rejectTransfer') return null;
    const id = fd.get('transferId')?.toString();
    if (!id) return null;
    const reason = fd.get('reason')?.toString() ?? '';
    return [
      {
        id,
        patch: {
          transferStatus: 'REJECTED' as const,
          canApprove: false,
          rejectionReason: reason,
        },
      },
    ];
  }, []);
  const approvePatches = useOptimisticListPatches<Transfer>(approveFetcher, buildApprovePatches);
  const rejectPatches = useOptimisticListPatches<Transfer>(rejectFetcher, buildRejectPatches);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, {
    successMessage: transfersPageVariant === 'logistics' ? 'Transfer requested' : 'Transfer recorded',
  });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  // Close-on-success — edge-triggered via the shared hook. Resets the
  // selection state at the same instant the toast appears so a user
  // submitting two transfers in a row doesn't see stale field values.
  const resetTransferFormState = useCallback(() => {
    setTransferLines([{ productId: '', quantity: '' }]);
    setSelectedFromLocation('');
    setSelectedToLocationId('');
  }, []);
  const closeTransferForm = useCallback(() => {
    setShowForm(false);
    resetTransferFormState();
  }, [resetTransferFormState]);
  const openTransferForm = useCallback(() => {
    resetTransferFormState();
    setShowForm(true);
  }, [resetTransferFormState]);
  const addTransferLine = useCallback(() => {
    setTransferLines((ls) => [...ls, { productId: '', quantity: '' }]);
  }, []);
  const removeTransferLine = useCallback((idx: number) => {
    setTransferLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls));
  }, []);
  const updateTransferLine = useCallback(
    (idx: number, patch: Partial<{ productId: string; quantity: string }>) => {
      setTransferLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    },
    [],
  );

  const handleCreateTransferSuccess = useCallback(() => {
    closeTransferForm();
  }, [closeTransferForm]);
  useCloseOnFetcherSuccess(fetcher, handleCreateTransferSuccess);

  // Optimistic-add: synthesise one Transfer row per product line in the in-flight
  // payload so the table shows every new entry the instant the user clicks Save.
  const buildOptimisticTransfers = useCallback(
    (fd: FormData, intent: string): Transfer[] | null => {
      if (intent !== 'initiateTransfer') return null;
      const fromLocationId = fd.get('fromLocationId')?.toString().trim();
      const toLocationId = fd.get('toLocationId')?.toString().trim();
      if (!fromLocationId || !toLocationId) return null;

      let lines: Array<{ productId: string; quantity: number }>;
      try {
        const raw = JSON.parse(fd.get('lines')?.toString() ?? '[]') as unknown;
        if (!Array.isArray(raw)) return null;
        lines = raw.map((l) => {
          const o = (l ?? {}) as { productId?: unknown; quantity?: unknown };
          return { productId: String(o.productId ?? ''), quantity: Number(o.quantity ?? 0) };
        });
      } catch {
        return null;
      }
      const valid = lines.filter(
        (l) => l.productId && Number.isFinite(l.quantity) && l.quantity > 0,
      );
      if (valid.length === 0) return null;

      const createdAt = new Date().toISOString();
      return valid.map((l) => ({
        id: optimisticId(),
        productId: l.productId,
        quantitySent: l.quantity,
        quantityReceived: null,
        fromLocationId,
        toLocationId,
        transferStatus: 'IN_TRANSIT',
        shrinkageReason: null,
        receiverNotes: null,
        transferCost: null,
        createdAt,
        verifiedAt: null,
      }));
    },
    [],
  );
  const optimisticTransfers = useOptimisticListMerge<Transfer>(fetcher, buildOptimisticTransfers);
  const displayTransfers = useMemo(() => {
    // Layer order: server transfers + optimistic-add rows, then apply
    // approve/reject patches so a row mid-flight reflects its target status
    // (IN_TRANSIT or REJECTED) until the loader revalidates.
    const merged = [...optimisticTransfers, ...transfers];
    const afterApprove = applyOptimisticPatches(merged, approvePatches);
    return applyOptimisticPatches(afterApprove, rejectPatches);
  }, [optimisticTransfers, transfers, approvePatches, rejectPatches]);

  useEffect(() => {
    setSelectedToLocationId((prev) => (prev === selectedFromLocation ? '' : prev));
  }, [selectedFromLocation]);

  const resolvedProducts = (formDataFetcher.data?.products ?? products ?? []) as Product[];
  const resolvedLevels = (formDataFetcher.data?.levels ?? levels ?? []) as InventoryLevel[];
  const formDataLoading =
    canInitiate && (formDataFetcher.state === 'loading' || (!formDataFetcher.data && (products == null || levels == null)));
  const formDataError = formDataFetcher.data && !formDataFetcher.data.ok ? formDataFetcher.data.error : null;

  useEffect(() => {
    if (!canInitiate) return;
    // Loader already streamed products + levels — no side-load needed.
    if (Array.isArray(products) && Array.isArray(levels)) return;
    // Already fetched (success OR failure) — bail. Without this guard the
    // effect re-fires every time `formDataFetcher.state` flips back to
    // `idle`, because the `products` prop never updates after the
    // `/api/transfers-form-data` call (the response lands on
    // `formDataFetcher.data`, not on the loader props). That re-fire loop
    // is what made the Product dropdown spin "Loading products…" forever.
    if (formDataFetcher.data) return;
    if (formDataFetcher.state !== 'idle') return;
    formDataFetcher.load('/api/transfers-form-data');
  }, [canInitiate, products, levels, formDataFetcher.state, formDataFetcher.data]);

  const getLocationName = (id: string) => {
    const loc = locations.find((l: Location) => l.id === id);
    if (!loc) return id.slice(0, 8) + '...';
    return loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name;
  };

  const activeLocations = locations.filter((l: Location) => l.status === 'ACTIVE');
  const hasDateParams = searchParams.has('startDate') || searchParams.has('endDate') || searchParams.has('period');
  const periodAllTime = searchParams.get('period') === 'all_time' || !hasDateParams;
  const rawStartDate = searchParams.get('startDate') ?? '';
  const rawEndDate = searchParams.get('endDate') ?? '';
  const effectiveDateRange = (() => {
    if (periodAllTime) return { startDate: '', endDate: '' };
    if (rawStartDate && rawEndDate) return { startDate: rawStartDate, endDate: rawEndDate };
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      startDate: first.toISOString().slice(0, 10),
      endDate: last.toISOString().slice(0, 10),
    };
  })();

  // Filter state — synced to URL so filters persist across refreshes and can be deep-linked.
  const statusFilter = searchParams.get('status') ?? '';
  const [uiStatusFilter, setUiStatusFilter] = useState(statusFilter);
  const fromLocationFilter = searchParams.get('fromLocationId') ?? '';
  const toLocationFilter = searchParams.get('toLocationId') ?? '';
  const productFilter = searchParams.get('productId') ?? '';
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;

  useEffect(() => {
    if (navigation.state === 'idle') {
      setUiStatusFilter(statusFilter);
    }
  }, [statusFilter, navigation.state]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.delete('fromLocationId');
    next.delete('toLocationId');
    next.delete('productId');
    setSearchParams(next, { replace: true });
  };

  const hasFilters = !!(statusFilter || fromLocationFilter || toLocationFilter || productFilter);

  // Stable base set for summary cards + tab counts.
  // Applies date/location/product filters, but intentionally excludes status tab filter.
  // Uses `displayTransfers` so the in-flight optimistic row is included in the
  // counts and tabs the same instant the form submits.
  const summaryTransfers = useMemo(
    () =>
      displayTransfers.filter((t: Transfer) => {
        if (!periodAllTime) {
          const recordedIso = (t.verifiedAt ?? t.createdAt)?.slice(0, 10);
          if (!recordedIso) return false;
          if (recordedIso < effectiveDateRange.startDate || recordedIso > effectiveDateRange.endDate) return false;
        }
        if (fromLocationFilter && t.fromLocationId !== fromLocationFilter) return false;
        if (toLocationFilter && t.toLocationId !== toLocationFilter) return false;
        if (productFilter && t.productId !== productFilter) return false;
        return true;
      }),
    [
      displayTransfers,
      periodAllTime,
      effectiveDateRange.startDate,
      effectiveDateRange.endDate,
      fromLocationFilter,
      toLocationFilter,
      productFilter,
    ],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of summaryTransfers) {
      counts[t.transferStatus] = (counts[t.transferStatus] ?? 0) + 1;
    }
    return counts;
  }, [summaryTransfers]);

  const statusTabItems = useMemo(() => {
    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    return [
      { value: '', label: `All (${total})` },
      ...STATUS_FILTER_OPTIONS.map((opt) => ({
        value: opt.value,
        label: `${opt.label} (${statusCounts[opt.value] ?? 0})`,
      })),
    ];
  }, [statusCounts]);

  const filteredTransfers = summaryTransfers.filter((t: Transfer) => {
    if (statusFilter && t.transferStatus !== statusFilter) return false;
    return true;
  });

  // Client-side pagination — backend `inventory.transfers` does not paginate;
  // 20/page keeps the table light without losing the existing date/status filters.
  const TRANSFERS_PAGE_SIZE = 20;
  const [transfersPage, setTransfersPage] = useState(1);
  const transfersTotalPages = Math.max(
    1,
    Math.ceil(filteredTransfers.length / TRANSFERS_PAGE_SIZE),
  );
  const safeTransfersPage = Math.min(transfersPage, transfersTotalPages);
  const pagedTransfers = useMemo(
    () =>
      filteredTransfers.slice(
        (safeTransfersPage - 1) * TRANSFERS_PAGE_SIZE,
        safeTransfersPage * TRANSFERS_PAGE_SIZE,
      ),
    [filteredTransfers, safeTransfersPage],
  );
  // Reset when the filtered set shrinks past the current page or filters change.
  useEffect(() => {
    if (transfersPage > transfersTotalPages) setTransfersPage(1);
  }, [transfersPage, transfersTotalPages]);
  useEffect(() => {
    setTransfersPage(1);
  }, [statusFilter]);

  const summaryStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      PENDING: 0,
      IN_TRANSIT: 0,
      RECEIVED: 0,
      DISPUTED: 0,
      REJECTED: 0,
      CANCELLED: 0,
    };
    for (const t of summaryTransfers) {
      counts[t.transferStatus] = (counts[t.transferStatus] ?? 0) + 1;
    }
    return counts;
  }, [summaryTransfers]);

  const summaryQuantitySent = useMemo(
    () => summaryTransfers.reduce((sum, t) => sum + t.quantitySent, 0),
    [summaryTransfers],
  );

  const summaryQuantityReceived = useMemo(
    () => summaryTransfers.reduce((sum, t) => sum + (t.quantityReceived ?? 0), 0),
    [summaryTransfers],
  );

  const handleStatusTabChange = (value: string) => {
    setUiStatusFilter(value);
    updateFilter('status', value);
  };

  const buildStatusQuery = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    const qs = next.toString();
    return qs ? `?${qs}` : '?';
  };

  const pageTitle =
    transfersPageVariant === 'logistics' ? 'Partner Transfers' : 'Stock Transfers';
  const pageDescription =
    transfersPageVariant === 'logistics'
      ? 'Request stock moves between logistics locations.'
      : 'Move stock between locations and track receipt.';

  const initiateTransferCta =
    transfersPageVariant === 'logistics' ? '+ Request transfer' : '+ Record transfer';
  const modalTransferTitle =
    transfersPageVariant === 'logistics' ? 'Request stock transfer' : 'Record stock transfer';
  const saveTransferSubmitLabel =
    transfersPageVariant === 'logistics' ? 'Submit transfer request' : 'Save transfer';

  // Filter controls — rendered inline on desktop and inside the mobile
  // PageHeaderMobileTools kebab on small screens (CEO 2026-05-19: filters
  // grouped into the single action icon, not a separate mobile control).
  const transferFiltersBody = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <FormSelect
          id="transfer-filter-from"
          label="From location"
          value={fromLocationFilter}
          onChange={(e) => updateFilter('fromLocationId', e.target.value)}
          options={[
            { value: '', label: 'All locations' },
            ...locations.map((l: Location) => ({
              value: l.id,
              label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
            })),
          ]}
          controlSize="sm"
        />
        <FormSelect
          id="transfer-filter-to"
          label="To location"
          value={toLocationFilter}
          onChange={(e) => updateFilter('toLocationId', e.target.value)}
          options={[
            { value: '', label: 'All locations' },
            ...locations.map((l: Location) => ({
              value: l.id,
              label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
            })),
          ]}
          controlSize="sm"
        />
        <FormSelect
          id="transfer-filter-product"
          label="Product"
          value={productFilter}
          onChange={(e) => updateFilter('productId', e.target.value)}
          options={[
            { value: '', label: formDataLoading ? 'Loading products…' : 'All products' },
            ...resolvedProducts.map((p: Product) => ({ value: p.id, label: p.name })),
          ]}
          controlSize="sm"
          disabled={formDataLoading && resolvedProducts.length === 0}
        />
      </div>
      {hasFilters && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-app-fg-muted">
            {filteredTransfers.length} of {transfers.length} transfer{transfers.length === 1 ? '' : 's'}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );

  // Mobile tools-sheet variant — each filter sits in the same boxed, centered
  // app-hover chrome as the date-range row so the sheet reads as one
  // consistent column. The field name lives on the dropdown itself (its
  // default "From location" / "To location" option), not a separate label.
  // `openAs="modal"` opens the option list as a centered modal so it's
  // readable inside the tools sheet instead of a cramped anchored popover.
  // Every sheet control — filter boxes, date box, buttons — shares this height
  // so the tools sheet reads as one evenly-spaced column.
  const mobileFilterBoxClass =
    'flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5';
  const mobileFilterSelectClass = '!bg-transparent !border-transparent !text-center';
  const mobileTransferFiltersBody = (
    <div className="space-y-2">
      <div className={mobileFilterBoxClass}>
        <FormSelect
          id="transfer-filter-from-mobile"
          value={fromLocationFilter}
          onChange={(e) => updateFilter('fromLocationId', e.target.value)}
          options={[
            { value: '', label: 'From location' },
            ...locations.map((l: Location) => ({
              value: l.id,
              label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
            })),
          ]}
          controlSize="sm"
          openAs="modal"
          wrapperClassName="w-full"
          className={mobileFilterSelectClass}
        />
      </div>
      <div className={mobileFilterBoxClass}>
        <FormSelect
          id="transfer-filter-to-mobile"
          value={toLocationFilter}
          onChange={(e) => updateFilter('toLocationId', e.target.value)}
          options={[
            { value: '', label: 'To location' },
            ...locations.map((l: Location) => ({
              value: l.id,
              label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
            })),
          ]}
          controlSize="sm"
          openAs="modal"
          wrapperClassName="w-full"
          className={mobileFilterSelectClass}
        />
      </div>
      <div className={mobileFilterBoxClass}>
        <FormSelect
          id="transfer-filter-product-mobile"
          value={productFilter}
          onChange={(e) => updateFilter('productId', e.target.value)}
          options={[
            { value: '', label: formDataLoading ? 'Loading products…' : 'All products' },
            ...resolvedProducts.map((p: Product) => ({ value: p.id, label: p.name })),
          ]}
          controlSize="sm"
          openAs="modal"
          wrapperClassName="w-full"
          className={mobileFilterSelectClass}
          disabled={formDataLoading && resolvedProducts.length === 0}
        />
      </div>
      {hasFilters && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-12 w-full justify-center"
          onClick={clearFilters}
        >
          Clear filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={pageTitle}
        mobileInlineActions
        description={pageDescription}
        actions={
          <PageHeaderMobileTools
            sheetTitle={`${pageTitle} — tools`}
            sheetSubtitle={<span>Date range and new transfer</span>}
            triggerAriaLabel={`${pageTitle} toolbar and date range`}
            filters={mobileTransferFiltersBody}
            filtersBadgeCount={hasFilters ? 1 : 0}
            desktop={
              <>
                <div className="flex shrink-0 items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={periodAllTime ? '' : effectiveDateRange.startDate}
                    endDate={periodAllTime ? '' : effectiveDateRange.endDate}
                    periodAllTime={periodAllTime}
                  />
                </div>
                {canInitiate && (
                  <>
                    <Button variant="primary" size="sm" onClick={openTransferForm}>
                      {initiateTransferCta}
                    </Button>
                    <Link to="/admin/transfers/import" prefetch="intent" className="btn-secondary btn-sm">
                      Bulk import
                    </Link>
                  </>
                )}
                <PageRefreshButton />
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                {canInitiate && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-12 w-full justify-center"
                      onClick={() => {
                        closeSheet();
                        openTransferForm();
                      }}
                    >
                      {initiateTransferCta}
                    </Button>
                    <Link
                      to="/admin/transfers/import"
                      prefetch="intent"
                      className="btn-secondary btn-sm h-12 flex items-center justify-center w-full"
                    >
                      Bulk import
                    </Link>
                  </>
                )}
              </>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={periodAllTime ? '' : effectiveDateRange.startDate}
        endDate={periodAllTime ? '' : effectiveDateRange.endDate}
        periodAllTime={periodAllTime}
      />

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Transfer records', value: summaryTransfers.length, valueClassName: 'text-app-fg' },
          {
            label: 'Pending',
            value: summaryStatusCounts.PENDING,
            valueClassName: 'text-warning-600 dark:text-warning-400',
            to: buildStatusQuery('PENDING'),
          },
          {
            label: 'In transit',
            value: summaryStatusCounts.IN_TRANSIT,
            valueClassName: 'text-brand-600 dark:text-brand-400',
            to: buildStatusQuery('IN_TRANSIT'),
          },
          {
            label: 'Received',
            value: summaryStatusCounts.RECEIVED,
            valueClassName: 'text-success-600 dark:text-success-400',
            to: buildStatusQuery('RECEIVED'),
          },
          {
            label: 'Disputed',
            value: summaryStatusCounts.DISPUTED,
            valueClassName: 'text-danger-600 dark:text-danger-400',
            to: buildStatusQuery('DISPUTED'),
          },
          {
            label: 'Cancelled',
            value: summaryStatusCounts.CANCELLED,
            valueClassName: 'text-app-fg-muted',
            to: buildStatusQuery('CANCELLED'),
          },
          { label: 'Qty sent', value: summaryQuantitySent, valueClassName: 'text-app-fg' },
          {
            label: 'Qty received',
            value: summaryQuantityReceived,
            valueClassName: 'text-brand-600 dark:text-brand-400',
          },
        ]}
      />

      {/* Status tabs — primary navigation, always visible at every viewport. */}
      <Tabs value={uiStatusFilter} onChange={handleStatusTabChange} tabs={statusTabItems} />

      {/* Filters — from/to/product dropdowns. URL-synced so filters persist
          across refreshes and can be deep-linked. Desktop-only here; on mobile the same
          controls render inside the PageHeaderMobileTools kebab (see `filters` prop). */}
      <div className="hidden md:block card p-3 sm:p-4">{transferFiltersBody}</div>

      {canInitiate && (
        <Modal
          open={showForm}
          onClose={closeTransferForm}
          maxWidth="max-w-2xl"
          aria-labelledby="transfer-form-title"
        >
          <div className="card border-0 shadow-none space-y-4 p-4 sm:p-6">
            {formDataError ? (
              <div className="card border-danger-200 dark:border-danger-800 bg-danger-50/80 dark:bg-danger-900/20 !p-4">
                <p className="text-sm font-medium text-danger-800 dark:text-danger-200">Could not load form data</p>
                <p className="text-sm text-danger-800/80 dark:text-danger-200/80 mt-1">{formDataError}</p>
                <div className="mt-3">
                  <Button type="button" variant="secondary" size="sm" onClick={() => formDataFetcher.load('/api/transfers-form-data')}>
                    Retry
                  </Button>
                </div>
              </div>
            ) : null}

            {formDataLoading && resolvedProducts.length === 0 ? (
              <div className="card !p-4">
                <div className="flex items-center gap-2 text-sm text-app-fg-muted">
                  <Spinner className="w-4 h-4" />
                  <span>Loading form data…</span>
                </div>
              </div>
            ) : (() => {
              const activeProducts = resolvedProducts.filter((p: Product) => p.status === 'ACTIVE');

              const getAvailableStock = (productId: string, locationId: string) => {
                const level = resolvedLevels.find(
                  (l: InventoryLevel) => l.productId === productId && l.locationId === locationId,
                );
                return level ? level.stockCount - level.reservedCount : 0;
              };

              // Total available units across all products at a location — shown
              // on the From / To dropdowns so the user can see which locations
              // actually hold stock before picking products.
              const getLocationTotalStock = (locationId: string) =>
                resolvedLevels
                  .filter((l: InventoryLevel) => l.locationId === locationId)
                  .reduce(
                    (sum: number, l: InventoryLevel) =>
                      sum + (l.stockCount - l.reservedCount),
                    0,
                  );

              // Products already chosen on other line rows — hidden from the
              // remaining product pickers so the same product can't be added
              // twice (the server rejects duplicates too).
              const usedProductIds = new Set(
                transferLines.map((l) => l.productId).filter(Boolean),
              );
              const filledLines = transferLines.filter(
                (l) => l.productId && Number(l.quantity) > 0,
              );
              const linesValid =
                transferLines.length === filledLines.length && filledLines.length > 0;
              const canSubmitTransfer =
                !!selectedFromLocation &&
                !!selectedToLocationId &&
                selectedFromLocation !== selectedToLocationId &&
                linesValid;
              const serializedLines = JSON.stringify(
                filledLines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
              );

              return (
                <fetcher.Form method="post" className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 id="transfer-form-title" className="text-lg font-semibold text-app-fg">
                            {modalTransferTitle}
                          </h3>
                          <button
                            type="button"
                            onClick={closeTransferForm}
                            className="text-app-fg-muted hover:text-app-fg shrink-0"
                            aria-label="Close"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        <input type="hidden" name="intent" value="initiateTransfer" />
                        <input type="hidden" name="fromLocationId" value={selectedFromLocation} />
                        <input type="hidden" name="toLocationId" value={selectedToLocationId} />
                        {/* All product lines serialised as JSON — the route action
                            and `inventory.transferBatch` consume this shape. */}
                        <input type="hidden" name="lines" value={serializedLines} />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <SearchableSelect
                            id="transfer-from-location"
                            label="From location"
                            required
                            value={selectedFromLocation}
                            onChange={setSelectedFromLocation}
                            placeholder="Select source..."
                            searchPlaceholder="Search locations..."
                            options={activeLocations.map((l: Location) => ({
                              value: l.id,
                              label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
                              description: `${getLocationTotalStock(l.id)} units in stock`,
                            }))}
                          />

                          <SearchableSelect
                            id="transfer-to-location"
                            label="To location"
                            required
                            value={selectedToLocationId}
                            onChange={setSelectedToLocationId}
                            placeholder="Select destination..."
                            searchPlaceholder="Search locations..."
                            options={activeLocations
                              .filter((l: Location) => l.id !== selectedFromLocation)
                              .map((l: Location) => ({
                                value: l.id,
                                label: l.providerName ? `${l.name} — ${l.providerName}` : l.name,
                                description: `${getLocationTotalStock(l.id)} units in stock`,
                              }))}
                          />
                        </div>

                        {/* Multi-product line rows — one stock_transfers row per
                            product, all created together to the same destination. */}
                        <div className="space-y-2">
                          <span className="text-xs font-medium text-app-fg-muted">
                            Products to transfer
                          </span>
                          {transferLines.map((line, idx) => {
                            const lineOptions = activeProducts
                              .filter(
                                (p: Product) =>
                                  p.id === line.productId || !usedProductIds.has(p.id),
                              )
                              .map((p: Product) => ({
                                value: p.id,
                                label: p.name,
                                // Once a source is picked, show each product's
                                // available stock at that location so the user
                                // can see what they have before selecting.
                                description: selectedFromLocation
                                  ? `${getAvailableStock(p.id, selectedFromLocation)} available`
                                  : undefined,
                              }));
                            const lineAvailable =
                              line.productId && selectedFromLocation
                                ? getAvailableStock(line.productId, selectedFromLocation)
                                : null;
                            const qtyNum = Number(line.quantity);
                            const overStock =
                              lineAvailable != null &&
                              line.quantity !== '' &&
                              Number.isFinite(qtyNum) &&
                              qtyNum > lineAvailable;
                            return (
                              <div
                                key={idx}
                                className="flex flex-col gap-2 sm:flex-row sm:items-start"
                              >
                                <div className="min-w-0 flex-1">
                                  <SearchableSelect
                                    id={`transfer-product-${idx}`}
                                    label={idx === 0 ? 'Product' : undefined}
                                    value={line.productId}
                                    onChange={(v) => updateTransferLine(idx, { productId: v })}
                                    placeholder="Select product..."
                                    searchPlaceholder="Search products..."
                                    options={lineOptions}
                                  />
                                </div>
                                <div className="w-full sm:w-44">
                                  <TextInput
                                    type="number"
                                    min={1}
                                    value={line.quantity}
                                    onChange={(e) =>
                                      updateTransferLine(idx, { quantity: e.target.value })
                                    }
                                    label={
                                      idx === 0
                                        ? lineAvailable != null
                                          ? `Quantity (max: ${lineAvailable})`
                                          : 'Quantity'
                                        : undefined
                                    }
                                    placeholder="Units"
                                    error={
                                      overStock ? `Only ${lineAvailable} available` : undefined
                                    }
                                  />
                                </div>
                                <div className={idx === 0 ? 'sm:pt-[1.625rem]' : undefined}>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="w-full sm:w-auto"
                                    disabled={transferLines.length === 1}
                                    onClick={() => removeTransferLine(idx)}
                                    aria-label="Remove product line"
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={addTransferLine}
                          >
                            + Add another product
                          </Button>
                        </div>

                        {selectedFromLocation && selectedToLocationId && (
                          <div className="flex items-center justify-center gap-3 py-2 text-sm text-app-fg-muted">
                            <span className="font-medium text-app-fg-muted">{getLocationName(selectedFromLocation)}</span>
                            <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                            <span className="font-medium text-app-fg-muted">{getLocationName(selectedToLocationId)}</span>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            disabled={!canSubmitTransfer}
                            loading={fetcher.state === 'submitting'}
                            loadingText={
                              transfersPageVariant === 'logistics' ? 'Submitting…' : 'Saving…'
                            }
                          >
                            {saveTransferSubmitLabel}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setShowForm(false);
                              resetTransferFormState();
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </fetcher.Form>
              );
            })()}
          </div>
        </Modal>
      )}

      {formDataLoading && resolvedProducts.length === 0 ? (
        <div className="card !p-4">
          <div className="flex items-center gap-2 text-sm text-app-fg-muted">
            <Spinner className="w-4 h-4" />
            <span>Loading products…</span>
          </div>
        </div>
      ) : (
          (() => {
            const productName = (id: string) =>
              resolvedProducts.find((p: Product) => p.id === id)?.name ?? id.slice(0, 8) + '...';

            const columns: CompactTableColumn<Transfer>[] = [
              {
                key: 'product',
                header: 'Product',
                render: (t) => {
                  const midFlight =
                    isOptimisticId(t.id) ||
                    isOptimisticPatched(approvePatches, t.id) ||
                    isOptimisticPatched(rejectPatches, t.id);
                  return (
                    <span className="font-medium text-app-fg">
                      {productName(t.productId)}
                      {midFlight ? (
                        <span className="ml-2 text-micro uppercase tracking-wide text-app-fg-muted">
                          Saving…
                        </span>
                      ) : null}
                    </span>
                  );
                },
                minWidth: 'min-w-[140px]',
              },
              {
                key: 'route',
                header: 'From → To',
                render: (t) => (
                  <span className="text-xs text-app-fg-muted sm:text-sm">
                    {getLocationName(t.fromLocationId)} → {getLocationName(t.toLocationId)}
                  </span>
                ),
                minWidth: 'min-w-[160px]',
              },
              {
                key: 'qty',
                header: 'Qty',
                align: 'right',
                render: (t) => <span className="font-medium tabular-nums">{t.quantityReceived ?? t.quantitySent}</span>,
              },
              {
                key: 'recorded',
                header: 'Recorded',
                render: (t) => (
                  <span className="text-app-fg-muted whitespace-nowrap text-xs sm:text-sm">
                    {formatRecordedAt(t.verifiedAt ?? t.createdAt)}
                  </span>
                ),
                hideOnMobile: true,
              },
              {
                key: 'status',
                header: 'Status',
                render: (t) => <StatusBadge status={t.transferStatus} showDot />,
              },
              {
                key: 'actions',
                header: '',
                mobileShowLabel: false,
                align: 'right',
                tight: true,
                render: (t) => {
                  const isMidFlight =
                    isOptimisticId(t.id) ||
                    isOptimisticPatched(approvePatches, t.id) ||
                    isOptimisticPatched(rejectPatches, t.id);
                  const isPending = t.transferStatus === 'PENDING';
                  // Source-authority gate is canonical on the server; the
                  // server stamps `canApprove` per row for the viewer.
                  const showApproval = isPending && t.canApprove === true;
                  // PENDING rows can be Cancelled by the initiator (no-op on
                  // inventory); Cancel is hidden on REJECTED/CANCELLED.
                  const canCancel =
                    t.transferStatus !== 'CANCELLED' && t.transferStatus !== 'REJECTED';
                  return (
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <CompactTableActionButton
                        disabled={isMidFlight}
                        onClick={() => setViewTransfer(t)}
                      >
                        View
                      </CompactTableActionButton>
                      {showApproval && (
                        <>
                          <CompactTableActionButton
                            tone="success"
                            disabled={isMidFlight}
                            onClick={() => submitApprove(t)}
                          >
                            Approve
                          </CompactTableActionButton>
                          <CompactTableActionButton
                            tone="danger"
                            disabled={isMidFlight}
                            onClick={() => {
                              setRejectTarget(t);
                              setRejectReason('');
                              setRejectInlineError(null);
                            }}
                          >
                            Reject
                          </CompactTableActionButton>
                        </>
                      )}
                      {canCancel && !showApproval && (
                        <CompactTableActionButton
                          tone="danger"
                          disabled={isMidFlight}
                          onClick={() => {
                            setCancelTarget(t);
                            setCancelReason('');
                          }}
                        >
                          Cancel
                        </CompactTableActionButton>
                      )}
                    </div>
                  );
                },
              },
            ];

            return (
              <CompactTable<Transfer>
                caption={pageTitle}
                columns={columns}
                rows={pagedTransfers}
                rowKey={(t) => {
                  const o = t as Transfer & {
                    outcomeStatus?: string;
                    outcomeQuantity?: number | null;
                  };
                  if (o.outcomeStatus != null)
                    return `${t.id}-${o.outcomeStatus}-${String(o.outcomeQuantity ?? '')}`;
                  return t.id;
                }}
                rowClassName={(t) =>
                  isOptimisticId(t.id) ||
                  isOptimisticPatched(approvePatches, t.id) ||
                  isOptimisticPatched(rejectPatches, t.id)
                    ? 'opacity-60'
                    : ''
                }
                loading={isLoaderRefetchBusy}
                loadingVariant="overlay"
                emptyTitle="No transfers yet"
                emptyDescription={
                  periodAllTime
                    ? 'No transfers match your filters, or none recorded yet. In-transit transfers stay visible until received — try the In transit tab or clear filters.'
                    : 'No transfers in this date range. In-transit transfers are dated by when they were sent (created). Try All time or widen the range.'
                }
                withCard={false}
                className="overflow-hidden rounded-xl border border-app-border"
                pagination={
                  filteredTransfers.length > 0
                    ? {
                        page: safeTransfersPage,
                        totalPages: transfersTotalPages,
                        onPageChange: setTransfersPage,
                        summary: (
                          <p className="text-sm text-app-fg-muted">
                            Showing {(safeTransfersPage - 1) * TRANSFERS_PAGE_SIZE + 1}–
                            {Math.min(safeTransfersPage * TRANSFERS_PAGE_SIZE, filteredTransfers.length)} of{' '}
                            {filteredTransfers.length}
                            <span className="text-app-fg-muted/90"> · {TRANSFERS_PAGE_SIZE} per page</span>
                          </p>
                        ),
                        wrapperClassName:
                          'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-app-border px-4 py-3',
                        controlsClassName: 'sm:justify-end',
                      }
                    : undefined
                }
              />
            );
          })()
      )}

      <Modal open={!!viewTransfer} onClose={dismissTransferModal} maxWidth="max-w-lg" aria-labelledby="transfer-detail-title">
        {viewTransfer && (
          <div className="card border-0 shadow-none space-y-4 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 id="transfer-detail-title" className="text-lg font-semibold text-app-fg">
                Transfer details
              </h3>
              <button type="button" onClick={dismissTransferModal} className="text-app-fg-muted hover:text-app-fg shrink-0" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {(() => {
              const prod = resolvedProducts.find((p: Product) => p.id === viewTransfer.productId);
              const qtyLabel =
                viewTransfer.quantityReceived != null && viewTransfer.quantityReceived !== viewTransfer.quantitySent
                  ? `${viewTransfer.quantityReceived} received (${viewTransfer.quantitySent} sent)`
                  : String(viewTransfer.quantityReceived ?? viewTransfer.quantitySent);

              return (
                <DescriptionList
                  items={[
                    { label: 'Product', value: prod?.name ?? viewTransfer.productId },
                    { label: 'From', value: getLocationName(viewTransfer.fromLocationId) },
                    { label: 'To', value: getLocationName(viewTransfer.toLocationId) },
                    { label: 'Quantity', value: qtyLabel },
                    {
                      label: 'Recorded',
                      value: formatRecordedAt(viewTransfer.createdAt),
                    },
                    ...(viewTransfer.senderName
                      ? [{ label: 'Initiated by', value: viewTransfer.senderName }]
                      : []),
                    ...(viewTransfer.approvedAt
                      ? [
                          {
                            label: 'Approved',
                            value: formatRecordedAt(viewTransfer.approvedAt),
                          },
                        ]
                      : []),
                    ...(viewTransfer.rejectedAt
                      ? [
                          {
                            label: 'Rejected',
                            value: formatRecordedAt(viewTransfer.rejectedAt),
                          },
                        ]
                      : []),
                    ...(viewTransfer.rejectionReason
                      ? [{ label: 'Rejection reason', value: viewTransfer.rejectionReason }]
                      : []),
                    ...(viewTransfer.verifiedAt
                      ? [
                          {
                            label: 'Verified',
                            value: formatRecordedAt(viewTransfer.verifiedAt),
                          },
                        ]
                      : []),
                    ...(viewTransfer.shrinkageReason
                      ? [{ label: 'Shrinkage reason', value: viewTransfer.shrinkageReason }]
                      : []),
                    ...(viewTransfer.receiverNotes
                      ? [{ label: 'Receiver comment', value: viewTransfer.receiverNotes }]
                      : []),
                  ]}
                />
              );
            })()}
            {viewTransfer.transferStatus === 'PENDING' && viewTransfer.canApprove ? (
              <p className="rounded-md border border-warning-200 bg-warning-50/60 px-3 py-2 text-xs text-warning-800 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-200">
                This transfer is awaiting your approval as the source-location authority. Approving deducts source stock and flips the transfer to In transit. Rejecting leaves stock untouched.
              </p>
            ) : viewTransfer.transferStatus === 'PENDING' ? (
              <p className="text-xs text-app-fg-muted">
                Awaiting approval from the source-location authority before stock leaves.
              </p>
            ) : viewTransfer.transferStatus === 'REJECTED' ? (
              <p className="text-xs text-app-fg-muted">
                This transfer was rejected; no stock movement occurred. Reason logged in the audit trail.
              </p>
            ) : (
              <p className="text-xs text-app-fg-muted">
                Confirm or dispute receipt in <span className="font-medium text-app-fg">Logistics → Stock Transfer Confirmations</span>.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {viewTransfer.transferStatus === 'PENDING' && viewTransfer.canApprove && (
                <>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      submitApprove(viewTransfer);
                      dismissTransferModal();
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRejectTarget(viewTransfer);
                      setRejectReason('');
                      setRejectInlineError(null);
                    }}
                  >
                    Reject
                  </Button>
                </>
              )}
              {viewTransfer.transferStatus !== 'CANCELLED' &&
                viewTransfer.transferStatus !== 'REJECTED' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCancelTarget(viewTransfer);
                      setCancelReason('');
                    }}
                  >
                    Cancel transfer
                  </Button>
                )}
              <Button type="button" variant="secondary" size="sm" onClick={dismissTransferModal}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel-transfer confirmation. The reason is mandatory (≥ 10 chars) so
          the audit trail explains the reversal. The server reverses both
          inventory legs in one transaction and refuses if the destination has
          already shipped the units. */}
      <ConfirmActionModal
        open={!!cancelTarget}
        onClose={() => {
          if (!cancelSubmitting) {
            setCancelTarget(null);
            setCancelReason('');
            setCancelInlineError(null);
          }
        }}
        title="Cancel this transfer?"
        description={
          cancelTarget
            ? cancelTarget.transferStatus === 'PENDING'
              ? `This transfer is still awaiting approval — cancelling leaves stock at ${getLocationName(cancelTarget.fromLocationId)} unchanged. The row stays for audit but flips to CANCELLED.`
              : `This will add ${cancelTarget.quantitySent} unit(s) back to ${getLocationName(cancelTarget.fromLocationId)} and remove ${cancelTarget.quantityReceived ?? cancelTarget.quantitySent} unit(s) from ${getLocationName(cancelTarget.toLocationId)}. The transfer row stays for audit but flips to CANCELLED.`
            : ''
        }
        confirmLabel="Cancel transfer"
        cancelLabel="Keep transfer"
        variant="danger"
        loading={cancelSubmitting}
        onConfirm={submitCancel}
        error={cancelError}
        details={
          <div className="space-y-2">
            <label htmlFor="cancel-transfer-reason" className="block text-xs font-semibold text-app-fg-muted uppercase tracking-wider">
              Reason (required, min 10 chars)
            </label>
            <Textarea
              id="cancel-transfer-reason"
              value={cancelReason}
              onChange={(e) => {
                setCancelReason(e.target.value);
                if (cancelInlineError && e.target.value.trim().length >= 10) {
                  setCancelInlineError(null);
                }
              }}
              rows={3}
              placeholder="Why is this transfer being cancelled?"
              maxLength={500}
            />
            <p className="text-mini text-app-fg-muted">
              {cancelReason.trim().length}/10 characters minimum
            </p>
          </div>
        }
      />

      {/* Reject-transfer confirmation. Mandatory reason (≥ 10 chars) so the
          audit trail explains the rejection. Inventory-neutral — PENDING rows
          haven't deducted source stock, so reject is a clean status flip. */}
      <ConfirmActionModal
        open={!!rejectTarget}
        onClose={() => {
          if (!rejectSubmitting) {
            setRejectTarget(null);
            setRejectReason('');
            setRejectInlineError(null);
          }
        }}
        title="Reject this transfer?"
        description={
          rejectTarget
            ? `Rejecting will leave stock at ${getLocationName(rejectTarget.fromLocationId)} unchanged. The transfer row stays for audit but flips to REJECTED, and the initiator is notified.`
            : ''
        }
        confirmLabel="Reject transfer"
        cancelLabel="Keep pending"
        variant="danger"
        loading={rejectSubmitting}
        onConfirm={submitReject}
        error={rejectError}
        details={
          <div className="space-y-2">
            <label
              htmlFor="reject-transfer-reason"
              className="block text-xs font-semibold text-app-fg-muted uppercase tracking-wider"
            >
              Reason (required, min 10 chars)
            </label>
            <Textarea
              id="reject-transfer-reason"
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                if (rejectInlineError && e.target.value.trim().length >= 10) {
                  setRejectInlineError(null);
                }
              }}
              rows={3}
              placeholder="Why is this transfer being rejected?"
              maxLength={500}
            />
            <p className="text-mini text-app-fg-muted">
              {rejectReason.trim().length}/10 characters minimum
            </p>
          </div>
        }
      />

    </div>
  );
}
