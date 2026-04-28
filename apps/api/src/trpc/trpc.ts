import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context';
import type { UserRole } from '@yannis/shared';
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
const blockMutationsWhileMirroring = t.middleware(async ({ ctx, type, next }) => {
  if (type === 'mutation' && ctx.user?.mirroredBy) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Read-only while mirroring user. Exit mirror mode to make changes.',
    });
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
  const needsExplicitBranchOnScopedMutations = isOrgWideDepartmentHead(ctx.user);
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
    ctx.user.role === 'HEAD_OF_MARKETING'
  ) {
    return next();
  }
  throw new TRPCError({ code: 'BAD_REQUEST', message: BRANCH_CONTEXT_REQUIRED_MESSAGE });
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
 * SUPER_ADMIN and ADMIN bypass all checks. Others must have at least one of the required permissions.
 * Usage: permissionProcedure('users.create') or permissionProcedure('orders.read', 'orders.reassign')
 */
export function permissionProcedure(...permissionCodes: string[]) {
  return authedProcedure.use(async ({ ctx, next }) => {
    if (ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'ADMIN') {
      return next({ ctx });
    }
    const perms = ctx.user.permissions ?? [];
    const hasAny = permissionCodes.some((code) => perms.includes(code));
    if (!hasAny) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing required permission: ${permissionCodes.join(' or ')}`,
      });
    }
    return next({ ctx });
  });
}

export const router = t.router;
export const middleware = t.middleware;
