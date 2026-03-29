import { z } from 'zod';

/** Must match concrete theme ids used by the Remix app (`~/lib/theme` APP_THEMES). */
export const APP_THEME_IDS = ['system', 'light', 'dark', 'dim', 'ink', 'soft'] as const;
export type AppThemeId = (typeof APP_THEME_IDS)[number];

export const appThemeIdSchema = z.enum(APP_THEME_IDS);

/** `system_settings.key` for org-wide UI defaults */
export const CLIENT_UI_CONFIG_KEY = 'client_ui_config' as const;

export const clientUiConfigSchema = z.object({
  defaultAppTheme: appThemeIdSchema,
});

export type ClientUiConfig = z.infer<typeof clientUiConfigSchema>;

/** `null` = clear preference (follow org default). */
export const updateMyAppThemeSchema = z.object({
  appTheme: appThemeIdSchema.nullable(),
});

export type UpdateMyAppThemeInput = z.infer<typeof updateMyAppThemeSchema>;

export const updateClientUiConfigSchema = clientUiConfigSchema;
