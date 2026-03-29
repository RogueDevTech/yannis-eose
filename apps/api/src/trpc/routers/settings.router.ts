import {
  updateSystemSettingSchema,
  notificationEmailConfigSchema,
  CLIENT_UI_CONFIG_KEY,
  clientUiConfigSchema,
  updateClientUiConfigSchema,
  type AppThemeId,
} from '@yannis/shared';
import {
  NOTIFICATION_EMAIL_CONFIG_KEY,
  CONFIGURABLE_EMAIL_TYPES,
  MANDATORY_EMAIL_TYPES,
  NOTIFICATION_TYPE_META,
} from '@yannis/shared';
import { eq } from 'drizzle-orm';
import { router, authedProcedure, permissionProcedure, publicProcedure } from '../trpc';
import type { SettingsService } from '../../settings/settings.service';
import { db as schema } from '@yannis/shared';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

function resolveDefaultAppTheme(raw: Record<string, unknown> | null): AppThemeId {
  const merged = { defaultAppTheme: 'system' as const, ...(raw ?? {}) };
  const parsed = clientUiConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data.defaultAppTheme : 'system';
}

let settingsServiceInstance: SettingsService | null = null;
let settingsDbInstance: PostgresJsDatabase<typeof schema> | null = null;

export function setSettingsService(service: SettingsService) {
  settingsServiceInstance = service;
}

export function setSettingsDb(db: PostgresJsDatabase<typeof schema>) {
  settingsDbInstance = db;
}

function getSettingsDb(): PostgresJsDatabase<typeof schema> {
  if (!settingsDbInstance) {
    throw new Error('Settings DB not initialized. Call setSettingsDb() first.');
  }
  return settingsDbInstance;
}

function getSettingsService(): SettingsService {
  if (!settingsServiceInstance) {
    throw new Error('SettingsService not initialized. Call setSettingsService() first.');
  }
  return settingsServiceInstance;
}

export const settingsRouter = router({
  /**
   * Public UI defaults + effective theme for the current session (if any).
   * Anonymous callers receive org default only.
   */
  getClientConfig: publicProcedure.query(async ({ ctx }) => {
    const raw = await getSettingsService().get(CLIENT_UI_CONFIG_KEY);
    const defaultAppTheme = resolveDefaultAppTheme(raw);
    let appThemePreference: string | null = null;
    if (ctx.user) {
      const [row] = await getSettingsDb()
        .select({ appTheme: schema.users.appTheme })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.user.id))
        .limit(1);
      appThemePreference = row?.appTheme ?? null;
    }
    const effectiveAppTheme = appThemePreference ?? defaultAppTheme;
    return {
      defaultAppTheme,
      appThemePreference,
      effectiveAppTheme,
    };
  }),

  /**
   * Update org-wide default appearance (system_settings.client_ui_config).
   */
  updateClientUiConfig: permissionProcedure('settings.write')
    .input(updateClientUiConfigSchema)
    .mutation(async ({ input, ctx }) => {
      await getSettingsService().set(
        CLIENT_UI_CONFIG_KEY,
        { defaultAppTheme: input.defaultAppTheme },
        ctx.user.id,
      );
      return { success: true };
    }),

  /**
   * Get all system settings.
   * Any authenticated user can read (CS pages need to know the mode).
   */
  getSystemSettings: authedProcedure.query(async () => {
    return getSettingsService().getAll();
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
