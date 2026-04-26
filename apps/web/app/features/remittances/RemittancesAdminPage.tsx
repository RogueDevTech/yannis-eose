import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
import { NairaPrice } from '~/components/ui/naira-price';

export interface RemittanceAdminRecord {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  productId: string;
  productName: string;
  quantitySent: number;
  quantityReceived: number | null;
  receiptUrl: string;
  status: string;
  sentAt: string;
  fromLocationName: string;
  toLocationName: string;
  shrinkageReason: string | null;
}

export interface RemittancesAdminPageProps {
  remittances: RemittanceAdminRecord[];
}

export function RemittancesAdminPage({ remittances }: RemittancesAdminPageProps) {
  const fetcher = useFetcher();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [quantityReceived, setQuantityReceived] = useState<Record<string, string>>({});
  const [shrinkageReason, setShrinkageReason] = useState<Record<string, string>>({});
  const [remittanceReceiptModal, setRemittanceReceiptModal] = useState<RemittanceAdminRecord | null>(null);

  useFetcherToast(fetcher.data, { successMessage: 'Remittance marked as received' });

  const sentRemittances = remittances.filter((r) => r.status === 'SENT');
  const receivedOrDisputed = remittances.filter((r) => r.status === 'RECEIVED' || r.status === 'DISPUTED');

  const handleMarkReceived = (remittance: RemittanceAdminRecord) => {
    const qty = quantityReceived[remittance.id] ?? String(remittance.quantitySent);
    const qtyNum = parseInt(qty, 10);
    if (Number.isNaN(qtyNum) || qtyNum < 0) return;
    setMarkingId(remittance.id);
    const formData = new FormData();
    formData.set('intent', 'markRemittanceReceived');
    formData.set('remittanceId', remittance.id);
    formData.set('quantityReceived', String(qtyNum));
    const reason = shrinkageReason[remittance.id]?.trim();
    if (reason) formData.set('shrinkageReason', reason);
    fetcher.submit(formData, { method: 'post' });
    setMarkingId(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Transfer Confirmations"
        description="Incoming remittances from 3PL locations. Mark as received when stock arrives at the warehouse."
      />

      {sentRemittances.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-app-fg mb-3">Pending receipt ({sentRemittances.length})</h2>
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
                    Quantity sent: {r.quantitySent} · Sent {new Date(r.sentAt).toLocaleString()}
                  </p>
                  <Button type="button" variant="ghost" size="sm" className="text-sm text-brand-600 dark:text-brand-400 hover:underline h-auto p-0" onClick={() => setRemittanceReceiptModal(r)}>
                    View receipt
                  </Button>
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
                    onClick={() => handleMarkReceived(r)}
                    loading={markingId === r.id || fetcher.state === 'submitting'}
                    loadingText="Saving..."
                  >
                    Mark received
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sentRemittances.length === 0 && (
        <EmptyState
          title="No remittances pending receipt"
          description="All incoming remittances have been processed."
          variant="inline"
        />
      )}

      {receivedOrDisputed.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-app-fg mb-3">Received / Disputed</h2>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border">
                  <th className="text-left py-2 px-3 font-medium text-app-fg-muted">Product</th>
                  <th className="text-left py-2 px-3 font-medium text-app-fg-muted">From → To</th>
                  <th className="text-right py-2 px-3 font-medium text-app-fg-muted">Qty</th>
                  <th className="text-left py-2 px-3 font-medium text-app-fg-muted">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-app-fg-muted">Sent</th>
                </tr>
              </thead>
              <tbody>
                {receivedOrDisputed.map((r) => (
                  <tr key={r.id} className="border-b border-app-border">
                    <td className="py-2 px-3 text-app-fg">{r.productName}</td>
                    <td className="py-2 px-3 text-app-fg-muted">
                      {r.fromLocationName} → {r.toLocationName}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : '—'}
                    </td>
                    <td className="py-2 px-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 px-3 text-app-fg-muted">
                      {new Date(r.sentAt).toLocaleDateString()}
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
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-sm text-app-fg-muted space-y-0.5">
                  <div>From → To: {r.fromLocationName} → {r.toLocationName}</div>
                  <div>Qty: {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : '—'}</div>
                  <div>Sent: {new Date(r.sentAt).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transfer remittance receipt modal */}
      {remittanceReceiptModal?.receiptUrl && (
        <Modal open onClose={() => setRemittanceReceiptModal(null)} maxWidth="max-w-lg" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-app-fg">Transfer remittance receipt</h3>
            <button type="button" onClick={() => setRemittanceReceiptModal(null)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
              <p className="font-medium text-app-fg">{remittanceReceiptModal.productName}</p>
              <p className="text-sm text-brand-600 dark:text-brand-400 mt-1">
                {remittanceReceiptModal.fromLocationName} → {remittanceReceiptModal.toLocationName}
              </p>
              <p className="text-sm text-app-fg-muted mt-1">
                Quantity sent: {remittanceReceiptModal.quantitySent} · Sent {new Date(remittanceReceiptModal.sentAt).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
              <img
                src={remittanceReceiptModal.receiptUrl}
                alt="Transfer remittance receipt"
                className="w-full max-h-[400px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  const fallback = (e.target as HTMLImageElement).nextElementSibling;
                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                }}
              />
              <div className="items-center justify-center gap-2 p-8 hidden">
                <span className="text-sm text-app-fg-muted">Receipt image could not be loaded</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-app-border shrink-0 px-4 sm:px-5 pb-4">
            <a href={remittanceReceiptModal.receiptUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
              Open in new tab
            </a>
            <Button variant="secondary" size="sm" onClick={() => setRemittanceReceiptModal(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
