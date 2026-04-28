import { useEffect, useState, useMemo } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { FilterPills, type FilterPillOption } from '~/components/ui/filter-pills';
import { Textarea } from '~/components/ui/textarea';

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
  locations: Array<{ id: string; name: string }>;
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

  useEffect(() => {
    if (fetcher.state === 'idle' && (fetcher.data as { success?: boolean } | undefined)?.success) {
      setConfirmTarget(null);
      setMarkingId(null);
    }
  }, [fetcher.state, fetcher.data]);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Transfer Confirmations"
        description="Confirm in-transit stock transfers when goods arrive at the destination. No receipt upload required."
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
              ...locations.map((loc) => ({ value: loc.id, label: loc.name })),
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
      {/* Pending list — visible on All / Pending. Each card carries the qty + comments
          form so receivers can confirm without leaving the page. */}
      {(statusValue === '' || statusValue === 'IN_TRANSIT') && sentRemittances.length > 0 && (
        <div className="space-y-4">
          {sentRemittances.map((r) => (
            <div key={r.id} className="card p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-app-fg">{r.productName}</p>
                  <p className="text-sm text-app-fg-muted">
                    From {r.fromLocationName} → {r.toLocationName}
                  </p>
                  <p className="text-sm text-app-fg-muted">
                    Quantity sent: {r.quantitySent} · Created {new Date(r.createdAt).toLocaleString()}
                  </p>
                  <p className="text-sm text-app-fg-muted">
                    Sent by: {r.senderName ?? 'Unknown user'}
                  </p>
                </div>
                <StatusBadge status={r.transferStatus} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <TextInput
                  label="Qty received"
                  type="number"
                  min={0}
                  max={r.quantitySent}
                  value={quantityReceived[r.id] ?? r.quantitySent}
                  onChange={(e) => setQuantityReceived((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  disabled={markingId === r.id}
                />
                <TextInput
                  label="Shrinkage reason (if short)"
                  type="text"
                  placeholder="Optional"
                  value={shrinkageReason[r.id] ?? ''}
                  onChange={(e) => setShrinkageReason((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  disabled={markingId === r.id}
                />
                <Textarea
                  label="Comments"
                  placeholder="Optional notes from the receiver…"
                  rows={2}
                  value={receiverNotes[r.id] ?? ''}
                  onChange={(e) => setReceiverNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  disabled={markingId === r.id}
                  maxLength={500}
                />
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setConfirmMode('reject');
                    setConfirmTarget(r);
                  }}
                  loading={markingId === r.id || fetcher.state === 'submitting'}
                  loadingText="Saving..."
                >
                  Not received
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setConfirmMode('receive');
                    setConfirmTarget(r);
                  }}
                  loading={markingId === r.id || fetcher.state === 'submitting'}
                  loadingText="Saving..."
                >
                  Mark received
                </Button>
              </div>
            </div>
          ))}
        </div>
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
        <div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Product</th>
                  <th className="table-header">From → To</th>
                  <th className="table-header">Sent by</th>
                  <th className="table-header text-right">Qty</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Comments</th>
                  <th className="table-header">Sent</th>
                </tr>
              </thead>
              <tbody>
                {receivedOrDisputed.map((r) => (
                  <tr key={r.id} className="table-row align-top">
                    <td className="table-cell text-app-fg">{r.productName}</td>
                    <td className="table-cell text-app-fg-muted">
                      {r.fromLocationName} → {r.toLocationName}
                    </td>
                    <td className="table-cell text-app-fg-muted">
                      {r.senderName ?? 'Unknown user'}
                    </td>
                    <td className="table-cell text-right">{r.outcomeQuantity ?? r.quantityReceived ?? '—'}</td>
                    <td className="table-cell">
                      <StatusBadge
                        status={r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.transferStatus)}
                      />
                    </td>
                    <td className="table-cell text-app-fg-muted text-sm">
                      {(r.receiverNotes || r.shrinkageReason) ? (
                        <div className="space-y-0.5 max-w-[260px]">
                          {r.receiverNotes && (
                            <p className="text-app-fg whitespace-pre-line break-words">
                              {r.receiverNotes}
                            </p>
                          )}
                          {(r.outcomeReason ?? r.shrinkageReason) && (
                            <p className="text-xs text-warning-600 dark:text-warning-400">
                              Shrinkage: {r.outcomeReason ?? r.shrinkageReason}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-app-fg-muted">—</span>
                      )}
                    </td>
                    <td className="table-cell text-app-fg-muted">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 px-1">
            {receivedOrDisputed.map((r) => (
              <div key={r.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-medium text-app-fg">{r.productName}</p>
                  <StatusBadge
                    status={r.outcomeStatus === 'APPROVED' ? 'RECEIVED' : (r.outcomeStatus ?? r.transferStatus)}
                  />
                </div>
                <div className="text-sm text-app-fg-muted space-y-0.5">
                  <div>From → To: {r.fromLocationName} → {r.toLocationName}</div>
                  <div>Sent by: {r.senderName ?? 'Unknown user'}</div>
                  <div>Qty: {r.outcomeQuantity ?? r.quantityReceived ?? '—'}</div>
                  <div>Created: {new Date(r.createdAt).toLocaleDateString()}</div>
                </div>
                {r.receiverNotes && (
                  <div className="text-sm rounded-md border border-app-border bg-app-hover p-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted mb-1">
                      Receiver comment
                    </p>
                    <p className="text-app-fg whitespace-pre-line break-words">{r.receiverNotes}</p>
                  </div>
                )}
                {(r.outcomeReason ?? r.shrinkageReason) && (
                  <p className="text-xs text-warning-600 dark:text-warning-400">
                    Shrinkage reason: {r.outcomeReason ?? r.shrinkageReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
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
              {confirmTarget.fromLocationName} → {confirmTarget.toLocationName}
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

    </div>
  );
}
