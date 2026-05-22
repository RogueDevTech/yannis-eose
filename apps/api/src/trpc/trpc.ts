import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context';
import type { UserRole } from '@yannis/shared';
import { canonicalPermissionCode } from '@yannis/shared';
import {
  hasFinanceAccess,
  stripFinanceFields,
} from '../common/utils/strip-finance-fields';
import { isOrgWideDepartmentHead } from '../common/authz';

const t = initTRPC.context<TrpcContext>().create();
export const BRANCH_CONTEXT_REQUIRED_MESSAGE =
  'Branch context required. Switch to a branch or pass branchId for this action.';
const BRANCH_SCOPED_MUTATION_PATHS = new Set([
  'orders.createOffline',
  'orders.transition',
  'orders.update',
  'orders.requestLinePriceChangeApproval',
  'orders.requestOrderDeletionApproval',
  'orders.softDeleteOrder',
  'orders.assignToCS',
  'orders.bulkReassign',
  'orders.redistributeOrdersFromAgent',
  'orders.distributeUnassignedOrders',
  'orders.revealPhoneForManualCall',
  'orders.scheduleCallback',
  'orders.mergeDuplicate',
  'orders.dismissDuplicate',
  'orders.bulkTransition',
  'orders.bulkAssignToCS',
  'orders.claimOrder',
  'marketing.createFunding',
  'marketing.verifyFunding',
  'marketing.requestFunding',
  'marketing.approveFundingRequest',
  'marketing.rejectFundingRequest',
  'marketing.createAdSpend',
  'marketing.approveAdSpend',
  'marketing.rejectAdSpend',
  'marketing.updateAdSpend',
  'marketing.createOfferTemplate',
  'marketing.updateOfferTemplate',
  'marketing.createCampaign',
  'marketing.updateCampaign',
  'users.create',
  'users.update',
  'users.deactivate',
  'users.resetPassword',
  'users.processEmailChange',
  'scopedMutation',
]);

/**
 * Column-Level Security middleware — strips sensitive financial fields
 * (costPrice, landedCost, margin, factoryCost, etc.) from tRPC responses
 * unless the user has SUPER_ADMIN or FINANCE_OFFICER role.
 *
 * PRD Ref: Section 11.3 (Column-Level Security)
 */
const financeFieldsMiddleware = t.middleware(async ({ ctx, next }) => {
  const result = await next();

  // Only strip if the procedure succeeded and user lacks finance access
  if (
    result.ok &&
    ctx.user &&
    !hasFinanceAccess(ctx.user)
  ) {
    return {
      ...result,
      data: stripFinanceFields(result.data),
    };
  }

  return result;
});

/**
 * Public procedure — no auth required.
 */
export const publicProcedure = t.procedure;

/**
 * Mirror Mode read-only guard.
 *
 * When the session has `mirroredBy` set the actor is browsing the app through
 * another user's account — every mutation must be rejected. Queries pass through
 * unchanged so the admin can navigate, search, and view freely.
 *
 * The check uses the procedure type from `meta` because tRPC v11 doesn't expose
 * `_def.mutation` on the params; instead we look at the `type` field on the
 * runtime call info. `next()` returns the result wrapper either way.
 */
/**
 * Mutations that ONLY change the viewer's session/UI state (no business data
 * touched) can opt-in via `.meta({ viewOnlyOk: true })`. Examples:
 *   - `branches.switchBranch` — flips the active branch in the Redis session
 *     so the admin can see what the mirrored user sees in branch X. No row
 *     in any business table is created/updated/deleted.
 * Anything that writes business data (orders, users, inventory, finance,
 * etc.) MUST NOT carry this flag — the whole point of mirror mode is that
 * the admin acts as a passive observer.
 */
const blockMutationsWhileMirroring = t.middleware(async ({ ctx, type, meta, next }) => {
  if (type === 'mutation' && ctx.user?.mirroredBy) {
    const viewOnlyOk =
      (meta as Record<string, unknown> | undefined)?.['viewOnlyOk'] === true;
    if (!viewOnlyOk) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Read-only while mirroring user. Exit mirror mode to make changes.',
      });
    }
  }
  return next();
});

