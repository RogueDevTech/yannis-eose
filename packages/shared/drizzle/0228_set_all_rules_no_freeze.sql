-- Set all existing follow-up rules to no-freeze mode.
-- New follow-ups will still be created but the original order stays active.
UPDATE follow_up_rules SET freeze_original = false WHERE freeze_original = true;
