import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, redirect } from '@remix-run/node';
import { Await, useLoaderData } from '@remix-run/react';
import { Suspense } from 'react';
import { getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import {
  ComparePage,
  ComparePageShell,
  CompareLoadingBody,
  type CompareRow,
  type CompareFunnelStage,
} from '~/features/compare/ComparePage';
import {
  getCompareSource,
  resolveComparePeriod,
  formatCompareValue,
  computeCompareChange,
  type CompareGranularity,
} from '~/features/compare/compare-registry';

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `Compare: ${data.sourceLabel} — Yannis EOSE` : 'Compare — Yannis EOSE' },
];

/** Ceiling for the relative-change ranking so a zero-baseline metric (B=0) can't
 *  outrank every finite mover. 100 = a 10,000% swing, well past any real change. */
const MAX_CHANGE_MAGNITUDE = 100;

/** The streamed part — computed metric rows + funnel for both periods. */
interface ComparisonResult {
  error: boolean;
  rows: CompareRow[];
  funnel: CompareFunnelStage[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const sourceKey = url.searchParams.get('source');
  const source = getCompareSource(sourceKey);

  // No/unknown source → this page has nothing to show on its own. Route away to
  // the dashboard rather than parking on an empty state; Compare is only reached
  // via a source page's Compare button (which always supplies a valid query).
  if (!source) {
    throw redirect('/admin');
  }

  // Enforce the SOURCE's own access rules (reuse across domains with different gates).
  await requirePermissionOrRoles(request, source.guard);

  const granularity = (url.searchParams.get('granularity') ?? 'month') as CompareGranularity;
  const aToken = url.searchParams.get('a') ?? '';
  const bToken = url.searchParams.get('b') ?? '';
  // Optional per-period time window (HH:MM). Blank = full day/month.
  const aFrom = url.searchParams.get('aFrom') ?? '';
  const aTo = url.searchParams.get('aTo') ?? '';
  const bFrom = url.searchParams.get('bFrom') ?? '';
  const bTo = url.searchParams.get('bTo') ?? '';
  const periodA = resolveComparePeriod(granularity, aToken, { from: aFrom, to: aTo });
  const periodB = resolveComparePeriod(granularity, bToken, { from: bFrom, to: bTo });

  // Missing/malformed periods, or the two periods being TRULY identical (same date
  // AND same time window) → send the user back rather than showing a broken compare.
  // Identical periods would give both funnel bars + table columns the same label.
  const sameWindow = aToken === bToken && aFrom === bFrom && aTo === bTo;
  if (!periodA || !periodB || sameWindow) {
    throw redirect(source.backTo ?? '/admin');
  }

  const cookie = getSessionCookie(request);

  // Metric selection from the picker: ?metrics=a,b,c. Absent = all metrics.
  const metricsParam = url.searchParams.get('metrics');
  const selectedKeys = metricsParam ? new Set(metricsParam.split(',').filter(Boolean)) : null;
  const activeMetrics = selectedKeys
    ? source.metrics.filter((m) => selectedKeys.has(m.key))
    : source.metrics;

  // Stream the actual comparison so navigation is INSTANT — the page shell +
  // period labels render immediately with a skeleton, then the computed rows
  // swap in when both periods finish fetching.
  const comparison: Promise<ComparisonResult> = (async () => {
    const [dataA, dataB] = await Promise.all([
      source.fetchPeriod(periodA, cookie),
      source.fetchPeriod(periodB, cookie),
    ]);

    if (dataA == null || dataB == null) {
      return { error: true, rows: [], funnel: [] };
    }

    const rows: CompareRow[] = activeMetrics.map((m) => {
      const a = m.value(dataA); // first-selected period = baseline ("previous")
      const b = m.value(dataB); // second-selected period = subject ("later")
      // Change measures how the LATER period (B) moved relative to the EARLIER (A):
      // (B − A) / A. So if B is lower than A the change is negative/red — B is not
      // ahead of the baseline. (now = B, prev = A.)
      const change = computeCompareChange(b, a, m.kind);
      return {
        label: m.label,
        aFormatted: formatCompareValue(a, m.kind),
        bFormatted: formatCompareValue(b, m.kind),
        changeLabel: change.label,
        direction: change.direction,
        a,
        b,
        kind: m.kind,
        // Relative change magnitude for ranking the "biggest movers" strip. Baseline
        // is A (the earlier period). When A=0 (no baseline) the ratio is undefined;
        // instead of Infinity — which ties every "new from zero" metric and always
        // outranks real finite movers — cap at a finite ceiling so genuine large
        // changes stay comparable, and let the absolute-value tiebreak order the
        // zero-baseline ones sensibly (bigger jump ranks higher).
        changeMagnitude:
          a !== 0 ? Math.min(Math.abs((b - a) / a), MAX_CHANGE_MAGNITUDE) : b !== 0 ? MAX_CHANGE_MAGNITUDE : 0,
      };
    });

    const funnel: CompareFunnelStage[] = activeMetrics
      .filter((m) => m.funnel)
      .map((m) => ({ stage: m.label, a: m.value(dataA), b: m.value(dataB) }));

    return { error: false, rows, funnel };
  })();

  return defer({
    sourceLabel: source.label,
    backTo: source.backTo ?? null,
    periodALabel: periodA.label,
    periodBLabel: periodB.label,
    comparison,
  });
}

export default function AdminCompareRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <ComparePageShell
      title={data.sourceLabel}
      backTo={data.backTo ?? undefined}
      periodALabel={data.periodALabel}
      periodBLabel={data.periodBLabel}
    >
      <Suspense fallback={<CompareLoadingBody />}>
        <Await resolve={data.comparison}>
          {(result) => (
            <ComparePage
              periodALabel={data.periodALabel}
              periodBLabel={data.periodBLabel}
              rows={result.rows}
              funnel={result.funnel}
              error={result.error}
            />
          )}
        </Await>
      </Suspense>
    </ComparePageShell>
  );
}
