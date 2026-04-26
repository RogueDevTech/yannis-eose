import { router } from '../trpc';
import { healthRouter } from './health.router';
import { ordersRouter } from './orders.router';
import { usersRouter } from './users.router';
import { productsRouter } from './products.router';
import { productCategoriesRouter } from './product-categories.router';
import { inventoryRouter } from './inventory.router';
import { logisticsRouter } from './logistics.router';
import { marketingRouter } from './marketing.router';
import { financeRouter } from './finance.router';
import { hrRouter } from './hr.router';
import { notificationsRouter } from './notifications.router';
import { auditRouter } from './audit.router';
import { dashboardRouter } from './dashboard.router';
import { settingsRouter } from './settings.router';
import { voipRouter } from './voip.router';
import { cartRouter } from './cart.router';
import { permissionRequestsRouter } from './permission-requests.router';
import { branchesRouter } from './branches.router';
import { messagingRouter } from './messaging.router';
import { reportsRouter } from './reports.router';

/**
 * Root tRPC router — merges all module routers.
 * Each domain module (orders, inventory, etc.) adds its router here.
 */
export const appRouter = router({
  health: healthRouter,
  orders: ordersRouter,
  users: usersRouter,
  products: productsRouter,
  productCategories: productCategoriesRouter,
  inventory: inventoryRouter,
  logistics: logisticsRouter,
  marketing: marketingRouter,
  finance: financeRouter,
  hr: hrRouter,
  notifications: notificationsRouter,
  audit: auditRouter,
  dashboard: dashboardRouter,
  settings: settingsRouter,
  voip: voipRouter,
  cart: cartRouter,
  permissionRequests: permissionRequestsRouter,
  branches: branchesRouter,
  messaging: messagingRouter,
  reports: reportsRouter,
});

export type AppRouter = typeof appRouter;
