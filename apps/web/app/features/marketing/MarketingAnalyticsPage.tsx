import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  Cell,
} from 'recharts';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import type { FormAnalytics } from './types';

/** Funnel stage colors — same vocabulary as the CEO dashboard pipeline funnel. */
const FUNNEL_COLORS = ['#6366f1', '#0284c7', '#4f46e5', '#059669'] as const;
const RAW_VIEWS_COLOR = '#6366f1';
const UNIQUE_VIEWS_COLOR = '#059669';

/** Render children only after first client paint — Recharts warns on 0×0 during SSR. */
function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}

function formatDwell(ms: number | null): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

interface Props {
  analytics: FormAnalytics;
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}

export function MarketingAnalyticsPage({ analytics, filters }: Props) {
  const chartUid = useId().replace(/:/g, '');
  const { statStrip, funnel, timeSeries, topForms } = analytics;

  const hasData = statStrip.rawLandings > 0;

  const statItems: OverviewStatStripItem[] = [
    {
      label: 'Landings',
      value: statStrip.uniqueLandings.toLocaleString(),
      title: `${statStrip.rawLandings.toLocaleString()} total loads (incl. refreshes)`,
    },
    {
      label: 'Total loads',
      value: statStrip.rawLandings.toLocaleString(),
      title: 'Every form open, including refreshes by the same visitor.',
    },
    {
      label: 'Avg time on form',
      value: formatDwell(statStrip.avgDwellMs),
      title: 'Average time on form, measured where the browser reported it on leave. Some mobile browsers do not report it, so this is a sample.',
    },
    {
      label: 'Conversion',
      value: formatPct(statStrip.conversionRate),
      title: 'Orders divided by unique landings.',
    },
    {
      label: 'Matched to a view',
      value: formatPct(statStrip.attributionCoverage),
      title: 'Share of orders that could be linked back to a tracked form view. Untracked visitors (blocked beacons) lower this.',
    },
  ];

  // Funnel with drop-off between stages.
  const funnelStages = [
    { stage: 'Landed', count: funnel.landed },
    { stage: 'Started cart', count: funnel.startedCart },
    { stage: 'Ordered', count: funnel.ordered },
    { stage: 'Delivered', count: funnel.delivered },
  ].map((s, i, arr) => {
    const prev = i === 0 ? null : (arr[i - 1]?.count ?? null);
    // Clamp at 0: a stage should never show a negative drop-off. Started-cart counts
    // sessions that may lack a tracked view, so it can slightly exceed the prior stage.
    const dropPct = prev && prev > 0 ? Math.max(0, ((prev - s.count) / prev) * 100) : null;
    return { ...s, fill: FUNNEL_COLORS[i], dropPct };
  });

  const trendData = timeSeries.map((d) => ({
    date: d.date,
    viewsRaw: d.viewsRaw,
    viewsUnique: d.viewsUnique,
    label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }),
  }));

  const chartSkeleton = <div className="h-72 w-full animate-pulse rounded bg-app-hover" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        mobileInlineActions
        description="Form landings, traffic by form, and conversion."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Filters"
            triggerAriaLabel="Analytics filters"
            saveFilterKey
            desktop={
              <DateFilterBar
                startDate={filters?.startDate ?? ''}
                endDate={filters?.endDate ?? ''}
                periodAllTime={filters?.periodAllTime ?? false}
                chrome="pill"
              />
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters?.startDate ?? ''}
        endDate={filters?.endDate ?? ''}
        periodAllTime={filters?.periodAllTime ?? false}
      />

      <OverviewStatStrip mobileGrid items={statItems} />

      {!hasData ? (
        <div className="card">
          <EmptyState
            title="No form traffic yet"
            description="Once visitors start landing on your forms, their traffic, time on form, and conversion will appear here."
          />
        </div>
      ) : (
        <>
          {/* Funnel — the centerpiece: Landed → Started cart → Ordered → Delivered. */}
          <div className="card overflow-hidden">
            <h3 className="text-base font-semibold text-app-fg mb-1">Conversion funnel</h3>
            <p className="text-sm text-app-fg-muted mb-4">
              How landings flow through to delivered orders for the selected period.
            </p>
            <ClientOnly fallback={chartSkeleton}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  layout="vertical"
                  data={funnelStages}
                  margin={{ top: 8, right: 24, left: 12, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.2)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="stage" width={96} tick={{ fontSize: 12 }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                    formatter={(value, _name, item) => {
                      const drop = (item as unknown as { payload?: { dropPct?: number | null } })?.payload?.dropPct;
                      const base = Number(value).toLocaleString();
                      return [drop != null ? `${base}  (−${drop.toFixed(0)}% from prev)` : base, 'Count'] as [string, string];
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} minPointSize={4} maxBarSize={34}>
                    {funnelStages.map((s, i) => (
                      <Cell key={s.stage} fill={FUNNEL_COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ClientOnly>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Views over time — raw + unique. */}
            <div className="card overflow-hidden">
              <h3 className="text-sm font-semibold text-app-fg mb-3">Landings over time</h3>
              {trendData.length === 0 ? (
                <EmptyState
                  title="No daily breakdown"
                  description="Pick a date range to see landings per day."
                />
              ) : (
                <ClientOnly fallback={chartSkeleton}>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={trendData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                      <defs>
                        <linearGradient id={`${chartUid}-raw`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={RAW_VIEWS_COLOR} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={RAW_VIEWS_COLOR} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id={`${chartUid}-unique`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={UNIQUE_VIEWS_COLOR} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={UNIQUE_VIEWS_COLOR} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                      <Tooltip
                        formatter={(value, name) => [
                          Number(value).toLocaleString(),
                          name === 'viewsUnique' ? 'Unique visitors' : 'Total loads',
                        ]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area
                        type="monotone"
                        dataKey="viewsRaw"
                        name="Total loads"
                        stroke={RAW_VIEWS_COLOR}
                        strokeWidth={2}
                        fill={`url(#${chartUid}-raw)`}
                        dot={trendData.length <= 31 ? { r: 3, fill: RAW_VIEWS_COLOR } : false}
                        activeDot={{ r: 5 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="viewsUnique"
                        name="Unique visitors"
                        stroke={UNIQUE_VIEWS_COLOR}
                        strokeWidth={2}
                        fill={`url(#${chartUid}-unique)`}
                        dot={trendData.length <= 31 ? { r: 3, fill: UNIQUE_VIEWS_COLOR } : false}
                        activeDot={{ r: 5 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ClientOnly>
              )}
            </div>

            {/* Top forms by traffic. */}
            <div className="card overflow-hidden">
              <h3 className="text-sm font-semibold text-app-fg mb-3">Top forms by traffic</h3>
              {topForms.length === 0 ? (
                <EmptyState title="No forms with traffic" description="Landings by form will rank here." />
              ) : (
                <ClientOnly fallback={chartSkeleton}>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={topForms}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} />
                      <Tooltip
                        cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                        formatter={(v) => [Number(v).toLocaleString(), 'Landings']}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={26} fill={RAW_VIEWS_COLOR} />
                    </BarChart>
                  </ResponsiveContainer>
                </ClientOnly>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
