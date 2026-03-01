import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context';
import type { UserRole } from '@yannis/shared';

const t = initTRPC.context<TrpcContext>().create();

/**
 * Public procedure — no auth required.
 */
export const publicProcedure = t.procedure;

/**
 * Authenticated procedure — requires a valid session.
 */
export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Role-restricted procedure factory.
 * Usage: rolesProcedure('SUPER_ADMIN', 'FINANCE_OFFICER')
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

export const router = t.router;
export const middleware = t.middleware;
