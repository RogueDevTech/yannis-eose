import { apiRequest } from '~/lib/api.server';
import type { FormAnalytics } from '~/features/marketing/types';

/**
 * Reusable period-comparison flow (/admin/compare).
 *
 * A "source" is any dataset that can be compared across two time periods. Each
 * source registers here with: a human label, the role/permission gate that
 * guards it, a server-side `fetchPeriod` that returns one period's metric values,
 * and the list of metrics to show (label + how to format). Adding comparison to a
 * new page = one entry here + dropping a <CompareButton source="..."> in its
 * header. The compare route and picker are entirely source-agnostic.
 */

export type CompareGranularity = 'day' | 'month';

/** A concrete date window for one side of the comparison. */
export interface ComparePeriod {
  /** ISO YYYY-MM-DD (inclusive). */
  startDate: string;
  /** ISO YYYY-MM-DD (inclusive). */
  endDate: string;
  /** Human label for the column header, e.g. "6 Aug 2026" or "July 2026". */
  label: string;
}

/** How a metric value is rendered + how its change is expressed. */
export type CompareMetricKind = 'count' | 'percent' | 'ms';

export interface CompareMetricDef<V> {
  /** Stable key — used in the metric picker + the ?metrics= URL param. */
  key: string;
  /** Row label. */
  label: string;
  /** Pull the numeric value out of a fetched period's payload. */
  value: (data: V) => number;
  kind: CompareMetricKind;
  /** True for funnel-stage metrics — drives the grouped funnel comparison chart. */
  funnel?: boolean;
}

export interface CompareSource<V = unknown> {
  key: string;
  /** Shown in the compare page title, e.g. "Marketing analytics". */
  label: string;
  /** Where the Compare button came from — link back to it from the compare page. */
  backTo?: string;
  /** Access gate, mirrored from the source page's own loader. */
  guard: { roles: string[]; permission: string | string[]; orMarketingTeamSupervisorOnBranch?: boolean };
  /** Fetch one period's raw payload server-side. Returns null on failure. */
  fetchPeriod: (period: ComparePeriod, cookie: string | undefined) => Promise<V | null>;
  /** Metrics to compare, in display order. */
  metrics: CompareMetricDef<V>[];
}

/** tRPC envelope unwrap helper. */
function unwrap<T>(res: { ok: boolean; data: unknown }): T | null {
  if (!res.ok) return null;
  return ((res.data as { result?: { data?: T } })?.result?.data ?? null) as T | null;
}

// ── Sources ────────────────────────────────────────────────────────────────

/**
 * Marketing form analytics. Reuses `marketing.formAnalyticsPageBundle` (which
 * already scopes by the caller's role), so the compared numbers match the
 * analytics page exactly.
 */
const marketingAnalyticsSource: CompareSource<FormAnalytics> = {
  key: 'marketing-analytics',
  label: 'Marketing analytics',
  backTo: '/admin/marketing/analytics',
  guard: {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.teamOverview',
    orMarketingTeamSupervisorOnBranch: true,
  },
  fetchPeriod: async (period, cookie) => {
    const input = encodeURIComponent(
      JSON.stringify({ startDate: period.startDate, endDate: period.endDate }),
    );
    const res = await apiRequest<unknown>(
      `/trpc/marketing.formAnalyticsPageBundle?input=${input}`,
      { method: 'GET', cookie },
    );
    return unwrap<FormAnalytics>(res);
  },
  metrics: [
    { key: 'uniqueViews', label: 'Unique form views', kind: 'count', value: (d) => d.statStrip.uniqueLandings },
    { key: 'allViews', label: 'All form views', kind: 'count', value: (d) => d.statStrip.rawLandings },
    { key: 'avgTime', label: 'Avg time on form', kind: 'ms', value: (d) => d.statStrip.avgDwellMs ?? 0 },
    { key: 'conversion', label: 'Conversion', kind: 'percent', value: (d) => d.statStrip.conversionRate },
    { key: 'attribution', label: 'Attribution rate', kind: 'percent', value: (d) => d.statStrip.attributionCoverage },
    { key: 'formViews', label: 'Form views', kind: 'count', funnel: true, value: (d) => d.funnel.formViews },
    { key: 'startedCart', label: 'Started cart', kind: 'count', funnel: true, value: (d) => d.funnel.startedCart },
    { key: 'ordered', label: 'Ordered', kind: 'count', funnel: true, value: (d) => d.funnel.ordered },
    { key: 'confirmed', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => d.funnel.confirmed },
    { key: 'delivered', label: 'Delivered', kind: 'count', funnel: true, value: (d) => d.funnel.delivered },
  ],
};

