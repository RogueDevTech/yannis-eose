import {
  updateInvoiceStatusSchema,
  listInvoicesSchema,
  profitReportSchema,
  createApprovalRequestSchema,
  processApprovalSchema,
  listApprovalRequestsSchema,
  setBudgetSchema,
  canonicalPermissionCode,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { FinanceService } from '../../finance/finance.service';
import { getOrdersService } from './orders.router';
import { isAdminLevel } from '../../common/authz';

let financeServiceInstance: FinanceService | null = null;

export function setFinanceService(service: FinanceService) {
  financeServiceInstance = service;
}

function getFinanceService(): FinanceService {
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
      const order = await getOrdersService().getById(input.orderId);
      getOrdersService().assertActorMayViewOrderForRead(ctx.user, order);
      return getFinanceService().getInvoiceByOrderId(input.orderId);
    }),

  /**
   * Ops escape hatch: create invoice on-demand when auto-invoice failed or for older orders.
   * Restricted to finance readers + admin-level, and still gated by order-level visibility.
   */
  ensureInvoiceByOrder: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const perms = (ctx.user.permissions ?? []).map((p) => canonicalPermissionCode(p));
      const mayGenerate = isAdminLevel(ctx.user) || perms.includes(canonicalPermissionCode('finance.read'));
      if (!mayGenerate) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to generate invoices' });
      }

      const order = await getOrdersService().getById(input.orderId);
      getOrdersService().assertActorMayViewOrderForRead(ctx.user, order);

      return getFinanceService().ensureInvoiceForOrder({ order, actorId: ctx.user.id });
    }),

  listInvoices: authedProcedure
    .input(listInvoicesSchema)
    .query(async ({ input }) => {
      return getFinanceService().listInvoices(input);
    }),

  invoiceSummary: permissionProcedure('finance.read')
    .query(async () => {
      return getFinanceService().getInvoiceSummary();
    }),

  // Profit reports
  profitReport: permissionProcedure('finance.read')
    .input(profitReportSchema)
    .query(async ({ input }) => {
      return getFinanceService().getProfitReport(input);
    }),

  overview: permissionProcedure('finance.read')
    .query(async () => {
      return getFinanceService().getFinancialOverview();
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
    .query(async ({ input }) => {
      return getFinanceService().listApprovalRequests(input);
    }),

  // Budgets
  setBudget: permissionProcedure('finance.read')
    .input(setBudgetSchema)
    .mutation(async ({ input, ctx }) => {
      return getFinanceService().setBudget(input, ctx.user.id);
    }),

  listBudgets: permissionProcedure('finance.read')
    .query(async () => {
      return getFinanceService().listBudgets();
    }),

  listBudgetsWithUtilization: permissionProcedure('finance.read')
    .query(async () => {
      return getFinanceService().listBudgetsWithUtilization();
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
    .query(async ({ input }) => {
      return getFinanceService().getFastProfitReport(input?.startDate, input?.endDate);
    }),
});
