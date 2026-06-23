import { exportReportSchema } from '@yannis/shared';
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
});

