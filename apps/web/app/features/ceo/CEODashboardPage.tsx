import { Link } from '@remix-run/react';
import { DateFilterBar } from '~/components/dashboard/DateFilterBar';
import type { CEODashboardData } from './types';

const STATUS_LABELS: Record<string, string> = {
  UNPROCESSED: 'Unprocessed',
  CS_ENGAGED: 'CS Engaged',
  CONFIRMED: 'Confirmed',
  ALLOCATED: 'Allocated',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
  PARTIALLY_DELIVERED: 'Partial',
  RESTOCKED: 'Restocked',
  WRITTEN_OFF: 'Written Off',
};

const STATUS_COLORS: Record<string, string> = {
  UNPROCESSED: 'text-warning-600 dark:text-warning-400',
  CS_ENGAGED: 'text-info-600 dark:text-info-400',
  CONFIRMED: 'text-brand-600 dark:text-brand-400',
  ALLOCATED: 'text-info-600 dark:text-info-400',
  DISPATCHED: 'text-info-600 dark:text-info-400',
  IN_TRANSIT: 'text-brand-600 dark:text-brand-400',
  DELIVERED: 'text-success-600 dark:text-success-400',
  COMPLETED: 'text-success-600 dark:text-success-400',
  CANCELLED: 'text-danger-600 dark:text-danger-400',
  RETURNED: 'text-danger-600 dark:text-danger-400',
  PARTIALLY_DELIVERED: 'text-warning-600 dark:text-warning-400',
  RESTOCKED: 'text-success-600 dark:text-success-400',
  WRITTEN_OFF: 'text-danger-600 dark:text-danger-400',
};

