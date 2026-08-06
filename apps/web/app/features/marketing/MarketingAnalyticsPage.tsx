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
  Legend,
  AreaChart,
  Area,
  Cell,
  PieChart,
  Pie,
  LabelList,
} from 'recharts';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Button } from '~/components/ui/button';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { AnimatedCount } from '~/components/ui/animated-count';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useLiveIndicator } from '~/hooks/useSocket';
import type { FormAnalytics } from './types';

/** Funnel stage colors — descending indigo→green, same vocabulary as the CEO funnel. */
const FUNNEL_COLORS = ['#6366f1', '#0284c7', '#4f46e5', '#0ea5e9', '#059669'] as const;
const RAW_VIEWS_COLOR = '#6366f1';
const UNIQUE_VIEWS_COLOR = '#059669';
/** Donut slice palette for Top forms — 10 distinct hues assigned in fixed order. */
const FORM_COLORS = [
  '#6366f1', '#0284c7', '#059669', '#d97706', '#dc2626',
  '#7c3aed', '#0ea5e9', '#16a34a', '#ea580c', '#db2777',
] as const;

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
  /** Socket events that revalidate this page; drives the LIVE indicator. */
  liveEvents?: string[];
  /** Detail mode: scoped to one form. Hides the forms table + cross-funnel (global-only). */
  detail?: { campaignId: string; formLabel: string };
}

