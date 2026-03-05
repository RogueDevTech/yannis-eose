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
      const [
        statusCounts,
        profitReport,
        invoiceSummary,
        marketingMetrics,
        payoutSummary,
        csWorkloads,
      ] = await Promise.all([
        ordersService.getStatusCounts(undefined, startDate, endDate),
        financeService.getProfitReport({ groupBy: 'product', startDate, endDate }).catch(() => ({
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
      })),
      financeService.getInvoiceSummary().catch(() => ({})),
      marketingService.getPerformanceMetrics(undefined, 'this_month', startDate, endDate).catch(() => ({
        totalSpend: 0,
        totalOrders: 0,
        deliveredOrders: 0,
        deliveredRevenue: 0,
        cpa: 0,
        trueRoas: 0,
        deliveryRate: 0,
      })),
      hrService.getPayoutSummary().catch(() => ({
        totalPaid: 0,
        totalPending: 0,
        staffCount: 0,
      })),
      ordersService.getCSAgentWorkloads().catch(() => []),
    ]);

    // Calculate order pipeline counts
    const counts = statusCounts as Record<string, number>;
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
    const totalCSAgents = csWorkloads.length;
    const totalCSPending = csWorkloads.reduce(
      (sum: number, w: { pendingCount: number }) => sum + w.pendingCount,
      0,
    );
    const csUtilization =
      csWorkloads.length > 0
        ? csWorkloads.reduce(
            (sum: number, w: { pendingCount: number; capacity: number }) =>
              sum + w.pendingCount / Math.max(w.capacity, 1),
            0,
          ) / csWorkloads.length
        : 0;

    return {
      // Revenue & Profit
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
        totalSpend: marketingMetrics.totalSpend ?? 0,
        cpa: marketingMetrics.cpa ?? 0,
        roas: marketingMetrics.trueRoas ?? 0,
        deliveryRate: marketingMetrics.deliveryRate ?? 0,
      },

      // CS Team
      csTeam: {
        agentCount: totalCSAgents,
        pendingOrders: totalCSPending,
        utilization: Math.round(csUtilization * 100),
      },

      // HR / Payroll
      payroll: {
        totalPaid: payoutSummary.totalPaid ?? 0,
        totalPending: payoutSummary.totalPending ?? 0,
        staffCount: payoutSummary.staffCount ?? 0,
      },

      // Invoices
      invoiceSummary,
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
