import { useMemo, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Tabs } from '~/components/ui/tabs';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import { Button } from '~/components/ui/button';
import type { PayrollBatch, PayrollBatchStatus } from '~/features/hr/types';

interface BatchDetail {
  batch: PayrollBatch;
  payouts: Array<{
    id: string;
    staffName: string;
    staffRole: string | null;
    totalPayout: string;
    payoutBankName?: string | null;
    payoutAccountName?: string | null;
    payoutAccountNumber?: string | null;
  }>;
}

interface FinancePayoutPageProps {
  batches: PayrollBatch[];
  selectedBatch: BatchDetail | null;
  status: '' | PayrollBatchStatus;
}

const STATUS_TABS: Array<{ value: '' | PayrollBatchStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'PENDING_FINANCE', label: 'Pending Finance' },
  { value: 'PAID', label: 'Paid' },
];

export function FinancePayoutPage({ batches, selectedBatch, status }: FinancePayoutPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExportModal, setShowExportModal] = useState(false);

  const totalPending = useMemo(
    () => batches.filter((b) => b.status === 'PENDING_FINANCE').reduce((acc, b) => acc + Number(b.totalAmount), 0),
    [batches],
  );
  const totalPaid = useMemo(
    () => batches.filter((b) => b.status === 'PAID').reduce((acc, b) => acc + Number(b.totalAmount), 0),
    [batches],
  );

  const setStatus = (nextStatus: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (!nextStatus) next.delete('status');
      else next.set('status', nextStatus);
      next.delete('batchId');
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payout"
        description="Finance review queue for payroll disbursement and payout document exports."
        actions={
          selectedBatch ? (
            <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
              Export payout document
            </Button>
          ) : null
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Pending finance', value: <NairaPrice amount={totalPending} />, valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums' },
          { label: 'Paid', value: <NairaPrice amount={totalPaid} />, valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
          { label: 'Batches', value: batches.length, valueClassName: 'text-app-fg tabular-nums' },
        ]}
      />

      <div className="card space-y-3">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={STATUS_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
          variant="pill"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-4">
        <div className="card p-0">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Month</th>
                  <th className="table-header">Department</th>
                  <th className="table-header">Staff</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="table-row">
                    <td className="table-cell text-app-fg-muted">{new Date(batch.periodMonth).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })}</td>
                    <td className="table-cell text-app-fg">{batch.department}</td>
                    <td className="table-cell text-app-fg-muted">{batch.staffCount}</td>
                    <td className="table-cell"><StatusBadge status={batch.status} /></td>
                    <td className="table-cell text-right"><NairaPrice amount={Number(batch.totalAmount)} /></td>
                    <td className="table-cell">
                      <Link to={`?status=${encodeURIComponent(status)}&batchId=${batch.id}`} className="btn-secondary btn-sm inline-flex">Review</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batches.length === 0 && (
            <EmptyState
              title="No payroll batches in this queue"
              description="When HR forwards payroll to finance, batches appear here for payout processing."
            />
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-app-fg mb-3">Selected batch</h2>
          {!selectedBatch ? (
            <p className="text-sm text-app-fg-muted">Pick a batch to review payout lines and export a document.</p>
          ) : (
            <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
              {selectedBatch.payouts.map((payout) => (
                <div key={payout.id} className="rounded-lg border border-app-border bg-app-hover p-3 text-xs">
                  <p className="font-medium text-app-fg">{payout.staffName}</p>
                  <p className="text-app-fg-muted">{payout.staffRole?.replace(/_/g, ' ') ?? '—'}</p>
                  <p className="text-app-fg mt-1"><NairaPrice amount={Number(payout.totalPayout)} /></p>
                  <p className="text-app-fg-muted mt-1">Bank: {payout.payoutBankName ?? '—'}</p>
                  <p className="text-app-fg-muted">Acct Name: {payout.payoutAccountName ?? '—'}</p>
                  <p className="text-app-fg-muted">Acct No: {payout.payoutAccountNumber ?? '—'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedBatch && (
        <LocalExportModal
          open={showExportModal}
          onClose={() => setShowExportModal(false)}
          title="Export payout document"
          description="Download payout rows with bank account details for disbursement processing."
          filenamePrefix={`payout-${selectedBatch.batch.id.slice(0, 8)}`}
          rows={selectedBatch.payouts.map((row) => ({
            staffName: row.staffName,
            staffRole: row.staffRole ?? '',
            amount: Number(row.totalPayout),
            bankName: row.payoutBankName ?? '',
            accountName: row.payoutAccountName ?? '',
            accountNumber: row.payoutAccountNumber ?? '',
          }))}
          columns={[
            { key: 'staffName', label: 'Staff' },
            { key: 'staffRole', label: 'Role' },
            { key: 'amount', label: 'Amount' },
            { key: 'bankName', label: 'Bank' },
            { key: 'accountName', label: 'Account Name' },
            { key: 'accountNumber', label: 'Account Number' },
          ]}
          defaultColumns={['staffName', 'staffRole', 'amount', 'bankName', 'accountName', 'accountNumber']}
        />
      )}
    </div>
  );
}