export function MarketingAnalyticsPage({ analytics, filters, liveEvents, detail }: Props) {
  const chartUid = useId().replace(/:/g, '');
  const { statStrip, funnel, timeSeries, topForms, forms, crossFunnel } = analytics;
  // Default to the data (table) view; the toggle switches to charts.
  const [showData, setShowData] = useState(true);
  const liveState = useLiveIndicator(liveEvents ?? []);
  const isDetail = detail != null;

  const hasData = statStrip.rawLandings > 0;

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
      label: 'Matched to a view',
      value: <AnimatedCount value={statStrip.attributionCoverage} format={formatPct} />,
      title: 'Share of orders that could be linked back to a tracked form view. Untracked visitors (blocked beacons) lower this.',
    },
  ];

  // Funnel with drop-off between stages.
  const funnelStages = [
    { stage: 'Form views', count: funnel.formViews }, // unique visitors (funnel basis)
    { stage: 'Started cart', count: funnel.startedCart },
    { stage: 'Ordered', count: funnel.ordered },
    { stage: 'Confirmed', count: funnel.confirmed },
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

  const topFormsTotal = topForms.reduce((sum, f) => sum + f.count, 0);
  // Full ranked list (every form the backend returned), each with a stable color.
  const donutData = topForms.map((f, i) => ({ ...f, fill: FORM_COLORS[i % FORM_COLORS.length] }));
  // Donut slices: keep the top 6 distinct, roll the rest into a single "Other" slice so
  // the chart stays legible no matter how many forms exist. The full ranking is in the list.
  const DONUT_TOP = 6;
  const donutSlices = (() => {
    if (donutData.length <= DONUT_TOP + 1) {
      return donutData.map((f) => ({ key: f.campaignId, label: f.label, count: f.count, fill: f.fill }));
    }
    const head = donutData.slice(0, DONUT_TOP).map((f) => ({ key: f.campaignId, label: f.label, count: f.count, fill: f.fill }));
    const otherCount = donutData.slice(DONUT_TOP).reduce((sum, f) => sum + f.count, 0);
    return [...head, { key: '__other__', label: 'Other', count: otherCount, fill: '#94a3b8' }];
  })();

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
                {hasData && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowData((v) => !v)}>
                    {showData ? 'View charts' : 'View as data'}
                  </Button>
                )}
              </>
            }
            sheet={
              hasData
                ? ({ closeSheet }) => (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-12 w-full justify-center"
                      onClick={() => {
                        setShowData((v) => !v);
                        closeSheet();
                      }}
                    >
                      {showData ? 'View charts' : 'View as data'}
                    </Button>
                  )
                : undefined
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
      ) : showData ? (
        <AnalyticsDataView
          statStrip={statStrip}
          funnelStages={funnelStages}
          trendData={trendData}
          topForms={topForms}
          topFormsTotal={topFormsTotal}
        />
      ) : (
        <>
          {/* Views over time — all + unique. Leads the page: traffic trend first. */}
          <div className="card overflow-hidden">
            <h3 className="text-base font-semibold text-app-fg mb-3">Form views over time</h3>
            {trendData.length === 0 ? (
              <EmptyState
                title="No daily breakdown"
                description="Pick a date range to see form views per day."
              />
            ) : (
              <ClientOnly fallback={chartSkeleton}>
                {/* Fixed-height wrapper: ResponsiveContainer collapses to 0px on
                    mobile without a definite-height parent (blank chart). */}
                <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
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
                        name === 'viewsUnique' ? 'Unique form views' : 'All form views',
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="viewsRaw"
                      name="All form views"
                      stroke={RAW_VIEWS_COLOR}
                      strokeWidth={2}
                      fill={`url(#${chartUid}-raw)`}
                      dot={trendData.length <= 31 ? { r: 3, fill: RAW_VIEWS_COLOR } : false}
                      activeDot={{ r: 5 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="viewsUnique"
                      name="Unique form views"
                      stroke={UNIQUE_VIEWS_COLOR}
                      strokeWidth={2}
                      fill={`url(#${chartUid}-unique)`}
                      dot={trendData.length <= 31 ? { r: 3, fill: UNIQUE_VIEWS_COLOR } : false}
                      activeDot={{ r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                </div>
              </ClientOnly>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Funnel — vertical descending bars (funnel silhouette), counts on top. */}
            <div className="card overflow-hidden">
              <h3 className="text-sm font-semibold text-app-fg mb-1">Conversion funnel</h3>
              <p className="text-xs text-app-fg-muted mb-3">
                Unique form views to delivered. Hover a bar for the drop-off from the prior stage.
              </p>
              <ClientOnly fallback={chartSkeleton}>
                <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelStages} margin={{ top: 24, right: 8, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="stage" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                    <Tooltip
                      cursor={{ fill: 'rgba(148,163,184,0.08)' }}
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

            {/* Top forms — donut (top slices + "Other") beside a scrollable ranked list.
                Scales when there are many forms: the donut stays legible and the full
                ranking lives in the list, not a wrapping legend. */}
            <div className="card overflow-hidden">
              <h3 className="text-sm font-semibold text-app-fg mb-1">Top forms by traffic</h3>
              <p className="text-xs text-app-fg-muted mb-3">Share of unique form views across your busiest forms.</p>
              {donutData.length === 0 ? (
                <EmptyState title="No forms with traffic" description="Form views by form will appear here." />
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="w-full sm:w-[46%] shrink-0">
                    <ClientOnly fallback={<div className="h-56 w-full animate-pulse rounded bg-app-hover" />}>
                      <div style={{ height: 224 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donutSlices}
                            dataKey="count"
                            nameKey="label"
                            innerRadius={52}
                            outerRadius={88}
                            paddingAngle={1}
                          >
                            {donutSlices.map((d) => (
                              <Cell key={d.key} fill={d.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value, _name, item) => {
                              const label = (item as unknown as { payload?: { label?: string } })?.payload?.label ?? '';
                              const n = Number(value);
                              const pct = topFormsTotal > 0 ? ` (${((n / topFormsTotal) * 100).toFixed(0)}%)` : '';
                              return [`${n.toLocaleString()}${pct}`, label];
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      </div>
                    </ClientOnly>
                  </div>
                  {/* Ranked list — every form, scrolls when there are many. */}
                  <ul className="w-full sm:flex-1 min-w-0 space-y-2 max-h-56 overflow-y-auto pr-1">
                    {donutData.map((f, i) => {
                      const pct = topFormsTotal > 0 ? (f.count / topFormsTotal) * 100 : 0;
                      return (
                        <li key={f.campaignId} className="min-w-0">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.fill }} />
                            <span className="truncate text-app-fg flex-1 min-w-0" title={f.label}>
                              {i + 1}. {f.label}
                            </span>
                            <span className="tabular-nums text-app-fg-muted shrink-0">
                              {f.count.toLocaleString()}
                            </span>
                            <span className="tabular-nums text-app-fg-muted shrink-0 w-9 text-right">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                          <div className="mt-1 ml-4 h-1 rounded-full bg-app-hover overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: f.fill }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* All forms table (clickable → per-form detail) + cross-funnel — always shown
          (both chart and data views), global view only (hidden on a form's detail page). */}
      {hasData && !isDetail && (
        <>
          <FormsTable forms={forms} filters={filters} />
          <CrossFunnelSection crossFunnel={crossFunnel} />
        </>
      )}
    </div>
  );
}

/** "View as data" — the same numbers as the charts, as plain tables. */
function AnalyticsDataView({
  statStrip,
  funnelStages,
  trendData,
  topForms,
  topFormsTotal,
}: {
  statStrip: FormAnalytics['statStrip'];
  funnelStages: Array<{ stage: string; count: number; dropPct: number | null }>;
  trendData: Array<{ date: string; label: string; viewsRaw: number; viewsUnique: number }>;
  topForms: FormAnalytics['topForms'];
  topFormsTotal: number;
}) {
  const th = 'text-left text-xs font-medium text-app-fg-muted uppercase tracking-wider px-3 py-2';
  const td = 'px-3 py-2 text-sm text-app-fg whitespace-nowrap';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Funnel table */}
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
            </tbody>
          </table>
        </div>

        {/* Top forms table */}
        <div className="card overflow-x-auto">
          <h3 className="text-sm font-semibold text-app-fg mb-3">Top forms by traffic</h3>
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Form</th>
                <th className={th}>Unique form views</th>
                <th className={th}>Share</th>
              </tr>
            </thead>
            <tbody>
              {topForms.map((f) => (
                <tr key={f.campaignId} className="border-t border-app-border">
                  <td className={td}>{f.label}</td>
                  <td className={td}>{f.count.toLocaleString()}</td>
                  <td className={td}>
                    {topFormsTotal > 0 ? `${((f.count / topFormsTotal) * 100).toFixed(0)}%` : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily trend table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-app-fg mb-3">Form views over time</h3>
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={th}>All form views</th>
              <th className={th}>Unique form views</th>
            </tr>
          </thead>
          <tbody>
            {trendData.length === 0 ? (
              <tr>
                <td className={td} colSpan={3}>No daily breakdown for this range.</td>
              </tr>
            ) : (
              trendData.map((d) => (
                <tr key={d.date} className="border-t border-app-border">
                  <td className={td}>{d.label}</td>
                  <td className={td}>{d.viewsRaw.toLocaleString()}</td>
                  <td className={td}>{d.viewsUnique.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary stats table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-app-fg mb-3">Summary</h3>
        <table className="min-w-full">
          <tbody>
            <tr className="border-t border-app-border">
              <td className={td}>Unique form views</td>
              <td className={td}>{statStrip.uniqueLandings.toLocaleString()}</td>
            </tr>
            <tr className="border-t border-app-border">
              <td className={td}>All form views</td>
              <td className={td}>{statStrip.rawLandings.toLocaleString()}</td>
            </tr>
            <tr className="border-t border-app-border">
              <td className={td}>Avg time on form</td>
              <td className={td}>{formatDwell(statStrip.avgDwellMs)}</td>
            </tr>
            <tr className="border-t border-app-border">
              <td className={td}>Conversion rate</td>
              <td className={td}>{formatPct(statStrip.conversionRate)}</td>
            </tr>
            <tr className="border-t border-app-border">
              <td className={td}>Orders matched to a view</td>
              <td className={td}>{formatPct(statStrip.attributionCoverage)}</td>
            </tr>
          </tbody>
        </table>
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

/** Clickable forms table — every form with views, conversion, avg dwell. Row → detail. */
function FormsTable({
  forms,
  filters,
}: {
  forms: FormAnalytics['forms'];
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  type FormRow = FormAnalytics['forms'][number];
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
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-app-fg">All forms</h3>
        <p className="text-xs text-app-fg-muted">Tap a form to see its own analytics.</p>
      </div>
      <CompactTable
        columns={columns}
        rows={forms}
        rowKey={(r) => r.campaignId}
        rowHref={(r) => detailHref(r.campaignId, filters)}
        emptyTitle="No forms with traffic"
        emptyDescription="Forms will appear here once they get views."
      />
    </div>
  );
}

/** Cross-funnel attempts — same phone+product submitted via different MBs. */
function CrossFunnelSection({ crossFunnel }: { crossFunnel: FormAnalytics['crossFunnel'] }) {
  const th = 'text-left text-xs font-medium text-app-fg-muted uppercase tracking-wider px-3 py-2';
  const td = 'px-3 py-2 text-sm text-app-fg whitespace-nowrap';
  const cards = [
    { label: 'Total attempts', value: crossFunnel.totalAttempts, title: 'Duplicate submissions caught (same phone + product).' },
    { label: 'Unique customers', value: crossFunnel.uniqueCustomers, title: 'Distinct customers behind those attempts.' },
    { label: 'Cross-funnel', value: crossFunnel.crossFunnel, title: 'Same customer reached via a different media buyer.' },
    { label: 'Resubmissions', value: crossFunnel.resubmissions, title: 'Same form submitted again by the same customer.' },
  ];
  return (
    <div className="card overflow-hidden">
      <h3 className="text-sm font-semibold text-app-fg mb-1">Cross-funnel attempts</h3>
      <p className="text-xs text-app-fg-muted mb-3">
        Customers who submitted the same phone and product more than once, including via other media buyers.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-app-border bg-app-elevated p-3" title={c.title}>
            <div className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">{c.label}</div>
            <div className="text-lg md:text-xl font-bold text-app-fg mt-0.5 tabular-nums">
              {c.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      {crossFunnel.perProduct.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {crossFunnel.perProduct.map((p) => (
                <tr key={p.productId ?? 'unknown'} className="border-t border-app-border">
                  <td className={td}>{p.productName ?? 'Unknown product'}</td>
                  <td className={td}>{p.attempts.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
