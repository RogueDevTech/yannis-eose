import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import type { OrdersService } from '../../orders/orders.service';
import type { FinanceService } from '../../finance/finance.service';
import type { MarketingService } from '../../marketing/marketing.service';
import type { HrService } from '../../hr/hr.service';
import type { InventoryService } from '../../inventory/inventory.service';
import { CacheService } from '../../common/cache/cache.service';
import { nigeriaToday, nigeriaDayStart, nigeriaDayEnd } from '../../common/utils/date-range';

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
}) {
  const { startDate, endDate, branchId } = params;

  const logErr = (label: string) => (err: unknown) => {
    console.error(`[ceoOverview] ${label} failed:`, err instanceof Error ? err.message : err);
    return undefined;
  };

  // Materialized views are refreshed ONLY when the user explicitly clicks the Refresh
  // button on the page (`dashboard.refreshExecutiveData`). The page read here always uses
  // whatever snapshot is currently in the MVs — fast and deterministic. Numbers stay fixed
  // until the user asks for fresh data.

  const hasDateRange = Boolean(startDate && endDate);
  const [
    fastProfitResult,
    statusCountsWhenDated,
    invoiceSummary,
    marketingMetrics,
    payoutSummary,
    csWorkloads,
    revenueByPeriod,
    deliveriesByProduct,
    stockPerProduct,
    activeStaffCount,
  ] = await Promise.all([
    financeService!.getFastProfitReport(startDate, endDate).catch(() => null),
    hasDateRange ? ordersService!.getStatusCounts(undefined, startDate, endDate, undefined, undefined, branchId).catch(logErr('statusCounts')) : Promise.resolve(undefined),
    financeService!.getInvoiceSummary().catch(logErr('invoiceSummary')),
    marketingService!.getPerformanceMetrics(undefined, hasDateRange ? 'this_month' : 'all_time', startDate, endDate, branchId).catch(logErr('marketingMetrics')),
    hrService!.getPayoutSummary().catch(logErr('payoutSummary')),
    ordersService!.getCSCloserWorkloads(branchId).catch(logErr('csWorkloads')),
    ordersService!.getRevenueByPeriod(branchId).catch(logErr('revenueByPeriod')),
    ordersService!.getDeliveriesByProduct(branchId).catch(logErr('deliveriesByProduct')),
    inventoryService!.getStockPerProduct().catch(logErr('stockPerProduct')),
    hrService!.countActiveStaff().catch(logErr('activeStaffCount')),
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
    const fullReport = await financeService!.getProfitReport({ groupBy: 'product', startDate, endDate, branchId }).catch(logErr('profitReport'));
    profitReport = fullReport ?? {
      revenue: 0, landedCost: 0, deliveryFee: 0, adSpend: 0,
      commission: 0, fulfillmentCost: 0, operationalLoss: 0,
      trueProfit: 0, orderCount: 0, margin: 0,
    };
  }

  // Status counts: when date range or branch-scoped use explicit query; when all-time global use fast path MVs
  let statusCounts: Record<string, number>;
  if (hasDateRange) {
    statusCounts = (statusCountsWhenDated ?? {}) as Record<string, number>;
  } else if (!branchId && fastProfitResult?.statusCounts && Object.keys(fastProfitResult.statusCounts).length > 0) {
    statusCounts = fastProfitResult.statusCounts as Record<string, number>;
  } else {
    const allTimeCounts = await ordersService!.getStatusCounts(undefined, undefined, undefined, undefined, undefined, branchId).catch(logErr('statusCounts'));
    statusCounts = (allTimeCounts ?? {}) as Record<string, number>;
  }

  const safeMarketingMetrics = marketingMetrics ?? {
    totalSpend: 0, totalOrders: 0, deliveredOrders: 0,
    deliveredRevenue: 0, confirmedOrders: 0, confirmationRate: 0,
    cpa: 0, trueRoas: 0, deliveryRate: 0,
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
    },
    marketing: {
      totalSpend: safeMarketingMetrics.totalSpend ?? 0,
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

      if (cacheService) {
        const cacheKey = `cache:ceo:${branchId ?? 'global'}:${CacheService.hashInput({ startDate, endDate })}`;
        return cacheService.getOrSet(cacheKey, 60, () => _ceoOverviewFetch({ startDate, endDate, branchId }));
      }

      return _ceoOverviewFetch({ startDate, endDate, branchId });
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
      const ordersSvc = ordersService;

      const fetchBundle = async () => {
        const [overview, branchBreakdown] = await Promise.all([
          _ceoOverviewFetch({ startDate, endDate, branchId }),
          ordersSvc.getBranchBreakdown(startDate, endDate, branchScope),
        ]);
        return { overview, branchBreakdown };
      };

      if (cacheService) {
        const cacheKey = `cache:ceo:bundle:${branchId ?? 'global'}:${branchScope}:${CacheService.hashInput({ startDate, endDate })}`;
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

      const [deliveredBuckets, createdBuckets] = await Promise.all([
        ordersService.getDeliveredOrdersTimeSeries(startDate, endDate, branchId),
        ordersService.getOrdersTimeSeriesByCreated(startDate, endDate, branchId),
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
      return ordersService.getOrderPipelineChart(input?.startDate, input?.endDate, ctx.currentBranchId);
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

    const [todayCounts, pendingApprovals] = await Promise.all([
      ordersService.getStatusCounts(undefined, startIso, endIso, undefined, undefined, ctx.currentBranchId).catch(() => ({})),
      financeService.countPendingApprovalRequests().catch(() => 0),
    ]);

    const today = (todayCounts ?? {}) as Record<string, number>;

    return {
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
    };
  }),
});