/**
 * Marketing orders KPIs. Reuses `marketing.metrics` (getPerformanceMetrics),
 * which scopes by the caller's role exactly like the Marketing Orders page, so
 * the compared numbers match the page's stat strip.
 *
 * Note: `confirmationRate` / `deliveryRate` come back as 0-100 from the API, but
 * the compare `percent` kind multiplies by 100 for display — so we divide by 100
 * here to store them as 0-1 ratios (matching how conversion is handled elsewhere).
 */
interface MarketingMetricsPayload {
  totalSpend: number;
  totalOrders: number;
  deliveredOrders: number;
  deliveredThisMonth?: number;
  deliveredRevenue: number;
  confirmedOrders: number;
  confirmationRate: number; // 0-100
  cpa: number;
  trueRoas: number;
  deliveryRate: number; // 0-100
}

const marketingOrdersSource: CompareSource<MarketingMetricsPayload> = {
  key: 'marketing-orders',
  label: 'Marketing orders',
  backTo: '/admin/marketing/orders',
  guard: {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.orders',
    orMarketingTeamSupervisorOnBranch: true,
  },
  fetchPeriod: async (period, cookie) => {
    const input = encodeURIComponent(
      JSON.stringify({ startDate: period.startDate, endDate: period.endDate }),
    );
    const res = await apiRequest<unknown>(
      `/trpc/marketing.metrics?input=${input}`,
      { method: 'GET', cookie },
    );
    return unwrap<MarketingMetricsPayload>(res);
  },
  metrics: [
    { key: 'totalOrders', label: 'Total orders', kind: 'count', funnel: true, value: (d) => d.totalOrders },
    { key: 'confirmedOrders', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => d.confirmedOrders },
    { key: 'deliveredOrders', label: 'Delivered', kind: 'count', funnel: true, value: (d) => d.deliveredOrders },
    { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => d.confirmationRate / 100 },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => d.deliveryRate / 100 },
    { key: 'cpa', label: 'CPA', kind: 'count', value: (d) => d.cpa },
    { key: 'trueRoas', label: 'True ROAS', kind: 'count', value: (d) => d.trueRoas },
    { key: 'deliveredRevenue', label: 'Delivered revenue', kind: 'count', value: (d) => d.deliveredRevenue },
    { key: 'totalSpend', label: 'Ad spend', kind: 'count', value: (d) => d.totalSpend },
  ],
};

// ── Order status-count sources (Sales + Logistics) ───────────────────────────

/** Raw status-count payload — a flat map of order status → count. */
type StatusCounts = Record<string, number>;

const n = (d: StatusCounts, k: string) => Number(d[k] ?? 0);
/** Confirmed-or-beyond roll-up (matches the CS/logistics stat-strip derivation). */
const confirmedPlus = (d: StatusCounts) =>
  n(d, 'CONFIRMED') + n(d, 'AGENT_ASSIGNED') + n(d, 'DISPATCHED') + n(d, 'IN_TRANSIT') +
  n(d, 'DELIVERED') + n(d, 'PARTIALLY_DELIVERED') + n(d, 'REMITTED') + n(d, 'RETURNED') +
  n(d, 'RESTOCKED') + n(d, 'WRITTEN_OFF');
const deliveredPlus = (d: StatusCounts) => n(d, 'DELIVERED') + n(d, 'REMITTED');
/** Total excluding DELETED + category tallies (keys prefixed with `__`). */
const totalExclDeleted = (d: StatusCounts) =>
  Object.entries(d).reduce((sum, [k, v]) => (k === 'DELETED' || k.startsWith('__') ? sum : sum + Number(v)), 0);

/**
 * Sales / Funnel orders (CS servicing scope). Reuses `orders.statusCounts`, which
 * auto-scopes to the caller's servicing branch (same as the /admin/sales/orders
 * stat strip). Metric accessors derive the CS funnel + rates from the raw counts.
 */
const salesOrdersSource: CompareSource<StatusCounts> = {
  key: 'sales-orders',
  label: 'Funnel orders',
  backTo: '/admin/sales/orders',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_CLOSER'], permission: 'orders.read' },
  fetchPeriod: async (period, cookie) => {
    const input = encodeURIComponent(
      JSON.stringify({ startDate: period.startDate, endDate: period.endDate }),
    );
    const res = await apiRequest<unknown>(`/trpc/orders.statusCounts?input=${input}`, { method: 'GET', cookie });
    return unwrap<StatusCounts>(res);
  },
  metrics: [
    { key: 'total', label: 'Total orders', kind: 'count', funnel: true, value: totalExclDeleted },
    { key: 'unprocessed', label: 'Unprocessed', kind: 'count', funnel: true, value: (d) => n(d, 'UNPROCESSED') },
    { key: 'assigned', label: 'CS assigned', kind: 'count', funnel: true, value: (d) => n(d, 'CS_ASSIGNED') },
    { key: 'confirmed', label: 'Confirmed', kind: 'count', funnel: true, value: confirmedPlus },
    { key: 'delivered', label: 'Delivered', kind: 'count', funnel: true, value: deliveredPlus },
    { key: 'remitted', label: 'Remitted', kind: 'count', funnel: true, value: (d) => n(d, 'REMITTED') },
    { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => { const t = totalExclDeleted(d); return t > 0 ? confirmedPlus(d) / t : 0; } },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => { const t = totalExclDeleted(d); return t > 0 ? deliveredPlus(d) / t : 0; } },
  ],
};