function fmt(n: number): string {
  return `\u20A6${Math.round(n).toLocaleString()}`;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export interface CEODashboardPageProps {
  data: CEODashboardData;
  filters?: { startDate: string; endDate: string; periodAllTime?: boolean };
  showBackToDashboard?: boolean;
}

export function CEODashboardPage({ data, filters = { startDate: '', endDate: '', periodAllTime: false }, showBackToDashboard = true }: CEODashboardPageProps) {
  const { costBreakdown, orderPipeline, marketing, csTeam, payroll } = data;
  const totalCosts =
    costBreakdown.landedCost +
    costBreakdown.deliveryFee +
    costBreakdown.adSpend +
    costBreakdown.commission +
    costBreakdown.fulfillmentCost +
    costBreakdown.operationalLoss;

  const deliveryRate = orderPipeline.total > 0
    ? (orderPipeline.delivered / orderPipeline.total) * 100
    : 0;
  const cancelRate = orderPipeline.total > 0
    ? (orderPipeline.cancelled / orderPipeline.total) * 100
    : 0;
  const returnRate = orderPipeline.delivered > 0
    ? (orderPipeline.returned / orderPipeline.delivered) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Executive Overview</h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-1">
            Real-time business intelligence across all departments.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <DateFilterBar startDate={filters.startDate} endDate={filters.endDate} periodAllTime={filters.periodAllTime ?? false} />
          {showBackToDashboard && (
            <Link to="/admin" className="btn-secondary btn-sm">Back to Dashboard</Link>
          )}
        </div>
      </div>

      {/* ── Section 1: Revenue & Profit KPIs ────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-surface-700 dark:text-surface-500 uppercase tracking-wider mb-3">
          Revenue & Profit
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Revenue" value={fmt(data.revenue)} icon="revenue" />
          <KPICard
            label="True Profit"
            value={fmt(data.trueProfit)}
            icon="profit"
            highlight={data.trueProfit >= 0 ? 'success' : 'danger'}
          />
          <KPICard
            label="Net Margin"
            value={pct(data.margin)}
            icon="margin"
            highlight={data.margin >= 20 ? 'success' : data.margin >= 10 ? 'warning' : 'danger'}
          />
          <KPICard
            label="Total Costs"
            value={fmt(totalCosts)}
            icon="costs"
            highlight="danger"
          />
        </div>
      </div>

      {/* ── Section 2: Cost Breakdown + Profit Waterfall ───── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
            Cost Breakdown
          </h2>
          <div className="space-y-3">
            <CostRow label="Landed COGS" value={costBreakdown.landedCost} total={totalCosts} />
            <CostRow label="Delivery Fees" value={costBreakdown.deliveryFee} total={totalCosts} />
            <CostRow label="Ad Spend" value={costBreakdown.adSpend} total={totalCosts} />
            <CostRow label="Commission" value={costBreakdown.commission} total={totalCosts} />
            <CostRow label="Fulfillment" value={costBreakdown.fulfillmentCost} total={totalCosts} />
            <CostRow label="Operational Loss" value={costBreakdown.operationalLoss} total={totalCosts} />
            <div className="pt-3 border-t border-surface-200 dark:border-surface-700">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-surface-900 dark:text-white">Total Costs</span>
                <span className="text-sm font-bold text-danger-600 dark:text-danger-400">{fmt(totalCosts)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
            Profit Waterfall
          </h2>
          <div className="space-y-2">
            <WaterfallRow label="Revenue" value={data.revenue} type="positive" />
            <WaterfallRow label="Landed COGS" value={-costBreakdown.landedCost} type="negative" />
            <WaterfallRow label="Delivery Fees" value={-costBreakdown.deliveryFee} type="negative" />
            <WaterfallRow label="Ad Spend" value={-costBreakdown.adSpend} type="negative" />
            <WaterfallRow label="Commission" value={-costBreakdown.commission} type="negative" />
            <WaterfallRow label="Fulfillment" value={-costBreakdown.fulfillmentCost} type="negative" />
            <WaterfallRow label="Op. Loss" value={-costBreakdown.operationalLoss} type="negative" />
            <div className="pt-3 border-t-2 border-surface-300 dark:border-surface-600">
              <WaterfallRow
                label="True Profit"
                value={data.trueProfit}
                type={data.trueProfit >= 0 ? 'positive' : 'negative'}
                bold
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: Order Pipeline ─────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-surface-700 dark:text-surface-500 uppercase tracking-wider mb-3">
          Order Pipeline
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <KPICard label="Total Orders" value={orderPipeline.total.toString()} icon="orders" />
          <KPICard label="Active" value={orderPipeline.active.toString()} icon="pending" highlight="warning" />
          <KPICard
            label="Delivered"
            value={orderPipeline.delivered.toString()}
            icon="orders"
            highlight="success"
            subtitle={pct(deliveryRate)}
          />
          <KPICard
            label="Cancelled"
            value={orderPipeline.cancelled.toString()}
            icon="orders"
            highlight={orderPipeline.cancelled > 0 ? 'danger' : undefined}
            subtitle={pct(cancelRate)}
          />
          <KPICard
            label="Returned"
            value={orderPipeline.returned.toString()}
            icon="orders"
            highlight={orderPipeline.returned > 0 ? 'danger' : undefined}
            subtitle={pct(returnRate)}
          />
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">Status Distribution</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(orderPipeline.statusCounts)
              .filter(([, count]) => count > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => (
                <div key={status} className="text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <p className={`text-2xl font-bold ${STATUS_COLORS[status] ?? 'text-surface-900 dark:text-white'}`}>
                    {count}
                  </p>
                  <p className="text-xs text-surface-800 dark:text-surface-400 mt-0.5">
                    {STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Section 4: Marketing + CS + Payroll ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Marketing */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Marketing</h2>
            <Link to="/admin/marketing" className="text-xs text-brand-500 hover:text-brand-600 font-medium">View details</Link>
          </div>
          <div className="space-y-3">
            <MetricRow label="Total Ad Spend" value={fmt(marketing.totalSpend)} />
            <MetricRow
              label="CPA"
              value={fmt(marketing.cpa)}
              highlight={marketing.cpa > 0 && marketing.cpa < 5000 ? 'success' : marketing.cpa > 10000 ? 'danger' : undefined}
            />
            <MetricRow
              label="True ROAS"
              value={`${marketing.roas.toFixed(2)}x`}
              highlight={marketing.roas >= 2 ? 'success' : marketing.roas >= 1 ? 'warning' : 'danger'}
            />
            <MetricRow
              label="Delivery Rate"
              value={pct(marketing.deliveryRate)}
              highlight={marketing.deliveryRate >= 70 ? 'success' : marketing.deliveryRate >= 50 ? 'warning' : 'danger'}
            />
          </div>
        </div>

        {/* CS Team */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">CS Team</h2>
            <Link to="/admin/cs" className="text-xs text-brand-500 hover:text-brand-600 font-medium">View details</Link>
          </div>
          <div className="space-y-3">
            <MetricRow label="Agents Active" value={csTeam.agentCount.toString()} />
            <MetricRow
              label="Pending Orders"
              value={csTeam.pendingOrders.toString()}
              highlight={csTeam.pendingOrders > 20 ? 'danger' : csTeam.pendingOrders > 10 ? 'warning' : undefined}
            />
            <MetricRow
              label="Utilization"
              value={`${csTeam.utilization}%`}
              highlight={csTeam.utilization >= 80 ? 'danger' : csTeam.utilization >= 60 ? 'warning' : 'success'}
            />
            {csTeam.agentCount > 0 && (
              <MetricRow
                label="Avg per Agent"
                value={(csTeam.pendingOrders / csTeam.agentCount).toFixed(1)}
              />
            )}
          </div>
        </div>

        {/* Payroll */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Payroll</h2>
            <Link to="/admin/hr" className="text-xs text-brand-500 hover:text-brand-600 font-medium">View details</Link>
          </div>
          <div className="space-y-3">
            <MetricRow label="Staff Count" value={payroll.staffCount.toString()} />
            <MetricRow label="Total Paid" value={fmt(payroll.totalPaid)} highlight="success" />
            <MetricRow
              label="Pending Payouts"
              value={fmt(payroll.totalPending)}
              highlight={payroll.totalPending > 0 ? 'warning' : undefined}
            />
            <MetricRow
              label="Avg per Staff"
              value={payroll.staffCount > 0 ? fmt((payroll.totalPaid + payroll.totalPending) / payroll.staffCount) : fmt(0)}
            />
          </div>
        </div>
      </div>

      {/* ── Section 5: Quick Links ────────────────────────── */}
      <div className="card">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Quick Navigation</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { href: '/admin/cs/orders', label: 'Orders', icon: 'orders' },
            { href: '/admin/finance', label: 'Finance', icon: 'finance' },
            { href: '/admin/marketing', label: 'Marketing', icon: 'marketing' },
            { href: '/admin/inventory', label: 'Inventory', icon: 'inventory' },
            { href: '/admin/hr', label: 'HR & Payroll', icon: 'hr' },
            { href: '/admin/audit', label: 'Audit Trail', icon: 'audit' },
          ].map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="flex flex-col items-center gap-2 p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center">
                <QuickNavIcon type={item.icon} />
              </div>
              <span className="text-xs font-medium text-surface-700 dark:text-surface-300">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function KPICard({
  label,
  value,
  icon,
  highlight,
  subtitle,
}: {
  label: string;
  value: string;
  icon: string;
  highlight?: 'warning' | 'success' | 'danger';
  subtitle?: string;
}) {
  const valueColor = highlight
    ? { warning: 'text-warning-600 dark:text-warning-400', success: 'text-success-600 dark:text-success-400', danger: 'text-danger-600 dark:text-danger-400' }[highlight]
    : 'text-surface-900 dark:text-white';

  const iconBg = highlight
    ? { warning: 'bg-warning-50 dark:bg-warning-700/20 text-warning-600 dark:text-warning-400', success: 'bg-success-50 dark:bg-success-700/20 text-success-600 dark:text-success-400', danger: 'bg-danger-50 dark:bg-danger-700/20 text-danger-600 dark:text-danger-400' }[highlight]
    : 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400';

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">{label}</p>
        <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
          <KPIIcon type={icon} />
        </div>
      </div>
      <p className={`text-2xl font-bold mt-2 ${valueColor}`}>{value}</p>
      {subtitle && <p className="text-xs text-surface-700 dark:text-surface-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function CostRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pctOfTotal = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm text-surface-800 dark:text-surface-400">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-700 dark:text-surface-500">{pctOfTotal.toFixed(0)}%</span>
          <span className="text-sm font-medium text-danger-600 dark:text-danger-400">{fmt(value)}</span>
        </div>
      </div>
      <div className="w-full h-1.5 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-danger-400 dark:bg-danger-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pctOfTotal, 100)}%` }}
        />
      </div>
    </div>
  );
}

function WaterfallRow({
  label,
  value,
  type,
  bold,
}: {
  label: string;
  value: number;
  type: 'positive' | 'negative';
  bold?: boolean;
}) {
  const color = type === 'positive'
    ? 'text-success-600 dark:text-success-400'
    : 'text-danger-600 dark:text-danger-400';
  const prefix = value >= 0 ? '+' : '';

  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${bold ? 'font-semibold text-surface-900 dark:text-white' : 'text-surface-800 dark:text-surface-400'}`}>
        {label}
      </span>
      <span className={`text-sm ${bold ? 'font-bold' : 'font-medium'} ${color}`}>
        {prefix}{fmt(value)}
      </span>
    </div>
  );
}

function MetricRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'warning' | 'success' | 'danger';
}) {
  const valueColor = highlight
    ? { warning: 'text-warning-600 dark:text-warning-400', success: 'text-success-600 dark:text-success-400', danger: 'text-danger-600 dark:text-danger-400' }[highlight]
    : 'text-surface-900 dark:text-white';

  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-surface-800 dark:text-surface-400">{label}</span>
      <span className={`text-sm font-medium ${valueColor}`}>{value}</span>
    </div>
  );
}

function KPIIcon({ type }: { type: string }) {
  const paths: Record<string, string> = {
    revenue: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
    profit: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    margin: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
    costs: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
    orders: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z',
    pending: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  };

  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[type] ?? paths['orders']} />
    </svg>
  );
}

function QuickNavIcon({ type }: { type: string }) {
  const paths: Record<string, string> = {
    orders: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z',
    finance: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
    marketing: 'M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46',
    inventory: 'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z',
    hr: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z',
    audit: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  };

  return (
    <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[type] ?? paths['orders']} />
    </svg>
  );
}
