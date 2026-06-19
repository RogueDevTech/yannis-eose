import { z } from 'zod';
import { router, permissionProcedure, authedProcedure } from '../trpc';
import {
  listCartOrdersSchema,
  cartOrderDetailSchema,
  assignCartOrderSchema,
  bulkAssignCartOrdersSchema,
  transitionCartOrderSchema,
  updateCartOrderSchema,
} from '@yannis/shared';
import type { CartOrdersService } from '../../cart-orders/cart-orders.service';
import { getFinanceService } from './finance.router';
import { getOrdersService } from './orders.router';

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
      const viewerCloserId = ctx.user.role === 'CS_CLOSER' ? ctx.user.id : null;
      return getCartOrdersService().list(input, ctx.currentBranchId, ctx.effectiveBranchIds, viewerCloserId);
    }),

  getStatusCounts: permissionProcedure('orders.read')
    .input(listCartOrdersSchema.pick({ assignedCsId: true, branchId: true, startDate: true, endDate: true }))
    .query(async ({ input, ctx }) => {
      const viewerCloserId = ctx.user.role === 'CS_CLOSER' ? ctx.user.id : null;
      return getCartOrdersService().getStatusCounts(
        ctx.currentBranchId ?? input.branchId,
        input.assignedCsId,
        input.startDate,
        input.endDate,
        ctx.effectiveBranchIds,
        undefined, // mediaBuyerId
        viewerCloserId,
      );
    }),

  getById: permissionProcedure('orders.read')
    .input(cartOrderDetailSchema)
    .query(async ({ input, ctx }) => {
      const detail = await getCartOrdersService().getById(input.id);
      const viewerCanEditOrderLinePrices = await getOrdersService().canActorEditOrderLinePrices(ctx.user, {
        branchId: detail.servicingBranchId ?? detail.branchId ?? null,
        assignedCsId: detail.assignedCsId ?? null,
      });
      return { ...detail, viewerCanEditOrderLinePrices };
    }),

  update: authedProcedure
    .input(updateCartOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().update(input, ctx.user);
    }),

  adjustItems: authedProcedure
    .input(z.object({
      orderId: z.string().uuid(),
      items: z.array(z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        unitPrice: z.coerce.number().min(0),
        offerLabel: z.string().max(100).optional(),
      })).min(1),
      totalAmount: z.coerce.number().min(0),
    }))
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().adjustItems(input.orderId, input.items, input.totalAmount, ctx.user);
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

  transition: permissionProcedure('orders.detail.manage')
    .input(transitionCartOrderSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await getCartOrdersService().transitionStatus(
        input.orderId,
        input.newStatus,
        ctx.user,
        input.note,
        input.metadata,
      );

      // Auto-generate invoice on CONFIRMED — mirrors follow-up/main order behaviour
      if (input.newStatus === 'CONFIRMED') {
        try {
          const co = await getCartOrdersService().getById(input.orderId);
          const coItems = (co as { orderItems?: Array<{ quantity: number; unitPrice: string; productName?: string | null; productId: string }> }).orderItems ?? [];
          await getFinanceService().ensureInvoiceForOrder({
            order: {
              id: co.id,
              confirmedAt: co.confirmedAt ?? new Date(),
              customerName: co.customerName,
              customerAddress: co.customerAddress ?? null,
              orderItems: coItems.map((it) => ({
                quantity: it.quantity, unitPrice: it.unitPrice, productName: it.productName ?? null, productId: it.productId,
              })),
            },
            actorId: ctx.user.id,
          });
        } catch { /* non-critical — user can generate manually */ }
      }

      return result;
    }),

  ensureInvoice: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const co = await getCartOrdersService().getById(input.orderId);
      const coItems = (co as { orderItems?: Array<{ quantity: number; unitPrice: string; productName?: string | null; productId: string }> }).orderItems ?? [];
      await getFinanceService().ensureInvoiceForOrder({
        order: {
          id: co.id,
          confirmedAt: co.confirmedAt ?? new Date(),
          customerName: co.customerName,
          customerAddress: co.customerAddress ?? null,
          orderItems: coItems.map((it) => ({
            quantity: it.quantity, unitPrice: it.unitPrice, productName: it.productName ?? null, productId: it.productId,
          })),
        },
        actorId: ctx.user.id,
      });
      return { success: true };
    }),

  initiateCall: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().initiateCall(input.orderId, ctx.user);
    }),

  pullFromCarts: permissionProcedure('orders.bulkAssign')
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
      const isMB = ctx.user.role === 'MEDIA_BUYER';
      return getCartOrdersService().getStatusCounts(
        ctx.currentBranchId,
        isCloser ? ctx.user.id : undefined,
        input?.startDate,
        input?.endDate,
        ctx.effectiveBranchIds,
        isMB ? ctx.user.id : undefined,
      );
    }),
});
