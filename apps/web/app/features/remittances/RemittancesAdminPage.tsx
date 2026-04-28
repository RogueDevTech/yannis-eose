import { useEffect, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
import { Tabs } from '~/components/ui/tabs';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { DateFilterBar } from '~/components/ui/date-filter-bar';

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
  senderName?: string | null;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'processed'>('pending');
  const [quantityReceived, setQuantityReceived] = useState<Record<string, string>>({});
  const [shrinkageReason, setShrinkageReason] = useState<Record<string, string>>({});
  const [confirmTarget, setConfirmTarget] = useState<TransferConfirmationRecord | null>(null);
  const [confirmMode, setConfirmMode] = useState<'receive' | 'reject'>('receive');

  useFetcherToast(fetcher.data, { successMessage: 'Transfer receipt recorded' });

  const sentRemittances = remittances.filter((r) => r.transferStatus === 'IN_TRANSIT');
  const receivedOrDisputed = remittances.filter((r) => r.transferStatus === 'RECEIVED' || r.transferStatus === 'DISPUTED');
  const receivedCount = remittances.filter((r) => r.transferStatus === 'RECEIVED').length;
  const disputedCount = remittances.filter((r) => r.transferStatus === 'DISPUTED').length;
  const totalQuantitySent = remittances.reduce((sum, r) => sum + r.quantitySent, 0);
  const totalQuantityReceived = remittances.reduce((sum, r) => sum + (r.quantityReceived ?? 0), 0);

  useEffect(() => {
    if (activeTab === 'pending' && sentRemittances.length === 0 && receivedOrDisputed.length > 0) {
      setActiveTab('processed');
    }
  }, [activeTab, sentRemittances.length, receivedOrDisputed.length]);

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

      <div className="card p-4 space-y-3">
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
            wrapperClassName="w-full sm:w-44"
            value={filters.status}
            onChange={(e) => setFilterParam('status', e.target.value)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'IN_TRANSIT', label: 'Pending receipt' },
              { value: 'RECEIVED', label: 'Received' },
              { value: 'DISPUTED', label: 'Disputed' },
            ]}
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

      <Tabs
        value={activeTab}
        onChange={(value) => setActiveTab(value as 'pending' | 'processed')}
        tabs={[
          { value: 'pending', label: `Pending receipt (${sentRemittances.length})` },
          { value: 'processed', label: 'Received / Disputed' },
        ]}
      />

      {activeTab === 'pending' && sentRemittances.length > 0 && (
        <div>
          <div className="space-y-4">
            {sentRemittances.map((r) => (
              <div
                key={r.id}
                className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4 flex-wrap"
              >
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
                <div className="flex items-end gap-2 flex-wrap">
                  <TextInput
                    label="Qty received"
                    type="number"
                    min={0}
                    max={r.quantitySent}
                    value={quantityReceived[r.id] ?? r.quantitySent}
                    onChange={(e) => setQuantityReceived((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    wrapperClassName="w-20"
                    disabled={markingId === r.id}
                  />
                  <TextInput
                    label="Shrinkage reason (if short)"
                    type="text"
                    placeholder="Optional"
                    value={shrinkageReason[r.id] ?? ''}
                    onChange={(e) => setShrinkageReason((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    wrapperClassName="min-w-[180px]"
                    disabled={markingId === r.id}
                  />
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
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'pending' && sentRemittances.length === 0 && (
        <EmptyState
          title="No transfers pending receipt"
          description="All in-transit stock transfers have been processed."
          variant="inline"
        />
      )}

      {activeTab === 'processed' && receivedOrDisputed.length > 0 && (
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
                  <th className="table-header">Sent</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {receivedOrDisputed.map((r) => (
                  <tr key={r.id} className="table-row">
                    <td className="table-cell text-app-fg">{r.productName}</td>
                    <td className="table-cell text-app-fg-muted">
                      {r.fromLocationName} → {r.toLocationName}
                    </td>
                    <td className="table-cell text-app-fg-muted">
                      {r.senderName ?? 'Unknown user'}
                    </td>
                    <td className="table-cell text-right">
                      {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : '—'}
                    </td>
                    <td className="table-cell">
                      <StatusBadge status={r.transferStatus} />
                    </td>
                    <td className="table-cell text-app-fg-muted">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                    <td className="table-cell text-right">—</td>
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
                            <StatusBadge status={r.transferStatus} />
                </div>
                <div className="text-sm text-app-fg-muted space-y-0.5">
                  <div>From → To: {r.fromLocationName} → {r.toLocationName}</div>
                  <div>Sent by: {r.senderName ?? 'Unknown user'}</div>
                  <div>Qty: {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : '—'}</div>
                  <div>Created: {new Date(r.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'processed' && receivedOrDisputed.length === 0 && (
        <EmptyState
          title="No processed transfers yet"
          description="Received or disputed stock transfers will appear here."
          variant="inline"
        />
      )}

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
