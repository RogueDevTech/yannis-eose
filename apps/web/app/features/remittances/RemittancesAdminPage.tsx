import { useCallback, useEffect, useState, useMemo } from 'react';
import { useFetcher, useRevalidator, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
import { NumberInput } from '~/components/ui/number-input';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { type FilterPillOption } from '~/components/ui/filter-pills';
import { Textarea } from '~/components/ui/textarea';
import {
  CompactTable,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';

export interface TransferConfirmationRecord {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  productId: string;
  productName: string;
  quantitySent: number;
  quantityReceived: number | null;
  transferStatus: string;
  createdAt: string;
  verifiedAt: string | null;
  fromLocationName: string;
  toLocationName: string;
  fromProviderName: string | null;
  toProviderName: string | null;
  shrinkageReason: string | null;
  /** Optional comment the receiver writes when marking received (incl. shrinkage notes). */
  receiverNotes?: string | null;
  senderName?: string | null;
  outcomeStatus?: 'APPROVED' | 'DISPUTED' | 'IN_TRANSIT' | 'RECEIVED' | 'SENT' | string;
  outcomeQuantity?: number | null;
  outcomeReason?: string | null;
}

export interface RemittancesAdminPageProps {
  remittances: TransferConfirmationRecord[];
  /** All records matching date/field filters (before status filter). Used for stat strip totals. */
  allRemittances?: TransferConfirmationRecord[];
  locations: Array<{ id: string; name: string; providerName?: string | null }>;
  senderOptions: string[];
  filters: {
    status: string;
    locationId: string;
    search: string;
    sender: string;
    minQty: string;
    maxQty: string;
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
  };
}

function formatLocationWithProvider(name: string, providerName: string | null | undefined): string {
  return providerName ? `${name} • ${providerName}` : name;
}

/** In-transit rows need Receive / Not received; received or disputed rows use View. */
function isPendingTransfer(r: TransferConfirmationRecord): boolean {
  return r.transferStatus === 'IN_TRANSIT';
}

export function RemittancesAdminPage({ remittances, allRemittances, locations, senderOptions, filters }: RemittancesAdminPageProps) {
  const fetcher = useFetcher();
  const bulkFetcher = useFetcher();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;
  const [searchParams, setSearchParams] = useSearchParams();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [quantityReceived, setQuantityReceived] = useState<Record<string, string>>({});
  const [shrinkageReason, setShrinkageReason] = useState<Record<string, string>>({});
  const [receiverNotes, setReceiverNotes] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<{
    row: TransferConfirmationRecord;
    mode: 'receive' | 'reject';
  } | null>(null);
  const [actionModalFieldError, setActionModalFieldError] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<TransferConfirmationRecord | null>(null);

  // ── Bulk selection ─────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmModalOpen, setBulkConfirmModalOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; errors: string[] } | null>(null);

  // Track IDs that have been successfully processed this session so we can
  // immediately disable their action buttons — prevents the "Transfer is
  // RECEIVED, cannot verify" race when clicking fast before revalidation lands.
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());
  // Clear processed set when data reloads (revalidation brings fresh statuses)
  useEffect(() => {
    setProcessedIds(new Set());
  }, [remittances]);

  const [searchDraft, setSearchDraft] = useState(filters.search);
  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  const alreadyProcessedError = (() => {
    const errMsg =
      fetcher.data && typeof fetcher.data === 'object' && 'error' in fetcher.data
        ? (fetcher.data as { error?: string }).error
        : undefined;
    return errMsg && /Transfer is (RECEIVED|DISPUTED|CANCELLED)/i.test(errMsg);
  })();
  useFetcherToast(fetcher.data, {
    successMessage: 'Transfer recorded',
    // Show inline in modal when open, BUT suppress "already processed" errors
    // entirely — they're a harmless race from clicking fast; the row updates on
    // revalidation. Without this, user sees a scary red toast for no reason.
    skipErrorToast: alreadyProcessedError || (!!pendingAction && !alreadyProcessedError),
  });

  // When the server says the transfer is already processed (race condition —
  // another user confirmed it while this modal was open), auto-close the modal
  // and revalidate the list so the row shows the correct status.
  const revalidator = useRevalidator();
  useEffect(() => {
    const errMsg =
      fetcher.data && typeof fetcher.data === 'object' && 'error' in fetcher.data
        ? (fetcher.data as { error?: string }).error
        : undefined;
    if (errMsg && pendingAction && /Transfer is (RECEIVED|DISPUTED|CANCELLED)/i.test(errMsg)) {
      setPendingAction(null);
      setActionModalFieldError(null);
      setMarkingId(null);
      revalidator.revalidate();
    }
  }, [fetcher.data, pendingAction, revalidator]);

  // Client-side pagination — backend doesn't paginate transfer remittances yet.
  const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
  const [remitPageSize, setRemitPageSize] = useState(20);
  const [remitPage, setRemitPage] = useState(1);
  const remitTotalPages = Math.max(1, Math.ceil(remittances.length / remitPageSize));
  const safeRemitPage = Math.min(remitPage, remitTotalPages);
  const pagedRemittances = useMemo(
    () =>
      remittances.slice(
        (safeRemitPage - 1) * remitPageSize,
        safeRemitPage * remitPageSize,
      ),
    [remittances, safeRemitPage],
  );
  useEffect(() => {
    if (remitPage > remitTotalPages) setRemitPage(1);
  }, [remitPage, remitTotalPages]);
  useEffect(() => {
    setRemitPage(1);
  }, [remittances.length]);

  // Clear selection when data reloads (e.g. after bulk action completes)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [remittances]);

  const pendingRemittances = useMemo(
    () => remittances.filter((r) => r.transferStatus === 'IN_TRANSIT'),
    [remittances],
  );
  const selectedPendingCount = useMemo(
    () => pendingRemittances.filter((r) => selectedIds.has(r.id)).length,
    [pendingRemittances, selectedIds],
  );

  // Stats use allRemittances (date/field filtered, before status filter) so the
  // overview strip stays stable when a status pill is selected. The table rows
  // use `remittances` which includes the status filter.
  const statsSource = allRemittances ?? remittances;
  const sentRemittances = statsSource.filter((r) => r.transferStatus === 'IN_TRANSIT');
  const receivedCount = statsSource.filter((r) => r.outcomeStatus === 'APPROVED').length;
  const disputedCount = statsSource.filter((r) => r.outcomeStatus === 'DISPUTED').length;
  const totalQuantitySent = statsSource.reduce((sum, r) => sum + r.quantitySent, 0);
  const totalQuantityReceived = statsSource.reduce((sum, r) => {
    if (r.outcomeStatus === 'APPROVED') return sum + (r.outcomeQuantity ?? 0);
    return sum;
  }, 0);

  // Status filter pills — single source of truth for which list is shown. Drives the
  // URL `status` param so the loader can scope server-side filtering on next load.
  const statusValue = filters.status; // '' | IN_TRANSIT | RECEIVED | DISPUTED
  const statusPillOptions: FilterPillOption[] = useMemo(
    () => [
      { value: '', label: 'All', count: statsSource.length },
      { value: 'IN_TRANSIT', label: 'Pending', count: sentRemittances.length, dotColor: 'bg-warning-500' },
      { value: 'RECEIVED', label: 'Received', count: receivedCount, dotColor: 'bg-success-500' },
      { value: 'DISPUTED', label: 'Disputed', count: disputedCount, dotColor: 'bg-danger-500' },
    ],
    [statsSource.length, sentRemittances.length, receivedCount, disputedCount],
  );

  const handleRemittanceFetcherSuccess = useCallback(() => {
    // Mark the ID as processed so its action buttons are immediately disabled
    // even before the revalidation round-trip replaces the row data.
    if (markingId) {
      setProcessedIds((prev) => new Set([...prev, markingId]));
    }
    setPendingAction(null);
    setActionModalFieldError(null);
    setMarkingId(null);
  }, [markingId]);
  useCloseOnFetcherSuccess(fetcher, handleRemittanceFetcherSuccess);

  const openPendingActionModal = useCallback((row: TransferConfirmationRecord, mode: 'receive' | 'reject') => {
    setActionModalFieldError(null);
    setPendingAction({ row, mode });
  }, []);

  const handleMarkReceived = (remittance: TransferConfirmationRecord) => {
    const qty = quantityReceived[remittance.id] ?? String(remittance.quantitySent);
    const qtyNum = parseInt(qty, 10);
    if (Number.isNaN(qtyNum) || qtyNum < 0 || qtyNum > remittance.quantitySent) return;
    setMarkingId(remittance.id);
    const formData = new FormData();
    formData.set('intent', 'markTransferReceived');
    formData.set('transferId', remittance.id);
    formData.set('quantityReceived', String(qtyNum));
    const reason = shrinkageReason[remittance.id]?.trim();
    if (reason) formData.set('shrinkageReason', reason);
    const notes = receiverNotes[remittance.id]?.trim();
    if (notes) formData.set('receiverNotes', notes);
    fetcher.submit(formData, { method: 'post' });
  };

  const handleMarkNotReceived = (remittance: TransferConfirmationRecord) => {
    const reason = shrinkageReason[remittance.id]?.trim() ?? '';
    if (reason.length < 10) return;
    setMarkingId(remittance.id);
    const formData = new FormData();
    formData.set('intent', 'markTransferReceived');
    formData.set('transferId', remittance.id);
    formData.set('quantityReceived', '0');
    formData.set('shrinkageReason', reason);
    const notes = receiverNotes[remittance.id]?.trim();
    if (notes) formData.set('receiverNotes', notes);
    fetcher.submit(formData, { method: 'post' });
  };

  const submitPendingActionModal = () => {
    if (!pendingAction) return;
    const { row: r, mode } = pendingAction;
    if (mode === 'receive') {
      const qty = quantityReceived[r.id] ?? String(r.quantitySent);
      const qtyNum = parseInt(qty, 10);
      if (Number.isNaN(qtyNum) || qtyNum < 0 || qtyNum > r.quantitySent) {
        setActionModalFieldError(`Enter a quantity between 0 and ${r.quantitySent}.`);
        return;
      }
      setActionModalFieldError(null);
      handleMarkReceived(r);
      return;
    }
    const reason = shrinkageReason[r.id]?.trim() ?? '';
    if (reason.length < 10) {
      setActionModalFieldError('Dispute reason must be at least 10 characters.');
      return;
    }
    setActionModalFieldError(null);
    handleMarkNotReceived(r);
  };

  // ── Bulk receive — calls the tRPC endpoint directly for each selected transfer ──
  const handleBulkReceive = useCallback(async () => {
    const targets = pendingRemittances.filter((r) => selectedIds.has(r.id));
    if (targets.length === 0) return;
    // Validate all rows before starting
    for (const t of targets) {
      const qty = quantityReceived[t.id] ?? String(t.quantitySent);
      const qtyNum = parseInt(qty, 10);
      if (Number.isNaN(qtyNum) || qtyNum < 0 || qtyNum > t.quantitySent) {
        setBulkFieldError(`${t.productName}: quantity must be 0–${t.quantitySent}`);
        return;
      }
    }
    setBulkFieldError(null);
    setBulkProgress({ done: 0, total: targets.length, errors: [] });
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      const qty = quantityReceived[t.id] ?? String(t.quantitySent);
      const qtyNum = parseInt(qty, 10);
      const body: Record<string, unknown> = {
        transferId: t.id,
        quantityReceived: qtyNum,
      };
      const reason = shrinkageReason[t.id]?.trim();
      if (reason) body.shrinkageReason = reason;
      const notes = receiverNotes[t.id]?.trim();
      if (notes) body.receiverNotes = notes;
      try {
        const res = await fetch('/trpc/inventory.verifyTransfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        });
        const json = await res.json();
        // tRPC wraps errors in result.error or returns { result: { data: ... } }
        const errMsg =
          json?.error?.message ??
          json?.result?.error?.message ??
          (json?.error && typeof json.error === 'string' ? json.error : null);
        if (errMsg) errors.push(`${t.productName}: ${errMsg}`);
        else if (!res.ok) errors.push(`${t.productName}: Server error (${res.status})`);
      } catch (err) {
        errors.push(`${t.productName}: ${err instanceof Error ? err.message : 'Network error'}`);
      }
      setBulkProgress({ done: i + 1, total: targets.length, errors: [...errors] });
    }
    if (errors.length === 0) {
      setBulkConfirmModalOpen(false);
      setBulkProgress(null);
      setSelectedIds(new Set());
      revalidator.revalidate();
    }
  }, [pendingRemittances, selectedIds, quantityReceived, shrinkageReason, receiverNotes, revalidator]);
  const [bulkFieldError, setBulkFieldError] = useState<string | null>(null);

  const setFilterParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim().length === 0) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  };

  const buildStatusHref = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim().length === 0) next.delete('status');
    else next.set('status', value);
    const qs = next.toString();
    return qs ? `?${qs}` : '?';
  };

  const clearAllFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.delete('locationId');
    next.delete('search');
    next.delete('sender');
    next.delete('minQty');
    next.delete('maxQty');
    next.delete('startDate');
    next.delete('endDate');
    next.delete('period');
    setSearchParams(next);
  };

  const unifiedColumnsWithActions = useMemo((): CompactTableColumn<TransferConfirmationRecord>[] => {
    return [
      {
        key: 'product',
        header: 'Product',
        render: (r) => <span className="text-app-fg">{r.productName}</span>,
      },
      {
        key: 'route',
        header: 'From → To',
        minWidth: 'min-w-[200px]',
        render: (r) => (
          <span
            className="text-app-fg-muted truncate block max-w-[18rem]"
            title={`${formatLocationWithProvider(r.fromLocationName, r.fromProviderName)} → ${formatLocationWithProvider(r.toLocationName, r.toProviderName)}`}
          >
            {r.fromLocationName} → {r.toLocationName}
          </span>
        ),
      },
      {
        key: 'sender',
        header: 'Sent by',
        render: (r) => <span className="text-app-fg-muted">{r.senderName ?? 'Unknown user'}</span>,
      },
      {
        key: 'qty',
        header: 'Qty',
        align: 'right',
        nowrap: true,
        render: (r) => (
          <span className="tabular-nums" title={isPendingTransfer(r) ? 'Quantity sent' : 'Quantity received'}>
            {isPendingTransfer(r) ? r.quantitySent : (r.outcomeQuantity ?? r.quantityReceived ?? '—')}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        nowrap: true,
        render: (r) => (
          <StatusBadge
            status={
              isPendingTransfer(r)
                ? r.transferStatus
                : r.outcomeStatus === 'APPROVED'
                  ? 'RECEIVED'
                  : (r.outcomeStatus ?? r.transferStatus)
            }
          />
        ),
      },
      {
        key: 'created',
        header: 'Created',
        nowrap: true,
        render: (r) => (
          <span className="text-app-fg-muted">{new Date(r.createdAt).toLocaleString()}</span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        minWidth: 'min-w-[200px]',
        render: (r) => {
          const isBusy = markingId === r.id || fetcher.state === 'submitting';
          const justProcessed = processedIds.has(r.id);
          if (isPendingTransfer(r) && !justProcessed) {
            return (
              <div className="inline-flex flex-nowrap items-center justify-end gap-1.5">
                <TableActionButton
                  variant="danger"
                  disabled={isBusy}
                  onClick={() => openPendingActionModal(r, 'reject')}
                >
                  Not received
                </TableActionButton>
                <TableActionButton
                  variant="primary"
                  disabled={isBusy}
                  onClick={() => openPendingActionModal(r, 'receive')}
                >
                  Receive
                </TableActionButton>
              </div>
            );
          }
          return (
            <div className="inline-flex items-center justify-end">
              {justProcessed ? (
                <StatusBadge status="RECEIVED" />
              ) : (
                <TableActionButton variant="primary" onClick={() => setViewTarget(r)}>
                  View
                </TableActionButton>
              )}
            </div>
          );
        },
      },
    ];
  }, [markingId, fetcher.state, openPendingActionModal, processedIds]);

  const emptyDescription = useMemo(() => {
    if (statusValue === 'IN_TRANSIT') {
      return 'All in-transit transfers have been processed.';
    }
    if (statusValue === 'RECEIVED' || statusValue === 'DISPUTED') {
      return 'No records match this status.';
    }
    return 'No stock transfers match your filters. Try clearing filters or changing the date range.';
  }, [statusValue]);

  const hasNonSearchFilters = !!(statusValue || filters.locationId || filters.sender || filters.minQty || filters.maxQty);

  const mobileFilterBoxClass =
    'flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5';
  const mobileFilterSelectClass = '!bg-transparent !border-transparent !text-center';

  const mobileFiltersBody = (
    <div className="space-y-2">
      <div className={mobileFilterBoxClass}>
        <FormSelect
          id="remit-filter-status-mobile"
          value={statusValue}
          onChange={(e) => setFilterParam('status', e.target.value)}
          options={statusPillOptions.map((o) => ({
            value: o.value,
            label: `${o.label} (${o.count ?? 0})`,
          }))}
          controlSize="sm"
          openAs="modal"
          wrapperClassName="w-full"
          className={mobileFilterSelectClass}
        />
      </div>
      <SearchableSelect
        id="remit-filter-location-mobile"
        placeholder="All locations"
        value={filters.locationId}
        onChange={(v) => setFilterParam('locationId', v)}
        options={[
          { value: '', label: 'All locations' },
          ...locations.map((loc) => ({
            value: loc.id,
            label: loc.providerName ? `${loc.name} • ${loc.providerName}` : loc.name,
          })),
        ]}
        controlSize="sm"
        wrapperClassName="w-full"
      />
      <SearchableSelect
        id="remit-filter-sender-mobile"
        placeholder="All senders"
        value={filters.sender}
        onChange={(v) => setFilterParam('sender', v)}
        options={[
          { value: '', label: 'All senders' },
          ...senderOptions.map((name) => ({ value: name, label: name })),
        ]}
        controlSize="sm"
        wrapperClassName="w-full"
      />
      <div className="grid grid-cols-2 gap-2">
        <div className={mobileFilterBoxClass}>
          <NumberInput
            min={0}
            controlSize="sm"
            allowEmpty
            wrapperClassName="w-full"
            placeholder="Min qty"
            value={filters.minQty === '' ? null : Number(filters.minQty)}
            onValueChange={(n) => setFilterParam('minQty', String(n))}
            onValueCleared={() => setFilterParam('minQty', '')}
          />
        </div>
        <div className={mobileFilterBoxClass}>
          <NumberInput
            min={0}
            controlSize="sm"
            allowEmpty
            wrapperClassName="w-full"
            placeholder="Max qty"
            value={filters.maxQty === '' ? null : Number(filters.maxQty)}
            onValueChange={(n) => setFilterParam('maxQty', String(n))}
            onValueCleared={() => setFilterParam('maxQty', '')}
          />
        </div>
      </div>
      {hasNonSearchFilters && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-12 w-full justify-center"
          onClick={clearAllFilters}
        >
          Clear all filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Transfer Confirmations"
        mobileInlineActions
        description="Confirm incoming stock transfers."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Transfer confirmation tools"
            sheetSubtitle={<span>Date range and filters</span>}
            triggerAriaLabel="Transfer confirmation toolbar"
            filters={mobileFiltersBody}
            filtersBadgeCount={hasNonSearchFilters ? 1 : 0}
            sheetCloseLabel="Done"
            desktop={
              <div className="flex items-center gap-2">
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
                <PageRefreshButton />
              </div>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total transfers', value: statsSource.length, valueClassName: 'text-app-fg' },
          { label: 'Pending', value: sentRemittances.length, valueClassName: 'text-warning-600 dark:text-warning-400', to: buildStatusHref('IN_TRANSIT') },
          { label: 'Received', value: receivedCount, valueClassName: 'text-success-600 dark:text-success-400', to: buildStatusHref('RECEIVED') },
          { label: 'Disputed', value: disputedCount, valueClassName: 'text-danger-600 dark:text-danger-400', to: buildStatusHref('DISPUTED') },
          { label: 'Qty sent', value: totalQuantitySent, valueClassName: 'text-app-fg' },
          { label: 'Qty received', value: totalQuantityReceived, valueClassName: 'text-brand-600 dark:text-brand-400' },
        ]}
      />

      {/* Search — mobile only; on desktop it sits inline in the filter bar below. */}
      <form
        className="w-full md:hidden"
        onSubmit={(e) => {
          e.preventDefault();
          setFilterParam('search', searchDraft);
        }}
      >
        <SearchInput
          controlSize="sm"
          wrapperClassName="w-full"
          placeholder="Search by ID or product"
          value={searchDraft}
          onChange={(value) => {
            setSearchDraft(value);
            if (value === '') setFilterParam('search', '');
          }}
          withSubmitButton
        />
      </form>

      {/* Desktop-only filter bar — search + filters on one line. On mobile these
          live in the PageHeaderMobileTools sheet (search renders separately above). */}
      <div className="hidden md:block card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="w-64"
            onSubmit={(e) => {
              e.preventDefault();
              setFilterParam('search', searchDraft);
            }}
          >
            <SearchInput
              controlSize="sm"
              wrapperClassName="w-full"
              placeholder="Search by ID or product"
              value={searchDraft}
              onChange={(value) => {
                setSearchDraft(value);
                if (value === '') setFilterParam('search', '');
              }}
              withSubmitButton
            />
          </form>
          <FormSelect
            controlSize="sm"
            wrapperClassName="w-44"
            value={statusValue}
            onChange={(e) => setFilterParam('status', e.target.value)}
            options={statusPillOptions.map((o) => ({
              value: o.value,
              label: `${o.label} (${o.count ?? 0})`,
            }))}
          />
          <SearchableSelect
            controlSize="sm"
            wrapperClassName="w-52"
            placeholder="All locations"
            value={filters.locationId}
            onChange={(v) => setFilterParam('locationId', v)}
            options={[
              { value: '', label: 'All locations' },
              ...locations.map((loc) => ({
                value: loc.id,
                label: loc.providerName ? `${loc.name} • ${loc.providerName}` : loc.name,
              })),
            ]}
          />
          <SearchableSelect
            controlSize="sm"
            wrapperClassName="w-48"
            placeholder="All senders"
            value={filters.sender}
            onChange={(v) => setFilterParam('sender', v)}
            options={[
              { value: '', label: 'All senders' },
              ...senderOptions.map((name) => ({ value: name, label: name })),
            ]}
          />
          <NumberInput
            min={0}
            controlSize="sm"
            allowEmpty
            wrapperClassName="w-28"
            placeholder="Min qty"
            value={filters.minQty === '' ? null : Number(filters.minQty)}
            onValueChange={(n) => setFilterParam('minQty', String(n))}
            onValueCleared={() => setFilterParam('minQty', '')}
          />
          <NumberInput
            min={0}
            controlSize="sm"
            allowEmpty
            wrapperClassName="w-28"
            placeholder="Max qty"
            value={filters.maxQty === '' ? null : Number(filters.maxQty)}
            onValueChange={(n) => setFilterParam('maxQty', String(n))}
            onValueCleared={() => setFilterParam('maxQty', '')}
          />
          <Button type="button" variant="secondary" size="sm" onClick={clearAllFilters}>
            Clear all filters
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedPendingCount > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-lg border border-brand-200 dark:border-brand-700/50 bg-brand-50 dark:bg-brand-900/20 px-4 py-2.5">
          <p className="text-sm font-medium text-brand-800 dark:text-brand-200 sm:flex-1">
            {selectedPendingCount} pending transfer{selectedPendingCount !== 1 ? 's' : ''} selected
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={() => setBulkConfirmModalOpen(true)}
            >
              Receive all
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[16rem]">
      {/* Single table: pending rows get Receive / Not received; completed rows get View. */}
      {remittances.length === 0 ? (
        <EmptyState title="No transfers found" description={emptyDescription} variant="inline" />
      ) : (
        <CompactTable<TransferConfirmationRecord>
          columns={unifiedColumnsWithActions}
          rows={pagedRemittances}
          rowKey={(r) => r.id}
          rowClassName={(r) =>
            [
              markingId === r.id ? 'opacity-60' : '',
              selectedIds.has(r.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : '',
            ].filter(Boolean).join(' ')
          }
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
              if (selectAll) {
                setSelectedIds(new Set(pagedRemittances.filter((r) => isPendingTransfer(r)).map((r) => r.id)));
              } else {
                setSelectedIds(new Set());
              }
            },
            isSelectable: (r) => isPendingTransfer(r),
          }}
          pagination={
            remittances.length > 0
              ? {
                  page: safeRemitPage,
                  totalPages: remitTotalPages,
                  onPageChange: setRemitPage,
                  summary: (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <p className="text-sm text-app-fg-muted">
                        Showing {(safeRemitPage - 1) * remitPageSize + 1}–
                        {Math.min(safeRemitPage * remitPageSize, remittances.length)} of{' '}
                        {remittances.length}
                      </p>
                      <select
                        className="rounded-md border border-app-border bg-app-elevated px-2 py-1 text-xs text-app-fg"
                        value={remitPageSize}
                        onChange={(e) => {
                          setRemitPageSize(Number(e.target.value));
                          setRemitPage(1);
                        }}
                      >
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <option key={n} value={n}>{n} per page</option>
                        ))}
                      </select>
                    </div>
                  ),
                  wrapperClassName:
                    'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-app-border px-4 py-3',
                  controlsClassName: 'sm:justify-end',
                }
              : undefined
          }
          renderMobileCard={(r, _i, helpers) => {
            const { rowSelection } = helpers;
            const justProcessed = processedIds.has(r.id);
            const pending = isPendingTransfer(r) && !justProcessed;
            const displayStatus = justProcessed
              ? 'RECEIVED'
              : pending
                ? r.transferStatus
                : r.outcomeStatus === 'APPROVED'
                  ? 'RECEIVED'
                  : (r.outcomeStatus ?? r.transferStatus);
            const qty = pending ? r.quantitySent : (r.outcomeQuantity ?? r.quantityReceived ?? 0);

            const body = (
              <>
                {/* Row 1: Product name + qty + status */}
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-app-fg">
                    {r.productName} <span className="text-app-fg-muted tabular-nums">×{qty}</span>
                  </span>
                  <StatusBadge status={displayStatus} />
                </div>
                {/* Row 2: Route + date */}
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-app-fg-muted">
                    {r.fromLocationName} → {r.toLocationName}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-app-fg-muted">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </>
            );

            const handleTap = () => {
              if (justProcessed) return;
              if (pending) {
                openPendingActionModal(r, 'receive');
              } else {
                setViewTarget(r);
              }
            };

            if (rowSelection && pending) {
              return (
                <div className="-mx-3 -my-2.5 flex items-stretch">
                  {/* Checkbox zone — tapping here only toggles the checkbox */}
                  <div
                    className="flex items-center px-2.5 border-r border-app-border/60 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowSelection}
                  </div>
                  {/* Card body — tapping here opens the modal */}
                  <button
                    type="button"
                    onClick={handleTap}
                    disabled={justProcessed}
                    className="flex-1 min-w-0 px-3 py-2.5 space-y-1.5 text-left disabled:opacity-60"
                  >
                    {body}
                  </button>
                </div>
              );
            }
            return (
              <button
                type="button"
                onClick={handleTap}
                disabled={justProcessed}
                className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left disabled:opacity-60"
              >
                {body}
              </button>
            );
          }}
        />
      )}
      </TableLoadingOverlay>

      {pendingAction && (
        <Modal
          open
          onClose={() => {
            if (fetcher.state === 'submitting' && markingId === pendingAction.row.id) return;
            setPendingAction(null);
            setActionModalFieldError(null);
          }}
          maxWidth="max-w-lg"
          role="dialog"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('markTransferReceived')} />
          {/* Header with close X */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <h3 className="text-lg font-semibold text-app-fg">
                {pendingAction.mode === 'reject' ? 'Mark as not received' : 'Mark transfer received'}
              </h3>
              <p className="text-sm text-app-fg-muted">
                {pendingAction.mode === 'reject'
                  ? 'Record a dispute when goods did not arrive as expected. A clear reason is required.'
                  : 'Enter how many units arrived. If fewer than sent, add a shrinkage reason.'}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg p-1.5 text-app-fg-muted hover:text-app-fg hover:bg-app-hover transition-colors"
              aria-label="Close"
              disabled={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
              onClick={() => {
                setPendingAction(null);
                setActionModalFieldError(null);
              }}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="rounded-lg border border-app-border bg-app-hover p-3 text-sm space-y-1.5">
            <p className="font-medium text-app-fg">{pendingAction.row.productName}</p>
            <p className="text-app-fg-muted">
              {formatLocationWithProvider(pendingAction.row.fromLocationName, pendingAction.row.fromProviderName)} →{' '}
              {formatLocationWithProvider(pendingAction.row.toLocationName, pendingAction.row.toProviderName)}
            </p>
            <p className="text-app-fg-muted">
              Qty sent: <span className="tabular-nums font-medium text-app-fg">{pendingAction.row.quantitySent}</span>
              {' · '}
              Sent by {pendingAction.row.senderName ?? 'Unknown user'}
            </p>
          </div>

          <div className="space-y-3">
            {pendingAction.mode === 'receive' ? (
              <>
                <TextInput
                  label="Qty received"
                  type="number"
                  min={0}
                  max={pendingAction.row.quantitySent}
                  value={quantityReceived[pendingAction.row.id] ?? String(pendingAction.row.quantitySent)}
                  onChange={(e) => {
                    setActionModalFieldError(null);
                    setQuantityReceived((prev) => ({ ...prev, [pendingAction.row.id]: e.target.value }));
                  }}
                  disabled={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
                />
                <TextInput
                  label="Shrinkage reason (if short)"
                  type="text"
                  placeholder="Optional — required if count is below sent qty"
                  value={shrinkageReason[pendingAction.row.id] ?? ''}
                  onChange={(e) => {
                    setActionModalFieldError(null);
                    setShrinkageReason((prev) => ({ ...prev, [pendingAction.row.id]: e.target.value }));
                  }}
                  disabled={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
                />
              </>
            ) : (
              <TextInput
                label="Reason for dispute"
                type="text"
                placeholder="Minimum 10 characters"
                value={shrinkageReason[pendingAction.row.id] ?? ''}
                onChange={(e) => {
                  setActionModalFieldError(null);
                  setShrinkageReason((prev) => ({ ...prev, [pendingAction.row.id]: e.target.value }));
                }}
                disabled={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
              />
            )}
            <Textarea
              label="Comments"
              placeholder="Optional notes from the receiver…"
              rows={3}
              value={receiverNotes[pendingAction.row.id] ?? ''}
              onChange={(e) => {
                setActionModalFieldError(null);
                setReceiverNotes((prev) => ({ ...prev, [pendingAction.row.id]: e.target.value }));
              }}
              disabled={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
              maxLength={500}
            />
          </div>

          {actionModalFieldError ? (
            <p className="text-sm text-danger-600 dark:text-danger-400" role="alert">
              {actionModalFieldError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            {pendingAction.mode === 'receive' ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
                onClick={() => {
                  setActionModalFieldError(null);
                  setPendingAction({ row: pendingAction.row, mode: 'reject' });
                }}
              >
                Not received
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
                onClick={() => {
                  setActionModalFieldError(null);
                  setPendingAction({ row: pendingAction.row, mode: 'receive' });
                }}
              >
                Back to receive
              </Button>
            )}
            <Button
              type="button"
              variant={pendingAction.mode === 'reject' ? 'danger' : 'primary'}
              size="sm"
              onClick={submitPendingActionModal}
              loading={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
              loadingText="Saving..."
            >
              {pendingAction.mode === 'reject' ? 'Confirm not received' : 'Confirm received'}
            </Button>
          </div>
        </Modal>
      )}

      {viewTarget && (
        <Modal
          open
          onClose={() => setViewTarget(null)}
          maxWidth="max-w-lg"
          role="dialog"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-app-fg">Transfer record</h3>
            <p className="text-sm text-app-fg-muted">
              Full details for this stock transfer confirmation.
            </p>
          </div>

          <div className="rounded-lg border border-app-border bg-app-hover p-3 text-sm space-y-2">
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Transfer ID</p>
              <p className="font-mono text-app-fg break-all">{viewTarget.id}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Product</p>
              <p className="text-app-fg">{viewTarget.productName}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">From → To</p>
              <p className="text-app-fg">
                {formatLocationWithProvider(viewTarget.fromLocationName, viewTarget.fromProviderName)} →{' '}
                {formatLocationWithProvider(viewTarget.toLocationName, viewTarget.toProviderName)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Qty sent</p>
                <p className="tabular-nums text-app-fg">{viewTarget.quantitySent}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Qty received</p>
                <p className="tabular-nums text-app-fg">
                  {viewTarget.outcomeQuantity ?? viewTarget.quantityReceived ?? '—'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Status</p>
                <div className="mt-0.5">
                  <StatusBadge status={viewTarget.outcomeStatus ?? viewTarget.transferStatus} />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Sent by</p>
                <p className="text-app-fg">{viewTarget.senderName ?? 'Unknown user'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Created</p>
                <p className="text-app-fg">{new Date(viewTarget.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Verified</p>
                <p className="text-app-fg">
                  {viewTarget.verifiedAt ? new Date(viewTarget.verifiedAt).toLocaleString() : '—'}
                </p>
              </div>
            </div>
            {viewTarget.receiverNotes ? (
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Receiver notes</p>
                <p className="text-app-fg whitespace-pre-line break-words">{viewTarget.receiverNotes}</p>
              </div>
            ) : null}
            {(viewTarget.outcomeReason ?? viewTarget.shrinkageReason) ? (
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold text-app-fg-muted">Shrinkage reason</p>
                <p className="text-warning-700 dark:text-warning-300 whitespace-pre-line break-words">
                  {viewTarget.outcomeReason ?? viewTarget.shrinkageReason}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setViewTarget(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {/* Bulk receive review modal */}
      {bulkConfirmModalOpen && (
        <Modal
          open
          onClose={() => {
            if (bulkProgress && bulkProgress.done < bulkProgress.total) return;
            setBulkConfirmModalOpen(false);
            setBulkProgress(null);
            setBulkFieldError(null);
          }}
          maxWidth="max-w-2xl"
          role="dialog"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-app-fg">Review &amp; receive transfers</h3>
            <p className="text-sm text-app-fg-muted">
              Review each transfer below. Adjust quantity and add notes where needed.
            </p>
          </div>

          {bulkProgress ? (
            <div className="space-y-3">
              <div className="w-full bg-surface-200 dark:bg-surface-700 rounded-full h-2">
                <div
                  className="bg-brand-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-sm text-app-fg-muted">
                {bulkProgress.done} of {bulkProgress.total} processed
                {bulkProgress.errors.length > 0 && (
                  <span className="text-danger-600 dark:text-danger-400">
                    {' '}· {bulkProgress.errors.length} error{bulkProgress.errors.length !== 1 ? 's' : ''}
                  </span>
                )}
              </p>
              {bulkProgress.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded border border-danger-200 dark:border-danger-700 bg-danger-50 dark:bg-danger-900/20 p-2 space-y-1">
                  {bulkProgress.errors.map((e, i) => (
                    <p key={i} className="text-xs text-danger-700 dark:text-danger-300">{e}</p>
                  ))}
                </div>
              )}
              {bulkProgress.done === bulkProgress.total && bulkProgress.errors.length > 0 && (
                <div className="flex justify-end pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setBulkConfirmModalOpen(false);
                      setBulkProgress(null);
                      setBulkFieldError(null);
                      setSelectedIds(new Set());
                      revalidator.revalidate();
                    }}
                  >
                    Close
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
                {pendingRemittances
                  .filter((r) => selectedIds.has(r.id))
                  .map((r) => {
                    const qtyVal = quantityReceived[r.id] ?? String(r.quantitySent);
                    const qtyNum = parseInt(qtyVal, 10);
                    const hasShrinkage = !Number.isNaN(qtyNum) && qtyNum < r.quantitySent;
                    return (
                      <div key={r.id} className="rounded-lg border border-app-border bg-app-hover p-3 space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-app-fg truncate">{r.productName}</p>
                            <p className="text-xs text-app-fg-muted">
                              {r.fromLocationName} → {r.toLocationName}
                              {r.senderName ? ` · ${r.senderName}` : ''}
                            </p>
                          </div>
                          <span className="shrink-0 tabular-nums text-sm text-app-fg-muted">
                            Sent: {r.quantitySent}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <TextInput
                            label="Qty received"
                            type="number"
                            min={0}
                            max={r.quantitySent}
                            value={qtyVal}
                            onChange={(e) => {
                              setBulkFieldError(null);
                              setQuantityReceived((prev) => ({ ...prev, [r.id]: e.target.value }));
                            }}
                          />
                          <TextInput
                            label={hasShrinkage ? 'Shrinkage reason (required)' : 'Shrinkage reason'}
                            type="text"
                            placeholder={hasShrinkage ? 'Required — why is it short?' : 'Optional'}
                            value={shrinkageReason[r.id] ?? ''}
                            onChange={(e) => {
                              setBulkFieldError(null);
                              setShrinkageReason((prev) => ({ ...prev, [r.id]: e.target.value }));
                            }}
                          />
                        </div>
                        <TextInput
                          label="Comments"
                          type="text"
                          placeholder="Optional notes…"
                          value={receiverNotes[r.id] ?? ''}
                          onChange={(e) =>
                            setReceiverNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                        />
                      </div>
                    );
                  })}
              </div>

              {bulkFieldError && (
                <p className="text-sm text-danger-600 dark:text-danger-400" role="alert">
                  {bulkFieldError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-app-border">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setBulkConfirmModalOpen(false);
                    setBulkFieldError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => void handleBulkReceive()}
                >
                  Receive {selectedPendingCount} transfer{selectedPendingCount !== 1 ? 's' : ''}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

    </div>
  );
}
