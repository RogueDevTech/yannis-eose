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

// ── Helpers shared by the string-amount sources ─────────────────────────────

/** Parse a numeric-string (Postgres ::text amount) to a number. */
const num = (v: unknown): number => {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** GET a tRPC procedure with a {startDate, endDate, ...extra} input. */
async function fetchDated<T>(
  proc: string,
  period: ComparePeriod,
  cookie: string | undefined,
  extra: Record<string, unknown> = {},
): Promise<T | null> {
  const input = encodeURIComponent(
    JSON.stringify({ startDate: period.startDate, endDate: period.endDate, ...extra }),
  );
  const res = await apiRequest<unknown>(`/trpc/${proc}?input=${input}`, { method: 'GET', cookie });
  return unwrap<T>(res);
}

// ── Marketing: overview / team / cross-funnel / expenses / leaderboard ────────

interface MarketingOverviewPayload {
  metrics: {
    totalSpend: number;
    approvedSpend: number;
    pendingSpend: number;
    otherExpenses: number;
    totalOrders: number;
    deliveredOrders: number;
    deliveredThisMonth: number;
    deliveredRevenue: number;
    confirmedOrders: number;
    confirmationRate: number; // 0-100
    cpa: number;
    trueRoas: number; // ratio
    deliveryRate: number; // 0-100
  };
  abandonedCartCount: number;
}

const marketingOverviewSource: CompareSource<MarketingOverviewPayload> = {
  key: 'marketing-overview',
  label: 'Marketing overview',
  backTo: '/admin/marketing/overview',
  guard: {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.teamOverview',
    orMarketingTeamSupervisorOnBranch: true,
  },
  fetchPeriod: (period, cookie) =>
    fetchDated<MarketingOverviewPayload>('marketing.overviewPageBundle', period, cookie),
  metrics: [
    { key: 'totalOrders', label: 'Total orders', kind: 'count', funnel: true, value: (d) => d.metrics.totalOrders },
    { key: 'confirmedOrders', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => d.metrics.confirmedOrders },
    { key: 'deliveredOrders', label: 'Delivered', kind: 'count', funnel: true, value: (d) => d.metrics.deliveredOrders },
    { key: 'deliveredRevenue', label: 'Delivered revenue', kind: 'count', value: (d) => d.metrics.deliveredRevenue },
    { key: 'totalSpend', label: 'Total ad spend', kind: 'count', value: (d) => d.metrics.totalSpend },
    { key: 'approvedSpend', label: 'Approved spend', kind: 'count', value: (d) => d.metrics.approvedSpend },
    { key: 'otherExpenses', label: 'Other expenses', kind: 'count', value: (d) => d.metrics.otherExpenses },
    { key: 'cpa', label: 'CPA', kind: 'count', value: (d) => d.metrics.cpa },
    { key: 'trueRoas', label: 'True ROAS', kind: 'count', value: (d) => d.metrics.trueRoas },
    { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => d.metrics.confirmationRate / 100 },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => d.metrics.deliveryRate / 100 },
    { key: 'abandonedCarts', label: 'Abandoned carts', kind: 'count', value: (d) => d.abandonedCartCount },
  ],
};

/** One row of `marketing.leaderboard` / `marketing.teamPageBundle.leaderboard`. */
interface MarketingLeaderboardEntry {
  totalSpend: number;
  totalOrders: number;
  deliveredOrders: number;
  deliveredThisMonth: number;
  deliveredRevenue: number;
  confirmedOrders: number;
  confirmationRate: number; // 0-100
  cpa: number;
  trueRoas: number;
  deliveryRate: number; // 0-100
  profitabilityScore: number; // 0-1
}

