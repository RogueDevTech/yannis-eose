import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
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
import { PageSearchControl } from '~/components/ui/page-search-control';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
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
  // Adjustments tab filters. Search matches staff/contractor name + reason and
  // runs SERVER-SIDE (across the whole table, not just the loaded page), so an
  // adjustment stays reachable no matter how many newer ones exist. Category /
  // status / period narrow whichever page is loaded, client-side.
  const [adjustmentSearch, setAdjustmentSearch] = useState('');
  const [adjustmentCategoryFilter, setAdjustmentCategoryFilter] = useState('');
  const [adjustmentStatusFilter, setAdjustmentStatusFilter] = useState('');
  const [adjustmentPeriodFilter, setAdjustmentPeriodFilter] = useState('');
  // Server-side page for the Adjustments tab (100 rows/page). Page 1 with no
  // search reuses the bundle's first page (no extra round-trip); any search or a
  // page beyond 1 fetches from hr.listAdjustments.
  const ADJUSTMENTS_PAGE_SIZE = 100;
  const [adjustmentPage, setAdjustmentPage] = useState(1);
  const [serverAdjustments, setServerAdjustments] = useState<{
    items: Adjustment[];
    total: number;
    forKey: string;
  } | null>(null);
  const [adjustmentsFetching, setAdjustmentsFetching] = useState(false);
  // Reset to page 1 whenever the server-side search term changes.
  useEffect(() => {
    setAdjustmentPage(1);
  }, [adjustmentSearch]);

  // Fetch a server page of adjustments whenever the tab is active and the user
  // is searching or paging past the first page. Page 1 with no search is served
  // from the bundle, so this stays quiet during normal use.
  const trimmedAdjustmentSearch = adjustmentSearch.trim();
  const needsServerAdjustments =
    activeTab === 'adjustments' && (!!trimmedAdjustmentSearch || adjustmentPage > 1);
  useEffect(() => {
    if (!needsServerAdjustments) {
      setServerAdjustments(null);
      setAdjustmentsFetching(false);
      return;
    }
    const key = `${trimmedAdjustmentSearch}|${adjustmentPage}`;
    let cancelled = false;
    setAdjustmentsFetching(true);
    const input = {
      ...(trimmedAdjustmentSearch ? { search: trimmedAdjustmentSearch } : {}),
      page: adjustmentPage,
      pageSize: ADJUSTMENTS_PAGE_SIZE,
    };
    const url = `${getBrowserApiBaseUrl()}/trpc/hr.listAdjustments?input=${encodeURIComponent(
      JSON.stringify(input),
    )}`;
    fetch(url, { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const data = json?.result?.data as
          | { items?: Adjustment[]; total?: number }
          | undefined;
        setServerAdjustments({
          items: Array.isArray(data?.items) ? data!.items! : [],
          total: Number(data?.total ?? 0),
          forKey: key,
        });
      })
      .catch(() => {
        if (!cancelled) setServerAdjustments({ items: [], total: 0, forKey: key });
      })
      .finally(() => {
        if (!cancelled) setAdjustmentsFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsServerAdjustments, trimmedAdjustmentSearch, adjustmentPage]);
  // Standalone Add-on / Deduct Salary was relocated to the payroll batch detail
  // header (target any staff/contractor for that batch's month). The Adjustments
  // tab below still edits/approves existing adjustments.
  const [showBankPayExport, setShowBankPayExport] = useState(false);
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
      editAdjustmentTarget && hrSurface.errorMatchingIntent('updateAdjustment'),
    ),
  });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  /** Close add-on modal after a successful mutation (same fetcher handles
   *  approve actions too — both intents resolve through this single hook). */
  const handleHrFetcherSuccess = useCallback(() => {
    setApproveAdjustmentTarget(null);
    setEditAdjustmentTarget(null);
    setDeleteAdjustmentTarget(null);
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
            desktopActions
            desktopActionsLabel="Actions"
            desktop={
              <div className="flex items-center gap-2 flex-wrap">
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
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
        !dismissedError && (
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
                // When searching or paging past 1, the server page is authoritative
                // (it looked across the whole table). Otherwise use the bundle's
                // first page. Optimistic approval/edit patches apply to either.
                const baseAdjustments =
                  serverAdjustments && serverAdjustments.forKey === `${trimmedAdjustmentSearch}|${adjustmentPage}`
                    ? serverAdjustments.items
                    : resolvedAdjustments;
                const overlaidAdjustments = applyOptimisticPatches(
                  baseAdjustments,
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
                // Search is applied server-side once a page is fetched; only fall
                // back to the client-side name/reason match for the bundle's first
                // page (before the server result for this query lands).
                const usingServerPage =
                  !!serverAdjustments &&
                  serverAdjustments.forKey === `${trimmedAdjustmentSearch}|${adjustmentPage}`;
                const filteredAdjustments = overlaidAdjustments.filter((adj) => {
                  if (searchQ && !usingServerPage) {
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
                  <div className={`list-panel ${adjustmentsFetching ? 'opacity-60' : ''}`}>
                    <ToolbarFiltersCollapsible
                      className="border-b border-app-border !px-3 !py-2"
                      badgeCount={
                        (adjustmentCategoryFilter ? 1 : 0) +
                        (adjustmentStatusFilter ? 1 : 0) +
                        (adjustmentPeriodFilter ? 1 : 0)
                      }
                      onClearAll={() => {
                        setAdjustmentSearch('');
                        setAdjustmentCategoryFilter('');
                        setAdjustmentStatusFilter('');
                        setAdjustmentPeriodFilter('');
                      }}
                      searchRow={
                        <PageSearchControl
                          value={adjustmentSearch}
                          onApply={setAdjustmentSearch}
                          placeholder="Search name or reason"
                          title="Search adjustments"
                        />
                      }
                      desktopInlineFilters={
                        <>
                          <div className="relative" data-toolbar-filter>
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
                          </div>
                          <div className="relative" data-toolbar-filter>
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
                          </div>
                          <div className="relative" data-toolbar-filter>
                            <FormSelect
                              value={adjustmentPeriodFilter}
                              onChange={(e) => setAdjustmentPeriodFilter(e.target.value)}
                              placeholder="All batches"
                              options={[{ value: '', label: 'All batches' }, ...periodOptions]}
                            />
                          </div>
                        </>
                      }
                    />
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
                    {usingServerPage && serverAdjustments.total > ADJUSTMENTS_PAGE_SIZE ? (
                      <div className="border-t border-app-border p-3">
                        <Pagination
                          page={adjustmentPage}
                          totalPages={Math.ceil(serverAdjustments.total / ADJUSTMENTS_PAGE_SIZE)}
                          onPageChange={setAdjustmentPage}
                        />
                      </div>
                    ) : null}
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
