import { Link } from '@remix-run/react';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { formatNaira } from '~/lib/format-amount';
import type { CEODashboardData } from '~/features/ceo/types';

function fmt(n: number): string {
  return formatNaira(Math.round(n));
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export interface SuperAdminDashboardProps {
  data: CEODashboardData | null;
  userName: string;
  filters?: { startDate: string; endDate: string; periodAllTime?: boolean };
}

export function SuperAdminDashboard({ data, userName, filters }: SuperAdminDashboardProps) {
  const firstName = userName?.split(' ')[0] ?? 'Admin';

  const revenue = data?.revenue ?? 0;
  const trueProfit = data?.trueProfit ?? 0;
  const marketingSafe = {
    totalSpend: data?.marketing?.totalSpend ?? 0,
    cpa: data?.marketing?.cpa ?? 0,
    roas: data?.marketing?.roas ?? 0,
    deliveryRate: data?.marketing?.deliveryRate ?? 0,
  };
  const orderPipeline = {
    total: data?.orderPipeline?.total ?? 0,
  };
  const revenueByPeriod = data?.revenueByPeriod ?? { today: 0, thisWeek: 0, thisMonth: 0 };
  const deliveriesByProduct = data?.deliveriesByProduct ?? [];
  const stockPerProduct = data?.stockPerProduct ?? [];
  const activeStaffCount = data?.activeStaffCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        mobileInlineActions
        description="Executive dashboard — key business metrics at a glance."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="hidden md:inline-flex"><PageRefreshButton /></span>
            <span className="md:hidden"><PageRefreshButton iconOnly /></span>
            <DateFilterBar
              startDate={filters?.startDate ?? ''}
              endDate={filters?.endDate ?? ''}
              periodAllTime={filters?.periodAllTime ?? false}
            />
          </div>
        }
      />

      {/* ── HERO: ROAS on Ad Spend ────────────────────────── */}
      <div className="card bg-gradient-to-br from-brand-50 to-brand-100/50 dark:from-brand-900/30 dark:to-brand-800/20 border-brand-200 dark:border-brand-700/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-brand-600 dark:text-brand-400 uppercase tracking-wider mb-1">
              ROAS on Ad Spend
            </p>
            <p className={`text-4xl sm:text-5xl font-bold tabular-nums ${
              marketingSafe.roas >= 2
                ? 'text-success-600 dark:text-success-400'
                : marketingSafe.roas >= 1
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-danger-600 dark:text-danger-400'
            }`}>
              {marketingSafe.roas.toFixed(2)}x
            </p>
            <p className="text-sm text-app-fg-muted mt-1">
              Revenue / Ad Spend = {fmt(revenue)} / {fmt(marketingSafe.totalSpend)}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-lg bg-app-elevated px-4 py-2.5 text-center min-w-[5.5rem]">
              <p className="text-[11px] font-medium text-app-fg-muted">Revenue</p>
              <p className="text-base font-bold text-app-fg tabular-nums">{fmt(revenue)}</p>
            </div>
            <div className="rounded-lg bg-app-elevated px-4 py-2.5 text-center min-w-[5.5rem]">
              <p className="text-[11px] font-medium text-app-fg-muted">Ad Spend</p>
              <p className="text-base font-bold text-danger-600 dark:text-danger-400 tabular-nums">{fmt(marketingSafe.totalSpend)}</p>
            </div>
            <div className="rounded-lg bg-app-elevated px-4 py-2.5 text-center min-w-[5.5rem]">
              <p className="text-[11px] font-medium text-app-fg-muted">Profit</p>
              <p className={`text-base font-bold tabular-nums ${trueProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>{fmt(trueProfit)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Revenue Generated: Day / Week / Month ─────────── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Revenue Generated
        </h2>
        <OverviewStatStrip
          items={[
            { label: 'Today', value: fmt(revenueByPeriod.today), valueClassName: 'text-app-fg tabular-nums' },
            { label: 'This Week', value: fmt(revenueByPeriod.thisWeek), valueClassName: 'text-app-fg tabular-nums' },
            { label: 'This Month', value: fmt(revenueByPeriod.thisMonth), valueClassName: 'text-app-fg tabular-nums' },
          ]}
        />
      </div>

      {/* ── Key Metrics: Ad Spend, Orders, CPA, Delivery Rate, Active Staff ── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Key Metrics
        </h2>
        <OverviewStatStrip
          items={[
            { label: 'Ad Spend', value: fmt(marketingSafe.totalSpend), valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums' },
            { label: 'Order Count', value: orderPipeline.total.toLocaleString(), valueClassName: 'text-app-fg tabular-nums' },
            {
              label: 'CPA',
              value: fmt(marketingSafe.cpa),
              valueClassName: marketingSafe.cpa > 0 && marketingSafe.cpa < 5000
                ? 'text-success-600 dark:text-success-400 tabular-nums'
                : marketingSafe.cpa > 10000
                  ? 'text-danger-600 dark:text-danger-400 tabular-nums'
                  : 'text-app-fg tabular-nums',
            },
            {
              label: 'Delivery Rate',
              value: pct(marketingSafe.deliveryRate),
              valueClassName: marketingSafe.deliveryRate >= 70
                ? 'text-success-600 dark:text-success-400 tabular-nums'
                : marketingSafe.deliveryRate >= 50
                  ? 'text-warning-600 dark:text-warning-400 tabular-nums'
                  : 'text-danger-600 dark:text-danger-400 tabular-nums',
            },
            { label: 'Active Staff', value: activeStaffCount.toLocaleString(), valueClassName: 'text-app-fg tabular-nums' },
          ]}
        />
      </div>

      {/* ── Deliveries per Brand: Day / Week / Month ──────── */}
      {deliveriesByProduct.length > 0 && (
        <div className="card p-0">
          <div className="px-4 py-3 border-b border-app-border">
            <h2 className="text-sm font-semibold text-app-fg">Deliveries per Brand</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">Number of deliveries today, this week, and this month by product</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border bg-app-hover/50">
                  <th className="text-left px-4 py-2 font-medium text-app-fg-muted">Product</th>
                  <th className="text-left px-4 py-2 font-medium text-app-fg-muted">Brand</th>
                  <th className="text-right px-4 py-2 font-medium text-app-fg-muted">Today</th>
                  <th className="text-right px-4 py-2 font-medium text-app-fg-muted">This Week</th>
                  <th className="text-right px-4 py-2 font-medium text-app-fg-muted">This Month</th>
                </tr>
              </thead>
              <tbody>
                {deliveriesByProduct.map((p) => (
                  <tr key={p.productId} className="border-b border-app-border last:border-b-0 hover:bg-app-hover/30">
                    <td className="px-4 py-2 font-medium text-app-fg">{p.productName}</td>
                    <td className="px-4 py-2 text-app-fg-muted">{p.brandName ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium text-app-fg">{p.today}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-app-fg">{p.thisWeek}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-app-fg">{p.thisMonth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Stock Available per Product ───────────────────── */}
      {stockPerProduct.length > 0 && (
        <div className="card p-0">
          <div className="px-4 py-3 border-b border-app-border">
            <h2 className="text-sm font-semibold text-app-fg">Stock Available per Product</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border bg-app-hover/50">
                  <th className="text-left px-4 py-2 font-medium text-app-fg-muted">Product</th>
                  <th className="text-left px-4 py-2 font-medium text-app-fg-muted">Brand</th>
                  <th className="text-right px-4 py-2 font-medium text-app-fg-muted">Available</th>
                </tr>
              </thead>
              <tbody>
                {stockPerProduct.map((p) => (
                  <tr key={p.productId} className="border-b border-app-border last:border-b-0 hover:bg-app-hover/30">
                    <td className="px-4 py-2 font-medium text-app-fg">{p.productName}</td>
                    <td className="px-4 py-2 text-app-fg-muted">{p.brandName ?? '—'}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${
                      p.available <= 0
                        ? 'text-danger-600 dark:text-danger-400'
                        : p.available < 50
                          ? 'text-warning-600 dark:text-warning-400'
                          : 'text-success-600 dark:text-success-400'
                    }`}>
                      {p.available.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Quick Navigation ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickJump to="/admin/cs/queue" label="CS Queue" />
        <QuickJump to="/admin/logistics/orders" label="Logistics" />
        <QuickJump to="/admin/marketing" label="Marketing" />
        <QuickJump to="/admin/finance/overview" label="Finance" />
      </div>
    </div>
  );
}

function QuickJump({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="card text-center py-4 hover:bg-app-hover/40 transition-colors"
    >
      <span className="text-sm font-medium text-app-fg">{label}</span>
    </Link>
  );
}
