import {
  createCommissionPlanSchema,
  updateCommissionPlanSchema,
  listCommissionPlansSchema,
  generatePayoutsSchema,
  approvePayoutSchema,
  listPayoutsSchema,
  createAdjustmentSchema,
  approveAdjustmentSchema,
  updateAdjustmentSchema,
  deleteAdjustmentSchema,
  setSettlementConfigSchema,
  generateBatchSchema,
  generateBatchesBulkSchema,
  previewSelectionSchema,
  submitBatchSchema,
  deleteBatchSchema,
  approveBatchSchema,
  rejectBatchSchema,
  markBatchPaidSchema,
  listMonthlyPayrollsSchema,
  getBatchSchema,
  addBatchAdjustmentSchema,
  removePayoutLineSchema,
  createPayRoleSchema,
  updatePayRoleSchema,
  saveProductTierConfigSchema,
  deleteProductTierConfigSchema,
  saveTaxBandConfigSchema,
  deleteTaxBandConfigSchema,
  createContractorSchema,
  updateContractorSchema,
  getContractorSchema,
  listContractorsSchema,
  listContractorPayoutsSchema,
  overridePayslipLineSchema,
  previewPayeSchema,
  payrollOnboardingActionSchema,
  updatePayrollProfileSchema,
  updateMyPayrollProfileSchema,
  bulkAssignPayRoleSchema,
  bulkAssignContractorsToPayRoleSchema,
  listPayslipsSchema,
  payrollRegisterSchema,
  payrollReportRangeSchema,
  getPayrollMetricsBulkSchema,
  saveFormulaConfigSchema,
  previewPayrollFormulaSchema,
  archivePayRoleSchema,
  getPayRoleWithFormulaSchema,
  getPayslipSchema,
  bulkPayslipPdfSchema,
  exportPayRunDraftSchema,
  exportBankUploadSchema,
  canonicalPermissionCode,
  legacyAliasesForCanonical,
} from '@yannis/shared';
import { db as schema } from '@yannis/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import type { TrpcContext } from '../context';
import { canAccessStaffHrUserDetail, canMirror, isSuperAdminOnly } from '../../common/authz';
import { resolveRoleTemplateBaselineCodes } from '../../permissions/role-template-baseline';
import { computeEffectivePermissionsLegacyUnion } from '../../permissions/permissions.service';
import { HrService } from '../../hr/hr.service';
import { PayrollBatchService } from '../../hr/payroll-batch.service';
import { PayrollConfigService } from '../../hr/payroll-config.service';
import { PayrollMetricsService } from '../../hr/payroll-metrics.service';
import { getUsersService } from './users.router';
import { getProductsService } from './products.router';
import { getLogisticsService } from './logistics.router';
import { getMarketingService } from './marketing.router';
import { getRoleTemplatesService } from './role-templates.router';
import { getNotificationsService } from './notifications.router';
import { getOnboardingService } from './onboarding.router';
import { getBranchTeamsService } from './branches.router';
import {
  getPermissionsDb,
  actorMayViewUserPermissionMatrix,
} from './permissions.router';

let hrServiceInstance: HrService | null = null;
let payrollBatchServiceInstance: PayrollBatchService | null = null;
let payrollConfigServiceInstance: PayrollConfigService | null = null;
let payrollMetricsServiceInstance: PayrollMetricsService | null = null;

export function setHrService(service: HrService) {
  hrServiceInstance = service;
}

export function setPayrollBatchService(service: PayrollBatchService) {
  payrollBatchServiceInstance = service;
}

export function setPayrollConfigService(service: PayrollConfigService) {
  payrollConfigServiceInstance = service;
}

export function setPayrollMetricsService(service: PayrollMetricsService) {
  payrollMetricsServiceInstance = service;
}

/** Exported for cross-router lookups (e.g. `*PageBundle` procedures). */
export function getHrService(): HrService {
  if (!hrServiceInstance) {
    throw new Error('HrService not initialized. Call setHrService() first.');
  }
  return hrServiceInstance;
}

/** Exported for cross-router lookups (e.g. `*PageBundle` procedures). */
export function getPayrollBatchService(): PayrollBatchService {
  if (!payrollBatchServiceInstance) {
    throw new Error('PayrollBatchService not initialized. Call setPayrollBatchService() first.');
  }
  return payrollBatchServiceInstance;
}

function getPayrollConfigService(): PayrollConfigService {
  if (!payrollConfigServiceInstance) {
    throw new Error('PayrollConfigService not initialized. Call setPayrollConfigService() first.');
  }
  return payrollConfigServiceInstance;
}

