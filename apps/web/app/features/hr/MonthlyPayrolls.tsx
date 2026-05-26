import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
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
import { Spinner } from '~/components/ui/spinner';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import type {
  MonthlyPayrollGroup,
  PayrollBatch,
  PayrollDepartment,
  BranchOption,
  ViewerInfo,
} from './types';
import { ADMIN_ROLES, DEPT_LABEL, DEPT_OWNER_ROLE, ALL_DEPARTMENTS } from './payroll-constants';

function formatMonth(periodMonth: string): string {
  // periodMonth is YYYY-MM-01
  const [yyyy, mm] = periodMonth.split('-');
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, 1));
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function canPrepareDept(viewer: ViewerInfo, dept: PayrollDepartment, branchId: string): boolean {
  if (ADMIN_ROLES.has(viewer.role)) return true;
  // HR Manager is an org-wide role (CEO directive 2026-05-10) — they don't have
  // a branch binding. The server-side `getPrepareAccess` returns every
  // department + every branch for anyone holding `hr.write` (which HR has by
  // default), so the catch-all `prepareDepartments + prepareBranchIds` check
  // below covers HR for non-branch-scoped flows. Short-circuit here for
  // clarity so we never accidentally tie HR's prep capability to a branch.
  if (viewer.role === 'HR_MANAGER') return true;
  if (viewer.prepareDepartments?.includes(dept) && viewer.prepareBranchIds?.includes(branchId)) return true;
  if (viewer.role !== DEPT_OWNER_ROLE[dept]) return false;
  if (viewer.currentBranchId == null && viewer.role.startsWith('HEAD_OF_')) return true;
  return viewer.currentBranchId === branchId;
}

function canReview(viewer: ViewerInfo): boolean {
  return ADMIN_ROLES.has(viewer.role) || viewer.role === 'HR_MANAGER';
}

function canProcess(viewer: ViewerInfo): boolean {
  return ADMIN_ROLES.has(viewer.role) || viewer.role === 'FINANCE_OFFICER';
}

