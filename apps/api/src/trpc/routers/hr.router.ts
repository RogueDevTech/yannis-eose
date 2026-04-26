import {
  createCommissionPlanSchema,
  updateCommissionPlanSchema,
  listCommissionPlansSchema,
  generatePayoutsSchema,
  approvePayoutSchema,
  listPayoutsSchema,
  createAdjustmentSchema,
  approveAdjustmentSchema,
  setSettlementConfigSchema,
  generateBatchSchema,
  submitBatchSchema,
  approveBatchSchema,
  rejectBatchSchema,
  markBatchPaidSchema,
  listMonthlyPayrollsSchema,
  getBatchSchema,
  addBatchAdjustmentSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { HrService } from '../../hr/hr.service';
import { PayrollBatchService } from '../../hr/payroll-batch.service';

let hrServiceInstance: HrService | null = null;
let payrollBatchServiceInstance: PayrollBatchService | null = null;

export function setHrService(service: HrService) {
  hrServiceInstance = service;
}

export function setPayrollBatchService(service: PayrollBatchService) {
  payrollBatchServiceInstance = service;
}

function getHrService(): HrService {
  if (!hrServiceInstance) {
    throw new Error('HrService not initialized. Call setHrService() first.');
  }
  return hrServiceInstance;
}

function getPayrollBatchService(): PayrollBatchService {
  if (!payrollBatchServiceInstance) {
    throw new Error('PayrollBatchService not initialized. Call setPayrollBatchService() first.');
  }
  return payrollBatchServiceInstance;
}

export const hrRouter = router({
  // Commission Plans — open to authenticated users; the service gates by viewer role
  // (admin / HR_MANAGER manage all roles; Heads manage only their dept's roles; everyone else
  // gets an empty list / FORBIDDEN on write).
  createPlan: authedProcedure
    .input(createCommissionPlanSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().createCommissionPlan(input, ctx.user);
    }),

  updatePlan: authedProcedure
    .input(updateCommissionPlanSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().updateCommissionPlan(input, ctx.user);
    }),

  listPlans: authedProcedure
    .input(listCommissionPlansSchema)
    .query(async ({ input, ctx }) => {
      return getHrService().listCommissionPlans(input, ctx.user);
    }),

  // Payouts
  generatePayouts: permissionProcedure('hr.write')
    .input(generatePayoutsSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().generatePayouts(input, ctx.user.id);
    }),

  approvePayout: permissionProcedure('hr.write')
    .input(approvePayoutSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().approvePayout(input, ctx.user.id);
    }),

  listPayouts: authedProcedure
    .input(listPayoutsSchema)
    .query(async ({ input }) => {
      return getHrService().listPayouts(input);
    }),

  payoutSummary: permissionProcedure('hr.read')
    .query(async () => {
      return getHrService().getPayoutSummary();
    }),

  // Clawback
  createClawback: permissionProcedure('hr.write')
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getHrService().createClawbackForReturn(input.orderId, ctx.user.id);
    }),

  // Preview
  previewPayout: permissionProcedure('hr.read')
    .input(z.object({
      staffId: z.string().uuid(),
      periodStart: z.string(),
      periodEnd: z.string(),
    }))
    .query(async ({ input }) => {
      return getHrService().previewPayout(input.staffId, input.periodStart, input.periodEnd);
    }),

  // Earnings Adjustments
  createAdjustment: permissionProcedure('hr.write')
    .input(createAdjustmentSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().createAdjustment(input, ctx.user.id);
    }),

  approveAdjustment: permissionProcedure('hr.approveAdjustment')
    .input(approveAdjustmentSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().approveAdjustment(input, ctx.user.id);
    }),

  listAdjustments: authedProcedure
    .input(z.object({ staffId: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      return getHrService().listAdjustments(input.staffId);
    }),

  // Settlement Window Config
  setSettlementConfig: permissionProcedure('hr.write')
    .input(setSettlementConfigSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().setSettlementConfig(input, ctx.user.id);
    }),

  getActiveSettlementConfig: permissionProcedure('hr.read')
    .query(async () => {
      return getHrService().getActiveSettlementConfig();
    }),

  listSettlementConfigs: permissionProcedure('hr.read')
    .query(async () => {
      return getHrService().listSettlementConfigs();
    }),

  getCurrentSettlementPeriod: permissionProcedure('hr.read')
    .query(async () => {
      return getHrService().getCurrentSettlementPeriod();
    }),

  // ============================================
  // Monthly Payroll Batches (multi-stage workflow)
  // ============================================

  /**
   * List monthly payroll batches scoped to the viewer's role:
   *   admin/HR/Finance — all batches on their visible branches
   *   Head of Dept    — only their dept on their branch
   * The service layer enforces the scoping; clients can only narrow further with filters.
   * No explicit permission check — `authedProcedure` is enough; the service rejects out-of-scope access.
   */
  listMonthlyPayrolls: authedProcedure
    .input(listMonthlyPayrollsSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().listMonthlyPayrolls(input, ctx.user);
    }),

  getBatch: authedProcedure
    .input(getBatchSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().getBatchDetail(input.batchId, ctx.user);
    }),

  generateBatch: authedProcedure
    .input(generateBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().generateBatch(input, ctx.user);
    }),

  submitBatch: authedProcedure
    .input(submitBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().submitBatch(input, ctx.user);
    }),

  approveBatch: authedProcedure
    .input(approveBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().approveBatch(input, ctx.user);
    }),

  rejectBatch: authedProcedure
    .input(rejectBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().rejectBatch(input, ctx.user);
    }),

  markBatchPaid: authedProcedure
    .input(markBatchPaidSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().markBatchPaid(input, ctx.user);
    }),

  addBatchAdjustment: authedProcedure
    .input(addBatchAdjustmentSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().addBatchAdjustment(input, ctx.user);
    }),
});
