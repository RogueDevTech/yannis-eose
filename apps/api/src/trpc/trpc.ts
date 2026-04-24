import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context';
import type { UserRole } from '@yannis/shared';
import {
  hasFinanceAccess,
  stripFinanceFields,
} from '../common/utils/strip-finance-fields';

const t = initTRPC.context<TrpcContext>().create();

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
 * Authenticated procedure — requires a valid session.
 * Applies Column-Level Security (finance field stripping) automatically.
 */
export const authedProcedure = t.procedure
  .use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
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
