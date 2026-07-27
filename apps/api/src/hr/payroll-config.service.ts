import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, inArray, isNotNull, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { uuidv7 } from 'uuidv7';
import {
  db as schema,
  computePaye,
  computePayrollFormula,
  defaultPayeBandConfig,
  type CreateContractorInput,
  type CreatePayRoleInput,
  type ListContractorPayoutsInput,
  type PayrollFormula,
  type PayrollMetrics,
  type SaveProductTierConfigInput,
  type SaveTaxBandConfigInput,
  type UpdateContractorInput,
  type UpdatePayRoleInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';

/** Exact company match only. No null/global shared rows across companies. */
function companyEq(column: AnyColumn, groupId?: string | null): SQL | undefined {
  if (!groupId) return sql`false`;
  return eq(column, groupId);
}

function requireCompanyId(groupId?: string | null): string {
  if (!groupId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select a company before managing payroll config. Config is fully company-isolated.',
    });
  }
  return groupId;
}

@Injectable()
export class PayrollConfigService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async listPayRoles(groupId?: string | null) {
    const rows = await this.db
      .select()
      .from(schema.payrollPayRoles)
      .where(
        and(
          eq(schema.payrollPayRoles.active, true),
          companyEq(schema.payrollPayRoles.groupId, groupId),
        ),
      )
      .orderBy(schema.payrollPayRoles.name);

    // Count staff assigned to each pay role
    const staffCounts = await this.db
      .select({
        payRoleId: schema.users.payRoleId,
        count: count(),
      })
      .from(schema.users)
      .where(
        and(
          isNotNull(schema.users.payRoleId),
          eq(schema.users.status, 'ACTIVE'),
        ),
      )
      .groupBy(schema.users.payRoleId);

