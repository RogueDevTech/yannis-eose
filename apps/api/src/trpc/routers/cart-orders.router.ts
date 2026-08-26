import { z } from 'zod';
import { router, permissionProcedure, authedProcedure } from '../trpc';
import {
  listCartOrdersSchema,
  cartOrderDetailSchema,
  assignCartOrderSchema,
  bulkAssignCartOrdersSchema,
  transitionCartOrderSchema,
  updateCartOrderSchema,
  createCartOrderRoutingRuleSchema,
  updateCartOrderRoutingRuleSchema,
  deleteCartOrderRoutingRuleSchema,
  listCartOrderRoutingRulesSchema,
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
  list: permissionProcedure('orders.read', 'marketing.orders')
    .input(listCartOrdersSchema)
    .query(async ({ input, ctx }) => {
      const viewerCloserId = ctx.user.role === 'CS_CLOSER' ? ctx.user.id : null;
      return getCartOrdersService().list(input, ctx.currentBranchId, ctx.effectiveBranchIds, viewerCloserId, undefined, ctx.effectiveCurrencyCodes);
    }),

  getStatusCounts: permissionProcedure('orders.read')
    .input(listCartOrdersSchema.pick({ assignedCsId: true, branchId: true, startDate: true, endDate: true, currencyCode: true }))
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
        'servicing', // branchScope
        undefined, // mediaBuyerIds
        input.currencyCode, // currencyCode — strip mirrors the list's currency filter
        ctx.effectiveCurrencyCodes, // country data-scope
      );
    }),

  getById: permissionProcedure('orders.read')
    .input(cartOrderDetailSchema)
    .query(async ({ input, ctx }) => {
      const detail = await getCartOrdersService().getById(input.id, ctx.effectiveBranchIds);
      const viewerCanEditOrderLinePrices = await getOrdersService().canActorEditOrderLinePrices(ctx.user, {
        branchId: detail.servicingBranchId ?? detail.branchId ?? null,
        assignedCsId: detail.assignedCsId ?? null,
      });
      return { ...detail, viewerCanEditOrderLinePrices };
    }),

  update: authedProcedure
    .input(updateCartOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().update(input, ctx.user, ctx.effectiveBranchIds);
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
      return getCartOrdersService().adjustItems(input.orderId, input.items, input.totalAmount, ctx.user, ctx.effectiveBranchIds);
    }),

  assignToCS: permissionProcedure('orders.reassign')
    .input(assignCartOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().assignToCS(input.orderId, input.closerId, ctx.user, ctx.effectiveBranchIds);
    }),

  bulkAssign: permissionProcedure('orders.bulkAssign')
    .input(bulkAssignCartOrdersSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().bulkAssign(input.orderIds, input.closerIds, ctx.user, ctx.effectiveBranchIds);
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
        ctx.effectiveBranchIds,
      );

      // Auto-generate invoice on CONFIRMED — mirrors follow-up/main order behaviour
      if (input.newStatus === 'CONFIRMED') {
        try {
          const co = await getCartOrdersService().getById(input.orderId, ctx.effectiveBranchIds);
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
      const co = await getCartOrdersService().getById(input.orderId, ctx.effectiveBranchIds);
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
      return getCartOrdersService().initiateCall(input.orderId, ctx.user, ctx.effectiveBranchIds);
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
      const isMarketingRole = ctx.user.role === 'HEAD_OF_MARKETING' || isMB;
      const isMarketingSupervisor = isMB &&
        (ctx.user as { isMarketingTeamSupervisorOnActiveBranch?: boolean }).isMarketingTeamSupervisorOnActiveBranch === true;
      // Supervisor: scope to team's media buyer IDs (not just own ID).
      let mediaBuyerIds: string[] | null = null;
      if (isMarketingSupervisor && ctx.currentBranchId) {
        const { getBranchTeamsService } = await import('./branches.router');
        const scope = await getBranchTeamsService().listSupervisorScopeIds(ctx.user.id, ctx.currentBranchId);
        mediaBuyerIds = scope.marketingUserIds.length > 0 ? scope.marketingUserIds : [ctx.user.id];
        if (!mediaBuyerIds.includes(ctx.user.id)) mediaBuyerIds.push(ctx.user.id);
      }
      return getCartOrdersService().getStatusCounts(
        ctx.currentBranchId,
        isCloser ? ctx.user.id : undefined,
        input?.startDate,
        input?.endDate,
        ctx.effectiveBranchIds,
        isMB && !isMarketingSupervisor ? ctx.user.id : undefined,
        undefined,
        isMarketingRole ? 'marketing' : 'servicing',
        mediaBuyerIds,
        undefined, // currencyCode
        ctx.effectiveCurrencyCodes, // country data-scope
      );
    }),

  // ── Cart Order Routing Config ─────────────────────────────────────

  routingListRules: permissionProcedure('orders.followUpConfig')
    .input(listCartOrderRoutingRulesSchema)
    .query(async ({ input }) => {
      return getCartOrdersService().listRoutingRules(input.enabledOnly);
    }),

  routingCreateRule: permissionProcedure('orders.followUpConfig')
    .input(createCartOrderRoutingRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().createRoutingRule(ctx.user, input);
    }),

  routingUpdateRule: permissionProcedure('orders.followUpConfig')
    .input(updateCartOrderRoutingRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().updateRoutingRule(ctx.user, input);
    }),

  routingDeleteRule: permissionProcedure('orders.followUpConfig')
    .input(deleteCartOrderRoutingRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getCartOrdersService().deleteRoutingRule(ctx.user, input.ruleId);
    }),

  routingListActiveCsBranches: permissionProcedure('orders.followUpConfig')
    .query(async ({ ctx }) => {
      return getCartOrdersService().listActiveCsBranches(ctx.effectiveBranchIds);
    }),

  /**
   * Ops: retry DELIVERED cart_orders that never got a graduated parent.
   * Returns per-id ok/error so failures are visible without digging API logs.
   */
  retryFailedGraduations: permissionProcedure('orders.detail.manage').mutation(async () => {
    return getCartOrdersService().retryFailedGraduations();
  }),
});
