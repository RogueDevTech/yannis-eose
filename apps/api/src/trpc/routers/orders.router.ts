import {
  createOrderSchema,
  transitionOrderSchema,
  updateOrderSchema,
  assignOrderSchema,
  bulkReassignSchema,
  listOrdersSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { router, authedProcedure, rolesProcedure, publicProcedure } from '../trpc';
import { OrdersService } from '../../orders/orders.service';

// We need to pass the service instance through context or create it inline.
// Since tRPC routers in this architecture are static, we use a factory pattern.
let ordersServiceInstance: OrdersService | null = null;

export function setOrdersService(service: OrdersService) {
  ordersServiceInstance = service;
}

function getOrdersService(): OrdersService {
  if (!ordersServiceInstance) {
    throw new Error('OrdersService not initialized. Call setOrdersService() first.');
  }
  return ordersServiceInstance;
}

export const ordersRouter = router({
  /**
   * Create a new order.
   * Public procedure — Edge Worker creates orders without auth.
   * When called by authenticated user, actor is tracked.
   */
  create: publicProcedure
    .input(createOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().create(input, ctx.user?.id ?? null);
    }),

  /**
   * Get a single order by ID.
   */
  getById: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getOrdersService().getById(input.orderId);
    }),

  /**
   * List orders with filtering and pagination.
   */
  list: authedProcedure
    .input(listOrdersSchema)
    .query(async ({ input }) => {
      return getOrdersService().list(input);
    }),

  /**
   * Transition an order to a new status.
   * Enforces the state machine + gates.
   */
  transition: authedProcedure
    .input(transitionOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().transition(input, ctx.user);
    }),

  /**
   * Update order details (address, items, notes).
   */
  update: authedProcedure
    .input(updateOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().update(input, ctx.user);
    }),

  /**
   * Assign an order to a CS agent.
   * Restricted to Head of CS and SuperAdmin.
   */
  assignToCS: rolesProcedure('SUPER_ADMIN', 'HEAD_OF_CS')
    .input(assignOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().assignToCS(input.orderId, input.csAgentId, ctx.user);
    }),

  /**
   * Bulk reassign orders (Hot Swap).
   * Restricted to Head of CS and SuperAdmin.
   */
  bulkReassign: rolesProcedure('SUPER_ADMIN', 'HEAD_OF_CS')
    .input(bulkReassignSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().bulkReassign(
        input.orderIds,
        input.fromAgentId,
        input.toAgentId,
        ctx.user,
      );
    }),

  /**
   * Get order counts by status — for dashboard stats.
   */
  statusCounts: authedProcedure.query(async () => {
    return getOrdersService().getStatusCounts();
  }),

  /**
   * Get CS agent workloads — for dispatch dashboard.
   * Restricted to Head of CS and SuperAdmin.
   */
  csWorkloads: rolesProcedure('SUPER_ADMIN', 'HEAD_OF_CS').query(async () => {
    return getOrdersService().getCSAgentWorkloads();
  }),
});
