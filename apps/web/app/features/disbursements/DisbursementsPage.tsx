import { useState, useEffect, useCallback } from 'react';
import { useFetcher, useNavigation, useSearchParams, Link } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { AmountInput } from '~/components/ui/amount-input';
import { formatNaira } from '~/lib/format-amount';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Spinner } from '~/components/ui/spinner';
import { exportToCsv } from '~/lib/csv-export';
import { S3_FOLDERS } from '~/lib/s3-upload';

const STATUS_OPTIONS = ['ALL', 'SENT', 'COMPLETED', 'DISPUTED'] as const;

const STATUS_COLORS: Record<string, string> = {
  SENT: 'badge-warning',
  COMPLETED: 'badge-success',
  DISPUTED: 'badge-danger',
};

const STATUS_LABELS: Record<string, string> = {
  ALL: 'All',
  SENT: 'Pending',
  COMPLETED: 'Received',
  DISPUTED: 'Disputed',
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
  totalPages: number;
  page: number;
  users: Array<{ id: string; name: string; email: string; role: string }>;
  canDisburseToHoM: boolean;
  canDisburseToMediaBuyers: boolean;
  preselectedReceiverId?: string | null;
  filters?: {
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
    status: string;
    receiver: string;
  };
  recipientBalances?: Array<{
    userId: string;
    name: string;
    role: string;
    totalReceived: string;
    totalSpend: string;
    balance: string;
  }>;
  summary?: {
    totalSent: string;
    totalCompleted: string;
    totalDisputed: string;
  };
}

/** Receipt preview modal — shows image inline with disbursement amount */
function ReceiptModal({
  open,
  onClose,
  receiptUrl,
  amount,
  senderName,
  receiverName,
  sentAt,
  status,
}: {
  open: boolean;
  onClose: () => void;
  receiptUrl: string;
  amount: string;
  senderName: string;
  receiverName: string;
  sentAt: string;
  status: string;
}) {
  if (!open) return null;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700 shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Disbursement receipt</h3>
          <button type="button" onClick={onClose} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
          {/* Amount highlight */}
          <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4">
            <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">Disbursement amount</p>
            <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
              &#8358;{Number(amount).toLocaleString()}
            </p>
            <div className="flex items-center gap-2 mt-2 text-xs text-brand-500 dark:text-brand-400">
              <span>{senderName} &rarr; {receiverName}</span>
              <span>&middot;</span>
              <span>{new Date(sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span>&middot;</span>
              <span className={STATUS_COLORS[status] ?? 'badge'}>{STATUS_LABELS[status] ?? status}</span>
            </div>
          </div>

          {/* Receipt image */}
          <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden bg-surface-50 dark:bg-surface-800/50">
            <img
              src={receiptUrl}
              alt="Payment receipt"
              className="w-full max-h-[400px] object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = (e.target as HTMLImageElement).nextElementSibling;
                if (fallback) (fallback as HTMLElement).style.display = 'flex';
              }}
            />
            <div className="items-center justify-center gap-2 p-8 hidden">
              <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span className="text-sm text-surface-500 dark:text-surface-400">Receipt is not an image file</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-surface-200 dark:border-surface-700 shrink-0 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Open in new tab
          </a>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
    </Modal>
  );
}

