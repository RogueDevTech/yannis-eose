import { and, desc, eq, gte, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';

type DbClient = PostgresJsDatabase<typeof schema>;

/**
 * True when a plan's effective window intersects [rangeStart, rangeEnd] (inclusive window,
 * same convention as payroll period bounds).
 */
function planCoversPeriod(
  effectiveFrom: Date,
  effectiveTo: Date | null,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  if (effectiveFrom > rangeEnd) return false;
  if (effectiveTo != null && effectiveTo < rangeStart) return false;
  return true;
}

/**
 * Commission resolution order:
 * 1. Explicit `users.commission_plan_id` when set and overlaps the payroll range.
 * 2. Else the latest matching plan where `role = staff.role` (role-scoped defaults only —
 * plans with NULL role never apply here).
 */
export async function resolveApplicableCommissionPlan(
  tx: DbClient,
  input: {
    commissionPlanId: string | null;
    staffRole: string;
    rangeStart: Date;
    rangeEnd: Date;
  },
): Promise<typeof schema.commissionPlans.$inferSelect | null> {
  const { commissionPlanId, staffRole, rangeStart, rangeEnd } = input;

  if (commissionPlanId) {
    const direct = await tx
      .select()
      .from(schema.commissionPlans)
      .where(eq(schema.commissionPlans.id, commissionPlanId))
      .limit(1);
    const p = direct[0];
    if (p && planCoversPeriod(p.effectiveFrom, p.effectiveTo ?? null, rangeStart, rangeEnd)) {
      return p;
    }
  }

  const roleRows = await tx
    .select()
    .from(schema.commissionPlans)
    .where(
      and(
        isNotNull(schema.commissionPlans.role),
        eq(
          schema.commissionPlans.role,
          staffRole as NonNullable<(typeof schema.commissionPlans.$inferSelect)['role']>,
        ),
        lte(schema.commissionPlans.effectiveFrom, rangeEnd),
        or(isNull(schema.commissionPlans.effectiveTo), gte(schema.commissionPlans.effectiveTo, rangeStart)),
      ),
    )
    .orderBy(desc(schema.commissionPlans.effectiveFrom))
    .limit(1);

  return roleRows[0] ?? null;
}
