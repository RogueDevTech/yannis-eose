import { z } from 'zod';

export const updateSystemSettingSchema = z.object({
  key: z.string().min(1),
  value: z.record(z.unknown()),
});

export type UpdateSystemSettingInput = z.infer<typeof updateSystemSettingSchema>;

/** Schema for notification email config — which configurable types send email */
export const notificationEmailConfigSchema = z.object({
  enabledTypes: z.record(z.string(), z.boolean()),
});

export type NotificationEmailConfig = z.infer<typeof notificationEmailConfigSchema>;
