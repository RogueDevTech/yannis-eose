import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Tabs } from '~/components/ui/tabs';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/empty-state';
import { RoleBadge } from '~/components/ui/role-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import type { PayrollBatch, PayrollBatchStatus, PayrollDepartment } from '~/features/hr/types';

export interface BatchDetail {
  batch: PayrollBatch;
  payouts: Array<{
    id: string;
    staffName: string;
    staffRole: string | null;
    totalPayout: string;
    payoutBankName?: string | null;
    payoutAccountName?: string | null;
    payoutAccountNumber?: string | null;
    payoutBankCode?: string | null;
  }>;
}

interface FinancePayoutPageProps {
  batches: PayrollBatch[];
  selectedBatch: BatchDetail | null;
  status: '' | PayrollBatchStatus;
}

type PayoutLine = BatchDetail['payouts'][number];

const DEPT_LABEL: Record<PayrollDepartment, string> = {
  CS: 'Customer Service',
  MARKETING: 'Marketing',
  LOGISTICS: 'Logistics',
  HR: 'HR & Admin',
};

function formatBatchMonth(periodMonth: string): string {
  return new Date(periodMonth).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' });
}

const STATUS_TABS: Array<{ value: '' | PayrollBatchStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'PENDING_FINANCE', label: 'Pending Finance' },
  { value: 'PAID', label: 'Paid' },
];

const PAGE_SIZE = 20;