/** Logistics status counts bundle (unions orders + cart + follow-up, servicing-scoped). */
interface LogisticsBundlePayload {
  statusCounts: StatusCounts;
}

/**
 * Logistics orders. Reuses `logistics.logisticsOrdersPageBundle` (the only exposed
 * entry for logistics counts), reading `.statusCounts`. Scopes by the caller's
 * effective branches server-side, like the /admin/logistics/orders stat strip.
 */
const logisticsOrdersSource: CompareSource<LogisticsBundlePayload> = {
  key: 'logistics-orders',
  label: 'Logistics orders',
  backTo: '/admin/logistics/orders',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS', 'STOCK_MANAGER', 'TPL_MANAGER'], permission: 'logistics.read' },
  fetchPeriod: async (period, cookie) => {
    // limit:1 — we only want statusCounts, not the paginated orders.
    const input = encodeURIComponent(
      JSON.stringify({ page: 1, limit: 1, startDate: period.startDate, endDate: period.endDate }),
    );
    const res = await apiRequest<unknown>(`/trpc/logistics.logisticsOrdersPageBundle?input=${input}`, { method: 'GET', cookie });
    return unwrap<LogisticsBundlePayload>(res);
  },
  metrics: [
    { key: 'confirmed', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => n(d.statusCounts, 'CONFIRMED') },
    { key: 'allocated', label: 'Allocated', kind: 'count', funnel: true, value: (d) => n(d.statusCounts, 'AGENT_ASSIGNED') },
    { key: 'dispatched', label: 'Dispatched', kind: 'count', funnel: true, value: (d) => n(d.statusCounts, 'DISPATCHED') },
    { key: 'inTransit', label: 'In transit', kind: 'count', funnel: true, value: (d) => n(d.statusCounts, 'IN_TRANSIT') },
    { key: 'delivered', label: 'Delivered', kind: 'count', funnel: true, value: (d) => n(d.statusCounts, 'DELIVERED') },
    { key: 'remitted', label: 'Remitted', kind: 'count', funnel: true, value: (d) => n(d.statusCounts, 'REMITTED') },
  ],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SOURCES: Record<string, CompareSource<any>> = {
  [marketingAnalyticsSource.key]: marketingAnalyticsSource,
  [marketingOrdersSource.key]: marketingOrdersSource,
  [salesOrdersSource.key]: salesOrdersSource,
  [logisticsOrdersSource.key]: logisticsOrdersSource,
};

export function getCompareSource(key: string | null | undefined): CompareSource | undefined {
  if (!key) return undefined;
  return SOURCES[key];
}

// ── Period math (shared by the picker + the loader) ──────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Turn a granularity + a point token into a concrete period + label.
 *   day   → token is YYYY-MM-DD; period is that single day.
 *   month → token is YYYY-MM; period spans the whole calendar month.
 * Returns null if the token is malformed.
 */
export function resolveComparePeriod(
  granularity: CompareGranularity,
  token: string,
): ComparePeriod | null {
  if (granularity === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return null;
    const d = new Date(`${token}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    const label = `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return { startDate: token, endDate: token, label };
  }
  // month
  if (!/^\d{4}-\d{2}$/.test(token)) return null;
  const [yStr, mStr] = token.split('-');
  const year = Number(yStr);
  const month = Number(mStr); // 1-12
  if (!year || month < 1 || month > 12) return null;
  const startDate = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  const label = `${MONTH_NAMES[month - 1]} ${year}`;
  return { startDate, endDate, label };
}

/** Render a metric value per its kind. Kept framework-free so both server + client can use it. */
export function formatCompareValue(value: number, kind: CompareMetricKind): string {
  if (kind === 'percent') return `${(value * 100).toFixed(1)}%`;
  if (kind === 'ms') {
    if (value < 1000) return `${Math.round(value)}ms`;
    const s = value / 1000;
    if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s % 60)}s`;
  }
  return value.toLocaleString();
}

/** Change label + direction between two values for a metric kind. */
export function computeCompareChange(
  now: number,
  prev: number,
  kind: CompareMetricKind,
): { label: string; direction: 'up' | 'down' | 'flat' } {
  const diff = now - prev;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  if (kind === 'percent') {
    return { label: `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)} pts`, direction };
  }
  if (prev === 0) {
    return { label: now === 0 ? '0%' : 'new', direction };
  }
  const relPct = (diff / prev) * 100;
  return { label: `${relPct >= 0 ? '+' : ''}${relPct.toFixed(0)}%`, direction };
}