/** Sum leaderboard rows into team totals + recomputed rates. */
function reduceMarketingLeaderboard(rows: MarketingLeaderboardEntry[]) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.totalSpend += num(r.totalSpend);
      acc.totalOrders += num(r.totalOrders);
      acc.deliveredOrders += num(r.deliveredOrders);
      acc.deliveredRevenue += num(r.deliveredRevenue);
      acc.confirmedOrders += num(r.confirmedOrders);
      return acc;
    },
    { totalSpend: 0, totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0 },
  );
  return {
    ...totals,
    mbCount: rows.length,
    confirmationRate: totals.totalOrders > 0 ? totals.confirmedOrders / totals.totalOrders : 0,
    deliveryRate: totals.totalOrders > 0 ? totals.deliveredOrders / totals.totalOrders : 0,
  };
}

interface MarketingTeamBundle {
  leaderboard: MarketingLeaderboardEntry[];
  fundingSummary?: { totalSent?: string; totalCompleted?: string; totalDisputed?: string } | null;
}

const marketingTeamSource: CompareSource<MarketingTeamBundle> = {
  key: 'marketing-team',
  label: 'Marketing team',
  backTo: '/admin/marketing/team',
  guard: {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
    permission: 'marketing.teamOverview',
    orMarketingTeamSupervisorOnBranch: true,
  },
  fetchPeriod: (period, cookie) =>
    fetchDated<MarketingTeamBundle>('marketing.teamPageBundle', period, cookie),
  metrics: [
    { key: 'totalOrders', label: 'Total orders', kind: 'count', funnel: true, value: (d) => reduceMarketingLeaderboard(d.leaderboard ?? []).totalOrders },
    { key: 'confirmedOrders', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => reduceMarketingLeaderboard(d.leaderboard ?? []).confirmedOrders },
    { key: 'deliveredOrders', label: 'Delivered', kind: 'count', funnel: true, value: (d) => reduceMarketingLeaderboard(d.leaderboard ?? []).deliveredOrders },
    { key: 'deliveredRevenue', label: 'Delivered revenue', kind: 'count', value: (d) => reduceMarketingLeaderboard(d.leaderboard ?? []).deliveredRevenue },
    { key: 'totalSpend', label: 'Ad spend', kind: 'count', value: (d) => reduceMarketingLeaderboard(d.leaderboard ?? []).totalSpend },
    { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => reduceMarketingLeaderboard(d.leaderboard ?? []).confirmationRate },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => reduceMarketingLeaderboard(d.leaderboard ?? []).deliveryRate },
    { key: 'activeMbs', label: 'Active media buyers', kind: 'count', value: (d) => (d.leaderboard ?? []).length },
    { key: 'fundingSent', label: 'Funding sent', kind: 'count', value: (d) => num(d.fundingSummary?.totalSent) },
    { key: 'fundingCompleted', label: 'Funding completed', kind: 'count', value: (d) => num(d.fundingSummary?.totalCompleted) },
  ],
};

interface CrossFunnelStats {
  totalAttempts?: number;
  uniqueCustomers?: number;
  resubmissions?: number;
  sameMb?: number;
  crossFunnel?: number;
}

const marketingCrossFunnelSource: CompareSource<CrossFunnelStats> = {
  key: 'marketing-cross-funnel',
  label: 'Cross-funnel attempts',
  backTo: '/admin/marketing/cross-funnel',
  guard: {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.read',
    orMarketingTeamSupervisorOnBranch: true,
  },
  fetchPeriod: (period, cookie) =>
    fetchDated<CrossFunnelStats>('marketing.crossFunnelStats', period, cookie),
  metrics: [
    { key: 'totalAttempts', label: 'Total attempts', kind: 'count', funnel: true, value: (d) => num(d.totalAttempts) },
    { key: 'uniqueCustomers', label: 'Unique customers', kind: 'count', funnel: true, value: (d) => num(d.uniqueCustomers) },
    { key: 'resubmissions', label: 'Resubmissions', kind: 'count', funnel: true, value: (d) => num(d.resubmissions) },
    { key: 'sameMb', label: 'Same media buyer', kind: 'count', value: (d) => num(d.sameMb) },
    { key: 'crossFunnel', label: 'Cross-funnel', kind: 'count', value: (d) => num(d.crossFunnel) },
  ],
};

