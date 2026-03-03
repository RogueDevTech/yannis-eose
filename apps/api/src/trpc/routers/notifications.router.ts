import { router, authedProcedure } from '../trpc';
import {
  listNotificationsSchema,
  markNotificationsReadSchema,
} from '@yannis/shared';
import type { NotificationsService } from '../../notifications/notifications.service';

let notificationsServiceInstance: NotificationsService | null = null;

export function setNotificationsService(service: NotificationsService) {
  notificationsServiceInstance = service;
}

function getNotificationsService(): NotificationsService {
  if (!notificationsServiceInstance) {
    throw new Error('NotificationsService not initialized. Call setNotificationsService() first.');
  }
  return notificationsServiceInstance;
}

export const notificationsRouter = router({
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
  unreadCount: authedProcedure
    .query(async ({ ctx }) => {
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
  markAllAsRead: authedProcedure
    .mutation(async ({ ctx }) => {
      return getNotificationsService().markAllAsRead(ctx.user.id);
    }),
});