function extractInputBranchId(input: unknown, depth = 0): string | null {
  if (!input || typeof input !== 'object' || depth > 4) return null;
  const obj = input as Record<string, unknown>;
  const direct = obj.branchId;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  for (const value of Object.values(obj)) {
    const nested = extractInputBranchId(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

const requireBranchScopeForGlobalAdminMutations = t.middleware(async ({ ctx, type, path, meta, input, getRawInput, next }) => {
  if (type !== 'mutation') return next();
  if (!ctx.user) return next();
  const needsExplicitBranchOnScopedMutations = isOrgWideDepartmentHead({
    role: ctx.user.role,
    scopeOrgWideHead: ctx.user.scopeOrgWideHead,
  });
  if (!needsExplicitBranchOnScopedMutations) return next();
  if (ctx.currentBranchId !== null) return next();
  const isBranchScopedMutation =
    (meta as Record<string, unknown> | undefined)?.['branchScopedMutation'] === true ||
    (typeof path === 'string' && BRANCH_SCOPED_MUTATION_PATHS.has(path));
  if (!isBranchScopedMutation) return next();
  const rawInput = await getRawInput().catch(() => null);
  const explicitBranchId = extractInputBranchId(input) ?? extractInputBranchId(rawInput);
  if (explicitBranchId) return next();
  // Upstream funding request to Finance — org-wide, not a branch-ledger write (per marketing.service.getBranchUserIds when branchId is null).
  if (
    typeof path === 'string' &&
    path === 'marketing.requestFunding' &&
    (ctx.user.role === 'HEAD_OF_MARKETING' || (ctx.user.permissions ?? []).includes('marketing.requestFunding.orgWide'))
  ) {
    return next();
  }
  // Single-branch org-wide head (most orgs while they're still single-branch):
  // there's no choice to make — auto-fall back to the user's sole branch and
  // proceed instead of throwing "Branch context required". The branchIds are
  // captured at login (see auth.service.ts). Multi-branch holders still hit
  // the throw below so they're forced to switch branch or pass branchId.
  const branchIds = ctx.user.branchIds ?? [];
  if (branchIds.length === 1) {
    const fallbackBranchId = branchIds[0]!;
    return next({
      ctx: { ...ctx, currentBranchId: fallbackBranchId },
    });
  }
  throw new TRPCError({ code: 'BAD_REQUEST', message: BRANCH_CONTEXT_REQUIRED_MESSAGE });
});

/**
 * Media Buyer branch-lens read-only guard.
 *
 * A Media Buyer's header branch switcher doubles as a personal data lens: it
 * can point at "All Branches" (`currentBranchId = null`) or at a branch they
 * were since removed from — both purely for reviewing their own historical
 * orders. Neither is a valid *write* context. This middleware blocks every
 * branch-scoped mutation while the buyer is in that cross-branch view, so they
 * cannot create a form / ad spend / funding row attributed to a branch they
 * don't currently belong to. They must switch back to one of their member
 * branches first. Branch isolation for writes stays intact.
 *
 * `branches.switchBranch` is NOT branch-scoped, so the buyer can always switch
 * back. Non-branch-scoped mutations (profile, theme, notifications) pass.
 */
const MEDIA_BUYER_BRANCH_LOCKED_MESSAGE =
  "You're viewing data across branches. Switch to one of your branches to make changes.";

const blockMediaBuyerMutationsOutsideMemberBranch = t.middleware(async ({ ctx, type, path, meta, next }) => {
  if (type !== 'mutation') return next();
  if (!ctx.user || ctx.user.role !== 'MEDIA_BUYER') return next();
  const isBranchScopedMutation =
    (meta as Record<string, unknown> | undefined)?.['branchScopedMutation'] === true ||
    (typeof path === 'string' && BRANCH_SCOPED_MUTATION_PATHS.has(path));
  if (!isBranchScopedMutation) return next();
  // A non-null currentBranchId that IS one of the buyer's memberships is the
  // only valid write context. null = "All Branches" lens; a non-member value =
  // a branch they've left — both read-only.
  const branchIds = ctx.user.branchIds ?? [];
  if (ctx.currentBranchId !== null && branchIds.includes(ctx.currentBranchId)) {
    return next();
  }
  throw new TRPCError({ code: 'FORBIDDEN', message: MEDIA_BUYER_BRANCH_LOCKED_MESSAGE });
});

/**
 * Authenticated procedure — requires a valid session.
 * Applies Column-Level Security (finance field stripping) automatically.
 * Blocks mutations when in Mirror Mode.
 */
export const authedProcedure = t.procedure
  .use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
  .use(blockMutationsWhileMirroring)
  .use(requireBranchScopeForGlobalAdminMutations)
  .use(blockMediaBuyerMutationsOutsideMemberBranch)
  .use(financeFieldsMiddleware);

/**
 * Role-restricted procedure factory.
 * @deprecated Use permissionProcedure instead for granular RBAC.
 * Finance field stripping is inherited from authedProcedure.
 */
export function rolesProcedure(...roles: UserRole[]) {
  return authedProcedure.use(async ({ ctx, next }) => {
    if (!roles.includes(ctx.user.role as UserRole)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Role '${ctx.user.role}' does not have access`,
      });
    }
    return next({ ctx });
  });
}

/**
 * Permission-restricted procedure factory.
 * SUPER_ADMIN bypasses all checks. Everyone else must have at least one of the required permissions.
 * Usage: permissionProcedure('users.create') or permissionProcedure('orders.read', 'orders.reassign')
 */
export function permissionProcedure(...permissionCodes: string[]) {
  return authedProcedure.use(async ({ ctx, next }) => {
    if (ctx.user.role === 'SUPER_ADMIN') {
      return next({ ctx });
    }
    const required = permissionCodes.map((code) => canonicalPermissionCode(code));
    const perms = new Set((ctx.user.permissions ?? []).map((code) => canonicalPermissionCode(code)));
    const hasAny = required.some((code) => perms.has(code));
    if (!hasAny) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing required permission: ${required.join(' or ')}`,
      });
    }
    return next({ ctx });
  });
}

export const router = t.router;
export const middleware = t.middleware;
