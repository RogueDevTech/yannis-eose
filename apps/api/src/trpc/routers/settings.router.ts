import {
  updateSystemSettingSchema,
  notificationEmailConfigSchema,
} from '@yannis/shared';
import {
  NOTIFICATION_EMAIL_CONFIG_KEY,
  CONFIGURABLE_EMAIL_TYPES,
  MANDATORY_EMAIL_TYPES,
  NOTIFICATION_TYPE_META,
} from '@yannis/shared';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import type { SettingsService } from '../../settings/settings.service';

let settingsServiceInstance: SettingsService | null = null;

export function setSettingsService(service: SettingsService) {
  settingsServiceInstance = service;
}

function getSettingsService(): SettingsService {
  if (!settingsServiceInstance) {
    throw new Error('SettingsService not initialized. Call setSettingsService() first.');
  }
  return settingsServiceInstance;
}

export const settingsRouter = router({
  /**
   * Get all system settings.
   * Any authenticated user can read (CS pages need to know the mode).
   */
  getSystemSettings: authedProcedure.query(async () => {
    return getSettingsService().getAll();
  }),

  /**
   * Check if strict data mode is enabled.
   * Lightweight endpoint for CS agents to check mode.
   */
  isStrictDataMode: authedProcedure.query(async () => {
    const enabled = await getSettingsService().isStrictDataMode();
    return { enabled };
  }),

  /**
   * Get notification email config — which types send email.
   * SuperAdmin only.
   */
  getNotificationEmailConfig: permissionProcedure('settings.write').query(async () => {
    const config = await getSettingsService().get(NOTIFICATION_EMAIL_CONFIG_KEY);
    const enabledTypes = (config?.['enabledTypes'] as Record<string, boolean>) ?? {};

    const configurable = CONFIGURABLE_EMAIL_TYPES.map((t) => ({
      ...NOTIFICATION_TYPE_META[t],
      emailEnabled: enabledTypes[t] ?? false,
    }));

    const mandatory = MANDATORY_EMAIL_TYPES.map((t) => ({
      ...NOTIFICATION_TYPE_META[t],
      emailEnabled: true,
    }));

    return { configurable, mandatory };
  }),

  /**
   * Update notification email config — toggle which configurable types send email.
   * SuperAdmin only.
   */
  updateNotificationEmailConfig: permissionProcedure('settings.write')
    .input(notificationEmailConfigSchema)
    .mutation(async ({ input, ctx }) => {
      await getSettingsService().set(
        NOTIFICATION_EMAIL_CONFIG_KEY,
        { enabledTypes: input.enabledTypes },
        ctx.user.id,
      );
      return { success: true };
    }),

  /**
   * Update a system setting.
   * SUPER_ADMIN only — changes are audit-logged.
   */
  updateSystemSetting: permissionProcedure('settings.write')
    .input(updateSystemSettingSchema)
    .mutation(async ({ input, ctx }) => {
      await getSettingsService().set(input.key, input.value, ctx.user.id);
      return { success: true };
    }),
});
