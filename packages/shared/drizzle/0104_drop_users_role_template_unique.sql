-- 0104_drop_users_role_template_unique.sql
--
-- Drop the wrongly-scoped UNIQUE index `uq_users_role_template_id_not_null` from
-- migration 0093. The constraint allowed only one user to point at any given
-- `role_template_id`, but SYSTEM templates are shared by every user with that
-- role (every CS_AGENT user points to `system_CS_AGENT`, every MEDIA_BUYER
-- points to `system_MEDIA_BUYER`, etc.). The constraint silently blocked the
-- creation of the second user in any role with:
--   "duplicate key value violates unique constraint
--    \"uq_users_role_template_id_not_null\""
--
-- Fix: drop the unique index. Keep the regular `idx_users_role_template_id`
-- index — that one is correctly non-unique and useful for "find all users on
-- this template" queries.
--
-- This was a regression in 0093; no replacement constraint is needed because
-- many-users-per-template is the intended design.

DROP INDEX IF EXISTS uq_users_role_template_id_not_null;