interface BatchDetail {
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
                      {Number(a.amount) < 0 ? '−' : '+'}
                      <NairaPrice amount={Math.abs(Number(a.amount))} />
                    </span>
                    <span className="ml-1 text-app-fg-muted">
                      · {a.category} · {a.reason}
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
            −<NairaPrice amount={Number(p.deductionsTotal)} />
          </>
        ) : (
          '—'
        ),
    },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      nowrap: true,
      render: (p) => (
        <span className="font-semibold">
          <NairaPrice amount={Number(p.totalPayout)} />
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

interface MonthlyPayrollsProps {
  monthlyPayrolls: MonthlyPayrollGroup[];
  branches: BranchOption[];
  viewer: ViewerInfo;
  /** Optional: open the detail modal for this batch on mount (URL ?batchId=...). */
  initialBatchId: string | null;
  /** Provide a batch detail loader if you want the modal to show full payout lines. */
  fetchBatchDetail: (batchId: string) => Promise<BatchDetail | null>;
}

export function MonthlyPayrolls({
  monthlyPayrolls,
  branches,
  viewer,
  initialBatchId,
  fetchBatchDetail,
}: MonthlyPayrollsProps) {
  const fetcher = useFetcher();
  const payrollSurface = useFetcherActionSurface(fetcher);
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  // Client-side pagination over month groups (typically 1 group per calendar month).
  // 20 groups per page comfortably covers ~1.5 years of payroll history.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const totalPages = Math.max(1, Math.ceil(monthlyPayrolls.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedMonthlyPayrolls = useMemo(
    () => monthlyPayrolls.slice((safePage - 1) * pageSize, safePage * pageSize),
    [monthlyPayrolls, safePage, pageSize],
  );
  // Reset to page 1 when the result set shrinks (filter / refetch).
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const [openBatchId, setOpenBatchId] = useState<string | null>(initialBatchId);
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Available departments to GENERATE — includes backend-provided prepare access
  const generatableDepartments: PayrollDepartment[] = useMemo(() => {
    if (ADMIN_ROLES.has(viewer.role)) return ALL_DEPARTMENTS;
    if (viewer.prepareDepartments?.length) return viewer.prepareDepartments;
    if (viewer.role === 'HR_MANAGER') return ['LOGISTICS', 'HR'];
    const matching = ALL_DEPARTMENTS.find((d) => DEPT_OWNER_ROLE[d] === viewer.role);
    return matching ? [matching] : [];
  }, [viewer.role, viewer.prepareDepartments]);

  // Default branch set for generate actions
  const generatableBranches: BranchOption[] = useMemo(() => {
    if (ADMIN_ROLES.has(viewer.role)) return branches;
    if (viewer.prepareBranchIds?.length) {
      return branches.filter((b) => viewer.prepareBranchIds?.includes(b.id));
    }
    const own = branches.find((b) => b.id === viewer.currentBranchId);
    return own ? [own] : [];
  }, [viewer, branches]);

  useFetcherToast(fetcher.data, {
    successMessage: 'Payroll updated',
    skipErrorToast: openBatchId != null,
  });

  /** One-shot toast after bulk generate redirect from `/hr/payroll/generate`. */
  const generateSummaryFlash = searchParams.get('generateSummary');
  useEffect(() => {
    if (!generateSummaryFlash) return;
    toast.success(generateSummaryFlash);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('generateSummary');
        return next;
      },
      { replace: true },
    );
  }, [generateSummaryFlash, setSearchParams, toast]);

  // Open / close detail modal — fetch on open
  useEffect(() => {
    if (!openBatchId) {
      setBatchDetail(null);
      return;
    }
    setLoadingDetail(true);
    fetchBatchDetail(openBatchId)
      .then((d) => setBatchDetail(d))
      .finally(() => setLoadingDetail(false));
    // Sync URL so the modal is bookmarkable / back-button works
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('batchId', openBatchId);
      return next;
    }, { replace: true });
  }, [openBatchId, fetchBatchDetail, setSearchParams]);

  function closeDetail() {
    setOpenBatchId(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('batchId');
      return next;
    }, { replace: true });
  }

  // Refresh detail after a successful action — edge-trigger via shared hook,
  // so the panel re-fetches the same tick the toast fires.
  const handleBatchDetailRefresh = useCallback(() => {
    if (!openBatchId) return;
    setLoadingDetail(true);
    fetchBatchDetail(openBatchId)
      .then((d) => setBatchDetail(d))
      .finally(() => setLoadingDetail(false));
  }, [openBatchId, fetchBatchDetail]);
  useCloseOnFetcherSuccess(fetcher, handleBatchDetailRefresh);

  const showGenerateButton = generatableDepartments.length > 0 && generatableBranches.length > 0;

  return (
    <div className="space-y-4">
      {/* Header actions */}
      {showGenerateButton && (
        <div className="flex flex-wrap gap-2">
          <Link to="/hr/payroll/generate" className="btn-primary btn-sm inline-flex items-center justify-center">
            + Generate Monthly Batch
          </Link>
        </div>
      )}

      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[12rem]">
      {/* Empty state */}
      {monthlyPayrolls.length === 0 && (
        <EmptyState
          title="No payroll batches yet"
          description={
            generatableDepartments.length > 0
              ? 'Click Generate Monthly Batch to create the first one for your department.'
              : 'No batches in your scope yet. Department heads will create them here at month-end.'
          }
        />
      )}

      {/* Monthly groups */}
      {pagedMonthlyPayrolls.map((group) => (
        <MonthGroup key={group.month} group={group} branchById={branchById} onOpenBatch={(id) => setOpenBatchId(id)} />
      ))}
      </TableLoadingOverlay>

      {monthlyPayrolls.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-app-border pt-4">
          <p className="text-sm text-app-fg-muted">
            Showing {(safePage - 1) * pageSize + 1}–
            {Math.min(safePage * pageSize, monthlyPayrolls.length)} of {monthlyPayrolls.length}
          </p>
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </div>
      )}

      {/* Batch detail modal */}
      {openBatchId && (
        <BatchDetailModal
          loading={loadingDetail}
          detail={batchDetail}
          branchById={branchById}
          viewer={viewer}
          fetcher={fetcher}
          payrollSurface={payrollSurface}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

// ── Month group ─────────────────────────────────────────────────

function MonthGroup({
  group,
  branchById,
  onOpenBatch,
}: {
  group: MonthlyPayrollGroup;
  branchById: Map<string, string>;
  onOpenBatch: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="card p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-app-hover transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-app-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <h3 className="text-base font-semibold text-app-fg">{formatMonth(group.month)}</h3>
          <span className="text-xs text-app-fg-muted">{group.staffCount} staff</span>
        </div>
        <div className="text-sm font-semibold text-app-fg">
          <NairaPrice amount={group.totalAmount} />
        </div>
      </button>

      {open && (
        <div className="border-t border-app-border">
          {group.items.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              branchName={branchById.get(batch.branchId) ?? batch.branchId.slice(0, 8)}
              onOpen={() => onOpenBatch(batch.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single batch row ────────────────────────────────────────────

function BatchRow({
  batch,
  branchName,
  onOpen,
}: {
  batch: PayrollBatch;
  branchName: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-4 px-4 py-3 hover:bg-app-hover transition-colors text-left border-t border-app-border first:border-t-0"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-app-fg">{DEPT_LABEL[batch.department]}</p>
        <p className="text-xs text-app-fg-muted">
          {branchName} · {batch.staffCount} staff · {batch.preparedAt
            ? `prepared ${new Date(batch.preparedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}`
            : 'not yet generated'}
        </p>
      </div>
      <div className="text-sm font-semibold text-app-fg whitespace-nowrap">
        <NairaPrice amount={Number(batch.totalAmount)} />
      </div>
      <StatusBadge status={batch.status} />
    </button>
  );
}

// ── Detail modal ────────────────────────────────────────────────

function BatchDetailModal({
  loading,
  detail,
  branchById,
  viewer,
  fetcher,
  payrollSurface,
  onClose,
}: {
  loading: boolean;
  detail: BatchDetail | null;
  branchById: Map<string, string>;
  viewer: ViewerInfo;
  fetcher: ReturnType<typeof useFetcher>;
  payrollSurface: ReturnType<typeof useFetcherActionSurface>;
  onClose: () => void;
}) {
  const [showAdjust, setShowAdjust] = useState<{ payoutId: string; staffName: string } | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [showApprove, setShowApprove] = useState(false);

  if (loading || !detail) {
    return (
      <Modal open onClose={onClose} maxWidth="max-w-3xl" backdropBlur contentClassName="p-6">
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      </Modal>
    );
  }

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
    <Modal open onClose={onClose} maxWidth="max-w-4xl" backdropBlur contentClassName="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-app-fg">
            {DEPT_LABEL[batch.department]} · {formatMonth(batch.periodMonth)}
          </h3>
          <p className="text-xs text-app-fg-muted mt-0.5">
            {branchById.get(batch.branchId) ?? batch.branchId.slice(0, 8)} · {batch.staffCount} staff · Total{' '}
            <NairaPrice amount={Number(batch.totalAmount)} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={batch.status} />
          <button type="button" onClick={onClose} className="text-app-fg-muted hover:text-app-fg p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Status timeline */}
      <BatchTimeline batch={batch} />

      <ModalFetcherInlineError
        message={payrollSurface.errorMatchingIntent(['submitBatch', 'generateBatch'])}
      />

      {batch.rejectionReason && (
        <div className="rounded-lg bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-3 py-2 text-sm">
          <span className="font-medium text-warning-700 dark:text-warning-300">Last rejection:</span>{' '}
          <span className="text-warning-700 dark:text-warning-300">{batch.rejectionReason}</span>
        </div>
      )}

      {/* Payouts list */}
      <div>
        <h4 className="text-xs font-medium text-app-fg-muted uppercase tracking-wide mb-2">Staff payouts</h4>
        {batch.status === 'PAID' && (
          <p className="text-xs text-success-600 dark:text-success-400 mb-2">
            Finance marked this batch paid — every staff payout below is now PAID.
          </p>
        )}
        {payouts.length === 0 ? (
          <EmptyState
            title="No payouts in this batch"
            description="No payouts were generated. Check commission plan coverage."
          />
        ) : (
          <div className="overflow-x-auto">
            <CompactTable
              withCard={false}
              columns={payoutColumns}
              rows={payouts}
              rowKey={(p) => p.id}
            />
          </div>
        )}
      </div>

      {/* HR notes (when present) */}
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

      {/* Footer actions */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-app-border">
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
            Reject &amp; send back
          </Button>
        )}
        {/* Generate (refresh DRAFT) — only when DRAFT and the viewer can prepare */}
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
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Sub-modals: Add adjustment / Approve notes / Reject reason / Mark paid reference */}

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
              placeholder="Any context for Finance to know — leave blank if none."
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
              placeholder="Min 10 characters — what needs to change?"
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
    </Modal>
  );
}

// ── Status timeline strip ───────────────────────────────────────

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
