-- Migration: add missing orders columns
-- Adds columns that exist in the Drizzle schema but were never migrated:
--   delivery_otp, delivery_gps_lat/lng, callback_*, is_duplicate,
--   duplicate_of_id, locked_until, locked_by
-- Also syncs orders_history so the temporal trigger stays consistent.

-- ── orders ────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_otp            text,
  ADD COLUMN IF NOT EXISTS delivery_gps_lat        numeric(10, 7),
  ADD COLUMN IF NOT EXISTS delivery_gps_lng        numeric(10, 7),
  ADD COLUMN IF NOT EXISTS callback_scheduled_at   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS callback_attempts       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS callback_notes          text,
  ADD COLUMN IF NOT EXISTS is_duplicate            text,
  ADD COLUMN IF NOT EXISTS duplicate_of_id         text,
  ADD COLUMN IF NOT EXISTS locked_until            timestamp with time zone,
  ADD COLUMN IF NOT EXISTS locked_by               text REFERENCES users(id);

-- ── orders_history (keep in sync with orders) ─────────────────

ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS delivery_otp            text,
  ADD COLUMN IF NOT EXISTS delivery_gps_lat        numeric(10, 7),
  ADD COLUMN IF NOT EXISTS delivery_gps_lng        numeric(10, 7),
  ADD COLUMN IF NOT EXISTS callback_scheduled_at   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS callback_attempts       integer,
  ADD COLUMN IF NOT EXISTS callback_notes          text,
  ADD COLUMN IF NOT EXISTS is_duplicate            text,
  ADD COLUMN IF NOT EXISTS duplicate_of_id         text,
  ADD COLUMN IF NOT EXISTS locked_until            timestamp with time zone,
  ADD COLUMN IF NOT EXISTS locked_by               text;
