import { useState } from 'react';
import { Link } from '@remix-run/react';
import { useResolveFilterHref } from '~/hooks/useFilterPreferences';
import { confirmationRateColorClass, deliveryRateColorClass, cpaColorClass } from '~/lib/rate-color';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Modal } from '~/components/ui/modal';
import { formatNaira } from '~/lib/format-amount';
import type { CEODashboardData } from '~/features/ceo/types';

function FunnelInfoIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="ml-1 inline-flex items-center justify-center rounded-full text-app-fg-muted hover:text-app-fg transition-colors"
      aria-label="View breakdown"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
      </svg>
    </button>
  );
}

function FunnelBreakdownModal({
  open,
  onClose,
  title,
  description,
  lines,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  lines: Array<{ label: string; value: number; bold?: boolean; muted?: boolean }>;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-sm" contentClassName="p-5">
      <h2 className="text-base font-semibold text-app-fg mb-1">{title}</h2>
      <p className="text-sm text-app-fg-muted mb-4">{description}</p>
      <div className="space-y-0.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`flex items-center justify-between gap-4 py-1.5 ${l.bold ? 'font-semibold border-t border-app-border pt-2.5 mt-1' : ''}`}
          >
            <span className={`text-sm ${l.muted ? 'text-app-fg-muted' : 'text-app-fg'}`}>{l.label}</span>
            <span className="text-sm tabular-nums text-app-fg">{l.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

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
  const [breakdownModal, setBreakdownModal] = useState<'csTotal' | 'csDelivered' | null>(null);

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

  function followUpLink(extra?: Record<string, string>): string {
    const params = new URLSearchParams();
    params.set('view', 'orders');
    if (filters?.periodAllTime) {
      params.set('period', 'all_time');
    } else {
      if (filters?.startDate) params.set('startDate', filters.startDate);
      if (filters?.endDate) params.set('endDate', filters.endDate);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
    }
    return `/admin/cs/follow-up?${params.toString()}`;
  }

  function cartOrdersLink(extra?: Record<string, string>): string {
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
    return qs ? `/admin/sales/cart-orders?${qs}` : '/admin/sales/cart-orders';
  }

  const revenue = data?.revenue ?? 0;
  const marketingSafe = {
    totalSpend: data?.marketing?.totalSpend ?? 0,
    approvedSpend: (data?.marketing as Record<string, number> | undefined)?.approvedSpend ?? data?.marketing?.totalSpend ?? 0,
    deliveredRevenue: (data?.marketing as Record<string, number> | undefined)?.deliveredRevenue ?? 0,
    totalOrders: data?.marketing?.totalOrders ?? 0,
    confirmedOrders: data?.marketing?.confirmedOrders ?? 0,
    deliveredOrders: data?.marketing?.deliveredOrders ?? 0,
    cpa: data?.marketing?.cpa ?? 0,
    roas: data?.marketing?.roas ?? 0,
    confirmationRate: (data?.marketing as Record<string, number> | undefined)?.confirmationRate ?? 0,
    deliveryRate: data?.marketing?.deliveryRate ?? 0,
  };
  const orderPipeline = {
    total: data?.orderPipeline?.total ?? 0,
    statusCounts: data?.orderPipeline?.statusCounts ?? {},
    offlineCount: data?.orderPipeline?.offlineCount ?? 0,
    offlineDeliveredCount: (data?.orderPipeline as Record<string, number> | undefined)?.offlineDeliveredCount ?? 0,
    csStatusCounts: (data?.orderPipeline as Record<string, unknown> | undefined)?.csStatusCounts as Record<string, number> ?? {},
    offlineStatusCounts: (data?.orderPipeline as Record<string, unknown> | undefined)?.offlineStatusCounts as Record<string, number> ?? {},
    totalOrdersCounts: (data as unknown as Record<string, unknown> | undefined)?.totalOrdersCounts as Record<string, number> ?? {},
  };
  // Deliveries per Brand + Stock Available per Product removed 2026-05-19 per
  // CEO directive; backend still returns them but this view no longer renders.

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        mobileInlineActions
        description="Executive dashboard. Key business metrics at a glance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Dashboard date range"
            saveFilterKey
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
      <div className="card relative overflow-hidden !py-3 !px-4 max-w-[400px]">
        {/* Decorative brand watermark */}
        <img
          src="/assets/yannis-logo.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 h-24 w-24 object-contain opacity-[0.06] dark:opacity-[0.08]"
        />
        <div className="relative">
          <p className="text-xs font-medium text-app-fg-muted tracking-wide">
            ROAS on Ad Spend
          </p>
          <p className={`text-3xl sm:text-4xl font-bold tabular-nums leading-tight ${
            marketingSafe.roas >= 2
              ? 'text-success-600 dark:text-success-400'
              : marketingSafe.roas >= 1
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-danger-600 dark:text-danger-400'
          }`}>
            {marketingSafe.roas.toFixed(2)}x
          </p>
          <div className="text-xs text-app-fg-muted mt-0.5 flex gap-3">
            <p>Delivered Revenue: <span className="font-semibold text-success-600 dark:text-success-400">{fmt(marketingSafe.deliveredRevenue)}</span></p>
            <p>Ad Spend: <span className="font-semibold text-danger-600 dark:text-danger-400">{fmt(marketingSafe.totalSpend)}</span></p>
          </div>
          <Link
            to="/admin/ceo"
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-app-fg-muted hover:text-app-fg"
          >
            Deep analysis
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>

      {/* ── Total Orders: all categories combined ── */}
      {(() => {
        const tSc = orderPipeline.totalOrdersCounts ?? {};
        const mktSc = orderPipeline.statusCounts;
        const offSc = orderPipeline.offlineStatusCounts ?? {};
        const followUpSc = data?.followUpCounts as Record<string, number> ?? {};
        const cartSc = data?.cartOrdersCounts as Record<string, number> ?? {};
        const dfuSc = (data as unknown as Record<string, unknown>)?.deliveredFollowUpCounts as Record<string, number> ?? {};

        const sumExcludeDeleted = (sc: Record<string, number>) =>
          Object.entries(sc).filter(([k]) => k !== 'DELETED' && k !== 'CANCELLED').reduce((s, [, n]) => s + (n || 0), 0);
        const sumStatus = (sc: Record<string, number>, ...keys: string[]) =>
          keys.reduce((s, k) => s + (sc[k] ?? 0), 0);

        const tTotal = sumExcludeDeleted(tSc);
        const tUnprocessed = tSc['UNPROCESSED'] ?? 0;
        const tCsAssigned = tSc['CS_ASSIGNED'] ?? 0;
        const tCsEngaged = tSc['CS_ENGAGED'] ?? 0;
        const tConfirmed =
          (tSc['CONFIRMED'] ?? 0) +
          (tSc['AGENT_ASSIGNED'] ?? 0) +
          (tSc['DISPATCHED'] ?? 0) +
          (tSc['IN_TRANSIT'] ?? 0);
        const tDelivered = (tSc['DELIVERED'] ?? 0) + (tSc['REMITTED'] ?? 0);
        const tDeleted = tSc['DELETED'] ?? 0;
        const tCR = tTotal > 0 ? ((tConfirmed + tDelivered) / tTotal) * 100 : 0;
        const tDR = tTotal > 0 ? (tDelivered / tTotal) * 100 : 0;

        // Per-category totals for breakdown
        const catFunnel = sumExcludeDeleted(mktSc);
        const catOffline = sumExcludeDeleted(offSc);
        const catFollowUp = sumExcludeDeleted(followUpSc);
        const catCart = sumExcludeDeleted(cartSc);
        const catDfu = sumExcludeDeleted(dfuSc);

        return (
          <div>
            <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
              Total Orders
            </h2>
            <OverviewStatStrip
              mobileGrid
              tileClassName="!py-2.5"
              items={[
                { label: 'Total', value: tTotal, valueClassName: 'text-app-fg' },
                { label: 'Unassigned', value: tUnprocessed, valueClassName: 'text-warning-600 dark:text-warning-400' },
                { label: 'Assigned', value: tCsAssigned, valueClassName: 'text-info-600 dark:text-info-400' },
                { label: 'Unconfirmed', value: tCsEngaged, valueClassName: 'text-cyan-600 dark:text-cyan-400' },
                { label: 'Confirmed', value: tConfirmed, valueClassName: 'text-brand-600 dark:text-brand-400' },
                { label: 'Delivered', value: tDelivered, valueClassName: 'text-success-600 dark:text-success-400' },
                { label: 'CR', value: `${tCR.toFixed(1)}%`, valueClassName: confirmationRateColorClass(tCR) },
                { label: 'DR', value: `${tDR.toFixed(1)}%`, valueClassName: deliveryRateColorClass(tDR) },
                { label: 'Deleted', value: tDeleted, valueClassName: 'text-danger-600 dark:text-danger-400' },
                { label: 'Funnel', value: catFunnel, valueClassName: 'text-brand-600 dark:text-brand-400', title: 'Marketing form orders' },
                { label: 'Offline', value: catOffline, valueClassName: 'text-purple-600 dark:text-purple-400', title: 'Manually created orders' },
                { label: 'Follow-up', value: catFollowUp, valueClassName: 'text-teal-600 dark:text-teal-400', title: 'Follow-up pipeline orders' },
                { label: 'Cart', value: catCart, valueClassName: 'text-orange-600 dark:text-orange-400', title: 'Cart-recovered orders' },
                { label: 'Delivered follow-up', value: catDfu, valueClassName: 'text-indigo-600 dark:text-indigo-400', title: 'Delivered follow-up orders' },
              ]}
            />
          </div>
        );
      })()}

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
        const confirmedAndBeyond = confirmed + delivered;
        const confirmationRate = ordersTotal > 0 ? (confirmedAndBeyond / ordersTotal) * 100 : 0;
        const deliveryRate = ordersTotal > 0 ? (delivered / ordersTotal) * 100 : 0;
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
                Marketing Order Funnel
              </h2>
              <OverviewStatStrip
                mobileGrid
                tileClassName="!py-2.5"
                items={[
                  {
                    label: 'Total',
                    value: ordersTotal,
                    valueClassName: 'text-app-fg',
                    to: marketingLink(),
                  },
                  {
                    label: 'Unassigned',
                    value: unassigned,
                    valueClassName: 'text-warning-600 dark:text-warning-400',
                    to: marketingLink({ status: 'UNPROCESSED' }),
                  },
                  {
                    label: 'Assigned',
                    value: assigned,
                    valueClassName: 'text-info-600 dark:text-info-400',
                    to: marketingLink({ status: 'CS_ASSIGNED' }),
                  },
                  {
                    label: 'Unconfirmed',
                    value: unconfirmed,
                    valueClassName: 'text-cyan-600 dark:text-cyan-400',
                    to: marketingLink({ status: 'CS_ENGAGED' }),
                  },
                  {
                    label: 'Confirmed',
                    value: confirmed,
                    valueClassName: 'text-brand-600 dark:text-brand-400',
                    to: marketingLink({ status: 'CONFIRMED' }),
                  },
                  {
                    label: 'Delivered',
                    value: delivered,
                    valueClassName: 'text-success-600 dark:text-success-400',
                    to: marketingLink({ status: 'DELIVERED' }),
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
                    to: marketingLink({ status: 'DELETED' }),
                  },
                ]}
              />
            </div>

            {/* ── Cart Orders (immediately after Marketing) ── */}
            {(() => {
              const cartSc = data?.cartOrdersCounts ?? {};
              const cartUnassigned = cartSc['UNPROCESSED'] ?? 0;
              const cartAssigned = cartSc['CS_ASSIGNED'] ?? 0;
              const cartEngaged = cartSc['CS_ENGAGED'] ?? 0;
              const cartConfirmed =
                (cartSc['CONFIRMED'] ?? 0) +
                (cartSc['AGENT_ASSIGNED'] ?? 0) +
                (cartSc['DISPATCHED'] ?? 0) +
                (cartSc['IN_TRANSIT'] ?? 0);
              const cartDelivered = (cartSc['DELIVERED'] ?? 0) + (cartSc['REMITTED'] ?? 0);
              const cartTotal = Object.entries(cartSc).filter(([k]) => k !== 'DELETED').reduce((s, [, n]) => s + (n || 0), 0);
              const cartCR = cartTotal > 0 ? ((cartConfirmed + cartDelivered) / cartTotal) * 100 : 0;
              const cartDR = cartTotal > 0 ? (cartDelivered / cartTotal) * 100 : 0;
              return (
                <div>
                  <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
                    Cart Orders
                  </h2>
                  <OverviewStatStrip
                    mobileGrid
                    tileClassName="!py-2.5"
                    items={[
                      { label: 'Total', value: cartTotal, valueClassName: 'text-app-fg', to: cartOrdersLink() },
                      { label: 'Unassigned', value: cartUnassigned, valueClassName: 'text-warning-600 dark:text-warning-400', to: cartOrdersLink({ status: 'UNPROCESSED' }) },
                      { label: 'Assigned', value: cartAssigned, valueClassName: 'text-info-600 dark:text-info-400', to: cartOrdersLink({ status: 'CS_ASSIGNED' }) },
                      { label: 'Unconfirmed', value: cartEngaged, valueClassName: 'text-cyan-600 dark:text-cyan-400', to: cartOrdersLink({ status: 'CS_ENGAGED' }) },
                      { label: 'Confirmed', value: cartConfirmed, valueClassName: 'text-brand-600 dark:text-brand-400', to: cartOrdersLink({ status: 'CONFIRMED' }) },
                      { label: 'Delivered', value: cartDelivered, valueClassName: 'text-success-600 dark:text-success-400', to: cartOrdersLink({ status: 'DELIVERED' }) },
                      { label: 'CR', value: pct(cartCR), valueClassName: confirmationRateColorClass(cartCR) },
                      { label: 'DR', value: pct(cartDR), valueClassName: deliveryRateColorClass(cartDR) },
                      { label: 'Deleted', value: cartSc['DELETED'] ?? 0, valueClassName: 'text-danger-600 dark:text-danger-400', to: cartOrdersLink({ status: 'DELETED' }) },
                    ]}
                  />
                </div>
              );
            })()}

            {(() => {
              const csSc = orderPipeline.csStatusCounts;
              const csRawTotal = Object.entries(csSc).filter(([k]) => k !== 'DELETED' && k !== 'CART').reduce((sum, [, n]) => sum + (n || 0), 0);
              // Exclude offline orders from the CS funnel — they have their own strip below.
              const csTotal = csRawTotal - offlineCount;
              const csUnassigned = csSc['UNPROCESSED'] ?? 0;
              const csAssigned = csSc['CS_ASSIGNED'] ?? 0;
              const csUnconfirmed = csSc['CS_ENGAGED'] ?? 0;
              const csConfirmed =
                (csSc['CONFIRMED'] ?? 0) +
                (csSc['AGENT_ASSIGNED'] ?? 0) +
                (csSc['DISPATCHED'] ?? 0) +
                (csSc['IN_TRANSIT'] ?? 0);
              const csDelivered = (csSc['DELIVERED'] ?? 0) + (csSc['REMITTED'] ?? 0);
              const csDeleted = csSc['DELETED'] ?? 0;
              const csConfirmedAndBeyond = csConfirmed + csDelivered;
              const csCR = csTotal > 0 ? (csConfirmedAndBeyond / csTotal) * 100 : 0;
              const csDR = csTotal > 0 ? (csDelivered / csTotal) * 100 : 0;
              return (
                <div>
                  <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
                    CS Order Funnel
                  </h2>
                  <OverviewStatStrip
                    mobileGrid
                    tileClassName="!py-2.5"
                    items={[
                      {
                        label: <span className="flex items-center">Total<FunnelInfoIcon onClick={() => setBreakdownModal('csTotal')} /></span>,
                        value: csTotal,
                        valueClassName: 'text-app-fg',
                        to: salesLink(),
                      },
                      {
                        label: 'Unassigned',
                        value: csUnassigned,
                        valueClassName: csUnassigned > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
                        to: salesLink({ status: 'UNPROCESSED' }),
                      },
                      {
                        label: 'Assigned',
                        value: csAssigned,
                        valueClassName: 'text-info-600 dark:text-info-400',
                        to: salesLink({ status: 'CS_ASSIGNED' }),
                      },
                      {
                        label: 'Unconfirmed',
                        value: csUnconfirmed,
                        valueClassName: 'text-cyan-600 dark:text-cyan-400',
                        to: salesLink({ status: 'CS_ENGAGED' }),
                      },
                      {
                        label: 'Confirmed',
                        value: csConfirmed,
                        valueClassName: 'text-brand-600 dark:text-brand-400',
                        to: salesLink({ status: 'CONFIRMED' }),
                      },
                      {
                        label: <span className="flex items-center">Delivered<FunnelInfoIcon onClick={() => setBreakdownModal('csDelivered')} /></span>,
                        value: csDelivered,
                        valueClassName: 'text-success-600 dark:text-success-400',
                        to: salesLink({ status: 'DELIVERED' }),
                      },
                      {
                        label: 'CR',
                        value: pct(csCR),
                        valueClassName: confirmationRateColorClass(csCR),
                        title: 'Confirmation Rate — confirmed-or-beyond / total (excludes offline)',
                      },
                      {
                        label: 'DR',
                        value: pct(csDR),
                        valueClassName: deliveryRateColorClass(csDR),
                        title: 'Delivery Rate — delivered / total (excludes offline)',
                      },
                      {
                        label: 'Deleted',
                        value: csDeleted,
                        valueClassName: 'text-danger-600 dark:text-danger-400',
                        to: salesLink({ status: 'DELETED' }),
                      },
                    ]}
                  />
                  <FunnelBreakdownModal
                    open={breakdownModal === 'csTotal'}
                    onClose={() => setBreakdownModal(null)}
                    title="CS Total: Breakdown"
                    description="Form orders only. Excludes offline, graduated follow-up, and cart orders (they have their own strips)."
                    lines={[
                      { label: 'Form orders', value: csTotal },
                    ]}
                  />
                </div>
              );
            })()}

            {/* ── Offline Orders ── */}
            {(() => {
              const offSc = orderPipeline.offlineStatusCounts ?? {};
              const offTotal = Object.entries(offSc).filter(([k]) => k !== 'DELETED').reduce((sum, [, n]) => sum + (n || 0), 0);
              const offUnassigned = offSc['UNPROCESSED'] ?? 0;
              const offAssigned = offSc['CS_ASSIGNED'] ?? 0;
              const offUnconfirmed = offSc['CS_ENGAGED'] ?? 0;
              const offConfirmed =
                (offSc['CONFIRMED'] ?? 0) +
                (offSc['AGENT_ASSIGNED'] ?? 0) +
                (offSc['DISPATCHED'] ?? 0) +
                (offSc['IN_TRANSIT'] ?? 0);
              const offDelivered = (offSc['DELIVERED'] ?? 0) + (offSc['REMITTED'] ?? 0);
              const offDeleted = offSc['DELETED'] ?? 0;
              const offConfirmedAndBeyond = offConfirmed + offDelivered;
              const offCR = offTotal > 0 ? (offConfirmedAndBeyond / offTotal) * 100 : 0;
              const offDR = offTotal > 0 ? (offDelivered / offTotal) * 100 : 0;
              const offlineLink = (params?: Record<string, string>) => {
                const base = '/admin/sales/offline-orders';
                if (!params) return buildLink(base);
                return buildLink(base, params);
              };
              return (
                <div>
                  <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
                    Offline Orders
                  </h2>
                  <OverviewStatStrip
                    mobileGrid
                    tileClassName="!py-2.5"
                    items={[
                      {
                        label: 'Total',
                        value: offTotal,
                        valueClassName: 'text-app-fg',
                        to: offlineLink(),
                      },
                      {
                        label: 'Unassigned',
                        value: offUnassigned,
                        valueClassName: offUnassigned > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
                        to: offlineLink({ status: 'UNPROCESSED' }),
                      },
                      {
                        label: 'Assigned',
                        value: offAssigned,
                        valueClassName: 'text-info-600 dark:text-info-400',
                        to: offlineLink({ status: 'CS_ASSIGNED' }),
                      },
                      {
                        label: 'Unconfirmed',
                        value: offUnconfirmed,
                        valueClassName: 'text-cyan-600 dark:text-cyan-400',
                        to: offlineLink({ status: 'CS_ENGAGED' }),
                      },
                      {
                        label: 'Confirmed',
                        value: offConfirmed,
                        valueClassName: 'text-brand-600 dark:text-brand-400',
                        to: offlineLink({ status: 'CONFIRMED' }),
                      },
                      {
                        label: 'Delivered',
                        value: offDelivered,
                        valueClassName: 'text-success-600 dark:text-success-400',
                        to: offlineLink({ status: 'DELIVERED' }),
                      },
                      {
                        label: 'CR',
                        value: pct(offCR),
                        valueClassName: confirmationRateColorClass(offCR),
                        title: 'Confirmation Rate — confirmed-or-beyond / total',
                      },
                      {
                        label: 'DR',
                        value: pct(offDR),
                        valueClassName: deliveryRateColorClass(offDR),
                        title: 'Delivery Rate — delivered / total',
                      },
                      {
                        label: 'Deleted',
                        value: offDeleted,
                        valueClassName: 'text-danger-600 dark:text-danger-400',
                        to: offlineLink({ status: 'DELETED' }),
                      },
                    ]}
                  />
                </div>
              );
            })()}
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
                  to: followUpLink(),
                },
                {
                  label: 'Unassigned',
                  value: unassigned,
                  valueClassName: 'text-warning-600 dark:text-warning-400',
                  to: followUpLink({ status: 'UNPROCESSED' }),
                },
                {
                  label: 'Assigned',
                  value: assigned,
                  valueClassName: 'text-info-600 dark:text-info-400',
                  to: followUpLink({ status: 'CS_ASSIGNED' }),
                },
                {
                  label: 'Unconfirmed',
                  value: engaged,
                  valueClassName: 'text-cyan-600 dark:text-cyan-400',
                  to: followUpLink({ status: 'CS_ENGAGED' }),
                },
                {
                  label: 'Confirmed',
                  value: confirmed,
                  valueClassName: 'text-brand-600 dark:text-brand-400',
                  to: followUpLink({ status: 'CONFIRMED' }),
                },
                {
                  label: 'Delivered',
                  value: delivered,
                  valueClassName: 'text-success-600 dark:text-success-400',
                  to: followUpLink({ status: 'DELIVERED' }),
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
                  to: followUpLink({ status: 'DELETED' }),
                },
              ]}
            />
          </div>
        );
      })()}

      {/* ── Delivered Follow-Up Orders ── */}
      {(() => {
        const sc = (data as unknown as Record<string, unknown>)?.deliveredFollowUpCounts as Record<string, number> ?? {};
        const dfuTotal = Object.entries(sc).filter(([k]) => k !== 'DELETED').reduce((s, [, n]) => s + (n || 0), 0);
        const dfuUnassigned = sc['UNPROCESSED'] ?? 0;
        const dfuAssigned = sc['CS_ASSIGNED'] ?? 0;
        const dfuEngaged = sc['CS_ENGAGED'] ?? 0;
        const dfuConfirmed =
          (sc['CONFIRMED'] ?? 0) +
          (sc['AGENT_ASSIGNED'] ?? 0) +
          (sc['DISPATCHED'] ?? 0) +
          (sc['IN_TRANSIT'] ?? 0);
        const dfuDelivered = (sc['DELIVERED'] ?? 0) + (sc['REMITTED'] ?? 0);
        const dfuCR = dfuTotal > 0 ? ((dfuConfirmed + dfuDelivered) / dfuTotal) * 100 : 0;
        const dfuDR = dfuTotal > 0 ? (dfuDelivered / dfuTotal) * 100 : 0;
        const dfuLink = (params?: Record<string, string>) => buildLink('/admin/sales/delivered-follow-up', params);
        return (
          <div>
            <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
              Delivered Follow-Up
            </h2>
            <OverviewStatStrip
              mobileGrid
              tileClassName="!py-2.5"
              items={[
                { label: 'Total', value: dfuTotal, valueClassName: 'text-app-fg', to: dfuLink() },
                { label: 'Unassigned', value: dfuUnassigned, valueClassName: 'text-warning-600 dark:text-warning-400', to: dfuLink({ status: 'UNPROCESSED' }) },
                { label: 'Assigned', value: dfuAssigned, valueClassName: 'text-info-600 dark:text-info-400', to: dfuLink({ status: 'CS_ASSIGNED' }) },
                { label: 'Unconfirmed', value: dfuEngaged, valueClassName: 'text-cyan-600 dark:text-cyan-400', to: dfuLink({ status: 'CS_ENGAGED' }) },
                { label: 'Confirmed', value: dfuConfirmed, valueClassName: 'text-brand-600 dark:text-brand-400', to: dfuLink({ status: 'CONFIRMED' }) },
                { label: 'Delivered', value: dfuDelivered, valueClassName: 'text-success-600 dark:text-success-400', to: dfuLink({ status: 'DELIVERED' }) },
                { label: 'CR', value: pct(dfuCR), valueClassName: confirmationRateColorClass(dfuCR) },
                { label: 'DR', value: pct(dfuDR), valueClassName: deliveryRateColorClass(dfuDR) },
                { label: 'Deleted', value: sc['DELETED'] ?? 0, valueClassName: 'text-danger-600 dark:text-danger-400', to: dfuLink({ status: 'DELETED' }) },
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

      {/* ── Revenue & Profit ── */}
      {(() => {
        const trueProfit = data?.trueProfit ?? 0;
        const marginPct = data?.margin ?? 0;
        const costs = data?.costBreakdown ?? { landedCost: 0, deliveryFee: 0, adSpend: 0, commission: 0, fulfillmentCost: 0, operationalLoss: 0 };
        const totalExpenses = costs.landedCost + costs.deliveryFee + costs.adSpend + costs.commission + costs.fulfillmentCost + costs.operationalLoss;
        const remitted = orderPipeline.statusCounts['REMITTED'] ?? 0;
        const delivered = orderPipeline.statusCounts['DELIVERED'] ?? 0;
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
                Revenue & Profit
              </h2>
              <OverviewStatStrip
                mobileGrid
                tileClassName="!py-2.5"
                items={[
                  {
                    label: 'Revenue',
                    value: fmt(revenue),
                    valueClassName: 'text-success-600 dark:text-success-400',
                    title: 'Total revenue from delivered orders',
                    to: '/admin/finance/overview',
                  },
                  {
                    label: 'Total Expenses',
                    value: fmt(totalExpenses),
                    valueClassName: 'text-danger-600 dark:text-danger-400',
                    title: 'COGS + delivery + ads + commission + fulfillment + losses',
                    to: '/admin/finance/overview',
                  },
                  {
                    label: 'True Profit',
                    value: fmt(trueProfit),
                    valueClassName: trueProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400',
                    title: 'Revenue minus all costs',
                    to: '/admin/finance/overview',
                  },
                  {
                    label: 'Margin',
                    value: `${marginPct.toFixed(1)}%`,
                    valueClassName: marginPct >= 20 ? 'text-success-600 dark:text-success-400' : marginPct >= 0 ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400',
                    title: 'True profit ÷ revenue',
                  },
                ]}
              />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
                Remittance
              </h2>
              <OverviewStatStrip
                mobileGrid
                tileClassName="!py-2.5"
                items={[
                  {
                    label: 'Remitted',
                    value: remitted.toLocaleString(),
                    valueClassName: 'text-success-600 dark:text-success-400',
                    title: 'Orders fully remitted',
                    to: '/admin/finance/cash-remittances',
                  },
                  {
                    label: 'Awaiting Remittance',
                    value: delivered.toLocaleString(),
                    valueClassName: delivered > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg-muted',
                    title: 'Delivered but not yet remitted',
                    to: '/admin/finance/cash-remittances',
                  },
                ]}
              />
            </div>
          </div>
        );
      })()}

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
  const resolveHref = useResolveFilterHref();
  return (
    <Link
      to={resolveHref(to)}
      className="card text-center py-4 hover:bg-app-hover/40 transition-colors"
    >
      <span className="text-sm font-medium text-app-fg">{label}</span>
    </Link>
  );
}

