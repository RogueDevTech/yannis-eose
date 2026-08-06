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
} from 'recharts';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { useIsMobile } from '~/hooks/useIsMobile';

/**
 * Source-agnostic comparison view. The loader resolves the source + two periods,
 * computes each selected metric for both, and hands this component:
 *   - rows: the full metric table (Metric | A | B | Change)
 *   - funnel: the funnel-stage metrics for a grouped comparison chart
 * A highlights strip surfaces the biggest movers up top.
 */

export interface CompareRow {
  label: string;
  aFormatted: string;
  bFormatted: string;
  changeLabel: string;
  direction: 'up' | 'down' | 'flat';
  /** Raw values + relative magnitude — used to rank the highlights strip. */
  a: number;
  b: number;
  kind: 'count' | 'percent' | 'ms';
  changeMagnitude: number;
}

export interface CompareFunnelStage {
  stage: string;
  a: number;
  b: number;
}

export interface ComparePageProps {
  periodALabel: string;
  periodBLabel: string;
  rows: CompareRow[];
  funnel: CompareFunnelStage[];
  /** True when either period failed to load. */
  error?: boolean;
}

const A_COLOR = '#6366f1'; // indigo — period A
const B_COLOR = '#94a3b8'; // slate — period B

// Theme-aware Recharts tooltip — Recharts renders a hardcoded white card by
// default; map it to the app's CSS vars so it follows light/dark/soft. Compact
// padding + small type so it stays unobtrusive on mobile.
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'rgb(var(--app-elevated))',
  border: '1px solid rgb(var(--app-border))',
  borderRadius: '8px',
  color: 'rgb(var(--app-fg))',
  boxShadow: '0 4px 12px rgb(0 0 0 / 0.12)',
  padding: '6px 10px',
  fontSize: '12px',
  lineHeight: 1.3,
} as const;
const TOOLTIP_LABEL_STYLE = { color: 'rgb(var(--app-fg))', fontWeight: 600, marginBottom: '2px', fontSize: '12px' } as const;
const TOOLTIP_ITEM_STYLE = { color: 'rgb(var(--app-fg-muted))', padding: 0, fontSize: '12px' } as const;

const toneClass: Record<CompareRow['direction'], string> = {
  up: 'text-success-600 dark:text-success-400',
  down: 'text-danger-600 dark:text-danger-400',
  flat: 'text-app-fg-muted',
};

/** Recharts warns on 0×0 during SSR — mount the chart only after first paint. */
function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}

/**
 * Page frame — header + period labels. Renders INSTANTLY on navigation so the
 * switch is snappy; the body (real data or a skeleton) streams in as `children`.
 */
