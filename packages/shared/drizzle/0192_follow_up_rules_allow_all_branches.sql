-- Allow follow-up rules to target ALL branches (round-robin distribution)
-- by dropping the XOR constraint that required exactly one of target_branch_id or target_group_id.
ALTER TABLE follow_up_rules DROP CONSTRAINT IF EXISTS follow_up_rules_target_xor;
