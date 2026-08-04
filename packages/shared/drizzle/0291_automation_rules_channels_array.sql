-- 0291: Marketing automation rules can now target MULTIPLE channels.
--
-- The rule model moves from a single `channel` enum to a `channels text[]` list
-- (Email + SMS + WhatsApp selectable together). A multi-channel rule fans out at
-- send time into one job per channel; automation_jobs.channel stays single.
--
-- HISTORY-TRIGGER SAFETY: automation_rules has a capture-history twin
-- (automation_rules_history) fed by yannis_capture_history() which does a
-- positional `INSERT ... SELECT ($1).*`. The new column MUST be added to BOTH
-- tables in the same migration, or every UPDATE/DELETE on automation_rules fails.

-- 1. Add channels array to the live table, backfilled from the existing channel.
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS channels text[];
UPDATE automation_rules SET channels = ARRAY[channel::text] WHERE channels IS NULL;
ALTER TABLE automation_rules ALTER COLUMN channels SET DEFAULT '{}';
ALTER TABLE automation_rules ALTER COLUMN channels SET NOT NULL;

-- 2. The legacy single `channel` column becomes nullable: new multi-channel rules
--    write `channels` only and no longer set `channel`. Kept (not dropped) so nothing
--    breaks mid-deploy; a later migration can drop it once all reads use `channels`.
ALTER TABLE automation_rules ALTER COLUMN channel DROP NOT NULL;

-- 3. Mirror onto the history table (must stay positionally aligned).
ALTER TABLE automation_rules_history ADD COLUMN IF NOT EXISTS channels text[];
