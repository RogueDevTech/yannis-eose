-- Add age_relative_to column to follow_up_rules.
-- Controls which timestamp the age threshold is measured from:
--   STATUS_TIMESTAMP (default) — confirmedAt, allocatedAt, etc.
--   CREATED_AT — order creation date
--   PREFERRED_DELIVERY_DATE — scheduled delivery date
ALTER TABLE "follow_up_rules"
  ADD COLUMN IF NOT EXISTS "age_relative_to" text NOT NULL DEFAULT 'STATUS_TIMESTAMP';
