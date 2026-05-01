-- CEO directive: track login activity per user. Each successful login increments
-- `login_count` and stamps `last_login_at` on the users row, which the temporal
-- trigger captures into `users_history` so the existing audit log surfaces every
-- login as a versioned change (no separate audit_events table needed).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "login_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz;

ALTER TABLE "users_history"
  ADD COLUMN IF NOT EXISTS "login_count" integer;

ALTER TABLE "users_history"
  ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz;
