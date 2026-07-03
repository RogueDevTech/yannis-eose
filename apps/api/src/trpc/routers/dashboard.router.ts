import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import type { OrdersService } from '../../orders/orders.service';
import type { FinanceService } from '../../finance/finance.service';
import type { MarketingService } from '../../marketing/marketing.service';
import type { HrService } from '../../hr/hr.service';
import type { InventoryService } from '../../inventory/inventory.service';
import { CacheService } from '../../common/cache/cache.service';
import { nigeriaToday, nigeriaDayStart, nigeriaDayEnd } from '../../common/utils/date-range';
import { getFollowUpConfigService } from './orders.router';
import { getCartOrdersService } from './cart-orders.router';
import { getCartService } from './cart.router';

// Factory pattern: services injected from NestJS module
let ordersService: OrdersService | null = null;
let financeService: FinanceService | null = null;
let marketingService: MarketingService | null = null;
let hrService: HrService | null = null;
let inventoryService: InventoryService | null = null;
let cacheService: CacheService | null = null;

export function setDashboardServices(services: {
  orders: OrdersService;
  finance: FinanceService;
  marketing: MarketingService;
  hr: HrService;
  inventory: InventoryService;
}) {
  ordersService = services.orders;
  financeService = services.finance;
  marketingService = services.marketing;
  hrService = services.hr;
  inventoryService = services.inventory;
}

export function setCacheService(service: CacheService) {
  cacheService = service;
}

