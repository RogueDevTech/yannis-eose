import { useState, useEffect } from 'react';
import { useFetcher, useNavigation } from '@remix-run/react';
import { Link } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { FileUpload } from '~/components/ui/file-upload';
import { DeferredSection } from '~/components/ui/deferred-section';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { Spinner } from '~/components/ui/spinner';
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
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  recipientBalances?: Array<{ userId: string; name: string; role: string; totalReceived: string; totalSpend: string; balance: string }>;
}

export function DisbursementsPage({
  funding,
  totalFunding,
  users,
  canDisburseToHoM,
  canDisburseToMediaBuyers,
  preselectedReceiverId = null,
  filters = { startDate: '', endDate: '', periodAllTime: false },
  recipientBalances = [],
}: DisbursementsPageData) {
  const fetcher = useFetcher();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const [showForm, setShowForm] = useState(!!preselectedReceiverId);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Disbursement sent successfully' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

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
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Disbursements</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Tier 1: Super Admin / Finance → Head of Marketing. Tier 2: HoM → Media Buyers
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateFilterBar
            startDate={filters.startDate}
            endDate={filters.endDate}
            periodAllTime={filters.periodAllTime}
          />
          {isFilterLoading && (
            <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
          {canCreate && (
            <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Close' : '+ New Disbursement'}
            </Button>
          )}
        </div>
      </div>

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {canCreate && (
        <ResponsiveFormPanel open={showForm} onClose={() => setShowForm(false)}>
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
                  {recipients.map((u) => {
                    const bal = recipientBalances.find((b) => b.userId === u.id);
                    const balanceLabel = bal != null ? ` — Balance: ₦${Number(bal.balance).toLocaleString()}` : '';
                    return (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : 'Media Buyer'}){balanceLabel}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Amount (₦)</label>
                <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input" />
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
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Sending...">
                Send Disbursement
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </ResponsiveFormPanel>
      )}

      {recipientBalances.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Recipient balances</h2>
            <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">Funding received (confirmed) minus approved ad spend</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Recipient</th>
                  <th className="table-header">Role</th>
                  <th className="table-header text-right">Received</th>
                  <th className="table-header text-right">Spent</th>
                  <th className="table-header text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {recipientBalances.map((b) => (
                  <tr key={b.userId} className="table-row">
                    <td className="table-cell">
                      <Link to={`/hr/users/${b.userId}`} className="text-brand-500 hover:text-brand-600 text-sm">
                        {b.name}
                      </Link>
                    </td>
                    <td className="table-cell text-sm text-surface-700 dark:text-surface-300">
                      {b.role === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : b.role === 'MEDIA_BUYER' ? 'Media Buyer' : b.role}
                    </td>
                    <td className="table-cell text-right text-sm">₦{Number(b.totalReceived).toLocaleString()}</td>
                    <td className="table-cell text-right text-sm">₦{Number(b.totalSpend).toLocaleString()}</td>
                    <td className="table-cell text-right font-medium text-brand-600 dark:text-brand-400">₦{Number(b.balance).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">
            All Disbursements
            <span className="text-surface-500 dark:text-surface-200 font-normal ml-2">({totalFunding})</span>
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
                    <Link to={`/hr/users/${f.senderId}`} className="text-brand-500 hover:text-brand-600">
                      {getName(f.senderId)}
                    </Link>
                  </td>
                  <td className="table-cell text-surface-900 dark:text-surface-100 text-sm">
                    <Link to={`/hr/users/${f.receiverId}`} className="text-brand-500 hover:text-brand-600">
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
                  <td className="table-cell text-sm text-surface-600 dark:text-surface-200">
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
