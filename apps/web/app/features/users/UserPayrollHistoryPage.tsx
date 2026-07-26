import { useCallback, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Tabs } from '~/components/ui/tabs';
import { EmptyState } from '~/components/ui/empty-state';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Modal } from '~/components/ui/modal';
import { Spinner } from '~/components/ui/spinner';
import { InlineNotification } from '~/components/ui/inline-notification';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { PayslipPreviewModal } from '~/components/ui/payslip-preview-modal';
import { downloadPayslipPdf } from '~/lib/payslip-pdf';
import {
  payslipFilename,
  toPayslipPdfInput,
  type PayslipApiRow,
} from '~/features/hr/payslip-mappers';
import type { UserAdjustment, UserPayoutRecord } from './types';

export interface UserPayrollHistoryPageProps {
  userId: string;
  userName: string;
  payouts: UserPayoutRecord[];
  adjustments: UserAdjustment[];
  filters: {
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
  };
}

function formatPeriod(start: string, end: string): string {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'Unknown period';
  const fromLabel = from.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
  const toLabel = to.toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${fromLabel} to ${toLabel}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
}

type PayslipFetcherData =
  | { ok: true; payslip: PayslipApiRow; error: null }
  | { ok: false; payslip: null; error: string };

const TABS = [
  { value: 'payouts', label: 'Payout history' },
  { value: 'adjustments', label: 'Adjustments and bonuses' },
];

