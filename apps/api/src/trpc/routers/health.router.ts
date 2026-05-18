import { z } from 'zod';
import { router, publicProcedure, authedProcedure } from '../trpc';

export const healthRouter = router({
  ping: publicProcedure.query(() => {
    return { status: 'ok', service: 'yannis-api', timestamp: new Date().toISOString() };
  }),

  whoami: authedProcedure.query(({ ctx }) => {
    return {
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      role: ctx.user.role,
    };
  }),

  echo: publicProcedure
    .input(z.object({ message: z.string().min(1) }))
    .query(({ input }) => {
      return { echo: input.message };
    }),
});
