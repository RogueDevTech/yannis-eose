import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import {
  listNotificationsSchema,
  markNotificationsReadSchema,
  savePushSubscriptionSchema,
  removePushSubscriptionSchema,
  broadcastPushSchema,
  getPushDeliveryLogSchema,
  resendPushSchema,
  bulkResendPushSchema,
  createAutomationRuleSchema,
  updateAutomationRuleSchema,
  toggleAutomationRuleSchema,
} from '@yannis/shared';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { PushSchedulerService } from '../../notifications/push-scheduler.service';

// ============================================================
// Factory-injected service instances
// ============================================================

let notificationsServiceInstance: NotificationsService | null = null;
let pushSchedulerServiceInstance: PushSchedulerService | null = null;

export function setNotificationsService(service: NotificationsService) {
  notificationsServiceInstance = service;
}

export function setPushSchedulerService(service: PushSchedulerService) {
  pushSchedulerServiceInstance = service;
}

function getNotificationsService(): NotificationsService {
  if (!notificationsServiceInstance) {
    throw new Error('NotificationsService not initialized. Call setNotificationsService() first.');
  }
  return notificationsServiceInstance;
}

function getPushSchedulerService(): PushSchedulerService {
  if (!pushSchedulerServiceInstance) {
    throw new Error('PushSchedulerService not initialized. Call setPushSchedulerService() first.');
  }
  return pushSchedulerServiceInstance;
}

// ============================================================
// Router
// ============================================================

