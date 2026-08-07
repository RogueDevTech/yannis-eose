-- 0299: Automation message templates support MULTIPLE channels.
--
-- A template moves from a single `channel` enum to a `channels` array, so one
-- template can be reused across Email + SMS + WhatsApp (same body; subject used
-- only for email). The rule picker matches a template when it covers a selected
-- channel.
--
-- HISTORY-TRIGGER SAFETY (learned from 0291's drift, fixed in 0298):
-- automation_message_templates has a capture-history twin fed by
-- yannis_capture_history() which does a positional `INSERT ... SELECT ($1).*`.
-- The new column MUST be added to BOTH tables, and the relaxed NOT NULL on the
-- old column MUST be mirrored to BOTH, or every write fails.

-- 1. Live table: add channels array, backfill from the existing single channel.
ALTER TABLE automation_message_templates ADD COLUMN IF NOT EXISTS channels text[];
UPDATE automation_message_templates SET channels = ARRAY[channel::text] WHERE channels IS NULL;
ALTER TABLE automation_message_templates ALTER COLUMN channels SET DEFAULT '{}';
ALTER TABLE automation_message_templates ALTER COLUMN channels SET NOT NULL;

-- 2. Legacy single `channel` becomes nullable (new templates write `channels`).
ALTER TABLE automation_message_templates ALTER COLUMN channel DROP NOT NULL;

-- 3. Mirror BOTH changes onto the history twin (positional alignment + matching
--    nullability, so a NULL channel in a captured row never trips a stale constraint).
ALTER TABLE automation_message_templates_history ADD COLUMN IF NOT EXISTS channels text[];
ALTER TABLE automation_message_templates_history ALTER COLUMN channel DROP NOT NULL;
