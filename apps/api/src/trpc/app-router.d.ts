/**
 * Type-only export for consumers (e.g. web app) so they get AppRouter
 * without pulling in NestJS/API implementation. Uses AnyRouter so that
 * web's typecheck does not follow into API source.
 */
import type { AnyRouter } from '@trpc/server';
export type AppRouter = AnyRouter;