interface AdSpendListPayload {
  totalSpend: string;
  pagination: { total: number };
}

const marketingExpensesSource: CompareSource<{ approved: AdSpendListPayload | null; pending: AdSpendListPayload | null }> = {
  key: 'marketing-expenses',
  label: 'Ad spend',
  backTo: '/admin/marketing/expenses',
  guard: {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: 'marketing.read',
    orMarketingTeamSupervisorOnBranch: true,
  },
  fetchPeriod: async (period, cookie) => {
    const [approved, pending] = await Promise.all([
      fetchDated<AdSpendListPayload>('marketing.listAdSpend', period, cookie, { status: 'APPROVED', page: 1, limit: 1 }),
      fetchDated<AdSpendListPayload>('marketing.listAdSpend', period, cookie, { status: 'PENDING', page: 1, limit: 1 }),
    ]);
    if (!approved && !pending) return null;
    return { approved, pending };
  },
  metrics: [
    { key: 'approvedSpend', label: 'Approved spend', kind: 'count', value: (d) => num(d.approved?.totalSpend) },
    { key: 'pendingSpend', label: 'Pending spend', kind: 'count', value: (d) => num(d.pending?.totalSpend) },
    { key: 'totalSpend', label: 'Total spend', kind: 'count', value: (d) => num(d.approved?.totalSpend) + num(d.pending?.totalSpend) },
    { key: 'approvedCount', label: 'Approved entries', kind: 'count', value: (d) => num(d.approved?.pagination?.total) },
    { key: 'pendingCount', label: 'Pending entries', kind: 'count', value: (d) => num(d.pending?.pagination?.total) },
  ],
};

const marketingLeaderboardSource: CompareSource<MarketingLeaderboardEntry[]> = {
  key: 'marketing-leaderboard',
  label: 'Marketing leaderboard',
  backTo: '/admin/marketing/leaderboard',
  guard: {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING'],
    permission: 'marketing.leaderboard',
    orMarketingTeamSupervisorOnBranch: true,
  },
  fetchPeriod: (period, cookie) =>
    fetchDated<MarketingLeaderboardEntry[]>('marketing.leaderboard', period, cookie),
  metrics: [
    { key: 'totalOrders', label: 'Total orders', kind: 'count', funnel: true, value: (d) => reduceMarketingLeaderboard(d ?? []).totalOrders },
    { key: 'confirmedOrders', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => reduceMarketingLeaderboard(d ?? []).confirmedOrders },
    { key: 'deliveredOrders', label: 'Delivered', kind: 'count', funnel: true, value: (d) => reduceMarketingLeaderboard(d ?? []).deliveredOrders },
    { key: 'deliveredRevenue', label: 'Delivered revenue', kind: 'count', value: (d) => reduceMarketingLeaderboard(d ?? []).deliveredRevenue },
    { key: 'totalSpend', label: 'Ad spend', kind: 'count', value: (d) => reduceMarketingLeaderboard(d ?? []).totalSpend },
    { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => reduceMarketingLeaderboard(d ?? []).confirmationRate },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => reduceMarketingLeaderboard(d ?? []).deliveryRate },
    { key: 'mbCount', label: 'Media buyers', kind: 'count', value: (d) => (d ?? []).length },
  ],
};

// ── Sales: team / leaderboard ────────────────────────────────────────────────

/** One row of `orders.csLeaderboard` / csTeamPageBundle.leaderboard. */
interface CSLeaderboardEntry {
  ordersEngaged: number;
  ordersConfirmed: number;
  ordersDelivered: number;
  callsMade: number;
  confirmationRate: number; // 0-100
  deliveryRate: number; // 0-100
}

