import type { Request, Response } from 'express';
import type { SessionUser } from '../common/decorators/current-user.decorator';

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
   * The set of branch IDs the user belongs to (from `user_branches`).
   * NULL for truly global users (SuperAdmin/Admin with scopeGlobal).
   * When `currentBranchId` is null AND this is non-null, services must
   * scope to IN(effectiveBranchIds) instead of showing all data.
   */
  effectiveBranchIds: string[] | null;
  /**
   * The active branch group ("company") for this request, resolved from
   * the user's currentBranchId → branch.group_id lookup.
   * NULL = global view (SuperAdmin with no branch selected).
   * Used to scope products, system settings, commission plans, etc.
   * CEO directive 2026-06-10.
   */
  activeGroupId: string | null;
}

export function createContext(req: Request, res: Response): TrpcContext {
  const user = (req as Request & { user?: SessionUser }).user ?? null;
  const sessionToken = (req as Request & { sessionToken?: string }).sessionToken ?? null;
  const currentBranchId = user?.currentBranchId ?? null;
  // Multi-branch selection: when a global user picks a subset of branches
  // via the header checkbox switcher, scope queries to that subset instead
  // of showing everything. CEO directive 2026-06-10.
  const selectedSubset = user?.selectedBranchIds?.length ? user.selectedBranchIds : null;
  // Global users (scopeGlobal) see everything — no branch guard needed,
  // UNLESS they have an active multi-branch selection.
  // Non-global users who selected "All branches" (currentBranchId=null) must
  // still be scoped to their assigned branches.
  const effectiveBranchIds =
    selectedSubset
      ? selectedSubset
      : user?.scopeGlobal ? null : (user?.branchIds?.length ? user.branchIds : null);
  const activeGroupId = user?.activeGroupId ?? null;
  return { user, req, res, sessionToken, currentBranchId, effectiveBranchIds, activeGroupId };
}
