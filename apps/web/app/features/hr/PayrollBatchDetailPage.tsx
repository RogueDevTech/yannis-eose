import { useCallback, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { formatRoleLabel } from '~/components/ui/role-badge';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { AmountInput } from '~/components/ui/amount-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { useFetcherToast } from '~/components/ui/toast';
import type { PayrollBatch, ViewerInfo } from './types';
import { ADMIN_ROLES, DEPT_LABEL } from './payroll-constants';

// ── Types ──────────────────────────────────────────────────────

export interface BatchDetail {
  batch: PayrollBatch;
  payouts: Array<{
    id: string;
    staffId: string;
    staffName: string;
    staffRole: string | null;
    baseSalary: string;
    performanceBonus: string;
    addOnsTotal: string;
    deductionsTotal: string;
    totalPayout: string;
    grossPay?: string;
    payeTax?: string;
    netPay?: string;
    lineStatus?: string;
    metricsSnapshot?: unknown;
    bonusBreakdown?: unknown;
    status: string;
    payoutBankName?: string | null;
    payoutAccountName?: string | null;
    payoutAccountNumber?: string | null;
    payoutBankCode?: string | null;
  }>;
  adjustments: Array<{
    id: string;
    payoutId: string | null;
    amount: string;
    category: string;
    reason: string;
    createdAt: string;
  }>;
  allowedTransitions: string[];
}

type BatchPayoutLine = BatchDetail['payouts'][number];

// ── Helpers ────────────────────────────────────────────────────

function formatMonth(periodMonth: string): string {
  const [yyyy, mm] = periodMonth.split('-');
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, 1));
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function canReview(viewer: ViewerInfo): boolean {
  return ADMIN_ROLES.has(viewer.role) || viewer.role === 'HR_MANAGER';
}

function canPrepareDept(viewer: ViewerInfo, dept: string, branchId: string): boolean {
  if (ADMIN_ROLES.has(viewer.role)) return true;
  if (viewer.role === 'HR_MANAGER') return true;
  if (viewer.prepareDepartments?.includes(dept as never) && viewer.prepareBranchIds?.includes(branchId)) return true;
  return false;
}

// ── Column builder ─────────────────────────────────────────────