function reduceCSLeaderboard(rows: CSLeaderboardEntry[]) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.engaged += num(r.ordersEngaged);
      acc.confirmed += num(r.ordersConfirmed);
      acc.delivered += num(r.ordersDelivered);
      acc.calls += num(r.callsMade);
      return acc;
    },
    { engaged: 0, confirmed: 0, delivered: 0, calls: 0 },
  );
  return {
    ...totals,
    closers: rows.length,
    confirmationRate: totals.engaged > 0 ? totals.confirmed / totals.engaged : 0,
    deliveryRate: totals.engaged > 0 ? totals.delivered / totals.engaged : 0,
  };
}

interface CSTeamBundle {
  leaderboard: CSLeaderboardEntry[];
}

const salesTeamSource: CompareSource<CSTeamBundle> = {
  key: 'sales-team',
  label: 'CS team analysis',
  backTo: '/admin/sales/team',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'], permission: 'cs.teamOverview' },
  fetchPeriod: (period, cookie) =>
    fetchDated<CSTeamBundle>('orders.csTeamPageBundle', period, cookie),
  metrics: [
    { key: 'engaged', label: 'Orders engaged', kind: 'count', funnel: true, value: (d) => reduceCSLeaderboard(d.leaderboard ?? []).engaged },
    { key: 'confirmed', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => reduceCSLeaderboard(d.leaderboard ?? []).confirmed },
    { key: 'delivered', label: 'Delivered', kind: 'count', funnel: true, value: (d) => reduceCSLeaderboard(d.leaderboard ?? []).delivered },
    { key: 'callsMade', label: 'Calls made', kind: 'count', value: (d) => reduceCSLeaderboard(d.leaderboard ?? []).calls },
    { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => reduceCSLeaderboard(d.leaderboard ?? []).confirmationRate },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => reduceCSLeaderboard(d.leaderboard ?? []).deliveryRate },
    { key: 'closers', label: 'Active closers', kind: 'count', value: (d) => (d.leaderboard ?? []).length },
  ],
};

const salesLeaderboardSource: CompareSource<CSLeaderboardEntry[]> = {
  key: 'sales-leaderboard',
  label: 'CS leaderboard',
  backTo: '/admin/sales/leaderboard',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'], permission: 'orders.csLeaderboard' },
  fetchPeriod: (period, cookie) =>
    fetchDated<CSLeaderboardEntry[]>('orders.csLeaderboard', period, cookie),
  metrics: [
    { key: 'engaged', label: 'Orders engaged', kind: 'count', funnel: true, value: (d) => reduceCSLeaderboard(d ?? []).engaged },
    { key: 'confirmed', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => reduceCSLeaderboard(d ?? []).confirmed },
    { key: 'delivered', label: 'Delivered', kind: 'count', funnel: true, value: (d) => reduceCSLeaderboard(d ?? []).delivered },
    { key: 'callsMade', label: 'Calls made', kind: 'count', value: (d) => reduceCSLeaderboard(d ?? []).calls },
    { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => reduceCSLeaderboard(d ?? []).confirmationRate },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => reduceCSLeaderboard(d ?? []).deliveryRate },
    { key: 'closers', label: 'Closers', kind: 'count', value: (d) => (d ?? []).length },
  ],
};

// ── Logistics: team ──────────────────────────────────────────────────────────

/** One row of `logistics.teamOverview` (LogisticsProviderRow). */
interface LogisticsProviderRow {
  status: string;
  totalAssigned: number;
  delivered: number;
  unitsDelivered: number;
  locationCount: number;
  remittedAmount: string;
  pendingRemittanceAmount: string;
  owingAmount: string;
}

function reduceLogisticsProviders(rows: LogisticsProviderRow[]) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.assigned += num(r.totalAssigned);
      acc.delivered += num(r.delivered);
      acc.units += num(r.unitsDelivered);
      acc.locations += num(r.locationCount);
      acc.remitted += num(r.remittedAmount);
      acc.pending += num(r.pendingRemittanceAmount);
      acc.owing += num(r.owingAmount);
      if (r.status === 'ACTIVE') acc.active += 1;
      return acc;
    },
    { assigned: 0, delivered: 0, units: 0, locations: 0, remitted: 0, pending: 0, owing: 0, active: 0 },
  );
  return {
    ...totals,
    providers: rows.length,
    deliveryRate: totals.assigned > 0 ? totals.delivered / totals.assigned : 0,
  };
}