function getPayrollMetricsService(): PayrollMetricsService {
  if (!payrollMetricsServiceInstance) {
    throw new Error('PayrollMetricsService not initialized. Call setPayrollMetricsService() first.');
  }
  return payrollMetricsServiceInstance;
}

function assertHasHrRead(user: NonNullable<TrpcContext['user']>) {
  const codes = new Set((user.permissions ?? []).map((c) => canonicalPermissionCode(c)));
  if (!codes.has('hr.read')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to list organisation-wide payouts.',
    });
  }
}

export const hrRouter = router({
  // Commission Plans — open to authenticated users; the service gates by viewer role
  // (admin / HR_MANAGER manage all roles; Heads manage only their dept's roles; everyone else
  // gets an empty list / FORBIDDEN on write).
  createPlan: authedProcedure
    .input(createCommissionPlanSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().createCommissionPlan(input, ctx.user, ctx.activeGroupId);
    }),

  updatePlan: authedProcedure
    .input(updateCommissionPlanSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().updateCommissionPlan(input, ctx.user, ctx.activeGroupId);
    }),

  listPlans: authedProcedure
    .input(listCommissionPlansSchema)
    .query(async ({ input, ctx }) => {
      return getHrService().listCommissionPlans(input, ctx.user, ctx.activeGroupId);
    }),

  // Payouts
  generatePayouts: permissionProcedure('hr.write')
    .input(generatePayoutsSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().generatePayouts(input, ctx.user.id, ctx.effectiveBranchIds);
    }),

  approvePayout: permissionProcedure('hr.write')
    .input(approvePayoutSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().approvePayout(input, ctx.user.id);
    }),

  listPayouts: authedProcedure
    .input(listPayoutsSchema)
    .query(async ({ input, ctx }) => {
      const actor = ctx.user!;
      if (!input.staffId) {
        assertHasHrRead(actor);
      } else {
        const target = await getUsersService().getById(input.staffId, actor);
        if (
          !canAccessStaffHrUserDetail(actor, {
            id: target.id,
            role: target.role,
            branchIds: target.branchMemberships.map((m) => m.branchId),
          })
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Not allowed to view payout records for this user.',
          });
        }
      }
      return getHrService().listPayouts(input, actor, ctx.effectiveBranchIds);
    }),

  payoutSummary: permissionProcedure('hr.read')
    .query(async ({ ctx }) => {
      return getHrService().getPayoutSummary(ctx.effectiveBranchIds);
    }),

  // Clawback
  createClawback: permissionProcedure('hr.write')
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getHrService().createClawbackForReturn(input.orderId, ctx.user.id);
    }),

  /** Live estimate from orders vs commission plan — self + staff-directory viewers */
  previewPayout: authedProcedure
    .input(
      z.object({
        staffId: z.string().uuid(),
        periodStart: z.string(),
        periodEnd: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const actor = ctx.user!;
      const target = await getUsersService().getById(input.staffId, actor);
      if (
        !canAccessStaffHrUserDetail(actor, {
          id: target.id,
          role: target.role,
          branchIds: target.branchMemberships.map((m) => m.branchId),
        })
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not allowed to view payout estimates for this user.',
        });
      }
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

  updateAdjustment: permissionProcedure('hr.write')
    .input(updateAdjustmentSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().updateAdjustment(input, ctx.user.id);
    }),

  deleteAdjustment: permissionProcedure('hr.write')
    .input(deleteAdjustmentSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().deleteAdjustment(input, ctx.user.id);
    }),

  listAdjustments: permissionProcedure('hr.read')
    .input(
      z.object({
        staffId: z.string().uuid().optional(),
        search: z.string().trim().max(200).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getHrService().listAdjustments(input.staffId, ctx.effectiveBranchIds, {
        search: input.search,
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  // Settlement Window Config
  setSettlementConfig: permissionProcedure('hr.write')
    .input(setSettlementConfigSchema)
    .mutation(async ({ input, ctx }) => {
      return getHrService().setSettlementConfig(input, ctx.user.id, ctx.activeGroupId);
    }),

  getActiveSettlementConfig: permissionProcedure('hr.read')
    .query(async ({ ctx }) => {
      return getHrService().getActiveSettlementConfig(ctx.activeGroupId);
    }),

  listSettlementConfigs: permissionProcedure('hr.read')
    .query(async ({ ctx }) => {
      return getHrService().listSettlementConfigs(ctx.activeGroupId);
    }),

  getCurrentSettlementPeriod: permissionProcedure('hr.read')
    .query(async ({ ctx }) => {
      return getHrService().getCurrentSettlementPeriod(ctx.activeGroupId);
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
      return getPayrollBatchService().listMonthlyPayrolls(input, ctx.user, ctx.effectiveBranchIds);
    }),

  payrollPrepareAccess: authedProcedure
    .query(async ({ ctx }) => {
      return getPayrollBatchService().getPrepareAccess(ctx.user);
    }),

  getBatch: authedProcedure
    .input(getBatchSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().getBatchDetail(input.batchId, ctx.user, ctx.effectiveBranchIds);
    }),

  generateBatch: authedProcedure
    .input(generateBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().generateBatch(input, ctx.user);
    }),

  previewBatch: authedProcedure
    .input(generateBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().previewBatch(input, ctx.user);
    }),

  // Grand-total preview for a whole selection (multi-branch / multi-department
  // fan-out, CONTRACTORS, or ALL). Reuses the exact generate-path compute.
  previewSelection: authedProcedure
    .input(previewSelectionSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().previewSelectionTotal(input, ctx.user);
    }),

  generateBatchesBulk: authedProcedure
    .input(generateBatchesBulkSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().generateBatchesBulk(input, ctx.user);
    }),

  submitBatch: authedProcedure
    .input(submitBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().submitBatch(input, ctx.user);
    }),

  deleteBatch: authedProcedure
    .input(deleteBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().deleteBatch(input, ctx.user, ctx.effectiveBranchIds);
    }),

  approveBatch: authedProcedure
    .input(approveBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().approveBatch(input, ctx.user, ctx.effectiveBranchIds);
    }),

  rejectBatch: authedProcedure
    .input(rejectBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().rejectBatch(input, ctx.user, ctx.effectiveBranchIds);
    }),

  // finance.disburse (Finance) OR payroll.run.disburse (HR completes its own
  // payroll run) — the payroll-scoped key does NOT grant funding approvals.
  markBatchPaid: permissionProcedure('finance.disburse', 'payroll.run.disburse')
    .input(markBatchPaidSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().markBatchPaid(input, ctx.user, ctx.effectiveBranchIds);
    }),

  addBatchAdjustment: authedProcedure
    .input(addBatchAdjustmentSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().addBatchAdjustment(input, ctx.user);
    }),

  removePayoutLine: authedProcedure
    .input(removePayoutLineSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().removePayoutLine(input, ctx.user);
    }),

  recalculateBatch: authedProcedure
    .input(getBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().recalculateBatch(input.batchId, ctx.user);
    }),

  overridePayslipLine: authedProcedure
    .input(overridePayslipLineSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollBatchService().overridePayslipLine(input, ctx.user);
    }),

  listPayslips: permissionProcedure('hr.read')
    .input(listPayslipsSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().listPayslips(input, ctx.effectiveBranchIds, ctx.user);
    }),

  payrollRegister: permissionProcedure('hr.read')
    .input(payrollRegisterSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().payrollRegister(input, ctx.effectiveBranchIds, ctx.user);
    }),

  payrollCostByBranch: permissionProcedure('hr.read')
    .input(payrollReportRangeSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().payrollCostByBranch(input, ctx.effectiveBranchIds);
    }),

  payrollCostByRoleCategory: permissionProcedure('hr.read')
    .input(payrollReportRangeSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().payrollCostByRoleCategory(input, ctx.effectiveBranchIds);
    }),

  payrollTrend: permissionProcedure('hr.read')
    .input(payrollReportRangeSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().payrollTrend(input, ctx.effectiveBranchIds);
    }),

  exportPayRunDraft: permissionProcedure('hr.read')
    .input(exportPayRunDraftSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().exportPayRunDraft(input.batchId, ctx.user);
    }),

  // finance.disburse (Finance) OR payroll.run.disburse (HR completes payroll).
  exportBankUpload: permissionProcedure('finance.disburse', 'payroll.run.disburse')
    .input(exportBankUploadSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().exportBankUpload(input, ctx.user, ctx.effectiveBranchIds);
    }),

  getPayslip: authedProcedure
    .input(getPayslipSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().getPayslip(input.payoutId, ctx.user);
    }),

  bulkPayslipPdf: permissionProcedure('hr.read')
    .input(bulkPayslipPdfSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollBatchService().bulkPayslipPdf(input, ctx.user, ctx.effectiveBranchIds);
    }),

  getPayrollMetrics: permissionProcedure('hr.read')
    .input(z.object({ staffId: z.string().uuid(), periodStart: z.string(), periodEnd: z.string() }))
    .query(async ({ input }) => {
      const userRows = await getUsersService().getById(input.staffId, null);
      return getPayrollMetricsService().getStaffMetrics({
        staffId: input.staffId,
        staffRole: userRows.role,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
        crmLinked: true,
      });
    }),

  getPayrollMetricsBulk: permissionProcedure('hr.read')
    .input(getPayrollMetricsBulkSchema)
    .query(async ({ input }) => {
      const staffRows = await Promise.all(
        input.staffIds.map(async (id) => {
          const user = await getUsersService().getById(id, null);
          return {
            id: user.id,
            role: user.role,
            crmLinked: true,
            reportsToUserId: user.reportsToUserId,
            payRoleId: user.payRoleId ?? null,
          };
        }),
      );
      const metricsMap = await getPayrollMetricsService().getStaffMetricsBulk(
        staffRows,
        new Date(input.periodStart),
        new Date(input.periodEnd),
      );
      return Object.fromEntries(metricsMap.entries());
    }),

  listPayRoles: permissionProcedure(
      'payroll.config.read',
      'users.staff.view',
      'users.staff.update',
      'users.staff.create',
    )
    .query(async ({ ctx }) => {
      return getPayrollConfigService().listPayRoles(ctx.activeGroupId);
    }),

  createPayRole: permissionProcedure('payroll.config.write')
    .input(createPayRoleSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().createPayRole(input, ctx.user, ctx.activeGroupId);
    }),

  updatePayRole: permissionProcedure('payroll.config.write')
    .input(updatePayRoleSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().updatePayRole(input, ctx.user, ctx.activeGroupId);
    }),

  archivePayRole: permissionProcedure('payroll.config.write')
    .input(archivePayRoleSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().archivePayRole(input.id, ctx.user, ctx.activeGroupId);
    }),

  getPayRoleWithFormula: permissionProcedure('payroll.config.read')
    .input(getPayRoleWithFormulaSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollConfigService().getPayRoleWithFormula(input.payRoleId, ctx.activeGroupId);
    }),

  saveFormulaConfig: permissionProcedure('payroll.config.write')
    .input(saveFormulaConfigSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().saveFormulaConfig(input, ctx.user, ctx.activeGroupId);
    }),

  previewPayrollFormula: permissionProcedure('payroll.config.read')
    .input(previewPayrollFormulaSchema)
    .query(async ({ input }) => {
      return getPayrollConfigService().previewPayrollFormula(input);
    }),

  listProductTierConfigs: permissionProcedure('payroll.config.read')
    .query(async ({ ctx }) => {
      return getPayrollConfigService().listProductTierConfigs(ctx.activeGroupId);
    }),

  saveProductTierConfig: permissionProcedure('payroll.config.write')
    .input(saveProductTierConfigSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().saveProductTierConfig(input, ctx.user, ctx.activeGroupId);
    }),

  deleteProductTierConfig: permissionProcedure('payroll.config.write')
    .input(deleteProductTierConfigSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().deleteProductTierConfig(input, ctx.user, ctx.activeGroupId);
    }),

  listTaxBandConfigs: permissionProcedure('payroll.config.read')
    .query(async ({ ctx }) => {
      return getPayrollConfigService().listTaxBandConfigs(ctx.activeGroupId);
    }),

  saveTaxBandConfig: permissionProcedure('payroll.config.write')
    .input(saveTaxBandConfigSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().saveTaxBandConfig(input, ctx.user, ctx.activeGroupId);
    }),

  deleteTaxBandConfig: permissionProcedure('payroll.config.write')
    .input(deleteTaxBandConfigSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().deleteTaxBandConfig(input, ctx.user, ctx.activeGroupId);
    }),

  previewPaye: permissionProcedure('payroll.config.read')
    .input(previewPayeSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollConfigService().previewPaye(input, ctx.activeGroupId);
    }),

  listContractors: permissionProcedure('hr.read')
    .input(listContractorsSchema.optional())
    .query(async ({ input, ctx }) => {
      return getPayrollConfigService().listContractors(ctx.activeGroupId, {
        active: input?.active ?? true,
      });
    }),

  getContractor: permissionProcedure('hr.read')
    .input(getContractorSchema)
    .query(async ({ input, ctx }) => {
      return getPayrollConfigService().getContractor(input.id, ctx.activeGroupId);
    }),

  listContractorPayouts: permissionProcedure('hr.read')
    .input(listContractorPayoutsSchema)
    .query(async ({ input }) => {
      return getPayrollConfigService().listContractorPayouts(input);
    }),

  createContractor: permissionProcedure('payroll.config.write')
    .input(createContractorSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().createContractor(input, ctx.user, ctx.activeGroupId);
    }),

  updateContractor: permissionProcedure('payroll.config.write')
    .input(updateContractorSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().updateContractor(input, ctx.user, ctx.activeGroupId);
    }),

  listPayrollOnboardingQueue: permissionProcedure('hr.read')
    .query(async ({ ctx }) => {
      return getPayrollConfigService().listOnboardingQueue(ctx.effectiveBranchIds);
    }),

  approvePayrollOnboarding: permissionProcedure('hr.write')
    .input(payrollOnboardingActionSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().approvePayrollOnboarding(input.userId, ctx.user);
    }),

  rejectPayrollOnboarding: permissionProcedure('hr.write')
    .input(payrollOnboardingActionSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().rejectPayrollOnboarding(input.userId, ctx.user);
    }),

  updatePayrollProfile: permissionProcedure('hr.write')
    .input(updatePayrollProfileSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().updatePayrollProfile(input, ctx.user);
    }),

  /**
   * Self-serve payroll profile edit — any authenticated user may maintain their
   * OWN payroll declarations (pay role, salary basis, tax status, flat amount,
   * annual rent). The target is FORCED to the caller (never a client-supplied
   * userId), and the schema carries no role/permission/branch fields, so this
   * cannot escalate access. Reuses the same service write as the HR path.
   * Motivating case: an HR Manager setting their own annual rent for PAYE
   * relief, which the staff-edit form blocks ("Cannot edit your own account").
   */
  updateMyPayrollProfile: authedProcedure
    .input(updateMyPayrollProfileSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().updatePayrollProfile(
        { ...input, userId: ctx.user.id },
        ctx.user,
      );
    }),

  bulkAssignPayRole: permissionProcedure('hr.write')
    .input(bulkAssignPayRoleSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().bulkAssignPayRole(input, ctx.user);
    }),

  bulkAssignContractorsToPayRole: permissionProcedure('payroll.config.write')
    .input(bulkAssignContractorsToPayRoleSchema)
    .mutation(async ({ input, ctx }) => {
      return getPayrollConfigService().bulkAssignContractorsToPayRole(input, ctx.user, ctx.activeGroupId);
    }),

  /** Restamp assigned staff onto FORMULA_BASED so Earnings matches Payroll Config bases. */
  syncUsersToPayRoleBases: permissionProcedure('payroll.config.write')
    .mutation(async ({ ctx }) => {
      return getPayrollConfigService().syncUsersToPayRoleBases(ctx.user, ctx.activeGroupId);
    }),

  payrollPageBundle: authedProcedure
    .input(listMonthlyPayrollsSchema.optional())
    .query(async ({ input, ctx }) => {
      const filters = input ?? {};
      const [payrolls, adjustments, payRoles, contractors, prepareAccess, usersResult] = await Promise.all([
        getPayrollBatchService().listMonthlyPayrolls(filters, ctx.user, ctx.effectiveBranchIds),
        // Bundle keeps the first page as a plain array for back-compat; the
        // Adjustments tab uses the standalone listAdjustments query for search + paging.
        getHrService()
          .listAdjustments(undefined, ctx.effectiveBranchIds)
          .then((r) => r.items),
        getPayrollConfigService().listPayRoles(ctx.activeGroupId),
        getPayrollConfigService().listContractors(ctx.activeGroupId),
        getPayrollBatchService().getPrepareAccess(ctx.user),
        getUsersService().list(
          { page: 1, limit: 500, sortBy: 'name', sortOrder: 'asc' },
          ctx.user,
          ctx.user.currentBranchId ?? undefined,
          ctx.effectiveBranchIds,
        ),
      ]);
      return {
        payrolls,
        adjustments,
        payRoles,
        contractors,
        branches: prepareAccess.branches,
        users: usersResult.users,
      };
    }),

  // ============================================
  // User Detail Page Bundle
  // ============================================

  /**
   * Single-request bundle for `/hr/users/:id` page loader.
   *
   * Replaces ~20-30 HTTP round-trips across 6 resource routes (each of
   * which redundantly re-fetched `users.getById` for authorization) with
   * a single tRPC call. The target user is fetched once, then all
   * sub-slices are resolved in parallel via `Promise.all`.
   *
   * Authorization: `authedProcedure` — the procedure itself mirrors the
   * Remix loader gate (self-view, department-head on-branch, supervisor,
   * or `hr.read` / admin-level). Sub-slice gates (permissions,
   * push-status, marketing) are enforced inline so the bundle no-ops
   * slices the caller cannot access.
   */
  userDetailPageBundle: authedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const actor = ctx.user;
      const userId = input.userId;

      // ── 1. Fetch the target user (single DB hit) ──
      // Pass effectiveBranchIds so branchMemberships are company-scoped when a
      // company is selected in the header (SuperAdmin company switcher).
      const profileUser = await getUsersService().getById(
        userId,
        actor,
        ctx.effectiveBranchIds ?? undefined,
      );
      if (!profileUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      // ── 2. Authorization — mirrors Remix loader gate ──
      const isSelfView = actor.id === profileUser.id;
      const targetBranchIds = (profileUser.branchMemberships ?? []).map(
        (m: { branchId: string }) => m.branchId,
      );

      if (!isSelfView) {
        const canAccess = canAccessStaffHrUserDetail(
          {
            id: actor.id,
            role: actor.role,
            permissions: actor.permissions ?? [],
            branchIds: actor.branchIds ?? [],
            currentBranchId: actor.currentBranchId ?? null,
          },
          { id: profileUser.id, role: profileUser.role, branchIds: targetBranchIds },
        );
        if (!canAccess) {
          // Supervisor fallback — check if viewer supervises the target on any branch
          const isSupervisor = await getBranchTeamsService().isSupervisorOfUserAnywhere(
            actor.id,
            profileUser.id,
          );
          if (!isSupervisor) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Not allowed to view this user detail.',
            });
          }
        }
      }

      // ── 3. Derive flags ──
      const isAdminClass =
        actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN' || actor.role === 'SUPPORT';
      const isSuperAdminProfile = profileUser.role === 'SUPER_ADMIN';
      const isMarketingRole =
        profileUser.role === 'MEDIA_BUYER' || profileUser.role === 'HEAD_OF_MARKETING';
      // ADMIN (and SUPPORT) are real staff on payroll — HR must see and edit their
      // payroll/onboarding profile. Only SUPER_ADMIN (system owner, never on payroll)
      // has the onboarding tab hidden.
      const showOnboardingTab = !isSuperAdminOnly({ role: profileUser.role });

      // ── 4. Parallel fan-out for all sub-slices ──
      const db = getPermissionsDb();
      const teams = getBranchTeamsService();

      const [
        products,
        roleTemplatesResult,
        locations,
        plans,
        pendingEmailChange,
        pushStatus,
        onboardingResult,
        permissionsResult,
        marketingResult,
        mirrorResult,
        supervisorOfUserResult,
      ] = await Promise.all([
        // (a) Active products for product-access dropdown
        getProductsService().listOptions(
          { status: 'ACTIVE' },
          actor.id,
          actor.role,
          ctx.activeGroupId,
        ),

        // (b) Role templates for dropdown
        (async () => {
          try {
            return await getRoleTemplatesService().listTemplates(actor);
          } catch {
            return { templates: [] };
          }
        })(),

        // (c) Logistics locations for dropdown
        getLogisticsService().listLocationOptions({
          status: 'ACTIVE',
          groupId: ctx.activeGroupId,
        }),

        // (d) Commission plans for dropdown
        getHrService().listCommissionPlans(
          { page: 1, limit: 200, activeOnly: true },
          actor,
          ctx.activeGroupId,
        ),

        // (e) Pending email change
        (async () => {
          try {
            return await getUsersService().getPendingEmailChangeForUser(userId);
          } catch {
            return null;
          }
        })(),

        // (f) Push status (admin/support only)
        (async () => {
          if (!isAdminClass) return null;
          try {
            return await getNotificationsService().getPushStatusForUser(userId);
          } catch {
            return null;
          }
        })(),

        // (g) Onboarding summary
        (async () => {
          if (!showOnboardingTab) return null;
          try {
            return await getOnboardingService().getForUser(userId, actor, ctx.effectiveBranchIds);
          } catch (err: unknown) {
            const trpcErr = err as { code?: string };
            if (trpcErr?.code === 'FORBIDDEN') {
              return { _forbidden: true as const };
            }
            return { _error: true as const };
          }
        })(),

        // (h) Permissions (catalog + template baselines + user matrix)
        (async () => {
          if (isSuperAdminProfile) {
            return {
              permissionCatalog: { items: [] as Array<{ code: string; resource: string; action: string; description: string | null; legacyAliases: string[] }>, requestFailed: false },
              templatePermissionsById: {} as Record<string, string[]>,
              userStampPreview: {
                userOverrides: {} as Record<string, boolean>,
                templateCodes: [] as string[],
                effectiveCodes: [] as string[],
              },
            };
          }

          const canViewMatrix = actorMayViewUserPermissionMatrix(actor, userId);

          const [catalogRows, baselinesResult, matrixResult] = await Promise.all([
            // listCatalog
            db
              .select({
                code: schema.permissions.code,
                resource: schema.permissions.resource,
                action: schema.permissions.action,
                description: schema.permissions.description,
              })
              .from(schema.permissions)
              .where(isNull(schema.permissions.validTo))
              .orderBy(asc(schema.permissions.code)),

            // listTemplateBaselines (skip for self-view)
            isSelfView
              ? Promise.resolve({ byTemplateId: {} as Record<string, string[]> })
              : (async () => {
                  const tplRows = await db
                    .select({
                      templateId: schema.roleTemplatePermissions.roleTemplateId,
                      code: schema.permissions.code,
                    })
                    .from(schema.roleTemplatePermissions)
                    .innerJoin(
                      schema.permissions,
                      eq(schema.roleTemplatePermissions.permissionId, schema.permissions.id),
                    )
                    .where(
                      and(
                        isNull(schema.roleTemplatePermissions.validTo),
                        isNull(schema.permissions.validTo),
                      ),
                    );
                  const byTemplateId = tplRows.reduce<Record<string, string[]>>((acc, row) => {
                    const bucket = acc[row.templateId] ?? [];
                    bucket.push(canonicalPermissionCode(row.code));
                    acc[row.templateId] = bucket;
                    return acc;
                  }, {});
                  return { byTemplateId };
                })(),

            // getUserMatrix (stamp_preview)
            canViewMatrix
              ? (async () => {
                  const [user] = await db
                    .select({
                      id: schema.users.id,
                      role: schema.users.role,
                      roleTemplateId: schema.users.roleTemplateId,
                    })
                    .from(schema.users)
                    .where(eq(schema.users.id, userId))
                    .limit(1);
                  if (!user) {
                    return {
                      userOverrides: {} as Record<string, boolean>,
                      templateCodes: [] as string[],
                      effectiveCodes: [] as string[],
                    };
                  }
                  const overrideRows = await db
                    .select({
                      code: schema.permissions.code,
                      granted: schema.userPermissions.granted,
                    })
                    .from(schema.userPermissions)
                    .innerJoin(
                      schema.permissions,
                      eq(schema.userPermissions.permissionId, schema.permissions.id),
                    )
                    .where(
                      and(
                        eq(schema.userPermissions.userId, userId),
                        isNull(schema.userPermissions.validTo),
                      ),
                    );
                  let templateId: string | null = user.roleTemplateId;
                  if (!templateId && user.role) {
                    const [fallback] = await db
                      .select({ id: schema.roleTemplates.id })
                      .from(schema.roleTemplates)
                      .where(
                        and(
                          eq(schema.roleTemplates.mappedRole, user.role),
                          eq(schema.roleTemplates.kind, 'SYSTEM'),
                          isNull(schema.roleTemplates.validTo),
                        ),
                      )
                      .limit(1);
                    templateId = fallback?.id ?? null;
                  }
                  const templateCodesCanon = await resolveRoleTemplateBaselineCodes(
                    db,
                    templateId,
                    user.role ?? '',
                  );
                  const templateSet = new Set(templateCodesCanon);
                  const userOverrides: Record<string, boolean> = {};
                  for (const row of overrideRows) {
                    const code = canonicalPermissionCode(row.code);
                    const inTpl = templateSet.has(code);
                    if (row.granted) {
                      if (!inTpl) userOverrides[code] = true;
                    } else if (inTpl) {
                      userOverrides[code] = false;
                    }
                  }
                  const legacyUnion = await computeEffectivePermissionsLegacyUnion(db, userId);
                  const effectiveCodes = [
                    ...new Set([...legacyUnion].map((c) => canonicalPermissionCode(c))),
                  ].sort((a, b) => a.localeCompare(b));
                  return { userOverrides, templateCodes: templateCodesCanon, effectiveCodes };
                })()
              : Promise.resolve({
                  userOverrides: {} as Record<string, boolean>,
                  templateCodes: [] as string[],
                  effectiveCodes: [] as string[],
                }),
          ]);

          const items = catalogRows.map((row) => {
            const code = canonicalPermissionCode(row.code);
            return { ...row, code, legacyAliases: legacyAliasesForCanonical(code) };
          });

          return {
            permissionCatalog: { items, requestFailed: false },
            templatePermissionsById: baselinesResult.byTemplateId,
            userStampPreview: matrixResult,
          };
        })(),

        // (i) Marketing metrics + funding balance (MB / HoM only)
        (async () => {
          if (!isMarketingRole) {
            return { marketingMetrics: null, fundingBalance: null };
          }
          try {
            const [metrics, funding] = await Promise.all([
              getMarketingService().getPerformanceMetrics(
                userId,
                'all_time',
                undefined,
                undefined,
                ctx.currentBranchId,
                undefined,
                undefined,
                ctx.effectiveBranchIds,
              ),
              getMarketingService().getFundingBalanceWithAuth(
                userId,
                actor,
                ctx.currentBranchId,
                ctx.effectiveBranchIds,
              ),
            ]);
            return { marketingMetrics: metrics, fundingBalance: funding };
          } catch {
            return { marketingMetrics: null, fundingBalance: null };
          }
        })(),

        // (j) Mirror eligibility
        (async () => {
          try {
            const [target] = await db
              .select({
                id: schema.users.id,
                role: schema.users.role,
                primaryBranchId: schema.users.primaryBranchId,
                status: schema.users.status,
              })
              .from(schema.users)
              .where(eq(schema.users.id, userId))
              .limit(1);
            if (!target || target.status !== 'ACTIVE') {
              return { allowed: false, previewEligible: false, nestedMirrorSession: false };
            }
            const mirrorActor = {
              id: actor.id,
              role: actor.role,
              permissions: actor.permissions ?? [],
              currentBranchId: actor.currentBranchId ?? null,
              mirroredBy: actor.mirroredBy ?? null,
            };
            const targetPayload = {
              id: target.id,
              role: target.role,
              primaryBranchId: target.primaryBranchId,
            };
            const viaSupervision = await teams.actorCanMirrorViaSupervision(mirrorActor, {
              id: target.id,
              role: target.role,
            });
            const previewEligible =
              canMirror({ ...mirrorActor, mirroredBy: null }, targetPayload) || viaSupervision;
            const nestedMirrorSession = !!mirrorActor.mirroredBy;
            if (!previewEligible) {
              return { allowed: false, previewEligible: false, nestedMirrorSession };
            }
            if (nestedMirrorSession) {
              return { allowed: false, previewEligible: true, nestedMirrorSession: true };
            }
            return { allowed: true, previewEligible: true, nestedMirrorSession: false };
          } catch {
            return { allowed: false, previewEligible: false, nestedMirrorSession: false };
          }
        })(),

        // (k) Supervisor-of-user check (for non-self, non-head, non-admin)
        (async () => {
          if (isSelfView) return false;
          try {
            return await teams.isSupervisorOfUserAnywhere(actor.id, profileUser.id);
          } catch {
            return false;
          }
        })(),
      ]);

      // ── 5. Shape the response ──

      // Onboarding
      let onboardingSummary: unknown = null;
      if (onboardingResult) {
        if ('_forbidden' in onboardingResult) {
          onboardingSummary = { ok: false, reason: 'forbidden' };
        } else if ('_error' in onboardingResult) {
          onboardingSummary = { ok: false, reason: 'error' };
        } else {
          onboardingSummary = {
            ok: true,
            status: (onboardingResult as { status?: string }).status ?? 'NOT_STARTED',
            submittedAt: (onboardingResult as { submittedAt?: string | null }).submittedAt ?? null,
            approvedAt: (onboardingResult as { approvedAt?: string | null }).approvedAt ?? null,
          };
        }
      }

      return {
        user: profileUser,
        isSelfView,
        isSupervisorOfUser: supervisorOfUserResult,

        // Core overview slice (replaces api.hr-user-detail-overview-core)
        products,
        roleTemplates: roleTemplatesResult.templates ?? [],
        locations,
        plans: (plans as { plans?: unknown[] })?.plans ?? plans,
        pendingEmailChange,
        pushStatus,

        // Onboarding slice (replaces api.hr-user-detail-onboarding)
        onboardingSummary,

        // Permissions slice (replaces api.hr-user-detail-permissions)
        permissionCatalog: permissionsResult.permissionCatalog,
        templatePermissionsById: permissionsResult.templatePermissionsById,
        userStampPreview: permissionsResult.userStampPreview,

        // Marketing slice (replaces api.hr-user-detail-marketing)
        marketingMetrics: marketingResult.marketingMetrics,
        fundingBalance: marketingResult.fundingBalance,

        // Mirror eligibility (replaces branches.canMirrorToUser)
        mirrorEligibility: mirrorResult,
      };
    }),
});
