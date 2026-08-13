-- Migration 0314: Fix system_settings_history missing group_id column.
--
-- BUG: migration 0189 added system_settings.group_id but never synced the
-- history twin system_settings_history. system_settings uses the GENERIC
-- positional history trigger (yannis_capture_history / _insert, which run
-- `INSERT INTO system_settings_history SELECT (NEW/OLD).*`). With the twin one
-- column short, every INSERT/UPDATE/DELETE on system_settings raised:
--   "INSERT has more expressions than target columns"
-- This blocked saving the attendance policy (and any other system_settings
-- write) whenever the row already existed (the UPDATE path fires the trigger).
--
-- FIX: append group_id to system_settings_history so its column order matches
-- system_settings exactly (group_id is the LAST column, position 11, on both).
-- The generic positional trigger needs no rebuild — appending is sufficient.
-- History twin columns are nullable with no default (a positional capture of any
-- pre-migration row version must never be rejected).

ALTER TABLE "system_settings_history"
  ADD COLUMN IF NOT EXISTS "group_id" uuid;
