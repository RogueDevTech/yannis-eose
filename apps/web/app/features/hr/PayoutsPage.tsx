import { Fragment, useState, useEffect } from 'react';
import { useFetcher, useSearchParams, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Pagination } from '~/components/ui/pagination';
import { Spinner } from '~/components/ui/spinner';
import { useFetcherToast } from '~/components/ui/toast';
import { exportToCsv } from '~/lib/csv-export';
import { formatNaira } from '~/lib/format-amount';
import type { Payout, PayoutSummary, HRUser } from './types';

interface PayoutsPageProps {
  payouts: Payout[];
  total: number;
  page: number;
  totalPages: number;
  status: string;
  summary: PayoutSummary;
  users: HRUser[];
}

export function PayoutsPage({
  payouts,
  total,
  page,
  totalPages,
  status,
  summary,
  users,
}: PayoutsPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const [expandedPayoutId, setExpandedPayoutId] = useState<string | null>(null);
  const [markPaidConfirm, setMarkPaidConfirm] = useState<{ payoutId: string; staffName: string; amount: number } | null>(null);
  useFetcherToast(fetcher.data, { successMessage: 'Payout updated' });

  const userMap = new Map(users.map((u) => [u.id, u]));
  const getStaffName = (id: string) => userMap.get(id)?.name ?? id.slice(0, 8) + '…';
  const getStaffRole = (id: string) => userMap.get(id)?.role?.replace(/_/g, ' ') ?? '';

  // Close Mark Paid modal on success
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success && markPaidConfirm) {
      setMarkPaidConfirm(null);
    }
  }, [fetcher.state, fetcher.data, markPaidConfirm]);

  const draftTotal = Number(summary['DRAFT']?.total ?? 0);
  const approvedTotal = Number(summary['APPROVED']?.total ?? 0);
  const paidTotal = Number(summary['PAID']?.total ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payouts"
        description="Individual staff payouts. Drafts are produced by Monthly Payroll batches; Finance marks them paid after disbursement."
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportToCsv(
                  payouts.map((p) => ({
                    staff: getStaffName(p.staffId),
                    role: getStaffRole(p.staffId),
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
                    { key: 'role', label: 'Role' },
                    { key: 'period', label: 'Period' },
                    { key: 'base', label: 'Base Salary' },
                    { key: 'bonus', label: 'Bonus' },
                    { key: 'addOns', label: 'Add-ons' },
                    { key: 'deductions', label: 'Deductions' },
                    { key: 'total', label: 'Total Payout' },
                    { key: 'status', label: 'Status' },
                  ],
                  `payouts-${new Date().toISOString().split('T')[0]}.csv`,
                )
              }
            >
              Export CSV
            </Button>
          </div>
        }
      />

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
            label: 'Total Records',
            value: total,
            valueClassName: 'text-app-fg',
          },
        ]}
      />

      {/* Status filter — URL-driven, mirrors Orders/Users list pattern */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <FormSelect
            label="Status"
            value={status}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value === 'ALL') next.delete('status');
              else next.set('status', e.target.value);
              next.set('page', '1');
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
            <span className="flex items-center text-app-fg-muted pb-2" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
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
              {payouts.map((p) => {
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
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
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
                      <td className="table-cell text-sm text-app-fg-muted whitespace-nowrap">
                        {new Date(p.periodStart).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} —{' '}
                        {new Date(p.periodEnd).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="table-cell text-right text-sm"><NairaPrice amount={Number(p.baseSalary)} /></td>
                      <td className="table-cell text-right text-sm text-success-600 dark:text-success-400">
                        <NairaPrice amount={Number(p.performanceBonus)} />
                      </td>
                      <td className="table-cell text-right text-sm text-brand-600 dark:text-brand-400">
                        <NairaPrice amount={Number(p.addOnsTotal)} />
                      </td>
                      <td className="table-cell text-right text-sm text-danger-600 dark:text-danger-400">
                        {Number(p.deductionsTotal) > 0
                          ? <><span>-</span><NairaPrice amount={Number(p.deductionsTotal)} /></>
                          : '—'}
                      </td>
                      <td className="table-cell text-right font-medium"><NairaPrice amount={Number(p.totalPayout)} /></td>
                      <td className="table-cell"><StatusBadge status={p.status} /></td>
                      <td className="table-cell text-right">
                        {p.status === 'DRAFT' && (
                          <div className="flex justify-end gap-1.5">
                            <fetcher.Form method="post" className="inline">
                              <input type="hidden" name="intent" value="approvePayout" />
                              <input type="hidden" name="payoutId" value={p.id} />
                              <input type="hidden" name="status" value="APPROVED" />
                              <Button type="submit" variant="primary" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing…">
                                Approve
                              </Button>
                            </fetcher.Form>
                            <fetcher.Form method="post" className="inline">
                              <input type="hidden" name="intent" value="approvePayout" />
                              <input type="hidden" name="payoutId" value={p.id} />
                              <input type="hidden" name="status" value="REJECTED" />
                              <Button type="submit" variant="danger" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Processing…">
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
                            onClick={() =>
                              setMarkPaidConfirm({
                                payoutId: p.id,
                                staffName: getStaffName(p.staffId),
                                amount: Number(p.totalPayout),
                              })
                            }
                          >
                            Mark Paid
                          </Button>
                        )}
                      </td>
                    </tr>
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
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title={status === 'ALL' ? 'No payouts yet' : 'No matching payouts'}
                      description={status === 'ALL' ? 'Generate Monthly Payroll batches to produce DRAFT payouts.' : 'Clear the filter or pick a different status.'}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3 px-1 py-2">
          {payouts.map((p) => (
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
                {new Date(p.periodStart).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} —{' '}
                {new Date(p.periodEnd).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
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
                  onClick={() =>
                    setMarkPaidConfirm({
                      payoutId: p.id,
                      staffName: getStaffName(p.staffId),
                      amount: Number(p.totalPayout),
                    })
                  }
                >
                  Mark Paid
                </Button>
              )}
            </div>
          ))}
          {payouts.length === 0 && (
            <EmptyState title="No payouts yet" description="Generate Monthly Payroll batches to produce DRAFT payouts." />
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            Showing {payouts.length} of {total} payouts
          </p>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={(nextPage) => {
              const next = new URLSearchParams(searchParams);
              next.set('page', String(nextPage));
              setSearchParams(next, { replace: true });
            }}
            showLabel
          />
        </div>
      )}

      {markPaidConfirm && (
        <ConfirmActionModal
          open={!!markPaidConfirm}
          onClose={() => setMarkPaidConfirm(null)}
          title="Mark payout as paid?"
          description={
            <>
              Confirm that <strong>{markPaidConfirm.staffName}</strong> has been paid{' '}
              <strong><NairaPrice amount={markPaidConfirm.amount} /></strong>. This action cannot be undone.
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
