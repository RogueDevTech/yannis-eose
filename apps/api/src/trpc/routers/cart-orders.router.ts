import { z } from 'zod';
import { router, permissionProcedure, authedProcedure } from '../trpc';
import {
  listCartOrdersSchema,
  cartOrderDetailSchema,
  assignCartOrderSchema,
  bulkAssignCartOrdersSchema,
  transitionCartOrderSchema,
} from '@yannis/shared';
import type { CartOrdersService } from '../../cart-orders/cart-orders.service';

// ── Service Injection (NestJS → tRPC singleton bridge) ──────────────

let cartOrdersInstance: CartOrdersService | null = null;

export function setCartOrdersService(service: CartOrdersService) {
  cartOrdersInstance = service;
}

export function getCartOrdersService(): CartOrdersService {
  if (!cartOrdersInstance) {
    throw new Error('CartOrdersService not initialized. Call setCartOrdersService() first.');
  }
  return cartOrdersInstance;
}

// ── Router ──────────────────────────────────────────────────────────

export const cartOrdersRouter = router({
  list: permissionProcedure('orders.read')
    .input(listCartOrdersSchema)
    .query(async ({ input, ctx }) => {
      return getCartOrdersService().list(input, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  getStatusCounts: permissionProcedure('orders.read')
    .input(listCartOrdersSchema.pick({ assignedCsId: true, branchId: true, startDate: true, endDate: true }))
    .query(async ({ input, ctx }) => {
      return getCartOrdersService().getStatusCounts(
        ctx.currentBranchId ?? input.branchId,
        input.assignedCsId,
        input.startDate,
        input.endDate,
        ctx.effectiveBranchIds,
      );
    }),

  getById: permissionProcedure('orders.read')
    .input(cartOrderDetailSchema)
    .query(async ({ input }) => {
      return getCartOrdersService().getById(input.id);
    }),

  assignToCS: permissionProcedure('orders.reassign')
    .input(assignCartOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().assignToCS(input.orderId, input.closerId, ctx.user);
    }),

  bulkAssign: permissionProcedure('orders.bulkAssign')
    .input(bulkAssignCartOrdersSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().bulkAssign(input.orderIds, input.closerIds, ctx.user);
    }),

  transition: permissionProcedure('orders.write')
    .input(transitionCartOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().transitionStatus(
        input.orderId,
        input.newStatus,
        ctx.user,
        input.note,
        input.metadata,
      );
    }),

  initiateCall: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().initiateCall(input.orderId, ctx.user);
    }),

  pullFromCarts: permissionProcedure('orders.write')
    .input(
      listCartOrdersSchema.pick({}).extend({
        cartIds: bulkAssignCartOrdersSchema.shape.orderIds,
        targetBranchId: listCartOrdersSchema.shape.branchId,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().pullFromAbandonedCarts(
        input.cartIds,
        input.targetBranchId ?? ctx.currentBranchId ?? null,
        ctx.user,
      );
    }),

  dashboardCounts: authedProcedure
    .input(z.object({ startDate: z.string().optional(), endDate: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const isCloser = ctx.user.role === 'CS_CLOSER';
      return getCartOrdersService().getStatusCounts(
        ctx.currentBranchId,
        isCloser ? ctx.user.id : undefined,
        input?.startDate,
        input?.endDate,
        ctx.effectiveBranchIds,
      );
    }),
});