export const notificationsRouter = router({
  // ----------------------------------------------------------
  // In-app notification procedures (existing)
  // ----------------------------------------------------------

  /**
   * List notifications for the authenticated user.
   */
  list: authedProcedure
    .input(listNotificationsSchema)
    .query(async ({ input, ctx }) => {
      return getNotificationsService().list(ctx.user.id, input);
    }),

  /**
   * Get unread notification count.
   */
  unreadCount: authedProcedure.query(async ({ ctx }) => {
    const count = await getNotificationsService().getUnreadCount(ctx.user.id);
    return { count };
  }),

  /**
   * Mark specific notifications as read.
   */
  markAsRead: authedProcedure
    .input(markNotificationsReadSchema)
    .mutation(async ({ input, ctx }) => {
      return getNotificationsService().markAsRead(ctx.user.id, input);
    }),

  /**
   * Mark all notifications as read.
   */
  markAllAsRead: authedProcedure.mutation(async ({ ctx }) => {
    return getNotificationsService().markAllAsRead(ctx.user.id);
  }),

  // ----------------------------------------------------------
  // Push subscription management
  // ----------------------------------------------------------

  /**
   * Save (upsert) a push subscription for the authenticated user.
   * Called from the frontend after the user grants notification permission
   * and the browser generates a PushSubscription object.
   */
  savePushSubscription: authedProcedure
    .input(savePushSubscriptionSchema)
    .mutation(async ({ input, ctx }) => {
      await getNotificationsService().savePushSubscription(ctx.user.id, input);
      return { success: true };
    }),

  /**
   * Remove push subscription for this device (after client unsubscribes from PushManager).
   */
  removePushSubscription: authedProcedure
    .input(removePushSubscriptionSchema)
    .mutation(async ({ input, ctx }) => {
      await getNotificationsService().removePushSubscription(ctx.user.id, input);
      return { success: true };
    }),

  // ----------------------------------------------------------
  // Broadcast push (admin)
  // ----------------------------------------------------------

  /**
   * Broadcast a push notification to a target audience.
   * Requires notifications.broadcast permission (SuperAdmin/BranchAdmin).
   */
  broadcastPush: permissionProcedure('notifications.broadcast')
    .input(broadcastPushSchema)
    .mutation(async ({ input, ctx }) => {
      // Scope enforcement: non-SuperAdmin cannot target ALL across branches
      if (
        ctx.user.role !== 'SUPER_ADMIN' &&
        input.targetType === 'ALL' &&
        !ctx.user.currentBranchId
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only SuperAdmin can broadcast to ALL users across all branches',
        });
      }

      const branchId =
        ctx.user.role === 'SUPER_ADMIN' ? null : (ctx.user.currentBranchId ?? null);

      return getNotificationsService().broadcastPush(ctx.user.id, branchId, input);
    }),

  // ----------------------------------------------------------
  // Push delivery log
  // ----------------------------------------------------------

  /**
   * Get paginated push delivery log.
   * Admins can filter by userId; regular users see their own logs only.
   */
  getPushDeliveryLog: authedProcedure
    .input(getPushDeliveryLogSchema)
    .query(async ({ input, ctx }) => {
      return getNotificationsService().getDeliveryLog(
        input,
        ctx.user.role,
        ctx.user.id,
      );
    }),

  /**
   * Resend a single push delivery.
   * SuperAdmin/BranchAdmin only.
   */
  resendPush: permissionProcedure('notifications.broadcast')
    .input(resendPushSchema)
    .mutation(async ({ input }) => {
      await getNotificationsService().resendPush(input.logId);
      return { success: true };
    }),

  /**
   * Bulk resend push deliveries.
   * SuperAdmin/BranchAdmin only.
   */
  bulkResendPush: permissionProcedure('notifications.broadcast')
    .input(bulkResendPushSchema)
    .mutation(async ({ input }) => {
      return getNotificationsService().bulkResendPush(input.logIds);
    }),

  // ----------------------------------------------------------
  // Push automation rules
  // ----------------------------------------------------------

  /**
   * List all push automation rules.
   * SuperAdmin sees all; others see rules scoped to their branch.
   */
  getAutomationRules: authedProcedure.query(async ({ ctx }) => {
    const branchId =
      ctx.user.role === 'SUPER_ADMIN' ? null : (ctx.user.currentBranchId ?? null);
    return getNotificationsService().getAutomationRules(branchId);
  }),

  /**
   * Create a push automation rule.
   * Reloads cron scheduler after creation.
   */
  createAutomationRule: permissionProcedure('notifications.broadcast')
    .input(createAutomationRuleSchema)
    .mutation(async ({ input, ctx }) => {
      const branchId =
        ctx.user.role === 'SUPER_ADMIN' ? null : (ctx.user.currentBranchId ?? null);

      const rule = await getNotificationsService().createAutomationRule(
        ctx.user.id,
        branchId,
        input,
      );

      // Reload scheduler so new CRON rules are immediately active
      getPushSchedulerService().reloadCronJobs().catch((err: unknown) => {
        console.error('[notifications.createAutomationRule] Failed to reload cron jobs:', err);
      });

      return rule;
    }),

  /**
   * Update a push automation rule.
   * Reloads cron scheduler after update.
   */
  updateAutomationRule: permissionProcedure('notifications.broadcast')
    .input(updateAutomationRuleSchema)
    .mutation(async ({ input, ctx }) => {
      const rule = await getNotificationsService().updateAutomationRule(
        ctx.user.id,
        input,
      );

      // Reload scheduler to pick up any cron expression changes
      getPushSchedulerService().reloadCronJobs().catch((err: unknown) => {
        console.error('[notifications.updateAutomationRule] Failed to reload cron jobs:', err);
      });

      return rule;
    }),

  /**
   * Toggle a push automation rule active/inactive.
   * Registers or unregisters the cron job accordingly.
   */
  toggleAutomationRule: permissionProcedure('notifications.broadcast')
    .input(toggleAutomationRuleSchema)
    .mutation(async ({ input }) => {
      const rule = await getNotificationsService().toggleAutomationRule(
        input.id,
        input.isActive,
      );

      const scheduler = getPushSchedulerService();

      if (input.isActive && rule.triggerType === 'CRON' && rule.cronExpr) {
        scheduler.registerCronJob(rule.id, rule.cronExpr);
      } else {
        scheduler.unregisterCronJob(rule.id);
      }

      return rule;
    }),

  /**
   * Delete a push automation rule.
   * Unregisters cron job if applicable.
   */
  deleteAutomationRule: permissionProcedure('notifications.broadcast')
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      // Unregister cron job before deleting (safe to call even for EVENT-type rules)
      getPushSchedulerService().unregisterCronJob(input.id);

      await getNotificationsService().deleteAutomationRule(input.id);
      return { success: true };
    }),
});
