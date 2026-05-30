import { Link } from '@remix-run/react';
import { confirmationRateColorClass, deliveryRateColorClass, cpaColorClass } from '~/lib/rate-color';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
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
    statusCounts: data?.orderPipeline?.statusCounts ?? {},
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
                <DateFilterBar
                    startDate={filters?.startDate ?? ''}
                    endDate={filters?.endDate ?? ''}
                    periodAllTime={filters?.periodAllTime ?? false} chrome="pill" />
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
            <Link
              to="/admin/ceo"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-500 hover:text-brand-600"
            >
              Deep Analysis
              <span aria-hidden>→</span>
            </Link>
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

      {/* ── Order Funnel: full pipeline at a glance ── */}
      {(() => {
        const sc = orderPipeline.statusCounts;
        const ordersTotal = Object.entries(sc).filter(([k]) => k !== 'DELETED').reduce((sum, [, n]) => sum + (n || 0), 0);
        const unassigned = sc['UNPROCESSED'] ?? 0;
        const assigned = sc['CS_ASSIGNED'] ?? 0;
        const unconfirmed = sc['CS_ENGAGED'] ?? 0;
        const confirmed =
          (sc['CONFIRMED'] ?? 0) +
          (sc['AGENT_ASSIGNED'] ?? 0) +
          (sc['DISPATCHED'] ?? 0) +
          (sc['IN_TRANSIT'] ?? 0);
        const delivered = (sc['DELIVERED'] ?? 0) + (sc['REMITTED'] ?? 0);
        const deleted = sc['DELETED'] ?? 0;
        return (
          <div>
            <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
              Order Funnel
            </h2>
            <OverviewStatStrip
              mobileGrid
              tileClassName="!py-2.5"
              items={[
                {
                  label: 'Total',
                  value: ordersTotal,
                  valueClassName: 'text-app-fg',
                  to: '/admin/marketing/orders',
                },
                {
                  label: 'Unassigned',
                  value: unassigned,
                  valueClassName: unassigned > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
                  to: '/admin/marketing/orders?status=UNPROCESSED',
                },
                {
                  label: 'Assigned',
                  value: assigned,
                  valueClassName: 'text-info-600 dark:text-info-400',
                  to: '/admin/marketing/orders?status=CS_ASSIGNED',
                },
                {
                  label: 'Unconfirmed',
                  value: unconfirmed,
                  valueClassName: 'text-cyan-600 dark:text-cyan-400',
                  to: '/admin/marketing/orders?status=CS_ENGAGED',
                },
                {
                  label: 'Confirmed',
                  value: confirmed,
                  valueClassName: 'text-brand-600 dark:text-brand-400',
                  to: '/admin/marketing/orders?status=CONFIRMED',
                },
                {
                  label: 'Delivered',
                  value: delivered,
                  valueClassName: 'text-success-600 dark:text-success-400',
                  to: '/admin/marketing/orders?status=DELIVERED',
                },
                {
                  label: 'CR',
                  value: pct(marketingSafe.confirmationRate),
                  valueClassName: confirmationRateColorClass(marketingSafe.confirmationRate),
                },
                {
                  label: 'DR',
                  value: pct(marketingSafe.deliveryRate),
                  valueClassName: deliveryRateColorClass(marketingSafe.deliveryRate),
                },
                {
                  label: 'Deleted',
                  value: deleted,
                  valueClassName: deleted > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg',
                  to: '/admin/marketing/orders?status=DELETED',
                },
              ]}
            />
          </div>
        );
      })()}

      {/* ── Marketing Spend ── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Marketing Spend
        </h2>
        <OverviewStatStrip
          mobileGrid
          tileClassName="!py-2.5"
          items={[
            {
              label: 'Total Ad Spend',
              value: fmt(marketingSafe.totalSpend),
              valueClassName: 'text-danger-600 dark:text-danger-400',
              title: 'Total approved ad spend in the selected period',
              to: '/admin/marketing/ad-spend',
            },
            {
              label: 'Total Orders',
              value: orderPipeline.total.toLocaleString(),
              valueClassName: 'text-app-fg',
              title: 'All orders created in the selected period',
              to: '/admin/marketing/orders',
            },
            {
              label: 'Cost Per Acquisition',
              value: fmt(marketingSafe.cpa),
              valueClassName: cpaColorClass(marketingSafe.cpa),
              title: 'Ad spend ÷ total orders',
              to: '/admin/marketing/ad-spend',
            },
          ]}
        />
      </div>

      {/* ── Revenue Generated ── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Revenue Generated
        </h2>
        <OverviewStatStrip
          mobileGrid
          tileClassName="!py-2.5"
          items={[
            {
              label: "Today's Revenue",
              value: fmt(revenueByPeriod.today),
              valueClassName: revenueByPeriod.today > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg',
              title: 'Revenue from delivered orders today',
            },
            {
              label: "This Week's Revenue",
              value: fmt(revenueByPeriod.thisWeek),
              valueClassName: revenueByPeriod.thisWeek > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg',
              title: 'Revenue from delivered orders this week (Mon–Sun)',
            },
            {
              label: "This Month's Revenue",
              value: fmt(revenueByPeriod.thisMonth),
              valueClassName: revenueByPeriod.thisMonth > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg',
              title: 'Revenue from delivered orders this month',
            },
            {
              label: 'Active Staff',
              value: activeStaffCount.toLocaleString(),
              valueClassName: 'text-app-fg',
              title: 'Total active staff across all branches',
            },
          ]}
        />
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
