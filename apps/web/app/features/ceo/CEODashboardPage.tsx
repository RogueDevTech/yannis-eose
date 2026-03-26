import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigation, useFetcher } from '@remix-run/react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, Area, XAxis, YAxis, CartesianGrid, Line, ComposedChart, BarChart, Bar } from 'recharts';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Spinner } from '~/components/ui/spinner';
import { formatNaira } from '~/lib/format-amount';
import { STATUS_HEX, STATUS_LABELS, STATUS_TEXT_CLASS } from '~/features/shared/order-status';
import type { CEODashboardData, CEODashboardFilters, ChartDataPayload } from './types';

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
}

export function CEODashboardPage({ data, filters = { startDate: '', endDate: '', periodAllTime: false }, showBackToDashboard = true, branchBreakdown }: CEODashboardPageProps) {
  const [showChartView, setShowChartView] = useState(false);
  const [_searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const fetcher = useFetcher<ChartDataPayload>();
  const topic = filters?.topic ?? 'orders';

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
  const isLoadingTopic = navigation.state === 'loading';
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

  return (
    <div className="space-y-6">
      {/* Page header: title and subtitle first, then filters/actions below */}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Executive Overview</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-1">
            Real-time business intelligence across all departments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowChartView((v) => !v)}
            className="btn-secondary btn-sm"
          >
            {showChartView ? 'View as data' : 'View data in chart'}
          </button>
          <DateFilterBar startDate={filters.startDate} endDate={filters.endDate} periodAllTime={filters.periodAllTime ?? false} />
          {showBackToDashboard && (
            <Link to="/admin" className="btn-secondary btn-sm">Back to Dashboard</Link>
          )}
        </div>
      </div>

      {/* ── Chart view: all charts (Revenue & orders over time, pipeline, topic, cost, etc.) ───────────────── */}
      {showChartView && (
      <>
      {isChartLoading ? (
        <div className="card flex flex-col items-center justify-center gap-4 py-20">
          <Spinner size="lg" className="text-brand-500 dark:text-brand-400" />
          <p className="text-sm font-medium text-surface-700 dark:text-surface-300">Loading charts...</p>
        </div>
      ) : (
      <div>
        <h2 className="text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-3">
          Revenue & orders over time
        </h2>
        <div className="card">
          <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
            <strong>Revenue</strong> and <strong>Orders delivered</strong> are by delivery date. <strong>Orders created</strong> shows daily order volume (any status) so the chart has data even before deliveries.
          </p>
          {chartDisplayData.timeSeries && chartDisplayData.timeSeries.length > 0 ? (
            <div className="h-72 min-h-[288px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-72 min-h-[288px] w-full animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
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
            <div className="h-72 min-h-[288px] flex flex-col items-center justify-center gap-2 rounded-lg bg-surface-50 dark:bg-surface-800/50 text-surface-600 dark:text-surface-400 text-sm text-center px-4">
              <p className="font-medium">No orders in this period.</p>
              <p className="text-xs max-w-md">
                Revenue and &quot;Orders delivered&quot; appear when orders are marked Delivered. &quot;Orders created&quot; shows daily volume (any status). Try &quot;All time&quot; or a wider date range.
              </p>
            </div>
          )}
        </div>
      </div>
      )}
      </>
      )}

      {/* ── Data view: KPIs, lists, grids (no charts) ─────────────────────── */}
      {!showChartView && (
        <>
      {/* ── Section 1: Revenue & Profit KPIs ────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-3">
          Revenue & Profit
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard label="Revenue" value={fmt(revenue)} icon="revenue" />
          <KPICard
            label="True Profit"
            value={fmt(trueProfit)}
            icon="profit"
            highlight={trueProfit >= 0 ? 'success' : 'danger'}
          />
          <KPICard
            label="Net Margin"
            value={pct(margin)}
            icon="margin"
            highlight={margin >= 20 ? 'success' : margin > 0 ? 'warning' : 'danger'}
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
          {showChartView && !isChartLoading && (
          <div className="mb-4 h-48 min-h-[192px] w-full">
            <ClientOnly fallback={<div className="h-full min-h-[192px] animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
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
            <WaterfallRow label="Revenue" value={revenue} type="neutral" />
            <WaterfallRow label="Landed COGS" value={-costBreakdown.landedCost} type="neutral" />
            <WaterfallRow label="Delivery Fees" value={-costBreakdown.deliveryFee} type="neutral" />
            <WaterfallRow label="Ad Spend" value={-costBreakdown.adSpend} type="neutral" />
            <WaterfallRow label="Commission" value={-costBreakdown.commission} type="neutral" />
            <WaterfallRow label="Fulfillment" value={-costBreakdown.fulfillmentCost} type="neutral" />
            <WaterfallRow label="Op. Loss" value={-costBreakdown.operationalLoss} type="neutral" />
            <div className="pt-3 border-t-2 border-surface-300 dark:border-surface-600">
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
        <h2 className="text-xs font-semibold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-3">
          Order Pipeline
        </h2>

        {/* Order pipeline chart: Volume → CS Engaged → Confirmed → Logistics distributed → Delivered (chart view only) */}
        {showChartView && !isChartLoading && (
        <div className="card mb-4">
          <h3 className="text-base font-semibold text-surface-900 dark:text-white mb-2">Order funnel</h3>
          <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
            Volume, CS engaged, Confirmed, Logistics distributed, and Delivered for the selected period.
          </p>
          <div className="h-64 min-h-[256px] w-full">
            <ClientOnly fallback={<div className="h-full min-h-[256px] animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
            <div className="h-full min-h-[256px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={[
                  { stage: 'Volume', count: chartDisplayData.orderPipelineChart?.volume ?? 0, fill: PIPELINE_CHART_COLORS[0] },
                  { stage: 'CS Engaged', count: chartDisplayData.orderPipelineChart?.csEngaged ?? 0, fill: PIPELINE_CHART_COLORS[1] },
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
          <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">Status Distribution</h3>
          {showChartView && !isChartLoading && (
          <div className="mb-4 h-52 min-h-[208px] w-full">
            <ClientOnly fallback={<div className="h-full min-h-[208px] animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
            <div className="h-full min-h-[208px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={
                    orderPipeline.total > 0
                      ? Object.entries(orderPipeline.statusCounts)
                          .filter(([status, count]) => status !== 'COMPLETED' && count > 0)
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
                        .filter(([status, count]) => status !== 'COMPLETED' && count > 0)
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
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(orderPipeline.statusCounts)
              .filter(([status, count]) => status !== 'COMPLETED' && count > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => (
                <div key={status} className="text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                  <p className={`text-2xl font-bold ${STATUS_TEXT_CLASS[status] ?? 'text-surface-900 dark:text-white'}`}>
                    {count}
                  </p>
                  <p className="text-xs text-surface-800 dark:text-surface-200 mt-0.5">
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
            <Link to="/admin/marketing/funding" className="text-xs text-brand-500 hover:text-brand-600 font-medium">View details</Link>
          </div>
          <div className="space-y-3">
            <MetricRow label="Total Ad Spend" value={fmt(marketingSafe.totalSpend)} />
            <MetricRow
              label="CPA"
              value={fmt(marketingSafe.cpa)}
              highlight={marketingSafe.cpa > 0 && marketingSafe.cpa < 5000 ? 'success' : marketingSafe.cpa > 10000 ? 'danger' : undefined}
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

        {/* CS Team */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">CS Team</h2>
            <Link to="/admin/cs/queue" className="text-xs text-brand-500 hover:text-brand-600 font-medium">View details</Link>
          </div>
          <div className="space-y-3">
            <MetricRow label="Agents Active" value={csTeamSafe.agentCount.toString()} />
            <MetricRow
              label="Pending Orders"
              value={csTeamSafe.pendingOrders.toString()}
              highlight={csTeamSafe.pendingOrders > 20 ? 'danger' : csTeamSafe.pendingOrders > 10 ? 'warning' : undefined}
            />
            <MetricRow
              label="Utilization"
              value={`${csTeamSafe.utilization}%`}
              highlight={csTeamSafe.utilization >= 80 ? 'danger' : csTeamSafe.utilization >= 60 ? 'warning' : 'success'}
            />
            {csTeamSafe.agentCount > 0 && (
              <MetricRow
                label="Avg per Agent"
                value={(csTeamSafe.pendingOrders / csTeamSafe.agentCount).toFixed(1)}
              />
            )}
          </div>
        </div>

        {/* Payroll */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Payroll</h2>
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

      {/* ── Section 5: Quick Links ────────────────────────── */}
      <div className="card">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Quick Navigation</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { href: '/admin/cs/orders', label: 'Orders', icon: 'orders' },
            { href: '/admin/finance/overview', label: 'Finance', icon: 'finance' },
            { href: '/admin/marketing/funding', label: 'Marketing', icon: 'marketing' },
            { href: '/admin/inventory', label: 'Inventory', icon: 'inventory' },
            { href: '/hr/payroll', label: 'HR & Payroll', icon: 'hr' },
            { href: '/admin/analytics/audit', label: 'Audit Trail', icon: 'audit' },
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

      </> )}

      {/* ── Chart view only: content by topic (Orders / Media buyers / CS) ───────────────── */}
      {showChartView && !isChartLoading && (
      <>
        {/* Topic filter: only visible in chart section */}
        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="chart-topic" className="text-sm font-medium text-surface-700 dark:text-surface-300">Chart topic</label>
          <div className="flex items-center gap-2">
            <select
              id="chart-topic"
              value={topic}
              onChange={(e) => setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('topic', e.target.value);
                return next;
              })}
              disabled={isLoadingTopic}
              className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
            >
              <option value="orders">Orders</option>
              <option value="media_buyers">Media buyers</option>
              <option value="cs">CS</option>
            </select>
            {isLoadingTopic && (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-surface-300 border-t-brand-500"
                aria-hidden
              />
            )}
          </div>
        </div>

        {topic === 'orders' && (
        <div className="space-y-4">
        {/* Cost Breakdown + Status Distribution (chart always shown above) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Cost Breakdown</h2>
            <div className="h-48 min-h-[192px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-48 min-h-[192px] w-full animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
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
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">Status Distribution</h3>
            <div className="h-52 min-h-[208px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-52 min-h-[208px] w-full animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
              <div className="h-full min-h-[208px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      orderPipeline.total > 0
                        ? Object.entries(orderPipeline.statusCounts)
                            .filter(([status, count]) => status !== 'COMPLETED' && count > 0)
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
                          .filter(([status, count]) => status !== 'COMPLETED' && count > 0)
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
          <h3 className="text-base font-semibold text-surface-900 dark:text-white mb-2">Order funnel</h3>
          <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
            Volume, CS engaged, Confirmed, Logistics distributed, and Delivered for the selected period.
          </p>
          <div className="h-64 min-h-[256px] w-full min-w-0">
            <ClientOnly fallback={<div className="h-64 min-h-[256px] w-full animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
            <div className="h-full min-h-[256px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={[
                  { stage: 'Volume', count: chartDisplayData.orderPipelineChart?.volume ?? 0, fill: PIPELINE_CHART_COLORS[0] },
                  { stage: 'CS Engaged', count: chartDisplayData.orderPipelineChart?.csEngaged ?? 0, fill: PIPELINE_CHART_COLORS[1] },
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
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Media buyer performance</h2>
          <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
            Ad spend, delivered orders, and True ROAS by media buyer for the selected period.
          </p>
          {chartDisplayData.chartTopicData?.mediaBuyerLeaderboard && chartDisplayData.chartTopicData.mediaBuyerLeaderboard.length > 0 ? (
            <div className="h-96 min-h-[320px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-96 min-h-[320px] w-full animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
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
                        <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-3 shadow-lg text-sm">
                          <p className="font-semibold text-surface-900 dark:text-white mb-2">{p.name}</p>
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
            <div className="h-64 flex items-center justify-center rounded-lg bg-surface-50 dark:bg-surface-800/50 text-surface-600 dark:text-surface-400 text-sm">
              No media buyer data for this period. Try a different date range or ensure ad spend is logged.
            </div>
          )}
        </div>
        )}

        {topic === 'cs' && (
        <div className="card">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">CS agent workload</h2>
          <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
            Pending orders per agent (Unprocessed, CS Assigned, CS Engaged).
          </p>
          {chartDisplayData.chartTopicData?.csWorkloads && chartDisplayData.chartTopicData.csWorkloads.length > 0 ? (
            <div className="h-80 min-h-[280px] w-full min-w-0">
              <ClientOnly fallback={<div className="h-80 min-h-[280px] w-full animate-pulse rounded bg-surface-100 dark:bg-surface-800" />}>
              <div className="h-full min-h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={chartDisplayData.chartTopicData.csWorkloads.map((w) => ({
                    name: w.agentName,
                    pending: w.pendingCount,
                    capacity: w.capacity,
                  }))}
                  margin={{ top: 8, right: 24, left: 120, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-surface-200 dark:stroke-surface-700" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={((value: number | undefined, name: string) => [value ?? 0, name === 'pending' ? 'Pending orders' : 'Capacity']) as never}
                    contentStyle={{ borderRadius: '8px' }}
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  />
                  <Bar dataKey="pending" name="Pending orders" fill="#0284c7" radius={[0, 4, 4, 0]} minPointSize={4} />
                  <Bar dataKey="capacity" name="Capacity" fill="#94a3b8" radius={[0, 4, 4, 0]} minPointSize={4} />
                </BarChart>
              </ResponsiveContainer>
              </div>
              </ClientOnly>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center rounded-lg bg-surface-50 dark:bg-surface-800/50 text-surface-600 dark:text-surface-400 text-sm">
              No CS agents or workload data available.
            </div>
          )}
        </div>
        )}
      </>
      )}

      {/* Branch Breakdown — only shown when system has multiple branches */}
      {branchBreakdown && branchBreakdown.length > 1 && (
        <div className="card overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Branch Breakdown</h2>
            <span className="text-xs text-surface-500 dark:text-surface-400">All branches</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Branch</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Total Orders</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Active</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Delivered</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">Delivery Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {branchBreakdown.map((branch) => {
                const deliveryRate = branch.totalOrders > 0
                  ? Math.round((branch.deliveredOrders / branch.totalOrders) * 100)
                  : 0;
                return (
                  <tr key={branch.branchId} className="hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors duration-100">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-[10px] font-bold flex-shrink-0">
                          {branch.branchCode.slice(0, 2)}
                        </span>
                        <div>
                          <p className="font-medium text-surface-900 dark:text-white">{branch.branchName}</p>
                          <p className="text-[10px] text-surface-500 dark:text-surface-400">{branch.branchCode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-surface-900 dark:text-white">{branch.totalOrders.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-surface-700 dark:text-surface-300">{branch.activeOrders.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-success-700 dark:text-success-300 font-medium">{branch.deliveredOrders.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                        deliveryRate >= 70
                          ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                          : deliveryRate >= 40
                            ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300'
                            : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400'
                      }`}>
                        {deliveryRate}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
    : 'text-surface-900 dark:text-white';

  const iconBg = highlight
    ? { warning: 'bg-warning-50 dark:bg-warning-700/20 text-warning-600 dark:text-warning-400', success: 'bg-success-50 dark:bg-success-700/20 text-success-600 dark:text-success-400', danger: 'bg-danger-50 dark:bg-danger-700/20 text-danger-600 dark:text-danger-400' }[highlight]
    : 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400';

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">{label}</p>
        <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
          <KPIIcon type={icon} />
        </div>
      </div>
      <p className={`text-2xl font-bold mt-2 ${valueColor}`}>{value}</p>
      {subtitle && <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function CostRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pctOfTotal = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm text-surface-800 dark:text-surface-200">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-700 dark:text-surface-300">{pctOfTotal.toFixed(0)}%</span>
          <span className="text-sm font-medium text-surface-900 dark:text-white">{fmt(value)}</span>
        </div>
      </div>
      <div className="w-full h-1.5 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-surface-400 dark:bg-surface-500 rounded-full transition-all duration-500"
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
        : 'text-surface-900 dark:text-white';
  const prefix = type !== 'neutral' && value >= 0 ? '+' : '';

  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${bold ? 'font-semibold text-surface-900 dark:text-white' : 'text-surface-800 dark:text-surface-200'}`}>
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
      <span className="text-sm text-surface-800 dark:text-surface-200">{label}</span>
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
