import { Link } from '@remix-run/react';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { confirmationRateColorClass, deliveryRateColorClass } from '~/lib/rate-color';
import {
  STATUS_OPTIONS,
  STATUS_LABELS,
  STATUS_TEXT_CLASS,
  formatStatus,
} from '~/features/shared/order-status';

/**
 * Data shape for the lightweight admin landing. Populated by
 * `dashboard.quickOverview` (single tRPC call, ~50-150ms total).
 */
export interface QuickOverviewData {
  /** Raw status → count map (same shape as the Sales Orders stat strip). */
  statusCounts: Record<string, number>;
  /** Offline-created orders count for today. */
  offlineCount: number;
  marketing: {
    today: {
      /** All orders created today, any status. */
      newOrders: number;
      /** Orders that reached CONFIRMED today. */
      confirmed: number;
      /** Orders that reached DELIVERED today. */
      delivered: number;
      /** Orders that were cancelled today. */
      cancelled: number;
    };
  };
  cs: {
    /** Orders created today that are still sitting in UNPROCESSED waiting for CS assignment. */
    unassigned: number;
    /** Orders created today that are currently in CS_ENGAGED. */
    engaged: number;
    /** Orders created today that are currently CONFIRMED. */
    confirmed: number;
    /** Orders created today that are currently DELIVERED. */
    delivered: number;
  };
  /** Finance approval requests in PENDING state. */
  pendingApprovals: number;
  /** Follow-up order per-status counts. */
  followUpCounts?: Record<string, number>;
  /** Cart order per-status counts. */
  cartOrdersCounts?: Record<string, number>;
}