const logisticsTeamSource: CompareSource<LogisticsProviderRow[]> = {
  key: 'logistics-team',
  label: 'Logistics team',
  backTo: '/admin/logistics/team',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS', 'STOCK_MANAGER'], permission: 'logistics.teamOverview' },
  fetchPeriod: (period, cookie) =>
    fetchDated<LogisticsProviderRow[]>('logistics.teamOverview', period, cookie),
  metrics: [
    { key: 'assigned', label: 'Total assigned', kind: 'count', funnel: true, value: (d) => reduceLogisticsProviders(d ?? []).assigned },
    { key: 'delivered', label: 'Delivered', kind: 'count', funnel: true, value: (d) => reduceLogisticsProviders(d ?? []).delivered },
    { key: 'unitsDelivered', label: 'Units delivered', kind: 'count', value: (d) => reduceLogisticsProviders(d ?? []).units },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => reduceLogisticsProviders(d ?? []).deliveryRate },
    { key: 'remitted', label: 'Remitted amount', kind: 'count', value: (d) => reduceLogisticsProviders(d ?? []).remitted },
    { key: 'pending', label: 'Pending remittance', kind: 'count', value: (d) => reduceLogisticsProviders(d ?? []).pending },
    { key: 'activeProviders', label: 'Active providers', kind: 'count', value: (d) => reduceLogisticsProviders(d ?? []).active },
  ],
};

// ── Finance: overview / delivery-remittances / disbursements ──────────────────

/** Shared remittance summary shape (numeric-strings). Nullable on the wire. */
interface RemittanceSummary {
  pendingAmount?: string;
  pendingCount?: string;
  totalRemitted?: string;
  receivedAmount?: string;
  receivedOrderCount?: string;
  totalDeliveryFees?: string;
  deliveryFeeCount?: string;
  deliveredNetAmount?: string;
  deliveredCount?: string;
  awaitingPeriodAmount?: string;
  awaitingPeriodCount?: string;
}

interface FundingSummary {
  totalSent?: string;
  sentCount?: number;
  totalCompleted?: string;
  completedCount?: number;
  totalDisputed?: string;
  disputedCount?: number;
}

interface FinanceOverviewBundle {
  remittanceSummary?: RemittanceSummary | null;
  fundingSummary?: FundingSummary | null;
}

const financeOverviewSource: CompareSource<FinanceOverviewBundle> = {
  key: 'finance-overview',
  label: 'Finance overview',
  backTo: '/admin/finance/overview',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER', 'ACCOUNTANT', 'AUDITOR'], permission: 'finance.read' },
  fetchPeriod: (period, cookie) =>
    fetchDated<FinanceOverviewBundle>('finance.overviewPageBundle', period, cookie),
  metrics: [
    { key: 'totalRemitted', label: 'Total remitted', kind: 'count', funnel: true, value: (d) => num(d.remittanceSummary?.totalRemitted ?? d.remittanceSummary?.receivedAmount) },
    { key: 'pendingRemittance', label: 'Pending remittance', kind: 'count', funnel: true, value: (d) => num(d.remittanceSummary?.pendingAmount) },
    { key: 'deliveryFees', label: 'Delivery fees', kind: 'count', value: (d) => num(d.remittanceSummary?.totalDeliveryFees) },
    { key: 'fundingSent', label: 'Funding sent', kind: 'count', value: (d) => num(d.fundingSummary?.totalSent) },
    { key: 'fundingCompleted', label: 'Funding completed', kind: 'count', value: (d) => num(d.fundingSummary?.totalCompleted) },
    { key: 'fundingDisputed', label: 'Funding disputed', kind: 'count', value: (d) => num(d.fundingSummary?.totalDisputed) },
    { key: 'remittedCount', label: 'Remitted orders', kind: 'count', value: (d) => num(d.remittanceSummary?.receivedOrderCount) },
    { key: 'pendingCount', label: 'Pending orders', kind: 'count', value: (d) => num(d.remittanceSummary?.pendingCount) },
  ],
};

