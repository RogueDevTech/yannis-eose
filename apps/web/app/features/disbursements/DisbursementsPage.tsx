import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Link } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { FileUpload } from '~/components/ui/file-upload';
import { DeferredSection } from '~/components/ui/deferred-section';
import { S3_FOLDERS } from '~/lib/s3-upload';

const FUNDING_COLORS: Record<string, string> = {
  SENT: 'badge-warning',
  COMPLETED: 'badge-success',
  DISPUTED: 'badge-danger',
};

export interface DisbursementRecord {
  id: string;
  senderId: string;
  receiverId: string;
  amount: string;
  receiptUrl: string | null;
  status: string;
  sentAt: string;
  verifiedAt: string | null;
}

export interface DisbursementsPageData {
  funding: DisbursementRecord[];
  totalFunding: number;
  users: Array<{ id: string; name: string; email: string; role: string }>;
  canDisburseToHoM: boolean;
  canDisburseToMediaBuyers: boolean;
  preselectedReceiverId?: string | null;
}

export function DisbursementsPage({
  funding,
  totalFunding,
  users,
  canDisburseToHoM,
  canDisburseToMediaBuyers,
  preselectedReceiverId = null,
}: DisbursementsPageData) {
  const fetcher = useFetcher();
  const [showForm, setShowForm] = useState(!!preselectedReceiverId);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  useFetcherToast(fetcher.data, { successMessage: 'Disbursement sent successfully' });

  if (actionSuccess && showForm) setShowForm(false);

  const canCreate = canDisburseToHoM || canDisburseToMediaBuyers;
  const recipients = [
    ...(canDisburseToHoM ? users.filter((u) => u.role === 'HEAD_OF_MARKETING') : []),
    ...(canDisburseToMediaBuyers ? users.filter((u) => u.role === 'MEDIA_BUYER') : []),
  ];

  const truncateId = (id: string) => id.slice(0, 8) + '...';

  const getName = (id: string) => users.find((u) => u.id === id)?.name ?? truncateId(id);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Disbursements</h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
            Tier 1: Super Admin / Finance → Head of Marketing. Tier 2: HoM → Media Buyers
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-primary btn-sm"
          >
            + New Disbursement
          </button>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionError}</p>
        </div>
      )}

      {showForm && canCreate && (
        <fetcher.Form method="post" className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Send Disbursement</h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createFunding" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Recipient</label>
              <select name="receiverId" required className="input" defaultValue={preselectedReceiverId ?? ''}>
                <option value="">Select recipient...</option>
                {recipients.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : 'Media Buyer'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Amount (₦)</label>
              <input name="amount" type="text" required placeholder="e.g. 50000.00" pattern="^\d+(\.\d{1,2})?$" className="input" />
            </div>
            <div>
              <FileUpload
                folder={S3_FOLDERS.RECEIPTS}
                name="receiptUrl"
                label="Receipt Upload"
                required
                onUpload={() => {}}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary btn-sm" disabled={fetcher.state === 'submitting'}>
              {fetcher.state === 'submitting' ? 'Sending...' : 'Send Disbursement'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">Cancel</button>
          </div>
        </fetcher.Form>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">
            All Disbursements
            <span className="text-surface-500 dark:text-surface-400 font-normal ml-2">({totalFunding})</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Sender</th>
                <th className="table-header">Receiver</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Receipt</th>
                <th className="table-header">Status</th>
                <th className="table-header">Date</th>
              </tr>
            </thead>
            <tbody>
              {funding.map((f) => (
                <tr key={f.id} className="table-row">
                  <td className="table-cell text-surface-900 dark:text-surface-100 text-sm">
                    <Link to={`/admin/users/${f.senderId}`} className="text-brand-500 hover:text-brand-600">
                      {getName(f.senderId)}
                    </Link>
                  </td>
                  <td className="table-cell text-surface-900 dark:text-surface-100 text-sm">
                    <Link to={`/admin/users/${f.receiverId}`} className="text-brand-500 hover:text-brand-600">
                      {getName(f.receiverId)}
                    </Link>
                  </td>
                  <td className="table-cell text-right font-medium">₦{Number(f.amount).toLocaleString()}</td>
                  <td className="table-cell">
                    {f.receiptUrl ? (
                      <a href={f.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-500 hover:text-brand-600 text-xs">
                        View
                      </a>
                    ) : (
                      <span className="text-surface-400">—</span>
                    )}
                  </td>
                  <td className="table-cell">
                    <span className={FUNDING_COLORS[f.status] ?? 'badge'}>{f.status}</span>
                  </td>
                  <td className="table-cell text-sm text-surface-600 dark:text-surface-400">
                    {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {funding.length === 0 && (
          <div className="px-4 py-12 text-center text-surface-500">No disbursements yet</div>
        )}
      </div>
    </div>
  );
}
