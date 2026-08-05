import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useFetcher, useNavigate } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Button } from '~/components/ui/button';
import { RoleBadge, formatRoleLabel } from '~/components/ui/role-badge';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { AmountInput } from '~/components/ui/amount-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DescriptionList, type DescriptionItem } from '~/components/ui/description-list';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { useFetcherToast } from '~/components/ui/toast';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { formatRole } from '~/features/users/types';
import type { PayrollBatch, ViewerInfo, HRUser, PayrollContractorOption } from './types';
import { formatOrderTimestampShort } from '~/lib/format-date';
import { formatNaira } from '~/lib/format-amount';
import { ADMIN_ROLES, batchScopeLabel, batchBranchLabel } from './payroll-constants';

// Add-on (earning) vs deduction categories for the batch-level Add-on / Deduct
// Salary modal. Sign is derived server-side from the category, so HR only ever
// types a positive magnitude. Mirrors the standalone adjustment on HRPage.
const ADJ_ADDON_CATEGORIES = ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER'];
const ADJ_DEDUCT_CATEGORIES = ['DEDUCTION', 'CLAWBACK'];

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
    periodMonth?: string | null;
  }>;
  allowedTransitions: string[];
}

export type BatchPayoutLine = BatchDetail['payouts'][number];
export type BatchAdjustment = BatchDetail['adjustments'][number];

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

