import { Link } from '@remix-run/react';
import { StatRow, StatRowGroup } from '~/components/ui/stat-row';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
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
    confirmationRate: (data?.marketing as Record<string, number> | undefined)?.confirmationRate ?? 0,
    deliveryRate: data?.marketing?.deliveryRate ?? 0,
  };
  const orderPipeline = {
    total: data?.orderPipeline?.total ?? 0,
  };
  const revenueByPeriod = data?.revenueByPeriod ?? { today: 0, thisWeek: 0, thisMonth: 0 };
  // Deliveries per Brand + Stock Available per Product removed 2026-05-19 per
  // CEO directive; backend still returns them but this view no longer renders.
  const activeStaffCount = data?.activeStaffCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        mobileInlineActions
        description="Executive dashboard — key business metrics at a glance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Dashboard tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Dashboard date range"
            desktop={
              <>
                <PageRefreshButton />
                <div className="flex min-h-[2rem] items-center rounded-md border border-app-border bg-app-hover py-1 pl-2.5 pr-2">
                  <DateFilterBar
                    startDate={filters?.startDate ?? ''}
                    endDate={filters?.endDate ?? ''}
                    periodAllTime={filters?.periodAllTime ?? false}
                  />
                </div>
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters?.startDate ?? ''}
        endDate={filters?.endDate ?? ''}
        periodAllTime={filters?.periodAllTime ?? false}
      />

      {/* ── HERO: ROAS on Ad Spend ────────────────────────── */}
      {/* Uses the standard `.card` chrome (CEO 2026-05-19) — same surface as
          every other admin card so the dashboard doesn't visually drift. */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-1">
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
          <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
            <KeyMetricTile label="Revenue" value={fmt(revenue)} to="/admin/marketing/orders?status=DELIVERED" />
            <KeyMetricTile
              label="Profit"
              value={fmt(trueProfit)}
              valueClassName={
                trueProfit >= 0
                  ? 'text-success-600 dark:text-success-400'
                  : 'text-danger-600 dark:text-danger-400'
              }
              to="/admin/ceo"
            />
          </div>
        </div>
      </div>

      {/* ── Revenue Generated: stacked column ── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Revenue Generated
        </h2>
        <div className="card px-4 py-2">
          <StatRowGroup divided>
            <StatRow label="Today" value={fmt(revenueByPeriod.today)} />
            <StatRow label="This Week" value={fmt(revenueByPeriod.thisWeek)} />
            <StatRow label="This Month" value={fmt(revenueByPeriod.thisMonth)} variant="highlight" />
          </StatRowGroup>
        </div>
      </div>

      {/* ── Key Metrics: 2-per-row on mobile, 5-per-row from md: up ── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Key Metrics
        </h2>
        <div className="card p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
          <KeyMetricTile
            label="Ad Spend"
            value={fmt(marketingSafe.totalSpend)}
            valueClassName="text-danger-600 dark:text-danger-400"
            to="/admin/marketing/ad-spend"
          />
          <KeyMetricTile label="Order Count" value={orderPipeline.total.toLocaleString()} to="/admin/marketing/orders" />
          <KeyMetricTile
            label="CPA"
            value={fmt(marketingSafe.cpa)}
            valueClassName={
              marketingSafe.cpa > 0 && marketingSafe.cpa < 5000
                ? 'text-success-600 dark:text-success-400'
                : marketingSafe.cpa > 10000
                  ? 'text-danger-600 dark:text-danger-400'
                  : undefined
            }
            to="/admin/marketing/ad-spend"
          />
          <KeyMetricTile
            label="CR"
            value={pct(marketingSafe.confirmationRate)}
            valueClassName={
              marketingSafe.confirmationRate >= 70
                ? 'text-success-600 dark:text-success-400'
                : marketingSafe.confirmationRate >= 50
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-danger-600 dark:text-danger-400'
            }
            to="/admin/marketing/orders"
          />
          <KeyMetricTile
            label="DR"
            value={pct(marketingSafe.deliveryRate)}
            valueClassName={
              marketingSafe.deliveryRate >= 70
                ? 'text-success-600 dark:text-success-400'
                : marketingSafe.deliveryRate >= 50
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-danger-600 dark:text-danger-400'
            }
            to="/admin/marketing/orders?status=DELIVERED"
          />
        </div>
      </div>

      {/* ── Quick Navigation ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickJump to="/admin/sales/queue" label="Sales Queue" />
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

/**
 * One cell in the Key Metrics grid. Renders label + value stacked vertically
 * inside a rounded chip; sits at 2-per-row on mobile and 5-per-row on desktop.
 */
function KeyMetricTile({
  label,
  value,
  valueClassName,
  to,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  to?: string;
}) {
  const inner = (
    <>
      <p className="text-mini font-medium text-app-fg-muted">{label}</p>
      <p
        className={`mt-1 text-sm sm:text-base font-bold tabular-nums leading-tight break-all ${
          valueClassName ?? 'text-app-fg'
        }`}
      >
        {value}
      </p>
    </>
  );
  if (to) {
    return (
      <Link to={to} prefetch="intent" className="rounded-lg bg-app-hover/50 px-2.5 py-2 text-center min-w-0 hover:bg-app-hover transition-colors">
        {inner}
      </Link>
    );
  }
  return (
    <div className="rounded-lg bg-app-hover/50 px-2.5 py-2 text-center min-w-0">
      {inner}
    </div>
  );
}
