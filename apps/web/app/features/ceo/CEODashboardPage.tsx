import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useSearchParams, useFetcher, useRevalidator } from '@remix-run/react';
import { useToast } from '~/components/ui/toast';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, Area, XAxis, YAxis, CartesianGrid, Line, ComposedChart, BarChart, Bar } from 'recharts';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { StatRow, StatRowGroup } from '~/components/ui/stat-row';
import { Spinner } from '~/components/ui/spinner';
import { OrdersChartViewShellSkeleton } from '~/components/ui/deferred-skeletons';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { FormSelect } from '~/components/ui/form-select';
import { FilterPills } from '~/components/ui/filter-pills';
import { StatusBadge } from '~/components/ui/status-badge';
import { formatNaira } from '~/lib/format-amount';
import { STATUS_HEX, STATUS_LABELS, STATUS_OPTIONS, STATUS_TEXT_CLASS } from '~/features/shared/order-status';
import type { CEODashboardData, CEODashboardFilters, ChartDataPayload } from './types';

/**
 * The CEO's six top-level order buckets (CEO directive 2026-05-09):
 * Unassigned, Assigned, Unconfirmed, Confirmed, Delivered, Cash Remitted.
 * Logistics sub-stages and exception states are intentionally hidden from the
 * pipeline pill / pie chart on this dashboard — they're still visible in the
 * timeline and detail views. See order-status.ts for the source-of-truth list.
 */
const CEO_VISIBLE_STATUSES = new Set(STATUS_OPTIONS.filter((s) => s !== 'ALL'));

function buildChartDataUrl(filters: CEODashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.periodAllTime) params.set('period', 'all_time');
  if (filters.topic) params.set('topic', filters.topic);
  const qs = params.toString();
  return `/admin/chart-data${qs ? `?${qs}` : ''}`;
}

