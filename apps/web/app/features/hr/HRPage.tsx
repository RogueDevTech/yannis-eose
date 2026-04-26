import { Fragment, useState, useEffect } from 'react';
import { useFetcher, useSearchParams, useNavigation } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { exportToCsv } from '~/lib/csv-export';
import { AmountInput } from '~/components/ui/amount-input';
import { formatNaira } from '~/lib/format-amount';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { TextInput } from '~/components/ui/text-input';
import { Pagination } from '~/components/ui/pagination';
import { Spinner } from '~/components/ui/spinner';
import type { CommissionPlan, Payout, Adjustment, HRUser, HRStreamData, PayoutSummary, SettlementConfig, SettlementPeriod } from './types';
import { MonthlyPayrolls } from './MonthlyPayrolls';

// ── Constants ────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  'CS_AGENT', 'MEDIA_BUYER', 'HEAD_OF_CS', 'HEAD_OF_MARKETING',
  'FINANCE_OFFICER', 'HEAD_OF_LOGISTICS', 'LOGISTICS_MANAGER',
  'TPL_MANAGER', 'TPL_RIDER', 'STOCK_MANAGER', 'HR_MANAGER',
];

const ADJ_CATEGORIES = ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER'];

// ── Main Feature Component ───────────────────────────────────────

