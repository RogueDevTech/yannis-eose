-- Finance Officer "hat" — lets exactly one user at a time carry Finance Officer powers
-- (column-level security unlock, finance approvals) on top of whatever their primary role is.
-- CEO directive (2026-04-23): finance is the only role that can be deputized this way; every
-- other role stays strictly single-assignment. See memory/project_finance_hat.md for context.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_finance_officer" boolean NOT NULL DEFAULT false;
ALTER TABLE "users_history" ADD COLUMN IF NOT EXISTS "is_finance_officer" boolean;

-- Partial unique index enforces the "at most one active Finance Hat" rule at the DB layer —
-- the application also checks and emits a friendlier error, this is the safety net.
CREATE UNIQUE INDEX IF NOT EXISTS "users_only_one_finance_officer"
  ON "users" ((1))
  WHERE "is_finance_officer" = true;
