-- system_settings: drop the leftover key-only unique constraint.
--
-- 0019 created `key text NOT NULL UNIQUE`, which Postgres names
-- `system_settings_key_key`. 0189 (per-company settings) dropped
-- `system_settings_key_unique`, a name that never existed, so the key-only
-- constraint survived. Every setting could exist once system-wide, and saving
-- a setting for a second company failed with a duplicate-key error.
-- `system_settings_key_group_uniq` (key, group_id) from 0189 stays the real rule.
ALTER TABLE "system_settings" DROP CONSTRAINT IF EXISTS "system_settings_key_key";
