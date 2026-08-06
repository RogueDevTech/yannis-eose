import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from '@remix-run/react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  LabelList,
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { CompareButton } from '~/features/compare/CompareButton';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { AnimatedCount } from '~/components/ui/animated-count';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { ChartCard } from '~/components/ui/chart-card';
import { useLiveIndicator } from '~/hooks/useSocket';
import { useIsMobile } from '~/hooks/useIsMobile';
import type { FormAnalytics } from './types';

const TOP_FORMS_LIMIT = 6;

/** Funnel stage colors — descending indigo→green (6 stages: All views, Unique views,
 *  Started cart, Ordered, Confirmed, Delivered). Same vocabulary as the CEO funnel. */
// Stage 0 = All views, 1 = Unique views — distinct hues (indigo vs amber) so the
// two view series are easy to tell apart. Green stays reserved for Delivered.
const FUNNEL_COLORS = ['#6366f1', '#f59e0b', '#0284c7', '#4f46e5', '#0ea5e9', '#059669'] as const;
// All vs Unique views: clearly different hues. Green is reserved for Delivered
// (funnel end-state), so views never use it.
const RAW_VIEWS_COLOR = '#6366f1'; // indigo — all views
const UNIQUE_VIEWS_COLOR = '#f59e0b'; // amber — unique views

/**
 * X-axis tick for the funnel bar chart: colours each stage label to match its
 * bar (FUNNEL_COLORS is index-aligned to the stages), so the label reads as the
 * bar's legend. Supports the mobile slant via `angle`.
 */
function FunnelAxisTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string | number; index?: number };
  angle?: number;
  fontSize?: number;
}) {
  const { x = 0, y = 0, payload, angle = 0, fontSize = 11 } = props;
  const color = FUNNEL_COLORS[payload?.index ?? 0] ?? 'var(--color-app-fg-muted, #94a3b8)';
  return (
    <text
      x={x}
      y={y}
      dy={angle ? 4 : 12}
      textAnchor={angle ? 'end' : 'middle'}
      transform={angle ? `rotate(${angle}, ${x}, ${y})` : undefined}
      fill={color}
      fontSize={fontSize}
      fontWeight={500}
    >
      {payload?.value}
    </text>
  );
}

// Theme-aware Recharts tooltip: Recharts renders a hardcoded white card by
// default, which ignores the app theme (stays white in dark/soft). These map the
// tooltip surface, border, and text to the app's CSS vars so it follows the theme.
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'rgb(var(--app-elevated))',
  border: '1px solid rgb(var(--app-border))',
  borderRadius: '8px',
  color: 'rgb(var(--app-fg))',
  boxShadow: '0 4px 12px rgb(0 0 0 / 0.12)',
  // Compact card: tight padding + small type so it stays unobtrusive on mobile.
  padding: '6px 10px',
  fontSize: '12px',
  lineHeight: 1.3,
} as const;
const TOOLTIP_LABEL_STYLE = { color: 'rgb(var(--app-fg))', fontWeight: 600, marginBottom: '2px', fontSize: '12px' } as const;
const TOOLTIP_ITEM_STYLE = { color: 'rgb(var(--app-fg-muted))', padding: 0, fontSize: '12px' } as const;

/** Funnel X-axis props: on mobile the 6 stage labels don't fit horizontally, so
 *  slant them (+ extra bottom room) instead of truncating. Shared by both funnel charts. */
function funnelAxisFor(isMobile: boolean) {
  return {
    xAxisProps: isMobile
      ? { height: 56, tick: <FunnelAxisTick angle={-35} fontSize={10} /> }
      : { tick: <FunnelAxisTick fontSize={11} /> },
    chartMargin: isMobile
      ? { top: 24, right: 4, left: 0, bottom: 8 }
      : { top: 24, right: 4, left: 0, bottom: 4 },
  };
}

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

/**
 * X-axis label for a trend point. The backend sends a local (Africa/Lagos) wall-
 * clock timestamp string ("2026-08-06T09:00:00"). For hour buckets show the hour
 * ("9 AM"); for day buckets show the date ("6 Aug"). Parsed via the date parts so
 * the label reflects the business-day bucket, not the viewer's timezone.
 */
