import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { useFetcherToast } from '~/components/ui/toast';

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
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Remittances</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Incoming remittances from 3PL locations. Mark as received when stock arrives at the warehouse.
        </p>
      </div>

      {sentRemittances.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Pending receipt ({sentRemittances.length})</h2>
          <div className="space-y-4">
            {sentRemittances.map((r) => (
              <div
                key={r.id}
                className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4 flex-wrap"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-surface-900 dark:text-white">{r.productName}</p>
                  <p className="text-sm text-surface-600 dark:text-surface-400">
                    From {r.fromLocationName} → {r.toLocationName}
                  </p>
                  <p className="text-sm text-surface-600 dark:text-surface-400">
                    Quantity sent: {r.quantitySent} · Sent {new Date(r.sentAt).toLocaleString()}
                  </p>
                  <a
                    href={r.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    View receipt
                  </a>
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <div>
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">Qty received</label>
                    <input
                      type="number"
                      min={0}
                      max={r.quantitySent}
                      value={quantityReceived[r.id] ?? r.quantitySent}
                      onChange={(e) => setQuantityReceived((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      className="input w-20"
                      disabled={markingId === r.id}
                    />
                  </div>
                  <div className="min-w-[180px]">
                    <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-0.5">Shrinkage reason (if short)</label>
                    <input
                      type="text"
                      placeholder="Optional"
                      value={shrinkageReason[r.id] ?? ''}
                      onChange={(e) => setShrinkageReason((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      className="input w-full"
                      disabled={markingId === r.id}
                    />
                  </div>
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
        <p className="text-sm text-surface-600 dark:text-surface-400">No remittances pending receipt.</p>
      )}

      {receivedOrDisputed.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Received / Disputed</h2>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Product</th>
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">From → To</th>
                  <th className="text-right py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Qty</th>
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Sent</th>
                </tr>
              </thead>
              <tbody>
                {receivedOrDisputed.map((r) => (
                  <tr key={r.id} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="py-2 px-3 text-surface-900 dark:text-white">{r.productName}</td>
                    <td className="py-2 px-3 text-surface-800 dark:text-surface-200">
                      {r.fromLocationName} → {r.toLocationName}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : '—'}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          r.status === 'RECEIVED'
                            ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300'
                            : 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-surface-600 dark:text-surface-400">
                      {new Date(r.sentAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-3 px-1">
            {receivedOrDisputed.map((r) => (
              <div key={r.id} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-medium text-surface-900 dark:text-white">{r.productName}</p>
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                      r.status === 'RECEIVED'
                        ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300'
                        : 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="text-sm text-surface-800 dark:text-surface-200 space-y-0.5">
                  <div>From → To: {r.fromLocationName} → {r.toLocationName}</div>
                  <div>Qty: {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : '—'}</div>
                  <div>Sent: {new Date(r.sentAt).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
