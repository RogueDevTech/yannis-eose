import { useState } from 'react';
import { Link } from '@remix-run/react';
import { BranchScopedLink } from '~/components/ui/branch-scoped-link';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { confirmationRateColorClass, deliveryRateColorClass, cpaColorClass } from '~/lib/rate-color';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { FilterPills } from '~/components/ui/filter-pills';
import { formatNaira } from '~/lib/format-amount';
import { formatOrderTimestampShort } from '~/lib/format-date';
import type { DashboardData, DashboardPageData, DashboardPageProps } from './types';
import { isAdminLevel } from '~/lib/rbac';
import {
  DashboardHRSection,
  DashboardMetricsSection,
  DashboardProfitSection,
  DashboardSecondaryProvider,
  DashboardSupervisorMetricsSection,
  DashboardTotalProductsSection,
} from './dashboard-secondary-context';


const KNOWN_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HEAD_OF_CS',
  'CS_CLOSER',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'LOGISTICS_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'STOCK_MANAGER',
  'HR_MANAGER',
] as const;

export function DashboardPage({
  data,
  role,
  userName,
  filters,
  isMarketingTeamSupervisor = false,
  isCsTeamSupervisor = false,
}: DashboardPageProps) {
  const firstName = userName?.split(' ')[0] ?? 'User';
  const isKnownRole = role && KNOWN_ROLES.includes(role as (typeof KNOWN_ROLES)[number]);
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };
  const naira = (amount: number, opts?: Parameters<typeof formatNaira>[1]) => formatNaira(amount, opts);

  return (
    <DashboardSecondaryProvider filters={dateFilters}>
    <div className="space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        mobileInlineActions
        description={getRoleDescription(role)}
        actions={
          // Match the Inventory-page mobile pattern (CEO directive 2026-05-10):
          // refresh + date filter would otherwise stack and squash the greeting
          // + role description on narrow viewports. Below `md` we collapse
          // them into the kebab sheet; icon-only refresh stays beside it for
          // one-tap reload.
          <PageHeaderMobileTools
            sheetTitle="Dashboard tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Dashboard toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime ?? false} chrome="pill" />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={dateFilters.startDate}
        endDate={dateFilters.endDate}
        periodAllTime={dateFilters.periodAllTime ?? false}
      />

      {/* Missing role: minimal welcome (safer than defaulting to SuperAdmin) */}
      {!role && <GenericFallbackDashboard />}

      {/* Role-specific dashboard */}
      {role && isAdminLevel({ role }) && <SuperAdminDashboard data={data} naira={naira} />}
      {(role === 'HEAD_OF_CS' || role === 'CS_CLOSER') && (
        <CSDashboard data={data} role={role} isCsTeamSupervisor={isCsTeamSupervisor} />
      )}
      {(role === 'HEAD_OF_MARKETING' || role === 'MEDIA_BUYER') && (
        <MarketingDashboard
          data={data}
          role={role}
          naira={naira}
          isMarketingTeamSupervisor={isMarketingTeamSupervisor}
        />
      )}
      {(role === 'FINANCE_OFFICER') && <FinanceDashboard data={data} naira={naira} />}
      {(role === 'HEAD_OF_LOGISTICS' || role === 'LOGISTICS_MANAGER' || role === 'TPL_MANAGER' || role === 'TPL_RIDER') && <LogisticsDashboard data={data} role={role} />}
      {(role === 'STOCK_MANAGER') && <WarehouseDashboard data={data} />}
      {(role === 'HR_MANAGER') && <HRDashboard naira={naira} />}

      {/* Unknown role: generic fallback */}
      {role && !isKnownRole && <GenericFallbackDashboard />}
    </div>
    </DashboardSecondaryProvider>
  );
}

function DualCardSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card animate-pulse min-h-[11rem] bg-app-hover/40" />
      <div className="card animate-pulse min-h-[11rem] bg-app-hover/40" />
    </div>
  );
}

// ── Helper functions ─────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getRoleDescription(role: string | null) {
  if (!role) return 'Welcome. Please sign in again if you see this.';
  const descriptions: Record<string, string> = {
    SUPER_ADMIN: "Here's your full platform overview.",
    HEAD_OF_CS: 'Your Sales team performance at a glance.',
    CS_CLOSER: 'Your personal queue and performance.',
    HEAD_OF_MARKETING: 'Marketing performance and team metrics.',
    MEDIA_BUYER: 'Your campaign performance and payouts.',
    FINANCE_OFFICER: 'Financial overview and pending approvals.',
    HEAD_OF_LOGISTICS: 'Logistics operations and delivery metrics.',
    LOGISTICS_MANAGER: 'Your location operations overview.',
    TPL_MANAGER: 'Your 3PL location stock and deliveries.',
    TPL_RIDER: 'Your assigned deliveries for today.',
    STOCK_MANAGER: 'Stock levels and inventory movements.',
    HR_MANAGER: 'Payroll overview and pending actions.',
  };
  return descriptions[role] ?? "Here's an overview of your business.";
}

// ── Generic Fallback (missing/unknown role) ──────────────

function GenericFallbackDashboard() {
  return (
    <div className="card">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-app-hover flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-app-fg mb-2">Welcome</h2>
        <p className="text-sm text-app-fg-muted mb-6 max-w-sm">
          Use the sidebar to navigate to your modules, or visit settings to manage your account.
        </p>
        <Link
          to="/admin/settings"
          prefetch="intent"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          Settings
        </Link>
      </div>
    </div>
  );
}

