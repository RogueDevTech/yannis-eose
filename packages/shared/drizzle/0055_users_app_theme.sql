-- Per-user appearance preference; NULL = org default (system_settings.client_ui_config)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "app_theme" text;
ALTER TABLE "users_history" ADD COLUMN IF NOT EXISTS "app_theme" text;
