import { useCallback, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Tabs } from '~/components/ui/tabs';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { useFetcherToast } from '~/components/ui/toast';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { HistoryEntry } from '~/features/orders/types';
import type { BranchOption, ContractorPayoutRow, PayrollContractor } from './payroll-prd-types';
import { DEPT_LABEL } from './payroll-constants';
import type { PayrollDepartment } from './types';

export interface PayrollContractorDetailPageProps {
  contractor: PayrollContractor;
  payouts: ContractorPayoutRow[];
  payoutTotal: number;
  history: HistoryEntry[];
  branches: BranchOption[];
  canWrite: boolean;
}

function formatPeriod(month: string): string {
  const d = new Date(month);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const seconds = Math.floor((Date.now() - t) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function maskAccount(accountNumber: string | null): string {
  if (!accountNumber) return 'Not set';
  if (accountNumber.length <= 4) return accountNumber;
  return `****${accountNumber.slice(-4)}`;
}

function deptLabel(department: string): string {
  return DEPT_LABEL[department as PayrollDepartment] ?? department;
}

function computeDiff(
  older: Record<string, unknown>,
  newer: Record<string, unknown>,
): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  const skip = new Set([
    'valid_from',
    'valid_to',
    'valid_period',
    'changed_by',
    'modified_by',
    'updated_at',
    'created_at',
    '_table_name',
    '_row_data',
  ]);
  const allKeys = new Set([...Object.keys(older), ...Object.keys(newer)]);
  const diffs: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
  for (const key of allKeys) {
    if (skip.has(key)) continue;
    if (JSON.stringify(older[key]) !== JSON.stringify(newer[key])) {
      diffs.push({ field: key, oldValue: older[key], newValue: newer[key] });
    }
  }
  return diffs;
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '(empty)';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function ContractorHistoryTimeline({ history }: { history: HistoryEntry[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (history.length === 0) {
    return (
      <EmptyState
        title="No change history"
        description="Edits to fee, bank, or status will appear here."
        variant="inline"
        bordered={false}
      />
    );
  }

  const chronological = [...history].reverse();

  return (
    <div className="relative">
      <div className="absolute left-3 top-2 bottom-2 w-px bg-app-hover" />
      <div className="space-y-0">
        {history.map((entry, idx) => {
          const chronIdx = chronological.findIndex((e) => e.validFrom === entry.validFrom);
          const prevEntry = chronIdx > 0 ? chronological[chronIdx - 1] : null;
          const diffs = prevEntry ? computeDiff(prevEntry.data, entry.data) : [];
          const isExpanded = expandedIdx === idx;
          const isFirst = chronIdx === 0;

          return (
            <div key={`${entry.validFrom}-${idx}`} className="relative pl-8 py-2">
              <div
                className={`absolute left-[7px] top-3.5 w-[10px] h-[10px] rounded-full border-2 border-app-elevated ${
                  isFirst ? 'bg-emerald-500' : 'bg-app-border'
                }`}
              />
              <button
                type="button"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                className="w-full text-left hover:bg-app-hover/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-app-fg-muted">{entry.action}</span>
                  <span className="text-mini text-app-fg-muted tabular-nums flex-shrink-0">
                    {timeAgo(entry.validFrom)}
                  </span>
                </div>
                {entry.changedBy ? (
                  <p className="text-mini text-app-fg-muted mt-0.5">by {entry.changedBy}</p>
                ) : null}
              </button>
              {isExpanded && diffs.length > 0 ? (
                <div className="mt-1.5 ml-2 bg-app-hover rounded-lg p-2.5 text-xs space-y-1">
                  {diffs.map((d) => (
                    <div key={d.field} className="flex items-start gap-2">
                      <span className="font-mono text-app-fg-muted min-w-[100px] flex-shrink-0">
                        {d.field.replace(/_/g, ' ')}
                      </span>
                      <span className="text-red-500 dark:text-red-400 line-through">{formatValue(d.oldValue)}</span>
                      <span className="text-app-fg-muted">&rarr;</span>
                      <span className="text-emerald-600 dark:text-emerald-400">{formatValue(d.newValue)}</span>
                    </div>
                  ))}
                  <p className="text-micro text-app-fg-muted pt-1 border-t border-app-border tabular-nums">
                    {formatDate(entry.validFrom)}
                  </p>
                </div>
              ) : null}
              {isExpanded && diffs.length === 0 && isFirst ? (
                <div className="mt-1.5 ml-2 bg-app-hover rounded-lg p-2.5 text-xs text-app-fg-muted">
                  Initial record creation: {formatDate(entry.validFrom)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PayrollContractorDetailPage({
  contractor,
  payouts,
  payoutTotal,
  history,
  branches,
  canWrite,
}: PayrollContractorDetailPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [showEdit, setShowEdit] = useState(false);
  const [activeTab, setActiveTab] = useState<'payments' | 'changes'>('payments');

  useFetcherToast(fetcher.data, {
    successMessage: 'Contractor saved',
    skipErrorToast: showEdit,
  });

  const handleSuccess = useCallback(() => setShowEdit(false), []);
  useCloseOnFetcherSuccess(fetcher, handleSuccess, { intent: 'updateContractor' });

  const branchName = useMemo(() => {
    if (!contractor.branchId) return 'All branches';
    return branches.find((b) => b.id === contractor.branchId)?.name ?? 'Unknown branch';
  }, [branches, contractor.branchId]);

  const paidTotal = useMemo(
    () =>
      payouts
        .filter((p) => p.payoutStatus === 'PAID' || p.batchStatus === 'PAID')
        .reduce((sum, p) => sum + Number(p.totalPayout || p.netPay || p.monthlyFee || 0), 0),
    [payouts],
  );

  const columns: CompactTableColumn<ContractorPayoutRow>[] = useMemo(
    () => [
      {
        key: 'period',
        header: 'Period',
        hideable: false,
        render: (row) => <span className="font-medium text-app-fg">{formatPeriod(row.periodMonth)}</span>,
      },
      {
        key: 'department',
        header: 'Dept',
        render: (row) => <span className="text-app-fg-muted">{deptLabel(row.department)}</span>,
      },
      {
        key: 'branch',
        header: 'Branch',
        render: (row) => <span className="text-app-fg-muted">{row.branchName}</span>,
      },
      {
        key: 'fee',
        header: 'Fee',
        align: 'right',
        render: (row) => <NairaPrice amount={Number(row.monthlyFee || row.totalPayout)} />,
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.payoutStatus || row.batchStatus} />,
      },
      {
        key: 'paid',
        header: 'Paid',
        render: (row) => (
          <span className="text-app-fg-muted tabular-nums">
            {row.disbursementDate || row.financeProcessedAt
              ? formatDate(row.disbursementDate ?? row.financeProcessedAt)
              : 'Not paid'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) => (
          <CompactTableActionButton to={`/hr/payroll-batch/${row.batchId}`} tone="brand">
            Batch
          </CompactTableActionButton>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={contractor.name}
        backTo="/hr/payroll/contractors"
        mobileInlineActions
        description={`${contractor.jobTitle ? contractor.jobTitle + ' · ' : ''}Agency contractor · ${branchName}`}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Contractor detail toolbar"
            desktop={
              <div className="flex items-center gap-2 flex-wrap">
                <PageRefreshButton />
                <StatusBadge status={contractor.active ? 'ACTIVE' : 'INACTIVE'} />
                {canWrite ? (
                  <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
                    Edit
                  </Button>
                ) : null}
              </div>
            }
            sheet={({ closeSheet }) =>
              canWrite ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-12 w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowEdit(true);
                  }}
                >
                  Edit
                </Button>
              ) : null
            }
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Job title', value: contractor.jobTitle || 'Not set' },
          { label: 'Branch', value: branchName },
          { label: 'Monthly fee', value: <NairaPrice amount={Number(contractor.monthlyFee)} /> },
          { label: 'Bank', value: contractor.bankName ?? 'Not set' },
          {
            label: 'Account',
            value: `${contractor.accountName ?? 'Not set'} · ${maskAccount(contractor.accountNumber)}`,
          },
          { label: 'Payments', value: payoutTotal },
          { label: 'Paid total', value: <NairaPrice amount={paidTotal} /> },
          ...(contractor.notes
            ? [{ label: 'Notes', value: contractor.notes, itemClassName: 'sm:col-span-full' as const }]
            : []),
        ]}
      />

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'payments', label: 'Payment history', badge: payoutTotal > 0 ? <span className="ml-1 rounded-full bg-app-hover px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{payoutTotal}</span> : undefined },
          { value: 'changes', label: 'Change history', badge: history.length > 0 ? <span className="ml-1 rounded-full bg-app-hover px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{history.length}</span> : undefined },
        ]}
      />

      {activeTab === 'payments' && (
        <div className="list-panel p-0">
          {payouts.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No payments yet"
                description="Include this contractor when generating a payroll batch to create payment lines."
              />
            </div>
          ) : (
            <CompactTable<ContractorPayoutRow>
              withCard={false}
              columnVisibilityKey="hr.payroll.contractor.payouts"
              columns={columns}
              rows={payouts}
              rowKey={(r) => r.payoutId}
              emptyTitle="No payments"
              emptyDescription=""
              renderMobileCard={(row) => (
                <Link
                  to={`/hr/payroll-batch/${row.batchId}`}
                  className="block p-4 space-y-3 hover:bg-app-hover transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-app-fg text-sm">{formatPeriod(row.periodMonth)}</p>
                      <p className="text-xs text-app-fg-muted mt-0.5">
                        {deptLabel(row.department)} · {row.branchName}
                      </p>
                    </div>
                    <StatusBadge status={row.payoutStatus || row.batchStatus} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-app-fg-muted">
                      {row.disbursementDate || row.financeProcessedAt
                        ? formatDate(row.disbursementDate ?? row.financeProcessedAt)
                        : 'Not paid'}
                    </span>
                    <span className="font-semibold text-app-fg">
                      <NairaPrice amount={Number(row.monthlyFee || row.totalPayout)} />
                    </span>
                  </div>
                </Link>
              )}
            />
          )}
        </div>
      )}

      {activeTab === 'changes' && (
        <div className="list-panel p-0">
          <div className="p-4">
            <ContractorHistoryTimeline history={history} />
          </div>
        </div>
      )}

      {showEdit ? (
        <EditContractorModal
          contractor={contractor}
          branches={branches}
          submitting={fetcher.state === 'submitting'}
          error={surface.errorMatchingIntent('updateContractor') ?? undefined}
          fetcher={fetcher}
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowEdit(false);
          }}
        />
      ) : null}
    </div>
  );
}

function EditContractorModal({
  contractor,
  branches,
  submitting,
  error,
  fetcher,
  onClose,
}: {
  contractor: PayrollContractor;
  branches: BranchOption[];
  submitting: boolean;
  error?: string;
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" backdropBlur contentClassName="p-6 sm:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-app-fg">Edit contractor</h3>
        <button type="button" onClick={onClose} className="text-app-fg-muted hover:text-app-fg p-1 -m-1" aria-label="Close">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <ModalFetcherInlineError message={error} />

      <fetcher.Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="updateContractor" />
        <input type="hidden" name="contractorId" value={contractor.id} />

        <TextInput label="Name" name="name" required defaultValue={contractor.name} />
        <TextInput
          label="Job title"
          name="jobTitle"
          placeholder="e.g. IT Support, Cleaning Services"
          defaultValue={contractor.jobTitle ?? ''}
        />
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Monthly fee (₦)</label>
          <AmountInput name="monthlyFee" className="input" defaultValue={String(Number(contractor.monthlyFee))} />
        </div>
        <FormSelect
          label="Branch (optional)"
          name="branchId"
          defaultValue={contractor.branchId ?? ''}
          options={[
            { value: '', label: 'No branch' },
            ...branches.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
        <TextInput label="Bank name" name="bankName" defaultValue={contractor.bankName ?? ''} />
        <TextInput label="Bank code" name="bankCode" defaultValue={contractor.bankCode ?? ''} />
        <TextInput
          label="Account number"
          name="accountNumber"
          maxLength={10}
          defaultValue={contractor.accountNumber ?? ''}
        />
        <TextInput label="Account name" name="accountName" defaultValue={contractor.accountName ?? ''} />
        <TextInput label="Notes" name="notes" defaultValue={contractor.notes ?? ''} />

        <div className="flex gap-2 pt-1">
          <Button type="submit" variant="primary" size="sm" loading={submitting} loadingText="Saving…">
            Save contractor
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
