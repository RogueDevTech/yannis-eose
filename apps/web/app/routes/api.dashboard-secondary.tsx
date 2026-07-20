import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  getCurrentUser,
} from '~/lib/api.server';
import { extractTrpc } from '~/lib/trpc-extract.server';
import { isAdminLevel } from '~/lib/rbac';
import type { DashboardData } from '~/features/dashboard/types';

const ROLES_NEED_METRICS = ['HEAD_OF_CS', 'CS_CLOSER', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'] as const;

const defaultMetrics: DashboardData['metrics'] = {
  totalSpend: 0,
  totalOrders: 0,
  deliveredOrders: 0,
  deliveredRevenue: 0,
  confirmedOrders: 0,
  confirmationRate: 0,
  cpa: 0,
  trueRoas: 0,
  deliveryRate: 0,
};
const defaultProfit: DashboardData['profit'] = {
  revenue: 0,
  landedCost: 0,
  deliveryFee: 0,
  adSpend: 0,
  commission: 0,
  fulfillmentCost: 0,
  operationalLoss: 0,
  trueProfit: 0,
  orderCount: 0,
  margin: 0,
};

export type DashboardSecondaryApiPayload = {
  metrics: DashboardData['metrics'];
  /** Supervisor's personal-only metrics (own funnel, no team expansion). Undefined for non-supervisors. */
  personalMetrics?: DashboardData['metrics'];
  profit: DashboardData['profit'];
  totalUsers: number;
  totalProducts: number;
  payoutSummary: DashboardData['payoutSummary'];
  abandonedCartCount: number;
  /** Follow-up order per-status counts for dashboard stat strip. */
  followUpCounts?: Record<string, number>;
  /** Cart order per-status counts for dashboard stat strip. */
  cartOrdersCounts?: Record<string, number>;
  /** Delivered follow-up order per-status counts for dashboard stat strip. */
  deliveredFollowUpCounts?: Record<string, number>;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false as const, error: 'Not authenticated', ...emptyPayload() });
  }

  const cookie = getSessionCookie(request);
  const role = user.role;
  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('periodAllTime') === 'true' || url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const assignedCsParam = role === 'CS_CLOSER' ? { assignedCsId: user.id } : {};
  const isActualMbSupervisor =
    role !== 'HEAD_OF_MARKETING' &&
    (user as { isMarketingTeamSupervisorOnActiveBranch?: boolean }).isMarketingTeamSupervisorOnActiveBranch === true;
  const isSupervisor =
    role === 'HEAD_OF_MARKETING' || isActualMbSupervisor;
  // Team metrics: supervisors/HoM should NOT pass mediaBuyerId — the backend
  // applies supervisor scope to aggregate the whole team. Regular MBs self-scope.
  const mediaBuyerIdParam =
    role === 'MEDIA_BUYER' && !isActualMbSupervisor ? { mediaBuyerId: user.id } : {};
  const metricsInput = JSON.stringify({ startDate, endDate, ...mediaBuyerIdParam, ...assignedCsParam });
  // Personal metrics: the user's own funnel (scoped to own mediaBuyerId).
  // Both MB-supervisors and HoM can run ads — "My Performance" shows their own orders.
  const personalMetricsInput = isSupervisor
    ? JSON.stringify({ startDate, endDate, mediaBuyerId: user.id, personalOnly: true })
    : null;
  const profitInput = JSON.stringify({ groupBy: 'product', startDate, endDate });

  const needsMetrics =
    isAdminLevel({ role }) || (ROLES_NEED_METRICS as readonly string[]).includes(role);
  const needsProfit = isAdminLevel({ role }) || role === 'FINANCE_OFFICER';
  const needsUsers = isAdminLevel({ role }) || role === 'HR_MANAGER';
  const needsProducts = isAdminLevel({ role }) || role === 'STOCK_MANAGER';
  const needsPayout = isAdminLevel({ role }) || role === 'HR_MANAGER';
  const needsCartAbandoned =
    isAdminLevel({ role }) || role === 'HEAD_OF_MARKETING' || role === 'MEDIA_BUYER' || isSupervisor;
  const needsFollowUp =
    isAdminLevel({ role }) || role === 'HEAD_OF_CS' || role === 'CS_CLOSER';
  const needsCartOrders = needsFollowUp;

  try {
    const metricsP = needsMetrics
      ? apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(metricsInput)}`, deferredOpt)
      : Promise.resolve({ ok: true, data: { result: { data: defaultMetrics } } });
    // Supervisor personal metrics — their own funnel only (no team expansion)
    const personalMetricsP = personalMetricsInput
      ? apiRequest<unknown>(`/trpc/marketing.metrics?input=${encodeURIComponent(personalMetricsInput)}`, deferredOpt)
          .then((r) => extractTrpc(r, defaultMetrics)).catch(() => defaultMetrics)
      : Promise.resolve(null);
    const profitP = needsProfit
      ? apiRequest<unknown>(`/trpc/finance.profitReport?input=${encodeURIComponent(profitInput)}`, deferredOpt)
      : Promise.resolve({ ok: true, data: { result: { data: defaultProfit } } });
    const usersP = needsUsers
      ? apiRequest<unknown>('/trpc/users.list?input=%7B%22limit%22%3A1%7D', deferredOpt)
      : Promise.resolve({ ok: false, data: {} });
    const productsP = needsProducts
      ? apiRequest<unknown>('/trpc/products.list?input=%7B%22limit%22%3A1%7D', deferredOpt)
      : Promise.resolve({ ok: false, data: {} });
    const payoutP = needsPayout
      ? apiRequest<unknown>('/trpc/hr.payoutSummary', deferredOpt)
      : Promise.resolve({ ok: false, data: {} });
    const cartAbandonedInput = JSON.stringify({ startDate, endDate });
    const cartAbandonedP = needsCartAbandoned
      ? apiRequest<unknown>(`/trpc/cart.countAllAbandoned?input=${encodeURIComponent(cartAbandonedInput)}`, deferredOpt)
      : Promise.resolve({ ok: false, data: {} });
    const followUpInput = JSON.stringify({ startDate, endDate });
    const followUpP = needsFollowUp
      ? apiRequest<unknown>(`/trpc/orders.followUpDashboardCounts?input=${encodeURIComponent(followUpInput)}`, deferredOpt)
      : Promise.resolve(null);
    const cartOrdersInput = JSON.stringify({ startDate, endDate });
    const cartOrdersP = needsCartOrders
      ? apiRequest<unknown>(`/trpc/cartOrders.dashboardCounts?input=${encodeURIComponent(cartOrdersInput)}`, deferredOpt)
      : Promise.resolve(null);
    const dfuInput = JSON.stringify({ startDate, endDate, orderSource: 'delivered_follow_up', excludeGraduated: false });
    const dfuP = needsFollowUp
      ? apiRequest<unknown>(`/trpc/orders.statusCounts?input=${encodeURIComponent(dfuInput)}`, deferredOpt)
      : Promise.resolve(null);

    const [metrics, personalMetrics, profit, totalUsers, totalProducts, payoutSummary, abandonedCartCount, followUpCounts, cartOrdersCounts, deliveredFollowUpCounts] = await Promise.all([
      metricsP.then((r) => extractTrpc(r, defaultMetrics)).catch(() => defaultMetrics),
      personalMetricsP,
      profitP.then((r) => extractTrpc(r, defaultProfit)).catch(() => defaultProfit),
      usersP
        .then((r) => {
          const d = r.ok ? (r.data as { result?: { data?: { pagination: { total: number } } } })?.result?.data : null;
          return d?.pagination?.total ?? 0;
        })
        .catch(() => 0),
      productsP
        .then((r) => {
          const d = r.ok ? (r.data as { result?: { data?: { pagination: { total: number } } } })?.result?.data : null;
          return d?.pagination?.total ?? 0;
        })
        .catch(() => 0),
      payoutP
        .then((r) =>
          r.ok ? (r.data as { result?: { data?: DashboardData['payoutSummary'] } })?.result?.data ?? {} : {},
        )
        .catch(() => ({})),
      cartAbandonedP
        .then((r) => {
          const d = r.ok ? (r.data as { result?: { data?: { count: number } } })?.result?.data : null;
          return d?.count ?? 0;
        })
        .catch(() => 0),
      followUpP
        ?.then((r) => {
          if (!r) return undefined;
          const d = r.ok ? (r.data as { result?: { data?: Record<string, number> } })?.result?.data : null;
          return d ?? undefined;
        })
        .catch(() => undefined) ?? Promise.resolve(undefined),
      cartOrdersP
        ?.then((r) => {
          if (!r) return undefined;
          const d = r.ok ? (r.data as { result?: { data?: Record<string, number> } })?.result?.data : null;
          return d ?? undefined;
        })
        .catch(() => undefined) ?? Promise.resolve(undefined),
      dfuP
        ?.then((r) => {
          if (!r) return undefined;
          const d = r.ok ? (r.data as { result?: { data?: Record<string, number> } })?.result?.data : null;
          return d ?? undefined;
        })
        .catch(() => undefined) ?? Promise.resolve(undefined),
    ]);

    return secondaryCacheJson({
      ok: true as const,
      metrics,
      personalMetrics: personalMetrics ?? undefined,
      profit,
      totalUsers,
      totalProducts,
      payoutSummary,
      abandonedCartCount,
      followUpCounts,
      cartOrdersCounts,
      deliveredFollowUpCounts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Dashboard secondary load failed';
    return json({ ok: false as const, error: msg, ...emptyPayload() });
  }
}

function emptyPayload(): DashboardSecondaryApiPayload {
  return {
    metrics: defaultMetrics,
    profit: defaultProfit,
    totalUsers: 0,
    totalProducts: 0,
    payoutSummary: {},
    abandonedCartCount: 0,
    cartOrdersCounts: undefined,
  };
}
