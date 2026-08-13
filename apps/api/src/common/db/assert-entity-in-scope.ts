/**
 * Per-entity company-group isolation guard.
 *
 * Companion to `branchScopeCondition` (which scopes LIST queries). This guards
 * SINGLE-ENTITY operations (getById / update / delete) that take a raw client-
 * supplied id: after resolving the target row's branch, assert that branch is
 * inside the caller's active company (`effectiveBranchIds`). Without this, an
 * org-wide-scoped user in Company A can read/mutate Company B's entity by id.
 *
 * Semantics mirror `branchScopeCondition`:
 *  - `effectiveBranchIds == null`  → org-wide (SuperAdmin / no company selected) → allow.
 *  - `effectiveBranchIds` non-empty → the entity's branch MUST be in the set.
 *  - `effectiveBranchIds` empty []  → company selected but unresolved → deny (match-nothing).
 *
 * A `null`/`undefined` entity branch is treated as in-scope ONLY for org-wide
 * callers; a scoped caller cannot reach branchless rows (matches the LIST rule
 * where branchless rows only surface via the NULL-include for the caller's own
 * company — for a hard per-entity gate we err on the side of denying).
 */
import { TRPCError } from '@trpc/server';

export interface EntityScopeOptions {
  /** Error message when the entity is out of the caller's company. */
  message?: string;
  /**
   * When true (default), a branchless entity (`entityBranchId == null`) is
   * allowed for org-wide callers but denied for scoped callers. When false,
   * a branchless entity is allowed for everyone (use for rows that legitimately
   * have no branch and are globally shared).
   */
  denyBranchlessWhenScoped?: boolean;
}

/**
 * Returns true when the entity's branch is inside the caller's active company.
 * Does not throw — use `assertEntityInScope` for the throwing variant.
 */
export function isEntityInScope(
  entityBranchId: string | null | undefined,
  effectiveBranchIds: string[] | null | undefined,
  opts: EntityScopeOptions = {},
): boolean {
  // Org-wide caller (SuperAdmin / no company) → always allowed.
  if (effectiveBranchIds == null) return true;

  // Company selected but branch set unresolved (stale session) → deny.
  if (effectiveBranchIds.length === 0) return false;

  const denyBranchless = opts.denyBranchlessWhenScoped ?? true;
  if (entityBranchId == null) return !denyBranchless;

  return effectiveBranchIds.includes(entityBranchId);
}

/**
 * Throws TRPCError('FORBIDDEN') when the entity's branch is outside the caller's
 * active company. No-op for org-wide callers. Call after resolving the target
 * row's branch and before reading/mutating it.
 */
export function assertEntityInScope(
  entityBranchId: string | null | undefined,
  effectiveBranchIds: string[] | null | undefined,
  opts: EntityScopeOptions = {},
): void {
  if (!isEntityInScope(entityBranchId, effectiveBranchIds, opts)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: opts.message ?? 'This record is not in your company.',
    });
  }
}

/**
 * Company-group variant: guard a single-entity op whose row carries a `groupId`
 * (company) column directly (finance / GL / accounting entities). The caller's
 * `activeGroupId` is already resolved (null → org-wide / SuperAdmin bypass).
 * When set, the row's `groupId` MUST match. Mirrors the inline check in
 * `GeneralLedgerService.approveJournalEntry`.
 */
export function assertGroupInScope(
  rowGroupId: string | null | undefined,
  activeGroupId: string | null | undefined,
  opts: EntityScopeOptions = {},
): void {
  if (activeGroupId == null) return; // org-wide (SuperAdmin / Support)
  if (rowGroupId !== activeGroupId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: opts.message ?? 'This record is outside your active company.',
    });
  }
}

/**
 * Multi-branch variant: the entity is in scope if ANY of its candidate branch
 * ids (e.g. an order's marketing `branch_id` OR fulfillment `servicing_branch_id`)
 * is inside the caller's company. Org-wide callers always pass.
 */
export function assertEntityInScopeAny(
  candidateBranchIds: Array<string | null | undefined>,
  effectiveBranchIds: string[] | null | undefined,
  opts: EntityScopeOptions = {},
): void {
  if (effectiveBranchIds == null) return;
  const ok = candidateBranchIds.some((b) => isEntityInScope(b, effectiveBranchIds, opts));
  if (!ok) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: opts.message ?? 'This record is not in your company.',
    });
  }
}
