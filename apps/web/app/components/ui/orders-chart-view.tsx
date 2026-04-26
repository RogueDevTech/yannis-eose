import { useEffect, useState, type ReactNode } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import { STATUS_HEX, STATUS_LABELS } from '~/features/shared/order-status';
import { EmptyState } from './empty-state';

/**
 * Toggle between table and chart views on order list pages.
 *
 * Reused by `/admin/marketing/orders`, `/admin/cs/orders`, and `/admin/logistics/orders`
 * via a "View data in chart" / "View as data" button in the page header. When chart view is
 * on, the page swaps the table for two charts derived from the existing `statusCounts` —
 * which is the FULL filtered count for the date/branch range, not paginated, so the charts
 * always reflect the user's current scope rather than just the rows currently visible.
 *
 * Charts:
 *   - Pie: status distribution
 *   - Horizontal bar: same data ranked by count (easier to compare small slices)
 *
 * Both share `STATUS_HEX` so the colour vocabulary is identical to the CEO dashboard's
 * pipeline funnel and the order status badges everywhere else.
 */

interface OrdersChartViewProps {
  /** Full-filter-range count per status. NOT paginated — covers the entire date / branch / search scope. */
  statusCounts: Record<string, number>;
  /** Total of all statuses in the current scope. Used for empty-state detection. */
  total: number;
  /** Heading prefix shown above each chart card (e.g. "Marketing orders" → "Marketing orders by status"). */
  scopeLabel?: string;
  /**
   * Daily order count series sorted ascending by date. Drives the "Orders over time" trend
   * line. Source: `orders.timeSeriesByCreated` tRPC scoped to the same filters as the page.
   * When omitted (or empty), the trend chart card is replaced with an empty-state message.
   */
  dailyCounts?: Array<{ date: string; orderCount: number }>;
}

/** Render children only after first client paint — Recharts complains about 0×0 dims during SSR. */
function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}

export function OrdersChartView({ statusCounts, total, scopeLabel = 'Orders', dailyCounts = [] }: OrdersChartViewProps) {
  const data = Object.entries(statusCounts)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => ({
      status,
      label: STATUS_LABELS[status] ?? status,
      count: n,
      color: STATUS_HEX[status] ?? '#94a3b8',
    }))
    .sort((a, b) => b.count - a.count);

  if (total === 0 || data.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No orders to chart"
          description="Adjust the date filter or status to see chart data."
        />
      </div>
    );
  }

  const skeleton = (
    <div className="flex items-center justify-center" style={{ height: 320 }}>
      <div className="w-32 h-32 rounded-full bg-app-hover animate-pulse" />
    </div>
  );

  const trendData = dailyCounts.map((d) => ({
    date: d.date,
    orderCount: d.orderCount,
    // Friendly label for the X-axis (`Apr 5`). Done client-side so the server returns
    // raw ISO dates and the chart can re-localise without a round-trip.
    label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }),
  }));

  return (
    <div className="space-y-4">
      {/* Trend line — orders over time (by created date). Spans full width because a wide
          time-series is the most informative shape; the other two charts split below. */}
      <div className="card">
        <h3 className="text-sm font-semibold text-app-fg mb-3">{scopeLabel} over time</h3>
        {trendData.length === 0 ? (
          <EmptyState
            title="No daily breakdown available"
            description="Orders without a date filter or recent activity won't appear here."
          />
        ) : (
          <ClientOnly fallback={<div className="h-72 w-full animate-pulse rounded bg-app-hover" />}>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trendData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="ordersTrendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                <Tooltip
                  formatter={(v) => [Number(v).toLocaleString(), 'Orders']}
                  labelFormatter={(label) => String(label)}
                />
                <Area
                  type="monotone"
                  dataKey="orderCount"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#ordersTrendGradient)"
                  dot={trendData.length <= 31 ? { r: 3, fill: '#6366f1' } : false}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ClientOnly>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card">
        <h3 className="text-sm font-semibold text-app-fg mb-3">{scopeLabel} by status</h3>
        <ClientOnly fallback={skeleton}>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="label"
                outerRadius={110}
                innerRadius={50}
                paddingAngle={1}
              >
                {data.map((d) => (
                  <Cell key={d.status} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, _name, item) => {
                  const label = (item as unknown as { payload?: { label?: string } })?.payload?.label ?? '';
                  return [Number(value).toLocaleString(), label];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ClientOnly>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-app-fg mb-3">Ranked by count</h3>
        <ClientOnly fallback={skeleton}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} formatter={(v) => Number(v).toLocaleString()} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={26}>
                {data.map((d) => (
                  <Cell key={d.status} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ClientOnly>
      </div>
      </div>
    </div>
  );
}
