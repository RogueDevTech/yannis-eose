import {
  createInvoiceSchema,
  updateInvoiceStatusSchema,
  listInvoicesSchema,
  profitReportSchema,
  createApprovalRequestSchema,
  processApprovalSchema,
  listApprovalRequestsSchema,
  setBudgetSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { FinanceService } from '../../finance/finance.service';

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
  createInvoice: permissionProcedure('finance.read')
    .input(createInvoiceSchema)
    .mutation(async ({ input, ctx }) => {
      return getFinanceService().createInvoice(input, ctx.user.id);
    }),

  updateInvoiceStatus: permissionProcedure('finance.read')
    .input(updateInvoiceStatusSchema)
    .mutation(async ({ input, ctx }) => {
      return getFinanceService().updateInvoiceStatus(input, ctx.user.id);
    }),

  getInvoice: authedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getFinanceService().getInvoiceById(input.invoiceId);
    }),

  /**
   * Fetch the invoice attached to a given order. Returns null when none exists.
   * Used by CS / Logistics order-detail pages to show & preview the auto-generated invoice.
   */
  getInvoiceByOrder: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getFinanceService().getInvoiceByOrderId(input.orderId);
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