function canPrepareDept(viewer: ViewerInfo, dept: string | null, branchId: string | null): boolean {
  if (ADMIN_ROLES.has(viewer.role)) return true;
  if (viewer.role === 'HR_MANAGER') return true;
  // Null-scope (contractor / ALL) batches are admin/HR-only above; a dept-scoped
  // preparer needs both a department and a branch match.
  if (!dept || !branchId) return false;
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

/**
 * Compact role tag for the payouts table. Renders the system role as a colored
 * chip (or a neutral "Contractor" chip when the payout line has no staff role —
 * external agency contractors carry no role). On hover it reveals a small
 * tooltip with the full role label and the pay role, so the dense table row
 * stays scannable while the detail is one hover away.
 */
function StaffRoleTag({
  role,
  payRoleName,
}: {
  role: string | null;
  payRoleName?: string | null;
}) {
  const isContractor = !role;
  const tooltip = isContractor
    ? payRoleName?.trim()
      ? `Contractor · ${payRoleName.trim()}`
      : 'External contractor'
    : payRoleName?.trim()
      ? `${formatRole(role)} · ${payRoleName.trim()}`
      : formatRole(role);

  return (
    <span className="group/roletag relative inline-flex shrink-0">
      {isContractor ? (
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          Contractor
        </span>
      ) : (
        <RoleBadge role={role} size="sm" variant="chip" />
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-app-fg px-2 py-1 text-2xs font-medium text-app-bg opacity-0 shadow-lg transition-opacity duration-100 group-hover/roletag:opacity-100"
      >
        {tooltip}
      </span>
    </span>
  );
}

// ── Column builder ─────────────────────────────────────────────

function buildBatchPayoutColumns(args: {
  batch: BatchDetail['batch'];
  canEditLines: boolean;
  onAdjust: (payoutId: string, staffName: string, currentTotal: number) => void;
  onRemove: (payoutId: string, staffName: string) => void;
}): CompactTableColumn<BatchPayoutLine>[] {
  const { batch, canEditLines, onAdjust, onRemove } = args;
  // Add-ons/deductions follow the same window as line removal: open until the
  // batch is marked paid (DRAFT preparer, or PENDING_HR/PENDING_FINANCE HR/admin).
  const canAdjust = canEditLines;
  const cols: CompactTableColumn<BatchPayoutLine>[] = [
    {
      key: 'staff',
      header: 'Staff',
      render: (p) => (
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-medium text-app-fg truncate">{p.staffName}</p>
          <StaffRoleTag role={p.staffRole} payRoleName={p.payRoleName} />
        </div>
      ),
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
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      align: 'right',
      tight: true,
      nowrap: true,
      hideable: false,
      render: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          <CompactTableActionButton to={`/hr/payroll-batch/${batch.id}/payout/${p.id}`}>
            View
          </CompactTableActionButton>
          {canAdjust ? (
            <CompactTableActionButton onClick={() => onAdjust(p.id, p.staffName, Number(p.totalPayout ?? p.netPay ?? 0))}>
              + Adjust
            </CompactTableActionButton>
          ) : null}
          {canEditLines ? (
            <CompactTableActionButton tone="danger" onClick={() => onRemove(p.id, p.staffName)}>
              Remove
            </CompactTableActionButton>
          ) : null}
        </div>
      ),
    },
  ];
  return cols;
}

const ADJUSTMENT_CATEGORY_OPTIONS = [
  { value: 'BONUS', label: 'Bonus' },
  { value: 'EXTRA_SHIFT', label: 'Extra shift' },
  { value: 'PERFORMANCE', label: 'Performance' },
  { value: 'DEDUCTION', label: 'Deduction' },
  { value: 'CLAWBACK', label: 'Clawback' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * Full payout breakdown — staff/role, pay math, bonus lines, adjustments, and
 * bank details. Rendered as page sections on the payout detail route (formerly
 * a modal). The route supplies the payout + its adjustments; when
 * `canEditAdjustments` is set, each adjustment row can be edited or removed
 * inline (both recompute the payout's net server-side).
 */
export function PayoutDetailSections({
  payout,
  adjustments,
  canEditAdjustments = false,
}: {
  payout: BatchPayoutLine;
  adjustments: BatchAdjustment[];
  canEditAdjustments?: boolean;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [editTarget, setEditTarget] = useState<BatchAdjustment | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BatchAdjustment | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('BONUS');
  const [editReason, setEditReason] = useState('');
  const submitting = fetcher.state !== 'idle';

  useFetcherToast(fetcher.data, { successMessage: 'Adjustment updated. Net pay recalculated.' });
  useCloseOnFetcherSuccess(fetcher, () => {
    setEditTarget(null);
    setRemoveTarget(null);
  });

  const openEdit = useCallback((a: BatchAdjustment) => {
    setEditAmount(String(Math.abs(Number(a.amount))));
    setEditCategory(a.category);
    setEditReason(a.reason);
    setEditTarget(a);
  }, []);

  const submitEdit = useCallback(() => {
    if (!editTarget) return;
    const fd = new FormData();
    fd.set('intent', 'updateAdjustment');
    fd.set('adjustmentId', editTarget.id);
    fd.set('amount', editAmount);
    fd.set('category', editCategory);
    fd.set('reason', editReason);
    fetcher.submit(fd, { method: 'post' });
  }, [editTarget, editAmount, editCategory, editReason, fetcher]);

  const submitRemove = useCallback(() => {
    if (!removeTarget) return;
    const fd = new FormData();
    fd.set('intent', 'deleteAdjustment');
    fd.set('adjustmentId', removeTarget.id);
    fetcher.submit(fd, { method: 'post' });
  }, [removeTarget, fetcher]);

  const bonusLines = parseBonusLines(payout.bonusBreakdown);
  const proration = (() => {
    const snap = payout.metricsSnapshot as { proration?: { activeDays: number; periodDays: number } } | null;
    const p = snap?.proration;
    if (!p || !p.periodDays || p.activeDays >= p.periodDays) return null;
    return p;
  })();
  const hasBank =
    !!payout.payoutBankName ||
    !!payout.payoutBankCode ||
    !!payout.payoutAccountName ||
    !!payout.payoutAccountNumber;

  // Money figures. Earnings build UP to gross; statutory/deduction lines pull it
  // DOWN to net. Split into two groups so the breakdown reads as a flow rather
  // than an undifferentiated list.
  const baseSalary = Number(payout.baseSalary);
  const performanceBonus = Number(payout.performanceBonus);
  const allowances = Number(payout.allowancesTotal ?? 0);
  const addOns = Number(payout.addOnsTotal);
  const deductions = Number(payout.deductionsTotal);
  const grossPay = Number(payout.grossPay ?? payout.totalPayout);
  const payeTax = Number(payout.payeTax ?? 0);
  const employerSubsidy = Number(payout.employerPayeSubsidy ?? 0);
  const netPay = Number(payout.netPay ?? payout.totalPayout);

  const earningLines: { label: string; amount: number; hint?: ReactNode }[] = [
    {
      label: 'Base salary',
      amount: baseSalary,
      hint: proration ? (
        <span className="text-warning-700 dark:text-warning-300">
          Prorated: {proration.activeDays} of {proration.periodDays} days
        </span>
      ) : undefined,
    },
    { label: 'Performance bonus', amount: performanceBonus },
    { label: 'Allowances', amount: allowances },
    { label: 'Add-ons', amount: addOns },
  ].filter((l) => l.amount !== 0 || l.label === 'Base salary');

  const deductionLines: { label: string; amount: number; hint?: ReactNode }[] = [
    { label: 'Deductions', amount: deductions },
    { label: 'PAYE tax', amount: payeTax },
  ].filter((l) => l.amount !== 0);

  const staffInitials = payout.staffName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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
    <div className="space-y-4">
      {/* Identity header \u2014 avatar + name + role + statuses, in one dense row. */}
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-sm font-semibold text-brand-600 dark:text-brand-300">
            {staffInitials || '?'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-app-fg">{payout.staffName}</p>
            <p className="truncate text-xs text-app-fg-muted">
              {payout.payRoleName?.trim() || 'No pay role'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {payout.staffRole ? (
            <RoleBadge role={payout.staffRole} size="sm" variant="chip" />
          ) : (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Contractor
            </span>
          )}
          <StatusBadge status={payout.status} />
          {payout.lineStatus && payout.lineStatus !== 'OK' ? (
            <StatusBadge status={payout.lineStatus} />
          ) : null}
        </div>
      </div>

      {/* Net-pay hero \u2014 the headline figure, with the gross \u2192 deductions flow. */}
      <div className="card bg-gradient-to-br from-brand-500/[0.07] to-transparent">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">Net pay</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-app-fg">
              <NairaPrice amount={netPay} />
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <p className="text-2xs uppercase tracking-wide text-app-fg-muted">Gross</p>
              <p className="tabular-nums font-medium text-app-fg">
                <NairaPrice amount={grossPay} />
              </p>
            </div>
            <span className="text-app-fg-muted">{'\u2212'}</span>
            <div className="text-right">
              <p className="text-2xs uppercase tracking-wide text-app-fg-muted">Deducted</p>
              <p className="tabular-nums font-medium text-danger-600 dark:text-danger-400">
                <NairaPrice amount={Math.max(0, grossPay - netPay)} />
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Earnings (build to gross) and deductions (pull to net), side by side. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <div className="card space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">Earnings</h4>
          <ul className="space-y-2.5">
            {earningLines.map((l) => (
              <li key={l.label} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-app-fg-muted">
                  {l.label}
                  {l.hint ? <span className="ml-2 text-2xs">{l.hint}</span> : null}
                </span>
                <span className="tabular-nums font-medium text-app-fg">
                  <NairaPrice amount={l.amount} />
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-3 border-t border-app-border pt-2.5 text-sm">
            <span className="font-semibold text-app-fg">Gross pay</span>
            <span className="tabular-nums font-semibold text-app-fg">
              <NairaPrice amount={grossPay} />
            </span>
          </div>
        </div>

        <div className="card space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
            Deductions &amp; tax
          </h4>
          {deductionLines.length > 0 ? (
            <ul className="space-y-2.5">
              {deductionLines.map((l) => (
                <li key={l.label} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-app-fg-muted">{l.label}</span>
                  <span className="tabular-nums font-medium text-danger-600 dark:text-danger-400">
                    {'\u2212'}
                    <NairaPrice amount={l.amount} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-app-fg-muted">No deductions on this payout.</p>
          )}
          {employerSubsidy > 0 ? (
            <p className="text-2xs text-app-fg-muted">
              Employer PAYE subsidy of <NairaPrice amount={employerSubsidy} /> is paid by the company
              and does not reduce net pay.
            </p>
          ) : null}
          <div className="flex items-baseline justify-between gap-3 border-t border-app-border pt-2.5 text-sm">
            <span className="font-semibold text-app-fg">Net pay</span>
            <span className="tabular-nums font-semibold text-success-600 dark:text-success-400">
              <NairaPrice amount={netPay} />
            </span>
          </div>
        </div>
      </div>

      {adjustments.length > 0 ? (
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
              Adjustments
            </h4>
            <span className="text-2xs text-app-fg-muted">
              {adjustments.length} {adjustments.length === 1 ? 'record' : 'records'}
            </span>
          </div>
          <ul className="divide-y divide-app-border">
            {adjustments.map((a) => {
              const negative = Number(a.amount) < 0;
              const ts = formatOrderTimestampShort(a.createdAt);
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={a.category} />
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          negative
                            ? 'text-danger-600 dark:text-danger-400'
                            : 'text-success-600 dark:text-success-400'
                        }`}
                      >
                        {negative ? '\u2212' : '+'}
                        <NairaPrice amount={Math.abs(Number(a.amount))} />
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-app-fg-muted">{a.reason}</p>
                    {ts && ts !== '\u2014' ? (
                      <p className="mt-0.5 text-2xs text-app-fg-muted">Added {ts}</p>
                    ) : null}
                  </div>
                  {canEditAdjustments ? (
                    <div className="flex shrink-0 items-center gap-1.5 sm:justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={submitting}
                        onClick={() => openEdit(a)}
                      >
                        Adjust
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={submitting}
                        onClick={() => setRemoveTarget(a)}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {canEditAdjustments ? (
            <p className="text-2xs text-app-fg-muted">
              Editing or removing an adjustment recalculates this payout's net pay automatically.
            </p>
          ) : null}
        </div>
      ) : null}

      {(bonusLines.length > 0 || hasBank) ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          {bonusLines.length > 0 ? (
            <div className="card space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                Bonus lines
              </h4>
              <ul className="space-y-1.5">
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

          {hasBank ? (
            <div className="card space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                Bank details
              </h4>
              <DescriptionList items={bankItems} layout="stacked" divided />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Edit an adjustment inline. Amount is entered as a magnitude; the server
          re-signs it by category (deductions negative). */}
      <Modal
        open={!!editTarget}
        onClose={() => (submitting ? undefined : setEditTarget(null))}
        maxWidth="max-w-md"
        contentClassName="p-5"
      >
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-app-fg">Adjust record</h3>
          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg-muted">Category</label>
            <FormSelect
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              options={ADJUSTMENT_CATEGORY_OPTIONS}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg-muted">Amount</label>
            <AmountInput value={editAmount} onChange={setEditAmount} />
            <p className="mt-1 text-2xs text-app-fg-muted">
              Enter a positive amount: deduction categories are subtracted automatically.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg-muted">Reason</label>
            <Textarea
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              rows={2}
              minLength={5}
              placeholder="Reason (min 5 chars)"
            />
          </div>
          <ModalFetcherInlineError message={(fetcher.data as { error?: string } | undefined)?.error ?? null} />
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={submitting}
              loadingText="Saving..."
              onClick={submitEdit}
            >
              Save changes
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmActionModal
        open={!!removeTarget}
        onClose={() => (submitting ? undefined : setRemoveTarget(null))}
        title="Remove adjustment"
        description="This removes the adjustment from this payout and recalculates net pay. This cannot be undone."
        details={
          removeTarget ? (
            <ul className="space-y-0.5">
              <li>
                {removeTarget.category}:{' '}
                {Number(removeTarget.amount) < 0 ? '\u2212' : '+'}
                <NairaPrice amount={Math.abs(Number(removeTarget.amount))} />
              </li>
              <li className="text-app-fg-muted">{removeTarget.reason}</li>
            </ul>
          ) : null
        }
        confirmLabel="Remove"
        variant="danger"
        loading={submitting}
        error={(fetcher.data as { error?: string } | undefined)?.error ?? null}
        onConfirm={submitRemove}
      />
    </div>
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
  branchName: branchNameProp,
  viewer,
  users = [],
  contractors = [],
}: {
  detail: BatchDetail;
  branchName: string | null;
  viewer: ViewerInfo;
  users?: HRUser[];
  contractors?: PayrollContractorOption[];
}) {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const payrollSurface = useFetcherActionSurface(fetcher);
  const [showAdjust, setShowAdjust] = useState<{ payoutId: string; staffName: string; currentTotal: number } | null>(null);
  const [showRemove, setShowRemove] = useState<{ payoutId: string; staffName: string } | null>(null);
  // Live amount for the batch-adjustment before/after preview.
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustCategory, setAdjustCategory] = useState('BONUS');
  const [showReject, setShowReject] = useState(false);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [payoutSearch, setPayoutSearch] = useState('');
  // Batch-level Add-on / Deduct Salary: targets any staff/contractor for this
  // batch's month (relocated from the /hr/payroll list header).
  const [showBatchAdjustment, setShowBatchAdjustment] = useState(false);
  const [batchAdjMode, setBatchAdjMode] = useState<'ADDON' | 'DEDUCT'>('ADDON');
  const [batchAdjStaffId, setBatchAdjStaffId] = useState('');
  const [batchAdjAmount, setBatchAdjAmount] = useState('');

  useFetcherToast(fetcher.data, { successMessage: 'Payroll updated' });

  const handleSuccess = useCallback(() => {
    setShowAdjust(null);
    setShowRemove(null);
    setShowApprove(false);
    setShowReject(false);
    setShowMarkPaid(false);
    setShowRegenerate(false);
    setShowSubmit(false);
    setShowDelete(false);
    setShowBatchAdjustment(false);
    setBatchAdjAmount('');
    setBatchAdjStaffId('');
    // Finance overview / payroll list use cached loaders; clear so Paid vs Awaiting isn't stale.
    invalidateCachedLoader('/admin/finance/overview');
    invalidateCachedLoader('/hr/payroll');
    // The batch was deleted — it no longer exists, so leave the detail page.
    if ((fetcher.data as { deleted?: boolean } | undefined)?.deleted) {
      navigate('/hr/payroll');
    }
  }, [fetcher.data, navigate]);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  const { batch, payouts: allPayouts, adjustments, allowedTransitions } = detail;
  // Display label for the batch's branch, tolerant of null-branch (org-wide) batches.
  const branchName = batchBranchLabel(branchNameProp, batch.branchId, batch.scopeType);
  const payouts = useMemo(() => {
    const q = payoutSearch.toLowerCase().trim();
    const rows = q
      ? allPayouts.filter((p) => (p.staffName ?? '').toLowerCase().includes(q))
      : allPayouts;
    // Always list staff alphabetically by name (case-insensitive).
    return [...rows].sort((a, b) =>
      (a.staffName ?? '').localeCompare(b.staffName ?? '', undefined, { sensitivity: 'base' }),
    );
  }, [allPayouts, payoutSearch]);

  const submitRegenerate = useCallback(() => {
    const fd = new FormData();
    fd.set('intent', 'generateBatch');
    fd.set('periodMonth', batch.periodMonth.slice(0, 7));
    // Null-scope (contractor / ALL) batches refresh by scope, not branch/department.
    if (batch.scopeType === 'CONTRACTORS' || batch.scopeType === 'ALL') {
      fd.set('scopeType', batch.scopeType);
      if (batch.branchId) fd.set('branchId', batch.branchId);
    } else {
      if (batch.branchId) fd.set('branchId', batch.branchId);
      if (batch.department) fd.set('department', batch.department);
    }
    fetcher.submit(fd, { method: 'post' });
  }, [batch.branchId, batch.department, batch.scopeType, batch.periodMonth, fetcher]);

  // The HR edit window: add-ons/deductions, remove line, override, regenerate.
  // Open until Finance marks the batch paid (CEO 2026-08-05). Mirrors the server
  // gate `isBatchOpenForHrEdit`: DRAFT for the owning department head, or
  // PENDING_HR / PENDING_FINANCE for HR/admins only. Frozen once PAID.
  const canEditLines =
    (batch.status === 'DRAFT' && canPrepareDept(viewer, batch.department, batch.branchId)) ||
    ((batch.status === 'PENDING_HR' || batch.status === 'PENDING_FINANCE') && canReview(viewer));

  const payoutColumns = buildBatchPayoutColumns({
    batch,
    canEditLines,
    onAdjust: (payoutId, staffName, currentTotal) => {
      setAdjustAmount('');
      setAdjustCategory('BONUS');
      setShowAdjust({ payoutId, staffName, currentTotal });
    },
    onRemove: (payoutId, staffName) => {
      setShowRemove({ payoutId, staffName });
    },
  });

  const totalPaye = useMemo(
    () => payouts.reduce((sum, p) => sum + Number(p.payeTax ?? 0), 0),
    [payouts],
  );
  const totalGross = useMemo(
    () => payouts.reduce((sum, p) => sum + Number(p.grossPay ?? p.totalPayout), 0),
    [payouts],
  );

  // Regenerate follows the same HR edit window as adjustments/removals: DRAFT for
  // the owning head, or PENDING_HR/PENDING_FINANCE for HR/admins, until Finance
  // marks the batch paid (CEO 2026-08-05).
  const canRegenerate = canEditLines;

  // Batch-level Add-on / Deduct Salary is available on the same edit window as
  // line adjustments: any staff/contractor can be adjusted for this batch's
  // month while the batch is not yet paid.
  const canBatchAdjust = canEditLines;
  const openBatchAdjust = useCallback((mode: 'ADDON' | 'DEDUCT') => {
    setBatchAdjMode(mode);
    setBatchAdjStaffId('');
    setBatchAdjAmount('');
    setShowBatchAdjustment(true);
  }, []);

  /** All workflow actions live in the top-right header now (desktop inline + mobile sheet). */
  const showHeaderWorkflowActions =
    allowedTransitions.length > 0 || canRegenerate || canBatchAdjust;

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
      {canBatchAdjust && (
        <>
          <Button type="button" variant="primary" size="sm" onClick={() => openBatchAdjust('ADDON')}>
            Add-on
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={() => openBatchAdjust('DEDUCT')}>
            Deduct Salary
          </Button>
        </>
      )}
      {canRegenerate && (
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
      {allowedTransitions.includes('DELETE') && (
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={fetcher.state === 'submitting' && showDelete}
          onClick={() => setShowDelete(true)}
        >
          Delete batch
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${batchScopeLabel(batch.department, batch.scopeType)} \u00b7 ${formatMonth(batch.periodMonth)}`}
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
              <div className="space-y-2 [&_button]:w-full [&_button]:justify-center [&_button]:h-12">
                {showHeaderWorkflowActions ? (
                  <div className="space-y-2 [&_form]:block [&_form]:w-full [&_button]:w-full [&_button]:justify-center [&_button]:h-12">
                    {allowedTransitions.includes('SUBMIT') && (
                      <Button
                        type="button"
                        variant="primary"
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
                    {allowedTransitions.includes('APPROVE') && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        className="w-full justify-center h-12"
                        onClick={() => {
                          closeSheet();
                          setShowApprove(true);
                        }}
                      >
                        Approve & send to Finance
                      </Button>
                    )}
                    {allowedTransitions.includes('MARK_PAID') && (
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        className="w-full justify-center h-12"
                        onClick={() => {
                          closeSheet();
                          setShowMarkPaid(true);
                        }}
                      >
                        Mark Paid
                      </Button>
                    )}
                    {allowedTransitions.includes('REJECT') && (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        className="w-full justify-center h-12"
                        onClick={() => {
                          closeSheet();
                          setShowReject(true);
                        }}
                      >
                        Reject & send back
                      </Button>
                    )}
                    {canBatchAdjust && (
                      <>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          className="w-full justify-center h-12"
                          onClick={() => {
                            closeSheet();
                            openBatchAdjust('ADDON');
                          }}
                        >
                          Add-on
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          className="w-full justify-center h-12"
                          onClick={() => {
                            closeSheet();
                            openBatchAdjust('DEDUCT');
                          }}
                        >
                          Deduct Salary
                        </Button>
                      </>
                    )}
                    {canRegenerate && (
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
                    {allowedTransitions.includes('DELETE') && (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        className="w-full justify-center h-12"
                        loading={fetcher.state === 'submitting' && showDelete}
                        onClick={() => {
                          closeSheet();
                          setShowDelete(true);
                        }}
                      >
                        Delete batch
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
            <PageSearchControl
              value={payoutSearch}
              onApply={setPayoutSearch}
              placeholder="Search by name"
              title="Search payouts"
            />
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
            scrollX={false}
            columns={payoutColumns}
            rows={payouts}
            rowKey={(p) => p.id}
            rowHref={(p) => `/hr/payroll-batch/${batch.id}/payout/${p.id}`}
            renderMobileCard={(p) => (
              <div className="w-full">
                <Link
                  to={`/hr/payroll-batch/${batch.id}/payout/${p.id}`}
                  className="block w-full text-left p-4 space-y-2 hover:bg-app-hover transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-app-fg text-sm truncate">{p.staffName}</p>
                    {p.staffRole ? (
                      <RoleBadge role={p.staffRole} size="sm" variant="chip" />
                    ) : (
                      <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Contractor
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-app-fg-muted">Net</span>
                    <span className="font-semibold text-app-fg">
                      <NairaPrice amount={Number(p.totalPayout ?? p.netPay)} />
                    </span>
                  </div>
                </Link>
                {canEditLines ? (
                  <div className="flex justify-end border-t border-app-border px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setShowRemove({ payoutId: p.id, staffName: p.staffName })}
                      className="text-xs font-medium text-danger-600 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300"
                    >
                      Remove from batch
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          />
        )}
      </div>

      {/* Sub-modals */}

      {/* Batch-level Add-on / Deduct Salary — target any staff/contractor for
          THIS batch's month (relocated from the /hr/payroll list header). The
          payroll month is locked to the batch's month. */}
      {showBatchAdjustment && (() => {
        const isDeduct = batchAdjMode === 'DEDUCT';
        const categories = isDeduct ? ADJ_DEDUCT_CATEGORIES : ADJ_ADDON_CATEGORIES;
        const magnitude = Math.abs(Number(batchAdjAmount) || 0);
        const monthLabel = formatMonth(batch.periodMonth);
        return (
          <Modal
            open
            onClose={() => {
              if (fetcher.state !== 'idle') return;
              setShowBatchAdjustment(false);
            }}
            maxWidth="max-w-lg"
            backdropBlur
            contentClassName="p-5 space-y-4"
          >
            <h4 className="text-base font-semibold text-app-fg">
              {isDeduct ? 'Deduct Salary' : 'Add Earning Add-on'}
            </h4>
            <p className="text-xs text-app-fg-muted">
              Applies to this batch{'’'}s month: <strong>{monthLabel}</strong>.
            </p>
            <ModalFetcherInlineError message={payrollSurface.errorMatchingIntent('createAdjustment')} />
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="createAdjustment" />
              <input type="hidden" name="staffId" value={batchAdjStaffId} />
              {/* Lock the target month to the batch's month. */}
              <input type="hidden" name="periodMonth" value={batch.periodMonth.slice(0, 7)} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SearchableSelect
                  id="batch-adjustment-staffId"
                  label="Staff or contractor"
                  required
                  value={batchAdjStaffId}
                  onChange={setBatchAdjStaffId}
                  placeholder="Select staff or contractor..."
                  searchPlaceholder="Search..."
                  options={[
                    ...users.map((u) => ({
                      value: `staff:${u.id}`,
                      label: `${u.name}${u.role ? ` (${formatRoleLabel(u.role)})` : ''}`,
                    })),
                    ...contractors.map((c) => ({
                      value: `contractor:${c.id}`,
                      label: `${c.name} (Contractor)`,
                    })),
                  ]}
                />
                <FormSelect
                  label="Category"
                  name="category"
                  required
                  placeholder="Select category..."
                  options={categories.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
                />
                <div>
                  <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount (&#8358;)</label>
                  <AmountInput
                    name="amount"
                    required
                    placeholder="e.g. 5,000.00"
                    className="input"
                    value={batchAdjAmount}
                    onChange={setBatchAdjAmount}
                  />
                  <p className={`mt-1 text-xs font-medium ${isDeduct ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                    {magnitude > 0
                      ? isDeduct
                        ? `This will reduce the ${monthLabel} payout by ${formatNaira(magnitude)}.`
                        : `This will add ${formatNaira(magnitude)} to the ${monthLabel} payout.`
                      : isDeduct
                        ? `This amount will be subtracted from the ${monthLabel} payout.`
                        : `This amount will be added to the ${monthLabel} payout.`}
                  </p>
                </div>
                <TextInput
                  label="Reason"
                  name="reason"
                  type="text"
                  required
                  minLength={5}
                  placeholder={isDeduct ? 'Reason for deduction (min 5 chars)' : 'Reason for add-on (min 5 chars)'}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  type="submit"
                  variant={isDeduct ? 'danger' : 'primary'}
                  size="sm"
                  loading={fetcher.state === 'submitting'}
                  loadingText="Saving..."
                >
                  {isDeduct ? 'Deduct Salary' : 'Add Add-on'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={fetcher.state !== 'idle'}
                  onClick={() => setShowBatchAdjustment(false)}
                >
                  Cancel
                </Button>
              </div>
            </fetcher.Form>
          </Modal>
        );
      })()}

      {showAdjust && (() => {
        const isDeduct = adjustCategory === 'DEDUCTION' || adjustCategory === 'CLAWBACK';
        const magnitude = Math.abs(Number(adjustAmount) || 0);
        // Sign follows the category so the preview and the stored value agree
        // with recomputePayoutTotals (which subtracts DEDUCTION/CLAWBACK).
        const signed = isDeduct ? -magnitude : magnitude;
        const newTotal = Math.max(0, showAdjust.currentTotal + signed);
        return (
        <Modal open onClose={() => setShowAdjust(null)} maxWidth="max-w-sm" backdropBlur contentClassName="p-5 space-y-3">
          <h4 className="text-base font-semibold text-app-fg">Adjust {showAdjust.staffName}</h4>
          <ModalFetcherInlineError message={payrollSurface.errorMatchingIntent('addBatchAdjustment')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="addBatchAdjustment" />
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="payoutId" value={showAdjust.payoutId} />
            {/* Submit the signed value so a deduction actually subtracts. */}
            <input type="hidden" name="amount" value={String(signed)} />
            <FormSelect
              label="Category"
              name="category"
              required
              value={adjustCategory}
              onChange={(e) => setAdjustCategory(e.target.value)}
              options={[
                { value: 'BONUS', label: 'Bonus (add-on)' },
                { value: 'EXTRA_SHIFT', label: 'Extra shift (add-on)' },
                { value: 'PERFORMANCE', label: 'Performance (add-on)' },
                { value: 'OTHER', label: 'Other (add-on)' },
                { value: 'DEDUCTION', label: 'Deduction (subtract)' },
                { value: 'CLAWBACK', label: 'Clawback (subtract)' },
              ]}
            />
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount (&#8358;)</label>
              <AmountInput
                required
                placeholder="e.g. 5,000.00"
                className="input"
                value={adjustAmount}
                onChange={setAdjustAmount}
              />
            </div>
            <TextInput label="Reason" name="reason" required minLength={5} placeholder="Why this adjustment?" />
            <div className="rounded-md border border-app-border bg-app-muted/40 px-3 py-2 text-sm space-y-1">
              <div className="flex items-center justify-between text-app-fg-muted">
                <span>Current total</span>
                <NairaPrice amount={showAdjust.currentTotal} />
              </div>
              <div className={`flex items-center justify-between ${isDeduct ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                <span>{isDeduct ? 'Deduction' : 'Add-on'}</span>
                <span className="tabular-nums">{isDeduct ? '-' : '+'}{formatNaira(magnitude)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-app-border pt-1 font-semibold text-app-fg">
                <span>New total</span>
                <NairaPrice amount={newTotal} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant={isDeduct ? 'danger' : 'primary'}
                size="sm"
                loading={fetcher.state === 'submitting'}
              >
                {isDeduct ? 'Apply deduction' : 'Apply add-on'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowAdjust(null)}>Cancel</Button>
            </div>
          </fetcher.Form>
        </Modal>
        );
      })()}

      {showRemove && (
        <ConfirmActionModal
          open
          onClose={() => setShowRemove(null)}
          error={payrollSurface.errorMatchingIntent('removePayoutLine')}
          title="Remove payout from batch"
          description={
            <p>
              Remove <strong>{showRemove.staffName}</strong>&rsquo;s payout line from this{' '}
              {batchScopeLabel(batch.department, batch.scopeType)} batch for{' '}
              <strong>{formatMonth(batch.periodMonth)}</strong>?
            </p>
          }
          details={
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>Batch totals and staff count update to exclude this line</li>
              <li>Any adjustments on this line are unlinked but kept for the record</li>
              <li>Re-generating the batch brings the person back if they still qualify</li>
            </ul>
          }
          confirmLabel="Remove payout"
          variant="danger"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            fetcher.submit(
              { intent: 'removePayoutLine', batchId: batch.id, payoutId: showRemove.payoutId },
              { method: 'post' },
            );
          }}
        />
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
                Submit this {batchScopeLabel(batch.department, batch.scopeType)} draft for{' '}
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
                This replaces all payout lines in this batch with fresh numbers from the latest
                payroll rules, delivered orders, and staff pay profiles.
              </p>
              <p className="mt-2 text-app-fg-muted">
                {batchScopeLabel(batch.department, batch.scopeType)} · {formatMonth(batch.periodMonth)} · {branchName}
              </p>
            </>
          }
          details={
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>Current payout lines will be wiped and rebuilt</li>
              <li>Add-ons and deductions re-apply automatically; manual line overrides are lost</li>
              <li>Allowed until Finance marks the batch paid</li>
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

      {showDelete && (
        <ConfirmActionModal
          open
          onClose={() => setShowDelete(false)}
          error={payrollSurface.errorMatchingIntent('deleteBatch')}
          title="Delete this batch"
          description={
            <>
              <p>
                Permanently delete the {batchScopeLabel(batch.department, batch.scopeType)} batch for{' '}
                <strong>{formatMonth(batch.periodMonth)}</strong> ({branchName})?
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
              <li>All payout lines in this batch are removed</li>
              <li>This cannot be undone</li>
              <li>Paid batches cannot be deleted</li>
            </ul>
          }
          confirmLabel="Delete batch"
          variant="danger"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            fetcher.submit(
              { intent: 'deleteBatch', batchId: batch.id },
              { method: 'post' },
            );
          }}
        />
      )}

      <LocalExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        title="Export payout lines"
        description="Choose format and columns for this batch's staff payouts."
        filenamePrefix={`payroll-${batchScopeLabel(batch.department, batch.scopeType).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${batch.periodMonth.slice(0, 7)}`}
        rows={[...allPayouts]
          .sort((a, b) =>
            (a.staffName ?? '').localeCompare(b.staffName ?? '', undefined, { sensitivity: 'base' }),
          )
          .map((p) => ({
          staff: p.staffName,
          role: p.staffRole ? formatRole(p.staffRole) : (p.payRoleName?.trim() || 'Contractor'),
          base: Number(p.baseSalary),
          bonus: Number(p.performanceBonus),
          addOns: Number(p.addOnsTotal),
          deductions: Number(p.deductionsTotal),
          gross: Number(p.grossPay ?? p.totalPayout),
          paye: Number(p.payeTax ?? 0),
          net: Number(p.totalPayout ?? p.netPay),
          status: p.status,
        }))}
        columns={[
          { key: 'staff', label: 'Staff' },
          { key: 'role', label: 'Role' },
          { key: 'base', label: 'Base (₦)' },
          { key: 'bonus', label: 'Bonus (₦)' },
          { key: 'addOns', label: 'Add-ons (₦)' },
          { key: 'deductions', label: 'Deductions (₦)' },
          { key: 'gross', label: 'Gross (₦)' },
          { key: 'paye', label: 'PAYE (₦)' },
          { key: 'net', label: 'Net (₦)' },
          { key: 'status', label: 'Status' },
        ]}
        defaultColumns={['staff', 'role', 'base', 'bonus', 'addOns', 'deductions', 'gross', 'paye', 'net', 'status']}
      />
    </div>
  );
}
