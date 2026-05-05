import { Link } from '@remix-run/react';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { NairaPrice } from '~/components/ui/naira-price';
import type { FinanceOverviewPulse } from './types';

export function FinanceOverviewPulseRail({ pulse }: { pulse: FinanceOverviewPulse }) {
  return (
    <Card>
      <CardHeader
        title="Cash & close queue"
        description="Live operational signals — not filtered by the profit date range above."
      />
      <CardBody className="-mt-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            to="/admin/finance/delivery-remittances"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Awaiting cash batch</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
              <NairaPrice amount={pulse.awaitingCash} />
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {pulse.awaitingOrderCount} delivered order(s) not on a remittance
            </p>
          </Link>
          <Link
            to="/admin/finance/delivery-remittances?tab=remittances"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Pending remittance batches</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-warning-600 dark:text-warning-400">
              <NairaPrice amount={pulse.pendingRemittanceAmount} />
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">{pulse.pendingRemittanceBatchCount} batch(es) SENT</p>
          </Link>
          <Link
            to="/admin/finance/delivery-remittances?tab=remittances&status=DISPUTED"
            className="rounded-lg border border-app-border bg-app-hover/60 p-3 transition-colors hover:bg-app-hover"
          >
            <p className="text-xs font-medium text-app-fg-muted">Disputed remittances</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-danger-600 dark:text-danger-400">
              {pulse.disputedRemittanceBatchCount}
            </p>
            <p className="text-xs text-app-fg-muted mt-0.5">Batch outcome(s) need attention</p>
          </Link>
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
