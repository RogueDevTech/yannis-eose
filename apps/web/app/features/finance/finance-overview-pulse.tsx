import { Link } from '@remix-run/react';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { NairaPrice } from '~/components/ui/naira-price';
import { formatNaira } from '~/lib/format-amount';
import type { FinanceOverviewPulse, FundingSummary, RemittanceBreakdownRow } from './types';

export function FinanceCashRemittanceSection({
  pulse,
  byProduct = [],
  byLocation = [],
}: {
  pulse: FinanceOverviewPulse;
  byProduct?: RemittanceBreakdownRow[];
  byLocation?: RemittanceBreakdownRow[];
}) {
  const totalDelivered = pulse.awaitingCash + pulse.totalRemitted;
  const totalDeliveredOrders = pulse.awaitingOrderCount + pulse.totalRemittedCount;

  return (
    <Card>
      <CardHeader
        title="Cash remittance"
        description="Delivered orders and remittance status."
      />
      <CardBody className="-mt-2 space-y-4">
        {/* Headline totals */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
            <p className="text-xs font-medium text-app-fg-muted">Total delivered</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
              {formatNaira(Math.round(totalDelivered))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {totalDeliveredOrders} order(s)
            </p>
          </div>
          <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
            <p className="text-xs font-medium text-app-fg-muted">Remitted</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-success-600 dark:text-success-400">
              {formatNaira(Math.round(pulse.receivedAmount))}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {pulse.receivedCount} batch(es) received
            </p>
          </div>
          <Link
            to="/admin/finance/delivery-remittances"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Awaiting batch</p>
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
            <p className="text-xs font-medium text-app-fg-muted">Pending batches</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-warning-600 dark:text-warning-400">
              <NairaPrice amount={pulse.pendingRemittanceAmount} />
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">{pulse.pendingRemittanceBatchCount} batch(es) SENT</p>
          </Link>
          <Link
            to="/admin/finance/delivery-remittances?tab=remittances&status=DISPUTED"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Disputed</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-danger-600 dark:text-danger-400">
              {pulse.disputedRemittanceBatchCount}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">Batch(es) need attention</p>
          </Link>
        </div>

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
      </CardBody>
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

export function FinancePayrollSection({ pulse }: { pulse: FinanceOverviewPulse }) {
  return (
    <Card>
      <CardHeader
        title="Payroll"
        description="Payroll batches and approval requests awaiting finance action."
      />
      <CardBody className="-mt-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            to="/hr/payroll"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Payroll awaiting Finance</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
              {pulse.payrollPendingFinanceCount}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">Batch(es) in PENDING_FINANCE</p>
          </Link>
          <Link
            to="/admin/finance/disbursements"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Approval inbox</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
              {pulse.approvalsPendingCount}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">Finance approval request(s) pending</p>
          </Link>
        </div>
      </CardBody>
    </Card>
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