export function ComparePageShell({
  title,
  backTo,
  periodALabel,
  periodBLabel,
  children,
}: {
  title: string;
  backTo?: string;
  periodALabel: string;
  periodBLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Compare: ${title}`}
        description={`${periodALabel} vs ${periodBLabel}`}
        {...(backTo ? { backTo } : {})}
      />
      {children}
    </div>
  );
}

/** Skeleton body shown while both periods are still fetching. */
export function CompareLoadingBody() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      {/* Highlights strip */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-3 sm:p-5 space-y-2">
            <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
            <div className="h-6 w-16 rounded bg-app-hover animate-pulse" />
            <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
          </div>
        ))}
      </div>
      {/* Funnel chart */}
      <div className="card px-2 py-4 sm:p-5">
        <div className="h-4 w-40 rounded bg-app-hover animate-pulse mb-3" />
        <div className="h-72 w-full rounded bg-app-hover animate-pulse" />
      </div>
      {/* Metrics table */}
      <div className="card px-2 py-4 sm:p-5">
        <div className="h-4 w-28 rounded bg-app-hover animate-pulse mb-3" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-full rounded bg-app-hover animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The comparison body (highlights + funnel chart + metric table). Rendered inside
 *  ComparePageShell once the streamed data resolves. */
export function ComparePage({
  periodALabel,
  periodBLabel,
  rows,
  funnel,
  error = false,
}: ComparePageProps) {
  const chartUid = useId().replace(/:/g, '');
  const isMobile = useIsMobile();
  // On mobile the funnel stage labels don't fit horizontally — slant them and give
  // the chart extra bottom room instead of truncating.
  const xAxisProps = isMobile
    ? { angle: -35, textAnchor: 'end' as const, height: 56, tick: { fontSize: 10 } }
    : { tick: { fontSize: 11 } };
  const chartMargin = isMobile
    ? { top: 8, right: 8, left: 0, bottom: 8 }
    : { top: 8, right: 8, left: 4, bottom: 4 };
  const th = 'text-left text-xs font-medium text-app-fg-muted uppercase tracking-wider px-3 py-2';
  const thRight = 'text-right text-xs font-medium text-app-fg-muted uppercase tracking-wider px-3 py-2';
  const td = 'px-3 py-2 text-sm text-app-fg whitespace-nowrap';
  const tdRight = 'px-3 py-2 text-sm whitespace-nowrap text-right tabular-nums';

  // Biggest movers: rank by relative change magnitude, then by absolute change
  // size as a deterministic tiebreak (zero-baseline metrics share a capped
  // magnitude, so this orders them by how big the jump actually was).
  const highlights = [...rows]
    .filter((r) => r.direction !== 'flat')
    .sort((x, y) => y.changeMagnitude - x.changeMagnitude || Math.abs(y.a - y.b) - Math.abs(x.a - x.b))
    .slice(0, 3);

  const funnelChartData = funnel.map((s) => ({ stage: s.stage, [periodALabel]: s.a, [periodBLabel]: s.b }));

  return (
    <>
      {error ? (
        <EmptyState
          title="Could not load one of the periods"
          description="One or both periods failed to load. Go back and try different dates."
        />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing to compare" description="No metrics were selected for these periods." />
      ) : (
        <>
          {/* Highlights — biggest movers, using the shared OverviewStatStrip so it
              matches every dashboard. Each tile: the metric, its change (colored by
              direction), and the two period values as A → B. */}
          {highlights.length > 0 && (
            <OverviewStatStrip
              mobileGrid
              items={highlights.map((h) => ({
                label: h.label,
                title: `${periodALabel}: ${h.aFormatted} → ${periodBLabel}: ${h.bFormatted}`,
                plainValue: true,
                value: (
                  <span className="flex flex-col leading-tight">
                    <span className={`inline-flex items-center gap-1 text-lg md:text-xl font-bold tabular-nums ${toneClass[h.direction]}`}>
                      {h.direction === 'up' ? '↑' : h.direction === 'down' ? '↓' : ''}
                      {h.changeLabel}
                    </span>
                    <span className="mt-0.5 text-[11px] text-app-fg-muted tabular-nums truncate">
                      {h.aFormatted} <span className="text-app-fg-muted">→</span> {h.bFormatted}
                    </span>
                  </span>
                ),
              }))}
            />
          )}

          {/* Funnel comparison — the two periods' stages, grouped side by side. */}
          {funnelChartData.length > 0 && (
            <div className="card overflow-hidden px-2 py-4 sm:p-5">
              <h3 className="text-sm font-semibold text-app-fg mb-3 px-2 sm:px-0">Funnel comparison</h3>
              <ClientOnly fallback={<div className="h-72 w-full animate-pulse rounded bg-app-hover" />}>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={funnelChartData} margin={chartMargin}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="stage" interval={0} {...xAxisProps} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                      <Tooltip
                        cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
                        formatter={(value, name) => [Number(value).toLocaleString(), String(name)] as [string, string]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey={periodALabel} fill={A_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
                      <Bar dataKey={periodBLabel} fill={B_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ClientOnly>
            </div>
          )}

          {/* Full metric table (desktop) / stacked cards (mobile) — a 4-col table
              forces horizontal scrolling on a phone, so mobile gets one card per
              metric with A/B values and the change. */}
          <div className="card px-2 py-4 sm:p-5">
            <h3 className="text-sm font-semibold text-app-fg mb-3 px-2 sm:px-0">All metrics</h3>

            {/* Mobile: stacked cards */}
            <ul className="space-y-2 sm:hidden">
              {rows.map((r) => (
                <li key={r.label} className="rounded-lg border border-app-border bg-app-elevated p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-app-fg">{r.label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${toneClass[r.direction]}`}>
                      {r.changeLabel}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-4 text-xs tabular-nums">
                    <span className="text-app-fg">
                      <span className="text-app-fg-muted">{periodALabel}: </span>
                      {r.aFormatted}
                    </span>
                    <span className="text-app-fg-muted">
                      <span className="text-app-fg-muted">{periodBLabel}: </span>
                      {r.bFormatted}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: full table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Metric</th>
                    <th className={thRight}>{periodALabel}</th>
                    <th className={thRight}>{periodBLabel}</th>
                    <th className={thRight}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-t border-app-border">
                      <td className={td}>{r.label}</td>
                      <td className={`${tdRight} text-app-fg`}>{r.aFormatted}</td>
                      <td className={`${tdRight} text-app-fg-muted`}>{r.bFormatted}</td>
                      <td className={`${tdRight} ${toneClass[r.direction]}`}>{r.changeLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