async function _ceoOverviewFetch(params: {
  startDate: string | undefined;
  endDate: string | undefined;
  branchId: string | null | undefined;
  effectiveBranchIds: string[] | null;
  activeGroupId: string | null;
}) {
  const { startDate, endDate, branchId, effectiveBranchIds, activeGroupId } = params;

  const logErr = (label: string) => (err: unknown) => {
    console.error(`[ceoOverview] ${label} failed:`, err instanceof Error ? err.message : err);
    return undefined;
  };

  // Materialized views are refreshed ONLY when the user explicitly clicks the Refresh
  // button on the page (`dashboard.refreshExecutiveData`). The page read here always uses
  // whatever snapshot is currently in the MVs — fast and deterministic. Numbers stay fixed
  // until the user asks for fresh data.

  const hasDateRange = Boolean(startDate && endDate);
  // When a branch subset is active, skip materialized views (they're global)
  // and use live queries so the numbers respect the branch scope.
  const isBranchScoped = Boolean(branchId || effectiveBranchIds?.length);
  const [
    fastProfitResult,
    statusCountsWhenDated,
    csStatusCountsResult,
    supplementaryCounts,
    invoiceSummary,
    marketingMetrics,
    payoutSummary,
    csWorkloads,
    revenueByPeriod,
    deliveriesByProduct,
    stockPerProduct,
    activeStaffCount,
  ] = await Promise.all([
    isBranchScoped
      ? Promise.resolve(null)
      : financeService!.getFastProfitReport(startDate, endDate).catch(() => null),
    (hasDateRange || isBranchScoped)
      ? ordersService!.getStatusCounts(undefined, startDate, endDate, undefined, undefined, branchId, undefined, undefined, 'marketing', effectiveBranchIds, false, true, true).catch(logErr('statusCounts'))
      : Promise.resolve(undefined),
    // CS funnel: servicing branch scope, includes offline orders, excludes
    // graduated follow-up and cart orders (they have their own funnels).
    ordersService!.getStatusCounts(undefined, startDate, endDate, undefined, undefined, branchId, undefined, undefined, 'servicing', effectiveBranchIds, false, false, true, true).catch(logErr('csStatusCounts')),
    ordersService!.getSupplementaryCounts(undefined, startDate, endDate, undefined, branchId, undefined, 'servicing', effectiveBranchIds).catch(() => ({ offlineCount: 0, duplicateCount: 0 })),
    financeService!.getInvoiceSummary(effectiveBranchIds, { startDate, endDate }).catch(logErr('invoiceSummary')),
    marketingService!.getPerformanceMetrics(undefined, hasDateRange ? 'this_month' : 'all_time', startDate, endDate, branchId, undefined, undefined, effectiveBranchIds).catch(logErr('marketingMetrics')),
    hrService!.getPayoutSummary(effectiveBranchIds, { startDate, endDate }).catch(logErr('payoutSummary')),
    ordersService!.getCSCloserWorkloads(branchId, effectiveBranchIds).catch(logErr('csWorkloads')),
    ordersService!.getRevenueByPeriod(branchId, effectiveBranchIds).catch(logErr('revenueByPeriod')),
    ordersService!.getDeliveriesByProduct(branchId, effectiveBranchIds).catch(logErr('deliveriesByProduct')),
    inventoryService!.getStockPerProduct(activeGroupId).catch(logErr('stockPerProduct')),
    hrService!.countActiveStaff(effectiveBranchIds).catch(logErr('activeStaffCount')),
  ]);

  let profitReport: {
    revenue: number;
    landedCost: number;
    deliveryFee: number;
    adSpend: number;
    commission: number;
    fulfillmentCost: number;
    operationalLoss: number;
    trueProfit: number;
    orderCount: number;
    margin: number;
  };
  if (fastProfitResult) {
    profitReport = {
      revenue: fastProfitResult.revenue,
      landedCost: fastProfitResult.landedCost,
      deliveryFee: fastProfitResult.deliveryFee,
      adSpend: fastProfitResult.adSpend,
      commission: fastProfitResult.commission,
      fulfillmentCost: fastProfitResult.fulfillmentCost ?? 0,
      operationalLoss: fastProfitResult.operationalLoss ?? 0,
      trueProfit: fastProfitResult.trueProfit,
      orderCount: fastProfitResult.orderCount,
      margin: fastProfitResult.margin,
    };
  } else {
    const fullReport = await financeService!.getProfitReport({ groupBy: 'product', startDate, endDate, branchId }, effectiveBranchIds).catch(logErr('profitReport'));
    profitReport = fullReport ?? {
      revenue: 0, landedCost: 0, deliveryFee: 0, adSpend: 0,
      commission: 0, fulfillmentCost: 0, operationalLoss: 0,
      trueProfit: 0, orderCount: 0, margin: 0,
    };
  }

  // Status counts: always use live query with excludeOffline=true so the
  // Marketing Order Funnel matches the Marketing Orders page exactly.
  // The MV fast path (mv_order_pipeline) includes offline orders and cannot
  // be used here without a migration to add an order_source filter.
  let statusCounts: Record<string, number>;
  if (hasDateRange || isBranchScoped) {
    statusCounts = (statusCountsWhenDated ?? {}) as Record<string, number>;
  } else {
    const allTimeCounts = await ordersService!.getStatusCounts(undefined, undefined, undefined, undefined, undefined, branchId, undefined, undefined, 'marketing', effectiveBranchIds, false, true, true).catch(logErr('statusCounts'));
    statusCounts = (allTimeCounts ?? {}) as Record<string, number>;
  }

  const safeMarketingMetrics = marketingMetrics ?? {
    totalSpend: 0, approvedSpend: 0, pendingSpend: 0, totalOrders: 0,
    deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0,
    confirmationRate: 0, cpa: 0, trueRoas: 0, deliveryRate: 0,
  };
  const safePayoutSummary = payoutSummary ?? { totalPaid: 0, totalPending: 0, staffCount: 0 };
  const safeCSWorkloads = csWorkloads ?? [];

  // DELETED + legacy CANCELLED orders are editorial removals (test/fake/mistake),
  // never business volume — they must not appear in the dashboard's totalOrders.
  // CEO directive 2026-05-23: CANCELLED is legacy-only, merged into DELETED.
  const totalOrders = Object.entries(statusCounts).reduce(
    (sum, [status, count]) => (status === 'DELETED' || status === 'CANCELLED' ? sum : sum + (count ?? 0)),
    0,
  );

  const activeOrders =
    (statusCounts['UNPROCESSED'] ?? 0) +
    (statusCounts['CS_ASSIGNED'] ?? 0) +
    (statusCounts['CS_ENGAGED'] ?? 0) +
    (statusCounts['CONFIRMED'] ?? 0) +
    (statusCounts['AGENT_ASSIGNED'] ?? 0) +
    (statusCounts['DISPATCHED'] ?? 0) +
    (statusCounts['IN_TRANSIT'] ?? 0);

  const deliveredOrders = (statusCounts['DELIVERED'] ?? 0) + (statusCounts['REMITTED'] ?? 0);
  const deletedOrders = statusCounts['DELETED'] ?? 0;
  const returnedOrders = statusCounts['RETURNED'] ?? 0;

  const totalCSClosers = safeCSWorkloads.length;
  const totalCSPending = safeCSWorkloads.reduce(
    (sum: number, w: { pendingCount: number }) => sum + w.pendingCount,
    0,
  );
  /** Average progress toward per-agent daily duty target (CS stage closes today ÷ capacity). */
  const csDailyDutyProgress =
    safeCSWorkloads.length > 0
      ? safeCSWorkloads.reduce(
          (sum: number, w: { todayClosesCount?: number; capacity: number }) =>
            sum + (w.todayClosesCount ?? 0) / Math.max(w.capacity, 1),
          0,
        ) / safeCSWorkloads.length
      : 0;

  return {
    revenue: profitReport.revenue ?? 0,
    trueProfit: profitReport.trueProfit ?? 0,
    margin: profitReport.margin ?? 0,
    costBreakdown: {
      landedCost: profitReport.landedCost ?? 0,
      deliveryFee: profitReport.deliveryFee ?? 0,
      adSpend: profitReport.adSpend ?? 0,
      commission: profitReport.commission ?? 0,
      fulfillmentCost: profitReport.fulfillmentCost ?? 0,
      operationalLoss: profitReport.operationalLoss ?? 0,
    },
    orderPipeline: {
      total: totalOrders,
      active: activeOrders,
      delivered: deliveredOrders,
      deleted: deletedOrders,
      returned: returnedOrders,
      statusCounts,
      offlineCount: supplementaryCounts.offlineCount,
      // CS funnel: includes offline orders, scoped by servicing branch
      csStatusCounts: (csStatusCountsResult ?? {}) as Record<string, number>,
    },
    marketing: {
      totalSpend: safeMarketingMetrics.totalSpend ?? 0,
      approvedSpend: safeMarketingMetrics.approvedSpend ?? 0,
      deliveredRevenue: safeMarketingMetrics.deliveredRevenue ?? 0,
      totalOrders: safeMarketingMetrics.totalOrders ?? 0,
      confirmedOrders: safeMarketingMetrics.confirmedOrders ?? 0,
      deliveredOrders: safeMarketingMetrics.deliveredOrders ?? 0,
      cpa: safeMarketingMetrics.cpa ?? 0,
      roas: safeMarketingMetrics.trueRoas ?? 0,
      confirmationRate: safeMarketingMetrics.confirmationRate ?? 0,
      deliveryRate: safeMarketingMetrics.deliveryRate ?? 0,
    },
    csTeam: {
      agentCount: totalCSClosers,
      pendingOrders: totalCSPending,
      utilization: Math.round(csDailyDutyProgress * 100),
    },
    payroll: {
      totalPaid: safePayoutSummary.totalPaid ?? 0,
      totalPending: safePayoutSummary.totalPending ?? 0,
      staffCount: safePayoutSummary.staffCount ?? 0,
    },
    invoiceSummary: invoiceSummary ?? {},
    // CEO-requested widgets (2026-05-18)
    revenueByPeriod: revenueByPeriod ?? { today: 0, thisWeek: 0, thisMonth: 0 },
    deliveriesByProduct: deliveriesByProduct ?? [],
    stockPerProduct: stockPerProduct ?? [],
    activeStaffCount: (activeStaffCount as number | undefined) ?? 0,
    followUpCounts: await getFollowUpConfigService().getFollowUpOrderStatusCounts(branchId, undefined, startDate, endDate, effectiveBranchIds).catch(() => ({})),
    cartOrdersCounts: await getCartOrdersService().getStatusCounts(branchId, undefined, startDate, endDate, effectiveBranchIds).catch(() => ({})),
    cartAbandonmentCount: await getCartService().countAllCarts({ branchId, effectiveBranchIds, startDate, endDate }).catch(() => 0),
    // Total Orders — bird's-eye view: includes graduated follow-up + cart
    // orders so the number matches logistics/remittance. Marketing and CS
    // funnels exclude graduated (they have their own strips).
    totalOrdersCounts: await ordersService!.getStatusCounts(undefined, startDate, endDate, undefined, undefined, branchId, undefined, undefined, 'servicing', effectiveBranchIds).catch(() => ({})),
  };
}