/** Create disbursement modal */
function CreateDisbursementModal({
  open,
  onClose,
  recipients,
  recipientBalances,
  preselectedReceiverId,
}: {
  open: boolean;
  onClose: () => void;
  recipients: Array<{ id: string; name: string }>;
  recipientBalances: Array<{ userId: string; balance: string }>;
  preselectedReceiverId: string | null;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data, { successMessage: 'Disbursement sent successfully' });

  useEffect(() => {
    if (fetcher.data?.success) onClose();
  }, [fetcher.data, onClose]);

  if (!open) return null;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" role="dialog" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700 shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">New disbursement</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={fetcher.state === 'submitting'}
            className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <fetcher.Form method="post" className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <input type="hidden" name="intent" value="createFunding" />

          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Recipient</label>
            <select name="receiverId" required className="input w-full" defaultValue={preselectedReceiverId ?? ''}>
              <option value="">Select recipient...</option>
              {recipients.map((u) => {
                const bal = recipientBalances.find((b) => b.userId === u.id);
                const balanceLabel = bal != null ? ` — Balance: ${formatNaira(Number(bal.balance))}` : '';
                return (
                  <option key={u.id} value={u.id}>
                    {u.name} (HoM){balanceLabel}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Amount (&#8358;)</label>
            <AmountInput name="amount" required placeholder="e.g. 50,000.00" className="input w-full" />
          </div>

          <div>
            <FileUpload
              folder={S3_FOLDERS.RECEIPTS}
              name="receiptUrl"
              label="Payment receipt"
              required
              onUpload={() => {}}
            />
          </div>

          {fetcher.data?.error && (
            <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
              <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-200 dark:border-surface-700">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={fetcher.state === 'submitting'}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Sending...">
              Send disbursement
            </Button>
          </div>
        </fetcher.Form>
    </Modal>
  );
}

export function DisbursementsPage({
  funding,
  totalFunding,
  totalPages,
  page,
  users,
  canDisburseToHoM,
  preselectedReceiverId = null,
  filters = { startDate: '', endDate: '', periodAllTime: false, status: '', receiver: '' },
  recipientBalances = [],
  summary = { totalSent: '0', totalCompleted: '0', totalDisputed: '0' },
}: DisbursementsPageData) {
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isFilterLoading = navigation.state === 'loading';
  const [showForm, setShowForm] = useState(!!preselectedReceiverId);
  const [activeTab, setActiveTab] = useState<'disbursements' | 'balances'>('disbursements');
  const [receiptModal, setReceiptModal] = useState<DisbursementRecord | null>(null);

  // Optimistic filter state: switch tab/filter immediately, then fetch in background
  const [optimisticStatus, setOptimisticStatus] = useState(filters.status || 'ALL');
  const [optimisticReceiver, setOptimisticReceiver] = useState(filters.receiver || 'ALL');
  useEffect(() => {
    setOptimisticStatus(filters.status || 'ALL');
    setOptimisticReceiver(filters.receiver || 'ALL');
  }, [filters.status, filters.receiver]);

  const canCreate = canDisburseToHoM;
  const recipients = canDisburseToHoM ? users.filter((u) => u.role === 'HEAD_OF_MARKETING') : [];
  const getName = useCallback((id: string) => users.find((u) => u.id === id)?.name ?? id.slice(0, 8) + '...', [users]);

  const selectedStatus = optimisticStatus;
  const selectedReceiver = optimisticReceiver;

  const buildQueryString = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, val] of Object.entries(overrides)) {
      if (val === undefined || val === '' || val === 'ALL') {
        params.delete(key);
      } else {
        params.set(key, val);
      }
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  };

  const handleStatusChange = (status: string) => {
    setOptimisticStatus(status);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (status === 'ALL') next.delete('status');
      else next.set('status', status);
      return next;
    });
  };

  const handleReceiverChange = (receiverId: string) => {
    setOptimisticReceiver(receiverId);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (receiverId === 'ALL') next.delete('receiver');
      else next.set('receiver', receiverId);
      return next;
    });
  };

  const handleExportCsv = () => {
    exportToCsv(
      funding.map((f) => ({
        id: f.id,
        sender: getName(f.senderId),
        receiver: getName(f.receiverId),
        amount: f.amount,
        status: f.status,
        receipt: f.receiptUrl ?? '',
        date: new Date(f.sentAt).toLocaleDateString(),
        verifiedAt: f.verifiedAt ? new Date(f.verifiedAt).toLocaleDateString() : '',
      })),
      [
        { key: 'id', label: 'ID' },
        { key: 'sender', label: 'Sender' },
        { key: 'receiver', label: 'Receiver' },
        { key: 'amount', label: 'Amount' },
        { key: 'status', label: 'Status' },
        { key: 'receipt', label: 'Receipt URL' },
        { key: 'date', label: 'Sent Date' },
        { key: 'verifiedAt', label: 'Verified Date' },
      ],
      `disbursements-${new Date().toISOString().split('T')[0]}.csv`,
    );
  };

  const totalSentAmt = Number(summary.totalSent) || 0;
  const totalReceivedAmt = Number(summary.totalCompleted) || 0;
  const totalDisputedAmt = Number(summary.totalDisputed) || 0;
  const totalAllAmt = totalSentAmt + totalReceivedAmt + totalDisputedAmt;

  const handleCloseCreateModal = useCallback(() => setShowForm(false), []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Disbursements</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            Send funds to Head of Marketing. HoM distributes to Media Buyers from Marketing &rarr; Funding.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageRefreshButton />
          <DateFilterBar
            startDate={filters.startDate}
            endDate={filters.endDate}
            periodAllTime={filters.periodAllTime}
          />
          <Button variant="secondary" size="sm" onClick={handleExportCsv}>
            Export CSV
          </Button>
          {canCreate && (
            <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
              + New disbursement
            </Button>
          )}
          {isFilterLoading && (
            <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
        </div>
      </div>

      {/* Create disbursement modal */}
      <CreateDisbursementModal
        open={showForm}
        onClose={handleCloseCreateModal}
        recipients={recipients}
        recipientBalances={recipientBalances}
        preselectedReceiverId={preselectedReceiverId}
      />

      {/* Receipt preview modal */}
      {receiptModal?.receiptUrl && (
        <ReceiptModal
          open={!!receiptModal}
          onClose={() => setReceiptModal(null)}
          receiptUrl={receiptModal.receiptUrl}
          amount={receiptModal.amount}
          senderName={getName(receiptModal.senderId)}
          receiverName={getName(receiptModal.receiverId)}
          sentAt={receiptModal.sentAt}
          status={receiptModal.status}
        />
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-600 dark:text-surface-400 uppercase tracking-wider">Total disbursed</p>
          <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">{formatNaira(totalAllAmt)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-warning-600 dark:text-warning-400 uppercase tracking-wider">Pending</p>
          <p className="text-xl font-bold text-warning-600 dark:text-warning-400 mt-1">{formatNaira(totalSentAmt)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-success-600 dark:text-success-400 uppercase tracking-wider">Received</p>
          <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">{formatNaira(totalReceivedAmt)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-danger-600 dark:text-danger-400 uppercase tracking-wider">Disputed</p>
          <p className="text-xl font-bold text-danger-600 dark:text-danger-400 mt-1">{formatNaira(totalDisputedAmt)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-200 dark:border-surface-700">
        <button
          type="button"
          onClick={() => setActiveTab('disbursements')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'disbursements'
              ? 'border-brand-500 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
          }`}
        >
          Disbursements
          <span className="ml-1.5 text-xs text-surface-400">({totalFunding})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('balances')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'balances'
              ? 'border-brand-500 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
          }`}
        >
          Recipient balances
          <span className="ml-1.5 text-xs text-surface-400">({recipientBalances.length})</span>
        </button>
      </div>

      {/* Disbursements tab */}
      {activeTab === 'disbursements' && (
        <>
          {/* Filter bar */}
          <div className="card">
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Status filter pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleStatusChange(s)}
                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                      selectedStatus === s
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-surface-700 hover:border-surface-400 dark:hover:border-surface-500'
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>

              {/* Recipient filter dropdown */}
              <select
                value={selectedReceiver}
                onChange={(e) => handleReceiverChange(e.target.value)}
                className="input w-full sm:w-52 py-1.5"
                aria-label="Filter by recipient"
              >
                <option value="ALL">All recipients</option>
                {recipients.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>

              {isFilterLoading && (
                <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
                  <Spinner size="sm" className="shrink-0" />
                </span>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">ID</th>
                    <th className="table-header">Sender</th>
                    <th className="table-header">Receiver</th>
                    <th className="table-header text-right">Amount</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Sent</th>
                    <th className="table-header">Verified</th>
                    <th className="table-header text-center">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {funding.map((f) => (
                    <tr key={f.id} className="table-row">
                      <td className="table-cell">
                        <span className="font-mono text-xs text-surface-500 dark:text-surface-400">{f.id.slice(0, 8)}...</span>
                      </td>
                      <td className="table-cell text-sm">
                        <Link to={`/hr/users/${f.senderId}`} className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300">
                          {getName(f.senderId)}
                        </Link>
                      </td>
                      <td className="table-cell text-sm">
                        <Link to={`/hr/users/${f.receiverId}`} className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300">
                          {getName(f.receiverId)}
                        </Link>
                      </td>
                      <td className="table-cell text-right font-medium text-surface-900 dark:text-white">
                        &#8358;{Number(f.amount).toLocaleString()}
                      </td>
                      <td className="table-cell">
                        <span className={STATUS_COLORS[f.status] ?? 'badge'}>{STATUS_LABELS[f.status] ?? f.status}</span>
                      </td>
                      <td className="table-cell text-sm text-surface-600 dark:text-surface-400">
                        {new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="table-cell text-sm text-surface-600 dark:text-surface-400">
                        {f.verifiedAt
                          ? new Date(f.verifiedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="table-cell text-center">
                        {f.receiptUrl ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setReceiptModal(f)}
                            className="text-xs inline-flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            View
                          </Button>
                        ) : (
                          <span className="text-surface-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
              {funding.map((f) => (
                <div key={f.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-surface-500 dark:text-surface-400">{f.id.slice(0, 8)}...</span>
                    <span className={STATUS_COLORS[f.status] ?? 'badge'}>{STATUS_LABELS[f.status] ?? f.status}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-surface-700 dark:text-surface-300">
                      {getName(f.senderId)} &rarr; {getName(f.receiverId)}
                    </div>
                    <span className="font-medium text-surface-900 dark:text-white">
                      &#8358;{Number(f.amount).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-surface-500 dark:text-surface-400">
                    <span>{new Date(f.sentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {f.receiptUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setReceiptModal(f)}
                      >
                        View receipt
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {funding.length === 0 && (
              <div className="px-4 py-12 text-center text-surface-500 dark:text-surface-400">
                <svg className="w-10 h-10 mx-auto mb-3 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
                <p className="text-sm font-medium">No disbursements found</p>
                <p className="text-xs mt-1">
                  {selectedStatus !== 'ALL' || selectedReceiver !== 'ALL'
                    ? 'Try adjusting your filters'
                    : 'Create your first disbursement to get started'}
                </p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-surface-600 dark:text-surface-400">
                Showing {(page - 1) * 20 + 1}&ndash;{Math.min(page * 20, totalFunding)} of {totalFunding} disbursements
              </p>
              <div className="flex items-center gap-2">
                <Link
                  to={page > 1 ? buildQueryString({ page: String(page - 1) }) : '#'}
                  prefetch="intent"
                  className={`btn-secondary btn-sm ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
                  aria-disabled={page <= 1}
                >
                  Previous
                </Link>
                <span className="text-sm text-surface-600 dark:text-surface-400 px-2">
                  Page {page} of {totalPages}
                </span>
                <Link
                  to={page < totalPages ? buildQueryString({ page: String(page + 1) }) : '#'}
                  prefetch="intent"
                  className={`btn-secondary btn-sm ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
                  aria-disabled={page >= totalPages}
                >
                  Next
                </Link>
              </div>
            </div>
          )}
        </>
      )}

      {/* Balances tab */}
      {activeTab === 'balances' && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Recipient balances</h2>
            <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
              Funding received (confirmed) minus approved ad spend
            </p>
          </div>
          {recipientBalances.length > 0 ? (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header">Recipient</th>
                      <th className="table-header">Role</th>
                      <th className="table-header text-right">Received</th>
                      <th className="table-header text-right">Spent</th>
                      <th className="table-header text-right">Balance</th>
                      <th className="table-header text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipientBalances.map((b) => {
                      const balance = Number(b.balance);
                      return (
                        <tr key={b.userId} className="table-row">
                          <td className="table-cell">
                            <Link to={`/hr/users/${b.userId}`} className="text-brand-500 hover:text-brand-600 dark:text-brand-400 text-sm font-medium">
                              {b.name}
                            </Link>
                          </td>
                          <td className="table-cell text-sm text-surface-600 dark:text-surface-400">
                            {b.role === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : b.role === 'MEDIA_BUYER' ? 'Media Buyer' : b.role}
                          </td>
                          <td className="table-cell text-right text-sm">
                            &#8358;{Number(b.totalReceived).toLocaleString()}
                          </td>
                          <td className="table-cell text-right text-sm">
                            &#8358;{Number(b.totalSpend).toLocaleString()}
                          </td>
                          <td className={`table-cell text-right font-medium ${
                            balance < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-brand-600 dark:text-brand-400'
                          }`}>
                            {formatNaira(balance)}
                          </td>
                          <td className="table-cell text-center">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setSearchParams((p) => {
                                  const next = new URLSearchParams(p);
                                  next.set('receiverId', b.userId);
                                  return next;
                                });
                                setShowForm(true);
                                setActiveTab('disbursements');
                              }}
                              className="text-xs"
                            >
                              Send funds
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
                {recipientBalances.map((b) => {
                  const balance = Number(b.balance);
                  return (
                    <div key={b.userId} className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Link to={`/hr/users/${b.userId}`} className="text-brand-500 hover:text-brand-600 dark:text-brand-400 font-medium">
                          {b.name}
                        </Link>
                        <span className={`font-medium text-sm ${
                          balance < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-brand-600 dark:text-brand-400'
                        }`}>
                          {formatNaira(balance)}
                        </span>
                      </div>
                      <div className="text-sm text-surface-800 dark:text-surface-200 space-y-0.5 mb-2">
                        <div>Role: {b.role === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : b.role === 'MEDIA_BUYER' ? 'Media Buyer' : b.role}</div>
                        <div>Received: &#8358;{Number(b.totalReceived).toLocaleString()}</div>
                        <div>Spent: &#8358;{Number(b.totalSpend).toLocaleString()}</div>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSearchParams((p) => {
                            const next = new URLSearchParams(p);
                            next.set('receiverId', b.userId);
                            return next;
                          });
                          setShowForm(true);
                          setActiveTab('disbursements');
                        }}
                        className="text-xs"
                      >
                        Send funds
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="px-4 py-12 text-center text-surface-500 dark:text-surface-400">
              <p className="text-sm">No recipient balances available</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
