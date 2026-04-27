import { z } from 'zod';

// ============================================
// List Notifications
// ============================================

export const listNotificationsSchema = z.object({
  unreadOnly: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(50).default(20),
});

export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;

// ============================================
// Mark Notifications As Read
// ============================================

export const markNotificationsReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(100),
});

export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

// ============================================
// Create Notification (internal — not user-facing)
// ============================================

export const createNotificationSchema = z.object({
  userId: z.string().uuid(),
  type: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(1000).optional(),
  data: z.record(z.unknown()).optional(),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

// ============================================
// Per-user notification preferences
// ============================================

/**
 * Map of notification-type → enabled. Missing key = default (enabled).
 * Setting `false` opts the user out of that type entirely (in-app, push, email).
 */
export const notificationPreferencesSchema = z.record(z.string().min(1), z.boolean());

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateMyNotificationPreferencesSchema = z.object({
  preferences: notificationPreferencesSchema,
});

export type UpdateMyNotificationPreferencesInput = z.infer<
  typeof updateMyNotificationPreferencesSchema
>;
