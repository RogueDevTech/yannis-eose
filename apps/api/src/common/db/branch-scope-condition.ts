/**
 * Shared SQL condition builder for branch-scoped queries.
 *
 * Replaces the fragile `if (branchId) conditions.push(eq(col, branchId))`
 * pattern that treated `null` as "show everything". Now `null` only means
 * "unfiltered" for global users; branch-scoped users get an `IN (…)` guard
 * over their assigned branches via `effectiveBranchIds`.
 *
 * Usage in a service method:
 * ```ts
 * const cond = branchScopeCondition(schema.orders.servicingBranchId, scope);
 * if (cond) conditions.push(cond);
 * ```
 */
import { eq, inArray, type SQL, type Column } from 'drizzle-orm';

/**
 * Branch scope context — passed from routers to services as a single object.
 * Routers build this from `ctx.currentBranchId` + `ctx.effectiveBranchIds`.
 */
export interface BranchScope {
  /** The specific branch the user selected, or null for "All branches". */
  branchId: string | null;
  /**
   * When branchId is null: the concrete set of branches the user can see.
   * null = truly global (SuperAdmin etc.), string[] = branch-scoped user's
   * assigned branches.
   */
  effectiveBranchIds: string[] | null;
}

/**
 * Build a branch-scope SQL condition.
 *
 * Overload 1: pass a BranchScope object (preferred — routers build this from ctx).
 * Overload 2: pass branchId + effectiveBranchIds separately (for gradual migration).
 *
 * @returns A SQL condition to push into the WHERE clause, or `null` when no
 *          branch filter is required (global user with "All branches").
 */
export function branchScopeCondition(
  column: Column,
  scope: BranchScope,
): SQL | null;
export function branchScopeCondition(
  column: Column,
  branchId: string | null | undefined,
  effectiveBranchIds?: string[] | null | undefined,
): SQL | null;
export function branchScopeCondition(
  column: Column,
  branchIdOrScope: string | null | undefined | BranchScope,
  effectiveBranchIds?: string[] | null | undefined,
): SQL | null {
  let branchId: string | null | undefined;
  let eIds: string[] | null | undefined;

  if (branchIdOrScope && typeof branchIdOrScope === 'object') {
    branchId = branchIdOrScope.branchId;
    eIds = branchIdOrScope.effectiveBranchIds;
  } else {
    branchId = branchIdOrScope;
    eIds = effectiveBranchIds;
  }

  // Specific branch selected → exact match
  if (branchId) return eq(column, branchId);

  // "All branches" for a non-global user → IN their assigned branches
  if (eIds && eIds.length > 0) {
    return eIds.length === 1
      ? eq(column, eIds[0]!)
      : inArray(column, eIds);
  }

  // Global user or no branch context → no filter
  return null;
}