interface DeliveryRemittancesBundle {
  remittances: { summary?: RemittanceSummary | null };
}

const deliveryRemittancesSource: CompareSource<DeliveryRemittancesBundle> = {
  key: 'delivery-remittances',
  label: 'Delivery remittances',
  backTo: '/admin/finance/delivery-remittances',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'], permission: 'finance.read' },
  fetchPeriod: (period, cookie) =>
    fetchDated<DeliveryRemittancesBundle>('logistics.deliveryRemittancesPageBundle', period, cookie, { page: 1, limit: 1, summaryOnly: true }),
  metrics: [
    { key: 'received', label: 'Remitted received', kind: 'count', funnel: true, value: (d) => num(d.remittances?.summary?.receivedAmount ?? d.remittances?.summary?.totalRemitted) },
    { key: 'pending', label: 'Pending confirmation', kind: 'count', funnel: true, value: (d) => num(d.remittances?.summary?.pendingAmount) },
    { key: 'delivered', label: 'Delivered value', kind: 'count', value: (d) => num(d.remittances?.summary?.deliveredNetAmount) },
    { key: 'deliveryFees', label: 'Delivery fees', kind: 'count', value: (d) => num(d.remittances?.summary?.totalDeliveryFees) },
    { key: 'receivedCount', label: 'Remitted orders', kind: 'count', value: (d) => num(d.remittances?.summary?.receivedOrderCount) },
    { key: 'deliveredCount', label: 'Delivered orders', kind: 'count', value: (d) => num(d.remittances?.summary?.deliveredCount) },
    { key: 'awaiting', label: 'Awaiting (period)', kind: 'count', value: (d) => num(d.remittances?.summary?.awaitingPeriodAmount) },
  ],
};

interface DisbursementsBundle {
  summary?: FundingSummary | null;
}

const disbursementsSource: CompareSource<DisbursementsBundle> = {
  key: 'disbursements',
  label: 'Disbursements',
  backTo: '/admin/finance/disbursements',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER', 'ACCOUNTANT'], permission: 'finance.disburse' },
  fetchPeriod: (period, cookie) =>
    fetchDated<DisbursementsBundle>('marketing.disbursementsPageBundle', period, cookie),
  metrics: [
    { key: 'totalSent', label: 'Total sent', kind: 'count', funnel: true, value: (d) => num(d.summary?.totalSent) },
    { key: 'totalCompleted', label: 'Completed', kind: 'count', funnel: true, value: (d) => num(d.summary?.totalCompleted) },
    { key: 'totalDisputed', label: 'Disputed', kind: 'count', value: (d) => num(d.summary?.totalDisputed) },
    { key: 'sentCount', label: 'Sent count', kind: 'count', value: (d) => num(d.summary?.sentCount) },
    { key: 'completedCount', label: 'Completed count', kind: 'count', value: (d) => num(d.summary?.completedCount) },
    { key: 'disputedCount', label: 'Disputed count', kind: 'count', value: (d) => num(d.summary?.disputedCount) },
  ],
};

// ── Sales: cart-orders / delivered-follow-up (status-count sources) ───────────

const cartOrdersSource: CompareSource<StatusCounts> = {
  key: 'cart-orders',
  label: 'Cart orders',
  backTo: '/admin/sales/cart-orders',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_CLOSER'], permission: ['orders.read', 'marketing.orders'] },
  fetchPeriod: (period, cookie) =>
    fetchDated<StatusCounts>('cartOrders.getStatusCounts', period, cookie),
  metrics: [
    { key: 'total', label: 'Total cart orders', kind: 'count', funnel: true, value: totalExclDeleted },
    { key: 'confirmed', label: 'Confirmed', kind: 'count', funnel: true, value: confirmedPlus },
    { key: 'delivered', label: 'Delivered', kind: 'count', funnel: true, value: deliveredPlus },
    { key: 'remitted', label: 'Remitted', kind: 'count', funnel: true, value: (d) => n(d, 'REMITTED') },
    { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => { const t = totalExclDeleted(d); return t > 0 ? confirmedPlus(d) / t : 0; } },
    { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => { const t = totalExclDeleted(d); return t > 0 ? deliveredPlus(d) / t : 0; } },
  ],
};

