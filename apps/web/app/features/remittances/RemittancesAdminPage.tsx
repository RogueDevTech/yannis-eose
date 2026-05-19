import { useCallback, useEffect, useState, useMemo } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
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
import { SearchInput } from '~/components/ui/search-input';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { FilterPills, type FilterPillOption } from '~/components/ui/filter-pills';
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

export function RemittancesAdminPage({ remittances, locations, senderOptions, filters }: RemittancesAdminPageProps) {
  const fetcher = useFetcher();
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

  const [searchDraft, setSearchDraft] = useState(filters.search);
  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  useFetcherToast(fetcher.data, {
    successMessage: 'Transfer recorded',
    skipErrorToast: !!pendingAction,
  });

  // Client-side pagination — backend doesn't paginate transfer remittances yet.
  const REMITTANCES_PAGE_SIZE = 20;
  const [remitPage, setRemitPage] = useState(1);
  const remitTotalPages = Math.max(1, Math.ceil(remittances.length / REMITTANCES_PAGE_SIZE));
  const safeRemitPage = Math.min(remitPage, remitTotalPages);
  const pagedRemittances = useMemo(
    () =>
      remittances.slice(
        (safeRemitPage - 1) * REMITTANCES_PAGE_SIZE,
        safeRemitPage * REMITTANCES_PAGE_SIZE,
      ),
    [remittances, safeRemitPage],
  );
  useEffect(() => {
    if (remitPage > remitTotalPages) setRemitPage(1);
  }, [remitPage, remitTotalPages]);
  useEffect(() => {
    setRemitPage(1);
  }, [remittances.length]);

  const sentRemittances = remittances.filter((r) => r.transferStatus === 'IN_TRANSIT');
  const receivedCount = remittances.filter((r) => r.outcomeStatus === 'APPROVED').length;
  const disputedCount = remittances.filter((r) => r.outcomeStatus === 'DISPUTED').length;
  const totalQuantitySent = remittances.reduce((sum, r) => sum + r.quantitySent, 0);
  const totalQuantityReceived = remittances.reduce((sum, r) => {
    if (r.outcomeStatus === 'APPROVED') return sum + (r.outcomeQuantity ?? 0);
    return sum;
  }, 0);

  // Status filter pills — single source of truth for which list is shown. Drives the
  // URL `status` param so the loader can scope server-side filtering on next load.
  const statusValue = filters.status; // '' | IN_TRANSIT | RECEIVED | DISPUTED
  const statusPillOptions: FilterPillOption[] = useMemo(
    () => [
      { value: '', label: 'All', count: remittances.length },
      { value: 'IN_TRANSIT', label: 'Pending', count: sentRemittances.length, dotColor: 'bg-warning-500' },
      { value: 'RECEIVED', label: 'Received', count: receivedCount, dotColor: 'bg-success-500' },
      { value: 'DISPUTED', label: 'Disputed', count: disputedCount, dotColor: 'bg-danger-500' },
    ],
    [remittances.length, sentRemittances.length, receivedCount, disputedCount],
  );

  const handleRemittanceFetcherSuccess = useCallback(() => {
    setPendingAction(null);
    setActionModalFieldError(null);
    setMarkingId(null);
  }, []);
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

  const setFilterParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim().length === 0) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
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
          if (isPendingTransfer(r)) {
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
              <TableActionButton variant="primary" onClick={() => setViewTarget(r)}>
                View
              </TableActionButton>
            </div>
          );
        },
      },
    ];
  }, [markingId, fetcher.state, openPendingActionModal]);

  const emptyDescription = useMemo(() => {
    if (statusValue === 'IN_TRANSIT') {
      return 'All in-transit transfers have been processed.';
    }
    if (statusValue === 'RECEIVED' || statusValue === 'DISPUTED') {
      return 'No records match this status.';
    }
    return 'No stock transfers match your filters. Try clearing filters or changing the date range.';
  }, [statusValue]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Transfer Confirmations"
        mobileInlineActions
        description="Confirm incoming stock transfers."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Transfer confirmation tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Transfer confirmation toolbar"
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
            sheet={
              <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  triggerLayout="blockCenter"
                />
              </div>
            }
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Total transfers', value: remittances.length, valueClassName: 'text-app-fg' },
          { label: 'Pending', value: sentRemittances.length, valueClassName: 'text-warning-600 dark:text-warning-400' },
          { label: 'Received', value: receivedCount, valueClassName: 'text-success-600 dark:text-success-400' },
          { label: 'Disputed', value: disputedCount, valueClassName: 'text-danger-600 dark:text-danger-400' },
          { label: 'Qty sent', value: totalQuantitySent, valueClassName: 'text-app-fg' },
          { label: 'Qty received', value: totalQuantityReceived, valueClassName: 'text-brand-600 dark:text-brand-400' },
        ]}
      />

      {/* Status pills first — they're the primary segmentation. The FilterPills drive
          the URL `status` param and replace the previous "Pending receipt / Received-Disputed"
          tab pair plus the duplicate "All statuses" dropdown. */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills
            options={statusPillOptions}
            value={statusValue}
            onChange={(v) => setFilterParam('status', v)}
            size="sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="w-full sm:w-auto sm:min-w-[16rem]"
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
            wrapperClassName="w-full sm:w-52"
            value={filters.locationId}
            onChange={(e) => setFilterParam('locationId', e.target.value)}
            options={[
              { value: '', label: 'All locations' },
              ...locations.map((loc) => ({
                value: loc.id,
                label: loc.providerName ? `${loc.name} • ${loc.providerName}` : loc.name,
              })),
            ]}
          />
          <FormSelect
            controlSize="sm"
            wrapperClassName="w-full sm:w-48"
            value={filters.sender}
            onChange={(e) => setFilterParam('sender', e.target.value)}
            options={[
              { value: '', label: 'All senders' },
              ...senderOptions.map((name) => ({ value: name, label: name })),
            ]}
          />
          <NumberInput
            min={0}
            controlSize="sm"
            allowEmpty
            wrapperClassName="w-full sm:w-28"
            placeholder="Min qty"
            value={filters.minQty === '' ? null : Number(filters.minQty)}
            onValueChange={(n) => setFilterParam('minQty', String(n))}
            onValueCleared={() => setFilterParam('minQty', '')}
          />
          <NumberInput
            min={0}
            controlSize="sm"
            allowEmpty
            wrapperClassName="w-full sm:w-28"
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

      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[16rem]">
      {/* Single table: pending rows get Receive / Not received; completed rows get View. */}
      {remittances.length === 0 ? (
        <EmptyState title="No transfers found" description={emptyDescription} variant="inline" />
      ) : (
        <CompactTable<TransferConfirmationRecord>
          columns={unifiedColumnsWithActions}
          rows={pagedRemittances}
          rowKey={(r) => r.id}
          rowClassName={(r) => (markingId === r.id ? 'opacity-60' : '')}
          pagination={
            remittances.length > 0
              ? {
                  page: safeRemitPage,
                  totalPages: remitTotalPages,
                  onPageChange: setRemitPage,
                  summary: (
                    <p className="text-sm text-app-fg-muted">
                      Showing {(safeRemitPage - 1) * REMITTANCES_PAGE_SIZE + 1}–
                      {Math.min(safeRemitPage * REMITTANCES_PAGE_SIZE, remittances.length)} of{' '}
                      {remittances.length}
                      <span className="text-app-fg-muted/90"> · {REMITTANCES_PAGE_SIZE} per page</span>
                    </p>
                  ),
                  wrapperClassName:
                    'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-app-border px-4 py-3',
                  controlsClassName: 'sm:justify-end',
                }
              : undefined
          }
          renderMobileCard={(r) => {
            const isBusy = markingId === r.id || fetcher.state === 'submitting';
            if (isPendingTransfer(r)) {
              return (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-app-fg truncate">{r.productName}</p>
                      <p className="text-sm text-app-fg-muted">
                        {formatLocationWithProvider(r.fromLocationName, r.fromProviderName)} →{' '}
                        {formatLocationWithProvider(r.toLocationName, r.toProviderName)}
                      </p>
                      <p className="text-sm text-app-fg-muted">
                        Qty sent: <span className="tabular-nums">{r.quantitySent}</span> ·{' '}
                        {new Date(r.createdAt).toLocaleString()}
                      </p>
                      <p className="text-sm text-app-fg-muted">Sent by: {r.senderName ?? 'Unknown user'}</p>
                    </div>
                    <StatusBadge status={r.transferStatus} />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1.5">
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
                </div>
              );
            }
            return (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-app-fg truncate">{r.productName}</p>
                    <p className="text-sm text-app-fg-muted">
                      {formatLocationWithProvider(r.fromLocationName, r.fromProviderName)} →{' '}
                      {formatLocationWithProvider(r.toLocationName, r.toProviderName)}
                    </p>
                    <p className="text-sm text-app-fg-muted">
                      Qty:{' '}
                      <span className="tabular-nums">{r.outcomeQuantity ?? r.quantityReceived ?? '—'}</span>
                      {' · '}
                      {new Date(r.createdAt).toLocaleString()}
                    </p>
                    <p className="text-sm text-app-fg-muted">Sent by: {r.senderName ?? 'Unknown user'}</p>
                  </div>
                  <StatusBadge
                    status={
                      r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.transferStatus)
                    }
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end">
                  <TableActionButton variant="primary" onClick={() => setViewTarget(r)}>
                    View
                  </TableActionButton>
                </div>
              </div>
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
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-app-fg">
              {pendingAction.mode === 'reject' ? 'Mark as not received' : 'Mark transfer received'}
            </h3>
            <p className="text-sm text-app-fg-muted">
              {pendingAction.mode === 'reject'
                ? 'Record a dispute when goods did not arrive as expected. A clear reason is required.'
                : 'Enter how many units arrived. If fewer than sent, add a shrinkage reason.'}
            </p>
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

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setPendingAction(null);
                setActionModalFieldError(null);
              }}
              disabled={fetcher.state === 'submitting' && markingId === pendingAction.row.id}
            >
              Cancel
            </Button>
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

    </div>
  );
}
