-- Migration 0277: Link contractors to payroll pay roles
--
-- Payroll Config (Roles) shows a STAFF headcount of 0 for contracted roles
-- (Cleaner, Video Editor, etc.) because the count only looks at users.
-- Contractors get an explicit pay_role_id so the Contractors module drives
-- role headcounts on Payroll Config.
--
-- History table gets the same column in the same migration: the temporal
-- trigger does SELECT ($1).* so any column drift breaks every UPDATE.
-- Idempotent via IF NOT EXISTS.

BEGIN;

ALTER TABLE payroll_contractors
  ADD COLUMN IF NOT EXISTS pay_role_id uuid REFERENCES payroll_pay_roles(id);

ALTER TABLE payroll_contractors_history
  ADD COLUMN IF NOT EXISTS pay_role_id uuid;

CREATE INDEX IF NOT EXISTS payroll_contractors_pay_role_id_idx
  ON payroll_contractors (pay_role_id);

-- Backfill: match existing contractors to a pay role in the same company by
-- job title = pay role name (case-insensitive). Explicit assignment wins later.
UPDATE payroll_contractors c
SET pay_role_id = pr.id
FROM payroll_pay_roles pr
WHERE c.pay_role_id IS NULL
  AND c.job_title IS NOT NULL
  AND pr.group_id = c.group_id
  AND pr.active = true
  AND pr.valid_to IS NULL
  AND lower(pr.name) = lower(c.job_title);

COMMIT;
