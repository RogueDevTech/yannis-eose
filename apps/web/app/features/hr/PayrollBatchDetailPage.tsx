import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useFetcher } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Button } from '~/components/ui/button';
import { RoleBadge } from '~/components/ui/role-badge';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { AmountInput } from '~/components/ui/amount-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DescriptionList, type DescriptionItem } from '~/components/ui/description-list';
import { SearchInput } from '~/components/ui/search-input';
import { useFetcherToast } from '~/components/ui/toast';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { formatRole } from '~/features/users/types';
import type { PayrollBatch, ViewerInfo } from './types';
import { formatOrderTimestampShort } from '~/lib/format-date';
import { ADMIN_ROLES, DEPT_LABEL } from './payroll-constants';

// ── Types ──────────────────────────────────────────────────────

export interface BatchDetail {
  batch: PayrollBatch;
  payouts: Array<{
    id: string;
    staffId: string | null;
    staffName: string;
    staffRole: string | null;
    payRoleName?: string | null;
    baseSalary: string;
    performanceBonus: string;
    allowancesTotal?: string;
    addOnsTotal: string;
    deductionsTotal: string;
    totalPayout: string;
    grossPay?: string;
    payeTax?: string;
    employerPayeSubsidy?: string;
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
type BatchAdjustment = BatchDetail['adjustments'][number];

// ── Helpers ────────────────────────────────────────────────────

function formatMonth(periodMonth: string): string {
  const ym = periodMonth.slice(0, 7);
  const [yyyy, mm] = ym.split('-');
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, 1));
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatTimelineDate(at: string): string | null {
  const label = formatOrderTimestampShort(at);
  return label === '—' ? null : label;
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

function parseBonusLines(breakdown: unknown): Array<{ label: string; amount: number }> {
  if (!Array.isArray(breakdown)) return [];
  return breakdown
    .map((line) => {
      if (!line || typeof line !== 'object') return null;
      const obj = line as Record<string, unknown>;
      const label = String(obj.label ?? obj.name ?? 'Bonus');
      const amount = Number(obj.amount ?? 0);
      if (!Number.isFinite(amount)) return null;
      return { label, amount };
    })
    .filter((x): x is { label: string; amount: number } => x != null);
}

function moneyOrDash(amount: number): ReactNode {
  if (!Number.isFinite(amount) || amount === 0) return 'N/A';
  return <NairaPrice amount={amount} />;
}

// ── Column builder ─────────────────────────────────────────────

function buildBatchPayoutColumns(args: {
  batch: BatchDetail['batch'];
  adjustmentsByPayout: Map<string, BatchDetail['adjustments']>;
  viewer: ViewerInfo;
  onView: (payout: BatchPayoutLine) => void;
  onAdjust: (payoutId: string, staffName: string) => void;
}): CompactTableColumn<BatchPayoutLine>[] {
  const { batch, adjustmentsByPayout, viewer, onView, onAdjust } = args;
  const canAdjust = batch.status === 'PENDING_HR' && canReview(viewer);
  const cols: CompactTableColumn<BatchPayoutLine>[] = [
    {
      key: 'staff',
      header: 'Staff',
      render: (p) => {
        const adj = adjustmentsByPayout.get(p.id) ?? [];
        return (
          <div>
            <p className="font-medium text-app-fg">{p.staffName}</p>
            {p.staffRole && <RoleBadge role={p.staffRole} size="sm" />}
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
          <NairaPrice amount={Number(p.totalPayout ?? p.netPay)} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (p) => <StatusBadge status={p.status} />,
    },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      align: 'right',
      tight: true,
      nowrap: true,
      hideable: false,
      render: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          <CompactTableActionButton onClick={() => onView(p)}>View</CompactTableActionButton>
          {canAdjust ? (
            <CompactTableActionButton onClick={() => onAdjust(p.id, p.staffName)}>
              + Adjust
            </CompactTableActionButton>
          ) : null}
        </div>
      ),
    },
  ];
  return cols;
}

function PayoutDetailModal({
  payout,
  adjustments,
  onClose,
}: {
  payout: BatchPayoutLine;
  adjustments: BatchAdjustment[];
  onClose: () => void;
}) {
  const bonusLines = parseBonusLines(payout.bonusBreakdown);
  const hasBank =
    !!payout.payoutBankName ||
    !!payout.payoutBankCode ||
    !!payout.payoutAccountName ||
    !!payout.payoutAccountNumber;

  const summaryItems: DescriptionItem[] = [
    { label: 'Staff', value: payout.staffName },
    {
      label: 'Role',
      value: payout.staffRole ? formatRole(payout.staffRole) : 'N/A',
    },
    {
      label: 'Pay role',
      value: payout.payRoleName?.trim() || 'N/A',
    },
    { label: 'Line status', value: <StatusBadge status={payout.lineStatus ?? payout.status} /> },
    { label: 'Payout status', value: <StatusBadge status={payout.status} /> },
  ];

  const payItems: DescriptionItem[] = [
    { label: 'Base salary', value: <NairaPrice amount={Number(payout.baseSalary)} /> },
    { label: 'Performance bonus', value: moneyOrDash(Number(payout.performanceBonus)) },
    { label: 'Allowances', value: moneyOrDash(Number(payout.allowancesTotal ?? 0)) },
    { label: 'Add-ons', value: moneyOrDash(Number(payout.addOnsTotal)) },
    {
      label: 'Deductions',
      value:
        Number(payout.deductionsTotal) > 0 ? (
          <>
            {'\u2212'}
            <NairaPrice amount={Number(payout.deductionsTotal)} />
          </>
        ) : (
          'N/A'
        ),
    },
    {
      label: 'Gross pay',
      value: <NairaPrice amount={Number(payout.grossPay ?? payout.totalPayout)} />,
    },
    {
      label: 'PAYE tax',
      value:
        Number(payout.payeTax ?? 0) > 0 ? (
          <>
            {'\u2212'}
            <NairaPrice amount={Number(payout.payeTax)} />
          </>
        ) : (
          'N/A'
        ),
    },
    {
      label: 'Employer PAYE subsidy',
      value: moneyOrDash(Number(payout.employerPayeSubsidy ?? 0)),
    },
    {
      label: 'Net pay',
      value: (
        <span className="font-semibold text-app-fg">
          <NairaPrice amount={Number(payout.netPay ?? payout.totalPayout)} />
        </span>
      ),
    },
  ];

  const bankItems: DescriptionItem[] = hasBank
    ? [
        { label: 'Bank', value: payout.payoutBankName?.trim() || 'N/A' },
        {
          label: 'Bank code',
          value: payout.payoutBankCode?.trim() ? (
            <span className="tabular-nums font-semibold">{payout.payoutBankCode}</span>
          ) : (
            'N/A'
          ),
        },
        { label: 'Account name', value: payout.payoutAccountName?.trim() || 'N/A' },
        {
          label: 'Account number',
          value: payout.payoutAccountNumber?.trim() ? (
            <span className="tabular-nums">{payout.payoutAccountNumber}</span>
          ) : (
            'N/A'
          ),
        },
      ]
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-lg"
      backdropBlur
      contentClassName="p-5 space-y-4 max-h-[90dvh] overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-app-fg">Payout details</h3>
          <p className="mt-0.5 text-sm text-app-fg-muted">{payout.staffName}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">Staff</h4>
        <DescriptionList items={summaryItems} layout="stacked" divided />
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">Pay breakdown</h4>
        <DescriptionList items={payItems} layout="stacked" divided />
      </div>

      {bonusLines.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
            Bonus lines
          </h4>
          <ul className="space-y-1.5 rounded-md border border-app-border px-3 py-2">
            {bonusLines.map((line, idx) => (
              <li key={`${line.label}-${idx}`} className="flex justify-between gap-3 text-sm">
                <span className="text-app-fg-muted">{line.label}</span>
                <span className="tabular-nums text-app-fg">
                  <NairaPrice amount={line.amount} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {adjustments.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
            Adjustments
          </h4>
          <ul className="space-y-2 rounded-md border border-app-border px-3 py-2">
            {adjustments.map((a) => (
              <li key={a.id} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium text-app-fg">{a.category}</span>
                  <span
                    className={`tabular-nums ${
                      Number(a.amount) < 0
                        ? 'text-danger-600 dark:text-danger-400'
                        : 'text-success-600 dark:text-success-400'
                    }`}
                  >
                    {Number(a.amount) < 0 ? '\u2212' : '+'}
                    <NairaPrice amount={Math.abs(Number(a.amount))} />
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-app-fg-muted">{a.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasBank ? (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
            Bank details
          </h4>
          <DescriptionList items={bankItems} layout="stacked" divided />
        </div>
      ) : null}
    </Modal>
  );
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
    <>
      {/* Mobile: vertical timeline */}
      <ol className="md:hidden space-y-3 text-xs">
        {stages.map((s, i) => {
          const reached = i <= currentIdx;
          const atLabel = s.at ? formatTimelineDate(s.at) : null;
          return (
            <li key={s.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${reached ? 'bg-brand-500' : 'bg-app-border'}`} />
                {i < stages.length - 1 && (
                  <span className={`w-px flex-1 mt-1 ${reached && i < currentIdx ? 'bg-brand-500' : 'bg-app-border'}`} />
                )}
              </div>
              <div className="pb-1 min-w-0">
                <p className={reached ? 'text-app-fg font-medium' : 'text-app-fg-muted'}>
                  {s.label}
                </p>
                {atLabel && (
                  <p className="text-micro text-app-fg-muted">{atLabel}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Desktop: horizontal timeline */}
      <ol className="hidden md:flex items-center gap-1 text-xs">
        {stages.map((s, i) => {
          const reached = i <= currentIdx;
          const atLabel = s.at ? formatTimelineDate(s.at) : null;
          return (
            <li key={s.key} className="flex items-center gap-1 flex-1 min-w-0">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${reached ? 'bg-brand-500' : 'bg-app-border'}`}
              />
              <div className="min-w-0">
                <p className={`truncate ${reached ? 'text-app-fg font-medium' : 'text-app-fg-muted'}`}>
                  {s.label}
                </p>
                {atLabel && (
                  <p className="text-micro text-app-fg-muted truncate">{atLabel}</p>
                )}
              </div>
              {i < stages.length - 1 && (
                <span className={`flex-1 h-px ${reached && i < currentIdx ? 'bg-brand-500' : 'bg-app-border'}`} />
              )}
            </li>
          );
        })}
      </ol>
    </>
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
  const [viewingPayout, setViewingPayout] = useState<BatchPayoutLine | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [payoutSearch, setPayoutSearch] = useState('');

  useFetcherToast(fetcher.data, { successMessage: 'Payroll updated' });

  const handleSuccess = useCallback(() => {
    setShowAdjust(null);
    setShowApprove(false);
    setShowReject(false);
    setShowMarkPaid(false);
    setShowRegenerate(false);
    setShowSubmit(false);
    // Finance overview / payroll list use cached loaders; clear so Paid vs Awaiting isn't stale.
    invalidateCachedLoader('/admin/finance/overview');
    invalidateCachedLoader('/hr/payroll');
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  const { batch, payouts: allPayouts, adjustments, allowedTransitions } = detail;
  const payouts = useMemo(() => {
    const q = payoutSearch.toLowerCase().trim();
    if (!q) return allPayouts;
    return allPayouts.filter((p) => (p.staffName ?? '').toLowerCase().includes(q));
  }, [allPayouts, payoutSearch]);

  const submitRegenerate = useCallback(() => {
    const fd = new FormData();
    fd.set('intent', 'generateBatch');
    fd.set('branchId', batch.branchId);
    fd.set('department', batch.department);
    fd.set('periodMonth', batch.periodMonth.slice(0, 7));
    fetcher.submit(fd, { method: 'post' });
  }, [batch.branchId, batch.department, batch.periodMonth, fetcher]);
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
    onView: (payout) => setViewingPayout(payout),
    onAdjust: (payoutId, staffName) => setShowAdjust({ payoutId, staffName }),
  });

  const totalPaye = useMemo(
    () => payouts.reduce((sum, p) => sum + Number(p.payeTax ?? 0), 0),
    [payouts],
  );
  const totalGross = useMemo(
    () => payouts.reduce((sum, p) => sum + Number(p.grossPay ?? p.totalPayout), 0),
    [payouts],
  );

  const canRegenerateDraft =
    batch.status === 'DRAFT' && canPrepareDept(viewer, batch.department, batch.branchId);

  /** Header: only draft prep actions. Approve / reject / mark paid live in the footer. */
  const showHeaderWorkflowActions =
    allowedTransitions.includes('SUBMIT') || canRegenerateDraft;

  const showFooterWorkflowActions =
    allowedTransitions.length > 0 || canRegenerateDraft;

  const headerWorkflowActions = (
    <>
      {allowedTransitions.includes('SUBMIT') && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={fetcher.state === 'submitting' && showSubmit}
          onClick={() => setShowSubmit(true)}
        >
          Submit to HR
        </Button>
      )}
      {canRegenerateDraft && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={fetcher.state === 'submitting' && showRegenerate}
          onClick={() => setShowRegenerate(true)}
        >
          Re-generate from latest data
        </Button>
      )}
    </>
  );

  const footerWorkflowActions = (
    <>
      {allowedTransitions.includes('SUBMIT') && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={fetcher.state === 'submitting' && showSubmit}
          onClick={() => setShowSubmit(true)}
        >
          Submit to HR
        </Button>
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
      {canRegenerateDraft && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={fetcher.state === 'submitting' && showRegenerate}
          onClick={() => setShowRegenerate(true)}
        >
          Re-generate from latest data
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${DEPT_LABEL[batch.department]} \u00b7 ${formatMonth(batch.periodMonth)}`}
        backTo="/hr/payroll"
        mobileInlineActions
        description={`${branchName} \u00b7 ${batch.staffCount} staff`}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Batch actions"
            triggerAriaLabel="Payroll batch toolbar"
            desktop={
              <div className="flex items-center gap-2 flex-wrap">
                <PageRefreshButton />
                <StatusBadge status={batch.status} />
                {showHeaderWorkflowActions ? headerWorkflowActions : null}
              </div>
            }
            sheet={({ closeSheet }) => (
              <div className="space-y-2">
                {showHeaderWorkflowActions ? (
                  <div className="space-y-2 [&_form]:block [&_form]:w-full [&_button]:w-full [&_button]:justify-center [&_button]:h-12">
                    {allowedTransitions.includes('SUBMIT') && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full justify-center h-12"
                        loading={fetcher.state === 'submitting' && showSubmit}
                        onClick={() => {
                          closeSheet();
                          setShowSubmit(true);
                        }}
                      >
                        Submit to HR
                      </Button>
                    )}
                    {canRegenerateDraft && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full justify-center h-12"
                        onClick={() => {
                          closeSheet();
                          setShowRegenerate(true);
                        }}
                      >
                        Re-generate from latest data
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          />
        }
      />

      <MobileDateFilterRow hideDate />

      {/* Status timeline */}
      <div className="card !p-4">
        <BatchTimeline batch={batch} />
      </div>

      <ModalFetcherInlineError
        message={payrollSurface.errorMatchingIntent(['submitBatch', 'addBatchAdjustment'])}
      />

      {batch.rejectionReason && (
        <div className="rounded-lg bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-3 py-2 text-sm">
          <span className="font-medium text-warning-700 dark:text-warning-300">Last rejection:</span>{' '}
          <span className="text-warning-700 dark:text-warning-300">{batch.rejectionReason}</span>
        </div>
      )}

      {/* Summary strip */}
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Staff payouts', value: batch.staffCount },
          {
            label: 'Total gross',
            value: <NairaPrice amount={totalGross} />,
          },
          { label: 'Total PAYE', value: <NairaPrice amount={totalPaye} /> },
          {
            label: 'Total net',
            value: <NairaPrice amount={Number(batch.totalAmount)} />,
          },
        ]}
      />

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
      <div className="list-panel p-0">
        <div className="px-4 py-3 border-b border-app-border flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-app-fg">Staff payouts ({allPayouts.length})</h4>
          {allPayouts.length > 5 && (
            <SearchInput value={payoutSearch} onChange={setPayoutSearch} placeholder="Search by name" className="w-48" />
          )}
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
            renderMobileCard={(p) => (
              <button
                type="button"
                onClick={() => setViewingPayout(p)}
                className="w-full text-left p-4 space-y-2 hover:bg-app-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-app-fg text-sm">{p.staffName}</p>
                    {p.staffRole ? (
                      <p className="text-xs text-app-fg-muted mt-0.5">{formatRole(p.staffRole)}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-app-fg-muted">Net</span>
                  <span className="font-semibold text-app-fg">
                    <NairaPrice amount={Number(p.totalPayout ?? p.netPay)} />
                  </span>
                </div>
              </button>
            )}
          />
        )}
      </div>

      {showFooterWorkflowActions && (
        <div className="flex flex-wrap gap-2">
          {footerWorkflowActions}
        </div>
      )}

      {/* Sub-modals */}

      {viewingPayout ? (
        <PayoutDetailModal
          payout={viewingPayout}
          adjustments={adjustmentsByPayout.get(viewingPayout.id) ?? []}
          onClose={() => setViewingPayout(null)}
        />
      ) : null}

      {showAdjust && (
        <Modal open onClose={() => setShowAdjust(null)} maxWidth="max-w-sm" backdropBlur contentClassName="p-5 space-y-3">
          <h4 className="text-base font-semibold text-app-fg">Adjust {showAdjust.staffName}</h4>
          <ModalFetcherInlineError message={payrollSurface.errorMatchingIntent('addBatchAdjustment')} />
          <fetcher.Form method="post" className="space-y-3">
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
          <fetcher.Form method="post" className="space-y-3">
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
          <fetcher.Form method="post" className="space-y-3">
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

      {showSubmit && (
        <ConfirmActionModal
          open
          onClose={() => setShowSubmit(false)}
          error={payrollSurface.errorMatchingIntent('submitBatch')}
          title="Submit batch to HR"
          description={
            <>
              <p>
                Submit this {DEPT_LABEL[batch.department]} draft for{' '}
                <strong>{formatMonth(batch.periodMonth)}</strong> ({branchName}) to HR for review?
              </p>
              <p className="mt-2">
                {batch.staffCount} staff · Total{' '}
                <strong>
                  <NairaPrice amount={Number(batch.totalAmount)} />
                </strong>
              </p>
            </>
          }
          details={
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>HR can approve to Finance or send it back</li>
              <li>You will not be able to edit payouts while it is pending HR</li>
            </ul>
          }
          confirmLabel="Submit to HR"
          variant="warning"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            fetcher.submit(
              { intent: 'submitBatch', batchId: batch.id },
              { method: 'post' },
            );
          }}
        />
      )}

      {showRegenerate && (
        <ConfirmActionModal
          open
          onClose={() => setShowRegenerate(false)}
          error={payrollSurface.errorMatchingIntent('generateBatch')}
          title="Re-generate from latest data"
          description={
            <>
              <p>
                This replaces all draft payouts in this batch with fresh numbers from the latest
                payroll rules, delivered orders, and staff pay profiles.
              </p>
              <p className="mt-2 text-app-fg-muted">
                {DEPT_LABEL[batch.department]} · {formatMonth(batch.periodMonth)} · {branchName}
              </p>
            </>
          }
          details={
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>Current draft payout lines will be wiped</li>
              <li>Manual adjustments on this draft will be lost</li>
              <li>Only allowed while the batch is still in Draft</li>
            </ul>
          }
          confirmLabel="Re-generate"
          variant="warning"
          loading={fetcher.state === 'submitting'}
          onConfirm={submitRegenerate}
        />
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
                  label="Disbursement date (optional)"
                  name="disbursementDate"
                  type="date"
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
          }}
        />
      )}
    </div>
  );
}
