import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { FileUpload } from '~/components/ui/file-upload';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { useFetcherToast } from '~/components/ui/toast';

export interface RemittanceRecord {
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

export interface RemitPageProps {
  remittances: RemittanceRecord[];
  products: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  userLocationId: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending receipt',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

export function RemitPage({ remittances, products, locations, userLocationId }: RemitPageProps) {
  const fetcher = useFetcher();
  const [receiptUploaded, setReceiptUploaded] = useState(false);

  useFetcherToast(fetcher.data, { successMessage: 'Remittance submitted' });

  const toLocationOptions = userLocationId
    ? locations.filter((l) => l.id !== userLocationId)
    : locations;

  const isSubmitting = fetcher.state === 'submitting';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Remit to warehouse</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Submit a transfer of stock back to the main warehouse. Upload a receipt as proof; Head of Logistics will mark it received.
        </p>
      </div>

      <div className="card p-6 max-w-lg">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">New remittance</h2>
        <fetcher.Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="createRemittance" />
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Product</label>
            <select
              name="productId"
              required
              className="input w-full"
              disabled={isSubmitting}
            >
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Send to location</label>
            <select
              name="toLocationId"
              required
              className="input w-full"
              disabled={isSubmitting}
            >
              <option value="">Select warehouse / location</option>
              {toLocationOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Quantity sent</label>
            <input
              type="number"
              name="quantitySent"
              min={1}
              required
              className="input w-full"
              disabled={isSubmitting}
            />
          </div>
          <FileUpload
            folder={S3_FOLDERS.RECEIPTS}
            name="receiptUrl"
            label="Receipt (required)"
            required
            onUpload={(url) => setReceiptUploaded(!!url)}
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={isSubmitting}
            loadingText="Submitting..."
            disabled={isSubmitting || !receiptUploaded}
          >
            Submit remittance
          </Button>
        </fetcher.Form>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Your remittances</h2>
        {remittances.length === 0 ? (
          <p className="text-sm text-surface-600 dark:text-surface-400">No remittances yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200 dark:border-surface-700">
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Product</th>
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">To</th>
                  <th className="text-right py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Qty</th>
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Sent</th>
                  <th className="text-left py-2 px-3 font-medium text-surface-700 dark:text-surface-300">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {remittances.map((r) => (
                  <tr key={r.id} className="border-b border-surface-100 dark:border-surface-800">
                    <td className="py-2 px-3 text-surface-900 dark:text-white">{r.productName}</td>
                    <td className="py-2 px-3 text-surface-800 dark:text-surface-200">{r.toLocationName}</td>
                    <td className="py-2 px-3 text-right">
                      {r.quantityReceived != null ? `${r.quantityReceived} / ${r.quantitySent}` : r.quantitySent}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          r.status === 'RECEIVED'
                            ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300'
                            : r.status === 'DISPUTED'
                              ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300'
                              : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300'
                        }`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-surface-600 dark:text-surface-400">
                      {new Date(r.sentAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3">
                      <a
                        href={r.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