function formatTrendLabel(iso: string, unit: 'hour' | 'day'): string {
  const [datePart, timePart] = iso.split('T');
  if (unit === 'hour') {
    const hour = Number((timePart ?? '00:00:00').slice(0, 2));
    const period = hour < 12 ? 'AM' : 'PM';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12} ${period}`;
  }
  // Day bucket: format the date part as "6 Aug".
  const [y, m, d] = (datePart ?? '').split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

interface Props {
  analytics: FormAnalytics;
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  /** Socket events that revalidate this page; drives the LIVE indicator. */
  liveEvents?: string[];
  /** Detail mode: scoped to one form. Hides the forms table + cross-funnel (global-only). */
  detail?: { campaignId: string; formLabel: string };
}

export function MarketingAnalyticsPage({ analytics, filters, liveEvents, detail }: Props) {
  const chartUid = useId().replace(/:/g, '');
  const { statStrip, funnel, topForms, forms, crossFunnel } = analytics;
  // Default to the data (table) view; the toggle switches to charts.
  // Overview vs All forms tab (global page only; detail page has no tabs).
  const liveState = useLiveIndicator(liveEvents ?? []);
  const isMobile = useIsMobile();
  const isDetail = detail != null;
  const { xAxisProps: funnelXAxisProps, chartMargin: funnelChartMargin } = funnelAxisFor(isMobile);

  const statItems: OverviewStatStripItem[] = [
    {
      label: 'Unique form views',
      value: <AnimatedCount value={statStrip.uniqueLandings} />,
      title: 'Distinct visitors: each person counts once, no matter how many times they reopen the form.',
    },
    {
      label: 'All form views',
      value: <AnimatedCount value={statStrip.rawLandings} />,
      title: 'Every time the form was opened, including the same visitor refreshing or returning. Always >= Unique form views.',
    },
    {
      label: 'Avg time on form',
      value: formatDwell(statStrip.avgDwellMs),
      title: 'Average time on form, measured where the browser reported it on leave. Some mobile browsers do not report it, so this is a sample.',
    },
    {
      label: 'Conversion',
      value: <AnimatedCount value={statStrip.conversionRate} format={formatPct} />,
      title: 'Orders divided by unique form views.',
    },
    {
      label: 'Attribution rate',
      value: <AnimatedCount value={statStrip.attributionCoverage} format={formatPct} />,
      title: 'Share of orders we could link back to a tracked form view. Offline or imported orders and blocked beacons lower this.',
    },
  ];

  // Funnel with drop-off between stages. Starts with All form views (every load),
  // then Unique form views (dedup by visitor), then the conversion stages.
  // `short` is the compact axis label for the chart; `stage` is the full name used
  // in the tooltip + data table.
  const funnelStages = [
    { stage: 'All form views', short: 'All views', count: statStrip.rawLandings },
    { stage: 'Unique form views', short: 'Unique', count: funnel.formViews },
    { stage: 'Started cart', short: 'Started cart', count: funnel.startedCart },
    { stage: 'Ordered', short: 'Ordered', count: funnel.ordered },
    { stage: 'Confirmed', short: 'Confirmed', count: funnel.confirmed },
    { stage: 'Delivered', short: 'Delivered', count: funnel.delivered },
  ].map((s, i, arr) => {
    // Drop-off is the % lost from the PRIOR stage — but only meaningful within the
    // real conversion funnel. "All form views" has no prior; "Unique form views" is
    // just All deduped by visitor (refresh rate, not a funnel loss), so both show --.
    // Drop-off starts being real from "Started cart" onward.
    const prev = i <= 1 ? null : (arr[i - 1]?.count ?? null);
    const dropPct = prev && prev > 0 ? Math.max(0, ((prev - s.count) / prev) * 100) : null;
    return { ...s, fill: FUNNEL_COLORS[i], dropPct };
  });

  // Views trend (all vs unique) for the Overview + detail charts. Hour buckets on
  // a single-day range (label "9 AM"), else day buckets (label "6 Aug").
  const trendData = analytics.timeSeries.map((d) => ({
    viewsRaw: d.viewsRaw,
    viewsUnique: d.viewsUnique,
    label: formatTrendLabel(d.date, analytics.trendUnit),
  }));

  // Top forms by traffic — top 5 for the Overview table (full ranking is on the All forms tab).
  const topFormsTotal = topForms.reduce((sum, f) => sum + f.count, 0);
  const topFive = topForms.slice(0, TOP_FORMS_LIMIT);

  const chartSkeleton = <div className="h-72 w-full animate-pulse rounded bg-app-hover" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isDetail ? detail!.formLabel : 'Analytics'}
        {...(isDetail ? { backTo: '/admin/marketing/analytics' } : {})}
        mobileInlineActions
        description={isDetail ? 'Analytics for this form.' : 'Form views, traffic by form, and conversion.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Analytics actions"
            saveFilterKey
            desktop={
              <>
                {liveEvents != null && liveEvents.length > 0 && (
                  <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
                )}
                <DateFilterBar
                  startDate={filters?.startDate ?? ''}
                  endDate={filters?.endDate ?? ''}
                  periodAllTime={filters?.periodAllTime ?? false}
                  chrome="pill"
                />
                {!isDetail && <CompareButton source="marketing-analytics" />}
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

      {!isDetail && <OverviewStatStrip mobileGrid items={statItems} />}

      {/* ── PER-FORM DETAIL BODY ── meta + funnel + trend (no top-forms / summary) */}
      {isDetail && (
        <FormDetailBody
          analytics={analytics}
          funnelStages={funnelStages}
          chartUid={chartUid}
        />
      )}

      {/* ── OVERVIEW (global page) ── funnel + trend + top forms. The full
          searchable forms list lives on its own page (View all forms). */}
      {!isDetail && (
      <>
        {/* Always render the full page structure — funnel, trend, and tables —
            even with no traffic yet, so a quiet period shows zeros in the real
            layout rather than collapsing to a single empty-state card. */}
        <>
          {/* Row 1: Conversion funnel (bars) + Form views over time (area) — like the
              per-form detail page. Charts-only; the data tables live in the All forms tab. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Funnel — vertical descending bars (funnel silhouette), counts on top. */}
            <ChartCard
              title="Conversion funnel"
              subtitle="All views to delivered. Hover a bar for the drop-off from the prior stage."
            >
              <ClientOnly fallback={chartSkeleton}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelStages} margin={funnelChartMargin}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="short" interval={0} {...funnelXAxisProps} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                    <Tooltip
                      cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                      formatter={(value, _name, item) => {
                        const payload = (item as unknown as { payload?: { dropPct?: number | null; fill?: string } })?.payload;
                        const base = Number(value).toLocaleString();
                        const text = payload?.dropPct != null ? `${base}  (−${payload.dropPct.toFixed(0)}% from prev)` : base;
                        // Color the label to match the hovered bar's stage color.
                        return [text, <span key="n" style={{ color: payload?.fill }}>Count</span>];
                      }}
                    />
                    {/* minPointSize=3 → a zero-count stage still shows a thin marker
                        at the baseline instead of nothing, so the funnel stays legible. */}
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={64} minPointSize={3}>
                      <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: 'var(--color-app-fg, #64748b)' }} />
                      {funnelStages.map((s, i) => (
                        <Cell key={s.stage} fill={FUNNEL_COLORS[i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ClientOnly>
            </ChartCard>

            {/* Form views over time. */}
            <ChartCard title="Form views over time" subtitle="All vs unique views over the period.">
              {/* Always render the chart — an empty period shows a flat zero axis
                  rather than an empty-state card, keeping the layout consistent. */}
                <ClientOnly fallback={chartSkeleton}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                        <defs>
                          <linearGradient id={`${chartUid}-oraw`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={RAW_VIEWS_COLOR} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={RAW_VIEWS_COLOR} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id={`${chartUid}-ounique`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={UNIQUE_VIEWS_COLOR} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={UNIQUE_VIEWS_COLOR} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                        <Tooltip
                          // Show "<series name>: <value>" so each row is labelled
                          // (indigo = all views, amber = unique views).
                          formatter={(value, name, item) => [
                            <span key="v" style={{ color: (item as { color?: string })?.color }}>
                              {String(name)}: {Number(value).toLocaleString()}
                            </span>,
                            '',
                          ]}
                          contentStyle={TOOLTIP_CONTENT_STYLE}
                          labelStyle={TOOLTIP_LABEL_STYLE}
                          itemStyle={TOOLTIP_ITEM_STYLE}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Area type="monotone" dataKey="viewsRaw" name="All form views" stroke={RAW_VIEWS_COLOR} strokeWidth={2} fill={`url(#${chartUid}-oraw)`} />
                        <Area type="monotone" dataKey="viewsUnique" name="Unique form views" stroke={UNIQUE_VIEWS_COLOR} strokeWidth={2} fill={`url(#${chartUid}-ounique)`} />
                      </AreaChart>
                    </ResponsiveContainer>
                </ClientOnly>
            </ChartCard>
          </div>

          {/* Data tables — funnel (Stage/Count/Drop-off) + top forms — always shown
              below the charts. */}
          <FunnelDataTables funnelStages={funnelStages} topForms={topFive} topFormsTotal={topFormsTotal} crossFunnel={crossFunnel} formViews={funnel.formViews} filters={filters} />

        </>
      </>
      )}
    </div>
  );
}

