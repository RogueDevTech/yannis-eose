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
import { BankSelect } from '~/components/ui/bank-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { NairaPrice } from '~/components/ui/naira-price';
import { Tabs } from '~/components/ui/tabs';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { HistoryEntry } from '~/features/orders/types';
import type { ActorMap } from '~/features/audit/types';
import { getActorDisplay } from '~/features/audit/audit-entry-summary';
import type { BranchOption, ContractorPayoutRow, PayrollContractor } from './payroll-prd-types';
import { DateTimeText } from '~/components/ui/date-time-text';
import { formatDateOnly, formatOrderTimestamp } from '~/lib/format-date';
import { formatNaira } from '~/lib/format-amount';
import { DEPT_LABEL } from './payroll-constants';
import type { PayrollDepartment } from './types';

export interface PayrollContractorDetailPageProps {
  contractor: PayrollContractor;
  payouts: ContractorPayoutRow[];
  payoutTotal: number;
  history: HistoryEntry[];
  actorNames: ActorMap;
  branches: BranchOption[];
  canWrite: boolean;
  filters: {
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
  };
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  job_title: 'Job title',
  monthly_fee: 'Monthly fee',
  branch_id: 'Branch',
  bank_name: 'Bank',
  bank_code: 'Bank code',
  account_number: 'Account number',
  account_name: 'Account name',
  bank_verified: 'Bank verified',
  active: 'Status',
  notes: 'Notes',
  group_id: 'Company',
};

const SKIP_FIELDS = new Set([
  'id',
  'valid_from',
  'valid_to',
  'valid_period',
  'changed_by',
  'modified_by',
  'updated_at',
  'created_at',
  '_table_name',
  '_row_data',
  'group_id',
]);

