-- Per-user notification preferences. Each user can opt OUT of any notification type
-- that targets them (in-app, push, and email all gated on the same preference flag).
-- Default empty object = pass-through (every type that would otherwise reach the user
-- still does). Setting `notification_preferences[type] = false` skips the entire
-- fan-out for that user (no DB row, no socket emit, no push, no email).
--
-- The history table mirrors the column so temporal audit captures the change.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "users_history"
  ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb;