/** Funnel + Top-forms as plain data tables, shown below the Overview charts. */
function FunnelDataTables({
  funnelStages,
  topForms,
  topFormsTotal,
  crossFunnel,
  formViews,
  filters,
}: {
  funnelStages: Array<{ stage: string; short: string; count: number; dropPct: number | null }>;
  topForms: FormAnalytics['topForms'];
  topFormsTotal: number;
  crossFunnel: FormAnalytics['crossFunnel'];
  /** Denominator (unique form views) for the cross-funnel "% of views" cell. */
  formViews: number;
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  const th = 'text-left text-xs font-medium text-app-fg-muted uppercase tracking-wider px-3 py-2';
  const td = 'px-3 py-2 text-sm text-app-fg whitespace-nowrap';
  const crossPct = formViews > 0 ? (crossFunnel.crossFunnel / formViews) * 100 : null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Funnel table (+ a cross-funnel row: traffic that diverted to another MB). */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-app-fg mb-3">Conversion funnel</h3>
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Stage</th>
              <th className={th}>Count</th>
              <th className={th}>Drop-off</th>
            </tr>
          </thead>
          <tbody>
            {funnelStages.map((s) => (
              <tr key={s.stage} className="border-t border-app-border">
                <td className={td}>{s.stage}</td>
                <td className={td}>{s.count.toLocaleString()}</td>
                <td className={td}>{s.dropPct != null ? `−${s.dropPct.toFixed(0)}%` : '--'}</td>
              </tr>
            ))}
            {/* Cross-funnel: submissions that DID come in and were tracked, but
                matched an order already placed for the same customer + product, so
                no duplicate was created. Surfacing this here answers the common
                "my form isn't tracking all my orders" worry — it did track them,
                they just didn't become a second order. Not a funnel stage, so the
                3rd column shows its share of views, not a drop-off. */}
            <tr
              className="border-t border-app-border bg-app-hover/40"
              title="These submissions came in and were tracked, but matched an order already placed for the same customer and product recently, so no new order was created."
            >
              <td className={`${td} text-app-fg-muted`}>Cross-funnel</td>
              <td className={`${td} text-app-fg-muted`}>{crossFunnel.crossFunnel.toLocaleString()}</td>
              <td className={`${td} text-app-fg-muted`}>{crossPct != null ? `${crossPct.toFixed(0)}% of views` : '--'}</td>
            </tr>
          </tbody>
        </table>
        {crossFunnel.crossFunnel > 0 && (
          <p className="mt-3 px-3 text-xs text-app-fg-muted">
            Cross-funnel submissions were tracked. They matched an order already placed for the same
            customer and product recently, so no new order was created.
          </p>
        )}
      </div>

      {/* Top forms table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-app-fg mb-3">Top forms by traffic</h3>
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Form</th>
              <th className={th}>Unique form views</th>
              <th className={th} title="This form's unique views as a percent of your total unique form views across all forms.">
                % of total views
              </th>
            </tr>
          </thead>
          <tbody>
            {topForms.length === 0 ? (
              <tr>
                <td className={td} colSpan={3}>No forms with traffic yet.</td>
              </tr>
            ) : (
              topForms.map((f) => (
                <tr key={f.campaignId} className="border-t border-app-border">
                  <td className={td}>{f.label}</td>
                  <td className={td}>{f.count.toLocaleString()}</td>
                  <td className={td}>
                    {topFormsTotal > 0 ? `${((f.count / topFormsTotal) * 100).toFixed(0)}%` : '--'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="mt-3 flex justify-end">
          <Link
            to={allFormsHref(filters)}
            className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            View all forms →
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Link to the standalone All-forms page, preserving the active date range. */
function allFormsHref(filters: { startDate: string; endDate: string; periodAllTime: boolean }): string {
  const params = new URLSearchParams();
  if (filters.periodAllTime) {
    params.set('period', 'all_time');
  } else {
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
  }
  const qs = params.toString();
  return `/admin/marketing/analytics/forms${qs ? `?${qs}` : ''}`;
}

/** Per-form detail body — this form's meta, conversion funnel, and views trend.
 *  No "Top forms" (cross-form) or "Summary" (redundant with the funnel) here. */
function FormDetailBody({
  analytics,
  funnelStages,
  chartUid,
}: {
  analytics: FormAnalytics;
  funnelStages: Array<{ stage: string; short: string; count: number; dropPct: number | null }>;
  chartUid: string;
}) {
  const { statStrip, timeSeries, forms } = analytics;
  const isMobile = useIsMobile();
  const { xAxisProps: funnelXAxisProps, chartMargin: funnelChartMargin } = funnelAxisFor(isMobile);
  const form = forms[0]; // detail bundle is scoped to one campaign
  const trendData = timeSeries.map((d) => ({
    viewsRaw: d.viewsRaw,
    viewsUnique: d.viewsUnique,
    label: formatTrendLabel(d.date, analytics.trendUnit),
  }));

  const meta: { label: string; value: string }[] = [
    { label: 'Product', value: form?.productName ?? '—' },
    { label: 'Unique form views', value: statStrip.uniqueLandings.toLocaleString() },
    { label: 'All form views', value: statStrip.rawLandings.toLocaleString() },
    { label: 'Avg time on form', value: formatDwell(statStrip.avgDwellMs) },
    { label: 'Conversion', value: formatPct(statStrip.conversionRate) },
  ];

  return (
    <div className="space-y-4">
      {/* Meta strip — what this form is + its headline numbers. */}
      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {meta.map((m) => (
            <div key={m.label}>
              <div className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">{m.label}</div>
              <div className="text-base font-semibold text-app-fg mt-0.5 tabular-nums">{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversion funnel for this form. */}
        <div className="card overflow-hidden px-2 py-4 sm:p-5">
          <h3 className="text-sm font-semibold text-app-fg mb-1 px-2 sm:px-0">Conversion funnel</h3>
          <p className="text-xs text-app-fg-muted mb-3 px-2 sm:px-0">All views to delivered for this form.</p>
          <ClientOnly fallback={<div className="h-72 w-full animate-pulse rounded bg-app-hover" />}>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelStages} margin={funnelChartMargin}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="short" interval={0} {...funnelXAxisProps} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(value, _name, item) => {
                      const drop = (item as unknown as { payload?: { dropPct?: number | null } })?.payload?.dropPct;
                      const base = Number(value).toLocaleString();
                      return [drop != null ? `${base}  (−${drop.toFixed(0)}% from prev)` : base, 'Count'] as [string, string];
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={64}>
                    <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: 'var(--color-app-fg, #64748b)' }} />
                    {funnelStages.map((s, i) => (
                      <Cell key={s.stage} fill={FUNNEL_COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ClientOnly>
        </div>

        {/* Form views over time. */}
        <div className="card overflow-hidden px-2 py-4 sm:p-5">
          <h3 className="text-sm font-semibold text-app-fg mb-1 px-2 sm:px-0">Form views over time</h3>
          <p className="text-xs text-app-fg-muted mb-3 px-2 sm:px-0">All vs unique views over the period for this form.</p>
          {/* Always render — an empty period shows a flat zero axis, not a card. */}
            <ClientOnly fallback={<div className="h-72 w-full animate-pulse rounded bg-app-hover" />}>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                    <defs>
                      <linearGradient id={`${chartUid}-draw`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={RAW_VIEWS_COLOR} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={RAW_VIEWS_COLOR} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id={`${chartUid}-dunique`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={UNIQUE_VIEWS_COLOR} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={UNIQUE_VIEWS_COLOR} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                    <Tooltip
                      // Show "<series name>: <value>" so each row is labelled
                      // (indigo = all views, amber = unique views).
                      formatter={(value, name, item) => [
                        <span key="v" style={{ color: (item as { color?: string })?.color }}>
                          {String(name)}: {Number(value).toLocaleString()}
                        </span>,
                        '',
                      ]}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="viewsRaw" name="All form views" stroke={RAW_VIEWS_COLOR} strokeWidth={2} fill={`url(#${chartUid}-draw)`} />
                    <Area type="monotone" dataKey="viewsUnique" name="Unique form views" stroke={UNIQUE_VIEWS_COLOR} strokeWidth={2} fill={`url(#${chartUid}-dunique)`} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ClientOnly>
        </div>
      </div>
    </div>
  );
}

/** Preserve the active date range when navigating to a form's detail page. */
function detailHref(
  campaignId: string,
  filters: { startDate: string; endDate: string; periodAllTime: boolean },
): string {
  const params = new URLSearchParams();
  if (filters.periodAllTime) {
    params.set('period', 'all_time');
  } else {
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
  }
  const qs = params.toString();
  return `/admin/marketing/analytics/${campaignId}${qs ? `?${qs}` : ''}`;
}

type FormRow = FormAnalytics['forms'][number];

/** Clickable forms table — every form with views, conversion, avg dwell. Row → detail.
 *  Search by name (PageSearchControl) + sort via a FormSelect dropdown. */
export function FormsTable({
  forms,
  filters,
}: {
  forms: FormAnalytics['forms'];
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  const [query, setQuery] = useState('');

  const visible = (() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? forms.filter((f) => f.label.toLowerCase().includes(q)) : forms;
    // Sort by unique views, high→low (the default; the sort control was removed).
    return [...filtered].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  })();

  const columns: CompactTableColumn<FormRow>[] = [
    {
      key: 'form',
      header: 'Form',
      render: (r) => (
        <Link
          to={detailHref(r.campaignId, filters)}
          className="font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {r.label}
        </Link>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      mobileLabel: 'Product',
      render: (r) =>
        r.productName ? (
          r.productName === 'Mixed' ? (
            <span className="text-app-fg-muted italic">Mixed</span>
          ) : (
            <span className="text-app-fg">{r.productName}</span>
          )
        ) : (
          <span className="text-app-fg-muted">—</span>
        ),
    },
    { key: 'allViews', header: 'All views', align: 'right', nowrap: true, render: (r) => r.rawViews.toLocaleString() },
    { key: 'views', header: 'Unique views', align: 'right', nowrap: true, render: (r) => r.views.toLocaleString() },
    { key: 'orders', header: 'Orders', align: 'right', nowrap: true, render: (r) => r.converted.toLocaleString() },
    { key: 'conversion', header: 'Conversion', align: 'right', nowrap: true, render: (r) => formatPct(r.conversionRate) },
    { key: 'avgTime', header: 'Avg time', align: 'right', nowrap: true, render: (r) => formatDwell(r.avgDwellMs) },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      tight: true,
      align: 'right',
      mobileShowLabel: false,
      render: (r) => (
        <TableActionButton to={detailHref(r.campaignId, filters)}>View</TableActionButton>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PageSearchControl
          value={query}
          onApply={setQuery}
          placeholder="Search forms"
          title="Search forms"
        />
      </div>
      <CompactTable
        columns={columns}
        rows={visible}
        rowKey={(r) => r.campaignId}
        rowHref={(r) => detailHref(r.campaignId, filters)}
        emptyTitle={query ? 'No forms match your search' : 'No forms with traffic'}
        emptyDescription={query ? 'Try a different name.' : 'Forms will appear here once they get views.'}
      />
    </div>
  );
}

