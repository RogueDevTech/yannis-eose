import { router } from '../trpc';
import { healthRouter } from './health.router';
import { ordersRouter } from './orders.router';

/**
 * Root tRPC router — merges all module routers.
 * Each domain module (orders, inventory, etc.) will add its router here.
 */
export const appRouter = router({
  health: healthRouter,
  orders: ordersRouter,
  // Future module routers:
  // inventory: inventoryRouter,
  // logistics: logisticsRouter,
  // marketing: marketingRouter,
  // finance: financeRouter,
  // hr: hrRouter,
});

export type AppRouter = typeof appRouter;
