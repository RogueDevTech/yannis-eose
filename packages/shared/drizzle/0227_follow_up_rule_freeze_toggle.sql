-- Add freeze_original toggle to follow_up_rules.
-- Default TRUE preserves existing behavior (follow-up freezes the source order).
-- When FALSE, the follow-up copy is created but the original stays active.
ALTER TABLE follow_up_rules ADD COLUMN IF NOT EXISTS freeze_original boolean NOT NULL DEFAULT true;

-- Mirror in history table
ALTER TABLE follow_up_rules_history ADD COLUMN IF NOT EXISTS freeze_original boolean;
