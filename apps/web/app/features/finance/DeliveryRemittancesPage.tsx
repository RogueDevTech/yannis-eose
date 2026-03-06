import { useFetcher, Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useFetcherToast } from '~/components/ui/toast';

export interface DeliveryRemittanceListItem {
  id: string;
  logisticsLocationId: string;
  sentBy: string;
  receiptUrls: string[];
  status: string;
  sentAt: string;
  locationName: string | null;
  orderCount: number;
}

export interface DeliveryRemittanceDetail extends DeliveryRemittanceListItem {
  orders: Array<{
    id: string;
    customerName: string;
    totalAmount: string | null;
    deliveredAt: string | null;
  }>;
}

export interface DeliveryRemittancesPageProps {
  remittances: DeliveryRemittanceListItem[];
  selectedDetail: DeliveryRemittanceDetail | null;
  hasApprovePermission: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

export function DeliveryRemittancesPage({
  remittances,
  selectedDetail,
  hasApprovePermission,
}: DeliveryRemittancesPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();

  useFetcherToast(fetcher.data, { successMessage: 'Marked as received' });

  const pending = remittances.filter((r) => r.status === 'SENT');
  const receivedOrDisputed = remittances.filter((r) => r.status === 'RECEIVED' || r.status === 'DISPUTED');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Delivery remittances</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            3PL submit batches of delivered orders with payment receipts. Review and mark as received to confirm payment.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PageRefreshButton />
        </div>
      </div>

      {pending.length > 0 && (
        <div className="card p-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Pending ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden"
              >
                <Link
                  to={selectedDetail?.id === r.id ? '?' : `?detail=${r.id}`}
                  className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-surface-50 dark:hover:bg-surface-800/50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm text-surface-600 dark:text-surface-400">
                      {r.id.slice(0, 8)}...
                    </span>
                    <span className="text-sm font-medium text-surface-900 dark:text-white truncate">
                      {r.locationName ?? 'Unknown location'}
                    </span>
                    <span className="text-xs text-surface-500 dark:text-surface-400">
                      {r.orderCount} order(s) · {new Date(r.sentAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-warning-600 dark:text-warning-400">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </Link>
                {selectedDetail?.id === r.id && selectedDetail && (
                  <div className="border-t border-surface-200 dark:border-surface-700 p-4 bg-surface-50/50 dark:bg-surface-800/30">
                    <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Orders</h3>
                    <ul className="space-y-1 text-sm mb-4">
                      {selectedDetail.orders.map((o) => (
                        <li key={o.id} className="flex justify-between gap-2">
                          <span className="text-surface-900 dark:text-white truncate">{o.customerName}</span>
                          <span className="text-surface-500 dark:text-surface-400 shrink-0">
                            {o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString() : '—'}
                          </span>
                          {o.totalAmount != null && (
                            <span className="font-medium shrink-0">₦{Number(o.totalAmount).toLocaleString()}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Receipts</h3>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {(selectedDetail.receiptUrls ?? []).map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                        >
                          Receipt {i + 1}
                        </a>
                      ))}
                    </div>
                    {hasApprovePermission && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="markReceived" />
                        <input type="hidden" name="deliveryRemittanceId" value={r.id} />
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          loading={fetcher.state === 'submitting'}
                          disabled={fetcher.state === 'submitting'}
                        >
                          Mark received
                        </Button>
                      </fetcher.Form>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {receivedOrDisputed.length > 0 && (
        <div className="card p-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
            Received / Disputed ({receivedOrDisputed.length})
          </h2>
          <ul className="space-y-2">
            {receivedOrDisputed.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 py-2 border-b border-surface-100 dark:border-surface-800 last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs text-surface-500 dark:text-surface-400">{r.id.slice(0, 8)}...</span>
                  <span className="text-sm text-surface-900 dark:text-white truncate">
                    {r.locationName ?? 'Unknown'}
                  </span>
                  <span className="text-xs text-surface-500 dark:text-surface-400">
                    {r.orderCount} order(s) · {new Date(r.sentAt).toLocaleDateString()}
                  </span>
                </div>
                <span
                  className={`shrink-0 inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                    r.status === 'RECEIVED'
                      ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300'
                      : 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-300'
                  }`}
                >
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {remittances.length === 0 && (
        <p className="text-sm text-surface-500 dark:text-surface-400">No delivery remittances yet.</p>
      )}
    </div>
  );
}
