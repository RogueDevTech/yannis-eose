import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { formatRoleLabel } from '~/components/ui/role-badge';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import {
  applyOptimisticPatches,
  isOptimisticPatched,
  useOptimisticListPatches,
} from '~/hooks/useOptimisticListPatches';
import { PageNotification } from '~/components/ui/page-notification';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { TableActionButton } from '~/components/ui/table-action-button';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Modal } from '~/components/ui/modal';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { PageHeader } from '~/components/ui/page-header';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { NairaPrice } from '~/components/ui/naira-price';
import { TextInput } from '~/components/ui/text-input';
import { DateTimeText } from '~/components/ui/date-time-text';
import type { Adjustment, HRUser, HRStreamData } from './types';
import { humanizeZodIssuesString } from '~/lib/api-error';
import { formatNaira } from '~/lib/format-amount';
import { MonthlyPayrolls } from './MonthlyPayrolls';
import { PayrollBankPayExportModal } from './PayrollBankPayExportModal';
import { ADMIN_ROLES, DEPT_OWNER_ROLE, ALL_DEPARTMENTS } from './payroll-constants';
import { hasFinanceAccess, isAdminLevel } from '~/lib/rbac';

const ADJ_ADDON_CATEGORIES = ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER'];
const ADJ_DEDUCT_CATEGORIES = ['DEDUCTION', 'CLAWBACK'];
const ADJ_ALL_CATEGORIES = [...ADJ_ADDON_CATEGORIES, ...ADJ_DEDUCT_CATEGORIES];

/**
 * Human-readable month for an adjustment's target batch (e.g. "Aug 2026").
 * `periodMonth` may be a full date ("2026-08-01") or a "YYYY-MM" prefix; both
 * are handled. Returns null when the adjustment is not earmarked for a month
 * (floating — absorbed by the next open batch).
 */
