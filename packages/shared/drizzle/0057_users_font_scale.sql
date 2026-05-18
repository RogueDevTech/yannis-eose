-- Per-user font scale preference; NULL = base (default)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "font_scale" text;
ALTER TABLE "users_history" ADD COLUMN IF NOT EXISTS "font_scale" text;