    const countMap = new Map(staffCounts.map((r) => [r.payRoleId, Number(r.count)]));
    return rows.map((r) => ({ ...r, staffCount: countMap.get(r.id) ?? 0 }));
  }

  async createPayRole(input: CreatePayRoleInput, actor: SessionUser, groupId?: string | null) {
    const companyId = requireCompanyId(groupId);
    return withActor(this.db, actor, async (tx) => {
      const id = uuidv7();
      const [row] = await tx
        .insert(schema.payrollPayRoles)
        .values({
          id,
          groupId: companyId,
          name: input.name,
          category: input.category,
          reportsToRequired: input.reportsToRequired,
          perProductBonus: input.perProductBonus,
          commissionPlanId: input.commissionPlanId ?? null,
        })
        .returning();
      return row;
    });
  }

  async updatePayRole(input: UpdatePayRoleInput, actor: SessionUser, groupId?: string | null) {
    const companyId = requireCompanyId(groupId);
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.payrollPayRoles)
        .set({
          ...(input.name != null ? { name: input.name } : {}),
          ...(input.category != null ? { category: input.category } : {}),
          ...(input.reportsToRequired != null ? { reportsToRequired: input.reportsToRequired } : {}),
          ...(input.perProductBonus != null ? { perProductBonus: input.perProductBonus } : {}),
          ...(input.commissionPlanId != null ? { commissionPlanId: input.commissionPlanId } : {}),
          ...(input.active != null ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.payrollPayRoles.id, input.id),
            eq(schema.payrollPayRoles.groupId, companyId),
          ),
        )
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pay role not found in this company' });
      return row;
    });
  }

  async archivePayRole(id: string, actor: SessionUser, groupId?: string | null) {
    return this.updatePayRole({ id, active: false }, actor, groupId);
  }

  /**
   * Load a pay role and its currently linked commission-plan formula in one
   * shot. Prefer this over listPlans + find — listPlans is paginated/scoped and
   * can miss the linked plan, which made Edit formula look empty ("Formula
   * linked" on the list but blank tiers on the editor).
   */
  async getPayRoleWithFormula(payRoleId: string, groupId?: string | null) {
    const companyId = requireCompanyId(groupId);
    const [payRole] = await this.db
      .select()
      .from(schema.payrollPayRoles)
      .where(
        and(
          eq(schema.payrollPayRoles.id, payRoleId),
          eq(schema.payrollPayRoles.groupId, companyId),
        ),
      )
      .limit(1);
    if (!payRole) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Pay role not found in this company' });
    }

    let plan: typeof schema.commissionPlans.$inferSelect | null = null;
    if (payRole.commissionPlanId) {
      const [linked] = await this.db
        .select()
        .from(schema.commissionPlans)
        .where(eq(schema.commissionPlans.id, payRole.commissionPlanId))
        .limit(1);
      plan = linked ?? null;
    }

    return { payRole, plan };
  }

  async saveFormulaConfig(
    input: {
      payRoleId: string;
      planName?: string;
      effectiveFrom: string;
      formula: PayrollFormula;
    },
    actor: SessionUser,
    groupId?: string | null,
  ) {
    const companyId = requireCompanyId(groupId);
    return withActor(this.db, actor, async (tx) => {
      const payRoleRows = await tx
        .select()
        .from(schema.payrollPayRoles)
        .where(
          and(
            eq(schema.payrollPayRoles.id, input.payRoleId),
            eq(schema.payrollPayRoles.groupId, companyId),
          ),
        )
        .limit(1);
      const payRole = payRoleRows[0];
      if (!payRole) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pay role not found in this company' });

      if (payRole.commissionPlanId) {
        await tx
          .update(schema.commissionPlans)
          .set({ effectiveTo: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(schema.commissionPlans.id, payRole.commissionPlanId),
              isNull(schema.commissionPlans.effectiveTo),
            ),
          );
      }

      const planId = uuidv7();
      const [plan] = await tx
        .insert(schema.commissionPlans)
        .values({
          id: planId,
          groupId: companyId,
          role: null,
          planName: input.planName ?? `${payRole.name} Formula`,
          rules: { ...input.formula, schemaVersion: 'payroll_v1' as const },
          effectiveFrom: new Date(input.effectiveFrom),
          payRoleId: payRole.id,
          createdBy: actor.id,
        })
        .returning();

      const [updatedRole] = await tx
        .update(schema.payrollPayRoles)
        .set({ commissionPlanId: planId, updatedAt: new Date() })
        .where(eq(schema.payrollPayRoles.id, payRole.id))
        .returning();

      return { plan, payRole: updatedRole };
    });
  }

  previewPayrollFormula(input: { formula: PayrollFormula; metrics: PayrollMetrics }) {
    const result = computePayrollFormula(input.formula, input.metrics, []);
    const paye = computePaye(
      {
        monthlyGross: result.grossBeforeAdjustments,
        taxStatus: 'STANDARD_PAYE',
        employerSubsidyPercent: result.employerPayeSubsidyPercent,
      },
      defaultPayeBandConfig(),
    );
    return { formulaResult: result, payePreview: paye };
  }

  async listProductTierConfigs(groupId?: string | null) {
    return this.db
      .select()
      .from(schema.payrollProductTierConfigs)
      .where(companyEq(schema.payrollProductTierConfigs.groupId, groupId))
      .orderBy(desc(schema.payrollProductTierConfigs.effectiveFrom));
  }

  async saveProductTierConfig(input: SaveProductTierConfigInput, actor: SessionUser, groupId?: string | null) {
    const companyId = requireCompanyId(groupId);
    return withActor(this.db, actor, async (tx) => {
      if (input.id) {
        await tx
          .update(schema.payrollProductTierConfigs)
          .set({ effectiveTo: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(schema.payrollProductTierConfigs.id, input.id),
              eq(schema.payrollProductTierConfigs.groupId, companyId),
            ),
          );
      }
      const [row] = await tx
        .insert(schema.payrollProductTierConfigs)
        .values({
          id: uuidv7(),
          groupId: companyId,
          productId: input.productId ?? null,
          productName: input.productName,
          branchIds: input.branchIds ?? null,
          active: input.active,
          tierRows: input.tierRows,
          effectiveFrom: new Date(input.effectiveFrom),
          createdBy: actor.id,
        })
        .returning();
      return row;
    });
  }

  async listTaxBandConfigs(groupId?: string | null) {
    return this.db
      .select()
      .from(schema.payrollTaxBandConfigs)
      .where(companyEq(schema.payrollTaxBandConfigs.groupId, groupId))
      .orderBy(desc(schema.payrollTaxBandConfigs.effectiveFrom));
  }

  async saveTaxBandConfig(input: SaveTaxBandConfigInput, actor: SessionUser, groupId?: string | null) {
    const companyId = requireCompanyId(groupId);
    return withActor(this.db, actor, async (tx) => {
      if (input.id) {
        await tx
          .update(schema.payrollTaxBandConfigs)
          .set({ effectiveTo: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(schema.payrollTaxBandConfigs.id, input.id),
              eq(schema.payrollTaxBandConfigs.groupId, companyId),
            ),
          );
      }
      const [row] = await tx
        .insert(schema.payrollTaxBandConfigs)
        .values({
          id: uuidv7(),
          groupId: companyId,
          label: input.label,
          taxFreeThreshold: sql`${input.taxFreeThreshold}::numeric`,
          bands: input.bands,
          reliefs: input.reliefs,
          effectiveFrom: new Date(input.effectiveFrom),
          createdBy: actor.id,
        })
        .returning();
      return row;
    });
  }

  previewPaye(input: { monthlyGross: number; taxStatus: string; employerSubsidyPercent?: number }) {
    const config = defaultPayeBandConfig();
    return computePaye(
      {
        monthlyGross: input.monthlyGross,
        taxStatus: input.taxStatus as 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION',
        employerSubsidyPercent: input.employerSubsidyPercent,
      },
      config,
    );
  }

  async listContractors(groupId?: string | null) {
    return this.db
      .select()
      .from(schema.payrollContractors)
      .where(
        and(
          eq(schema.payrollContractors.active, true),
          companyEq(schema.payrollContractors.groupId, groupId),
        ),
      )
      .orderBy(schema.payrollContractors.name);
  }

  async getContractor(id: string, groupId?: string | null) {
    const rows = await this.db
      .select()
      .from(schema.payrollContractors)
      .where(
        and(
          eq(schema.payrollContractors.id, id),
          companyEq(schema.payrollContractors.groupId, groupId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contractor not found in this company' });
    return row;
  }

  async listContractorPayouts(input: ListContractorPayoutsInput) {
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    const offset = (page - 1) * limit;
    const where = eq(schema.payoutRecords.contractorId, input.contractorId);

    const [rows, countResult] = await Promise.all([
      this.db
        .select({
          payout: schema.payoutRecords,
          batch: schema.payrollBatches,
          branchName: schema.branches.name,
        })
        .from(schema.payoutRecords)
        .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
        .innerJoin(schema.branches, eq(schema.branches.id, schema.payrollBatches.branchId))
        .where(where)
        .orderBy(desc(schema.payrollBatches.periodMonth))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.payoutRecords)
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({
        payoutId: row.payout.id,
        batchId: row.batch.id,
        periodMonth: row.batch.periodMonth,
        department: row.batch.department,
        branchId: row.batch.branchId,
        branchName: row.branchName,
        batchStatus: row.batch.status,
        payoutStatus: row.payout.status,
        monthlyFee: row.payout.baseSalary,
        grossPay: row.payout.grossPay,
        netPay: row.payout.netPay,
        totalPayout: row.payout.totalPayout,
        financeReference: row.batch.financeReference,
        disbursementDate: row.batch.disbursementDate,
        financeProcessedAt: row.batch.financeProcessedAt,
        createdAt: row.payout.createdAt,
      })),
      page,
      limit,
      total: countResult[0]?.count ?? 0,
    };
  }

  async createContractor(input: CreateContractorInput, actor: SessionUser, groupId?: string | null) {
    const companyId = requireCompanyId(groupId);
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .insert(schema.payrollContractors)
        .values({
          id: uuidv7(),
          groupId: companyId,
          name: input.name,
          jobTitle: input.jobTitle ?? null,
          branchId: input.branchId ?? null,
          monthlyFee: sql`${input.monthlyFee}::numeric`,
          bankName: input.bankName ?? null,
          bankCode: input.bankCode ?? null,
          accountNumber: input.accountNumber ?? null,
          accountName: input.accountName ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    });
  }

  async updateContractor(input: UpdateContractorInput, actor: SessionUser, groupId?: string | null) {
    const companyId = requireCompanyId(groupId);
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.payrollContractors)
        .set({
          ...(input.name != null ? { name: input.name } : {}),
          ...(input.jobTitle != null ? { jobTitle: input.jobTitle } : {}),
          ...(input.branchId != null ? { branchId: input.branchId } : {}),
          ...(input.monthlyFee != null ? { monthlyFee: sql`${input.monthlyFee}::numeric` } : {}),
          ...(input.bankName != null ? { bankName: input.bankName } : {}),
          ...(input.bankCode != null ? { bankCode: input.bankCode } : {}),
          ...(input.accountNumber != null ? { accountNumber: input.accountNumber } : {}),
          ...(input.accountName != null ? { accountName: input.accountName } : {}),
          ...(input.notes != null ? { notes: input.notes } : {}),
          ...(input.active != null ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.payrollContractors.id, input.id),
            eq(schema.payrollContractors.groupId, companyId),
          ),
        )
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contractor not found in this company' });
      return row;
    });
  }

  async listOnboardingQueue(effectiveBranchIds?: string[] | null) {
    const rows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        primaryBranchId: schema.users.primaryBranchId,
        onboardingPayrollStatus: schema.users.onboardingPayrollStatus,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.onboardingPayrollStatus, 'PENDING_APPROVAL'))
      .orderBy(desc(schema.users.createdAt));

    if (effectiveBranchIds?.length) {
      return rows.filter((r) => r.primaryBranchId && effectiveBranchIds.includes(r.primaryBranchId));
    }
    return rows;
  }

  async approvePayrollOnboarding(userId: string, actor: SessionUser) {
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.users)
        .set({ onboardingPayrollStatus: 'ACTIVE', updatedAt: new Date() })
        .where(and(eq(schema.users.id, userId), eq(schema.users.onboardingPayrollStatus, 'PENDING_APPROVAL')))
        .returning({ id: schema.users.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not in onboarding queue' });
      return row;
    });
  }

  async rejectPayrollOnboarding(userId: string, actor: SessionUser) {
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.users)
        .set({ onboardingPayrollStatus: 'NOT_APPLICABLE', updatedAt: new Date() })
        .where(and(eq(schema.users.id, userId), eq(schema.users.onboardingPayrollStatus, 'PENDING_APPROVAL')))
        .returning({ id: schema.users.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not in onboarding queue' });
      return row;
    });
  }

  async updatePayrollProfile(
    input: {
      userId: string;
      payRoleId?: string | null;
      employmentType?: string;
      salaryBasis?: string;
      taxStatus?: string;
      reportsToUserId?: string | null;
      crmLinked?: boolean;
      flatMonthlyAmount?: number;
    },
    actor: SessionUser,
  ) {
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.users)
        .set({
          ...(input.payRoleId !== undefined ? { payRoleId: input.payRoleId } : {}),
          ...(input.employmentType != null ? { employmentType: input.employmentType as typeof schema.users.$inferInsert.employmentType } : {}),
          ...(input.salaryBasis != null ? { salaryBasis: input.salaryBasis as typeof schema.users.$inferInsert.salaryBasis } : {}),
          ...(input.taxStatus != null ? { taxStatus: input.taxStatus as typeof schema.users.$inferInsert.taxStatus } : {}),
          ...(input.flatMonthlyAmount != null ? { flatMonthlyAmount: sql`${input.flatMonthlyAmount}::numeric` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, input.userId))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      return row;
    });
  }

  async bulkAssignPayRole(
    input: {
      userIds: string[];
      payRoleId: string;
      employmentType: string;
      salaryBasis: string;
      taxStatus: string;
      crmLinked: boolean;
    },
    actor: SessionUser,
  ) {
    // Verify pay role exists
    const [payRole] = await this.db
      .select({ id: schema.payrollPayRoles.id })
      .from(schema.payrollPayRoles)
      .where(eq(schema.payrollPayRoles.id, input.payRoleId))
      .limit(1);
    if (!payRole) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pay role not found' });

    return withActor(this.db, actor, async (tx) => {
      const rows = await tx
        .update(schema.users)
        .set({
          payRoleId: input.payRoleId,
          employmentType: input.employmentType as typeof schema.users.$inferInsert.employmentType,
          salaryBasis: input.salaryBasis as typeof schema.users.$inferInsert.salaryBasis,
          taxStatus: input.taxStatus as typeof schema.users.$inferInsert.taxStatus,
          crmLinked: input.crmLinked,
          updatedAt: new Date(),
        })
        .where(inArray(schema.users.id, input.userIds))
        .returning({ id: schema.users.id });
      return { assignedCount: rows.length };
    });
  }
}