/** Renders children only on the client to avoid Recharts SSR dimension warnings. */
function ClientOnly({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : <>{fallback}</>;
}

/** Hex colors for cost breakdown donut */
const COST_COLORS_HEX = ['#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#b91c1c'] as const;

/** Order pipeline chart stage colors (funnel: volume → delivered) */
const PIPELINE_CHART_COLORS = ['#6366f1', '#0284c7', '#4f46e5', '#0ea5e9', '#059669'] as const;

function fmt(n: number): string {
  return formatNaira(Math.round(n));
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

interface BranchBreakdownRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  totalOrders: number;
  deliveredOrders: number;
  activeOrders: number;
}

export interface CEODashboardPageProps {
  data: CEODashboardData;
  filters?: CEODashboardFilters;
  showBackToDashboard?: boolean;
  branchBreakdown?: BranchBreakdownRow[];
  /**
   * Which branch column drives the Branch Breakdown table. Mirrors `?branchScope`
   * in the URL; flipping the FilterPills toggle below the table writes the
   * search param and triggers a loader revalidation.
   */
  branchScope?: 'marketing' | 'servicing';
}

export function CEODashboardPage({
  data,
  filters = { startDate: '', endDate: '', periodAllTime: false },
  showBackToDashboard = true,
  branchBreakdown,
  branchScope = 'marketing',
}: CEODashboardPageProps) {
  const [showChartView, setShowChartView] = useState(false);
  const [_searchParams, setSearchParams] = useSearchParams();
  const handleBranchScopeChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'servicing') next.set('branchScope', 'servicing');
        else next.delete('branchScope');
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  };
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;
  const fetcher = useFetcher<ChartDataPayload>();
  const refreshFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    refreshedAt?: string;
    durationMs?: number;
    failedViews?: string[];
  }>();
  const revalidator = useRevalidator();
  const { toast } = useToast();
  const topic = filters?.topic ?? 'orders';
  const isRefreshing = refreshFetcher.state !== 'idle';

  const branchBreakdownColumns: CompactTableColumn<BranchBreakdownRow>[] = useMemo(
    () => [
      {
        key: 'branch',
        header: 'Branch',
        render: (branch) => (
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-primary-100 text-micro font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
              {branch.branchCode.slice(0, 2)}
            </span>
            <div>
              <p className="font-medium text-app-fg">{branch.branchName}</p>
              <p className="text-micro text-app-fg-muted">{branch.branchCode}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'totalOrders',
        header: 'Total Orders',
        align: 'right',
        render: (branch) => (
          <span className="font-medium text-app-fg">{branch.totalOrders.toLocaleString()}</span>
        ),
      },
      {
        key: 'activeOrders',
        header: 'Active',
        align: 'right',
        render: (branch) => (
          <span className="text-app-fg-muted">{branch.activeOrders.toLocaleString()}</span>
        ),
      },
      {
        key: 'deliveredOrders',
        header: 'Delivered',
        align: 'right',
        render: (branch) => (
          <span className="font-medium text-success-700 dark:text-success-300">
            {branch.deliveredOrders.toLocaleString()}
          </span>
        ),
      },
      {
        key: 'deliveryRate',
        header: 'Delivery Rate',
        align: 'right',
        render: (branch) => {
          const deliveryRate =
            branch.totalOrders > 0 ? Math.round((branch.deliveredOrders / branch.totalOrders) * 100) : 0;
          return (
            <StatusBadge
              status="delivery_rate"
              variant={deliveryRate >= 70 ? 'success' : deliveryRate >= 40 ? 'warning' : 'neutral'}
              label={`${deliveryRate}%`}
              size="sm"
            />
          );
        },
      },
    ],
    [],
  );

  // Auto-trigger a refresh on first mount so visiting the page is the trigger to regenerate
  // the report. Show the progress banner while the server is recomputing the materialized
  // views, then revalidate the loader once it lands so the page re-reads with fresh numbers.
  // The ref guard ensures we fire once per page load — not on every revalidation, filter
  // change, or re-render.
  const hasAutoRefreshedRef = useRef(false);
  useEffect(() => {
    if (hasAutoRefreshedRef.current) return;
    hasAutoRefreshedRef.current = true;
    refreshFetcher.submit({ intent: 'refreshExecutiveData' }, { method: 'post' });
  }, [refreshFetcher]);

  // When the refresh mutation lands, revalidate the loader so the page re-reads from the
  // now-fresh materialized views, then surface a quiet toast on manual triggers. We watch
  // refreshFetcher.data with a flag so the effect fires once per response.
  const [lastRefreshSeen, setLastRefreshSeen] = useState<unknown>(null);
  useEffect(() => {
    if (refreshFetcher.state !== 'idle' || !refreshFetcher.data) return;
    if (refreshFetcher.data === lastRefreshSeen) return;
    setLastRefreshSeen(refreshFetcher.data);
    if (refreshFetcher.data.success) {
      revalidator.revalidate();
    } else if (refreshFetcher.data.error) {
      toast.error('Refresh failed', refreshFetcher.data.error);
    }
  }, [refreshFetcher.state, refreshFetcher.data, lastRefreshSeen, revalidator, toast]);

  useEffect(() => {
    if (showChartView) {
      fetcher.load(buildChartDataUrl(filters));
    }
  }, [showChartView, filters.startDate, filters.endDate, filters.periodAllTime, filters.topic]);

  const chartDisplayData: CEODashboardData =
    showChartView && fetcher.data && !fetcher.data.error
      ? { ...data, ...fetcher.data }
      : data;
  const isChartLoading = showChartView && fetcher.state === 'loading' && !fetcher.data;
  const revenue = data?.revenue ?? 0;
  const trueProfit = data?.trueProfit ?? 0;
  const margin = data?.margin ?? 0;
  const { costBreakdown: rawCostBreakdown, orderPipeline: rawOrderPipeline, marketing, csTeam, payroll } = data ?? {};
  // Defensive: ensure nested objects are always defined (API may return partial data or fail)
  const costBreakdown = {
    landedCost: rawCostBreakdown?.landedCost ?? 0,
    deliveryFee: rawCostBreakdown?.deliveryFee ?? 0,
    adSpend: rawCostBreakdown?.adSpend ?? 0,
    commission: rawCostBreakdown?.commission ?? 0,
    fulfillmentCost: rawCostBreakdown?.fulfillmentCost ?? 0,
    operationalLoss: rawCostBreakdown?.operationalLoss ?? 0,
  };
  const orderPipeline = {
    total: rawOrderPipeline?.total ?? 0,
    active: rawOrderPipeline?.active ?? 0,
    delivered: rawOrderPipeline?.delivered ?? 0,
    cancelled: rawOrderPipeline?.cancelled ?? 0,
    returned: rawOrderPipeline?.returned ?? 0,
    statusCounts: rawOrderPipeline?.statusCounts ?? {},
  };
  const marketingSafe = {
    totalSpend: marketing?.totalSpend ?? 0,
    cpa: marketing?.cpa ?? 0,
    roas: marketing?.roas ?? 0,
    deliveryRate: marketing?.deliveryRate ?? 0,
  };
  const csTeamSafe = {
    agentCount: csTeam?.agentCount ?? 0,
    pendingOrders: csTeam?.pendingOrders ?? 0,
    utilization: csTeam?.utilization ?? 0,
  };
  const payrollSafe = {
    staffCount: payroll?.staffCount ?? 0,
    totalPaid: payroll?.totalPaid ?? 0,
    totalPending: payroll?.totalPending ?? 0,
  };
  const totalCosts =
    costBreakdown.landedCost +
    costBreakdown.deliveryFee +
    costBreakdown.adSpend +
    costBreakdown.commission +
    costBreakdown.fulfillmentCost +
    costBreakdown.operationalLoss;

  // CEO-requested widgets (2026-05-18). Deliveries-per-Brand and
  // Stock-Available-per-Product were removed from this view on 2026-05-19;
  // backend still returns them but the dashboard no longer renders them.
  const revenueByPeriod = data?.revenueByPeriod ?? { today: 0, thisWeek: 0, thisMonth: 0 };
  const activeStaffCount = data?.activeStaffCount ?? 0;

  return (
    <div className="space-y-6">
      {/* Page header: title and subtitle first, then filters/actions below */}
      <PageHeader
        title="Executive Overview"
        mobileInlineActions
        description="Real-time business intelligence across all departments."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Executive overview tools"
            sheetSubtitle={<span>Date range, chart toggle &amp; refresh</span>}
            triggerAriaLabel="Executive overview toolbar"
            desktop={
              <>
                <button
                  type="button"
                  onClick={() => setShowChartView((v) => !v)}
                  className="btn-secondary btn-sm"
                >
                  {showChartView ? 'View as data' : 'View data in chart'}
                </button>
                {/* Refresh — recomputes the finance materialized views (revenue, profit, ad spend,
                    commission rollups). The page never auto-refreshes. */}
                <refreshFetcher.Form method="post" className="inline-flex">
                  <input type="hidden" name="intent" value="refreshExecutiveData" />
                  <button
                    type="submit"
                    disabled={isRefreshing}
                    className="btn-secondary btn-sm inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Recompute revenue, profit, ad spend, and commission rollups from live data"
                  >
                    {isRefreshing ? (
                      <>
                        <Spinner size="sm" />
                        Refreshing…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                        Refresh data
                      </>
                    )}
                  </button>
                </refreshFetcher.Form>
                <DateFilterBar startDate={filters.startDate} endDate={filters.endDate} periodAllTime={filters.periodAllTime ?? false} chrome="pill" />
                {showBackToDashboard && (
                  <Link to="/admin" className="btn-secondary btn-sm">Back to Dashboard</Link>
                )}
              </>
            }
            sheet={({ closeSheet }) => (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    closeSheet();
                    setShowChartView((v) => !v);
                  }}
                  className="btn-secondary btn-sm w-full justify-center"
                >
                  {showChartView ? 'View as data' : 'View data in chart'}
                </button>
                <refreshFetcher.Form method="post" className="block">
                  <input type="hidden" name="intent" value="refreshExecutiveData" />
                  <button
                    type="submit"
                    disabled={isRefreshing}
                    className="btn-secondary btn-sm w-full justify-center inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isRefreshing ? (
                      <>
                        <Spinner size="sm" />
                        Refreshing…
                      </>
                    ) : (
                      'Refresh data'
                    )}
                  </button>
                </refreshFetcher.Form>
                {showBackToDashboard && (
                  <Link to="/admin" className="btn-secondary btn-sm w-full justify-center">
                    Back to Dashboard
                  </Link>
                )}
              </div>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime ?? false}
      />

      {/* Regenerating-report banner — visible while the auto-trigger or a manual click is
          recomputing the finance materialized views. Existing data stays readable below; the
          page silently revalidates with fresh numbers when the bar finishes. */}
      {isRefreshing && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-brand-200 bg-brand-50 dark:border-brand-700/60 dark:bg-brand-900/20 overflow-hidden"
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <Spinner size="sm" className="text-brand-600 dark:text-brand-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-brand-700 dark:text-brand-300">
                Regenerating report…
              </p>
              <p className="text-xs text-brand-600/80 dark:text-brand-400/80 mt-0.5">
                Recomputing revenue, profit, ad spend, and commission rollups from live data. Existing numbers stay visible until the new ones arrive.
              </p>
            </div>
          </div>
          {/* Indeterminate progress bar. CSS animation defined in tailwind.css; falls back
              to a static brand-coloured stripe if the keyframe isn't picked up. */}
          <div className="h-1 bg-brand-100 dark:bg-brand-900/40 overflow-hidden">
            <div className="h-full w-1/3 bg-brand-500 dark:bg-brand-400 animate-indeterminate-progress" />
          </div>
        </div>
      )}

      {/* ── Chart view: all charts (Revenue & orders over time, pipeline, topic, cost, etc.) ───────────────── */}
      {showChartView && (
      <>
      {isChartLoading ? (
        <OrdersChartViewShellSkeleton />
      ) : (
      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[24rem]">
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Revenue & orders over time
        </h2>
        <div className="card">
          <p className="text-sm text-app-fg-muted mb-4">
            <strong>Revenue</strong> and <strong>Orders delivered</strong> are by delivery date. <strong>Orders created</strong> shows daily order volume (any status) so the chart has data even before deliveries.
          </p>
          {chartDisplayData.timeSeries && chartDisplayData.timeSeries.length > 0 ? (
            <div className="h-72 min-h-[288px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-72 min-h-[288px] w-full animate-pulse rounded bg-app-hover" />}>
              <div className="h-full min-h-[288px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartDisplayData.timeSeries} margin={{ top: 8, right: 32, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-surface-200 dark:stroke-surface-700" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => (typeof v === 'string' ? v.slice(0, 10) : v)}
                    />
                    <YAxis yAxisId="revenue" orientation="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px' }}
                      labelFormatter={(label) => (typeof label === 'string' ? label : String(label))}
                      formatter={((value: number | undefined, name: string) => [
                        name === 'Revenue' ? fmt(value ?? 0) : (value ?? 0),
                        name,
                      ]) as never}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Legend />
                    <Area
                      yAxisId="revenue"
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      fill="#4f46e5"
                      stroke="#4f46e5"
                      fillOpacity={0.4}
                    />
                    <Line
                      yAxisId="orders"
                      type="monotone"
                      dataKey="orderCount"
                      name="Orders delivered"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      yAxisId="orders"
                      type="monotone"
                      dataKey="createdCount"
                      name="Orders created"
                      stroke="#0284c7"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              </ClientOnly>
            </div>
          ) : (
            <div className="h-72 min-h-[288px] flex flex-col items-center justify-center gap-2 rounded-lg bg-app-hover text-app-fg-muted text-sm text-center px-4">
              <p className="font-medium">No orders in this period.</p>
              <p className="text-xs max-w-md">
                Revenue and &quot;Orders delivered&quot; appear when orders are marked Delivered. &quot;Orders created&quot; shows daily volume (any status). Try &quot;All time&quot; or a wider date range.
              </p>
            </div>
          )}
        </div>
      </div>
      </TableLoadingOverlay>
      )}
      </>
      )}

      {/* ── Data view: KPIs, lists, grids (no charts) ─────────────────────── */}
      {!showChartView && (
        <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[20rem]">
        <>
      {/* ── HERO: ROAS on Ad Spend (CEO priority #1) ────────── */}
      <div className="card">
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
              <p className="text-mini font-medium text-app-fg-muted">Revenue</p>
              <p className="text-base font-bold text-app-fg tabular-nums">{fmt(revenue)}</p>
            </div>
            <div className="rounded-lg bg-app-elevated px-4 py-2.5 text-center min-w-[5.5rem]">
              <p className="text-mini font-medium text-app-fg-muted">Ad Spend</p>
              <p className="text-base font-bold text-danger-600 dark:text-danger-400 tabular-nums">{fmt(marketingSafe.totalSpend)}</p>
            </div>
            <div className="rounded-lg bg-app-elevated px-4 py-2.5 text-center min-w-[5.5rem]">
              <p className="text-mini font-medium text-app-fg-muted">Profit</p>
              <p className={`text-base font-bold tabular-nums ${trueProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>{fmt(trueProfit)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Revenue Generated: Day / Week / Month — stacked column ── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Revenue Generated
        </h2>
        <div className="card px-4 py-2">
          <StatRowGroup divided>
            <StatRow label="Today" value={fmt(revenueByPeriod.today)} />
            <StatRow label="This Week" value={fmt(revenueByPeriod.thisWeek)} />
            <StatRow label="This Month" value={fmt(revenueByPeriod.thisMonth)} />
            <StatRow label="Period Total" value={fmt(revenue)} variant="highlight" />
          </StatRowGroup>
        </div>
      </div>

      {/* ── Key Metrics: stacked column ── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Key Metrics
        </h2>
        <div className="card px-4 py-2">
          <StatRowGroup divided>
            <StatRow label="Ad Spend" value={fmt(marketingSafe.totalSpend)} variant="deduction" />
            <StatRow label="Order Count" value={orderPipeline.total.toLocaleString()} />
            <StatRow
              label="CPA"
              value={fmt(marketingSafe.cpa)}
              variant={
                marketingSafe.cpa > 0 && marketingSafe.cpa < 3000
                  ? 'highlight'
                  : marketingSafe.cpa >= 6000
                    ? 'deduction'
                    : 'default'
              }
            />
            <StatRow
              label="Delivery Rate"
              value={pct(marketingSafe.deliveryRate)}
              variant={
                marketingSafe.deliveryRate >= 70
                  ? 'highlight'
                  : marketingSafe.deliveryRate >= 50
                    ? 'default'
                    : 'deduction'
              }
            />
            <StatRow label="Active Staff" value={activeStaffCount.toLocaleString()} />
          </StatRowGroup>
        </div>
      </div>

      {/* ── Revenue & Profit (existing detail) ────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Revenue & Profit Detail
        </h2>
        <OverviewStatStrip
          mobileGrid
          items={[
            { label: 'Revenue', value: fmt(revenue), valueClassName: 'text-app-fg tabular-nums' },
            {
              label: 'True Profit',
              value: fmt(trueProfit),
              valueClassName:
                trueProfit >= 0 ? 'text-success-600 dark:text-success-400 tabular-nums' : 'text-danger-600 dark:text-danger-400 tabular-nums',
            },
            {
              label: 'Net Margin',
              value: pct(margin),
              valueClassName:
                margin >= 20
                  ? 'text-success-600 dark:text-success-400 tabular-nums'
                  : margin > 0
                    ? 'text-warning-600 dark:text-warning-400 tabular-nums'
                    : 'text-danger-600 dark:text-danger-400 tabular-nums',
            },
            { label: 'Total Costs', value: fmt(totalCosts), valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums' },
          ]}
        />
      </div>

      {/* ── Cost Breakdown + Profit Waterfall ───── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-4">
            Cost Breakdown
          </h2>
          {showChartView && !isChartLoading && (
          <div className="mb-4 h-48 min-h-[192px] w-full">
            <ClientOnly fallback={<div className="h-full min-h-[192px] animate-pulse rounded bg-app-hover" />}>
            <div className="h-full min-h-[192px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={
                    totalCosts > 0
                      ? [
                          { name: 'Landed COGS', value: costBreakdown.landedCost },
                          { name: 'Delivery Fees', value: costBreakdown.deliveryFee },
                          { name: 'Ad Spend', value: costBreakdown.adSpend },
                          { name: 'Commission', value: costBreakdown.commission },
                          { name: 'Fulfillment', value: costBreakdown.fulfillmentCost },
                          { name: 'Op. Loss', value: costBreakdown.operationalLoss },
                        ].filter((d) => d.value > 0)
                      : [{ name: 'No cost data', value: 1 }]
                  }
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={totalCosts > 0 ? 2 : 0}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => (totalCosts > 0 ? `${name} ${((percent ?? 0) * 100).toFixed(0)}%` : name)}
                >
                  {totalCosts > 0
                    ? [
                        costBreakdown.landedCost,
                        costBreakdown.deliveryFee,
                        costBreakdown.adSpend,
                        costBreakdown.commission,
                        costBreakdown.fulfillmentCost,
                        costBreakdown.operationalLoss,
                      ]
                        .filter((v) => v > 0)
                        .map((_, i) => (
                          <Cell key={i} fill={COST_COLORS_HEX[i % COST_COLORS_HEX.length]} />
                        ))
                    : [<Cell key="empty" fill="#94a3b8" />]}
                </Pie>
                <Tooltip
                  formatter={(value: number | undefined) => [totalCosts > 0 ? fmt(value ?? 0) : '—', 'Amount']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-surface-200)' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            </div>
            </ClientOnly>
          </div>
          )}
          <div className="space-y-3">
            <CostRow label="Landed COGS" value={costBreakdown.landedCost} total={totalCosts} />
            <CostRow label="Delivery Fees" value={costBreakdown.deliveryFee} total={totalCosts} />
            <CostRow label="Ad Spend" value={costBreakdown.adSpend} total={totalCosts} />
            <CostRow label="Commission" value={costBreakdown.commission} total={totalCosts} />
            <CostRow label="Fulfillment" value={costBreakdown.fulfillmentCost} total={totalCosts} />
            <CostRow label="Operational Loss" value={costBreakdown.operationalLoss} total={totalCosts} />
            <div className="pt-3 border-t border-app-border">
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-app-fg">Total Costs</span>
                <span className="text-sm font-bold text-danger-600 dark:text-danger-400">{fmt(totalCosts)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-4">
            Profit Waterfall
          </h2>
          <div className="space-y-2">
            <WaterfallRow label="Revenue" value={revenue} type="neutral" />
            <WaterfallRow label="Landed COGS" value={-costBreakdown.landedCost} type="neutral" />
            <WaterfallRow label="Delivery Fees" value={-costBreakdown.deliveryFee} type="neutral" />
            <WaterfallRow label="Ad Spend" value={-costBreakdown.adSpend} type="neutral" />
            <WaterfallRow label="Commission" value={-costBreakdown.commission} type="neutral" />
            <WaterfallRow label="Fulfillment" value={-costBreakdown.fulfillmentCost} type="neutral" />
            <WaterfallRow label="Op. Loss" value={-costBreakdown.operationalLoss} type="neutral" />
            <div className="pt-3 border-t-2 border-app-border">
              <WaterfallRow
                label="True Profit"
                value={trueProfit}
                type={trueProfit >= 0 ? 'positive' : 'negative'}
                bold
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: Order Pipeline ─────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
          Order Pipeline
        </h2>

        {/* Order pipeline chart: Volume → Unconfirmed → Confirmed → Logistics distributed → Delivered (chart view only) */}
        {showChartView && !isChartLoading && (
        <div className="card mb-4">
          <h3 className="text-base font-semibold text-app-fg mb-2">Order funnel</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            Volume, Unconfirmed, Confirmed, Logistics distributed, and Delivered for the selected period.
          </p>
          <div className="h-64 min-h-[256px] w-full">
            <ClientOnly fallback={<div className="h-full min-h-[256px] animate-pulse rounded bg-app-hover" />}>
            <div className="h-full min-h-[256px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={[
                  { stage: 'Volume', count: chartDisplayData.orderPipelineChart?.volume ?? 0, fill: PIPELINE_CHART_COLORS[0] },
                  { stage: 'Unconfirmed', count: chartDisplayData.orderPipelineChart?.unconfirmed ?? 0, fill: PIPELINE_CHART_COLORS[1] },
                  { stage: 'Confirmed', count: chartDisplayData.orderPipelineChart?.confirmed ?? 0, fill: PIPELINE_CHART_COLORS[2] },
                  { stage: 'Logistics distributed', count: chartDisplayData.orderPipelineChart?.logisticsDistributed ?? 0, fill: PIPELINE_CHART_COLORS[3] },
                  { stage: 'Delivered', count: chartDisplayData.orderPipelineChart?.delivered ?? 0, fill: PIPELINE_CHART_COLORS[4] },
                ]}
                margin={{ top: 8, right: 24, left: 100, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-surface-200 dark:stroke-surface-700" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="stage" width={96} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number | undefined) => [value ?? 0, 'Orders']}
                  contentStyle={{ borderRadius: '8px' }}
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                />
                <Bar dataKey="count" name="Orders" radius={[0, 4, 4, 0]} minPointSize={4}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Cell key={i} fill={PIPELINE_CHART_COLORS[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
            </ClientOnly>
          </div>
        </div>
        )}

        <div className="card">
          <h3 className="text-sm font-semibold text-app-fg mb-3">Status Distribution</h3>
          {showChartView && !isChartLoading && (
          <div className="mb-4 h-52 min-h-[208px] w-full">
            <ClientOnly fallback={<div className="h-full min-h-[208px] animate-pulse rounded bg-app-hover" />}>
            <div className="h-full min-h-[208px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={
                    orderPipeline.total > 0
                      ? Object.entries(orderPipeline.statusCounts)
                          .filter(([status, count]) => CEO_VISIBLE_STATUSES.has(status) && count > 0)
                          .sort(([, a], [, b]) => b - a)
                          .map(([status, value]) => ({
                            name: STATUS_LABELS[status] ?? status.replace(/_/g, ' '),
                            value,
                            fill: STATUS_HEX[status] ?? '#64748b',
                          }))
                      : [{ name: 'No orders', value: 1 }]
                  }
                  cx="50%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={88}
                  paddingAngle={orderPipeline.total > 0 ? 2 : 0}
                  dataKey="value"
                  nameKey="name"
                >
                  {orderPipeline.total > 0
                    ? Object.entries(orderPipeline.statusCounts)
                        .filter(([status, count]) => CEO_VISIBLE_STATUSES.has(status) && count > 0)
                        .sort(([, a], [, b]) => b - a)
                        .map(([status]) => (
                          <Cell key={status} fill={STATUS_HEX[status] ?? '#64748b'} />
                        ))
                    : [<Cell key="empty" fill="#94a3b8" />]}
                </Pie>
                <Tooltip
                  formatter={(value: number | undefined) => [orderPipeline.total > 0 ? (value ?? 0) : '—', 'Orders']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-surface-200)' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            </div>
            </ClientOnly>
          </div>
          )}
          <OverviewStatStrip
            mobileGrid
            embedded
            showScrollControls={
              Object.entries(orderPipeline.statusCounts).filter(([s, c]) => CEO_VISIBLE_STATUSES.has(s) && c > 0).length > 4
            }
            tileClassName="min-w-[5.5rem]"
            items={Object.entries(orderPipeline.statusCounts)
              .filter(([status, count]) => CEO_VISIBLE_STATUSES.has(status) && count > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => ({
                label: STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status.replace(/_/g, ' '),
                value: count,
                valueClassName: STATUS_TEXT_CLASS[status] ?? 'text-app-fg',
              }))}
          />
        </div>
      </div>

      {/* ── Section 4: Marketing + CS + Payroll ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Marketing */}
        <div className="card">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-app-fg">Marketing</h2>
            <div className="flex items-center gap-2 text-xs font-medium">
              <Link to="/admin/marketing/funding" className="text-brand-500 hover:text-brand-600">Funding</Link>
              <span className="text-app-fg-muted" aria-hidden>
                ·
              </span>
              <Link to="/admin/marketing/ad-spend" className="text-brand-500 hover:text-brand-600">Ad spend</Link>
            </div>
          </div>
          <div className="space-y-3">
            <MetricRow label="Total Ad Spend" value={fmt(marketingSafe.totalSpend)} />
            <MetricRow
              label="CPA"
              value={fmt(marketingSafe.cpa)}
              highlight={marketingSafe.cpa > 0 && marketingSafe.cpa < 3000 ? 'success' : marketingSafe.cpa >= 6000 ? 'danger' : marketingSafe.cpa >= 3000 ? 'warning' : undefined}
            />
            <MetricRow
              label="True ROAS"
              value={`${marketingSafe.roas.toFixed(2)}x`}
              highlight={marketingSafe.roas >= 2 ? 'success' : marketingSafe.roas >= 1 ? 'warning' : 'danger'}
            />
            <MetricRow
              label="Delivery Rate"
              value={pct(marketingSafe.deliveryRate)}
              highlight={marketingSafe.deliveryRate >= 70 ? 'success' : marketingSafe.deliveryRate >= 50 ? 'warning' : 'danger'}
            />
          </div>
        </div>

        {/* Sales Team */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-app-fg">Sales Team</h2>
            <Link to="/admin/sales/queue" className="text-xs text-brand-500 hover:text-brand-600 font-medium">View details</Link>
          </div>
          <div className="space-y-3">
            <MetricRow label="Agents Active" value={csTeamSafe.agentCount.toString()} />
            <MetricRow
              label="Pipeline backlog"
              value={csTeamSafe.pendingOrders.toString()}
              highlight={csTeamSafe.pendingOrders > 20 ? 'danger' : csTeamSafe.pendingOrders > 10 ? 'warning' : undefined}
            />
            <MetricRow
              label="Avg daily duty"
              value={`${csTeamSafe.utilization}%`}
              highlight={
                csTeamSafe.agentCount === 0
                  ? undefined
                  : csTeamSafe.utilization >= 70
                    ? 'success'
                    : csTeamSafe.utilization >= 40
                      ? 'warning'
                      : 'danger'
              }
            />
            {csTeamSafe.agentCount > 0 && (
              <MetricRow
                label="Avg backlog / agent"
                value={(csTeamSafe.pendingOrders / csTeamSafe.agentCount).toFixed(1)}
              />
            )}
          </div>
        </div>

        {/* Payroll */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-app-fg">Payroll</h2>
            <Link to="/hr/payroll" className="text-xs text-brand-500 hover:text-brand-600 font-medium">View details</Link>
          </div>
          <div className="space-y-3">
            <MetricRow label="Staff Count" value={payrollSafe.staffCount.toString()} />
            <MetricRow label="Total Paid" value={fmt(payrollSafe.totalPaid)} highlight="success" />
            <MetricRow
              label="Pending Payouts"
              value={fmt(payrollSafe.totalPending)}
              highlight={payrollSafe.totalPending > 0 ? 'warning' : undefined}
            />
            <MetricRow
              label="Avg per Staff"
              value={payrollSafe.staffCount > 0 ? fmt((payrollSafe.totalPaid + payrollSafe.totalPending) / payrollSafe.staffCount) : fmt(0)}
            />
          </div>
        </div>
      </div>

      </>
        </TableLoadingOverlay>
      )}

      {/* ── Chart view only: content by topic (Orders / Media buyers / CS) ───────────────── */}
      {showChartView && !isChartLoading && (
      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[16rem]">
      <>
        {/* Topic filter: only visible in chart section */}
        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="chart-topic" className="text-sm font-medium text-app-fg-muted">Chart topic</label>
          <div className="flex items-center gap-2">
            <FormSelect
              id="chart-topic"
              value={topic}
              onChange={(e) => setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('topic', e.target.value);
                return next;
              })}
              disabled={isLoaderRefetchBusy}
              options={[
                { value: 'orders', label: 'Orders' },
                { value: 'media_buyers', label: 'Media buyers' },
                { value: 'cs', label: 'Sales' },
              ]}
            />
          </div>
        </div>

        {topic === 'orders' && (
        <div className="space-y-4">
        {/* Cost Breakdown + Status Distribution (chart always shown above) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="text-lg font-semibold text-app-fg mb-4">Cost Breakdown</h2>
            <div className="h-48 min-h-[192px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-48 min-h-[192px] w-full animate-pulse rounded bg-app-hover" />}>
              <div className="h-full min-h-[192px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      totalCosts > 0
                        ? [
                            { name: 'Landed COGS', value: costBreakdown.landedCost },
                            { name: 'Delivery Fees', value: costBreakdown.deliveryFee },
                            { name: 'Ad Spend', value: costBreakdown.adSpend },
                            { name: 'Commission', value: costBreakdown.commission },
                            { name: 'Fulfillment', value: costBreakdown.fulfillmentCost },
                            { name: 'Op. Loss', value: costBreakdown.operationalLoss },
                          ].filter((d) => d.value > 0)
                        : [{ name: 'No cost data', value: 1 }]
                    }
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={totalCosts > 0 ? 2 : 0}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => (totalCosts > 0 ? `${name} ${((percent ?? 0) * 100).toFixed(0)}%` : name)}
                  >
                    {totalCosts > 0
                      ? [
                          costBreakdown.landedCost,
                          costBreakdown.deliveryFee,
                          costBreakdown.adSpend,
                          costBreakdown.commission,
                          costBreakdown.fulfillmentCost,
                          costBreakdown.operationalLoss,
                        ]
                          .filter((v) => v > 0)
                          .map((_, i) => <Cell key={i} fill={COST_COLORS_HEX[i % COST_COLORS_HEX.length]} />)
                      : [<Cell key="empty" fill="#94a3b8" />]}
                  </Pie>
                  <Tooltip formatter={(v: number | undefined) => [totalCosts > 0 ? fmt(v ?? 0) : '—', '']} contentStyle={{ borderRadius: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
              </div>
              </ClientOnly>
            </div>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold text-app-fg mb-3">Status Distribution</h3>
            <div className="h-52 min-h-[208px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-52 min-h-[208px] w-full animate-pulse rounded bg-app-hover" />}>
              <div className="h-full min-h-[208px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      orderPipeline.total > 0
                        ? Object.entries(orderPipeline.statusCounts)
                            .filter(([status, count]) => CEO_VISIBLE_STATUSES.has(status) && count > 0)
                            .sort(([, a], [, b]) => b - a)
                            .map(([status, value]) => ({
                              name: STATUS_LABELS[status] ?? status.replace(/_/g, ' '),
                              value,
                              fill: STATUS_HEX[status] ?? '#64748b',
                            }))
                        : [{ name: 'No orders', value: 1 }]
                    }
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={88}
                    paddingAngle={orderPipeline.total > 0 ? 2 : 0}
                    dataKey="value"
                    nameKey="name"
                  >
                    {orderPipeline.total > 0
                      ? Object.entries(orderPipeline.statusCounts)
                          .filter(([status, count]) => CEO_VISIBLE_STATUSES.has(status) && count > 0)
                          .sort(([, a], [, b]) => b - a)
                          .map(([status]) => (
                            <Cell key={status} fill={STATUS_HEX[status] ?? '#64748b'} />
                          ))
                      : [<Cell key="empty" fill="#94a3b8" />]}
                  </Pie>
                  <Tooltip formatter={(value: number | undefined) => [orderPipeline.total > 0 ? (value ?? 0) : '—', 'Orders']} contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-surface-200)' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              </div>
              </ClientOnly>
            </div>
          </div>
        </div>

        {/* Third row: Order funnel full width */}
        <div className="card">
          <h3 className="text-base font-semibold text-app-fg mb-2">Order funnel</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            Volume, Unconfirmed, Confirmed, Logistics distributed, and Delivered for the selected period.
          </p>
          <div className="h-64 min-h-[256px] w-full min-w-0">
            <ClientOnly fallback={<div className="h-64 min-h-[256px] w-full animate-pulse rounded bg-app-hover" />}>
            <div className="h-full min-h-[256px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={[
                  { stage: 'Volume', count: chartDisplayData.orderPipelineChart?.volume ?? 0, fill: PIPELINE_CHART_COLORS[0] },
                  { stage: 'Unconfirmed', count: chartDisplayData.orderPipelineChart?.unconfirmed ?? 0, fill: PIPELINE_CHART_COLORS[1] },
                  { stage: 'Confirmed', count: chartDisplayData.orderPipelineChart?.confirmed ?? 0, fill: PIPELINE_CHART_COLORS[2] },
                  { stage: 'Logistics distributed', count: chartDisplayData.orderPipelineChart?.logisticsDistributed ?? 0, fill: PIPELINE_CHART_COLORS[3] },
                  { stage: 'Delivered', count: chartDisplayData.orderPipelineChart?.delivered ?? 0, fill: PIPELINE_CHART_COLORS[4] },
                ]}
                margin={{ top: 8, right: 24, left: 100, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-surface-200 dark:stroke-surface-700" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="stage" width={96} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number | undefined) => [value ?? 0, 'Orders']} contentStyle={{ borderRadius: '8px' }} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="count" name="Orders" radius={[0, 4, 4, 0]} minPointSize={4}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Cell key={i} fill={PIPELINE_CHART_COLORS[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
            </ClientOnly>
          </div>
        </div>
        </div>
        )}

        {topic === 'media_buyers' && (
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-4">Media buyer performance</h2>
          <p className="text-sm text-app-fg-muted mb-4">
            Ad spend, delivered orders, and True ROAS by media buyer for the selected period.
          </p>
          {chartDisplayData.chartTopicData?.mediaBuyerLeaderboard && chartDisplayData.chartTopicData.mediaBuyerLeaderboard.length > 0 ? (
            <div className="h-96 min-h-[320px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-96 min-h-[320px] w-full animate-pulse rounded bg-app-hover" />}>
              <div className="h-full min-h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={chartDisplayData.chartTopicData.mediaBuyerLeaderboard.map((b) => ({
                    name: b.name,
                    spend: b.totalSpend,
                    orders: b.deliveredOrders,
                    confirmed: b.confirmedOrders,
                    confirmationRate: b.confirmationRate,
                    roas: b.trueRoas,
                  }))}
                  margin={{ top: 8, right: 24, left: 120, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-surface-200 dark:stroke-surface-700" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-app-border bg-app-elevated p-3 shadow-lg text-sm">
                          <p className="font-semibold text-app-fg mb-2">{p.name}</p>
                          <p>Ad spend: {fmt(p.spend)}</p>
                          <p>Delivered: {p.orders}</p>
                          <p>Confirmed: {p.confirmed}</p>
                          <p>Conf. rate: {Number(p.confirmationRate).toFixed(1)}%</p>
                          <p>True ROAS: {Number(p.roas).toFixed(2)}x</p>
                        </div>
                      );
                    }}
                    contentStyle={{ borderRadius: '8px' }}
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  />
                  <Bar dataKey="spend" name="Ad spend" fill="#6366f1" radius={[0, 4, 4, 0]} minPointSize={4} />
                </BarChart>
              </ResponsiveContainer>
              </div>
              </ClientOnly>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center rounded-lg bg-app-hover text-app-fg-muted text-sm">
              No media buyer data for this period. Try a different date range or ensure ad spend is logged.
            </div>
          )}
        </div>
        )}

        {topic === 'cs' && (
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-4">Sales closer workload</h2>
          <p className="text-sm text-app-fg-muted mb-4">
            Pipeline backlog (pre-confirm queue), per-agent daily duty target (capacity setting), and CS-stage closes
            today (confirm + cancel, Africa/Lagos calendar).
          </p>
          {chartDisplayData.chartTopicData?.csWorkloads && chartDisplayData.chartTopicData.csWorkloads.length > 0 ? (
            <div className="h-80 min-h-[280px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-80 min-h-[280px] w-full animate-pulse rounded bg-app-hover" />}>
              <div className="h-full min-h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={chartDisplayData.chartTopicData.csWorkloads.map((w) => ({
                    name: w.agentName,
                    pending: w.pendingCount,
                    capacity: w.capacity,
                    closesToday: w.todayClosesCount ?? 0,
                  }))}
                  margin={{ top: 8, right: 24, left: 120, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-surface-200 dark:stroke-surface-700" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={
                      ((value: number | undefined, label: string) => {
                        const map: Record<string, string> = {
                          'Pipeline backlog': 'Pipeline backlog',
                          'Daily target': 'Daily duty target',
                          'Closed today': 'Closed today (Lagos)',
                        };
                        return [value ?? 0, map[label] ?? label];
                      }) as never
                    }
                    contentStyle={{ borderRadius: '8px' }}
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  />
                  <Bar dataKey="pending" name="Pipeline backlog" fill="#0284c7" radius={[0, 4, 4, 0]} minPointSize={4} />
                  <Bar dataKey="capacity" name="Daily target" fill="#94a3b8" radius={[0, 4, 4, 0]} minPointSize={4} />
                  <Bar dataKey="closesToday" name="Closed today" fill="#22c55e" radius={[0, 4, 4, 0]} minPointSize={4} />
                </BarChart>
              </ResponsiveContainer>
              </div>
              </ClientOnly>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center rounded-lg bg-app-hover text-app-fg-muted text-sm">
              No Sales closers or workload data available.
            </div>
          )}
        </div>
        )}
      </>
      </TableLoadingOverlay>
      )}

      {/* Branch Breakdown — only shown when system has multiple branches.
          Toggle flips the join column: marketing = `orders.branch_id` (campaign
          attribution), servicing = `orders.servicing_branch_id` (CS team work).
          Same order can land in different rows depending on the lens. */}
      {branchBreakdown && branchBreakdown.length > 1 && (
        <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[10rem]">
        <div className="card p-0">
          <div className="px-4 py-3 border-b border-app-border flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-app-fg">Branch Breakdown</h2>
              <p className="text-micro text-app-fg-muted mt-0.5">
                {branchScope === 'servicing'
                  ? 'Grouped by the CS branch that worked each order'
                  : 'Grouped by the marketing branch the order was attributed to'}
              </p>
            </div>
            <FilterPills
              size="sm"
              value={branchScope}
              onChange={handleBranchScopeChange}
              options={[
                { value: 'marketing', label: 'Marketing' },
                { value: 'servicing', label: 'CS' },
              ]}
              name="Branch scope"
            />
          </div>
          <CompactTable<BranchBreakdownRow>
            columns={branchBreakdownColumns}
            rows={branchBreakdown}
            rowKey={(b) => b.branchId}
            caption="Branch breakdown"
            withCard={false}
            className="text-sm"
          />
        </div>
        </TableLoadingOverlay>
      )}

    </div>
  );
}

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
    : 'text-app-fg';

  const iconBg = highlight
    ? { warning: 'bg-warning-50 dark:bg-warning-700/20 text-warning-600 dark:text-warning-400', success: 'bg-success-50 dark:bg-success-700/20 text-success-600 dark:text-success-400', danger: 'bg-danger-50 dark:bg-danger-700/20 text-danger-600 dark:text-danger-400' }[highlight]
    : 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400';

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">{label}</p>
        <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
          <KPIIcon type={icon} />
        </div>
      </div>
      <p className={`text-2xl font-bold mt-2 ${valueColor}`}>{value}</p>
      {subtitle && <p className="text-xs text-app-fg-muted mt-0.5">{subtitle}</p>}
    </div>
  );
}

function CostRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pctOfTotal = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm text-app-fg-muted">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-app-fg-muted">{pctOfTotal.toFixed(0)}%</span>
          <span className="text-sm font-medium text-app-fg">{fmt(value)}</span>
        </div>
      </div>
      <div className="w-full h-1.5 bg-app-hover rounded-full overflow-hidden">
        <div
          className="h-full bg-app-border rounded-full transition-all duration-500"
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
  type: 'positive' | 'negative' | 'neutral';
  bold?: boolean;
}) {
  const color =
    type === 'positive'
      ? 'text-success-600 dark:text-success-400'
      : type === 'negative'
        ? 'text-danger-600 dark:text-danger-400'
        : 'text-app-fg';
  const prefix = type !== 'neutral' && value >= 0 ? '+' : '';

  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${bold ? 'font-semibold text-app-fg' : 'text-app-fg-muted'}`}>
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
    : 'text-app-fg';

  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-app-fg-muted">{label}</span>
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