export function UserPayrollHistoryPage({
  userId,
  userName,
  payouts,
  adjustments,
  filters,
}: UserPayrollHistoryPageProps) {
  const payslipFetcher = useFetcher<PayslipFetcherData>();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [viewingPayoutId, setViewingPayoutId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'payouts' | 'adjustments'>('payouts');

  const openPayslip = useCallback(
    (payoutId: string) => {
      setViewingPayoutId(payoutId);
      void payslipFetcher.load(`/api/hr-payslip/${payoutId}`);
    },
    [payslipFetcher],
  );

  const viewingRow =
    payslipFetcher.data?.ok &&
    viewingPayoutId &&
    payslipFetcher.data.payslip?.payout.id === viewingPayoutId
      ? payslipFetcher.data.payslip
      : null;
  const viewingPdf = viewingRow ? toPayslipPdfInput(viewingRow) : null;
  const viewingBusy =
    !!viewingPayoutId &&
    (payslipFetcher.state === 'loading' ||
      payslipFetcher.state === 'submitting' ||
      !payslipFetcher.data ||
      (payslipFetcher.data.ok && payslipFetcher.data.payslip.payout.id !== viewingPayoutId));
  const viewingError =
    !!viewingPayoutId &&
    payslipFetcher.state === 'idle' &&
    payslipFetcher.data &&
    !payslipFetcher.data.ok
      ? payslipFetcher.data.error
      : null;

  const handleDownload = useCallback(async (row: PayslipApiRow) => {
    setDownloadingId(row.payout.id);
    try {
      await downloadPayslipPdf(toPayslipPdfInput(row), payslipFilename(row));
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const payoutColumns = useMemo(
    (): CompactTableColumn<UserPayoutRecord>[] => [
      {
        key: 'period',
        header: 'Period',
        hideable: false,
        render: (p) => (
          <span className="text-sm text-app-fg">{formatPeriod(p.periodStart, p.periodEnd)}</span>
        ),
      },
      {
        key: 'gross',
        header: 'Gross',
        align: 'right',
        render: (p) => <NairaPrice amount={Number(p.grossAmount)} />,
      },
      {
        key: 'deductions',
        header: 'Deductions',
        align: 'right',
        render: (p) =>
          Number(p.deductions) > 0 ? (
            <span className="text-danger-600 dark:text-danger-400">
              <NairaPrice amount={-Number(p.deductions)} />
            </span>
          ) : (
            <span className="text-app-fg-muted">None</span>
          ),
      },
      {
        key: 'net',
        header: 'Net',
        align: 'right',
        render: (p) => (
          <span className="font-semibold text-app-fg">
            <NairaPrice amount={Number(p.netAmount)} />
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (p) => <StatusBadge status={p.status} size="sm" />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        hideable: false,
        render: (p) =>
          p.status === 'PAID' ? (
            <CompactTableActionButton onClick={() => openPayslip(p.id)}>View</CompactTableActionButton>
          ) : (
            <span className="text-xs text-app-fg-muted">Pending</span>
          ),
      },
    ],
    [openPayslip],
  );

  const adjustmentColumns = useMemo(
    (): CompactTableColumn<UserAdjustment>[] => [
      {
        key: 'type',
        header: 'Type',
        hideable: false,
        render: (adj) => <StatusBadge status={adj.type} label={adj.type.replace(/_/g, ' ')} size="sm" />,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (adj) => {
          const isDeduction = adj.type === 'DEDUCTION' || adj.type === 'CLAWBACK';
          return (
            <span
              className={
                isDeduction
                  ? 'text-danger-600 dark:text-danger-400 font-medium'
                  : 'text-success-600 dark:text-success-400 font-medium'
              }
            >
              {isDeduction ? '' : '+'}
              <NairaPrice amount={isDeduction ? -Math.abs(Number(adj.amount)) : Number(adj.amount)} />
            </span>
          );
        },
      },
      {
        key: 'reason',
        header: 'Reason',
        render: (adj) => (
          <span className="text-sm text-app-fg-muted max-w-[220px] truncate" title={adj.reason || undefined}>
            {adj.reason || 'No reason'}
          </span>
        ),
        cellTitle: (adj) => adj.reason || undefined,
      },
      {
        key: 'status',
        header: 'Status',
        render: (adj) => <StatusBadge status={adj.status} size="sm" />,
      },
      {
        key: 'date',
        header: 'Date',
        render: (adj) => (
          <span className="text-sm text-app-fg-muted tabular-nums">{formatShortDate(adj.createdAt)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="History"
        backTo={`/hr/users/${userId}`}
        mobileInlineActions
        description={`Payout and adjustment records for ${userName}.`}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="History toolbar"
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
              </div>
            }
            sheet={() => null}
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as 'payouts' | 'adjustments')}
        tabs={TABS}
      />

      {activeTab === 'payouts' && (
        <>
          {payouts.length === 0 ? (
            <EmptyState
              title="No payout records"
              description="Payouts appear after payroll batches include this staff member."
            />
          ) : (
            <CompactTable<UserPayoutRecord>
              columnVisibilityKey="hr.users.history.payouts"
              columns={payoutColumns}
              rows={payouts}
              rowKey={(p) => p.id}
              emptyTitle="No payout records"
              emptyDescription=""
              renderMobileCard={(p) => (
                <button
                  type="button"
                  disabled={p.status !== 'PAID'}
                  onClick={() => p.status === 'PAID' && openPayslip(p.id)}
                  className="w-full text-left rounded-lg border border-app-border bg-app-elevated p-4 space-y-2 hover:bg-app-hover transition-colors disabled:hover:bg-app-elevated disabled:opacity-80"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-app-fg">{formatPeriod(p.periodStart, p.periodEnd)}</p>
                    <StatusBadge status={p.status} size="sm" />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-app-fg-muted">Net</span>
                    <span className="font-semibold text-app-fg">
                      <NairaPrice amount={Number(p.netAmount)} />
                    </span>
                  </div>
                  {p.status === 'PAID' ? (
                    <p className="text-xs text-app-fg-muted">Tap to view payslip</p>
                  ) : null}
                </button>
              )}
            />
          )}
        </>
      )}

      {activeTab === 'adjustments' && (
        <>
          {adjustments.length === 0 ? (
            <EmptyState
              title="No adjustments"
              description="HR adjustments for this staff member will show here."
            />
          ) : (
            <CompactTable<UserAdjustment>
              columnVisibilityKey="hr.users.history.adjustments"
              columns={adjustmentColumns}
              rows={adjustments}
              rowKey={(adj) => adj.id}
              emptyTitle="No adjustments"
              emptyDescription=""
              renderMobileCard={(adj) => {
                const isDeduction = adj.type === 'DEDUCTION' || adj.type === 'CLAWBACK';
                return (
                  <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <StatusBadge status={adj.type} label={adj.type.replace(/_/g, ' ')} size="sm" />
                      <StatusBadge status={adj.status} size="sm" />
                    </div>
                    <p className="text-sm text-app-fg-muted">{adj.reason || 'No reason'}</p>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-app-fg-muted">{formatShortDate(adj.createdAt)}</span>
                      <span
                        className={
                          isDeduction
                            ? 'font-semibold text-danger-600 dark:text-danger-400'
                            : 'font-semibold text-success-600 dark:text-success-400'
                        }
                      >
                        {isDeduction ? '' : '+'}
                        <NairaPrice
                          amount={isDeduction ? -Math.abs(Number(adj.amount)) : Number(adj.amount)}
                        />
                      </span>
                    </div>
                  </div>
                );
              }}
            />
          )}
        </>
      )}

      {viewingPdf ? (
        <PayslipPreviewModal
          payslip={viewingPdf}
          title={`View · ${viewingPdf.employeeName} · ${viewingPdf.periodLabel}`}
          downloading={downloadingId === viewingRow?.payout.id}
          onDownload={viewingRow ? () => void handleDownload(viewingRow) : undefined}
          onClose={() => setViewingPayoutId(null)}
        />
      ) : viewingPayoutId ? (
        <Modal
          open
          onClose={() => setViewingPayoutId(null)}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-app-fg">Payslip</h2>
          {viewingBusy ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : (
            <InlineNotification
              variant="danger"
              message={viewingError ?? 'Payslip could not be loaded.'}
            />
          )}
        </Modal>
      ) : null}
    </div>
  );
}