interface CsOrdersBundle {
  statusCounts: StatusCounts;
}

const deliveredFollowUpSource: CompareSource<CsOrdersBundle> = {
  key: 'delivered-follow-up',
  label: 'Delivered follow-up',
  backTo: '/admin/sales/delivered-follow-up',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_CLOSER'], permission: 'orders.read' },
  fetchPeriod: (period, cookie) =>
    fetchDated<CsOrdersBundle>('orders.csOrdersPageBundle', period, cookie, {
      orderSource: 'delivered_follow_up',
      countsStartDate: period.startDate,
      countsEndDate: period.endDate,
      heatYearMonth: period.startDate.slice(0, 7),
    }),
  metrics: [
    { key: 'total', label: 'Total orders', kind: 'count', funnel: true, value: (d) => totalExclDeleted(d.statusCounts) },
    { key: 'confirmed', label: 'Confirmed', kind: 'count', funnel: true, value: (d) => confirmedPlus(d.statusCounts) },
    { key: 'delivered', label: 'Delivered', kind: 'count', funnel: true, value: (d) => deliveredPlus(d.statusCounts) },
    { key: 'remitted', label: 'Remitted', kind: 'count', funnel: true, value: (d) => n(d.statusCounts, 'REMITTED') },
  ],
};

// ── Executive dashboards: CEO overview + SuperAdmin overview ──────────────────

interface CeoOverview {
  overview: {
    revenue: number;
    trueProfit: number;
    margin: number; // 0-100
    costBreakdown: { adSpend: number; landedCost: number; deliveryFee: number };
    orderPipeline: { total: number };
    marketing: {
      cpa: number;
      deliveryRate: number; // 0-100
      confirmationRate: number; // 0-100
      totalOrders: number;
      roas: number; // ratio
      approvedSpend: number;
    };
    activeStaffCount: number;
  };
}

/** Metric rows shared by the CEO + SuperAdmin overview sources. */
const CEO_OVERVIEW_METRICS: CompareMetricDef<CeoOverview>[] = [
  { key: 'revenue', label: 'Revenue', kind: 'count', funnel: true, value: (d) => num(d.overview.revenue) },
  { key: 'trueProfit', label: 'True profit', kind: 'count', funnel: true, value: (d) => num(d.overview.trueProfit) },
  { key: 'margin', label: 'Margin', kind: 'percent', value: (d) => num(d.overview.margin) / 100 },
  { key: 'totalOrders', label: 'Total orders', kind: 'count', funnel: true, value: (d) => num(d.overview.orderPipeline.total) },
  { key: 'adSpend', label: 'Ad spend', kind: 'count', value: (d) => num(d.overview.costBreakdown.adSpend) },
  { key: 'landedCost', label: 'Landed cost', kind: 'count', value: (d) => num(d.overview.costBreakdown.landedCost) },
  { key: 'deliveryFee', label: 'Delivery fees', kind: 'count', value: (d) => num(d.overview.costBreakdown.deliveryFee) },
  { key: 'cpa', label: 'CPA', kind: 'count', value: (d) => num(d.overview.marketing.cpa) },
  { key: 'roas', label: 'True ROAS', kind: 'count', value: (d) => num(d.overview.marketing.roas) },
  { key: 'confirmationRate', label: 'Confirmation rate', kind: 'percent', value: (d) => num(d.overview.marketing.confirmationRate) / 100 },
  { key: 'deliveryRate', label: 'Delivery rate', kind: 'percent', value: (d) => num(d.overview.marketing.deliveryRate) / 100 },
  { key: 'activeStaff', label: 'Active staff', kind: 'count', value: (d) => num(d.overview.activeStaffCount) },
];