export interface AdminQuickDashboardProps {
  data: QuickOverviewData;
  userName: string;
  role: string;
  filters?: { startDate: string; endDate: string; periodAllTime?: boolean };
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Lightweight admin landing. Replaces the previous heavy CEO Executive dashboard on /admin.
 * The full Executive Overview (profit aggregation, charts, leaderboards, branch breakdown)
 * lives at /admin/ceo — linked prominently from this page. See CLAUDE.md for context on why.
 */
export function AdminQuickDashboard({ data, userName, role, filters }: AdminQuickDashboardProps) {
  const firstName = userName?.split(' ')[0] ?? 'Admin';
  const statusCounts = data.statusCounts ?? {};
  const offlineCount = data.offlineCount ?? 0;
  const cartCounts = data.cartOrdersCounts ?? {};
  const cartTotal = Object.entries(cartCounts).filter(([k]) => k !== 'DELETED').reduce((s, [, n]) => s + (n || 0), 0);

  /** Build a link with current date filter context. */
  function buildLink(base: string, extra?: Record<string, string>): string {
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
    return qs ? `${base}?${qs}` : base;
  }
  /** Funnel stats link to marketing orders. */
  function marketingLink(extra?: Record<string, string>): string {
    return buildLink('/admin/marketing/orders', extra);
  }
  /** Offline + CS-specific links go to sales orders. */
  function salesLink(extra?: Record<string, string>): string {
    return buildLink('/admin/sales/orders', extra);
  }
  /** Cart orders page link. */
  function cartOrdersLink(): string {
    return buildLink('/admin/cart-orders');
  }

  // Mirror the Sales Orders page stat strip (CEO six-bucket pipeline).
  const CONFIRMED_SUBSTAGES = ['AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'] as const;
  const PIPELINE_KEYS = STATUS_OPTIONS.filter((s) => s !== 'ALL');
  const confirmedAbsorbsSubstages = !PIPELINE_KEYS.some((s) =>
    (CONFIRMED_SUBSTAGES as readonly string[]).includes(s),
  );

  const total = Object.entries(statusCounts)
    .filter(([k]) => k !== 'DELETED' && k !== 'CART')
    .reduce((sum, [, n]) => sum + (n || 0), 0);

  // CR = confirmed-or-beyond / (total - DELETED)
  const confirmedAndBeyond =
    (statusCounts['CONFIRMED'] ?? 0) +
    (statusCounts['AGENT_ASSIGNED'] ?? 0) +
    (statusCounts['DISPATCHED'] ?? 0) +
    (statusCounts['IN_TRANSIT'] ?? 0) +
    (statusCounts['DELIVERED'] ?? 0) +
    (statusCounts['REMITTED'] ?? 0);
  const confirmationRate = total > 0 ? (confirmedAndBeyond / total) * 100 : 0;

  // DR = delivered / total
  const delivered = (statusCounts['DELIVERED'] ?? 0) + (statusCounts['REMITTED'] ?? 0);
  const deliveryRate = total > 0 ? (delivered / total) * 100 : 0;

  const csPipelineItems = PIPELINE_KEYS.map((status) => {
    let value = statusCounts[status] ?? 0;
    if (status === 'DELIVERED') {
      value += statusCounts['REMITTED'] ?? 0;
    }
    if (status === 'CONFIRMED' && confirmedAbsorbsSubstages) {
      for (const sub of CONFIRMED_SUBSTAGES) value += statusCounts[sub] ?? 0;
    }
    return {
      label: STATUS_LABELS[status] ?? formatStatus(status),
      value,
      valueClassName: STATUS_TEXT_CLASS[status] ?? 'text-app-fg',
      to: salesLink({ status }),
    };
  });

  const pipelineItems = PIPELINE_KEYS.map((status) => {
    let value = statusCounts[status] ?? 0;
    if (status === 'DELIVERED') {
      value += statusCounts['REMITTED'] ?? 0;
    }
    if (status === 'CONFIRMED' && confirmedAbsorbsSubstages) {
      for (const sub of CONFIRMED_SUBSTAGES) value += statusCounts[sub] ?? 0;
    }
    return {
      label: STATUS_LABELS[status] ?? formatStatus(status),
      value,
      valueClassName: STATUS_TEXT_CLASS[status] ?? 'text-app-fg',
      to: marketingLink({ status }),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        mobileInlineActions
        description="Quick snapshot of today's performance."
        actions={
          <>
            <span className="hidden md:inline-flex"><PageRefreshButton /></span>
            <span className="md:hidden"><PageRefreshButton iconOnly /></span>
          </>
        }
      />

      {/* Order Funnel */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-app-fg">Order Funnel</h2>
          <Link
            to={marketingLink()}
            prefetch="intent"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            View all →
          </Link>
        </div>
        <OverviewStatStrip
          mobileGrid
          embedded
          showScrollControls={false}
          items={[
            {
              label: 'Total',
              value: total,
              valueClassName: 'text-app-fg',
              to: marketingLink(),
            },
            ...pipelineItems,
            {
              label: 'CR',
              value: `${confirmationRate.toFixed(1)}%`,
              valueClassName: confirmationRateColorClass(confirmationRate),
              title: 'Confirmation Rate — confirmed / (confirmed + deleted)',
            },
            {
              label: 'DR',
              value: `${deliveryRate.toFixed(1)}%`,
              valueClassName: deliveryRateColorClass(deliveryRate),
              title: 'Delivery Rate — delivered / total orders',
            },
            {
              label: 'Cart Abandonment',
              value: cartTotal,
              valueClassName: 'text-orange-600 dark:text-orange-400',
              to: cartOrdersLink(),
            },
          ]}
        />
      </div>

      {/* CS Order Funnel */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-app-fg">CS Order Funnel</h2>
          <Link
            to={salesLink()}
            prefetch="intent"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            View all →
          </Link>
        </div>
        <OverviewStatStrip
          mobileGrid
          embedded
          showScrollControls={false}
          items={[
            {
              label: 'Total',
              value: total,
              valueClassName: 'text-app-fg',
              to: salesLink(),
            },
            ...csPipelineItems,
            {
              label: 'CR',
              value: `${confirmationRate.toFixed(1)}%`,
              valueClassName: confirmationRateColorClass(confirmationRate),
              title: 'Confirmation Rate — confirmed / (confirmed + deleted)',
            },
            {
              label: 'DR',
              value: `${deliveryRate.toFixed(1)}%`,
              valueClassName: deliveryRateColorClass(deliveryRate),
              title: 'Delivery Rate — delivered / total orders',
            },
            {
              label: 'Offline',
              value: offlineCount,
              valueClassName: offlineCount > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-app-fg',
              title: 'Orders created manually via offline order',
              to: salesLink({ orderSource: 'offline' }),
            },
          ]}
        />
      </div>

      {/* Executive Overview card — the prominent entry point to the heavy report */}
      <Link to="/admin/ceo" className="card block hover:bg-app-hover/40 transition-colors">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-brand-600 dark:text-brand-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Executive Overview</h2>
              <svg
                className="w-5 h-5 text-app-fg-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
            <p className="text-sm text-app-fg-muted mt-1">
              Revenue, true profit, cost breakdown, order pipeline, media buyer &amp; CS
              performance, branch breakdown. Heavier page — loads in 1-2 seconds.
            </p>
          </div>
        </div>
      </Link>

      {/* Quick jumps */}
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