function formatPeriod(month: string): string {
  const d = new Date(month);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  return formatOrderTimestamp(iso);
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

function formatAccount(accountNumber: string | null | undefined): string {
  if (!accountNumber) return 'Not set';
  return accountNumber;
}

function deptLabel(department: string): string {
  return DEPT_LABEL[department as PayrollDepartment] ?? department;
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

function computeDiff(
  older: Record<string, unknown>,
  newer: Record<string, unknown>,
): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  const allKeys = new Set([...Object.keys(older), ...Object.keys(newer)]);
  const diffs: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
  for (const key of allKeys) {
    if (SKIP_FIELDS.has(key)) continue;
    if (JSON.stringify(older[key]) !== JSON.stringify(newer[key])) {
      diffs.push({ field: key, oldValue: older[key], newValue: newer[key] });
    }
  }
  return diffs;
}

function formatFieldValue(
  field: string,
  val: unknown,
  branches: BranchOption[],
): string {
  if (val === null || val === undefined || val === '') return '(empty)';
  if (field === 'monthly_fee') {
    const n = Number(val);
    return Number.isFinite(n) ? formatNaira(n) : String(val);
  }
  if (field === 'account_number') return formatAccount(String(val));
  if (field === 'branch_id') {
    const id = String(val);
    if (!id) return 'All branches';
    return branches.find((b) => b.id === id)?.name ?? id.slice(0, 8) + '…';
  }
  if (field === 'active' || field === 'bank_verified') {
    if (val === true || val === 'true') return field === 'active' ? 'Active' : 'Verified';
    if (val === false || val === 'false') return field === 'active' ? 'Inactive' : 'Not verified';
  }
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function changeSummary(diffs: Array<{ field: string }>): string {
  if (diffs.length === 0) return 'Record updated';
  const labels = diffs.map((d) => fieldLabel(d.field));
  if (labels.length === 1) return `Changed ${labels[0]}`;
  if (labels.length === 2) return `Changed ${labels[0]} and ${labels[1]}`;
  return `Changed ${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`;
}

function ContractorHistoryTimeline({
  history,
  actorNames,
  branches,
}: {
  history: HistoryEntry[];
  actorNames: ActorMap;
  branches: BranchOption[];
}) {
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

  // Newest-first display; previous version is the next older row.
  const chronological = [...history].slice().reverse();

  return (
    <div className="relative">
      <div className="absolute left-3 top-2 bottom-2 w-px bg-app-hover" />
      <div className="space-y-0">
        {history.map((entry, idx) => {
          const chronIdx = chronological.length - 1 - idx;
          const prevEntry = chronIdx > 0 ? chronological[chronIdx - 1] : null;
          const diffs = prevEntry ? computeDiff(prevEntry.data, entry.data) : [];
          const isCreate = !prevEntry;
          const actor = getActorDisplay(entry.changedBy, actorNames, entry.validFrom);
          const title = isCreate
            ? 'Contractor created'
            : diffs.length > 0
              ? changeSummary(diffs)
              : entry.action === 'DELETE'
                ? 'Contractor deleted'
                : 'Record updated';

          return (
            <div key={`${entry.id}-${entry.validFrom}-${idx}`} className="relative pl-8 py-3">
              <div
                className={`absolute left-[7px] top-4 w-[10px] h-[10px] rounded-full border-2 border-app-elevated ${
                  isCreate ? 'bg-emerald-500' : 'bg-brand-500'
                }`}
              />
              <div className="rounded-lg border border-app-border bg-app-card/40 px-3 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-fg">{title}</p>
                    <p className="text-xs text-app-fg-muted mt-0.5">
                      by {actor}
                      <span className="mx-1.5 text-app-border">·</span>
                      <span className="tabular-nums">{timeAgo(entry.validFrom)}</span>
                    </p>
                  </div>
                  <span className="text-micro text-app-fg-muted tabular-nums shrink-0 pt-0.5">
                    {formatDate(entry.validFrom)}
                  </span>
                </div>

                {diffs.length > 0 ? (
                  <ul className="space-y-1.5 pt-1 border-t border-app-border">
                    {diffs.map((d) => (
                      <li key={d.field} className="text-xs">
                        <span className="font-medium text-app-fg">{fieldLabel(d.field)}</span>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-app-fg-muted">
                          <span className="line-through text-danger-600 dark:text-danger-400">
                            {formatFieldValue(d.field, d.oldValue, branches)}
                          </span>
                          <span aria-hidden>→</span>
                          <span className="text-success-600 dark:text-success-400 font-medium">
                            {formatFieldValue(d.field, d.newValue, branches)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : isCreate ? (
                  <p className="text-xs text-app-fg-muted pt-1 border-t border-app-border">
                    Initial contractor record.
                  </p>
                ) : (
                  <p className="text-xs text-app-fg-muted pt-1 border-t border-app-border">
                    No field-level differences detected for this version.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 sm:block sm:space-y-0.5">
      <dt className="text-xs text-app-fg-muted">{label}</dt>
      <dd className="text-sm font-medium text-app-fg text-right sm:text-left break-words">{value}</dd>
    </div>
  );
}

export function PayrollContractorDetailPage({
  contractor,
  payouts,
  payoutTotal,
  history,
  actorNames,
  branches,
  canWrite,
  filters,
}: PayrollContractorDetailPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [showEdit, setShowEdit] = useState(false);
  const [showActiveConfirm, setShowActiveConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'payments' | 'changes'>('payments');

  useFetcherToast(fetcher.data, {
    successMessage: fetcher.data?.message ?? 'Contractor saved',
    skipErrorToast: showEdit || showActiveConfirm,
  });

  const handleEditSuccess = useCallback(() => setShowEdit(false), []);
  useCloseOnFetcherSuccess(fetcher, handleEditSuccess, { intent: 'updateContractor' });

  const handleActiveSuccess = useCallback(() => setShowActiveConfirm(false), []);
  useCloseOnFetcherSuccess(fetcher, handleActiveSuccess, { intent: 'setContractorActive' });

  const submitActiveChange = useCallback(() => {
    fetcher.submit(
      {
        intent: 'setContractorActive',
        contractorId: contractor.id,
        active: contractor.active ? 'false' : 'true',
      },
      { method: 'post' },
    );
  }, [contractor.active, contractor.id, fetcher]);

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
        render: (row) =>
          row.financeProcessedAt ? (
            <DateTimeText at={row.financeProcessedAt} className="text-sm" />
          ) : row.disbursementDate ? (
            <span className="text-sm text-app-fg tabular-nums">{formatDateOnly(row.disbursementDate)}</span>
          ) : (
            <span className="text-app-fg-muted">Not paid</span>
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

  const accountLine =
    contractor.accountName || contractor.accountNumber
      ? `${contractor.accountName ?? 'Unnamed'} · ${formatAccount(contractor.accountNumber)}`
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={contractor.name}
        backTo={
          contractor.active
            ? '/hr/payroll/contractors'
            : '/hr/payroll/contractors?status=inactive'
        }
        mobileInlineActions
        description={
          [contractor.jobTitle || null, 'Agency contractor', branchName].filter(Boolean).join(' · ')
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Contractor detail toolbar"
            desktop={
              <div className="flex items-center gap-2 flex-wrap">
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
                <StatusBadge status={contractor.active ? 'ACTIVE' : 'INACTIVE'} />
                {canWrite ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
                      Edit
                    </Button>
                    <Button
                      variant={contractor.active ? 'danger' : 'secondary'}
                      size="sm"
                      onClick={() => setShowActiveConfirm(true)}
                    >
                      {contractor.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </>
                ) : null}
              </div>
            }
            sheet={({ closeSheet }) =>
              canWrite ? (
                <>
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
                  <Button
                    variant={contractor.active ? 'danger' : 'secondary'}
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowActiveConfirm(true);
                    }}
                  >
                    {contractor.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </>
              ) : null
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
        actionsSheet={
          canWrite ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="h-12 w-full justify-center"
                onClick={() => setShowEdit(true)}
              >
                Edit
              </Button>
              <Button
                variant={contractor.active ? 'danger' : 'secondary'}
                size="sm"
                className="h-12 w-full justify-center"
                onClick={() => setShowActiveConfirm(true)}
              >
                {contractor.active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </>
          ) : undefined
        }
        actionsSheetTitle="Actions"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-app-fg">Pay & bank</h3>
          <dl className="grid gap-2.5 sm:grid-cols-2 text-sm">
            <DetailRow
              label="Monthly fee"
              value={<NairaPrice amount={Number(contractor.monthlyFee)} />}
            />
            <DetailRow label="Branch" value={branchName} />
            {contractor.bankName ? <DetailRow label="Bank" value={contractor.bankName} /> : null}
            {accountLine ? <DetailRow label="Account" value={accountLine} /> : null}
            <DetailRow
              label="Payments"
              value={
                <span className="tabular-nums">
                  {payoutTotal} · <NairaPrice amount={paidTotal} /> paid
                </span>
              }
            />
          </dl>
        </div>
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-app-fg">Profile</h3>
          <dl className="grid gap-2.5 text-sm">
            {contractor.jobTitle ? (
              <DetailRow label="Job title" value={contractor.jobTitle} />
            ) : (
              <DetailRow label="Job title" value={<span className="text-app-fg-muted font-normal">Not set</span>} />
            )}
            {contractor.notes ? (
              <DetailRow label="Notes" value={contractor.notes} />
            ) : (
              <p className="text-xs text-app-fg-muted">No notes on this contractor.</p>
            )}
          </dl>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          {
            value: 'payments',
            label: 'Payment history',
            badge:
              payoutTotal > 0 ? (
                <span className="ml-1 rounded-full bg-app-hover px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {payoutTotal}
                </span>
              ) : undefined,
          },
          {
            value: 'changes',
            label: 'Change history',
            badge:
              history.length > 0 ? (
                <span className="ml-1 rounded-full bg-app-hover px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {history.length}
                </span>
              ) : undefined,
          },
        ]}
      />

      {activeTab === 'payments' && (
        <div className="list-panel p-0">
          {payouts.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={filters.periodAllTime ? 'No payments yet' : 'No payments in this period'}
                description={
                  filters.periodAllTime
                    ? 'Include this contractor when generating a payroll batch to create payment lines.'
                    : 'Try widening the date range or switch to All time.'
                }
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
                    <span>
                      {row.financeProcessedAt ? (
                        <DateTimeText at={row.financeProcessedAt} className="text-sm" />
                      ) : row.disbursementDate ? (
                        formatDateOnly(row.disbursementDate)
                      ) : (
                        <span className="text-app-fg-muted">Not paid</span>
                      )}
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
            <ContractorHistoryTimeline
              history={history}
              actorNames={actorNames}
              branches={branches}
            />
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

      <ConfirmActionModal
        open={showActiveConfirm}
        onClose={() => {
          if (fetcher.state !== 'idle') return;
          setShowActiveConfirm(false);
        }}
        title={contractor.active ? 'Deactivate contractor' : 'Reactivate contractor'}
        description={
          contractor.active
            ? `Deactivate "${contractor.name}"? They will leave the active list and will not be included in new payroll batches. You can reactivate them later from Inactive.`
            : `Reactivate "${contractor.name}"? They will appear on the active list and can be included in payroll batches again.`
        }
        confirmLabel={contractor.active ? 'Deactivate' : 'Reactivate'}
        variant={contractor.active ? 'danger' : 'warning'}
        loading={fetcher.state !== 'idle'}
        error={surface.errorMatchingIntent('setContractorActive')}
        onConfirm={submitActiveChange}
      />
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
        <BankSelect
          id={`contractor-detail-bank-${contractor.id}`}
          defaultBankName={contractor.bankName}
          defaultBankCode={contractor.bankCode}
          nameBankName="bankName"
          nameBankCode="bankCode"
          label="Bank"
          hint="Search and pick a bank. Bank code fills in automatically."
        />
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
