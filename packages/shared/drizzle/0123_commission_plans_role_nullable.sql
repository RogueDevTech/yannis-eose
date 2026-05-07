-- Allow commission plans without a fixed role ("per-user assignment" templates).
ALTER TABLE commission_plans ALTER COLUMN role DROP NOT NULL;

-- Keep temporal/history aligned with main table trigger expectations.
ALTER TABLE commission_plans_history ALTER COLUMN role DROP NOT NULL;