function buildBatchPayoutColumns(args: {
  batch: BatchDetail['batch'];
  adjustmentsByPayout: Map<string, BatchDetail['adjustments']>;
  viewer: ViewerInfo;
  onAdjust: (payoutId: string, staffName: string) => void;
}): CompactTableColumn<BatchPayoutLine>[] {
  const { batch, adjustmentsByPayout, viewer, onAdjust } = args;
  const cols: CompactTableColumn<BatchPayoutLine>[] = [
    {
      key: 'staff',
      header: 'Staff',
      render: (p) => {
        const adj = adjustmentsByPayout.get(p.id) ?? [];
        return (
          <div>
            <p className="font-medium text-app-fg">{p.staffName}</p>
            <p className="text-xs text-app-fg-muted">{p.staffRole ? formatRoleLabel(p.staffRole) : ''}</p>
            {adj.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {adj.map((a) => (
                  <li key={a.id} className="text-xs text-app-fg-muted">
                    <span className={Number(a.amount) < 0 ? 'text-danger-600' : 'text-success-600'}>
                      {Number(a.amount) < 0 ? '\u2212' : '+'}
                      <NairaPrice amount={Math.abs(Number(a.amount))} />
                    </span>
                    <span className="ml-1 text-app-fg-muted">
                      {'\u00b7'} {a.category} {'\u00b7'} {a.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      },
    },
    {
      key: 'base',
      header: 'Base',
      align: 'right',
      nowrap: true,
      render: (p) => <NairaPrice amount={Number(p.baseSalary)} />,
    },
    {
      key: 'bonus',
      header: 'Bonus',
      align: 'right',
      nowrap: true,
      cellClassName: 'text-success-600 dark:text-success-400',
      render: (p) => <NairaPrice amount={Number(p.performanceBonus)} />,
    },
    {
      key: 'addons',
      header: 'Add-ons',
      align: 'right',
      nowrap: true,
      cellClassName: 'text-brand-600 dark:text-brand-400',
      render: (p) => <NairaPrice amount={Number(p.addOnsTotal)} />,
    },
    {
      key: 'deductions',
      header: 'Deductions',
      align: 'right',
      nowrap: true,
      cellClassName: 'text-danger-600 dark:text-danger-400',
      render: (p) =>
        Number(p.deductionsTotal) > 0 ? (
          <>
            {'\u2212'}<NairaPrice amount={Number(p.deductionsTotal)} />
          </>
        ) : (
          '\u2014'
        ),
    },
    {
      key: 'gross',
      header: 'Gross',
      align: 'right',
      nowrap: true,
      render: (p) => <NairaPrice amount={Number(p.grossPay ?? p.totalPayout)} />,
    },
    {
      key: 'tax',
      header: 'PAYE',
      align: 'right',
      nowrap: true,
      cellClassName: 'text-danger-600 dark:text-danger-400',
      render: (p) =>
        Number(p.payeTax ?? 0) > 0 ? (
          <>
            {'\u2212'}<NairaPrice amount={Number(p.payeTax)} />
          </>
        ) : (
          '\u2014'
        ),
    },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      nowrap: true,
      render: (p) => (
        <span className="font-semibold">
          <NairaPrice amount={Number(p.netPay ?? p.totalPayout)} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (p) => <StatusBadge status={p.status} />,
    },
  ];
  if (batch.status === 'PENDING_HR' && canReview(viewer)) {
    cols.push({
      key: 'adjust',
      header: '',
      mobileLabel: 'Adjust',
      align: 'right',
      tight: true,
      nowrap: true,
      render: (p) => (
        <Button
          variant="secondary"
          size="sm"
          className="text-xs"
          onClick={() => onAdjust(p.id, p.staffName)}
        >
          + Adjust
        </Button>
      ),
    });
  }
  return cols;
}

// ── Status timeline ────────────────────────────────────────────

function BatchTimeline({ batch }: { batch: PayrollBatch }) {
  const stages = [
    { key: 'DRAFT' as const, label: 'Drafted', at: batch.preparedAt },
    { key: 'PENDING_HR' as const, label: 'Submitted to HR', at: batch.submittedAt },
    { key: 'PENDING_FINANCE' as const, label: 'Approved by HR', at: batch.hrReviewedAt },
    { key: 'PAID' as const, label: 'Paid by Finance', at: batch.financeProcessedAt },
  ];
  const order = ['DRAFT', 'PENDING_HR', 'PENDING_FINANCE', 'PAID'] as const;
  const currentIdx = order.indexOf(batch.status);

  return (
    <ol className="flex items-center gap-1 text-xs">
      {stages.map((s, i) => {
        const reached = i <= currentIdx;
        return (
          <li key={s.key} className="flex items-center gap-1 flex-1 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${reached ? 'bg-brand-500' : 'bg-app-border'}`}
            />
            <div className="min-w-0">
              <p className={`truncate ${reached ? 'text-app-fg font-medium' : 'text-app-fg-muted'}`}>
                {s.label}
              </p>
              {s.at && (
                <p className="text-micro text-app-fg-muted truncate">
                  {new Date(s.at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                </p>
              )}
            </div>
            {i < stages.length - 1 && (
              <span className={`flex-1 h-px ${reached && i < currentIdx ? 'bg-brand-500' : 'bg-app-border'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Main page component ────────────────────────────────────────

export function PayrollBatchDetailPage({
  detail,
  branchName,
  viewer,
}: {
  detail: BatchDetail;
  branchName: string;
  viewer: ViewerInfo;
}) {
  const fetcher = useFetcher();
  const payrollSurface = useFetcherActionSurface(fetcher);
  const [showAdjust, setShowAdjust] = useState<{ payoutId: string; staffName: string } | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [showApprove, setShowApprove] = useState(false);

  useFetcherToast(fetcher.data, { successMessage: 'Payroll updated' });

  const handleSuccess = useCallback(() => {
    setShowAdjust(null);
    setShowApprove(false);
    setShowReject(false);
    setShowMarkPaid(false);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  const { batch, payouts, adjustments, allowedTransitions } = detail;
  const adjustmentsByPayout = new Map<string, typeof adjustments>();
  for (const a of adjustments) {
    if (!a.payoutId) continue;
    const arr = adjustmentsByPayout.get(a.payoutId) ?? [];
    arr.push(a);
    adjustmentsByPayout.set(a.payoutId, arr);
  }

  const payoutColumns = buildBatchPayoutColumns({
    batch,
    adjustmentsByPayout,
    viewer,
    onAdjust: (payoutId, staffName) => setShowAdjust({ payoutId, staffName }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${DEPT_LABEL[batch.department]} \u00b7 ${formatMonth(batch.periodMonth)}`}
        backTo="/hr/payroll"
        mobileInlineActions
        description={`${branchName} \u00b7 ${batch.staffCount} staff \u00b7 Total`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={batch.status} />
          </div>
        }
      />

      {/* Status timeline */}
      <div className="card !p-4">
        <BatchTimeline batch={batch} />
      </div>

      <ModalFetcherInlineError
        message={payrollSurface.errorMatchingIntent(['submitBatch', 'generateBatch', 'addBatchAdjustment'])}
      />

      {batch.rejectionReason && (
        <div className="rounded-lg bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-3 py-2 text-sm">
          <span className="font-medium text-warning-700 dark:text-warning-300">Last rejection:</span>{' '}
          <span className="text-warning-700 dark:text-warning-300">{batch.rejectionReason}</span>
        </div>
      )}

      {/* Summary strip */}
      <div className="card !p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">{batch.staffCount} staff payouts</span>
          <span className="text-base font-semibold text-app-fg">
            Total: <NairaPrice amount={Number(batch.totalAmount)} />
          </span>
        </div>
      </div>

      {/* HR notes */}
      {batch.hrNotes && (
        <div className="rounded-lg bg-app-hover px-3 py-2 text-sm">
          <span className="font-medium text-app-fg">HR notes:</span>{' '}
          <span className="text-app-fg-muted">{batch.hrNotes}</span>
        </div>
      )}

      {batch.financeReference && (
        <div className="rounded-lg bg-success-50 dark:bg-success-700/20 px-3 py-2 text-sm">
          <span className="font-medium text-success-700 dark:text-success-300">Paid:</span>{' '}
          <span className="text-success-700 dark:text-success-300">Reference {batch.financeReference}</span>
        </div>
      )}

      {/* Payouts table */}
      <div className="card !p-0">
        <div className="px-4 py-3 border-b border-app-border">
          <h4 className="text-sm font-semibold text-app-fg">Staff payouts</h4>
          {batch.status === 'PAID' && (
            <p className="text-xs text-success-600 dark:text-success-400 mt-0.5">
              Finance marked this batch paid. Every payout below is now PAID.
            </p>
          )}
        </div>
        {payouts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No payouts in this batch"
              description="No payouts were generated. Check commission plan coverage."
            />
          </div>
        ) : (
          <CompactTable
            withCard={false}
            columns={payoutColumns}
            rows={payouts}
            rowKey={(p) => p.id}
          />
        )}
      </div>

      {/* Action buttons */}
      {(allowedTransitions.length > 0 || (batch.status === 'DRAFT' && canPrepareDept(viewer, batch.department, batch.branchId))) && (
        <div className="flex flex-wrap gap-2">
          {allowedTransitions.includes('SUBMIT') && (
            <fetcher.Form method="post" className="inline">
              <input type="hidden" name="intent" value="submitBatch" />
              <input type="hidden" name="batchId" value={batch.id} />
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'}>
                Submit to HR
              </Button>
            </fetcher.Form>
          )}
          {allowedTransitions.includes('APPROVE') && (
            <Button variant="primary" size="sm" onClick={() => setShowApprove(true)}>
              Approve & send to Finance
            </Button>
          )}
          {allowedTransitions.includes('MARK_PAID') && (
            <Button variant="success" size="sm" onClick={() => setShowMarkPaid(true)}>
              Mark Paid
            </Button>
          )}
          {allowedTransitions.includes('REJECT') && (
            <Button variant="danger" size="sm" onClick={() => setShowReject(true)}>
              Reject & send back
            </Button>
          )}
          {batch.status === 'DRAFT' && canPrepareDept(viewer, batch.department, batch.branchId) && (
            <fetcher.Form method="post" className="inline">
              <input type="hidden" name="intent" value="generateBatch" />
              <input type="hidden" name="branchId" value={batch.branchId} />
              <input type="hidden" name="department" value={batch.department} />
              <input type="hidden" name="periodMonth" value={batch.periodMonth.slice(0, 7)} />
              <Button type="submit" variant="secondary" size="sm" loading={fetcher.state === 'submitting'}>
                Re-generate from latest data
              </Button>
            </fetcher.Form>
          )}
        </div>
      )}

      {/* Sub-modals */}

      {showAdjust && (
        <Modal open onClose={() => setShowAdjust(null)} maxWidth="max-w-sm" backdropBlur contentClassName="p-5 space-y-3">
          <h4 className="text-base font-semibold text-app-fg">Adjust {showAdjust.staffName}</h4>
          <ModalFetcherInlineError message={payrollSurface.errorMatchingIntent('addBatchAdjustment')} />
          <fetcher.Form method="post" onSubmit={() => setShowAdjust(null)} className="space-y-3">
            <input type="hidden" name="intent" value="addBatchAdjustment" />
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="payoutId" value={showAdjust.payoutId} />
            <FormSelect
              label="Category"
              name="category"
              required
              options={[
                { value: 'BONUS', label: 'Bonus' },
                { value: 'EXTRA_SHIFT', label: 'Extra shift' },
                { value: 'PERFORMANCE', label: 'Performance' },
                { value: 'DEDUCTION', label: 'Deduction' },
                { value: 'OTHER', label: 'Other' },
              ]}
            />
            <AmountInput
              name="amount"
              required
              placeholder="e.g. 5,000.00 or -500"
              className="input"
              allowNegative
            />
            <TextInput label="Reason" name="reason" required minLength={5} placeholder="Why this adjustment?" />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'}>Add</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowAdjust(null)}>Cancel</Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {showApprove && (
        <Modal open onClose={() => setShowApprove(false)} maxWidth="max-w-sm" backdropBlur contentClassName="p-5 space-y-3">
          <h4 className="text-base font-semibold text-app-fg">Approve and send to Finance</h4>
          <ModalFetcherInlineError message={payrollSurface.errorMatchingIntent('approveBatch')} />
          <fetcher.Form method="post" onSubmit={() => setShowApprove(false)} className="space-y-3">
            <input type="hidden" name="intent" value="approveBatch" />
            <input type="hidden" name="batchId" value={batch.id} />
            <Textarea
              label="HR notes (optional)"
              name="hrNotes"
              rows={3}
              placeholder="Any context for Finance to know. Leave blank if none."
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'}>Approve</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowApprove(false)}>Cancel</Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {showReject && (
        <Modal open onClose={() => setShowReject(false)} maxWidth="max-w-sm" backdropBlur contentClassName="p-5 space-y-3">
          <h4 className="text-base font-semibold text-app-fg">Reject and send back</h4>
          <ModalFetcherInlineError message={payrollSurface.errorMatchingIntent('rejectBatch')} />
          <p className="text-xs text-app-fg-muted">
            The batch returns to {batch.status === 'PENDING_HR' ? 'DRAFT for the department head to edit and resubmit' : 'PENDING_HR for HR to revise'}.
          </p>
          <fetcher.Form method="post" onSubmit={() => setShowReject(false)} className="space-y-3">
            <input type="hidden" name="intent" value="rejectBatch" />
            <input type="hidden" name="batchId" value={batch.id} />
            <Textarea
              label="Reason"
              name="reason"
              rows={3}
              required
              minLength={10}
              placeholder="Min 10 characters. What needs to change?"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" size="sm" loading={fetcher.state === 'submitting'}>Reject</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowReject(false)}>Cancel</Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {showMarkPaid && (
        <ConfirmActionModal
          open
          onClose={() => setShowMarkPaid(false)}
          error={payrollSurface.errorMatchingIntent('markBatchPaid')}
          title="Mark batch paid"
          description={
            <>
              <p>Confirm Finance has disbursed all <strong>{batch.staffCount}</strong> payouts in this batch.</p>
              <p className="mt-2">
                Total: <strong><NairaPrice amount={Number(batch.totalAmount)} /></strong>
              </p>
              <fetcher.Form method="post" id="mark-paid-form" className="mt-3 space-y-2">
                <input type="hidden" name="intent" value="markBatchPaid" />
                <input type="hidden" name="batchId" value={batch.id} />
                <TextInput
                  label="Payment reference"
                  name="financeReference"
                  required
                  minLength={2}
                  placeholder="e.g. Bank transfer batch #2026-04-CS-001"
                />
                <TextInput
                  label="Disbursement date"
                  name="disbursementDate"
                  type="date"
                />
                <TextInput
                  label="Proof of payment URL (optional)"
                  name="proofOfPaymentUrl"
                  type="url"
                  placeholder="https://..."
                />
              </fetcher.Form>
            </>
          }
          confirmLabel="Mark Paid"
          variant="warning"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            const form = document.getElementById('mark-paid-form') as HTMLFormElement | null;
            if (form) fetcher.submit(form);
            setShowMarkPaid(false);
          }}
        />
      )}
    </div>
  );
}