export const dashboardRouter = router({
  /**
   * CEO Executive Overview — aggregates all key business metrics.
   * SuperAdmin only.
   */
  ceoOverview: permissionProcedure('ceo.overview')
    .input(
      z.object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      if (!ordersService || !financeService || !marketingService || !hrService || !inventoryService) {
        throw new Error('Dashboard services not initialized');
      }

      const startDate = input?.startDate;
      const endDate = input?.endDate;
      const branchId = ctx.currentBranchId;

      const eIds = ctx.effectiveBranchIds;

      if (cacheService) {
        const cacheKey = `cache:ceo:${branchId ?? 'global'}:${CacheService.hashInput({ startDate, endDate, eIds, gId: ctx.activeGroupId })}`;
        return cacheService.getOrSet(cacheKey, 60, () => _ceoOverviewFetch({ startDate, endDate, branchId, effectiveBranchIds: eIds, activeGroupId: ctx.activeGroupId }));
      }

      return _ceoOverviewFetch({ startDate, endDate, branchId, effectiveBranchIds: eIds, activeGroupId: ctx.activeGroupId });
    }),

  /**
   * CEO Executive Overview — single-call bundle (overview + branch breakdown).
   *
   * Collapses what used to be two parallel HTTP calls (ceoOverview +
   * ceoBranchBreakdown) into one round-trip — saves ~50-60ms Nigeria→EU network
   * latency per cold load. The two aggregations still run in parallel
   * server-side. Cached 60s under the `cache:ceo:` prefix so
   * `refreshExecutiveData`'s `delPattern('cache:ceo:*')` invalidates it too.
   */
  ceoOverviewBundle: permissionProcedure('ceo.overview')
    .input(
      z.object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        /**
         * Which branch column drives the Branch Breakdown table:
         *   - `'marketing'` (default) — `orders.branch_id` (campaign attribution)
         *   - `'servicing'`           — `orders.servicing_branch_id` (CS team)
         * Only affects `branchBreakdown`. `overview` is unscoped (all branches).
         */
        branchScope: z.enum(['marketing', 'servicing']).optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      if (!ordersService || !financeService || !marketingService || !hrService || !inventoryService) {
        throw new Error('Dashboard services not initialized');
      }

      const startDate = input?.startDate;
      const endDate = input?.endDate;
      const branchScope = input?.branchScope ?? 'marketing';
      const branchId = ctx.currentBranchId;
      const eIds = ctx.effectiveBranchIds;
      const ordersSvc = ordersService;

      const fetchBundle = async () => {
        const [overview, branchBreakdown] = await Promise.all([
          _ceoOverviewFetch({ startDate, endDate, branchId, effectiveBranchIds: eIds, activeGroupId: ctx.activeGroupId }),
          ordersSvc.getBranchBreakdown(startDate, endDate, branchScope, eIds),
        ]);
        return { overview, branchBreakdown };
      };

      if (cacheService) {
        const cacheKey = `cache:ceo:bundle:${branchId ?? 'global'}:${branchScope}:${CacheService.hashInput({ startDate, endDate, eIds, gId: ctx.activeGroupId })}`;
        return cacheService.getOrSet(cacheKey, 60, fetchBundle);
      }

      return fetchBundle();
    }),

  /**
   * User-triggered refresh of the finance materialized views that back the Executive
   * Overview. The page never auto-refreshes — when the CEO/admin wants fresher numbers
   * they click "Refresh data" and we run REFRESH MATERIALIZED VIEW CONCURRENTLY across
   * all 4 finance views, clear the 60s Redis cache for ceoOverview, and return.
   *
   * The mutation awaits the refresh so the next page revalidation (triggered by the
   * client after this resolves) reads the now-fresh snapshot.
   */
  refreshExecutiveData: permissionProcedure('ceo.overview').mutation(async () => {
    if (!financeService) {
      throw new Error('Dashboard services not initialized');
    }

    const startedAt = Date.now();
    // Use the user-path helper so init self-heals on a fresh DB before refreshing.
    const results = await financeService.refreshMaterializedViewsForUser();
    const durationMs = Date.now() - startedAt;

    const failures = Object.entries(results).filter(([, ok]) => ok !== true);
    const allOk = failures.length === 0;

    // Wipe the per-branch ceoOverview cache so the next read recomputes from the
    // freshly-refreshed views instead of returning the cached stale aggregate.
    if (allOk && cacheService) {
      await cacheService.delPattern('cache:ceo:*').catch(() => {
        /* delPattern logs internally; cache miss is the worst case here */
      });
    }

    return {
      success: allOk,
      refreshedAt: new Date().toISOString(),
      durationMs,
      failedViews: failures.map(([name]) => name),
    };
  }),

  /**
   * CEO Overview time-series — daily revenue, delivered orders, and order volume (created) for chart.
   * SuperAdmin only. Same permission as ceoOverview.
   */
  ceoOverviewTimeSeries: permissionProcedure('ceo.overview')
    .input(
      z.object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      if (!ordersService) {
        throw new Error('Dashboard services not initialized');
      }
      const startDate = input?.startDate;
      const endDate = input?.endDate;
      const branchId = ctx.currentBranchId;

      const eIds = ctx.effectiveBranchIds;
      const [deliveredBuckets, createdBuckets] = await Promise.all([
        ordersService.getDeliveredOrdersTimeSeries(startDate, endDate, branchId, eIds),
        ordersService.getOrdersTimeSeriesByCreated(startDate, endDate, branchId, undefined, 'servicing', eIds),
      ]);

      // Merge by date: union of all dates, each bucket has revenue, orderCount (delivered), createdCount
      const byDate = new Map<string, { date: string; revenue: number; orderCount: number; createdCount: number }>();
      for (const row of deliveredBuckets) {
        byDate.set(row.date, {
          date: row.date,
          revenue: row.revenue,
          orderCount: row.orderCount,
          createdCount: 0,
        });
      }
      for (const row of createdBuckets) {
        const existing = byDate.get(row.date);
        if (existing) {
          existing.createdCount = row.orderCount;
        } else {
          byDate.set(row.date, {
            date: row.date,
            revenue: 0,
            orderCount: 0,
            createdCount: row.orderCount,
          });
        }
      }

      const merged = Array.from(byDate.values()).sort(
        (a, b) => a.date.localeCompare(b.date),
      );
      return merged;
    }),

  /**
   * Order pipeline chart — Volume, Unconfirmed, Confirmed, Logistics distributed, Delivered.
   * For the CEO Executive Overview order funnel/bar chart. SuperAdmin only.
   */
  orderPipelineChart: permissionProcedure('ceo.overview')
    .input(
      z.object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      if (!ordersService) {
        throw new Error('Dashboard services not initialized');
      }
      return ordersService.getOrderPipelineChart(input?.startDate, input?.endDate, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  /**
   * Lightweight admin landing snapshot — today-only, no materialized-view dependencies, no
   * profit aggregation. Serves the /admin home so SuperAdmin/Admin land on a fast overview
   * rather than the heavy Executive dashboard (which lives at /admin/ceo).
   *
   * Returns two stat-card-shaped sections:
   *   - `marketing.today.{newOrders,confirmed,delivered,cancelled}` — today's order pulse
   *   - `cs.{unassigned,engaged,confirmed,delivered}` — today's Sales activity snapshot
   * Plus `pendingApprovals` for finance.
   */
  quickOverview: permissionProcedure('ceo.overview').query(async ({ ctx }) => {
    if (!ordersService || !financeService) {
      throw new Error('Dashboard services not initialized');
    }
    // "Today" must mean the Nigeria calendar day — the server runs in UTC, so
    // `setHours(0, 0, 0, 0)` would give a UTC day boundary off by an hour from
    // the business day. nigeriaDayStart/End pin the bounds to Africa/Lagos.
    const todayWat = nigeriaToday();
    const startIso = nigeriaDayStart(todayWat).toISOString();
    const endIso = nigeriaDayEnd(todayWat).toISOString();

    const [todayCounts, supplementary, pendingApprovals, followUpCounts, cartOrdersCounts] = await Promise.all([
      // CS funnel — excludes graduated follow-up + cart orders
      ordersService.getStatusCounts(undefined, startIso, endIso, undefined, undefined, ctx.currentBranchId, undefined, undefined, 'servicing', ctx.effectiveBranchIds, false, false, true).catch(() => ({})),
      ordersService.getSupplementaryCounts(undefined, startIso, endIso, undefined, ctx.currentBranchId, undefined, 'servicing', ctx.effectiveBranchIds).catch(() => ({ offlineCount: 0, duplicateCount: 0 })),
      financeService.countPendingApprovalRequests().catch(() => 0),
      getFollowUpConfigService().getFollowUpOrderStatusCounts(ctx.currentBranchId, undefined, startIso, endIso, ctx.effectiveBranchIds).catch(() => ({})),
      getCartOrdersService().getStatusCounts(ctx.currentBranchId, undefined, startIso, endIso, ctx.effectiveBranchIds).catch(() => ({})),
    ]);

    const today = (todayCounts ?? {}) as Record<string, number>;

    return {
      statusCounts: today,
      offlineCount: supplementary.offlineCount,
      marketing: {
        today: {
          // Exclude DELETED + legacy CANCELLED from "new orders" — both are
          // editorial removals (CEO directive 2026-05-23), not real volume.
          // `today` retains them so consumers can show them independently.
          newOrders: Object.entries(today).reduce(
            (sum, [status, n]) =>
              status === 'DELETED' || status === 'CANCELLED' ? sum : sum + (n ?? 0),
            0,
          ),
          confirmed: today['CONFIRMED'] ?? 0,
          delivered: (today['DELIVERED'] ?? 0) + (today['REMITTED'] ?? 0),
          cancelled: today['CANCELLED'] ?? 0,
        },
      },
      cs: {
        unassigned: today['UNPROCESSED'] ?? 0,
        engaged: today['CS_ENGAGED'] ?? 0,
        confirmed: today['CONFIRMED'] ?? 0,
        delivered: (today['DELIVERED'] ?? 0) + (today['REMITTED'] ?? 0),
      },
      pendingApprovals,
      followUpCounts: followUpCounts as Record<string, number>,
      cartOrdersCounts: cartOrdersCounts as Record<string, number>,
    };
  }),
});