export function HRPage({
  plans,
  totalPlans,
  payouts,
  totalPayouts,
  payoutPage,
  totalPayoutPages,
  payoutStatus,
  adjustments,
  payoutSummary,
  users,
  settlementConfig,
  currentPeriod,
  monthlyPayrolls,
  branches,
  viewer,
  initialBatchId,
}: HRStreamData) {
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  // Default tab is Monthly Payrolls. Plans now live on their own page (/hr/plans).
  const [activeTab, setActiveTab] = useState<'monthly' | 'payouts' | 'adjustments' | 'settlement'>('monthly');

  // Deep-link: ?open=plan now redirects to /hr/plans (legacy callers)
  useEffect(() => {
    if (searchParams.get('open') === 'plan') {
      window.location.href = '/hr/plans';
    }
  }, [searchParams]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  const [expandedPayoutId, setExpandedPayoutId] = useState<string | null>(null);
  const [markPaidConfirm, setMarkPaidConfirm] = useState<{ payoutId: string; staffName: string; amount: number } | null>(null);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'HR action completed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  if (actionSuccess && showGenerate) setShowGenerate(false);
  if (actionSuccess && showAddAdjustment) setShowAddAdjustment(false);

  // Close Mark Paid confirmation modal on success
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      const result = fetcher.data as { success?: boolean };
      if (result.success && markPaidConfirm) {
        setMarkPaidConfirm(null);
      }
    }
  }, [fetcher.state, fetcher.data]);

  const formatRules = (rules: Record<string, unknown>) => {
    const parts: string[] = [];
    if (rules.baseSalary) parts.push(`Base: \u20A6${Number(rules.baseSalary).toLocaleString()}`);
    if (rules.baseThreshold) parts.push(`Threshold: ${rules.baseThreshold} orders`);
    if (rules.perOrderRate) parts.push(`Per order: \u20A6${Number(rules.perOrderRate).toLocaleString()}`);
    if (rules.bonusPerExtraOrder) parts.push(`Extra bonus: \u20A6${Number(rules.bonusPerExtraOrder).toLocaleString()}`);
    if (rules.penaltyPerReturn) parts.push(`Return penalty: \u20A6${Number(rules.penaltyPerReturn).toLocaleString()}`);
    if (rules.deliveryRateThreshold) parts.push(`Del. rate bonus: >${rules.deliveryRateThreshold}%`);
    return parts.length > 0 ? parts.join(' | ') : 'No rules configured';
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <PageHeader
          title="HR & Payroll"
          description="Commission plans, payout management, and staff earnings"
        />
        <div className="flex flex-wrap gap-2">
          <PageRefreshButton />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportToCsv(
              payouts.map((p: Payout) => ({
                staff: p.staffId.slice(0, 8) + '...',
                period: `${new Date(p.periodStart).toLocaleDateString()} - ${new Date(p.periodEnd).toLocaleDateString()}`,
                base: p.baseSalary,
                bonus: p.performanceBonus,
                addOns: p.addOnsTotal,
                deductions: p.deductionsTotal,
                total: p.totalPayout,
                status: p.status,
              })),
              [
                { key: 'staff', label: 'Staff' },
                { key: 'period', label: 'Period' },
                { key: 'base', label: 'Base Salary' },
                { key: 'bonus', label: 'Bonus' },
                { key: 'addOns', label: 'Add-ons' },
                { key: 'deductions', label: 'Deductions' },
                { key: 'total', label: 'Total Payout' },
                { key: 'status', label: 'Status' },
              ],
              `payouts-${new Date().toISOString().split('T')[0]}.csv`,
            )}
          >
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowGenerate(!showGenerate)}>
            {showGenerate ? 'Close' : 'Generate Payouts'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { setShowAddAdjustment(!showAddAdjustment); setActiveTab('adjustments'); }}>
            {showAddAdjustment ? 'Close' : '+ Add-on'}
          </Button>
          <a
            href="/hr/plans"
            className="btn-primary btn-sm inline-flex items-center"
          >
            Manage Commission Plans →
          </a>
        </div>
      </div>

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Clawback Alert — deferred (depends on adjustments) */}
      <DeferredSection resolve={adjustments} skeleton="inline">
        {(resolvedAdjustments) => {
          const clawbacks = resolvedAdjustments.filter((a: Adjustment) => a.category === 'CLAWBACK');
          const pendingClawbacks = clawbacks.filter((a: Adjustment) => !a.approvedBy);
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
                    These deductions will be applied in the next payout generation.
                  </p>
                </div>
              </div>
            </div>
          );
        }}
      </DeferredSection>

      <DeferredSection resolve={payoutSummary} fallback={<OverviewStatStripSkeleton count={4} />}>
        {(summary) => {
          const draftTotal = Number(summary['DRAFT']?.total ?? 0);
          const approvedTotal = Number(summary['APPROVED']?.total ?? 0);
          const paidTotal = Number(summary['PAID']?.total ?? 0);

          return (
            <DeferredSection resolve={adjustments} fallback={<OverviewStatStripSkeleton count={4} />}>
              {(resolvedAdjustments) => {
                const clawbacks = resolvedAdjustments.filter((a: Adjustment) => a.category === 'CLAWBACK');
                return (
                  <OverviewStatStrip
                    items={[
                      {
                        label: 'Draft Payouts',
                        value: formatNaira(draftTotal),
                        valueClassName: 'text-warning-600 dark:text-warning-400',
                        title: `${summary['DRAFT']?.count ?? 0} staff`,
                      },
                      {
                        label: 'Approved',
                        value: formatNaira(approvedTotal),
                        valueClassName: 'text-brand-600 dark:text-brand-400',
                        title: `${summary['APPROVED']?.count ?? 0} staff`,
                      },
                      {
                        label: 'Paid',
                        value: formatNaira(paidTotal),
                        valueClassName: 'text-success-600 dark:text-success-400',
                        title: `${summary['PAID']?.count ?? 0} staff`,
                      },
                      {
                        label: 'Active Plans',
                        value: totalPlans,
                        valueClassName: 'text-app-fg',
                        title: `${clawbacks.length} clawback${clawbacks.length !== 1 ? 's' : ''}`,
                      },
                    ]}
                  />
                );
              }}
            </DeferredSection>
          );
        }}
      </DeferredSection>

      {/* Generate Payouts Form */}
      <ResponsiveFormPanel open={showGenerate} onClose={() => setShowGenerate(false)}>
        <fetcher.Form method="post" className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-app-fg">Generate Payouts</h3>
            <button type="button" onClick={() => setShowGenerate(false)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <p className="text-sm text-app-fg-muted">
            Generates DRAFT payouts for all active staff based on delivered orders within the settlement period.
            Commission is based on DELIVERED_AT timestamp, not order creation date.
          </p>
          <input type="hidden" name="intent" value="generatePayouts" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Period Start</label>
              <input name="periodStart" type="date" required className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Period End</label>
              <input name="periodEnd" type="date" required className="input" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Generating...">
              Generate
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowGenerate(false)}>
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      </ResponsiveFormPanel>

      {/* Plans live on /hr/plans now — link in the page header. */}

      {/* Add Adjustment Form — user dropdown is deferred */}
      <ResponsiveFormPanel open={showAddAdjustment} onClose={() => setShowAddAdjustment(false)}>
        <fetcher.Form method="post" className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-app-fg">Add Earning Adjustment</h3>
            <button type="button" onClick={() => setShowAddAdjustment(false)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createAdjustment" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DeferredSection resolve={users} skeleton="inline">
                {(resolvedUsers) => (
                  <FormSelect
                    label="Staff Member"
                    name="staffId"
                    required
                    placeholder="Select staff..."
                    options={resolvedUsers.map((u: HRUser) => ({ value: u.id, label: `${u.name} (${u.role?.replace(/_/g, ' ')})` }))}
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
                options={ADJ_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Amount (&#8358;)</label>
              <AmountInput name="amount" required placeholder="e.g. 5,000.00 or -500 for deduction" className="input" allowNegative />
            </div>
            <div>
              <TextInput
                label="Reason"
                name="reason"
                type="text"
                required
                minLength={5}
                placeholder="Reason for adjustment (min 5 chars)"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Creating...">
              Create Adjustment
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddAdjustment(false)}>
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      </ResponsiveFormPanel>

      {/* Legacy tabs (Payouts / Plans / Adjustments / Settlement) are HR-Manager + admin scope only.
          Heads of Department land on Monthly Payrolls and don't see commission plans or settlement config. */}
      {(() => {
        const isAdmin = viewer.role === 'SUPER_ADMIN' || viewer.role === 'ADMIN';
        const isHrOrFinance = isAdmin || viewer.role === 'HR_MANAGER' || viewer.role === 'FINANCE_OFFICER' || viewer.isFinanceOfficer;
        const tabs: Array<{ value: typeof activeTab; label: string }> = [
          { value: 'monthly', label: `Monthly Payrolls (${monthlyPayrolls.length})` },
        ];
        if (isHrOrFinance) {
          tabs.push(
            { value: 'payouts', label: `Payouts (${totalPayouts})` },
            { value: 'adjustments', label: 'Adjustments' },
          );
        }
        if (isAdmin || viewer.role === 'HR_MANAGER') {
          tabs.push({ value: 'settlement', label: 'Settlement Config' });
        }
        return (
          <Tabs
            value={activeTab}
            onChange={(v) => setActiveTab(v as typeof activeTab)}
            tabs={tabs}
          />
        );
      })()}

      {activeTab === 'monthly' && (
        <MonthlyPayrolls
          monthlyPayrolls={monthlyPayrolls}
          branches={branches}
          viewer={viewer}
          initialBatchId={initialBatchId}
          fetchBatchDetail={async (id) => {
            const res = await fetch(`/hr/payroll-batch/${id}`);
            if (!res.ok) return null;
            return res.json();
          }}
        />
      )}

      {/* Payouts filter bar — mirrors the Users / Orders list pattern. URL params drive the
          loader so navigating here restores the filter state; state changes trigger a nav
          and the Spinner shows while the next dataset loads. */}
      {activeTab === 'payouts' && (
        <div className="card">
          <div className="flex flex-col sm:flex-row gap-3">
            <FormSelect
              value={payoutStatus}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                if (e.target.value === 'ALL') next.delete('payoutStatus');
                else next.set('payoutStatus', e.target.value);
                next.set('payoutPage', '1');
                setSearchParams(next, { replace: true });
              }}
              options={[
                { value: 'ALL', label: 'All statuses' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'PAID', label: 'Paid' },
                { value: 'REJECTED', label: 'Rejected' },
              ]}
              className="w-full sm:w-48"
            />
            {isFilterLoading && (
              <span className="flex items-center text-app-fg-muted" aria-hidden>
                <Spinner size="sm" className="shrink-0" />
              </span>
            )}
          </div>
        </div>
      )}

      {/* Payouts Tab — critical data, renders immediately */}
      {activeTab === 'payouts' && (
        <DeferredSection resolve={users} skeleton="table">
          {(resolvedUsers) => {
            const getStaffName = (id: string) => resolvedUsers.find((u: HRUser) => u.id === id)?.name ?? id.slice(0, 8) + '...';
            const getStaffRole = (id: string) => resolvedUsers.find((u: HRUser) => u.id === id)?.role?.replace(/_/g, ' ') ?? '';

            return (
              <div className="card p-0 overflow-hidden hr-payroll-table">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header w-10"></th>
                        <th className="table-header">Staff</th>
                        <th className="table-header">Period</th>
                        <th className="table-header text-right">Base</th>
                        <th className="table-header text-right">Bonus</th>
                        <th className="table-header text-right">Add-ons</th>
                        <th className="table-header text-right">Deductions</th>
                        <th className="table-header text-right">Total</th>
                        <th className="table-header">Status</th>
                        <th className="table-header text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((p: Payout) => {
                        const isExpanded = expandedPayoutId === p.id;
                        return (
                          <Fragment key={p.id}>
                          <tr className="table-row">
                            <td className="table-cell">
                              <button
                                type="button"
                                onClick={() => setExpandedPayoutId(isExpanded ? null : p.id)}
                                className="text-app-fg-muted hover:text-app-fg p-1"
                                aria-label={isExpanded ? 'Hide breakdown' : 'Show breakdown'}
                                aria-expanded={isExpanded}
                              >
                                <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            </td>
                            <td className="table-cell">
                              <div>
                                <p className="text-sm font-medium text-app-fg">{getStaffName(p.staffId)}</p>
                                <p className="text-sm text-app-fg-muted">{getStaffRole(p.staffId)}</p>
                              </div>
                            </td>
                            <td className="table-cell text-sm text-app-fg-muted">
                              {new Date(p.periodStart).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} — {new Date(p.periodEnd).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="table-cell text-right text-sm"><NairaPrice amount={Number(p.baseSalary)} /></td>
                            <td className="table-cell text-right text-sm text-success-600 dark:text-success-400"><NairaPrice amount={Number(p.performanceBonus)} /></td>
                            <td className="table-cell text-right text-sm text-brand-600 dark:text-brand-400"><NairaPrice amount={Number(p.addOnsTotal)} /></td>
                            <td className="table-cell text-right text-sm text-danger-600 dark:text-danger-400">
                              {Number(p.deductionsTotal) > 0 ? <><span>-</span><NairaPrice amount={Number(p.deductionsTotal)} /></> : '\u2014'}
                            </td>
                            <td className="table-cell text-right font-medium"><NairaPrice amount={Number(p.totalPayout)} /></td>
                            <td className="table-cell">
                              <StatusBadge status={p.status} />
                            </td>
                            <td className="table-cell text-right">
                              {p.status === 'DRAFT' && (
                                <div className="flex justify-end gap-1.5">
                                  <fetcher.Form method="post" className="inline">
                                    <input type="hidden" name="intent" value="approvePayout" />
                                    <input type="hidden" name="payoutId" value={p.id} />
                                    <input type="hidden" name="status" value="APPROVED" />
                                    <Button type="submit" variant="primary" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing...">
                                      Approve
                                    </Button>
                                  </fetcher.Form>
                                  <fetcher.Form method="post" className="inline">
                                    <input type="hidden" name="intent" value="approvePayout" />
                                    <input type="hidden" name="payoutId" value={p.id} />
                                    <input type="hidden" name="status" value="REJECTED" />
                                    <Button type="submit" variant="danger" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing...">
                                      Reject
                                    </Button>
                                  </fetcher.Form>
                                </div>
                              )}
                              {p.status === 'APPROVED' && (
                                <Button
                                  variant="success"
                                  size="sm"
                                  className="text-xs"
                                  onClick={() => setMarkPaidConfirm({ payoutId: p.id, staffName: getStaffName(p.staffId), amount: Number(p.netPay) })}
                                >
                                  Mark Paid
                                </Button>
                              )}
                            </td>
                          </tr>
                          {/* Expanded breakdown */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={10} className="px-6 py-4 bg-app-hover">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                  <div>
                                    <p className="text-xs text-app-fg-muted uppercase">Base Salary</p>
                                    <p className="font-medium text-app-fg"><NairaPrice amount={Number(p.baseSalary)} /></p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-app-fg-muted uppercase">Performance Bonus</p>
                                    <p className="font-medium text-success-600 dark:text-success-400">+<NairaPrice amount={Number(p.performanceBonus)} /></p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-app-fg-muted uppercase">Add-ons (Bonuses, OT)</p>
                                    <p className="font-medium text-brand-600 dark:text-brand-400">+<NairaPrice amount={Number(p.addOnsTotal)} /></p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-app-fg-muted uppercase">Deductions (Clawbacks)</p>
                                    <p className="font-medium text-danger-600 dark:text-danger-400">-<NairaPrice amount={Number(p.deductionsTotal)} /></p>
                                  </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-app-border flex justify-between">
                                  <span className="text-sm font-semibold text-app-fg">Net Payout</span>
                                  <span className="text-lg font-bold text-app-fg"><NairaPrice amount={Number(p.totalPayout)} /></span>
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                      {payouts.length === 0 && (
                        <tr><td colSpan={10}><EmptyState title={payoutStatus === 'ALL' ? 'No payouts yet' : 'No matching payouts'} description={payoutStatus === 'ALL' ? 'Generate payouts for a settlement period.' : 'Clear the filter or pick a different status.'} /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile payouts */}
                <div className="md:hidden space-y-3 px-1">
                  {payouts.map((p: Payout) => (
                    <div key={p.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-app-fg text-sm">{getStaffName(p.staffId)}</p>
                          <p className="text-sm text-app-fg-muted">{getStaffRole(p.staffId)}</p>
                        </div>
                        <StatusBadge status={p.status} />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <span className="text-app-fg-muted">Base</span>
                          <p className="font-medium text-app-fg"><NairaPrice amount={Number(p.baseSalary)} /></p>
                        </div>
                        <div>
                          <span className="text-app-fg-muted">Bonus</span>
                          <p className="font-medium text-success-600 dark:text-success-400"><NairaPrice amount={Number(p.performanceBonus)} /></p>
                        </div>
                        <div>
                          <span className="text-app-fg-muted">Total</span>
                          <p className="font-bold text-app-fg"><NairaPrice amount={Number(p.totalPayout)} /></p>
                        </div>
                      </div>
                      {Number(p.deductionsTotal) > 0 && (
                        <p className="text-xs text-danger-600 dark:text-danger-400">
                          Deductions: -<NairaPrice amount={Number(p.deductionsTotal)} />
                        </p>
                      )}
                      <p className="text-xs text-app-fg-muted">
                        {new Date(p.periodStart).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} — {new Date(p.periodEnd).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      </p>
                      {p.status === 'DRAFT' && (
                        <div className="flex gap-2 pt-1">
                          <fetcher.Form method="post" className="flex-1">
                            <input type="hidden" name="intent" value="approvePayout" />
                            <input type="hidden" name="payoutId" value={p.id} />
                            <input type="hidden" name="status" value="APPROVED" />
                            <Button type="submit" variant="primary" size="sm" className="text-xs w-full">Approve</Button>
                          </fetcher.Form>
                          <fetcher.Form method="post" className="flex-1">
                            <input type="hidden" name="intent" value="approvePayout" />
                            <input type="hidden" name="payoutId" value={p.id} />
                            <input type="hidden" name="status" value="REJECTED" />
                            <Button type="submit" variant="danger" size="sm" className="text-xs w-full">Reject</Button>
                          </fetcher.Form>
                        </div>
                      )}
                      {p.status === 'APPROVED' && (
                        <Button
                          variant="success"
                          size="sm"
                          className="text-xs w-full"
                          onClick={() => setMarkPaidConfirm({ payoutId: p.id, staffName: getStaffName(p.staffId), amount: Number(p.netPay) })}
                        >
                          Mark Paid
                        </Button>
                      )}
                    </div>
                  ))}
                  {payouts.length === 0 && (
                    <EmptyState title="No payouts yet" description="Generate payouts for a settlement period." />
                  )}
                </div>
              </div>
            );
          }}
        </DeferredSection>
      )}

      {/* Payouts pagination + count — only shown when there are rows. Mirrors Users list pattern. */}
      {activeTab === 'payouts' && totalPayouts > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            Showing {payouts.length} of {totalPayouts} payouts
          </p>
          <Pagination
            page={payoutPage}
            totalPages={totalPayoutPages}
            onPageChange={(nextPage) => {
              const next = new URLSearchParams(searchParams);
              next.set('payoutPage', String(nextPage));
              setSearchParams(next, { replace: true });
            }}
            showLabel
          />
        </div>
      )}


      {/* Adjustments Tab — deferred data */}
      {activeTab === 'adjustments' && (
        <DeferredSection resolve={adjustments} skeleton="table">
          {(resolvedAdjustments) => (
            <DeferredSection resolve={users} skeleton="table">
              {(resolvedUsers) => {
                const getStaffName = (id: string) => resolvedUsers.find((u: HRUser) => u.id === id)?.name ?? id.slice(0, 8) + '...';

                return (
                  <div className="card p-0 overflow-hidden">
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className="table-header">Staff</th>
                            <th className="table-header">Category</th>
                            <th className="table-header text-right">Amount</th>
                            <th className="table-header">Reason</th>
                            <th className="table-header">Approved</th>
                            <th className="table-header">Date</th>
                            <th className="table-header">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resolvedAdjustments.map((adj: Adjustment) => (
                            <tr key={adj.id} className="table-row">
                              <td className="table-cell">
                                <p className="text-sm font-medium text-app-fg">{getStaffName(adj.staffId)}</p>
                              </td>
                              <td className="table-cell">
                                <StatusBadge status={adj.category} />
                              </td>
                              <td className={`table-cell text-right font-medium ${Number(adj.amount) < 0 ? 'text-danger-600 dark:text-danger-400' : ''}`}>
                                {Number(adj.amount) < 0 ? <><span>-</span><NairaPrice amount={Math.abs(Number(adj.amount))} /></> : <NairaPrice amount={Number(adj.amount)} />}
                              </td>
                              <td className="table-cell text-sm text-app-fg-muted max-w-[200px] truncate">{adj.reason}</td>
                              <td className="table-cell">
                                <StatusBadge status={adj.approvedBy ? 'APPROVED' : 'PENDING'} />
                              </td>
                              <td className="table-cell text-app-fg-muted text-sm">
                                {new Date(adj.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                              </td>
                              <td className="table-cell">
                                {!adj.approvedBy && adj.category !== 'CLAWBACK' && (
                                  <fetcher.Form method="post" className="inline">
                                    <input type="hidden" name="intent" value="approveAdjustment" />
                                    <input type="hidden" name="adjustmentId" value={adj.id} />
                                    <Button type="submit" variant="primary" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing...">
                                      Approve
                                    </Button>
                                  </fetcher.Form>
                                )}
                              </td>
                            </tr>
                          ))}
                          {resolvedAdjustments.length === 0 && (
                            <tr><td colSpan={7}><EmptyState title="No earnings adjustments yet" description="Add an adjustment to get started." /></td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile adjustments */}
                    <div className="md:hidden space-y-3 px-1">
                      {resolvedAdjustments.map((adj: Adjustment) => (
                        <div key={adj.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-app-fg text-sm">{getStaffName(adj.staffId)}</span>
                            <StatusBadge status={adj.category} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`font-medium ${Number(adj.amount) < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}>
                              {Number(adj.amount) < 0 ? <><span>-</span><NairaPrice amount={Math.abs(Number(adj.amount))} /></> : <NairaPrice amount={Number(adj.amount)} />}
                            </span>
                            <StatusBadge status={adj.approvedBy ? 'APPROVED' : 'PENDING'} />
                          </div>
                          <p className="text-xs text-app-fg-muted">{adj.reason}</p>
                          {!adj.approvedBy && adj.category !== 'CLAWBACK' && (
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="approveAdjustment" />
                              <input type="hidden" name="adjustmentId" value={adj.id} />
                              <Button type="submit" variant="primary" size="sm" className="text-xs w-full">Approve</Button>
                            </fetcher.Form>
                          )}
                        </div>
                      ))}
                      {resolvedAdjustments.length === 0 && (
                        <EmptyState title="No adjustments yet" description="Add an adjustment to get started." />
                      )}
                    </div>
                  </div>
                );
              }}
            </DeferredSection>
          )}
        </DeferredSection>
      )}

      {/* Settlement Config Tab — deferred data */}
      {activeTab === 'settlement' && (
        <div className="space-y-4">
          {/* Current Config Display */}
          <DeferredSection resolve={settlementConfig} skeleton="card">
            {(resolvedConfig) => (
              <div className="card p-5">
                <h3 className="text-base font-semibold text-app-fg mb-3">Active Settlement Window</h3>
                {resolvedConfig ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wide">Window Type</p>
                      <p className="text-sm font-semibold text-app-fg mt-0.5">{resolvedConfig.windowType}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wide">
                        {resolvedConfig.windowType === 'MONTHLY' ? 'Start Day of Month' : 'Start Day of Week'}
                      </p>
                      <p className="text-sm font-semibold text-app-fg mt-0.5">
                        {resolvedConfig.windowType === 'MONTHLY'
                          ? `Day ${resolvedConfig.startDay}`
                          : ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][resolvedConfig.startDay] ?? `Day ${resolvedConfig.startDay}`
                        }
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wide">Last Updated</p>
                      <p className="text-sm font-semibold text-app-fg mt-0.5">
                        {new Date(resolvedConfig.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-app-fg-muted">No settlement window configured. Set one below to enable automated payout periods.</p>
                )}
              </div>
            )}
          </DeferredSection>

          {/* Current Period */}
          <DeferredSection resolve={currentPeriod} skeleton="card">
            {(resolvedPeriod) => {
              if (!resolvedPeriod) return null;
              return (
                <div className="card p-5 border-l-4 border-l-brand-500">
                  <h3 className="text-base font-semibold text-app-fg mb-2">Current Settlement Period</h3>
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <p className="text-xs text-app-fg-muted">Start</p>
                      <p className="text-sm font-medium text-app-fg">{resolvedPeriod.periodStart}</p>
                    </div>
                    <div>
                      <p className="text-xs text-app-fg-muted">End</p>
                      <p className="text-sm font-medium text-app-fg">{resolvedPeriod.periodEnd}</p>
                    </div>
                    <div>
                      <p className="text-xs text-app-fg-muted">Type</p>
                      <p className="text-sm font-medium text-app-fg">{resolvedPeriod.windowType}</p>
                    </div>
                  </div>
                </div>
              );
            }}
          </DeferredSection>

          {/* Update Settlement Config Form — uses deferred config for defaults */}
          <DeferredSection resolve={settlementConfig} skeleton="card">
            {(resolvedConfig) => (
              <div className="card p-5">
                <h3 className="text-base font-semibold text-app-fg mb-3">Update Settlement Window</h3>
                <fetcher.Form method="post" className="space-y-4">
                  <input type="hidden" name="intent" value="setSettlementConfig" />
                  {/* Monthly cadence only — Weekly / Bi-Weekly options were removed per CEO directive
                      2026-04-26 (multi-stage payroll batches are month-keyed by design). The enum
                      values stay in the DB for legacy rows; the UI just no longer offers them. */}
                  <input type="hidden" name="windowType" value="MONTHLY" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wide">Window Type</p>
                      <p className="text-sm font-semibold text-app-fg mt-1">Monthly</p>
                      <p className="text-xs text-app-fg-muted mt-1">
                        Payroll runs on a monthly cadence. Weekly / Bi-Weekly cadences are no longer supported.
                      </p>
                    </div>
                    <div>
                      <TextInput
                        label="Start Day of Month"
                        name="startDay"
                        type="number"
                        min={1}
                        max={31}
                        defaultValue={String(resolvedConfig?.startDay ?? 1)}
                        hint="Day of month (1-31) the settlement period begins."
                      />
                    </div>
                  </div>
                  <Button type="submit" variant="primary" size="sm" loading={fetcher.state !== 'idle'} loadingText="Saving...">
                    Save Settlement Config
                  </Button>
                </fetcher.Form>
              </div>
            )}
          </DeferredSection>
        </div>
      )}
      {/* Mark Paid confirmation modal */}
      {markPaidConfirm && (
        <ConfirmActionModal
          open={!!markPaidConfirm}
          onClose={() => setMarkPaidConfirm(null)}
          title="Mark payout as paid?"
          description={
            <>
              Confirm that <strong>{markPaidConfirm.staffName}</strong> has been paid <strong><NairaPrice amount={markPaidConfirm.amount} /></strong>. This action cannot be undone.
            </>
          }
          confirmLabel="Mark Paid"
          variant="warning"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            fetcher.submit(
              {
                intent: 'approvePayout',
                payoutId: markPaidConfirm.payoutId,
                status: 'PAID',
              },
              { method: 'post' },
            );
          }}
        />
      )}
    </div>
  );
}
