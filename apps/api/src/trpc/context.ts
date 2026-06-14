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
  const activeGroupId = user?.activeGroupId ?? null;
  // Global users (scopeGlobal) see everything — no branch guard needed,
  // UNLESS they have an active multi-branch selection OR an active company
  // group. When a company group is active, even org-wide roles (Finance,
  // HR, etc.) must be scoped to that group's branches — they are
  // "company-wide", not "all-companies-wide".
  const effectiveBranchIds =
    // Explicit multi-branch selection (header checkbox switcher)
    selectedSubset
      ? selectedSubset
    // A specific branch is selected → scope to that single branch so that
    // services using only effectiveBranchIds (aggregates, counts) don't
    // leak data from the user's other assigned branches.
      : currentBranchId
        ? [currentBranchId]
    // No specific branch → fall back to user's assigned branches / global
      : user?.scopeGlobal
        ? (activeGroupId && user?.branchIds?.length ? user.branchIds : null)
        : (user?.branchIds?.length ? user.branchIds : null);
  return { user, req, res, sessionToken, currentBranchId, effectiveBranchIds, activeGroupId };
}
