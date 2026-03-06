import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import type { OrdersService } from '../../orders/orders.service';
import type { FinanceService } from '../../finance/finance.service';
import type { MarketingService } from '../../marketing/marketing.service';
import type { HrService } from '../../hr/hr.service';
import type { InventoryService } from '../../inventory/inventory.service';

// Factory pattern: services injected from NestJS module
let ordersService: OrdersService | null = null;
let financeService: FinanceService | null = null;
let marketingService: MarketingService | null = null;
let hrService: HrService | null = null;
let inventoryService: InventoryService | null = null;

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
    .query(async ({ input }) => {
      if (!ordersService || !financeService || !marketingService || !hrService || !inventoryService) {
        throw new Error('Dashboard services not initialized');
      }

      const startDate = input?.startDate;
      const endDate = input?.endDate;

      // Fetch all data in parallel for performance
      const logErr = (label: string) => (err: unknown) => {
        console.error(`[ceoOverview] ${label} failed:`, err instanceof Error ? err.message : err);
        return undefined;
      };

      const [
        statusCounts,
        profitReport,
        invoiceSummary,
        marketingMetrics,
        payoutSummary,
        csWorkloads,
      ] = await Promise.all([
        ordersService.getStatusCounts(undefined, startDate, endDate).catch(logErr('statusCounts')),
        financeService.getProfitReport({ groupBy: 'product', startDate, endDate }).catch(logErr('profitReport')),
        financeService.getInvoiceSummary().catch(logErr('invoiceSummary')),
        marketingService.getPerformanceMetrics(undefined, startDate && endDate ? 'this_month' : 'all_time', startDate, endDate).catch(logErr('marketingMetrics')),
        hrService.getPayoutSummary().catch(logErr('payoutSummary')),
        ordersService.getCSAgentWorkloads().catch(logErr('csWorkloads')),
      ]);

      const safeProfitReport = profitReport ?? {
        revenue: 0, landedCost: 0, deliveryFee: 0, adSpend: 0,
        commission: 0, fulfillmentCost: 0, operationalLoss: 0,
        trueProfit: 0, orderCount: 0, margin: 0,
      };
      const safeMarketingMetrics = marketingMetrics ?? {
        totalSpend: 0, totalOrders: 0, deliveredOrders: 0,
        deliveredRevenue: 0, cpa: 0, trueRoas: 0, deliveryRate: 0,
      };
      const safePayoutSummary = payoutSummary ?? { totalPaid: 0, totalPending: 0, staffCount: 0 };
      const safeCSWorkloads = csWorkloads ?? [];

    // Calculate order pipeline counts
    const counts = (statusCounts ?? {}) as Record<string, number>;
    const totalOrders = Object.values(counts).reduce(
      (sum, count) => sum + (count ?? 0),
      0,
    );

    const activeOrders =
      (counts['UNPROCESSED'] ?? 0) +
      (counts['CS_ASSIGNED'] ?? 0) +
      (counts['CS_ENGAGED'] ?? 0) +
      (counts['CONFIRMED'] ?? 0) +
      (counts['ALLOCATED'] ?? 0) +
      (counts['DISPATCHED'] ?? 0) +
      (counts['IN_TRANSIT'] ?? 0);

    const deliveredOrders = counts['DELIVERED'] ?? 0;
    const cancelledOrders = counts['CANCELLED'] ?? 0;
    const returnedOrders = counts['RETURNED'] ?? 0;

    // CS team metrics
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
      // Revenue & Profit
      revenue: safeProfitReport.revenue ?? 0,
      trueProfit: safeProfitReport.trueProfit ?? 0,
      margin: safeProfitReport.margin ?? 0,
      costBreakdown: {
        landedCost: safeProfitReport.landedCost ?? 0,
        deliveryFee: safeProfitReport.deliveryFee ?? 0,
        adSpend: safeProfitReport.adSpend ?? 0,
        commission: safeProfitReport.commission ?? 0,
        fulfillmentCost: safeProfitReport.fulfillmentCost ?? 0,
        operationalLoss: safeProfitReport.operationalLoss ?? 0,
      },

      // Order Pipeline
      orderPipeline: {
        total: totalOrders,
        active: activeOrders,
        delivered: deliveredOrders,
        cancelled: cancelledOrders,
        returned: returnedOrders,
        statusCounts: counts,
      },

      // Marketing
      marketing: {
        totalSpend: safeMarketingMetrics.totalSpend ?? 0,
        cpa: safeMarketingMetrics.cpa ?? 0,
        roas: safeMarketingMetrics.trueRoas ?? 0,
        deliveryRate: safeMarketingMetrics.deliveryRate ?? 0,
      },

      // CS Team
      csTeam: {
        agentCount: totalCSAgents,
        pendingOrders: totalCSPending,
        utilization: Math.round(csUtilization * 100),
      },

      // HR / Payroll
      payroll: {
        totalPaid: safePayoutSummary.totalPaid ?? 0,
        totalPending: safePayoutSummary.totalPending ?? 0,
        staffCount: safePayoutSummary.staffCount ?? 0,
      },

      // Invoices
      invoiceSummary: invoiceSummary ?? {},
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
    .query(async ({ input }) => {
      if (!ordersService) {
        throw new Error('Dashboard services not initialized');
      }
      const startDate = input?.startDate;
      const endDate = input?.endDate;

      const [deliveredBuckets, createdBuckets] = await Promise.all([
        ordersService.getDeliveredOrdersTimeSeries(startDate, endDate),
        ordersService.getOrdersTimeSeriesByCreated(startDate, endDate),
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
    .query(async ({ input }) => {
      if (!ordersService) {
        throw new Error('Dashboard services not initialized');
      }
      return ordersService.getOrderPipelineChart(input?.startDate, input?.endDate);
    }),
});