// ── SuperAdmin Dashboard ─────────────────────────────────

function SuperAdminDashboard({ data, naira }: { data: DashboardPageData; naira: (amount: number, opts?: Parameters<typeof formatNaira>[1]) => string }) {
  const counts = data.orderCounts as Record<string, number>;
  const unprocessed = counts['UNPROCESSED'] ?? 0;
  const confirmed = counts['CONFIRMED'] ?? 0;

  return (
    <>
      <DashboardProfitSection fallback={<OverviewStatStripSkeleton count={4} />}>
        {(profit) => (
          <OverviewStatStrip
            mobileGrid
            items={[
              { label: 'Revenue', value: naira(Math.round(profit.revenue)), valueClassName: 'text-app-fg' },
              {
                label: 'True Profit',
                value: naira(Math.round(profit.trueProfit)),
                valueClassName:
                  profit.trueProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400',
              },
              { label: 'Orders', value: data.totalOrders.toString(), valueClassName: 'text-app-fg' },
              {
                label: 'Unprocessed',
                value: unprocessed.toString(),
                valueClassName:
                  unprocessed > 10 ? 'text-danger-600 dark:text-danger-400' : unprocessed > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
              },
            ]}
          />
        )}
      </DashboardProfitSection>

      {/* Awaiting logistics assignment alert */}
      {confirmed > 0 && (
        <div className="card border-warning-200 dark:border-warning-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-warning-50 dark:bg-warning-700/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-app-fg">
                  {confirmed} {confirmed === 1 ? 'order' : 'orders'} awaiting logistics assignment
                </h3>
                <p className="text-sm text-app-fg-muted">
                  Confirmed orders need a logistics location assignment before dispatch.
                </p>
              </div>
            </div>
            <Link to="/admin/logistics/orders" prefetch="intent" className="btn-primary btn-sm shrink-0">
              Assign
            </Link>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold text-app-fg mb-4">Order Pipeline</h2>
        <OverviewStatStrip
          mobileGrid
          embedded
          tileClassName="min-w-[5.5rem]"
          items={[
            { label: 'Unassigned', value: counts['UNPROCESSED'] ?? 0, valueClassName: 'text-warning-600 dark:text-warning-400' },
            { label: 'Assigned', value: counts['CS_ASSIGNED'] ?? 0, valueClassName: 'text-info-600 dark:text-info-400' },
            { label: 'Unconfirmed', value: counts['CS_ENGAGED'] ?? 0, valueClassName: 'text-cyan-600 dark:text-cyan-400' },
            // Confirmed rolls up CONFIRMED + the in-flight logistics sub-stages
            // (AGENT_ASSIGNED / DISPATCHED / IN_TRANSIT) so this matches the
            // OrderStatusBadge default. Logistics-specific dashboards keep the
            // sub-stage tiles where ops actually need them.
            {
              label: 'Confirmed',
              value:
                (counts['CONFIRMED'] ?? 0) +
                (counts['AGENT_ASSIGNED'] ?? 0) +
                (counts['DISPATCHED'] ?? 0) +
                (counts['IN_TRANSIT'] ?? 0),
              valueClassName: 'text-brand-600 dark:text-brand-400',
            },
            { label: 'Delivered', value: counts['DELIVERED'] ?? 0, valueClassName: 'text-success-600 dark:text-success-400' },
            { label: 'Cash Remitted', value: counts['REMITTED'] ?? 0, valueClassName: 'text-green-600 dark:text-green-400' },
            { label: 'Deleted', value: counts['DELETED'] ?? 0, valueClassName: 'text-danger-600 dark:text-danger-400' },
            { label: 'Returned', value: counts['RETURNED'] ?? 0, valueClassName: 'text-danger-600 dark:text-danger-400' },
          ]}
        />
      </div>

      {/* Recent Orders + Quick Actions — immediate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RecentOrdersCard orders={data.recentOrders} />
        </div>
        <QuickActionsCard role="SUPER_ADMIN" unprocessed={unprocessed} />
      </div>
    </>
  );
}

// ── Sales Dashboard ─────────────────────────────────────────

function CSDashboard({
  data,
  role,
  isCsTeamSupervisor = false,
}: {
  data: DashboardPageData;
  role: string;
  /** When the viewer is a Sales Closer who supervises the branch's Sales team,
   *  render the HoCS-style "Team Management" card AND switch the layout
   *  from the lean closer-only view to the operational HoCS view. Metric
   *  tiles already reflect team-aggregated scope (the API auto-applies
   *  supervisorScope via the orders.ts helper). */
  isCsTeamSupervisor?: boolean;
}) {
  const showsTeamManagementCard = role === 'HEAD_OF_CS' || isCsTeamSupervisor;
  const counts = data.orderCounts as Record<string, number>;
  // `pendingQueue` rolls UNPROCESSED + CS_ASSIGNED into one waiting-on-engagement
  // bucket for the top stat strip. Deeper per-status breakdown lives on
  // `/admin/sales/orders` via the status filter.
  const unprocessed = counts['UNPROCESSED'] ?? 0;
  const csAssigned = counts['CS_ASSIGNED'] ?? 0;
  const engaged = counts['CS_ENGAGED'] ?? 0;
  const pendingQueue = unprocessed + csAssigned;

  // Sales Closers get the lean MB-style dashboard: stats strip + Performance Summary | Quick Actions.
  // No Order Pipeline (they don't manage flow), no Recent Orders feed (they have a dedicated
  // queue/orders page) — keeps the landing page fast and focused on the metrics they care
  // about: their own confirmation/delivery performance.
  // EXCEPT: a Sales Closer who's been promoted to supervise their team falls through to the
  // operational HoCS-style view below — same Pipeline / Team Management / metrics as HoCS,
  // scoped to their team via `applySupervisorScope`.
  if (role === 'CS_CLOSER' && !isCsTeamSupervisor) {
    return (
      <>
        <DashboardMetricsSection fallback={<OverviewStatStripSkeleton count={7} />}>
          {(metrics) => (
            <OverviewStatStrip
              mobileGrid
              tileClassName="min-w-[6rem]"
              items={[
                { label: 'Total', value: metrics.totalOrders.toString(), valueClassName: 'text-app-fg' },
                {
                  label: 'Pending Queue',
                  value: pendingQueue.toString(),
                  valueClassName:
                    pendingQueue > 20 ? 'text-danger-600 dark:text-danger-400' : pendingQueue > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400',
                },
                { label: 'Currently Engaged', value: engaged.toString(), valueClassName: 'text-app-fg' },
                { label: 'Confirmed', value: metrics.confirmedOrders.toString(), valueClassName: 'text-success-600 dark:text-success-400' },
                {
                  label: 'Delivered',
                  value: metrics.deliveredOrders.toString(),
                  valueClassName:
                    metrics.deliveredOrders > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg',
                },
                {
                  label: 'Confirmation Rate',
                  value: `${metrics.confirmationRate.toFixed(1)}%`,
                  valueClassName: confirmationRateColorClass(metrics.confirmationRate),
                },
                {
                  label: 'Delivery Rate',
                  value: `${metrics.deliveryRate.toFixed(1)}%`,
                  valueClassName: deliveryRateColorClass(metrics.deliveryRate),
                },
              ]}
            />
          )}
        </DashboardMetricsSection>

        <DashboardMetricsSection fallback={<DualCardSkeleton />}>
          {(metrics) => (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card">
                <h2 className="text-lg font-semibold text-app-fg mb-4">Performance Summary</h2>
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Total Orders</span><span className="text-sm font-medium text-app-fg">{metrics.totalOrders}</span></div>
                  <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Confirmed</span><span className="text-sm font-medium text-success-600 dark:text-success-400">{metrics.confirmedOrders}</span></div>
                  <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Delivered</span><span className="text-sm font-medium text-success-600 dark:text-success-400">{metrics.deliveredOrders}</span></div>
                  <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Conf. Rate</span><span className="text-sm font-medium text-app-fg">{metrics.confirmationRate.toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Delivery Rate</span><span className="text-sm font-medium text-app-fg">{metrics.deliveryRate.toFixed(1)}%</span></div>
                </div>
              </div>

              <QuickActionsCard role={role} unprocessed={pendingQueue} />
            </div>
          )}
        </DashboardMetricsSection>
      </>
    );
  }

  // Head of CS: KPI strip + team controls + quick links (no full pipeline strip).
  return (
    <>
      <DashboardMetricsSection fallback={<OverviewStatStripSkeleton count={6} />}>
        {(metrics) => (
          <OverviewStatStrip
            mobileGrid
            tileClassName="min-w-[6rem]"
            items={[
              { label: 'Total Orders', value: metrics.totalOrders.toString(), valueClassName: 'text-app-fg' },
              {
                label: 'Pending Queue',
                value: pendingQueue.toString(),
                valueClassName:
                  pendingQueue > 20 ? 'text-danger-600 dark:text-danger-400' : pendingQueue > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400',
              },
              { label: 'Currently Engaged', value: engaged.toString(), valueClassName: 'text-app-fg' },
              // Confirmed = cohort count (confirmed-or-beyond, by createdAt). Live
              // `counts['CONFIRMED']` only counts orders sitting in CONFIRMED right
              // now — almost always 0 once they advance to AGENT_ASSIGNED → DELIVERED.
              { label: 'Confirmed', value: metrics.confirmedOrders.toString(), valueClassName: 'text-success-600 dark:text-success-400' },
              {
                label: 'Delivered',
                value: metrics.deliveredOrders.toString(),
                valueClassName:
                  metrics.deliveredOrders > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg',
              },
              {
                label: 'Delivery Rate',
                value: `${metrics.deliveryRate.toFixed(1)}%`,
                valueClassName: deliveryRateColorClass(metrics.deliveryRate),
              },
            ]}
          />
        )}
      </DashboardMetricsSection>

      {/* Order Pipeline strip retired 2026-05-03 — the KPI row above (queue health +
          period Delivered + Delivery Rate) is the at-a-glance row for Head of CS.
          Live-bucket `Confirmed` is current CONFIRMED count; `Delivered` / rate use
          the selected date range from `marketing.metrics`. Per-status counts remain
          on `/admin/sales/orders` via the status filter pills. */}

      {showsTeamManagementCard && (
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-2">Team Management</h2>
          <p className="text-sm text-app-fg-muted mb-4">
            {role === 'HEAD_OF_CS'
              ? 'Manage agent assignments and monitor queue health.'
              : "Monitor your team's pipeline — metrics above aggregate across every closer you supervise on this branch."}
          </p>
          <div className="flex gap-2 flex-wrap">
            <Link to="/admin/sales/queue" prefetch="intent" className="btn-primary btn-sm">Sales Dashboard</Link>
            <Link to="/admin/sales/orders" prefetch="intent" className="btn-secondary btn-sm">View All Orders</Link>
            {/* Team Analysis is HoCS-style team performance — supervisors get the same lens. */}
            <Link to="/admin/sales/team" prefetch="intent" className="btn-secondary btn-sm">Team Analysis</Link>
          </div>
        </div>
      )}

      {/* Quick links is HoCS-only — Approvals + Notifications are privileged
          surfaces a CS-team supervisor doesn't manage even when they own a
          team. (Team Performance + Leaderboard are reachable via the Team
          Management card above for supervisors.) */}
      {role === 'HEAD_OF_CS' && (
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-2">Quick links</h2>
          <p className="text-sm text-app-fg-muted mb-4">
            Jump to the surfaces you use day-to-day.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Link to="/admin/sales/team" prefetch="intent" className="rounded-lg border border-app-border p-3 hover:bg-app-hover/50 transition-colors">
              <p className="text-sm font-semibold text-app-fg">Team performance</p>
              <p className="text-xs text-app-fg-muted mt-0.5">Confirm + delivery rates per agent</p>
            </Link>
            <Link to="/admin/sales/leaderboard" prefetch="intent" className="rounded-lg border border-app-border p-3 hover:bg-app-hover/50 transition-colors">
              <p className="text-sm font-semibold text-app-fg">Leaderboard</p>
              <p className="text-xs text-app-fg-muted mt-0.5">Top closers this period</p>
            </Link>
            <Link to="/admin/permission-requests" prefetch="intent" className="rounded-lg border border-app-border p-3 hover:bg-app-hover/50 transition-colors">
              <p className="text-sm font-semibold text-app-fg">Approvals</p>
              <p className="text-xs text-app-fg-muted mt-0.5">Price changes, deletions, etc.</p>
            </Link>
            <Link to="/admin/notifications" prefetch="intent" className="rounded-lg border border-app-border p-3 hover:bg-app-hover/50 transition-colors">
              <p className="text-sm font-semibold text-app-fg">Notifications</p>
              <p className="text-xs text-app-fg-muted mt-0.5">Broadcasts, automations, log</p>
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

// ── Marketing Dashboard ──────────────────────────────────

function MarketingMetricsStrip({ metrics, naira, abandonedCartCount = 0 }: { metrics: DashboardData['metrics']; naira: (amount: number) => string; abandonedCartCount?: number }) {
  return (
    <OverviewStatStrip
      mobileGrid
      tileClassName="min-w-[6rem]"
      items={[
        { label: 'Total Orders', value: metrics.totalOrders.toString(), valueClassName: 'text-app-fg', to: '/admin/marketing/orders' },
        {
          label: 'Delivered',
          value: metrics.deliveredOrders.toString(),
          valueClassName: metrics.deliveredOrders > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg',
          to: '/admin/marketing/orders?status=DELIVERED',
        },
        { label: 'CPA', value: naira(Math.round(metrics.cpa)), valueClassName: cpaColorClass(metrics.cpa), to: '/admin/marketing/ad-spend' },
        {
          label: 'True ROAS',
          value: `${metrics.trueRoas.toFixed(2)}x`,
          valueClassName: metrics.trueRoas >= 2 ? 'text-success-600 dark:text-success-400' : metrics.trueRoas >= 1 ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400',
          to: '/admin/marketing/overview',
        },
        {
          label: 'Delivery Rate',
          value: `${metrics.deliveryRate.toFixed(1)}%`,
          valueClassName: deliveryRateColorClass(metrics.deliveryRate),
          to: '/admin/marketing/orders?status=DELIVERED',
        },
        {
          label: 'Confirmation Rate',
          value: `${metrics.confirmationRate.toFixed(1)}%`,
          valueClassName: confirmationRateColorClass(metrics.confirmationRate),
          to: '/admin/marketing/orders?status=CONFIRMED',
        },
        {
          label: 'Open carts',
          value: abandonedCartCount.toString(),
          valueClassName: abandonedCartCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-app-fg',
          title: 'Captured carts not yet recovered (browsing + dropped off)',
          to: '/admin/marketing/orders?fromCart=1',
        },
        { label: 'Total Spend', value: naira(Math.round(metrics.totalSpend)), valueClassName: 'text-app-fg', to: '/admin/marketing/ad-spend' },
      ]}
    />
  );
}

function MarketingPerformanceSummary({ metrics, naira }: { metrics: DashboardData['metrics']; naira: (amount: number) => string }) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-app-fg mb-4">Performance Summary</h2>
      <div className="space-y-3">
        <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Total Orders</span><span className="text-sm font-medium text-app-fg">{metrics.totalOrders}</span></div>
        <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Delivered</span><span className="text-sm font-medium text-success-600 dark:text-success-400">{metrics.deliveredOrders}</span></div>
        <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Confirmed</span><span className="text-sm font-medium text-success-600 dark:text-success-400">{metrics.confirmedOrders}</span></div>
        <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Conf. Rate</span><span className="text-sm font-medium text-app-fg">{metrics.confirmationRate.toFixed(1)}%</span></div>
        <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Delivered Revenue</span><span className="text-sm font-medium text-app-fg">{naira(Math.round(metrics.deliveredRevenue))}</span></div>
      </div>
    </div>
  );
}

function MarketingDashboard({
  data,
  role,
  naira,
  isMarketingTeamSupervisor = false,
}: {
  data: DashboardPageData;
  role: string;
  naira: (amount: number, opts?: Parameters<typeof formatNaira>[1]) => string;
  isMarketingTeamSupervisor?: boolean;
}) {
  const isHeadOfMarketing = role === 'HEAD_OF_MARKETING';
  const showsTeamManagementCard = isHeadOfMarketing || isMarketingTeamSupervisor;
  // Only MB-supervisors get the personal/team toggle — HoM IS the team, so their
  // "personal" metrics are the branch-wide view (no separate funnel to show).
  const showsPersonalToggle = isMarketingTeamSupervisor && !isHeadOfMarketing;
  const showsSupervisorLayout = isHeadOfMarketing || isMarketingTeamSupervisor;
  const [viewTab, setViewTab] = useState<'personal' | 'team'>('team');

  // MB-Supervisor with personal/team toggle
  if (showsPersonalToggle) {
    return (
      <>
        <FilterPills
          variant="tab"
          options={[
            { label: 'My Performance', value: 'personal' },
            { label: 'Team', value: 'team' },
          ]}
          value={viewTab}
          onChange={(v) => setViewTab(v as 'personal' | 'team')}
        />

        <DashboardSupervisorMetricsSection fallback={<OverviewStatStripSkeleton count={8} />}>
          {(teamMetrics, personalMetrics, abandonedCartCount) => {
            const active = viewTab === 'personal' ? (personalMetrics ?? teamMetrics) : teamMetrics;
            return <MarketingMetricsStrip metrics={active} naira={(a) => naira(a)} abandonedCartCount={abandonedCartCount} />;
          }}
        </DashboardSupervisorMetricsSection>

        {viewTab === 'team' && (
          <div className="card">
            <h2 className="text-lg font-semibold text-app-fg mb-2">Team Management</h2>
            <p className="text-sm text-app-fg-muted mb-4">
              Monitor your team's performance — metrics above aggregate across every buyer you supervise on this branch.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/admin/marketing/overview" prefetch="intent" className="btn-primary btn-sm">Live Activities</Link>
              <Link to="/admin/marketing/team" prefetch="intent" className="btn-secondary btn-sm">Team Analysis</Link>
              <Link to="/admin/marketing/leaderboard" prefetch="intent" className="btn-secondary btn-sm">Leaderboard</Link>
            </div>
          </div>
        )}

        <DashboardSupervisorMetricsSection fallback={<DualCardSkeleton />}>
          {(teamMetrics, personalMetrics) => {
            const active = viewTab === 'personal' ? (personalMetrics ?? teamMetrics) : teamMetrics;
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <MarketingPerformanceSummary metrics={active} naira={(a) => naira(a)} />
                <QuickActionsCard role={role} unprocessed={0} />
              </div>
            );
          }}
        </DashboardSupervisorMetricsSection>
      </>
    );
  }

  // HoM: single branch-wide view with team management card (no personal toggle)
  if (isHeadOfMarketing) {
    return (
      <>
        <DashboardMetricsSection fallback={<OverviewStatStripSkeleton count={8} />}>
          {(metrics, abandonedCartCount) => <MarketingMetricsStrip metrics={metrics} naira={(a) => naira(a)} abandonedCartCount={abandonedCartCount} />}
        </DashboardMetricsSection>

        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-2">Team Management</h2>
          <p className="text-sm text-app-fg-muted mb-4">
            Branch-wide performance — metrics above aggregate across all media buyers in your branch.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/marketing/overview" prefetch="intent" className="btn-primary btn-sm">Live Activities</Link>
            <Link to="/admin/marketing/team" prefetch="intent" className="btn-secondary btn-sm">Team Analysis</Link>
            <Link to="/admin/marketing/funding" prefetch="intent" className="btn-secondary btn-sm">Funding</Link>
            <Link to="/admin/marketing/ad-spend" prefetch="intent" className="btn-secondary btn-sm">Ad spend</Link>
            <Link to="/admin/marketing/leaderboard" prefetch="intent" className="btn-secondary btn-sm">Leaderboard</Link>
          </div>
        </div>

        <DashboardMetricsSection fallback={<DualCardSkeleton />}>
          {(metrics) => (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MarketingPerformanceSummary metrics={metrics} naira={(a) => naira(a)} />
              <QuickActionsCard role={role} unprocessed={0} />
            </div>
          )}
        </DashboardMetricsSection>
      </>
    );
  }

  // Non-supervisor MB: original layout
  return (
    <>
      <DashboardMetricsSection fallback={<OverviewStatStripSkeleton count={8} />}>
        {(metrics, abandonedCartCount) => <MarketingMetricsStrip metrics={metrics} naira={(a) => naira(a)} abandonedCartCount={abandonedCartCount} />}
      </DashboardMetricsSection>

      {showsTeamManagementCard && (
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-2">Team Management</h2>
          <p className="text-sm text-app-fg-muted mb-4">
            Manage media buyers and monitor team performance.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/marketing/overview" prefetch="intent" className="btn-primary btn-sm">Live Activities</Link>
            <Link to="/admin/marketing/team" prefetch="intent" className="btn-secondary btn-sm">Team Analysis</Link>
            {role === 'HEAD_OF_MARKETING' && (
              <>
                <Link to="/admin/marketing/funding" prefetch="intent" className="btn-secondary btn-sm">Funding</Link>
                <Link to="/admin/marketing/ad-spend" prefetch="intent" className="btn-secondary btn-sm">Ad spend</Link>
              </>
            )}
            <Link to="/admin/marketing/leaderboard" prefetch="intent" className="btn-secondary btn-sm">Leaderboard</Link>
          </div>
        </div>
      )}

      <DashboardMetricsSection fallback={<DualCardSkeleton />}>
        {(metrics) => (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MarketingPerformanceSummary metrics={metrics} naira={(a) => naira(a)} />
            <QuickActionsCard role={role} unprocessed={0} />
          </div>
        )}
      </DashboardMetricsSection>
    </>
  );
}

// ── Finance Dashboard ────────────────────────────────────

function FinanceDashboard({ data, naira }: { data: DashboardPageData; naira: (amount: number, opts?: Parameters<typeof formatNaira>[1]) => string }) {
  return (
    <>
      <DashboardProfitSection fallback={<OverviewStatStripSkeleton count={4} />}>
        {(profit) => {
          const totalCosts = profit.landedCost + profit.deliveryFee + profit.adSpend + profit.commission + profit.fulfillmentCost + profit.operationalLoss;
          return (
            <>
              <OverviewStatStrip
                mobileGrid
                items={[
                  { label: 'Revenue', value: naira(Math.round(profit.revenue)), valueClassName: 'text-app-fg' },
                  {
                    label: 'True Profit',
                    value: naira(Math.round(profit.trueProfit)),
                    valueClassName:
                      profit.trueProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400',
                  },
                  {
                    label: 'Net Margin',
                    value: `${profit.margin.toFixed(1)}%`,
                    valueClassName:
                      profit.margin >= 20
                        ? 'text-success-600 dark:text-success-400'
                        : profit.margin > 0
                          ? 'text-warning-600 dark:text-warning-400'
                          : 'text-danger-600 dark:text-danger-400',
                  },
                  { label: 'Total Costs', value: naira(Math.round(totalCosts)), valueClassName: 'text-danger-600 dark:text-danger-400' },
                ]}
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
                <div className="card">
                  <h2 className="text-lg font-semibold text-app-fg mb-4">Cost Breakdown</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Landed COGS</span><span className="text-sm font-medium text-app-fg">{naira(Math.round(profit.landedCost))}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Delivery Fees</span><span className="text-sm font-medium text-app-fg">{naira(Math.round(profit.deliveryFee))}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Ad Spend</span><span className="text-sm font-medium text-app-fg">{naira(Math.round(profit.adSpend))}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Commission</span><span className="text-sm font-medium text-app-fg">{naira(Math.round(profit.commission))}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Fulfillment</span><span className="text-sm font-medium text-app-fg">{naira(Math.round(profit.fulfillmentCost))}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Operational Loss</span><span className="text-sm font-medium text-app-fg">{naira(Math.round(profit.operationalLoss))}</span></div>
                    <div className="pt-2 border-t border-app-border flex justify-between">
                      <span className="text-sm font-semibold text-app-fg">True Profit</span>
                      <span className={`text-sm font-bold ${profit.trueProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                        {naira(Math.round(profit.trueProfit))}
                      </span>
                    </div>
                  </div>
                </div>
                <QuickActionsCard role="FINANCE_OFFICER" unprocessed={0} />
              </div>
            </>
          );
        }}
      </DashboardProfitSection>
    </>
  );
}

// ── Logistics Dashboard ──────────────────────────────────

function LogisticsDashboard({ data, role }: { data: DashboardPageData; role: string }) {
  const counts = data.orderCounts as Record<string, number>;
  const confirmed = counts['CONFIRMED'] ?? 0;
  const allocated = counts['AGENT_ASSIGNED'] ?? 0;
  const dispatched = counts['DISPATCHED'] ?? 0;
  const inTransit = counts['IN_TRANSIT'] ?? 0;
  const delivered = (counts['DELIVERED'] ?? 0) + (counts['REMITTED'] ?? 0);

  return (
    <>
      <OverviewStatStrip
        mobileGrid
        tileClassName="min-w-[6rem]"
        items={[
          {
            label: 'Awaiting logistics assignment',
            value: confirmed.toString(),
            valueClassName: confirmed > 10 ? 'text-danger-600 dark:text-danger-400' : confirmed > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
          },
          { label: 'Agent assigned', value: allocated.toString(), valueClassName: 'text-app-fg' },
          { label: 'Dispatched', value: dispatched.toString(), valueClassName: 'text-warning-600 dark:text-warning-400' },
          { label: 'In Transit', value: inTransit.toString(), valueClassName: 'text-app-fg' },
          { label: 'Delivered', value: delivered.toString(), valueClassName: 'text-success-600 dark:text-success-400' },
        ]}
      />

      {confirmed > 0 && (
        <div className="card border-warning-200 dark:border-warning-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-warning-50 dark:bg-warning-700/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-app-fg">
                  {confirmed} {confirmed === 1 ? 'order' : 'orders'} awaiting logistics assignment
                </h3>
                <p className="text-sm text-app-fg-muted">
                  Confirmed orders need a logistics location assignment before dispatch.
                </p>
              </div>
            </div>
            <Link to="/admin/logistics/orders" prefetch="intent" className="btn-primary btn-sm shrink-0">
              Assign
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-4">Delivery Pipeline</h2>
          <div className="space-y-3">
            <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Awaiting logistics assignment</span><span className={`text-sm font-medium ${confirmed > 0 ? 'text-warning-600 dark:text-warning-400' : ''}`}>{confirmed}</span></div>
            <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Ready for dispatch</span><span className="text-sm font-medium">{allocated}</span></div>
            <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Active Deliveries</span><span className="text-sm font-medium">{inTransit}</span></div>
            <div className="flex justify-between"><span className="text-sm text-app-fg-muted">Returns Queue</span><span className="text-sm font-medium text-danger-600 dark:text-danger-400">{counts['RETURNED'] ?? 0}</span></div>
          </div>
        </div>
        <QuickActionsCard role={role} unprocessed={0} />
      </div>
    </>
  );
}

// ── Warehouse Dashboard ──────────────────────────────────

function WarehouseDashboard({ data }: { data: DashboardPageData }) {
  return (
    <>
      <DashboardTotalProductsSection fallback={<OverviewStatStripSkeleton count={4} />}>
        {(total) => (
          <OverviewStatStrip
            mobileGrid
            items={[
              { label: 'Products', value: total.toString(), valueClassName: 'text-app-fg' },
              { label: 'Total Orders', value: data.totalOrders.toString(), valueClassName: 'text-app-fg' },
              {
                label: 'Delivered',
                value: (((data.orderCounts as Record<string, number>)['DELIVERED'] ?? 0) + ((data.orderCounts as Record<string, number>)['REMITTED'] ?? 0)).toString(),
                valueClassName: 'text-success-600 dark:text-success-400',
              },
              {
                label: 'Returns',
                value: ((data.orderCounts as Record<string, number>)['RETURNED'] ?? 0).toString(),
                valueClassName: 'text-danger-600 dark:text-danger-400',
              },
            ]}
          />
        )}
      </DashboardTotalProductsSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-2">Inventory Management</h2>
          <p className="text-sm text-app-fg-muted mb-4">
            Monitor stock levels, process intakes, and manage transfers.
          </p>
          <div className="flex gap-2">
            <Link to="/admin/inventory" prefetch="intent" className="btn-primary btn-sm">View Inventory</Link>
            <Link to="/admin/transfers" prefetch="intent" className="btn-secondary btn-sm">Transfers</Link>
            <Link to="/admin/inventory" prefetch="intent" className="btn-secondary btn-sm">Reconciliation</Link>
          </div>
        </div>
        <QuickActionsCard role="STOCK_MANAGER" unprocessed={0} />
      </div>
    </>
  );
}

// ── HR Dashboard ─────────────────────────────────────────

function HRDashboard({ naira }: { naira: (amount: number, opts?: Parameters<typeof formatNaira>[1]) => string }) {
  return (
    <DashboardHRSection fallback={<OverviewStatStripSkeleton count={4} />}>
      {({ payoutSummary: summary, totalUsers: total }) => {
        const draftTotal = Number(summary['DRAFT']?.total ?? 0);
        const approvedTotal = Number(summary['APPROVED']?.total ?? 0);
        const paidTotal = Number(summary['PAID']?.total ?? 0);

        return (
          <>
            <OverviewStatStrip
              mobileGrid
              items={[
                {
                  label: 'Draft Payouts',
                  value: naira(draftTotal),
                  valueClassName: draftTotal > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
                },
                { label: 'Approved', value: naira(approvedTotal), valueClassName: 'text-app-fg' },
                { label: 'Paid', value: naira(paidTotal), valueClassName: 'text-success-600 dark:text-success-400' },
                { label: 'Staff', value: total.toString(), valueClassName: 'text-app-fg' },
              ]}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
              <div className="card">
                <h2 className="text-lg font-semibold text-app-fg mb-2">Payroll Actions</h2>
                <p className="text-sm text-app-fg-muted mb-4">
                  Generate payouts, manage commission plans, and process adjustments.
                </p>
                <div className="flex gap-2">
                  <Link to="/hr/payroll" prefetch="intent" className="btn-primary btn-sm">HR & Payroll</Link>
                  <Link to="/hr/users" prefetch="intent" className="btn-secondary btn-sm">Staff Directory</Link>
                </div>
              </div>

              {draftTotal > 0 && (
                <div className="card border-warning-200 dark:border-warning-700/50">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-warning-50 dark:bg-warning-700/20 flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-fg">Pending Approval</h3>
                      <p className="text-sm text-app-fg-muted mt-1">
                        {summary['DRAFT']?.count ?? 0} draft payouts totaling {naira(draftTotal)} awaiting review.
                      </p>
                      <Link to="/hr/payroll" prefetch="intent" className="text-sm text-brand-500 hover:text-brand-600 font-medium mt-2 inline-block">
                        Review payouts →
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        );
      }}
    </DashboardHRSection>
  );
}

// ── Shared Components ────────────────────────────────────

function RecentOrdersCard({ orders }: { orders: DashboardData['recentOrders'] }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-app-fg">Recent Orders</h2>
        <Link to="/admin/sales/orders" prefetch="intent" className="text-sm text-brand-500 hover:text-brand-600 font-medium">View All</Link>
      </div>
      {orders.length > 0 ? (
        <div className="space-y-2">
          {orders.map((order) => (
            <Link
              key={order.id}
              to={`/admin/orders/${order.id}`}
              prefetch="intent"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-app-hover/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-app-fg truncate">{order.customerName}</p>
                <p className="text-sm text-app-fg-muted">
                  {formatOrderTimestampShort(order.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3 ml-3">
                {order.totalAmount && (
                  <span className="text-sm font-medium text-app-fg">
                    {formatNaira(Number(order.totalAmount))}
                  </span>
                )}
                <OrderStatusBadge status={order.status} />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-32 text-app-fg-muted text-sm">No orders yet</div>
      )}
    </div>
  );
}

function QuickActionsCard({ role, unprocessed }: { role: string; unprocessed: number }) {
  const actions = getQuickActions(role, unprocessed);
  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-app-fg mb-4">Quick Actions</h2>
      <div className="space-y-2">
        {actions.map((action) => (
          // Drop-in BranchScopedLink — for admin-class users (the only role that
          // currently lands `Add Staff` here) the modal never fires, but if a
          // future quick action targets a branch-scoped route this guards it.
          <BranchScopedLink
            key={action.href}
            to={action.href}
            actionLabel={action.label.toLowerCase()}
            prefetch="intent"
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-app-hover/50 transition-colors"
          >
            <div className={`w-9 h-9 rounded-lg ${action.bg} flex items-center justify-center`}>
              <ActionIcon type={action.icon} />
            </div>
            <div>
              <p className="text-sm font-medium text-app-fg">{action.label}</p>
              <p className="text-sm text-app-fg-muted">{action.description}</p>
            </div>
          </BranchScopedLink>
        ))}
      </div>
    </div>
  );
}

function getQuickActions(role: string, unprocessed: number) {
  const common = [
    { href: '/admin/sales/orders', label: 'View Orders', description: unprocessed > 0 ? `${unprocessed} unprocessed` : 'All orders', icon: 'orders', bg: 'bg-warning-50 dark:bg-warning-700/20 text-warning-600 dark:text-warning-400' },
  ];

  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return [
        { href: '/admin/products/new', label: 'Add Product', description: 'Create a new product', icon: 'add', bg: 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400' },
        { href: '/hr/users/new', label: 'Add Staff', description: 'Invite a team member', icon: 'users', bg: 'bg-success-50 dark:bg-success-700/20 text-success-600 dark:text-success-400' },
        ...common,
        { href: '/admin/finance/overview', label: 'Finance', description: 'True profit reports', icon: 'revenue', bg: 'bg-info-50 dark:bg-info-700/20 text-info-600 dark:text-info-400' },
      ];
    case 'HEAD_OF_MARKETING':
    case 'MEDIA_BUYER':
      return [
        { href: '/admin/marketing/funding', label: 'Funding', description: 'Ledger & requests', icon: 'revenue', bg: 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400' },
        { href: '/admin/marketing/ad-spend', label: 'Ad spend', description: 'Log & approve spend', icon: 'revenue', bg: 'bg-info-50 dark:bg-info-700/20 text-info-600 dark:text-info-400' },
        { href: '/admin/marketing/forms', label: 'Forms', description: 'Manage forms', icon: 'orders', bg: 'bg-app-hover text-app-fg-muted' },
      ];
    case 'CS_CLOSER':
      return [
        { href: '/admin/sales/queue', label: 'Live Queue', description: unprocessed > 0 ? `${unprocessed} pending` : 'Take new orders', icon: 'pending', bg: 'bg-warning-50 dark:bg-warning-700/20 text-warning-600 dark:text-warning-400' },
        { href: '/admin/sales/orders', label: 'My Orders', description: 'Orders assigned to you', icon: 'orders', bg: 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400' },
        { href: '/admin/sales/leaderboard', label: 'Leaderboard', description: 'See your ranking', icon: 'revenue', bg: 'bg-info-50 dark:bg-info-700/20 text-info-600 dark:text-info-400' },
      ];
    case 'FINANCE_OFFICER':
      return [
        { href: '/admin/finance/overview', label: 'Finance', description: 'Profit & invoices', icon: 'revenue', bg: 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400' },
        ...common,
      ];
    case 'STOCK_MANAGER':
      return [
        { href: '/admin/inventory', label: 'Inventory', description: 'Stock levels', icon: 'products', bg: 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400' },
        { href: '/admin/transfers', label: 'Transfers', description: 'Stock transfers', icon: 'orders', bg: 'bg-info-50 dark:bg-info-700/20 text-info-600 dark:text-info-400' },
        { href: '/admin/inventory', label: 'Reconciliation', description: 'Resolve stock mismatches', icon: 'pending', bg: 'bg-danger-50 dark:bg-danger-700/20 text-danger-600 dark:text-danger-400' },
      ];
    default:
      return [
        ...common,
        { href: '/admin/settings', label: 'Settings', description: 'Account settings', icon: 'settings', bg: 'bg-app-hover text-app-fg-muted' },
      ];
  }
}

function StatIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    orders: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z',
    pending: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
    products: 'M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9',
    users: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
    revenue: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
    profit: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    margin: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
    roas: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
    add: 'M12 4.5v15m7.5-7.5h-15',
    settings: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z',
  };

  const path = icons[type] ?? icons['orders'];
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

function ActionIcon({ type }: { type: string }) {
  return <StatIcon type={type} />;
}
