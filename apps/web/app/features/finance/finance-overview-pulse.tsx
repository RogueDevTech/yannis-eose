import { useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { Modal } from '~/components/ui/modal';
import { NairaPrice } from '~/components/ui/naira-price';
import { formatNaira } from '~/lib/format-amount';
import { RemittanceInfoIcon as InfoIcon, FormulaBreakdownModal } from './remittance-info-modals';
import type {
  FinanceOverviewPulse,
  FinancePayrollOverview,
  FundingSummary,
  RemittanceBreakdownRow,
} from './types';

export function FinanceCashRemittanceSection({
  pulse,
  byProduct = [],
  byLocation = [],
  dateScope = 'createdAt',
}: {
  pulse: FinanceOverviewPulse;
  byProduct?: RemittanceBreakdownRow[];
  byLocation?: RemittanceBreakdownRow[];
  dateScope?: 'createdAt' | 'deliveredAt';
}) {
  const [infoModal, setInfoModal] = useState<string | null>(null);
  const [dateScopeModalOpen, setDateScopeModalOpen] = useState(false);
  const [, setSearchParams] = useSearchParams();

  // Use gross delivered amount to match the Cash Remittances page
  const totalDelivered = pulse.deliveredAmount ?? pulse.deliveredNetAmount ?? (pulse.awaitingCash + pulse.receivedAmount + pulse.pendingRemittanceAmount + pulse.disputedRemittanceAmount);
  const totalDeliveredOrders = pulse.deliveredCount ?? (pulse.awaitingOrderCount + pulse.totalRemittedCount);
  const netRemittable = pulse.grossOrderValue - pulse.totalDeliveryFees - pulse.totalCommitmentFees - pulse.totalPosFees - pulse.totalFailedDeliveryCosts;

  return (
    <Card>
      <CardHeader
        title="Cash remittance"
        description="Delivered orders and remittance status."
        actions={
          <button
            type="button"
            onClick={() => setDateScopeModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-elevated px-2.5 py-1.5 text-xs font-medium text-app-fg-muted hover:text-app-fg hover:border-brand-400 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            {dateScope === 'createdAt' ? 'By order date' : 'By delivery date'}
          </button>
        }
      />
      <CardBody className="-mt-2 space-y-4">
        {/* Headline totals */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
            <p className="text-xs font-medium text-app-fg-muted flex items-center">
              Total delivered
              <InfoIcon onClick={() => setInfoModal('delivered')} />
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
              {formatNaira(Math.round(totalDelivered))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {totalDeliveredOrders} order(s)
            </p>
          </div>
          <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
            <p className="text-xs font-medium text-app-fg-muted flex items-center">
              Remitted
              <InfoIcon onClick={() => setInfoModal('remitted')} />
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-success-600 dark:text-success-400">
              {formatNaira(Math.round(pulse.receivedAmount))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {pulse.receivedCount} order(s) received
            </p>
          </div>
          <Link
            to="/admin/finance/delivery-remittances"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted flex items-center">
              Awaiting batch
              <InfoIcon onClick={() => setInfoModal('awaiting')} />
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-warning-600 dark:text-warning-400">
              {formatNaira(Math.round(pulse.awaitingCash))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {pulse.awaitingOrderCount} order(s) not on a remittance
            </p>
          </Link>
          <Link
            to="/admin/finance/delivery-remittances?tab=remittances"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted flex items-center">
              Pending
              <InfoIcon onClick={() => setInfoModal('pending')} />
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-warning-600 dark:text-warning-400">
              <NairaPrice amount={pulse.pendingRemittanceAmount} />
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">{pulse.pendingRemittanceBatchCount} order(s) sent</p>
          </Link>
          <Link
            to="/admin/finance/delivery-remittances?tab=remittances&status=DISPUTED"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted flex items-center">
              Disputed
              <InfoIcon onClick={() => setInfoModal('disputed')} />
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-danger-600 dark:text-danger-400">
              {formatNaira(Math.round(pulse.disputedRemittanceAmount))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">{pulse.disputedRemittanceBatchCount} order(s) disputed</p>
          </Link>
        </div>

        {/* Deduction breakdown — batched orders only */}
        {pulse.grossOrderValue > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted flex items-center">
                Gross Order Value ({pulse.receivedCount + pulse.pendingRemittanceBatchCount + pulse.disputedRemittanceBatchCount})
                <InfoIcon onClick={() => setInfoModal('gross')} />
              </p>
              <p className="mt-1 text-base font-semibold tabular-nums text-app-fg">
                {formatNaira(Math.round(pulse.grossOrderValue))}
              </p>
              <p className="text-xs text-app-fg-muted mt-0.5">before deductions</p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted">Delivery Fees ({pulse.deliveryFeeCount})</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-red-500">
                {formatNaira(Math.round(pulse.totalDeliveryFees))}
              </p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted">Commitment Fees ({pulse.commitmentFeeCount})</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-red-500">
                {formatNaira(Math.round(pulse.totalCommitmentFees))}
              </p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted">POS Fees ({pulse.posFeeCount})</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-red-500">
                {formatNaira(Math.round(pulse.totalPosFees))}
              </p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted">Failed Delivery ({pulse.failedDeliveryCount})</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-red-500">
                {formatNaira(Math.round(pulse.totalFailedDeliveryCosts))}
              </p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted flex items-center">
                Expected Net ({pulse.receivedCount + pulse.pendingRemittanceBatchCount + pulse.disputedRemittanceBatchCount})
                <InfoIcon onClick={() => setInfoModal('net')} />
              </p>
              <p className="mt-1 text-base font-semibold tabular-nums text-success-600 dark:text-success-400">
                {formatNaira(Math.round(netRemittable))}
              </p>
              <p className="text-xs text-app-fg-muted mt-0.5">after all deductions</p>
            </div>
          </div>
        )}

        {/* Breakdowns side-by-side */}
        {(byProduct.length > 0 || byLocation.length > 0) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {byProduct.length > 0 && (
              <BreakdownList title="By product" rows={byProduct} nameKey="productName" />
            )}
            {byLocation.length > 0 && (
              <BreakdownList title="By location" rows={byLocation} nameKey="locationName" />
            )}
          </div>
        )}
        {/* Info modals */}
        <FormulaBreakdownModal
          open={infoModal === 'delivered'}
          onClose={() => setInfoModal(null)}
          title="Total Delivered"
          description="Gross value of all orders with status DELIVERED or REMITTED in the selected period. This is the total amount customers paid, before any delivery fees or other deductions."
          lines={[
            { label: 'All delivered + remitted orders', amount: totalDelivered, type: 'value', count: totalDeliveredOrders },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'remitted'}
          onClose={() => setInfoModal(null)}
          title="Remitted"
          description="Gross value of orders on remittance batches that Finance has marked as received."
          lines={[
            { label: 'Orders on received batches (gross)', amount: pulse.receivedAmount, type: 'value', count: pulse.receivedCount },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'awaiting'}
          onClose={() => setInfoModal(null)}
          title="Awaiting Batch"
          description="Gross value of delivered orders that have not been placed on any remittance batch yet. These orders are waiting for an accountant to create a remittance."
          lines={[
            { label: 'Delivered orders not on any batch (gross)', amount: pulse.awaitingCash, type: 'value', count: pulse.awaitingOrderCount },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'pending'}
          onClose={() => setInfoModal(null)}
          title="Pending"
          description="Gross value of orders on remittance batches that have been sent but not yet marked as received by Finance."
          lines={[
            { label: 'Orders on SENT batches (gross)', amount: pulse.pendingRemittanceAmount, type: 'value', count: pulse.pendingRemittanceBatchCount },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'disputed'}
          onClose={() => setInfoModal(null)}
          title="Disputed"
          description="Net value of orders on remittance batches that have been flagged as disputed. The amount was not received as expected."
          lines={[
            { label: 'Orders on DISPUTED batches', amount: pulse.disputedRemittanceAmount, type: 'value', count: pulse.disputedRemittanceBatchCount },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'gross'}
          onClose={() => setInfoModal(null)}
          title="Gross Order Value"
          description="Total order value of all orders on received remittance batches. Before deductions."
          lines={[
            { label: 'Orders on received batches (gross)', amount: pulse.grossOrderValue, type: 'value', count: pulse.receivedCount },
          ]}
        />
        <FormulaBreakdownModal
          open={infoModal === 'net'}
          onClose={() => setInfoModal(null)}
          title="Expected Net"
          description="Computed amount the company should receive after all deductions. Compare this to the Actual Received to spot variances."
          lines={[
            { label: 'Gross Order Value', amount: pulse.grossOrderValue, type: 'value' },
            { label: 'Delivery Fees', amount: pulse.totalDeliveryFees, type: 'deduction', count: pulse.deliveryFeeCount },
            { label: 'Commitment Fees', amount: pulse.totalCommitmentFees, type: 'deduction', count: pulse.commitmentFeeCount },
            { label: 'POS Fees', amount: pulse.totalPosFees, type: 'deduction', count: pulse.posFeeCount },
            { label: 'Failed Delivery', amount: pulse.totalFailedDeliveryCosts, type: 'deduction', count: pulse.failedDeliveryCount },
            { label: 'Expected Net', amount: netRemittable, type: 'result' },
          ]}
        />
      </CardBody>

      {/* Date scope selector modal */}
      <Modal open={dateScopeModalOpen} onClose={() => setDateScopeModalOpen(false)} maxWidth="max-w-xs" contentClassName="p-5 space-y-3">
        <h3 className="text-base font-semibold text-app-fg">Stats date scope</h3>
        <p className="text-sm text-app-fg-muted">
          Choose which date the stats use for period filtering.
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setDateScopeModalOpen(false);
              setSearchParams((p) => { const n = new URLSearchParams(p); n.set('dateScope', 'createdAt'); return n; }, { replace: true });
            }}
            className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              dateScope === 'createdAt'
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                : 'border-app-border bg-app-elevated text-app-fg hover:border-brand-400'
            }`}
          >
            <span className="font-medium">By order date</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setDateScopeModalOpen(false);
              setSearchParams((p) => { const n = new URLSearchParams(p); n.set('dateScope', 'deliveredAt'); return n; }, { replace: true });
            }}
            className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              dateScope === 'deliveredAt'
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                : 'border-app-border bg-app-elevated text-app-fg hover:border-brand-400'
            }`}
          >
            <span className="font-medium">By delivery date</span>
          </button>
        </div>
      </Modal>
    </Card>
  );
}

function BreakdownList({
  title,
  rows,
  nameKey,
}: {
  title: string;
  rows: RemittanceBreakdownRow[];
  nameKey: 'productName' | 'locationName';
}) {
  const maxAmount = Math.max(...rows.map((r) => Number(r.totalAmount)), 1);

  return (
    <div className="rounded-lg border border-app-border p-3">
      <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wide mb-2.5">{title}</p>
      <div className="space-y-2 max-h-[16rem] overflow-y-auto">
        {rows.map((row, i) => {
          const amount = Number(row.totalAmount);
          const pct = Math.min(100, (amount / maxAmount) * 100);
          const name = row[nameKey] || 'Unknown';
          return (
            <div key={`${nameKey}-${i}`}>
              <div className="flex items-center justify-between gap-2 text-xs mb-1">
                <span className="min-w-0 truncate font-medium text-app-fg" title={name}>
                  {name}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-app-fg-muted">
                    {row.orderCount} order(s)
                  </span>
                  <span className="font-semibold tabular-nums text-app-fg">
                    {formatNaira(Math.round(amount))}
                  </span>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-app-border">
                <div
                  className="h-full rounded-full bg-brand-500/70 dark:bg-brand-600/75"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FinancePayrollSection({ payroll }: { payroll: FinancePayrollOverview }) {
  const pending = payroll.pendingFinance;
  const paid = payroll.paidInPeriod;
  const period = payroll.periodCost;
  const maxRoleNet = Math.max(...payroll.byPayRole.map((r) => r.totalNet), 1);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Payroll"
          description="Payroll cost for the selected period and branch (pay-role lines from payroll batches)."
        />
        <CardBody className="-mt-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              to="/hr/payroll"
              className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
            >
              <p className="text-xs font-medium text-app-fg-muted">Awaiting Finance</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-warning-600 dark:text-warning-400">
                {formatNaira(Math.round(pending.totalNet))}
              </p>
              <p className="text-xs text-app-fg-muted mt-0.5">
                {pending.batchCount} pending batch(es) · {pending.staffCount} staff in filters
              </p>
            </Link>
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted">Paid in period</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-success-600 dark:text-success-400">
                {formatNaira(Math.round(paid.totalNet))}
              </p>
              <p className="text-xs text-app-fg-muted mt-0.5">
                {paid.batchCount} batch(es) · {paid.staffCount} staff
              </p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted">Period gross</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
                {formatNaira(Math.round(period.totalGross))}
              </p>
              <p className="text-xs text-app-fg-muted mt-0.5">
                Pending Finance + Paid in filters
              </p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
              <p className="text-xs font-medium text-app-fg-muted">Period PAYE</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
                {formatNaira(Math.round(period.totalTax))}
              </p>
              <p className="text-xs text-app-fg-muted mt-0.5">
                Tax on pending + paid batches
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Cost by pay role"
          description="Net pay from payout lines in the selected period, grouped by pay role on each payslip."
        />
        <CardBody className="-mt-2">
          {payroll.byPayRole.length === 0 ? (
            <p className="text-sm text-app-fg-muted py-4 text-center">
              No payroll lines in this period yet.
            </p>
          ) : (
            <div className="space-y-2 max-h-[20rem] overflow-y-auto">
              {payroll.byPayRole.map((row) => {
                const pct = Math.min(100, (row.totalNet / maxRoleNet) * 100);
                return (
                  <div key={row.label}>
                    <div className="flex items-center justify-between gap-2 text-xs mb-1">
                      <span className="min-w-0 truncate font-medium text-app-fg" title={row.label}>
                        {row.label}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-app-fg-muted">
                          {row.headcount} line(s)
                        </span>
                        <span className="font-semibold tabular-nums text-app-fg">
                          {formatNaira(Math.round(row.totalNet))}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-app-border">
                      <div
                        className="h-full rounded-full bg-brand-500/70 dark:bg-brand-600/75"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function FinanceDisbursementSection({ summary }: { summary: FundingSummary }) {
  const totalSent = Number(summary.totalSent);
  const totalCompleted = Number(summary.totalCompleted);
  const totalDisputed = Number(summary.totalDisputed);
  const totalDisbursed = totalSent + totalCompleted + totalDisputed;
  const totalCount = summary.sentCount + summary.completedCount + summary.disputedCount;

  return (
    <Card>
      <CardHeader
        title="Disbursements"
        description="Money disbursed to Head of Marketing for ad spend."
      />
      <CardBody className="-mt-2">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Link
            to="/admin/finance/disbursements"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Total disbursed</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
              {formatNaira(Math.round(totalDisbursed))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">{totalCount} transfer(s)</p>
          </Link>
          <Link
            to="/admin/finance/disbursements?status=SENT"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Pending</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-warning-600 dark:text-warning-400">
              {formatNaira(Math.round(totalSent))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">{summary.sentCount} transfer(s)</p>
          </Link>
          <Link
            to="/admin/finance/disbursements?status=COMPLETED"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Received</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-success-600 dark:text-success-400">
              {formatNaira(Math.round(totalCompleted))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">{summary.completedCount} transfer(s)</p>
          </Link>
          <Link
            to="/admin/finance/disbursements?status=DISPUTED"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Disputed</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-danger-600 dark:text-danger-400">
              {formatNaira(Math.round(totalDisputed))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">{summary.disputedCount} transfer(s)</p>
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
