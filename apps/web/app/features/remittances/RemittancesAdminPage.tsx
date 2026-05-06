import { useCallback, useState, useMemo } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
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

const PROCESSED_TRANSFER_COLUMNS: CompactTableColumn<TransferConfirmationRecord>[] = [
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
    render: (r) => <span className="tabular-nums">{r.outcomeQuantity ?? r.quantityReceived ?? '—'}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => (
      <StatusBadge status={r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.transferStatus)} />
    ),
  },
  {
    key: 'comments',
    header: 'Comments',
    minWidth: 'min-w-[200px]',
    render: (r) =>
      r.receiverNotes || r.shrinkageReason ? (
        <div className="space-y-0.5 max-w-[260px] text-sm text-app-fg-muted">
          {r.receiverNotes ? (
            <p className="text-app-fg whitespace-pre-line break-words">{r.receiverNotes}</p>
          ) : null}
          {(r.outcomeReason ?? r.shrinkageReason) ? (
            <p className="text-xs text-warning-600 dark:text-warning-400">
              Shrinkage: {r.outcomeReason ?? r.shrinkageReason}
            </p>
          ) : null}
        </div>
      ) : (
        <span className="text-app-fg-muted">—</span>
      ),
  },
  {
    key: 'sent',
    header: 'Sent',
    nowrap: true,
    render: (r) => <span className="text-app-fg-muted">{new Date(r.createdAt).toLocaleDateString()}</span>,
  },
];

const PENDING_TRANSFER_COLUMNS: CompactTableColumn<TransferConfirmationRecord>[] = [
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
    key: 'qtySent',
    header: 'Qty sent',
    align: 'right',
    nowrap: true,
    render: (r) => <span className="tabular-nums">{r.quantitySent}</span>,
  },
  {
    key: 'sender',
    header: 'Sent by',
    render: (r) => <span className="text-app-fg-muted">{r.senderName ?? 'Unknown user'}</span>,
  },
  {
    key: 'created',
    header: 'Created',
    nowrap: true,
    render: (r) => <span className="text-app-fg-muted">{new Date(r.createdAt).toLocaleString()}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    nowrap: true,
    render: (r) => <StatusBadge status={r.transferStatus} />,
  },
];

