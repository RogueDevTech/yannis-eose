import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import type { OrdersService } from '../../orders/orders.service';
import type { FinanceService } from '../../finance/finance.service';
import type { MarketingService } from '../../marketing/marketing.service';
import type { HrService } from '../../hr/hr.service';
import type { InventoryService } from '../../inventory/inventory.service';
import { CacheService } from '../../common/cache/cache.service';

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

  const hasDateRange = Boolean(startDate && endDate);
  const [
    fastProfitResult,
    statusCountsWhenDated,
    invoiceSummary,
    marketingMetrics,
    payoutSummary,
    csWorkloads,
  ] = await Promise.all([
    financeService!.getFastProfitReport(startDate, endDate).catch(() => null),
    hasDateRange ? ordersService!.getStatusCounts(undefined, startDate, endDate, undefined, undefined, branchId).catch(logErr('statusCounts')) : Promise.resolve(undefined),
    financeService!.getInvoiceSummary().catch(logErr('invoiceSummary')),
    marketingService!.getPerformanceMetrics(undefined, hasDateRange ? 'this_month' : 'all_time', startDate, endDate, branchId).catch(logErr('marketingMetrics')),
    hrService!.getPayoutSummary().catch(logErr('payoutSummary')),
    ordersService!.getCSAgentWorkloads(branchId).catch(logErr('csWorkloads')),
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

  const totalOrders = Object.values(statusCounts).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  );

  const activeOrders =
    (statusCounts['UNPROCESSED'] ?? 0) +
    (statusCounts['CS_ASSIGNED'] ?? 0) +
    (statusCounts['CS_ENGAGED'] ?? 0) +
    (statusCounts['CONFIRMED'] ?? 0) +
    (statusCounts['ALLOCATED'] ?? 0) +
    (statusCounts['DISPATCHED'] ?? 0) +
    (statusCounts['IN_TRANSIT'] ?? 0);

  const deliveredOrders = statusCounts['DELIVERED'] ?? 0;
  const cancelledOrders = statusCounts['CANCELLED'] ?? 0;
  const returnedOrders = statusCounts['RETURNED'] ?? 0;

  const totalCSAgents = safeCSWorkloads.length;
  const totalCSPending = safeCSWorkloads.reduce(
    (sum: number, w: { pendingCount: number }) => sum + w.pendingCount,
    0,
  );
  const csUtilization =
    safeCSWorkloads.length > 0
      ? safeCSWorkloads.reduce(
          (sum: number, w: { pendingCount: number; capacity: number }) =>
            sum + w.pendingCount / Math.max(w.capacity, 1),
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
      cancelled: cancelledOrders,
      returned: returnedOrders,
      statusCounts,
    },
    marketing: {
      totalSpend: safeMarketingMetrics.totalSpend ?? 0,
      cpa: safeMarketingMetrics.cpa ?? 0,
      roas: safeMarketingMetrics.trueRoas ?? 0,
      deliveryRate: safeMarketingMetrics.deliveryRate ?? 0,
    },
    csTeam: {
      agentCount: totalCSAgents,
      pendingOrders: totalCSPending,
      utilization: Math.round(csUtilization * 100),
    },
    payroll: {
      totalPaid: safePayoutSummary.totalPaid ?? 0,
      totalPending: safePayoutSummary.totalPending ?? 0,
      staffCount: safePayoutSummary.staffCount ?? 0,
    },
    invoiceSummary: invoiceSummary ?? {},
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
   * CEO Branch Breakdown — per-branch order counts and revenue for SuperAdmin cross-branch view.
   */
  ceoBranchBreakdown: permissionProcedure('ceo.overview')
    .input(
      z.object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      if (!ordersService) throw new Error('Dashboard services not initialized');
      return ordersService.getBranchBreakdown(input?.startDate, input?.endDate);
    }),

  /**
   * Order pipeline chart — Volume, CS Engaged, Confirmed, Logistics distributed, Delivered.
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
});
