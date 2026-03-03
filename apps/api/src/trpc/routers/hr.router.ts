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
} from '@yannis/shared';
import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { HrService } from '../../hr/hr.service';

let hrServiceInstance: HrService | null = null;

export function setHrService(service: HrService) {
  hrServiceInstance = service;
}

function getHrService(): HrService {
  if (!hrServiceInstance) {
    throw new Error('HrService not initialized. Call setHrService() first.');
  }
  return hrServiceInstance;
}

export const hrRouter = router({
  // Commission Plans
  createPlan: permissionProcedure('hr.write')
    .input(createCommissionPlanSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().createCommissionPlan(input, ctx.user.id);
    }),

  updatePlan: permissionProcedure('hr.write')
    .input(updateCommissionPlanSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().updateCommissionPlan(input, ctx.user.id);
    }),

  listPlans: permissionProcedure('hr.read')
    .input(listCommissionPlansSchema)
    .query(async ({ input }) => {
      return getHrService().listCommissionPlans(input);
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
});