export function FinancePayoutPage({ batches, selectedBatch, status }: FinancePayoutPageProps) {
  const [, setSearchParams] = useSearchParams();
  const [showExportModal, setShowExportModal] = useState(false);
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever the result set changes (status tab switch, refetch).
  useEffect(() => {
    setPage(1);
  }, [batches.length, status]);

  const totalPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedBatches = useMemo(
    () => batches.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [batches, safePage],
  );

  const totalPending = useMemo(
    () => batches.filter((b) => b.status === 'PENDING_FINANCE').reduce((acc, b) => acc + Number(b.totalAmount), 0),
    [batches],
  );
  const totalPaid = useMemo(
    () => batches.filter((b) => b.status === 'PAID').reduce((acc, b) => acc + Number(b.totalAmount), 0),
    [batches],
  );

  const batchColumns: CompactTableColumn<PayrollBatch>[] = useMemo(
    () => [
      {
        key: 'month',
        header: 'Month',
        render: (batch) => <span className="text-app-fg-muted">{formatBatchMonth(batch.periodMonth)}</span>,
      },
      {
        key: 'department',
        header: 'Department',
        render: (batch) => <span className="text-app-fg">{DEPT_LABEL[batch.department]}</span>,
      },
      {
        key: 'staff',
        header: 'Staff',
        align: 'right',
        render: (batch) => <span className="text-app-fg-muted">{batch.staffCount}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (batch) => <StatusBadge status={batch.status} />,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (batch) => <NairaPrice amount={Number(batch.totalAmount)} />,
      },
      {
        key: 'actions',
        header: 'Actions',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (batch) => (
          <TableActionButton to={`?status=${encodeURIComponent(status)}&batchId=${batch.id}`} variant="primary">
            Review
          </TableActionButton>
        ),
      },
    ],
    [status],
  );

  const payoutLineColumns: CompactTableColumn<PayoutLine>[] = useMemo(
    () => [
      {
        key: 'staff',
        header: 'Staff',
        render: (p) => <span className="font-medium text-app-fg">{p.staffName}</span>,
      },
      {
        key: 'role',
        header: 'Role',
        render: (p) =>
          p.staffRole ? <RoleBadge role={p.staffRole} size="sm" /> : <span className="text-app-fg-muted">—</span>,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        nowrap: true,
        render: (p) => (
          <span className="font-semibold">
            <NairaPrice amount={Number(p.totalPayout)} />
          </span>
        ),
      },
      {
        key: 'bank',
        header: 'Bank',
        render: (p) => <span className="text-app-fg-muted">{p.payoutBankName ?? '—'}</span>,
      },
      {
        key: 'accountName',
        header: 'Account name',
        render: (p) => <span className="text-app-fg-muted">{p.payoutAccountName ?? '—'}</span>,
      },
      {
        key: 'accountNumber',
        header: 'Account no.',
        nowrap: true,
        render: (p) => <span className="text-app-fg-muted tabular-nums">{p.payoutAccountNumber ?? '—'}</span>,
      },
      {
        key: 'bankCode',
        header: 'Bank code',
        nowrap: true,
        render: (p) => <span className="text-app-fg-muted tabular-nums">{p.payoutBankCode ?? '—'}</span>,
      },
    ],
    [],
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
        mobileInlineActions
        description="Review payroll payout batches."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Payout tools"
            sheetSubtitle={<span>Refresh and export</span>}
            triggerAriaLabel="Payout toolbar"
            desktop={
              <>
                <PageRefreshButton />
                {selectedBatch ? (
                  <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                    Export payout document
                  </Button>
                ) : null}
              </>
            }
            sheet={({ closeSheet }) =>
              selectedBatch ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowExportModal(true);
                  }}
                >
                  Export payout document
                </Button>
              ) : null
            }
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Pending finance', value: <NairaPrice amount={totalPending} />, valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums' },
          { label: 'Paid', value: <NairaPrice amount={totalPaid} />, valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
          { label: 'Batches', value: batches.length, valueClassName: 'text-app-fg tabular-nums' },
        ]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] gap-4">
        <div className="card p-0 overflow-hidden flex flex-col">
          <div className="px-4 pt-3 pb-0 border-b border-app-border shrink-0">
            <Tabs
              value={status}
              onChange={setStatus}
              tabs={STATUS_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
              variant="underline"
            />
          </div>
          <CompactTable<PayrollBatch>
            columns={batchColumns}
            rows={pagedBatches}
            rowKey={(b) => b.id}
            withCard={false}
            loading={isLoaderRefetchBusy}
            loadingVariant="overlay"
            emptyTitle="No payroll batches in this queue"
            emptyDescription="When HR forwards payroll to finance, batches appear here for payout processing."
            pagination={
              batches.length > 0
                ? {
                    page: safePage,
                    totalPages,
                    onPageChange: setPage,
                    summary: (
                      <p className="text-sm text-app-fg-muted">
                        Showing {(safePage - 1) * PAGE_SIZE + 1}–
                        {Math.min(safePage * PAGE_SIZE, batches.length)} of {batches.length}
                        <span className="text-app-fg-muted/90"> · {PAGE_SIZE} per page</span>
                      </p>
                    ),
                    wrapperClassName:
                      'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-app-border px-4 py-3',
                    controlsClassName: 'sm:justify-end',
                  }
                : undefined
            }
          />
        </div>

        <div className="card p-0 overflow-hidden flex flex-col min-h-[16rem] xl:max-h-[min(36rem,70vh)]">
          <div className="px-4 py-3 border-b border-app-border shrink-0">
            <h2 className="text-sm font-semibold text-app-fg">Payout lines</h2>
            {selectedBatch ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-app-fg-muted">
                <span>{DEPT_LABEL[selectedBatch.batch.department]}</span>
                <span aria-hidden>·</span>
                <span>{formatBatchMonth(selectedBatch.batch.periodMonth)}</span>
                <StatusBadge status={selectedBatch.batch.status} />
              </div>
            ) : (
              <p className="text-xs text-app-fg-muted mt-1">
                Pick a batch on the left to review staff rows and export a document.
              </p>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {!selectedBatch ? (
              <div className="p-4">
                <EmptyState
                  variant="inline"
                  title="No batch selected"
                  description="Select Review on a batch to load payout details."
                />
              </div>
            ) : selectedBatch.payouts.length === 0 ? (
              <div className="p-4">
                <EmptyState variant="inline" title="No payout rows" description="This batch has no staff payout lines yet." />
              </div>
            ) : (
              <CompactTable<PayoutLine>
                columns={payoutLineColumns}
                rows={selectedBatch.payouts}
                rowKey={(p) => p.id}
                withCard={false}
                loading={isLoaderRefetchBusy}
                loadingVariant="overlay"
              />
            )}
          </div>
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
            bankCode: row.payoutBankCode ?? '',
          }))}
          columns={[
            { key: 'staffName', label: 'Staff' },
            { key: 'staffRole', label: 'Role' },
            { key: 'amount', label: 'Amount' },
            { key: 'bankName', label: 'Bank' },
            { key: 'accountName', label: 'Account Name' },
            { key: 'accountNumber', label: 'Account Number' },
            { key: 'bankCode', label: 'Bank Code' },
          ]}
          defaultColumns={['staffName', 'staffRole', 'amount', 'bankName', 'accountName', 'accountNumber', 'bankCode']}
        />
      )}
    </div>
  );
}