export function RemittancesAdminPage({ remittances, locations, senderOptions, filters }: RemittancesAdminPageProps) {
  const fetcher = useFetcher();
  const isLoaderRefetchBusy = useLoaderRefetchBusy();
  const [searchParams, setSearchParams] = useSearchParams();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [quantityReceived, setQuantityReceived] = useState<Record<string, string>>({});
  const [shrinkageReason, setShrinkageReason] = useState<Record<string, string>>({});
  const [receiverNotes, setReceiverNotes] = useState<Record<string, string>>({});
  const [confirmTarget, setConfirmTarget] = useState<TransferConfirmationRecord | null>(null);
  const [confirmMode, setConfirmMode] = useState<'receive' | 'reject'>('receive');
  const [viewTarget, setViewTarget] = useState<TransferConfirmationRecord | null>(null);

  useFetcherToast(fetcher.data, { successMessage: 'Transfer recorded' });

  const sentRemittances = remittances.filter((r) => r.transferStatus === 'IN_TRANSIT');
  const receivedOrDisputed = remittances.filter(
    (r) => r.outcomeStatus === 'APPROVED' || r.outcomeStatus === 'DISPUTED',
  );
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
    setConfirmTarget(null);
    setMarkingId(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleRemittanceFetcherSuccess);

  const openConfirm = useCallback((mode: 'receive' | 'reject', remittance: TransferConfirmationRecord) => {
    setConfirmMode(mode);
    setConfirmTarget(remittance);
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

  const processedColumnsWithActions = useMemo((): CompactTableColumn<TransferConfirmationRecord>[] => {
    return [
      ...PROCESSED_TRANSFER_COLUMNS,
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        render: (r) => (
          <div className="inline-flex items-center justify-end">
            <TableActionButton variant="primary" onClick={() => setViewTarget(r)}>
              View
            </TableActionButton>
          </div>
        ),
      },
    ];
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Transfer Confirmations"
        description="Confirm in-transit stock transfers when goods arrive at the destination. No receipt upload required."
        actions={<PageRefreshButton />}
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
          <SearchInput
            controlSize="sm"
            wrapperClassName="w-full sm:w-64"
            placeholder="Search by ID or product"
            value={filters.search}
            onChange={(value) => setFilterParam('search', value)}
            debounceMs={250}
          />
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
          <TextInput
            type="number"
            min={0}
            controlSize="sm"
            wrapperClassName="w-full sm:w-28"
            placeholder="Min qty"
            value={filters.minQty}
            onChange={(e) => setFilterParam('minQty', e.target.value)}
          />
          <TextInput
            type="number"
            min={0}
            controlSize="sm"
            wrapperClassName="w-full sm:w-28"
            placeholder="Max qty"
            value={filters.maxQty}
            onChange={(e) => setFilterParam('maxQty', e.target.value)}
          />
          <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0">
            <DateFilterBar
              startDate={filters.startDate}
              endDate={filters.endDate}
              periodAllTime={filters.periodAllTime}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={clearAllFilters}>
            Clear all filters
          </Button>
        </div>
      </div>

      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[16rem]">
      {/* Pending list — visible on All / Pending. Table-first: summary row + receive form sub-row. */}
      {(statusValue === '' || statusValue === 'IN_TRANSIT') && sentRemittances.length > 0 && (
        <CompactTable<TransferConfirmationRecord>
          columns={PENDING_TRANSFER_COLUMNS}
          rows={sentRemittances}
          rowKey={(r) => r.id}
          renderRowDetail={(r) => {
            const isBusy = markingId === r.id || fetcher.state === 'submitting';
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <TextInput
                    label="Qty received"
                    type="number"
                    min={0}
                    max={r.quantitySent}
                    value={quantityReceived[r.id] ?? String(r.quantitySent)}
                    onChange={(e) => setQuantityReceived((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    disabled={isBusy}
                  />
                  <TextInput
                    label="Shrinkage reason (if short)"
                    type="text"
                    placeholder="Optional"
                    value={shrinkageReason[r.id] ?? ''}
                    onChange={(e) => setShrinkageReason((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    disabled={isBusy}
                  />
                  <Textarea
                    label="Comments"
                    placeholder="Optional notes from the receiver…"
                    rows={2}
                    value={receiverNotes[r.id] ?? ''}
                    onChange={(e) => setReceiverNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    disabled={isBusy}
                    maxLength={500}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => openConfirm('reject', r)}
                    loading={isBusy}
                    loadingText="Saving..."
                  >
                    Not received
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => openConfirm('receive', r)}
                    loading={isBusy}
                    loadingText="Saving..."
                  >
                    Mark received
                  </Button>
                </div>
              </div>
            );
          }}
          renderMobileCard={(r) => {
            const isBusy = markingId === r.id || fetcher.state === 'submitting';
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

                <div className="grid grid-cols-1 gap-2">
                  <TextInput
                    label="Qty received"
                    type="number"
                    min={0}
                    max={r.quantitySent}
                    value={quantityReceived[r.id] ?? String(r.quantitySent)}
                    onChange={(e) => setQuantityReceived((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    disabled={isBusy}
                  />
                  <TextInput
                    label="Shrinkage reason (if short)"
                    type="text"
                    placeholder="Optional"
                    value={shrinkageReason[r.id] ?? ''}
                    onChange={(e) => setShrinkageReason((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    disabled={isBusy}
                  />
                  <Textarea
                    label="Comments"
                    placeholder="Optional notes from the receiver…"
                    rows={2}
                    value={receiverNotes[r.id] ?? ''}
                    onChange={(e) => setReceiverNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    disabled={isBusy}
                    maxLength={500}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => openConfirm('reject', r)}
                    loading={isBusy}
                    loadingText="Saving..."
                  >
                    Not received
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => openConfirm('receive', r)}
                    loading={isBusy}
                    loadingText="Saving..."
                  >
                    Mark received
                  </Button>
                </div>
              </div>
            );
          }}
        />
      )}

      {(statusValue === '' || statusValue === 'IN_TRANSIT') && sentRemittances.length === 0 && (
        <EmptyState
          title="No pending transfers"
          description="All in-transit stock transfers have been processed."
          variant="inline"
        />
      )}

      {/* Processed list (Received / Disputed) — visible on All / Received / Disputed. */}
      {(statusValue === '' || statusValue === 'RECEIVED' || statusValue === 'DISPUTED') &&
        receivedOrDisputed.length > 0 && (
        <CompactTable<TransferConfirmationRecord>
          columns={processedColumnsWithActions}
          rows={receivedOrDisputed}
          rowKey={(r) => r.id}
        />
      )}

      {(statusValue === 'RECEIVED' || statusValue === 'DISPUTED') && receivedOrDisputed.length === 0 && (
        <EmptyState
          title="No processed transfers yet"
          description="Received or disputed stock transfers will appear here."
          variant="inline"
        />
      )}
      </TableLoadingOverlay>

      {confirmTarget && (
        <Modal
          open
          onClose={() => setConfirmTarget(null)}
          maxWidth="max-w-md"
          role="dialog"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <h3 className="text-lg font-semibold text-app-fg">
            {confirmMode === 'reject' ? 'Confirm not received' : 'Confirm mark received'}
          </h3>
          <p className="text-sm text-app-fg-muted">
            {confirmMode === 'reject'
              ? 'You are about to mark this transfer as not received (disputed).'
              : 'You are about to confirm this transfer as received.'}
          </p>
          <div className="rounded-lg border border-app-border bg-app-hover p-3 text-sm space-y-1.5">
            <p className="font-medium text-app-fg">{confirmTarget.productName}</p>
            <p className="text-app-fg-muted">
              {formatLocationWithProvider(confirmTarget.fromLocationName, confirmTarget.fromProviderName)} → {formatLocationWithProvider(confirmTarget.toLocationName, confirmTarget.toProviderName)}
            </p>
            <p className="text-app-fg-muted">
              Quantity sent: {confirmTarget.quantitySent}
            </p>
            <p className="text-app-fg-muted">
              Quantity to mark as received:{' '}
              <span className="font-medium text-app-fg">
                {confirmMode === 'reject' ? '0' : (quantityReceived[confirmTarget.id] ?? confirmTarget.quantitySent)}
              </span>
            </p>
            {confirmMode === 'reject' && (
              <p className="text-app-fg-muted">
                Provide reason (min 10 chars):
                <span className="font-medium text-app-fg"> required</span>
              </p>
            )}
            {(shrinkageReason[confirmTarget.id] ?? '').trim() && (
              <p className="text-app-fg-muted">
                Shrinkage reason: {(shrinkageReason[confirmTarget.id] ?? '').trim()}
              </p>
            )}
            {(receiverNotes[confirmTarget.id] ?? '').trim() && (
              <div className="text-app-fg-muted">
                <p className="text-xs uppercase tracking-wide font-semibold mb-0.5">Comments</p>
                <p className="text-app-fg whitespace-pre-line break-words">
                  {(receiverNotes[confirmTarget.id] ?? '').trim()}
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmTarget(null)}
              disabled={fetcher.state === 'submitting' && markingId === confirmTarget.id}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirmMode === 'reject' ? 'danger' : 'primary'}
              size="sm"
              onClick={() => {
                if (confirmMode === 'reject') {
                  handleMarkNotReceived(confirmTarget);
                  return;
                }
                handleMarkReceived(confirmTarget);
              }}
              disabled={
                confirmMode === 'reject' && (shrinkageReason[confirmTarget.id]?.trim().length ?? 0) < 10
              }
              loading={fetcher.state === 'submitting' && markingId === confirmTarget.id}
              loadingText="Saving..."
            >
              {confirmMode === 'reject' ? 'Confirm not received' : 'Confirm mark received'}
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
