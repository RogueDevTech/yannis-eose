-- Migration 0186: Add max_age_days to follow_up_rules for date range support.
-- When set, the rule matches orders between age_threshold_days and max_age_days old.
-- When NULL, it matches all orders older than age_threshold_days (no upper bound).
ALTER TABLE follow_up_rules ADD COLUMN IF NOT EXISTS max_age_days integer;
