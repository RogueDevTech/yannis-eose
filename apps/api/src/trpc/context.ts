import type { Request, Response } from 'express';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { canViewAllBranches } from '../common/authz';

/**
 * tRPC context — created for every request.
 * Contains the authenticated user (if any) and raw req/res.
 */
export interface TrpcContext {
  user: SessionUser | null;
  req: Request;
  res: Response;
  /** Raw session token — needed by procedures that mutate session (e.g. switchBranch). */
  sessionToken: string | null;
  /**
   * The active branch ID for this request, derived from the session.
   * NULL means the user has global visibility (SuperAdmin, all-branches mode).
   * Used by service methods that need explicit branch filtering on reads.
   */
  currentBranchId: string | null;
  /**
   * The concrete set of branch IDs this user is allowed to see when
   * `currentBranchId` is null ("All branches" view).
   *
   * - Global users (SuperAdmin, Admin, org-wide heads, etc.): `null` → truly
   *   unfiltered, they can see every branch in the org.
   * - Branch-scoped users (MB, CS_CLOSER, branch HoM, etc.): the user's
   *   `branchIds` array — "All branches" means "all MY branches", not every
   *   branch in the org.
   * - When `currentBranchId` is set (user picked a specific branch): `null` —
   *   use `currentBranchId` directly instead.
   *
   * Services should check: if `currentBranchId` → filter by that single branch;
   * else if `effectiveBranchIds` → filter by `IN (…)` union; else → no filter.
   */
  effectiveBranchIds: string[] | null;
  /** The active branch-group (company) ID from the session. */
  activeGroupId: string | null;
}

export function createContext(req: Request, res: Response): TrpcContext {
  const user = (req as Request & { user?: SessionUser }).user ?? null;
  const sessionToken = (req as Request & { sessionToken?: string }).sessionToken ?? null;
  const currentBranchId = user?.currentBranchId ?? null;
  const activeGroupId = user?.activeGroupId ?? null;

  // Resolve effectiveBranchIds: the concrete set of branch IDs this request
  // is allowed to see. Priority:
  //
  //  1. Single branch selected (currentBranchId is set) → null; use
  //     currentBranchId directly for filtering.
  //  2. Company selected ("All branches" within a company) → use
  //     selectedBranchIds from the session, which auth.service already scoped
  //     to the active group during login / switchBranch.
  //  3. Global user without company selection → null (truly org-wide).
  //  4. Branch-scoped user without company selection → user.branchIds.
  //
  // Case 2 is the critical multi-company isolation gate: when a SuperAdmin
  // picks "Rogue Tech", selectedBranchIds = [branch IDs in Rogue Tech only].
  // Without this, global users see data from every company.
  // Resolve effectiveBranchIds: the concrete set of branch IDs for the active
  // company. Used by services that need company-wide scoping (companyWideUserList,
  // order aggregates, etc.) even when a single branch is selected.
  //
  // Priority:
  //  1. selectedBranchIds from session (scoped to activeGroupId on login/switch)
  //  2. activeGroupId set but selectedBranchIds empty → empty array (match nothing)
  //  3. Non-global user without company → their personal branchIds
  //  4. Global user without company → null (truly org-wide)
  let effectiveBranchIds: string[] | null = null;
  if (user) {
    const selected = user.selectedBranchIds;
    if (selected && selected.length > 0) {
      // Company-scoped — use the group-filtered set regardless of whether
      // a single branch is selected. Pages like HR Users need this for
      // company-wide queries even when currentBranchId is set.
      effectiveBranchIds = selected;
    } else if (activeGroupId) {
      // A company IS selected but selectedBranchIds is empty — stale session
      // or race before /auth/me backfill runs. Use a non-matching UUID so
      // IN-based filters return zero rows rather than leaking org-wide data.
      effectiveBranchIds = ['00000000-0000-0000-0000-000000000000'];
    } else if (currentBranchId === null && !canViewAllBranches(user)) {
      // Non-global user at "All branches" without a company selection —
      // fall back to their personal branch memberships.
      const ids = user.branchIds ?? [];
      if (ids.length > 0) effectiveBranchIds = ids;
    }
    // else: global user without company selection AND no activeGroupId → null (org-wide).
  }

  return { user, req, res, sessionToken, currentBranchId, effectiveBranchIds, activeGroupId };
}