function adjustmentPeriodLabel(periodMonth?: string | null): string | null {
  if (!periodMonth) return null;
  const m = /^(\d{4})-(\d{2})/.exec(periodMonth);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-01T00:00:00Z`).toLocaleDateString('en-NG', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Short, human label for the linked batch's status (null when floating). */
function adjustmentBatchStatusLabel(batchStatus?: string | null): string | null {
  if (!batchStatus) return null;
  const map: Record<string, string> = {
    DRAFT: 'Draft',
    PENDING_HR: 'Pending HR',
    PENDING_FINANCE: 'Pending Finance',
    PAID: 'Paid',
  };
  return map[batchStatus] ?? batchStatus.replace(/_/g, ' ');
}

/**
 * HR & Payroll landing page.
 *
 * Layout philosophy (CEO directive 2026-04-26): the heavy concerns are split across separate
 * routes — Commission Plans → /hr/plans. This page focuses on the multi-stage payroll
 * workflow (Monthly Payrolls) plus a small Adjustments inbox that only HR + Finance use.
 * Heads of Department land on this page and see only Monthly Payrolls.
 *
 * The legacy /hr/payouts flat list was retired (2026-04-28) — per-payout PAID status is now
 * visible inside each Monthly Payroll batch detail (`MonthlyPayrolls.tsx`) once Finance marks
 * the batch paid (which cascades each child `payoutRecords.status` to PAID).
 *
 * The Settlement Config tab was removed — payroll always runs monthly.
 */
export function HRPage({
  adjustments,
  users,
  contractors,
  monthlyPayrolls,
  branches,
  viewer,
  filters,
}: HRStreamData) {
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const hrSurface = useFetcherActionSurface(fetcher);
  const [activeTab, setActiveTab] = useState<'monthly' | 'adjustments'>('monthly');
  // Adjustments tab filters. Search matches staff/contractor name + reason;
  // category / status / period narrow the list. All client-side over the already
  // loaded adjustments (the tab is a small HR inbox, not a paginated feed).
  const [adjustmentSearch, setAdjustmentSearch] = useState('');
  const [adjustmentCategoryFilter, setAdjustmentCategoryFilter] = useState('');
  const [adjustmentStatusFilter, setAdjustmentStatusFilter] = useState('');
  const [adjustmentPeriodFilter, setAdjustmentPeriodFilter] = useState('');
  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  // Which kind of adjustment the modal is creating. Deciding this up front (via
  // two distinct buttons) removes the old ambiguity where a positive amount in a
  // DEDUCTION-less form silently behaved like an add-on.
  const [adjustmentMode, setAdjustmentMode] = useState<'ADDON' | 'DEDUCT'>('ADDON');
  const [showBankPayExport, setShowBankPayExport] = useState(false);
  const [adjustmentStaffId, setAdjustmentStaffId] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  // Target payroll month (YYYY-MM), defaulting to the current month. Folds the
  // adjustment into that month's batch; an open (DRAFT/PENDING_HR) batch absorbs
  // it immediately, otherwise it waits for that month's generate.
  const [adjustmentMonth, setAdjustmentMonth] = useState(() => {
    // Default to the current NIGERIA month (payroll runs on WAT), not the
    // browser's local month — otherwise a user near midnight in another TZ could
    // earmark the adjustment to the wrong payroll period.
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    return `${y}-${m}`;
  });
  const [approveAdjustmentTarget, setApproveAdjustmentTarget] = useState<Adjustment | null>(null);
  // Edit / delete of an existing adjustment (only while not locked in a finalized batch).
  const [editAdjustmentTarget, setEditAdjustmentTarget] = useState<Adjustment | null>(null);
  const [deleteAdjustmentTarget, setDeleteAdjustmentTarget] = useState<Adjustment | null>(null);
  const [editAmount, setEditAmount] = useState('');

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, {
    successMessage: 'HR action completed',
    skipErrorToast: Boolean(
      (showAddAdjustment && hrSurface.errorMatchingIntent('createAdjustment')) ||
        (editAdjustmentTarget && hrSurface.errorMatchingIntent('updateAdjustment')),
    ),
  });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  /** Close add-on modal after a successful mutation (same fetcher handles
   *  approve actions too — both intents resolve through this single hook). */
  const handleHrFetcherSuccess = useCallback(() => {
    setShowAddAdjustment(false);
    setApproveAdjustmentTarget(null);
    setEditAdjustmentTarget(null);
    setDeleteAdjustmentTarget(null);
    setAdjustmentAmount('');
    setEditAmount('');
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleHrFetcherSuccess);

  /** Optimistic-edit overlay: when HR clicks Approve on an adjustment row, flip
   *  the row's `approvedBy` field IMMEDIATELY so the status badge changes from
   *  PENDING to APPROVED on the same tick the toast fires. The canonical row
   *  drops the overlay once revalidation completes. Snaps back if the action
   *  fails — `useFetcherToast` surfaces the error. */
  const buildAdjustmentApprovalPatches = useCallback<
    (fd: FormData, intent: string) => { id: string; patch: Partial<Adjustment> }[] | null
  >((fd, intent) => {
    if (intent !== 'approveAdjustment') return null;
    const adjustmentId = fd.get('adjustmentId')?.toString();
    if (!adjustmentId) return null;
    return [{ id: adjustmentId, patch: { approvedBy: viewer.id } }];
  }, [viewer.id]);
  const adjustmentApprovalPatches = useOptimisticListPatches<Adjustment>(
    fetcher,
    buildAdjustmentApprovalPatches,
  );

  const isAdmin = isAdminLevel(viewer);
  const isHrOrFinance = isAdmin || viewer.role === 'HR_MANAGER' || viewer.role === 'FINANCE_OFFICER';

  /**
   * HR may still correct an adjustment while it is floating or only sitting in an
   * open batch (DRAFT / PENDING_HR). Once it advances to Finance review or is paid
   * the numbers are committed, so Edit/Delete is hidden. Mirrors the server guard.
   */
  const canModifyAdjustment = useCallback(
    (adj: Adjustment) => !adj.batchStatus || adj.batchStatus === 'DRAFT' || adj.batchStatus === 'PENDING_HR',
    [],
  );
  const canExportBankPay =
    isAdmin ||
    hasFinanceAccess(viewer) ||
    (viewer.permissions ?? []).includes('finance.disburse') ||
    // HR completes its own payroll run via the payroll-scoped disbursement key.
    (viewer.permissions ?? []).includes('payroll.run.disburse');

  const showGenerateButton = useMemo(() => {
    const generatableDepartments = ADMIN_ROLES.has(viewer.role)
      ? ALL_DEPARTMENTS
      : viewer.prepareDepartments?.length
        ? viewer.prepareDepartments
        : viewer.role === 'HR_MANAGER'
          ? ['LOGISTICS', 'HR']
          : ALL_DEPARTMENTS.filter((d) => DEPT_OWNER_ROLE[d] === viewer.role);
    const generatableBranches = ADMIN_ROLES.has(viewer.role)
      ? branches
      : viewer.prepareBranchIds?.length
        ? branches.filter((b) => viewer.prepareBranchIds?.includes(b.id))
        : branches.filter((b) => b.id === viewer.currentBranchId);
    return generatableDepartments.length > 0 && generatableBranches.length > 0;
  }, [viewer, branches]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="HR & Payroll"
        mobileInlineActions
        description="Run monthly payroll and manage staff adjustments."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="HR toolbar"
            saveFilterKey
            desktop={
              <div className="flex items-center gap-2 flex-wrap">
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
                {canExportBankPay ? (
                  <Button variant="secondary" size="sm" onClick={() => setShowBankPayExport(true)}>
                    Export bank pay
                  </Button>
                ) : null}
                {isHrOrFinance ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setAdjustmentMode('ADDON');
                        setShowAddAdjustment(true);
                      }}
                    >
                      Add-on
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setAdjustmentMode('DEDUCT');
                        setShowAddAdjustment(true);
                      }}
                    >
                      Deduct Salary
                    </Button>
                  </>
                ) : null}
                {showGenerateButton ? (
                  <Button variant="primary" size="sm" onClick={() => navigate('/hr/payroll/generate')}>
                    Generate Monthly Batch
                  </Button>
                ) : null}
              </div>
            }
            sheet={({ closeSheet }) => (
              <>
                {canExportBankPay ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowBankPayExport(true);
                    }}
                  >
                    Export bank pay
                  </Button>
                ) : null}
                {isHrOrFinance ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-12 w-full justify-center"
                      onClick={() => {
                        closeSheet();
                        setAdjustmentMode('ADDON');
                        setShowAddAdjustment(true);
                      }}
                    >
                      Add-on
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="h-12 w-full justify-center"
                      onClick={() => {
                        closeSheet();
                        setAdjustmentMode('DEDUCT');
                        setShowAddAdjustment(true);
                      }}
                    >
                      Deduct Salary
                    </Button>
                  </>
                ) : null}
                {showGenerateButton ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      navigate('/hr/payroll/generate');
                    }}
                  >
                    Generate Monthly Batch
                  </Button>
                ) : null}
              </>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      {actionError &&
        !dismissedError &&
        !(showAddAdjustment && hrSurface.errorMatchingIntent('createAdjustment')) && (
        <PageNotification
          variant="error"
          message={humanizeZodIssuesString(actionError)}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Pending Clawback alert — only meaningful to HR/Finance who can act on it */}
      {isHrOrFinance && (
        <DeferredSection resolve={adjustments} skeleton="inline">
          {(resolvedAdjustments) => {
            const pendingClawbacks = resolvedAdjustments.filter(
              (a: Adjustment) => a.category === 'CLAWBACK' && !a.approvedBy,
            );
            if (pendingClawbacks.length === 0) return null;
            return (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-danger-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-danger-800 dark:text-danger-300">
                      {pendingClawbacks.length} Pending Clawback{pendingClawbacks.length > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-danger-600 dark:text-danger-400 mt-0.5">
                      These deductions will be applied in the next payroll batch.
                    </p>
                  </div>
                </div>
              </div>
            );
          }}
        </DeferredSection>
      )}

      {/* Add-on (earning adjustment) — modal for HR / Finance */}
      {isHrOrFinance && showAddAdjustment && (
        <Modal
          open
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowAddAdjustment(false);
          }}
          maxWidth="max-w-lg"
          backdropBlur
          contentClassName="p-5 space-y-4"
        >
          {(() => {
            const isDeduct = adjustmentMode === 'DEDUCT';
            const categories = isDeduct ? ADJ_DEDUCT_CATEGORIES : ADJ_ADDON_CATEGORIES;
            const magnitude = Math.abs(Number(adjustmentAmount) || 0);
            // Human-readable label for the selected payroll month (e.g. "August 2026").
            const adjustmentMonthLabel = /^\d{4}-\d{2}$/.test(adjustmentMonth)
              ? new Date(`${adjustmentMonth}-01T00:00:00Z`).toLocaleDateString('en-NG', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })
              : 'next';
            return (
          <>
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-app-fg">
              {isDeduct ? 'Deduct Salary' : 'Add Earning Add-on'}
            </h3>
            <button
              type="button"
              onClick={() => setShowAddAdjustment(false)}
              disabled={fetcher.state !== 'idle'}
              className="text-app-fg-muted hover:text-app-fg p-1 shrink-0 disabled:opacity-50"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <ModalFetcherInlineError message={hrSurface.errorMatchingIntent('createAdjustment')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="createAdjustment" />
            <input type="hidden" name="staffId" value={adjustmentStaffId} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <DeferredSection resolve={users} skeleton="inline">
                  {(resolvedUsers) => (
                    <SearchableSelect
                      id="hr-adjustment-staffId"
                      label="Staff or contractor"
                      required
                      value={adjustmentStaffId}
                      onChange={setAdjustmentStaffId}
                      placeholder="Select staff or contractor..."
                      searchPlaceholder="Search..."
                      options={[
                        ...resolvedUsers.map((u: HRUser) => ({
                          value: `staff:${u.id}`,
                          label: `${u.name}${u.role ? ` (${formatRoleLabel(u.role)})` : ''}`,
                        })),
                        ...contractors.map((c) => ({
                          value: `contractor:${c.id}`,
                          label: `${c.name} (Contractor)`,
                        })),
                      ]}
                    />
                  )}
                </DeferredSection>
              </div>
              <div>
                <FormSelect
                  label="Category"
                  name="category"
                  required
                  placeholder="Select category..."
                  options={categories.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount (&#8358;)</label>
                {/* Sign is derived server-side from the category, so HR only ever
                    types a positive magnitude here — no confusing minus signs. */}
                <AmountInput
                  name="amount"
                  required
                  placeholder="e.g. 5,000.00"
                  className="input"
                  value={adjustmentAmount}
                  onChange={setAdjustmentAmount}
                />
                <p className={`mt-1 text-xs font-medium ${isDeduct ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                  {magnitude > 0
                    ? isDeduct
                      ? `This will reduce the ${adjustmentMonthLabel} payout by ${formatNaira(magnitude)}.`
                      : `This will add ${formatNaira(magnitude)} to the ${adjustmentMonthLabel} payout.`
                    : isDeduct
                      ? `This amount will be subtracted from the ${adjustmentMonthLabel} payout.`
                      : `This amount will be added to the ${adjustmentMonthLabel} payout.`}
                </p>
              </div>
              <div>
                <TextInput
                  label="Reason"
                  name="reason"
                  type="text"
                  required
                  minLength={5}
                  placeholder={isDeduct ? 'Reason for deduction (min 5 chars)' : 'Reason for add-on (min 5 chars)'}
                />
              </div>
              <div>
                <label htmlFor="hr-adjustment-month" className="block text-sm font-medium text-app-fg-muted mb-1">
                  Payroll month
                </label>
                <input
                  id="hr-adjustment-month"
                  type="month"
                  name="periodMonth"
                  required
                  className="input"
                  value={adjustmentMonth}
                  onChange={(e) => setAdjustmentMonth(e.target.value)}
                />
                <p className="mt-1 text-xs text-app-fg-muted">
                  Applies to this month's batch. An open batch picks it up right away.
                </p>
              </div>
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
                onClick={() => setShowAddAdjustment(false)}
              >
                Cancel
              </Button>
            </div>
          </fetcher.Form>
          </>
            );
          })()}
        </Modal>
      )}

      {isHrOrFinance ? (
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v as typeof activeTab)}
          tabs={[
            { value: 'monthly', label: `Monthly Payrolls (${monthlyPayrolls.length})` },
            { value: 'adjustments', label: 'Adjustments' },
          ]}
        />
      ) : null}

      {activeTab === 'monthly' && (
        <MonthlyPayrolls
          monthlyPayrolls={monthlyPayrolls}
          branches={branches}
        />
      )}

      {activeTab === 'adjustments' && isHrOrFinance && (
        <DeferredSection resolve={adjustments} skeleton="table">
          {(resolvedAdjustments) => (
            <DeferredSection resolve={users} skeleton="table">
              {(resolvedUsers) => {
                const overlaidAdjustments = applyOptimisticPatches(
                  resolvedAdjustments,
                  adjustmentApprovalPatches,
                );
                const getPartyName = (adj: Adjustment) => {
                  if (adj.contractorId) {
                    const c = contractors.find((c) => c.id === adj.contractorId);
                    return c ? `${c.name} (Contractor)` : adj.contractorId.slice(0, 8) + '...';
                  }
                  if (!adj.staffId) return 'Unknown';
                  return resolvedUsers.find((u: HRUser) => u.id === adj.staffId)?.name ?? adj.staffId.slice(0, 8) + '...';
                };

                // Distinct target periods present in the data, for the period filter.
                // 'floating' is a synthetic key for adjustments not earmarked to a month.
                const periodOptions = (() => {
                  const seen = new Map<string, string>();
                  let hasFloating = false;
                  for (const adj of overlaidAdjustments) {
                    const label = adjustmentPeriodLabel(adj.periodMonth);
                    if (!label) {
                      hasFloating = true;
                      continue;
                    }
                    const key = String(adj.periodMonth).slice(0, 7);
                    if (!seen.has(key)) seen.set(key, label);
                  }
                  const opts = [...seen.entries()]
                    .sort((a, b) => b[0].localeCompare(a[0])) // newest month first
                    .map(([value, label]) => ({ value, label }));
                  if (hasFloating) opts.push({ value: 'floating', label: 'Unassigned (next batch)' });
                  return opts;
                })();

                const searchQ = adjustmentSearch.toLowerCase().trim();
                const filteredAdjustments = overlaidAdjustments.filter((adj) => {
                  if (searchQ) {
                    const haystack = `${getPartyName(adj)} ${adj.reason ?? ''}`.toLowerCase();
                    if (!haystack.includes(searchQ)) return false;
                  }
                  if (adjustmentCategoryFilter && adj.category !== adjustmentCategoryFilter) return false;
                  if (adjustmentStatusFilter) {
                    const isApproved = !!adj.approvedBy;
                    if (adjustmentStatusFilter === 'APPROVED' && !isApproved) return false;
                    if (adjustmentStatusFilter === 'PENDING' && isApproved) return false;
                  }
                  if (adjustmentPeriodFilter) {
                    const key = adj.periodMonth ? String(adj.periodMonth).slice(0, 7) : 'floating';
                    if (key !== adjustmentPeriodFilter) return false;
                  }
                  return true;
                });
                const hasActiveAdjustmentFilter =
                  !!searchQ ||
                  !!adjustmentCategoryFilter ||
                  !!adjustmentStatusFilter ||
                  !!adjustmentPeriodFilter;

                const adjustmentColumns: CompactTableColumn<Adjustment>[] = [
                  {
                    key: 'staff',
                    header: 'Staff / contractor',
                    render: (adj) => (
                      <p className="text-sm font-medium text-app-fg">{getPartyName(adj)}</p>
                    ),
                  },
                  {
                    key: 'category',
                    header: 'Category',
                    render: (adj) => <StatusBadge status={adj.category} />,
                  },
                  {
                    key: 'period',
                    header: 'Batch',
                    render: (adj) => {
                      const periodLabel = adjustmentPeriodLabel(adj.periodMonth);
                      const statusLabel = adjustmentBatchStatusLabel(adj.batchStatus);
                      if (!periodLabel) {
                        return (
                          <span
                            className="text-xs text-app-fg-muted"
                            title="Not tied to a batch yet: the next open batch for this month will absorb it."
                          >
                            Unassigned
                          </span>
                        );
                      }
                      return (
                        <div className="flex flex-col leading-tight">
                          <span className="text-sm text-app-fg">{periodLabel}</span>
                          {statusLabel ? (
                            <span className="text-2xs text-app-fg-muted">{statusLabel}</span>
                          ) : null}
                        </div>
                      );
                    },
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    align: 'right',
                    render: (adj) => (
                      <span
                        className={`font-medium ${Number(adj.amount) < 0 ? 'text-danger-600 dark:text-danger-400' : ''}`}
                      >
                        {Number(adj.amount) < 0 ? (
                          <>
                            <span>-</span>
                            <NairaPrice amount={Math.abs(Number(adj.amount))} />
                          </>
                        ) : (
                          <NairaPrice amount={Number(adj.amount)} />
                        )}
                      </span>
                    ),
                  },
                  {
                    key: 'reason',
                    header: 'Reason',
                    render: (adj) => (
                      <span className="text-sm text-app-fg-muted max-w-[200px] truncate block" title={adj.reason}>
                        {adj.reason}
                      </span>
                    ),
                  },
                  {
                    key: 'approved',
                    header: 'Approved',
                    render: (adj) => <StatusBadge status={adj.approvedBy ? 'APPROVED' : 'PENDING'} />,
                  },
                  {
                    key: 'date',
                    header: 'Date',
                    render: (adj) => <DateTimeText at={adj.createdAt} className="text-sm" />,
                  },
                  {
                    key: 'action',
                    header: 'Action',
                    tight: true,
                    render: (adj) => (
                      <div className="flex items-center justify-end gap-1.5">
                        {!adj.approvedBy && adj.category !== 'CLAWBACK' ? (
                          <TableActionButton
                            type="button"
                            variant="primary"
                            disabled={fetcher.state === 'submitting'}
                            onClick={() => setApproveAdjustmentTarget(adj)}
                          >
                            Approve
                          </TableActionButton>
                        ) : null}
                        {canModifyAdjustment(adj) ? (
                          <>
                            <TableActionButton
                              type="button"
                              variant="neutral"
                              disabled={fetcher.state === 'submitting'}
                              onClick={() => {
                                setEditAmount(String(Math.abs(Number(adj.amount))));
                                setEditAdjustmentTarget(adj);
                              }}
                            >
                              Edit
                            </TableActionButton>
                            <TableActionButton
                              type="button"
                              variant="danger"
                              disabled={fetcher.state === 'submitting'}
                              onClick={() => setDeleteAdjustmentTarget(adj)}
                            >
                              Delete
                            </TableActionButton>
                          </>
                        ) : null}
                      </div>
                    ),
                  },
                ];
                return (
                  <div className="list-panel">
                    <div className="flex flex-col gap-2 border-b border-app-border p-3 sm:flex-row sm:items-center">
                      <SearchInput
                        value={adjustmentSearch}
                        onChange={setAdjustmentSearch}
                        debounceMs={200}
                        placeholder="Search name or reason"
                        className="w-full sm:max-w-xs"
                      />
                      <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex sm:items-center">
                        <FormSelect
                          value={adjustmentCategoryFilter}
                          onChange={(e) => setAdjustmentCategoryFilter(e.target.value)}
                          placeholder="All categories"
                          options={[
                            { value: '', label: 'All categories' },
                            ...ADJ_ALL_CATEGORIES.map((c) => ({
                              value: c,
                              label: c.replace(/_/g, ' '),
                            })),
                          ]}
                        />
                        <FormSelect
                          value={adjustmentStatusFilter}
                          onChange={(e) => setAdjustmentStatusFilter(e.target.value)}
                          placeholder="All statuses"
                          options={[
                            { value: '', label: 'All statuses' },
                            { value: 'APPROVED', label: 'Approved' },
                            { value: 'PENDING', label: 'Pending' },
                          ]}
                        />
                        <FormSelect
                          value={adjustmentPeriodFilter}
                          onChange={(e) => setAdjustmentPeriodFilter(e.target.value)}
                          placeholder="All batches"
                          options={[{ value: '', label: 'All batches' }, ...periodOptions]}
                        />
                        {hasActiveAdjustmentFilter ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setAdjustmentSearch('');
                              setAdjustmentCategoryFilter('');
                              setAdjustmentStatusFilter('');
                              setAdjustmentPeriodFilter('');
                            }}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <CompactTable
                      withCard={false}
                      columns={adjustmentColumns}
                      rows={filteredAdjustments}
                      rowKey={(adj) => adj.id}
                      rowClassName={(adj) => (isOptimisticPatched(adjustmentApprovalPatches, adj.id) ? 'opacity-60' : '')}
                      emptyTitle={hasActiveAdjustmentFilter ? 'No matching adjustments' : 'No earnings adjustments yet'}
                      emptyDescription={
                        hasActiveAdjustmentFilter
                          ? 'Try clearing the search or filters.'
                          : 'Add an adjustment to get started.'
                      }
                      renderMobileCard={(adj) => (
                        <div className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-app-fg text-sm">{getPartyName(adj)}</span>
                            <StatusBadge status={adj.category} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span
                              className={`font-medium ${Number(adj.amount) < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}
                            >
                              {Number(adj.amount) < 0 ? (
                                <>
                                  <span>-</span>
                                  <NairaPrice amount={Math.abs(Number(adj.amount))} />
                                </>
                              ) : (
                                <NairaPrice amount={Number(adj.amount)} />
                              )}
                            </span>
                            <StatusBadge status={adj.approvedBy ? 'APPROVED' : 'PENDING'} />
                          </div>
                          <p className="text-xs text-app-fg-muted">{adj.reason}</p>
                          <p className="text-2xs text-app-fg-muted">
                            Batch:{' '}
                            {adjustmentPeriodLabel(adj.periodMonth)
                              ? `${adjustmentPeriodLabel(adj.periodMonth)}${
                                  adjustmentBatchStatusLabel(adj.batchStatus)
                                    ? ` · ${adjustmentBatchStatusLabel(adj.batchStatus)}`
                                    : ''
                                }`
                              : 'Unassigned (next batch)'}
                          </p>
                          {!adj.approvedBy && adj.category !== 'CLAWBACK' && (
                            <TableActionButton
                              type="button"
                              variant="primary"
                              className="w-full justify-center"
                              disabled={fetcher.state === 'submitting'}
                              onClick={() => setApproveAdjustmentTarget(adj)}
                            >
                              Approve
                            </TableActionButton>
                          )}
                          {canModifyAdjustment(adj) && (
                            <div className="flex gap-2">
                              <TableActionButton
                                type="button"
                                variant="neutral"
                                className="flex-1 justify-center"
                                disabled={fetcher.state === 'submitting'}
                                onClick={() => {
                                  setEditAmount(String(Math.abs(Number(adj.amount))));
                                  setEditAdjustmentTarget(adj);
                                }}
                              >
                                Edit
                              </TableActionButton>
                              <TableActionButton
                                type="button"
                                variant="danger"
                                className="flex-1 justify-center"
                                disabled={fetcher.state === 'submitting'}
                                onClick={() => setDeleteAdjustmentTarget(adj)}
                              >
                                Delete
                              </TableActionButton>
                            </div>
                          )}
                        </div>
                      )}
                    />
                  </div>
                );
              }}
            </DeferredSection>
          )}
        </DeferredSection>
      )}

      {canExportBankPay ? (
        <PayrollBankPayExportModal
          open={showBankPayExport}
          onClose={() => setShowBankPayExport(false)}
          monthlyPayrolls={monthlyPayrolls}
          branches={branches}
        />
      ) : null}

      <ConfirmActionModal
        open={!!approveAdjustmentTarget}
        onClose={() => setApproveAdjustmentTarget(null)}
        title="Approve adjustment"
        description={
          approveAdjustmentTarget
            ? `Approve this ${approveAdjustmentTarget.category.replace(/_/g, ' ').toLowerCase()} adjustment for ${
                approveAdjustmentTarget.contractorId
                  ? contractors.find((c) => c.id === approveAdjustmentTarget.contractorId)?.name ?? 'contractor'
                  : users.find((u) => u.id === approveAdjustmentTarget.staffId)?.name ?? 'staff'
              }?`
            : ''
        }
        details={
          approveAdjustmentTarget ? (
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>
                Amount{' '}
                <NairaPrice amount={Math.abs(Number(approveAdjustmentTarget.amount))} />
                {Number(approveAdjustmentTarget.amount) < 0 ? ' (deduction)' : ''}
              </li>
              <li>{approveAdjustmentTarget.reason}</li>
            </ul>
          ) : null
        }
        confirmLabel="Approve"
        variant="warning"
        loading={fetcher.state === 'submitting'}
        onConfirm={() => {
          if (!approveAdjustmentTarget) return;
          fetcher.submit(
            { intent: 'approveAdjustment', adjustmentId: approveAdjustmentTarget.id },
            { method: 'post' },
          );
        }}
      />

      {/* Edit an existing adjustment (party can't be changed). */}
      {isHrOrFinance && editAdjustmentTarget && (
        <Modal
          open
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setEditAdjustmentTarget(null);
          }}
          maxWidth="max-w-lg"
          backdropBlur
          contentClassName="p-5 space-y-4"
        >
          {(() => {
            const target = editAdjustmentTarget;
            const isDeduct = ADJ_DEDUCT_CATEGORIES.includes(target.category);
            const categories = isDeduct ? ADJ_DEDUCT_CATEGORIES : ADJ_ADDON_CATEGORIES;
            const magnitude = Math.abs(Number(editAmount) || 0);
            return (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold text-app-fg">Edit adjustment</h3>
                  <button
                    type="button"
                    onClick={() => setEditAdjustmentTarget(null)}
                    disabled={fetcher.state !== 'idle'}
                    className="text-app-fg-muted hover:text-app-fg p-1 shrink-0 disabled:opacity-50"
                    aria-label="Close"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <ModalFetcherInlineError message={hrSurface.errorMatchingIntent('updateAdjustment')} />
                <fetcher.Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="updateAdjustment" />
                  <input type="hidden" name="adjustmentId" value={target.id} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <FormSelect
                        label="Category"
                        name="category"
                        required
                        defaultValue={target.category}
                        placeholder="Select category..."
                        options={categories.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount (&#8358;)</label>
                      <AmountInput
                        name="amount"
                        required
                        placeholder="e.g. 5,000.00"
                        className="input"
                        value={editAmount}
                        onChange={setEditAmount}
                      />
                      <p className={`mt-1 text-xs font-medium ${isDeduct ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                        {isDeduct
                          ? `Reduces the payout by ${formatNaira(magnitude)}.`
                          : `Adds ${formatNaira(magnitude)} to the payout.`}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <TextInput
                        label="Reason"
                        name="reason"
                        type="text"
                        required
                        minLength={5}
                        defaultValue={target.reason}
                        placeholder="Reason (min 5 chars)"
                      />
                    </div>
                    <div>
                      <label htmlFor="hr-edit-adjustment-month" className="block text-sm font-medium text-app-fg-muted mb-1">
                        Payroll month
                      </label>
                      <input
                        id="hr-edit-adjustment-month"
                        type="month"
                        name="periodMonth"
                        className="input"
                        defaultValue={target.periodMonth ? String(target.periodMonth).slice(0, 7) : ''}
                      />
                      <p className="mt-1 text-xs text-app-fg-muted">Leave blank to keep it un-earmarked.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={fetcher.state === 'submitting'}
                      loadingText="Saving..."
                    >
                      Save changes
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={fetcher.state !== 'idle'}
                      onClick={() => setEditAdjustmentTarget(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </fetcher.Form>
              </>
            );
          })()}
        </Modal>
      )}

      <ConfirmActionModal
        open={!!deleteAdjustmentTarget}
        onClose={() => setDeleteAdjustmentTarget(null)}
        title="Delete adjustment"
        description={
          deleteAdjustmentTarget
            ? `Delete this ${deleteAdjustmentTarget.category.replace(/_/g, ' ').toLowerCase()} adjustment? This cannot be undone.`
            : ''
        }
        details={
          deleteAdjustmentTarget ? (
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>
                Amount <NairaPrice amount={Math.abs(Number(deleteAdjustmentTarget.amount))} />
                {Number(deleteAdjustmentTarget.amount) < 0 ? ' (deduction)' : ''}
              </li>
              <li>{deleteAdjustmentTarget.reason}</li>
            </ul>
          ) : null
        }
        confirmLabel="Delete"
        variant="danger"
        loading={fetcher.state === 'submitting'}
        onConfirm={() => {
          if (!deleteAdjustmentTarget) return;
          fetcher.submit(
            { intent: 'deleteAdjustment', adjustmentId: deleteAdjustmentTarget.id },
            { method: 'post' },
          );
        }}
      />
    </div>
  );
}
