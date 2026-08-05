import { exportReportSchema, reportDataInputSchema } from '@yannis/shared';
import { router, authedProcedure } from '../trpc';
import { ReportsService } from '../../reports/reports.service';

let reportsServiceInstance: ReportsService | null = null;

export function setReportsService(service: ReportsService) {
  reportsServiceInstance = service;
}

function getReportsService(): ReportsService {
  if (!reportsServiceInstance) {
    throw new Error('ReportsService not initialized. Call setReportsService() first.');
  }
  return reportsServiceInstance;
}

export const reportsRouter = router({
  exportCsv: authedProcedure
    .input(exportReportSchema)
    .mutation(async ({ input, ctx }) => {
      return getReportsService().exportCsv(input, ctx.user, ctx.currentBranchId, ctx.effectiveBranchIds, ctx.activeGroupId);
    }),

  // ── Reports module (Admin → Reports) — on-screen report data ──────────────
  // Admin-level gate is enforced inside the service (ensureReportsAccess), so
  // these stay on authedProcedure like exportCsv. Branch scope narrows to
  // ctx.effectiveBranchIds; input.branchId narrows to one branch.
  productPerformance: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().productPerformance(input, ctx.user, ctx.effectiveBranchIds);
    }),

  customerAcquisitionFunnel: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().customerAcquisitionFunnel(input, ctx.user, ctx.effectiveBranchIds);
    }),

  mediaBuyerPerformance: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().mediaBuyerPerformance(input, ctx.user, ctx.effectiveBranchIds);
    }),

  csPerformance: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().csPerformance(input, ctx.user, ctx.effectiveBranchIds);
    }),

  logisticsManagerPerformance: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().logisticsManagerPerformance(input, ctx.user, ctx.effectiveBranchIds, ctx.activeGroupId);
    }),

  deliveryAgentPerformance: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().deliveryAgentPerformance(input, ctx.user, ctx.effectiveBranchIds, ctx.activeGroupId);
    }),

  orderReport: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().orderReport(input, ctx.user, ctx.effectiveBranchIds);
    }),

  orderCategoryReport: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().orderCategoryReport(input, ctx.user, ctx.effectiveBranchIds);
    }),

  productStock: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ ctx }) => {
      return getReportsService().productStock(ctx.user, ctx.activeGroupId);
    }),

  financeReport: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().financeReport(input, ctx.user, ctx.effectiveBranchIds);
    }),

  marketingReport: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().marketingReport(input, ctx.user, ctx.effectiveBranchIds);
    }),

  payrollReport: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().payrollReport(input, ctx.user, ctx.effectiveBranchIds);
    }),

  staffPerformance: authedProcedure
    .input(reportDataInputSchema)
    .query(async ({ input, ctx }) => {
      return getReportsService().staffPerformance(input, ctx.user, ctx.effectiveBranchIds);
    }),
});

