import { Link } from '@remix-run/react';
import { confirmationRateColorClass, deliveryRateColorClass, cpaColorClass } from '~/lib/rate-color';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
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

  /** Build a Sales Orders URL carrying the current date filter context. */
  function salesLink(extra?: Record<string, string>): string {
    const params = new URLSearchParams();
    if (filters?.periodAllTime) {
      params.set('period', 'all_time');
    } else {
      if (filters?.startDate) params.set('startDate', filters.startDate);
      if (filters?.endDate) params.set('endDate', filters.endDate);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/admin/sales/orders?${qs}` : '/admin/sales/orders';
  }

  const revenue = data?.revenue ?? 0;
  const marketingSafe = {
    totalSpend: data?.marketing?.totalSpend ?? 0,
    approvedSpend: (data?.marketing as Record<string, number> | undefined)?.approvedSpend ?? data?.marketing?.totalSpend ?? 0,
    deliveredRevenue: (data?.marketing as Record<string, number> | undefined)?.deliveredRevenue ?? 0,
    totalOrders: (data?.marketing as Record<string, number> | undefined)?.totalOrders ?? 0,
    cpa: data?.marketing?.cpa ?? 0,
    roas: data?.marketing?.roas ?? 0,
    confirmationRate: (data?.marketing as Record<string, number> | undefined)?.confirmationRate ?? 0,
    deliveryRate: data?.marketing?.deliveryRate ?? 0,
  };
  const orderPipeline = {
    total: data?.orderPipeline?.total ?? 0,
    statusCounts: data?.orderPipeline?.statusCounts ?? {},
    offlineCount: data?.orderPipeline?.offlineCount ?? 0,
  };
  // Deliveries per Brand + Stock Available per Product removed 2026-05-19 per
  // CEO directive; backend still returns them but this view no longer renders.

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        mobileInlineActions
        description="Executive dashboard — key business metrics at a glance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
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
            <div className="text-sm text-app-fg-muted mt-1 flex flex-col md:flex-row md:gap-3">
              <p>Delivered Revenue: <span className="font-semibold text-success-600 dark:text-success-400">{fmt(marketingSafe.deliveredRevenue)}</span></p>
              <p>Ad Spend: <span className="font-semibold text-danger-600 dark:text-danger-400">{fmt(marketingSafe.totalSpend)}</span></p>
            </div>
            <Link
              to="/admin/ceo"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-500 hover:text-brand-600"
            >
              Deep Analysis
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Order Funnel: full pipeline at a glance ── */}
      {(() => {
        const sc = orderPipeline.statusCounts;
        const offlineCount = orderPipeline.offlineCount ?? 0;
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
        // CR = confirmed-or-beyond / total (excludes DELETED from denominator)
        const confirmedAndBeyond = confirmed + delivered;
        const confirmationRate = ordersTotal > 0 ? (confirmedAndBeyond / ordersTotal) * 100 : 0;
        // DR = delivered / total
        const deliveryRate = ordersTotal > 0 ? (delivered / ordersTotal) * 100 : 0;
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
                  to: salesLink(),
                },
                {
                  label: 'Offline',
                  value: offlineCount,
                  valueClassName: 'text-purple-600 dark:text-purple-400',
                  title: 'Orders created manually via offline order',
                  to: salesLink({ orderSource: 'offline' }),
                },
                {
                  label: 'Unassigned',
                  value: unassigned,
                  valueClassName: 'text-warning-600 dark:text-warning-400',
                  to: salesLink({ status: 'UNPROCESSED' }),
                },
                {
                  label: 'Assigned',
                  value: assigned,
                  valueClassName: 'text-info-600 dark:text-info-400',
                  to: salesLink({ status: 'CS_ASSIGNED' }),
                },
                {
                  label: 'Unconfirmed',
                  value: unconfirmed,
                  valueClassName: 'text-cyan-600 dark:text-cyan-400',
                  to: salesLink({ status: 'CS_ENGAGED' }),
                },
                {
                  label: 'Confirmed',
                  value: confirmed,
                  valueClassName: 'text-brand-600 dark:text-brand-400',
                  to: salesLink({ status: 'CONFIRMED' }),
                },
                {
                  label: 'Delivered',
                  value: delivered,
                  valueClassName: 'text-success-600 dark:text-success-400',
                  to: salesLink({ status: 'DELIVERED' }),
                },
                {
                  label: 'CR',
                  value: pct(confirmationRate),
                  valueClassName: confirmationRateColorClass(confirmationRate),
                  title: 'Confirmation Rate — confirmed-or-beyond / total',
                },
                {
                  label: 'DR',
                  value: pct(deliveryRate),
                  valueClassName: deliveryRateColorClass(deliveryRate),
                  title: 'Delivery Rate — delivered / total',
                },
                {
                  label: 'Deleted',
                  value: deleted,
                  valueClassName: 'text-danger-600 dark:text-danger-400',
                  to: salesLink({ status: 'DELETED' }),
                },
              ]}
            />
          </div>
        );
      })()}

      {/* ── Follow-Up Orders ── */}
      {(() => {
        const sc = data?.followUpCounts ?? {};
        const unassigned = sc['UNPROCESSED'] ?? 0;
        const assigned = sc['CS_ASSIGNED'] ?? 0;
        const engaged = sc['CS_ENGAGED'] ?? 0;
        const confirmed =
          (sc['CONFIRMED'] ?? 0) +
          (sc['AGENT_ASSIGNED'] ?? 0) +
          (sc['DISPATCHED'] ?? 0) +
          (sc['IN_TRANSIT'] ?? 0);
        const delivered = (sc['DELIVERED'] ?? 0) + (sc['REMITTED'] ?? 0);
        const total = Object.entries(sc).filter(([k]) => k !== 'DELETED').reduce((s, [, n]) => s + (n || 0), 0);
        return (
          <div>
            <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
              Follow-Up Orders
            </h2>
            <OverviewStatStrip
              mobileGrid
              tileClassName="!py-2.5"
              items={[
                {
                  label: 'Total',
                  value: total,
                  valueClassName: 'text-app-fg',
                  to: '/admin/cs/follow-up?view=orders',
                },
                {
                  label: 'Unassigned',
                  value: unassigned,
                  valueClassName: 'text-warning-600 dark:text-warning-400',
                  to: '/admin/cs/follow-up?view=orders&status=UNPROCESSED',
                },
                {
                  label: 'Assigned',
                  value: assigned,
                  valueClassName: 'text-info-600 dark:text-info-400',
                  to: '/admin/cs/follow-up?view=orders&status=CS_ASSIGNED',
                },
                {
                  label: 'Engaged',
                  value: engaged,
                  valueClassName: 'text-cyan-600 dark:text-cyan-400',
                  to: '/admin/cs/follow-up?view=orders&status=CS_ENGAGED',
                },
                {
                  label: 'Confirmed',
                  value: confirmed,
                  valueClassName: 'text-brand-600 dark:text-brand-400',
                  to: '/admin/cs/follow-up?view=orders&status=CONFIRMED',
                },
                {
                  label: 'Delivered',
                  value: delivered,
                  valueClassName: 'text-success-600 dark:text-success-400',
                  to: '/admin/cs/follow-up?view=orders&status=DELIVERED',
                },
                {
                  label: 'CR',
                  value: pct(total > 0 ? (confirmed + delivered) / total * 100 : 0),
                  valueClassName: confirmationRateColorClass(total > 0 ? (confirmed + delivered) / total * 100 : 0),
                },
                {
                  label: 'DR',
                  value: pct(total > 0 ? delivered / total * 100 : 0),
                  valueClassName: deliveryRateColorClass(total > 0 ? delivered / total * 100 : 0),
                },
                {
                  label: 'Deleted',
                  value: sc['DELETED'] ?? 0,
                  valueClassName: 'text-danger-600 dark:text-danger-400',
                  to: '/admin/cs/follow-up?view=orders&status=DELETED',
                },
              ]}
            />
          </div>
        );
      })()}

      {/* ── Cart Orders ── */}
      {(() => {
        const sc = data?.cartOrdersCounts ?? {};
        const unassigned = sc['UNPROCESSED'] ?? 0;
        const assigned = sc['CS_ASSIGNED'] ?? 0;
        const engaged = sc['CS_ENGAGED'] ?? 0;
        const confirmed =
          (sc['CONFIRMED'] ?? 0) +
          (sc['AGENT_ASSIGNED'] ?? 0) +
          (sc['DISPATCHED'] ?? 0) +
          (sc['IN_TRANSIT'] ?? 0);
        const delivered = (sc['DELIVERED'] ?? 0) + (sc['REMITTED'] ?? 0);
        const total = Object.entries(sc).filter(([k]) => k !== 'DELETED').reduce((s, [, n]) => s + (n || 0), 0);
        return (
          <div>
            <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
              Cart Orders
            </h2>
            <OverviewStatStrip
              mobileGrid
              tileClassName="!py-2.5"
              items={[
                {
                  label: 'Total',
                  value: total,
                  valueClassName: 'text-app-fg',
                  to: '/admin/sales/cart-orders',
                },
                {
                  label: 'Unassigned',
                  value: unassigned,
                  valueClassName: 'text-warning-600 dark:text-warning-400',
                  to: '/admin/sales/cart-orders?status=UNPROCESSED',
                },
                {
                  label: 'Assigned',
                  value: assigned,
                  valueClassName: 'text-info-600 dark:text-info-400',
                  to: '/admin/sales/cart-orders?status=CS_ASSIGNED',
                },
                {
                  label: 'Engaged',
                  value: engaged,
                  valueClassName: 'text-cyan-600 dark:text-cyan-400',
                  to: '/admin/sales/cart-orders?status=CS_ENGAGED',
                },
                {
                  label: 'Confirmed',
                  value: confirmed,
                  valueClassName: 'text-brand-600 dark:text-brand-400',
                  to: '/admin/sales/cart-orders?status=CONFIRMED',
                },
                {
                  label: 'Delivered',
                  value: delivered,
                  valueClassName: 'text-success-600 dark:text-success-400',
                  to: '/admin/sales/cart-orders?status=DELIVERED',
                },
                {
                  label: 'CR',
                  value: pct(total > 0 ? (confirmed + delivered) / total * 100 : 0),
                  valueClassName: confirmationRateColorClass(total > 0 ? (confirmed + delivered) / total * 100 : 0),
                },
                {
                  label: 'DR',
                  value: pct(total > 0 ? delivered / total * 100 : 0),
                  valueClassName: deliveryRateColorClass(total > 0 ? delivered / total * 100 : 0),
                },
                {
                  label: 'Deleted',
                  value: sc['DELETED'] ?? 0,
                  valueClassName: 'text-danger-600 dark:text-danger-400',
                  to: '/admin/sales/cart-orders?status=DELETED',
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
              to: '/admin/marketing/expenses',
            },
            {
              label: 'Marketing Orders',
              value: marketingSafe.totalOrders.toLocaleString(),
              valueClassName: 'text-app-fg',
              title: 'Online form orders in the selected period (excludes offline/follow-up)',
              to: '/admin/marketing/orders',
            },
            {
              label: 'Cost Per Acquisition',
              value: fmt(marketingSafe.cpa),
              valueClassName: cpaColorClass(marketingSafe.cpa),
              title: 'Ad spend ÷ total orders',
              to: '/admin/marketing/expenses',
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
              label: 'Revenue',
              value: fmt(revenue),
              valueClassName: 'text-success-600 dark:text-success-400',
              title: 'Revenue from delivered orders in selected period',
            },
          ]}
        />
      </div>

      {/* ── Quick Navigation ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickJump to={salesLink()} label="Sales Orders" />
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

