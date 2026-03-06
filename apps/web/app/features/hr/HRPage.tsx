import { useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { exportToCsv } from '~/lib/csv-export';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { DeferredSection } from '~/components/ui/deferred-section';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import type { CommissionPlan, Payout, Adjustment, HRUser, HRStreamData, PayoutSummary, SettlementConfig, SettlementPeriod } from './types';

// ── Constants ────────────────────────────────────────────────────

const PAYOUT_COLORS: Record<string, string> = {
  DRAFT: 'badge-warning',
  APPROVED: 'badge-info',
  PAID: 'badge-success',
  REJECTED: 'badge-danger',
};

const ADJUSTMENT_COLORS: Record<string, string> = {
  BONUS: 'badge-success',
  EXTRA_SHIFT: 'badge-info',
  PERFORMANCE: 'badge-brand',
  DEDUCTION: 'badge-danger',
  CLAWBACK: 'badge-danger',
  OTHER: 'badge-warning',
};

const ROLE_OPTIONS = [
  'CS_AGENT', 'MEDIA_BUYER', 'HEAD_OF_CS', 'HEAD_OF_MARKETING',
  'FINANCE_OFFICER', 'HEAD_OF_LOGISTICS', 'LOGISTICS_MANAGER',
  'TPL_MANAGER', 'TPL_RIDER', 'WAREHOUSE_MANAGER', 'HR_MANAGER',
];

const ADJ_CATEGORIES = ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER'];

// ── Main Feature Component ───────────────────────────────────────

export function HRPage({ plans, totalPlans, payouts, totalPayouts, adjustments, payoutSummary, users, settlementConfig, currentPeriod }: HRStreamData) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'payouts' | 'plans' | 'adjustments' | 'settlement'>('payouts');
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  const [expandedPayoutId, setExpandedPayoutId] = useState<string | null>(null);
  const [viewPlan, setViewPlan] = useState<CommissionPlan | null>(null);
  const [markPaidConfirm, setMarkPaidConfirm] = useState<{ payoutId: string; staffName: string; amount: number } | null>(null);

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'HR action completed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  if (actionSuccess && showAddPlan) setShowAddPlan(false);
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
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">HR & Payroll</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Commission plans, payout management, and staff earnings
          </p>
        </div>
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
          <Button variant="primary" size="sm" onClick={() => { setShowAddPlan(!showAddPlan); setActiveTab('plans'); }}>
            {showAddPlan ? 'Close' : '+ Commission Plan'}
          </Button>
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

      {/* Stats — payoutSummary is deferred, plans count is critical */}
      <DeferredSection resolve={payoutSummary} skeleton="stat">
        {(summary) => {
          const draftTotal = Number(summary['DRAFT']?.total ?? 0);
          const approvedTotal = Number(summary['APPROVED']?.total ?? 0);
          const paidTotal = Number(summary['PAID']?.total ?? 0);

          return (
            <DeferredSection resolve={adjustments} skeleton="stat">
              {(resolvedAdjustments) => {
                const clawbacks = resolvedAdjustments.filter((a: Adjustment) => a.category === 'CLAWBACK');
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="card">
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Draft Payouts</p>
                      <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">&#8358;{draftTotal.toLocaleString()}</p>
                      <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">{summary['DRAFT']?.count ?? 0} staff</p>
                    </div>
                    <div className="card">
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Approved</p>
                      <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">&#8358;{approvedTotal.toLocaleString()}</p>
                      <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">{summary['APPROVED']?.count ?? 0} staff</p>
                    </div>
                    <div className="card">
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Paid</p>
                      <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">&#8358;{paidTotal.toLocaleString()}</p>
                      <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">{summary['PAID']?.count ?? 0} staff</p>
                    </div>
                    <div className="card">
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Active Plans</p>
                      <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{totalPlans}</p>
                      <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">{clawbacks.length} clawback{clawbacks.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
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
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Generate Payouts</h3>
            <button type="button" onClick={() => setShowGenerate(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <p className="text-sm text-surface-800 dark:text-surface-200">
            Generates DRAFT payouts for all active staff based on delivered orders within the settlement period.
            Commission is based on DELIVERED_AT timestamp, not order creation date.
          </p>
          <input type="hidden" name="intent" value="generatePayouts" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Period Start</label>
              <input name="periodStart" type="date" required className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Period End</label>
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

      {/* Add Plan Form */}
      <ResponsiveFormPanel open={showAddPlan} onClose={() => setShowAddPlan(false)}>
        <fetcher.Form method="post" className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">New Commission Plan</h3>
            <button type="button" onClick={() => setShowAddPlan(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createPlan" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Plan Name</label>
              <input name="planName" type="text" required placeholder="e.g. CS Standard Plan" className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Role</label>
              <select name="role" required className="input">
                <option value="">Select role...</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Base Salary (&#8358;)</label>
              <AmountInput name="baseSalary" placeholder="0" className="input" />
              <p className="text-xs text-surface-700 mt-0.5">Earned when orders &ge; threshold</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Base Threshold (orders)</label>
              <input name="baseThreshold" type="number" min="0" placeholder="20" className="input" />
              <p className="text-xs text-surface-700 mt-0.5">Min delivered to earn base salary</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Per Order Rate (&#8358;)</label>
              <AmountInput name="perOrderRate" placeholder="0" className="input" />
              <p className="text-xs text-surface-700 mt-0.5">Commission per delivered order</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Bonus Per Extra Order (&#8358;)</label>
              <AmountInput name="bonusPerExtraOrder" placeholder="0" className="input" />
              <p className="text-xs text-surface-700 mt-0.5">Extra bonus above threshold</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Penalty Per Return (&#8358;)</label>
              <AmountInput name="penaltyPerReturn" placeholder="0" className="input" />
              <p className="text-xs text-surface-700 mt-0.5">Deducted per returned order</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Delivery Rate Threshold (%)</label>
              <input name="deliveryRateThreshold" type="number" min="0" max="100" step="0.1" placeholder="80" className="input" />
              <p className="text-xs text-surface-700 mt-0.5">Above this = 50% extra bonus</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Effective From</label>
              <input name="effectiveFrom" type="date" required className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Effective To (optional)</label>
              <input name="effectiveTo" type="date" className="input" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Creating...">
              Create Plan
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddPlan(false)}>
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      </ResponsiveFormPanel>

      {/* Add Adjustment Form — user dropdown is deferred */}
      <ResponsiveFormPanel open={showAddAdjustment} onClose={() => setShowAddAdjustment(false)}>
        <fetcher.Form method="post" className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Add Earning Adjustment</h3>
            <button type="button" onClick={() => setShowAddAdjustment(false)} className="text-surface-700 hover:text-surface-900 dark:hover:text-surface-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createAdjustment" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Staff Member</label>
              <DeferredSection resolve={users} skeleton="inline">
                {(resolvedUsers) => (
                  <select name="staffId" required className="input">
                    <option value="">Select staff...</option>
                    {resolvedUsers.map((u: HRUser) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role?.replace(/_/g, ' ')})</option>
                    ))}
                  </select>
                )}
              </DeferredSection>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Category</label>
              <select name="category" required className="input">
                <option value="">Select category...</option>
                {ADJ_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Amount (&#8358;)</label>
              <AmountInput name="amount" required placeholder="e.g. 5,000.00 or -500 for deduction" className="input" allowNegative />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Reason</label>
              <input name="reason" type="text" required minLength={5} placeholder="Reason for adjustment (min 5 chars)" className="input" />
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

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'payouts', label: `Payouts (${totalPayouts})` },
          { value: 'plans', label: `Plans (${totalPlans})` },
          { value: 'adjustments', label: 'Adjustments' },
          { value: 'settlement', label: 'Settlement Config' },
        ]}
      />

      {/* Payouts Tab — critical data, renders immediately */}
      {activeTab === 'payouts' && (
        <DeferredSection resolve={users} skeleton="table">
          {(resolvedUsers) => {
            const getStaffName = (id: string) => resolvedUsers.find((u: HRUser) => u.id === id)?.name ?? id.slice(0, 8) + '...';
            const getStaffRole = (id: string) => resolvedUsers.find((u: HRUser) => u.id === id)?.role?.replace(/_/g, ' ') ?? '';

            return (
              <div className="card p-0 overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">Staff</th>
                        <th className="table-header">Period</th>
                        <th className="table-header text-right">Base</th>
                        <th className="table-header text-right">Bonus</th>
                        <th className="table-header text-right">Add-ons</th>
                        <th className="table-header text-right">Deductions</th>
                        <th className="table-header text-right">Total</th>
                        <th className="table-header">Status</th>
                        <th className="table-header">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((p: Payout) => (
                        <>
                          <tr key={p.id} className="table-row cursor-pointer" onClick={() => setExpandedPayoutId(expandedPayoutId === p.id ? null : p.id)}>
                            <td className="table-cell">
                              <div>
                                <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{getStaffName(p.staffId)}</p>
                                <p className="text-xs text-surface-700 dark:text-surface-300">{getStaffRole(p.staffId)}</p>
                              </div>
                            </td>
                            <td className="table-cell text-sm text-surface-800 dark:text-surface-200">
                              {new Date(p.periodStart).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} — {new Date(p.periodEnd).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="table-cell text-right text-sm">&#8358;{Number(p.baseSalary).toLocaleString()}</td>
                            <td className="table-cell text-right text-sm text-success-600 dark:text-success-400">&#8358;{Number(p.performanceBonus).toLocaleString()}</td>
                            <td className="table-cell text-right text-sm text-brand-600 dark:text-brand-400">&#8358;{Number(p.addOnsTotal).toLocaleString()}</td>
                            <td className="table-cell text-right text-sm text-danger-600 dark:text-danger-400">
                              {Number(p.deductionsTotal) > 0 ? `-\u20A6${Number(p.deductionsTotal).toLocaleString()}` : '\u2014'}
                            </td>
                            <td className="table-cell text-right font-medium">&#8358;{Number(p.totalPayout).toLocaleString()}</td>
                            <td className="table-cell">
                              <span className={PAYOUT_COLORS[p.status] ?? 'badge'}>{p.status}</span>
                            </td>
                            <td className="table-cell">
                              {p.status === 'DRAFT' && (
                                <div className="flex gap-1.5">
                                  <fetcher.Form method="post" className="inline" onClick={(e) => e.stopPropagation()}>
                                    <input type="hidden" name="intent" value="approvePayout" />
                                    <input type="hidden" name="payoutId" value={p.id} />
                                    <input type="hidden" name="status" value="APPROVED" />
                                    <Button type="submit" variant="primary" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing...">
                                      Approve
                                    </Button>
                                  </fetcher.Form>
                                  <fetcher.Form method="post" className="inline" onClick={(e) => e.stopPropagation()}>
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMarkPaidConfirm({ payoutId: p.id, staffName: getStaffName(p.staffId), amount: Number(p.netPay) });
                                  }}
                                >
                                  Mark Paid
                                </Button>
                              )}
                            </td>
                          </tr>
                          {/* Expanded breakdown */}
                          {expandedPayoutId === p.id && (
                            <tr key={`${p.id}-detail`}>
                              <td colSpan={9} className="px-6 py-4 bg-surface-50 dark:bg-surface-900/50">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                  <div>
                                    <p className="text-xs text-surface-700 dark:text-surface-300 uppercase">Base Salary</p>
                                    <p className="font-medium text-surface-900 dark:text-white">&#8358;{Number(p.baseSalary).toLocaleString()}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-surface-700 dark:text-surface-300 uppercase">Performance Bonus</p>
                                    <p className="font-medium text-success-600 dark:text-success-400">+&#8358;{Number(p.performanceBonus).toLocaleString()}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-surface-700 dark:text-surface-300 uppercase">Add-ons (Bonuses, OT)</p>
                                    <p className="font-medium text-brand-600 dark:text-brand-400">+&#8358;{Number(p.addOnsTotal).toLocaleString()}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-surface-700 dark:text-surface-300 uppercase">Deductions (Clawbacks)</p>
                                    <p className="font-medium text-danger-600 dark:text-danger-400">-&#8358;{Number(p.deductionsTotal).toLocaleString()}</p>
                                  </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-surface-200 dark:border-surface-700 flex justify-between">
                                  <span className="text-sm font-semibold text-surface-900 dark:text-white">Net Payout</span>
                                  <span className="text-lg font-bold text-surface-900 dark:text-white">&#8358;{Number(p.totalPayout).toLocaleString()}</span>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                      {payouts.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No payouts yet. Generate payouts for a settlement period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile payouts */}
                <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
                  {payouts.map((p: Payout) => (
                    <div key={p.id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-surface-900 dark:text-white text-sm">{getStaffName(p.staffId)}</p>
                          <p className="text-xs text-surface-700 dark:text-surface-300">{getStaffRole(p.staffId)}</p>
                        </div>
                        <span className={PAYOUT_COLORS[p.status] ?? 'badge'}>{p.status}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Base</span>
                          <p className="font-medium text-surface-900 dark:text-white">&#8358;{Number(p.baseSalary).toLocaleString()}</p>
                        </div>
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Bonus</span>
                          <p className="font-medium text-success-600 dark:text-success-400">&#8358;{Number(p.performanceBonus).toLocaleString()}</p>
                        </div>
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Total</span>
                          <p className="font-bold text-surface-900 dark:text-white">&#8358;{Number(p.totalPayout).toLocaleString()}</p>
                        </div>
                      </div>
                      {Number(p.deductionsTotal) > 0 && (
                        <p className="text-xs text-danger-600 dark:text-danger-400">
                          Deductions: -&#8358;{Number(p.deductionsTotal).toLocaleString()}
                        </p>
                      )}
                      <p className="text-xs text-surface-700 dark:text-surface-300">
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
                    <div className="p-8 text-center text-surface-700 dark:text-surface-300">No payouts yet</div>
                  )}
                </div>
              </div>
            );
          }}
        </DeferredSection>
      )}

      {/* Plans Tab — critical data, renders immediately */}
      {activeTab === 'plans' && (
        <div className="card p-0 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Plan Name</th>
                  <th className="table-header">Role</th>
                  <th className="table-header">Effective</th>
                  <th className="table-header">Rules</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan: CommissionPlan) => (
                  <tr key={plan.id} className="table-row cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/50" onClick={() => setViewPlan(plan)}>
                    <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{plan.planName}</td>
                    <td className="table-cell">
                      <span className="badge-info">{plan.role.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="table-cell text-sm text-surface-800 dark:text-surface-200">
                      {new Date(plan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {plan.effectiveTo ? ` — ${new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}` : ' — Ongoing'}
                    </td>
                    <td className="table-cell text-xs text-surface-800 dark:text-surface-200 max-w-[300px]">
                      {formatRules(plan.rules)}
                    </td>
                  </tr>
                ))}
                {plans.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No commission plans yet</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile plans */}
          <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
            {plans.map((plan: CommissionPlan) => (
              <div key={plan.id} className="p-4 space-y-2 cursor-pointer active:bg-surface-50 dark:active:bg-surface-800/50" onClick={() => setViewPlan(plan)}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-surface-900 dark:text-white text-sm">{plan.planName}</span>
                  <span className="badge-info text-xs">{plan.role.replace(/_/g, ' ')}</span>
                </div>
                <p className="text-xs text-surface-700 dark:text-surface-300">{formatRules(plan.rules)}</p>
                <p className="text-xs text-surface-700 dark:text-surface-300">
                  From {new Date(plan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {plan.effectiveTo ? ` to ${new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}` : ' — Ongoing'}
                </p>
              </div>
            ))}
            {plans.length === 0 && (
              <div className="p-8 text-center text-surface-700 dark:text-surface-300">No commission plans yet</div>
            )}
          </div>
        </div>
      )}

      {/* Plan Detail Modal */}
      {viewPlan && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setViewPlan(null)} aria-hidden />
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setViewPlan(null)}>
            <div
              className="bg-white dark:bg-surface-900 rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto flex flex-col gap-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-surface-900 dark:text-white">{viewPlan.planName}</h3>
                  <span className="badge-info text-xs mt-1 inline-block">{viewPlan.role.replace(/_/g, ' ')}</span>
                </div>
                <button type="button" onClick={() => setViewPlan(null)} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Status & Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide">Status</p>
                  {(() => {
                    const now = new Date();
                    const from = new Date(viewPlan.effectiveFrom);
                    const to = viewPlan.effectiveTo ? new Date(viewPlan.effectiveTo) : null;
                    if (from > now) return <span className="badge-warning text-xs mt-1 inline-block">Upcoming</span>;
                    if (to && to < now) return <span className="badge-danger text-xs mt-1 inline-block">Expired</span>;
                    return <span className="badge-success text-xs mt-1 inline-block">Active</span>;
                  })()}
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide">Effective Period</p>
                  <p className="text-sm text-surface-900 dark:text-white mt-1">
                    {new Date(viewPlan.effectiveFrom).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {viewPlan.effectiveTo
                      ? ` — ${new Date(viewPlan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`
                      : ' — Ongoing'}
                  </p>
                </div>
              </div>

              {/* Rules Breakdown */}
              <div>
                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-3">Commission Rules</p>
                <div className="space-y-2">
                  {viewPlan.rules.baseSalary != null && (
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Base Salary</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">
                          Fixed pay when delivered orders {'\u2265'} {viewPlan.rules.baseThreshold ?? 0}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-surface-900 dark:text-white">&#8358;{Number(viewPlan.rules.baseSalary).toLocaleString()}</span>
                    </div>
                  )}
                  {viewPlan.rules.baseThreshold != null && (
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Base Threshold</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">Minimum delivered orders to earn base salary</p>
                      </div>
                      <span className="text-sm font-semibold text-surface-900 dark:text-white">{Number(viewPlan.rules.baseThreshold)} orders</span>
                    </div>
                  )}
                  {viewPlan.rules.perOrderRate != null && (
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Per Order Commission</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">Earned for every delivered order</p>
                      </div>
                      <span className="text-sm font-semibold text-success-600 dark:text-success-400">&#8358;{Number(viewPlan.rules.perOrderRate).toLocaleString()}</span>
                    </div>
                  )}
                  {viewPlan.rules.bonusPerExtraOrder != null && (
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Extra Order Bonus</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">
                          Additional bonus per order above {viewPlan.rules.baseThreshold ?? 0} threshold
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-success-600 dark:text-success-400">&#8358;{Number(viewPlan.rules.bonusPerExtraOrder).toLocaleString()}</span>
                    </div>
                  )}
                  {viewPlan.rules.deliveryRateThreshold != null && (
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Delivery Rate Bonus</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">
                          50% extra on bonus when delivery rate exceeds threshold
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">&gt;{Number(viewPlan.rules.deliveryRateThreshold)}%</span>
                    </div>
                  )}
                  {viewPlan.rules.penaltyPerReturn != null && (
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">Return Penalty</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">Clawback deducted per returned order</p>
                      </div>
                      <span className="text-sm font-semibold text-danger-600 dark:text-danger-400">-&#8358;{Number(viewPlan.rules.penaltyPerReturn).toLocaleString()}</span>
                    </div>
                  )}
                  {Object.keys(viewPlan.rules).length === 0 && (
                    <p className="text-sm text-surface-500 dark:text-surface-400 text-center py-4">No rules configured for this plan</p>
                  )}
                </div>
              </div>

              {/* Example Calculation */}
              {(viewPlan.rules.baseSalary != null || viewPlan.rules.perOrderRate != null) && (() => {
                const base = Number(viewPlan.rules.baseSalary ?? 0);
                const threshold = Number(viewPlan.rules.baseThreshold ?? 0);
                const perOrder = Number(viewPlan.rules.perOrderRate ?? 0);
                const extraBonus = Number(viewPlan.rules.bonusPerExtraOrder ?? 0);
                const penalty = Number(viewPlan.rules.penaltyPerReturn ?? 0);
                const exampleOrders = Math.max(threshold + 5, 25);
                const exampleReturns = 2;
                const earnedBase = exampleOrders >= threshold ? base : 0;
                const earnedPerOrder = perOrder * exampleOrders;
                const extraOrders = Math.max(exampleOrders - threshold, 0);
                const earnedExtraBonus = extraBonus * extraOrders;
                const earnedPenalty = penalty * exampleReturns;
                const total = earnedBase + earnedPerOrder + earnedExtraBonus - earnedPenalty;

                return (
                  <div>
                    <p className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2">Example Calculation</p>
                    <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-1.5 text-sm">
                      <p className="text-xs text-surface-500 dark:text-surface-400 mb-2">
                        If a staff member delivers {exampleOrders} orders with {exampleReturns} returns:
                      </p>
                      {earnedBase > 0 && (
                        <div className="flex justify-between">
                          <span className="text-surface-700 dark:text-surface-300">Base Salary</span>
                          <span className="font-medium text-surface-900 dark:text-white">&#8358;{earnedBase.toLocaleString()}</span>
                        </div>
                      )}
                      {earnedPerOrder > 0 && (
                        <div className="flex justify-between">
                          <span className="text-surface-700 dark:text-surface-300">Per Order ({exampleOrders} x &#8358;{perOrder.toLocaleString()})</span>
                          <span className="font-medium text-surface-900 dark:text-white">&#8358;{earnedPerOrder.toLocaleString()}</span>
                        </div>
                      )}
                      {earnedExtraBonus > 0 && (
                        <div className="flex justify-between">
                          <span className="text-surface-700 dark:text-surface-300">Extra Bonus ({extraOrders} x &#8358;{extraBonus.toLocaleString()})</span>
                          <span className="font-medium text-surface-900 dark:text-white">&#8358;{earnedExtraBonus.toLocaleString()}</span>
                        </div>
                      )}
                      {earnedPenalty > 0 && (
                        <div className="flex justify-between">
                          <span className="text-surface-700 dark:text-surface-300">Return Penalty ({exampleReturns} x &#8358;{penalty.toLocaleString()})</span>
                          <span className="font-medium text-danger-600 dark:text-danger-400">-&#8358;{earnedPenalty.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="border-t border-surface-200 dark:border-surface-700 pt-1.5 flex justify-between font-semibold">
                        <span className="text-surface-900 dark:text-white">Estimated Total</span>
                        <span className="text-success-600 dark:text-success-400">&#8358;{total.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <Button variant="secondary" size="sm" className="w-full" onClick={() => setViewPlan(null)}>
                Close
              </Button>
            </div>
          </div>
        </>
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
                                <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{getStaffName(adj.staffId)}</p>
                              </td>
                              <td className="table-cell">
                                <span className={ADJUSTMENT_COLORS[adj.category] ?? 'badge'}>{adj.category.replace(/_/g, ' ')}</span>
                              </td>
                              <td className={`table-cell text-right font-medium ${Number(adj.amount) < 0 ? 'text-danger-600 dark:text-danger-400' : ''}`}>
                                {Number(adj.amount) < 0 ? '-' : ''}&#8358;{Math.abs(Number(adj.amount)).toLocaleString()}
                              </td>
                              <td className="table-cell text-sm text-surface-800 dark:text-surface-200 max-w-[200px] truncate">{adj.reason}</td>
                              <td className="table-cell">
                                {adj.approvedBy ? (
                                  <span className="badge-success">Approved</span>
                                ) : (
                                  <span className="badge-warning">Pending</span>
                                )}
                              </td>
                              <td className="table-cell text-surface-800 dark:text-surface-200 text-sm">
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
                            <tr><td colSpan={7} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No earnings adjustments yet</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile adjustments */}
                    <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
                      {resolvedAdjustments.map((adj: Adjustment) => (
                        <div key={adj.id} className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-surface-900 dark:text-white text-sm">{getStaffName(adj.staffId)}</span>
                            <span className={ADJUSTMENT_COLORS[adj.category] ?? 'badge'}>{adj.category.replace(/_/g, ' ')}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`font-medium ${Number(adj.amount) < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-surface-900 dark:text-white'}`}>
                              {Number(adj.amount) < 0 ? '-' : ''}&#8358;{Math.abs(Number(adj.amount)).toLocaleString()}
                            </span>
                            {adj.approvedBy ? (
                              <span className="badge-success text-xs">Approved</span>
                            ) : (
                              <span className="badge-warning text-xs">Pending</span>
                            )}
                          </div>
                          <p className="text-xs text-surface-700 dark:text-surface-300">{adj.reason}</p>
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
                        <div className="p-8 text-center text-surface-700 dark:text-surface-300">No adjustments yet</div>
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
                <h3 className="text-base font-semibold text-surface-900 dark:text-white mb-3">Active Settlement Window</h3>
                {resolvedConfig ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wide">Window Type</p>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white mt-0.5">{resolvedConfig.windowType}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wide">
                        {resolvedConfig.windowType === 'MONTHLY' ? 'Start Day of Month' : 'Start Day of Week'}
                      </p>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white mt-0.5">
                        {resolvedConfig.windowType === 'MONTHLY'
                          ? `Day ${resolvedConfig.startDay}`
                          : ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][resolvedConfig.startDay] ?? `Day ${resolvedConfig.startDay}`
                        }
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wide">Last Updated</p>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white mt-0.5">
                        {new Date(resolvedConfig.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-surface-800 dark:text-surface-200">No settlement window configured. Set one below to enable automated payout periods.</p>
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
                  <h3 className="text-base font-semibold text-surface-900 dark:text-white mb-2">Current Settlement Period</h3>
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <p className="text-xs text-surface-800 dark:text-surface-200">Start</p>
                      <p className="text-sm font-medium text-surface-900 dark:text-white">{resolvedPeriod.periodStart}</p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-800 dark:text-surface-200">End</p>
                      <p className="text-sm font-medium text-surface-900 dark:text-white">{resolvedPeriod.periodEnd}</p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-800 dark:text-surface-200">Type</p>
                      <p className="text-sm font-medium text-surface-900 dark:text-white">{resolvedPeriod.windowType}</p>
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
                <h3 className="text-base font-semibold text-surface-900 dark:text-white mb-3">Update Settlement Window</h3>
                <fetcher.Form method="post" className="space-y-4">
                  <input type="hidden" name="intent" value="setSettlementConfig" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-surface-200 mb-1">Window Type</label>
                      <select name="windowType" defaultValue={resolvedConfig?.windowType ?? 'MONTHLY'} className="input w-full">
                        <option value="WEEKLY">Weekly</option>
                        <option value="BIWEEKLY">Bi-Weekly</option>
                        <option value="MONTHLY">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 dark:text-surface-200 mb-1">Start Day</label>
                      <input
                        name="startDay"
                        type="number"
                        min={1}
                        max={31}
                        defaultValue={resolvedConfig?.startDay ?? 1}
                        className="input w-full"
                      />
                      <p className="text-xs text-surface-700 mt-1">
                        For Weekly/Bi-Weekly: 1=Mon, 7=Sun. For Monthly: day of month (1-31).
                      </p>
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
              Confirm that <strong>{markPaidConfirm.staffName}</strong> has been paid <strong>&#8358;{markPaidConfirm.amount.toLocaleString()}</strong>. This action cannot be undone.
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
