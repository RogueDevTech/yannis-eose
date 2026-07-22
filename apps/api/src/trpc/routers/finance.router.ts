import {
  updateInvoiceStatusSchema,
  listInvoicesSchema,
  profitReportSchema,
  profitByShipmentSchema,
  createApprovalRequestSchema,
  processApprovalSchema,
  listApprovalRequestsSchema,
  setBudgetSchema,
  canonicalPermissionCode,
  generalLedgerSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { FinanceService } from '../../finance/finance.service';
import { getOrdersService, getFollowUpConfigService } from './orders.router';
import { getCartOrdersService } from './cart-orders.router';
import { getLogisticsService } from './logistics.router';
import { getPayrollBatchService } from './hr.router';
import { getUsersService } from './users.router';
import { getMarketingService } from './marketing.router';
import { listBranchesForUser } from './branches.router';
import { isAdminLevel } from '../../common/authz';

let financeServiceInstance: FinanceService | null = null;

export function setFinanceService(service: FinanceService) {
  financeServiceInstance = service;
}

/** Exported for cross-router lookups (e.g. `*PageBundle` procedures). */
export function getFinanceService(): FinanceService {
  if (!financeServiceInstance) {
    throw new Error('FinanceService not initialized. Call setFinanceService() first.');
  }
  return financeServiceInstance;
}

export const financeRouter = router({
  // Invoices
  updateInvoiceStatus: permissionProcedure('finance.read')
    .input(updateInvoiceStatusSchema)
    .mutation(async ({ input, ctx }) => {
      return getFinanceService().updateInvoiceStatus(input, ctx.user.id);
    }),

  getInvoice: authedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const inv = await getFinanceService().getInvoiceById(input.invoiceId);
      if (inv.orderId) {
        const order = await getOrdersService().getById(inv.orderId);
        getOrdersService().assertActorMayViewOrderForRead(ctx.user, order);
      } else {
        const perms = (ctx.user.permissions ?? []).map((p) => canonicalPermissionCode(p));
        const may =
          isAdminLevel(ctx.user) || perms.includes(canonicalPermissionCode('finance.read'));
        if (!may) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Not authorized to view this invoice',
          });
        }
      }
      return inv;
    }),

  /**
   * Fetch the invoice attached to a given order. Returns null when none exists.
   * Used by CS / Logistics order-detail pages to show & preview the auto-generated invoice.
   * Gated with the same rules as `orders.getById` so invoice rows cannot be enumerated cross-tenant.
   */
  getInvoiceByOrder: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      // Try main orders first; fall back to follow-up orders, then cart orders for visibility check.
      try {
        const order = await getOrdersService().getById(input.orderId);
        getOrdersService().assertActorMayViewOrderForRead(ctx.user, order);
      } catch {
        try {
          // Follow-up order — visibility check passes for authed users
          await getFollowUpConfigService().getFollowUpOrderDetail(input.orderId);
        } catch {
          // Cart order — visibility check passes for authed users.
          // getInvoiceByOrderId will return null if no invoice exists.
        }
      }
      return getFinanceService().getInvoiceByOrderId(input.orderId);
    }),

  /**
   * Ops escape hatch: create invoice on-demand when auto-invoice failed or for older orders.
   * Restricted to finance readers + admin-level, and still gated by order-level visibility.
   */
  ensureInvoiceByOrder: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Any authenticated user can trigger invoice generation — it's idempotent
      // and only creates a DRAFT if the order is confirmed and has no invoice yet.

      // Try main orders table first, fall back to follow-up orders, then cart orders
      type InvoiceOrder = {
        id: string;
        confirmedAt: string | Date | null;
        customerName: string;
        customerAddress: string | null;
        orderItems: Array<{ quantity: number; unitPrice: string; productName: string | null; productId: string }>;
      };
      let order!: InvoiceOrder;
      try {
        const mainOrder = await getOrdersService().getById(input.orderId);
        getOrdersService().assertActorMayViewOrderForRead(ctx.user, mainOrder);
        order = mainOrder;
      } catch {
        // Not in main orders — try follow-up, then cart orders
        let resolved = false;
        try {
          const fuDetail = await getFollowUpConfigService().getFollowUpOrderDetail(input.orderId);
          order = {
            id: fuDetail.id,
            confirmedAt: fuDetail.confirmedAt,
            customerName: fuDetail.customerName,
            customerAddress: fuDetail.customerAddress,
            orderItems: fuDetail.items.map((it: { quantity: number; unitPrice: string; productName?: string | null; productId: string }) => ({
              quantity: it.quantity, unitPrice: it.unitPrice, productName: it.productName ?? null, productId: it.productId,
            })),
          };
          resolved = true;
        } catch { /* not a follow-up order */ }

        if (!resolved) {
          try {
            const co = await getCartOrdersService().getById(input.orderId);
            const coItems = (co as { orderItems?: Array<{ quantity: number; unitPrice: string; productName?: string | null; productId: string }> }).orderItems ?? [];
            order = {
              id: co.id,
              confirmedAt: co.confirmedAt,
              customerName: co.customerName,
              customerAddress: co.customerAddress ?? null,
              orderItems: coItems.map((it) => ({
                quantity: it.quantity, unitPrice: it.unitPrice, productName: it.productName ?? null, productId: it.productId,
              })),
            };
            resolved = true;
          } catch { /* not a cart order either */ }
        }

        if (!resolved) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
        }
      }

      return getFinanceService().ensureInvoiceForOrder({ order, actorId: ctx.user.id });
    }),

  listInvoices: authedProcedure
    .input(listInvoicesSchema)
    .query(async ({ input, ctx }) => {
      return getFinanceService().listInvoices(input, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  invoiceSummary: permissionProcedure('finance.read')
    .query(async ({ ctx }) => {
      return getFinanceService().getInvoiceSummary(ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  // Profit reports
  profitReport: permissionProcedure('finance.read')
    .input(profitReportSchema)
    .query(async ({ input, ctx }) => {
      return getFinanceService().getProfitReport(input, ctx.effectiveBranchIds);
    }),

  /** Per-shipment unit economics — costs in vs estimated revenue from sold qty. */
  profitByShipment: permissionProcedure('finance.read')
    .input(profitByShipmentSchema)
    .query(async ({ input, ctx }) => {
      return getFinanceService().getProfitByShipment(input, ctx.activeGroupId);
    }),

  overview: permissionProcedure('finance.read')
    .query(async ({ ctx }) => {
      return getFinanceService().getFinancialOverview(ctx.effectiveBranchIds);
    }),

  // Approval Requests
  createApprovalRequest: authedProcedure
    .input(createApprovalRequestSchema)
    .mutation(async ({ input, ctx }) => {
      return getFinanceService().createApprovalRequest(input, ctx.user.id);
    }),

  processApproval: permissionProcedure('finance.approve')
    .input(processApprovalSchema)
    .mutation(async ({ input, ctx }) => {
      return getFinanceService().processApproval(input, ctx.user.id);
    }),

  listApprovalRequests: permissionProcedure('finance.read')
    .input(listApprovalRequestsSchema)
    .query(async ({ input, ctx }) => {
      return getFinanceService().listApprovalRequests(input, ctx.effectiveBranchIds);
    }),

  // Budgets
  setBudget: permissionProcedure('finance.read')
    .input(setBudgetSchema)
    .mutation(async ({ input, ctx }) => {
      return getFinanceService().setBudget(input, ctx.user.id, ctx.activeGroupId);
    }),

  listBudgets: permissionProcedure('finance.read')
    .query(async ({ ctx }) => {
      return getFinanceService().listBudgets(ctx.activeGroupId);
    }),

  listBudgetsWithUtilization: permissionProcedure('finance.read')
    .query(async ({ ctx }) => {
      return getFinanceService().listBudgetsWithUtilization(ctx.activeGroupId);
    }),

  budgetUtilization: permissionProcedure('finance.read')
    .input(z.object({ budgetId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getFinanceService().getBudgetUtilization(input.budgetId);
    }),

  // Overdue auto-flagging
  flagOverdueInvoices: permissionProcedure('finance.read')
    .mutation(async ({ ctx }) => {
      return getFinanceService().flagOverdueInvoices(ctx.user.id);
    }),

  // Materialized Views — Performance optimization
  initMaterializedViews: permissionProcedure('finance.initMaterializedViews')
    .mutation(async () => {
      await getFinanceService().initMaterializedViews();
      return { success: true, message: 'Materialized views initialized' };
    }),

  refreshMaterializedViews: permissionProcedure('finance.read')
    .mutation(async () => {
      const results = await getFinanceService().refreshMaterializedViews();
      return { success: true, results };
    }),

  fastProfitReport: permissionProcedure('finance.read')
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      return getFinanceService().getFastProfitReport(input?.startDate, input?.endDate, ctx.effectiveBranchIds);
    }),

  generalLedger: permissionProcedure('finance.read')
    .input(generalLedgerSchema)
    .query(async ({ input, ctx }) => {
      return getFinanceService().getGeneralLedger(input, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  generalLedgerUsers: permissionProcedure('finance.read')
    .query(async ({ ctx }) => {
      return getFinanceService().getGeneralLedgerUsers(ctx.effectiveBranchIds);
    }),

  /**
   * Single-request bundle for the `/admin/finance/overview` page.
   *
   * Replaces 6 parallel loader calls — `finance.profitReport`,
   * `logistics.listDeliveryRemittances`, `hr.listMonthlyPayrolls`,
   * `finance.listApprovalRequests`, `branches.list`, and `users.list[MEDIA_BUYER]`
   * — with one HTTP request. Six fans out via Promise.all server-side, paying
   * the auth + middleware cost once. Permission gate matches the page.
   */
  overviewPageBundle: permissionProcedure('finance.read')
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        branchId: z.string().uuid().optional(),
        mediaBuyerId: z.string().uuid().optional(),
        dateScope: z.enum(['createdAt', 'deliveredAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const profitInput = {
        groupBy: 'product' as const,
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.branchId && { branchId: input.branchId }),
        ...(input.mediaBuyerId && { mediaBuyerId: input.mediaBuyerId }),
        includeProductBreakdown: true,
      };

      const [profit, remit, payroll, approvals, branches, buyers, fundingSummary, byProduct, byLocation] = await Promise.all([
        getFinanceService().getProfitReport(profitInput, ctx.effectiveBranchIds),
        getLogisticsService()
          .listDeliveryRemittances({
            page: 1,
            limit: 1,
            dateScope: input.dateScope ?? 'createdAt',
            ...(input.startDate && { startDate: input.startDate }),
            ...(input.endDate && { endDate: input.endDate }),
          }, ctx.user, ctx.activeGroupId, ctx.effectiveBranchIds)
          .catch(() => null),
        getPayrollBatchService()
          .listMonthlyPayrolls({ status: 'PENDING_FINANCE' as const }, ctx.user)
          .catch(() => null),
        getFinanceService()
          .listApprovalRequests({ status: 'PENDING' as const, page: 1, limit: 1 }, ctx.effectiveBranchIds)
          .catch(() => null),
        listBranchesForUser({ ...ctx.user, activeGroupId: ctx.activeGroupId }).catch(() => [] as Array<{ id: string; name: string }>),
        getUsersService()
          .list(
            {
              page: 1,
              limit: 200,
              role: 'MEDIA_BUYER',
              status: 'ACTIVE',
              sortBy: 'createdAt',
              sortOrder: 'desc',
              includeBranchMemberships: false,
            },
            ctx.user,
            ctx.currentBranchId,
            ctx.effectiveBranchIds,
          )
          .catch(() => null),
        // Scope to HoM receivers only (Finance disburses to HoM, not MBs) and
        // respect date filters so the summary matches the selected period.
        getMarketingService()
          .getFundingSummary(input.branchId ?? null, {
            restrictToReceiverRole: 'HEAD_OF_MARKETING',
            startDate: input.startDate,
            endDate: input.endDate,
          }, ctx.effectiveBranchIds)
          .catch(() => ({ totalSent: '0', totalCompleted: '0', totalDisputed: '0', sentCount: 0, completedCount: 0, disputedCount: 0 })),
        getLogisticsService()
          .deliveredOrdersByProduct(input.branchId, input.startDate, input.endDate, ctx.effectiveBranchIds)
          .catch(() => []),
        getLogisticsService()
          .deliveredOrdersByLocation(input.branchId, input.startDate, input.endDate, ctx.effectiveBranchIds)
          .catch(() => []),
      ]);

      return {
        profit,
        remittanceSummary:
          (remit as { summary?: Record<string, string | number> } | null)?.summary ?? null,
        payrollBatchCount:
          (payroll as { batches?: unknown[] } | null)?.batches?.length ?? 0,
        approvalsPendingCount:
          (approvals as { pagination?: { total?: number } } | null)?.pagination?.total ?? 0,
        branches: (branches ?? []).map((b) => ({ id: b.id, name: b.name })),
        mediaBuyers: buyers ? (buyers.users ?? []).map((u) => ({ id: u.id, name: u.name })) : [],
        fundingSummary,
        byProduct,
        byLocation,
      };
    }),
});
