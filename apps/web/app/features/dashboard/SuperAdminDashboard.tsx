import { useEffect, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import type { RevenueBySourcePayload } from '~/routes/admin.revenue-by-source/route';
import { useResolveFilterHref } from '~/hooks/useFilterPreferences';
import { confirmationRateColorClass, deliveryRateColorClass, cpaColorClass } from '~/lib/rate-color';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { FormSelect } from '~/components/ui/form-select';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { CompareButton } from '~/features/compare/CompareButton';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { formatNaira } from '~/lib/format-amount';
import type { CEODashboardData } from '~/features/ceo/types';
import { FunnelInfoIcon, FunnelBreakdownModal } from './funnel-breakdown';

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
  const [breakdownModal, setBreakdownModal] = useState<
    | 'heroRoas'
    | 'heroRevenue'
    | 'heroAdSpend'
    | 'totalBreakdown'
    | 'totalDelivered'
    | 'totalRemitted'
    | 'mktTotal'
    | 'csTotal'
    | 'csDelivered'
    | null
  >(null);

  // Revenue-on-strips control. One dropdown: 'off' (default) / 'net' / 'gross'.
  // Default OFF — the strips render exactly as before. Revenue is lazy-loaded
  // via a resource route only when a revenue mode is picked, so the default
  // dashboard load is unaffected.
  const [revenueMode, setRevenueMode] = useState<'off' | 'net' | 'gross'>('off');
  const withRevenue = revenueMode !== 'off';
  const revenueBasis: 'net' | 'gross' = revenueMode === 'gross' ? 'gross' : 'net';
  const revenueFetcher = useFetcher<RevenueBySourcePayload>();

  useEffect(() => {
    if (!withRevenue || revenueFetcher.data || revenueFetcher.state !== 'idle') return;
    const params = new URLSearchParams();
    if (filters?.periodAllTime) {
      params.set('period', 'all_time');
    } else {
      if (filters?.startDate) params.set('startDate', filters.startDate);
      if (filters?.endDate) params.set('endDate', filters.endDate);
    }
    revenueFetcher.load(`/admin/revenue-by-source?${params.toString()}`);
  }, [withRevenue, revenueFetcher, filters]);

  const revenueBySource = revenueFetcher.data ?? null;
  const revenueLoading = withRevenue && revenueFetcher.state === 'loading';

  /** Revenue amount (current basis) for one source bucket. delivered+remitted are
   *  the two scopes classified by getDeliveredBySource/getRevenueBySource. */
  function revAmount(scope: 'delivered' | 'remitted', sourceKey: string): number {
    const entry = revenueBySource?.[scope]?.[sourceKey];
    return entry ? entry[revenueBasis] : 0;
  }
  /** Sum of a basis across all buckets in a scope — for the combined Total strip. */
  function revScopeTotal(scope: 'delivered' | 'remitted'): number {
    const buckets = revenueBySource?.[scope] ?? {};
    return Object.values(buckets).reduce((s, e) => s + (e?.[revenueBasis] ?? 0), 0);
  }

  /** Build a stat-tile value node: the order count, plus a revenue subline when the
   *  "With revenue" toggle is on. `amount` is the revenue for this exact tile. */
  function tileValue(count: number, amount: number): React.ReactNode {
    if (!withRevenue) return count;
    return (
      <span className="flex flex-col items-end leading-tight">
        <span>{count.toLocaleString()}</span>
        <span className="text-micro font-normal text-app-fg-muted tabular-nums">
          {revenueLoading && !revenueBySource ? '…' : fmt(amount)}
        </span>
      </span>
    );
  }

  const REVENUE_OPTIONS: Array<{ value: 'off' | 'net' | 'gross'; label: string }> = [
    { value: 'off', label: 'Count only' },
    { value: 'net', label: 'Revenue (Net)' },
    { value: 'gross', label: 'Revenue (Gross)' },
  ];

  /** Revenue control — a single dropdown (Counts default / Revenue Net / Revenue
   *  Gross). The `sheet` variant matches the Marketing Orders mobile Actions-sheet
   *  filter dropdowns exactly (elevated bg, centered text, inline chevron, opens as
   *  modal); the header variant is the compact toolbar select. */
  const renderRevenueSelect = (variant: 'header' | 'sheet') =>
    variant === 'sheet' ? (
      <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
        <FormSelect
          aria-label="Show revenue on order strips"
          value={revenueMode}
          onChange={(e) => setRevenueMode(e.target.value as 'off' | 'net' | 'gross')}
          options={REVENUE_OPTIONS}
          controlSize="sm"
          className="!bg-transparent !border-transparent !text-center"
          inlineChevron
          openAs="modal"
          wrapperClassName="w-full"
        />
      </div>
    ) : (
      <FormSelect
        aria-label="Show revenue on order strips"
        controlSize="md"
        value={revenueMode}
        onChange={(e) => setRevenueMode(e.target.value as 'off' | 'net' | 'gross')}
        wrapperClassName="w-auto"
        className="!bg-app-hover"
        options={REVENUE_OPTIONS}
      />
    );
  const revenueToggle = renderRevenueSelect('header');

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
  const marketingBreakdown = data?.marketing?.deliveredRevenueBreakdown;
  const marketingSafe = {
    totalSpend: data?.marketing?.totalSpend ?? 0,
    approvedSpend: data?.marketing?.approvedSpend ?? data?.marketing?.totalSpend ?? 0,
    pendingSpend: data?.marketing?.pendingSpend ?? 0,
    deliveredRevenue: data?.marketing?.deliveredRevenue ?? 0,
    funnelRevenue: marketingBreakdown?.funnel ?? data?.marketing?.deliveredRevenue ?? 0,
    cartRevenue: marketingBreakdown?.cart ?? 0,
    totalOrders: data?.marketing?.totalOrders ?? 0,
    confirmedOrders: data?.marketing?.confirmedOrders ?? 0,
    deliveredOrders: data?.marketing?.deliveredOrders ?? 0,
    cpa: data?.marketing?.cpa ?? 0,
    roas: data?.marketing?.roas ?? 0,
    confirmationRate: data?.marketing?.confirmationRate ?? 0,
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
                {revenueToggle}
                <PageRefreshButton />
                <DateFilterBar
                    startDate={filters?.startDate ?? ''}
                    endDate={filters?.endDate ?? ''}
                    periodAllTime={filters?.periodAllTime ?? false} chrome="pill" />
                <CompareButton source="admin-overview" />
              </>
            }
            sheet={
              <div className="py-1">
                {renderRevenueSelect('sheet')}
              </div>
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
      <OverviewStatStrip
        mobileGrid
        mobileGridCols={3}
        items={[
          {
            label: (
              <span className="flex items-center">
                ROAS
                <FunnelInfoIcon onClick={() => setBreakdownModal('heroRoas')} />
              </span>
            ),
            value: `${marketingSafe.roas.toFixed(2)}x`,
            valueClassName: marketingSafe.roas >= 2
              ? 'text-success-600 dark:text-success-400'
              : marketingSafe.roas >= 1
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-danger-600 dark:text-danger-400',
          },
          {
            label: (
              <span className="flex items-center">
                Delivered revenue
                <FunnelInfoIcon onClick={() => setBreakdownModal('heroRevenue')} />
              </span>
            ),
            value: fmt(marketingSafe.deliveredRevenue),
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: (
              <span className="flex items-center">
                Ad spend
                <FunnelInfoIcon onClick={() => setBreakdownModal('heroAdSpend')} />
              </span>
            ),
            value: fmt(marketingSafe.approvedSpend),
            valueClassName: 'text-danger-600 dark:text-danger-400',
          },
          {
            label: 'Deep analysis',
            value: '→',
            to: '/admin/ceo',
          },
        ]}
      />

      <FunnelBreakdownModal
        open={breakdownModal === 'heroRoas'}
        onClose={() => setBreakdownModal(null)}
        title="ROAS: Breakdown"
        description="Return on ad spend for the selected period. ROAS = Delivered revenue ÷ Approved ad spend."
        lines={[
          { label: 'Delivered revenue', value: fmt(marketingSafe.deliveredRevenue) },
          { label: 'Approved ad spend', value: fmt(marketingSafe.approvedSpend) },
          { label: 'ROAS', value: `${marketingSafe.roas.toFixed(2)}x`, bold: true },
        ]}
      />
      <FunnelBreakdownModal
        open={breakdownModal === 'heroRevenue'}
        onClose={() => setBreakdownModal(null)}
        title="Delivered revenue: Breakdown"
        description="DELIVERED + REMITTED order value, by created date in the selected period. Includes marketing funnel (edge-form/import) and cart graduated only."
        lines={[
          { label: 'Funnel (edge-form / import)', value: fmt(marketingSafe.funnelRevenue) },
          { label: 'Cart graduated', value: fmt(marketingSafe.cartRevenue) },
          { label: 'Total', value: fmt(marketingSafe.deliveredRevenue), bold: true },
        ]}
      />
      <FunnelBreakdownModal
        open={breakdownModal === 'heroAdSpend'}
        onClose={() => setBreakdownModal(null)}
        title="Ad spend: Breakdown"
        description="The hero tile shows approved AD_SPEND only. That approved amount is the denominator for ROAS."
        lines={[
          { label: 'Approved (ROAS basis)', value: fmt(marketingSafe.approvedSpend) },
          { label: 'Pending (unapproved)', value: fmt(marketingSafe.pendingSpend), muted: true },
          { label: 'Total logged', value: fmt(marketingSafe.totalSpend), bold: true },
        ]}
      />

      {/* ── Total Orders: all categories combined ── */}
      {(() => {
        const tSc = orderPipeline.totalOrdersCounts ?? {};
        const mktSc = orderPipeline.statusCounts;
        const offSc = orderPipeline.offlineStatusCounts ?? {};
        const followUpSc = data?.followUpCounts as Record<string, number> ?? {};
        const cartSc = data?.cartOrdersCounts as Record<string, number> ?? {};
        const dfuSc = (data as unknown as Record<string, unknown>)?.deliveredFollowUpCounts as Record<string, number> ?? {};
        const deliveredBySource = (data as unknown as Record<string, unknown>)?.deliveredBySource as { delivered: Record<string, number>; remitted: Record<string, number> } ?? { delivered: {}, remitted: {} };

        const sumExcludeDeleted = (sc: Record<string, number>) =>
          Object.entries(sc).filter(([k]) => k !== 'DELETED' && k !== 'CANCELLED').reduce((s, [, n]) => s + (n || 0), 0);
        const sumStatus = (sc: Record<string, number>, ...keys: string[]) =>
          keys.reduce((s, k) => s + (sc[k] ?? 0), 0);

        // Everything from tSc (orders table, onlyGraduateNonMarketing).
        // Graduated follow-up/cart orders are already in the orders table,
        // so this single source matches Cash Remittances exactly.
        const tTotal = sumExcludeDeleted(tSc);
        const tUnprocessed = tSc['UNPROCESSED'] ?? 0;
        const tCsAssigned = tSc['CS_ASSIGNED'] ?? 0;
        const tCsEngaged = tSc['CS_ENGAGED'] ?? 0;
        const tConfirmed =
          (tSc['CONFIRMED'] ?? 0) +
          (tSc['AGENT_ASSIGNED'] ?? 0) +
          (tSc['DISPATCHED'] ?? 0) +
          (tSc['IN_TRANSIT'] ?? 0);
        const tDeliveredOnly = tSc['DELIVERED'] ?? 0;
        const tRemitted = tSc['REMITTED'] ?? 0;
        const tDelivered = tDeliveredOnly + tRemitted;
        const tDeleted = tSc['DELETED'] ?? 0;

        const computedCR = tTotal > 0 ? ((tConfirmed + tDelivered) / tTotal) * 100 : 0;
        const computedDR = tTotal > 0 ? (tDelivered / tTotal) * 100 : 0;

        return (
          <div>
            <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
              Total Orders
            </h2>
            <OverviewStatStrip
              mobileGrid
              tileClassName="!py-2.5"
              items={[
                {
                  label: <span className="flex items-center">Total<FunnelInfoIcon onClick={() => setBreakdownModal('totalBreakdown')} /></span>,
                  value: tTotal,
                  valueClassName: 'text-app-fg',
                },
                { label: 'Unassigned', value: tUnprocessed, valueClassName: 'text-warning-600 dark:text-warning-400' },
                { label: 'Assigned', value: tCsAssigned, valueClassName: 'text-info-600 dark:text-info-400' },
                { label: 'Unconfirmed', value: tCsEngaged, valueClassName: 'text-cyan-600 dark:text-cyan-400' },
                { label: 'Confirmed', value: tConfirmed, valueClassName: 'text-brand-600 dark:text-brand-400' },
                {
                  label: <span className="flex items-center">Delivered<FunnelInfoIcon onClick={() => setBreakdownModal('totalDelivered')} /></span>,
                  value: tileValue(tDeliveredOnly, revScopeTotal('delivered')),
                  valueClassName: 'text-success-600 dark:text-success-400',
                },
                {
                  label: <span className="flex items-center">Remitted<FunnelInfoIcon onClick={() => setBreakdownModal('totalRemitted')} /></span>,
                  value: tileValue(tRemitted, revScopeTotal('remitted')),
                  valueClassName: 'text-green-600 dark:text-green-400',
                },
                { label: 'CR', value: `${computedCR.toFixed(1)}%`, valueClassName: confirmationRateColorClass(computedCR) },
                { label: 'DR', value: `${computedDR.toFixed(1)}%`, valueClassName: deliveryRateColorClass(computedDR) },
                { label: 'Deleted', value: tDeleted, valueClassName: 'text-danger-600 dark:text-danger-400' },
              ]}
            />
            <FunnelBreakdownModal
              open={breakdownModal === 'totalBreakdown'}
              onClose={() => setBreakdownModal(null)}
              title="Total Orders: Breakdown"
              description="Funnel orders at all statuses. All other categories count delivered orders only."
              lines={(() => {
                // tTotal from tSc (onlyGraduateNonMarketing): marketing orders at all statuses,
                // everything else only at DELIVERED/REMITTED. Use deliveredBySource to break
                // down the non-funnel portion by source.
                const d = deliveredBySource.delivered;
                const r = deliveredBySource.remitted;
                const offDelivered = (d['offline'] ?? 0) + (r['offline'] ?? 0);
                const fuDelivered = (d['follow-up'] ?? 0) + (r['follow-up'] ?? 0);
                const cartDelivered = (d['online'] ?? 0) + (r['online'] ?? 0);
                const dfuDelivered = (d['delivered_follow_up'] ?? 0) + (r['delivered_follow_up'] ?? 0);
                const brkFunnel = tTotal - offDelivered - fuDelivered - cartDelivered - dfuDelivered;
                return [
                  { label: 'Funnel Orders', value: Math.max(0, brkFunnel) },
                  { label: 'Offline Orders (delivered only)', value: offDelivered, muted: true },
                  { label: 'Follow-Up Orders (delivered only)', value: fuDelivered, muted: true },
                  { label: 'Cart Orders (delivered only)', value: cartDelivered, muted: true },
                  { label: 'Delivered Follow-Up (delivered only)', value: dfuDelivered, muted: true },
                  { label: 'Total', value: tTotal, bold: true },
                ];
              })()}
            />
            <FunnelBreakdownModal
              open={breakdownModal === 'totalDelivered'}
              onClose={() => setBreakdownModal(null)}
              title="Delivered: Breakdown"
              description="Orders at Delivered status, by source category."
              lines={(() => {
                // From getDeliveredBySource — orders table only, broken down by order_source.
                const d = deliveredBySource.delivered;
                return [
                  { label: 'Funnel Orders', value: d['edge-form'] ?? 0 },
                  { label: 'Offline Orders', value: d['offline'] ?? 0 },
                  { label: 'Follow-Up Orders', value: d['follow-up'] ?? 0 },
                  { label: 'Cart Orders', value: d['online'] ?? 0 },
                  { label: 'Delivered Follow-Up', value: d['delivered_follow_up'] ?? 0 },
                  { label: 'Total', value: tDeliveredOnly, bold: true },
                ];
              })()}
            />
            <FunnelBreakdownModal
              open={breakdownModal === 'totalRemitted'}
              onClose={() => setBreakdownModal(null)}
              title="Remitted: Breakdown"
              description="Orders where cash has been collected and confirmed."
              lines={(() => {
                const r = deliveredBySource.remitted;
                return [
                  { label: 'Funnel Orders', value: r['edge-form'] ?? 0 },
                  { label: 'Offline Orders', value: r['offline'] ?? 0 },
                  { label: 'Follow-Up Orders', value: r['follow-up'] ?? 0 },
                  { label: 'Cart Orders', value: r['online'] ?? 0 },
                  { label: 'Delivered Follow-Up', value: r['delivered_follow_up'] ?? 0 },
                  { label: 'Total', value: tRemitted, bold: true },
                ];
              })()}
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
        const deliveredOnly = sc['DELIVERED'] ?? 0;
        const remitted = sc['REMITTED'] ?? 0;
        const delivered = deliveredOnly + remitted;
        const deleted = sc['DELETED'] ?? 0;
        const confirmedAndBeyond = confirmed + delivered;
        const confirmationRate = ordersTotal > 0 ? (confirmedAndBeyond / ordersTotal) * 100 : 0;
        const deliveryRate = ordersTotal > 0 ? (delivered / ordersTotal) * 100 : 0;
        return (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
                Order Funnel
              </h2>
              <OverviewStatStrip
                mobileGrid
                tileClassName="!py-2.5"
                items={[
                  {
                    label: <span className="flex items-center">Total<FunnelInfoIcon onClick={() => setBreakdownModal('mktTotal')} /></span>,
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
                    value: tileValue(deliveredOnly, revAmount('delivered', 'edge-form')),
                    valueClassName: 'text-success-600 dark:text-success-400',
                    to: marketingLink({ status: 'DELIVERED' }),
                  },
                  {
                    label: 'Remitted',
                    value: tileValue(remitted, revAmount('remitted', 'edge-form')),
                    valueClassName: 'text-green-600 dark:text-green-400',
                  },
                  {
                    label: 'CR',
                    value: pct(confirmationRate),
                    valueClassName: confirmationRateColorClass(confirmationRate),
                    title: 'Confirmation Rate: confirmed-or-beyond / total',
                  },
                  {
                    label: 'DR',
                    value: pct(deliveryRate),
                    valueClassName: deliveryRateColorClass(deliveryRate),
                    title: 'Delivery Rate: delivered / total',
                  },
                  {
                    label: 'Deleted',
                    value: deleted,
                    valueClassName: 'text-danger-600 dark:text-danger-400',
                    to: marketingLink({ status: 'DELETED' }),
                  },
                ]}
              />
              <FunnelBreakdownModal
                open={breakdownModal === 'mktTotal'}
                onClose={() => setBreakdownModal(null)}
                title="Marketing Total: Breakdown"
                description="Funnel orders from marketing forms only. Excludes offline, follow-up, and cart orders."
                lines={[
                  { label: 'Form orders (edge-form)', value: ordersTotal },
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
                      { label: 'Delivered', value: tileValue(cartSc['DELIVERED'] ?? 0, revAmount('delivered', 'online')), valueClassName: 'text-success-600 dark:text-success-400', to: cartOrdersLink({ status: 'DELIVERED' }) },
                      { label: 'Remitted', value: tileValue(cartSc['REMITTED'] ?? 0, revAmount('remitted', 'online')), valueClassName: 'text-green-600 dark:text-green-400' },
                      { label: 'CR', value: pct(cartCR), valueClassName: confirmationRateColorClass(cartCR) },
                      { label: 'DR', value: pct(cartDR), valueClassName: deliveryRateColorClass(cartDR) },
                      { label: 'Deleted', value: cartSc['DELETED'] ?? 0, valueClassName: 'text-danger-600 dark:text-danger-400', to: cartOrdersLink({ status: 'DELETED' }) },
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
              const offDeliveredOnly = offSc['DELIVERED'] ?? 0;
              const offRemitted = offSc['REMITTED'] ?? 0;
              const offDelivered = offDeliveredOnly + offRemitted;
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
                        value: tileValue(offDeliveredOnly, revAmount('delivered', 'offline')),
                        valueClassName: 'text-success-600 dark:text-success-400',
                        to: offlineLink({ status: 'DELIVERED' }),
                      },
                      {
                        label: 'Remitted',
                        value: tileValue(offRemitted, revAmount('remitted', 'offline')),
                        valueClassName: 'text-green-600 dark:text-green-400',
                      },
                      {
                        label: 'CR',
                        value: pct(offCR),
                        valueClassName: confirmationRateColorClass(offCR),
                        title: 'Confirmation Rate: confirmed-or-beyond / total',
                      },
                      {
                        label: 'DR',
                        value: pct(offDR),
                        valueClassName: deliveryRateColorClass(offDR),
                        title: 'Delivery Rate: delivered / total',
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
        const deliveredOnly = sc['DELIVERED'] ?? 0;
        const remitted = sc['REMITTED'] ?? 0;
        const delivered = deliveredOnly + remitted;
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
                  value: tileValue(deliveredOnly, revAmount('delivered', 'follow-up')),
                  valueClassName: 'text-success-600 dark:text-success-400',
                  to: followUpLink({ status: 'DELIVERED' }),
                },
                {
                  label: 'Remitted',
                  value: tileValue(remitted, revAmount('remitted', 'follow-up')),
                  valueClassName: 'text-green-600 dark:text-green-400',
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
        const dfuDeliveredOnly = sc['DELIVERED'] ?? 0;
        const dfuRemitted = sc['REMITTED'] ?? 0;
        const dfuDelivered = dfuDeliveredOnly + dfuRemitted;
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
                { label: 'Delivered', value: tileValue(dfuDeliveredOnly, revAmount('delivered', 'delivered_follow_up')), valueClassName: 'text-success-600 dark:text-success-400', to: dfuLink({ status: 'DELIVERED' }) },
                { label: 'Remitted', value: tileValue(dfuRemitted, revAmount('remitted', 'delivered_follow_up')), valueClassName: 'text-green-600 dark:text-green-400' },
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
              label: 'Ad Spend',
              value: fmt(marketingSafe.approvedSpend),
              valueClassName: 'text-danger-600 dark:text-danger-400',
              title:
                marketingSafe.pendingSpend > 0
                  ? `Approved ad spend (basis for CPA/ROAS). Pending unapproved: ${fmt(marketingSafe.pendingSpend)}`
                  : 'Approved ad spend (basis for CPA/ROAS)',
              to: '/admin/marketing/expenses',
            },
            ...(marketingSafe.pendingSpend > 0
              ? [{
                  label: 'Pending Spend',
                  value: fmt(marketingSafe.pendingSpend),
                  valueClassName: 'text-warning-600 dark:text-warning-400' as const,
                  title: 'Unapproved ad spend: excluded from CPA and ROAS',
                  to: '/admin/marketing/expenses',
                }]
              : []),
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
        // Same source as TOTAL ORDERS Remitted / Delivered (onlyGraduateNonMarketing)
        // so these tiles match Cash Remittances for the same date range.
        const remittanceSc = orderPipeline.totalOrdersCounts ?? {};
        const remitted = remittanceSc['REMITTED'] ?? 0;
        const awaitingRemittance = remittanceSc['DELIVERED'] ?? 0;
        const remittancesHref = buildLink('/admin/finance/delivery-remittances');
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
                    title: 'Orders fully remitted (same count as Cash Remittances Remitted)',
                    to: remittancesHref,
                  },
                  {
                    label: 'Awaiting Remittance',
                    value: awaitingRemittance.toLocaleString(),
                    valueClassName: awaitingRemittance > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg-muted',
                    title: 'Delivered but not yet remitted (same as Cash Remittances Awaiting)',
                    to: remittancesHref,
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

