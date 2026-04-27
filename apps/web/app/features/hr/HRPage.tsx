import { useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Modal } from '~/components/ui/modal';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { TextInput } from '~/components/ui/text-input';
import type { Adjustment, HRUser, HRStreamData } from './types';
import { MonthlyPayrolls } from './MonthlyPayrolls';

const ADJ_CATEGORIES = ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER'];

/**
 * HR & Payroll landing page.
 *
 * Layout philosophy (CEO directive 2026-04-26): the heavy concerns are split across separate
 * routes — Commission Plans → /hr/plans, raw Payouts list → /hr/payouts. This page focuses on
 * the multi-stage payroll workflow (Monthly Payrolls) plus a small Adjustments inbox that only
 * HR + Finance use. Heads of Department land on this page and see only Monthly Payrolls.
 *
 * The Settlement Config tab was removed — payroll always runs monthly.
 */
export function HRPage({
  adjustments,
  users,
  monthlyPayrolls,
  branches,
  viewer,
  initialBatchId,
}: HRStreamData) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'monthly' | 'adjustments'>('monthly');
  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  const [adjustmentStaffId, setAdjustmentStaffId] = useState('');

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const [dismissedError, setDismissedError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'HR action completed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  /** Close add-on modal after a successful mutation (same fetcher as approve actions). */
  useEffect(() => {
    if (fetcher.state !== 'idle') return;
    const data = fetcher.data as { success?: boolean } | undefined;
    if (data?.success && showAddAdjustment) setShowAddAdjustment(false);
  }, [fetcher.state, fetcher.data, showAddAdjustment]);

  const isAdmin = viewer.role === 'SUPER_ADMIN' || viewer.role === 'ADMIN';
  const isHrOrFinance = isAdmin || viewer.role === 'HR_MANAGER' || viewer.role === 'FINANCE_OFFICER' || viewer.isFinanceOfficer;

  return (
    <div className="space-y-4">
      <PageHeader
        title="HR & Payroll"
        description="Monthly payroll batches and staff earnings adjustments. Commission plans and per-staff payouts live on their own pages."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <PageRefreshButton />
            {isHrOrFinance && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAddAdjustment(true)}
              >
                + Add-on
              </Button>
            )}
          </div>
        }
      />

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
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
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-app-fg">Add Earning Adjustment</h3>
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
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="createAdjustment" />
            <input type="hidden" name="staffId" value={adjustmentStaffId} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <DeferredSection resolve={users} skeleton="inline">
                  {(resolvedUsers) => (
                    <SearchableSelect
                      id="hr-adjustment-staffId"
                      label="Staff Member"
                      required
                      value={adjustmentStaffId}
                      onChange={setAdjustmentStaffId}
                      placeholder="Select staff..."
                      searchPlaceholder="Search staff..."
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
            <div className="flex gap-2 pt-1">
              <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Creating...">
                Create Adjustment
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
          viewer={viewer}
          initialBatchId={initialBatchId}
          fetchBatchDetail={async (id) => {
            const res = await fetch(`/hr/payroll-batch/${id}`);
            if (!res.ok) return null;
            return res.json();
          }}
        />
      )}

      {activeTab === 'adjustments' && isHrOrFinance && (
        <DeferredSection resolve={adjustments} skeleton="table">
          {(resolvedAdjustments) => (
            <DeferredSection resolve={users} skeleton="table">
              {(resolvedUsers) => {
                const getStaffName = (id: string) => resolvedUsers.find((u: HRUser) => u.id === id)?.name ?? id.slice(0, 8) + '...';
                return (
                  <div className="card p-0">
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
                              <td className="table-cell"><StatusBadge status={adj.category} /></td>
                              <td className={`table-cell text-right font-medium ${Number(adj.amount) < 0 ? 'text-danger-600 dark:text-danger-400' : ''}`}>
                                {Number(adj.amount) < 0
                                  ? <><span>-</span><NairaPrice amount={Math.abs(Number(adj.amount))} /></>
                                  : <NairaPrice amount={Number(adj.amount)} />}
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
                            <tr>
                              <td colSpan={7}>
                                <EmptyState title="No earnings adjustments yet" description="Add an adjustment to get started." />
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="md:hidden space-y-3 px-1">
                      {resolvedAdjustments.map((adj: Adjustment) => (
                        <div key={adj.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-app-fg text-sm">{getStaffName(adj.staffId)}</span>
                            <StatusBadge status={adj.category} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`font-medium ${Number(adj.amount) < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`}>
                              {Number(adj.amount) < 0
                                ? <><span>-</span><NairaPrice amount={Math.abs(Number(adj.amount))} /></>
                                : <NairaPrice amount={Number(adj.amount)} />}
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
    </div>
  );
}
