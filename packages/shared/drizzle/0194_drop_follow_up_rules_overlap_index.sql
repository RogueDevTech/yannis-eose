-- Allow multiple rules for the same source_status + branch combo
-- (e.g. CS_ENGAGED >3d and CS_ENGAGED >30d with different age ranges).
DROP INDEX IF EXISTS idx_follow_up_rules_no_overlap;
