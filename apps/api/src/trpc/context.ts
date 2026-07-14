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
}

export function createContext(req: Request, res: Response): TrpcContext {
  const user = (req as Request & { user?: SessionUser }).user ?? null;
  const sessionToken = (req as Request & { sessionToken?: string }).sessionToken ?? null;
  const currentBranchId = user?.currentBranchId ?? null;

  // Resolve effectiveBranchIds: when currentBranchId is null AND the user is
  // NOT a global viewer, narrow "All branches" to their assigned branches only.
  let effectiveBranchIds: string[] | null = null;
  if (user && currentBranchId === null && !canViewAllBranches(user)) {
    const ids = user.branchIds ?? [];
    if (ids.length > 0) effectiveBranchIds = ids;
  }

  return { user, req, res, sessionToken, currentBranchId, effectiveBranchIds };
}