const ceoOverviewSource: CompareSource<CeoOverview> = {
  key: 'ceo-overview',
  label: 'Executive overview',
  backTo: '/admin/ceo',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'], permission: 'ceo.overview' },
  fetchPeriod: (period, cookie) =>
    fetchDated<CeoOverview>('dashboard.ceoOverviewBundle', period, cookie),
  metrics: CEO_OVERVIEW_METRICS,
};

const adminOverviewSource: CompareSource<CeoOverview> = {
  key: 'admin-overview',
  label: 'Dashboard overview',
  backTo: '/admin',
  guard: { roles: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'], permission: 'ceo.overview' },
  fetchPeriod: (period, cookie) =>
    fetchDated<CeoOverview>('dashboard.ceoOverview', period, cookie),
  metrics: CEO_OVERVIEW_METRICS,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SOURCES: Record<string, CompareSource<any>> = {
  [marketingAnalyticsSource.key]: marketingAnalyticsSource,
  [marketingOrdersSource.key]: marketingOrdersSource,
  [marketingOverviewSource.key]: marketingOverviewSource,
  [marketingTeamSource.key]: marketingTeamSource,
  [marketingCrossFunnelSource.key]: marketingCrossFunnelSource,
  [marketingExpensesSource.key]: marketingExpensesSource,
  [marketingLeaderboardSource.key]: marketingLeaderboardSource,
  [salesOrdersSource.key]: salesOrdersSource,
  [salesTeamSource.key]: salesTeamSource,
  [salesLeaderboardSource.key]: salesLeaderboardSource,
  [logisticsOrdersSource.key]: logisticsOrdersSource,
  [logisticsTeamSource.key]: logisticsTeamSource,
  [financeOverviewSource.key]: financeOverviewSource,
  [deliveryRemittancesSource.key]: deliveryRemittancesSource,
  [disbursementsSource.key]: disbursementsSource,
  [cartOrdersSource.key]: cartOrdersSource,
  [deliveredFollowUpSource.key]: deliveredFollowUpSource,
  [ceoOverviewSource.key]: ceoOverviewSource,
  [adminOverviewSource.key]: adminOverviewSource,
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
  timeWindow?: { from?: string; to?: string },
): ComparePeriod | null {
  // Optional HH:MM time window (both ends, from < to). When present, we emit
  // start/end as WAT (+01:00) datetimes so the backend's nigeriaDayStart/End pass
  // them through verbatim (they honor any 'T'-bearing string). Blank = full day.
  const from = timeWindow?.from ?? '';
  const to = timeWindow?.to ?? '';
  const validTime = /^\d{2}:\d{2}$/.test(from) && /^\d{2}:\d{2}$/.test(to) && from < to;
  const timeLabel = validTime ? ` ${from}–${to}` : '';

  if (granularity === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return null;
    const d = new Date(`${token}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    const label = `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}${timeLabel}`;
    if (validTime) {
      return { startDate: `${token}T${from}:00+01:00`, endDate: `${token}T${to}:00+01:00`, label };
    }
    return { startDate: token, endDate: token, label };
  }
  // month
  if (!/^\d{4}-\d{2}$/.test(token)) return null;
  const [yStr, mStr] = token.split('-');
  const year = Number(yStr);
  const month = Number(mStr); // 1-12
  if (!year || month < 1 || month > 12) return null;
  const firstDay = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDate = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  const label = `${MONTH_NAMES[month - 1]} ${year}${timeLabel}`;
  if (validTime) {
    // Time window on a month = that time on the 1st day … that time on the last day.
    return { startDate: `${firstDay}T${from}:00+01:00`, endDate: `${lastDate}T${to}:00+01:00`, label };
  }
  return { startDate: firstDay, endDate: lastDate, label };
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
