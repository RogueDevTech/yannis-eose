-- Sync users_history table with users table.
-- The 0002 migration added last_action_at to users but not users_history,
-- causing the temporal audit trigger to fail on INSERT INTO users_history SELECT ($1).*
ALTER TABLE "users_history" ADD COLUMN IF NOT EXISTS "last_action_at" timestamp with time zone;
