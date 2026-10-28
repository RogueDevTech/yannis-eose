-- Migration 0357: recurring per-staff allowances actually recur (2026-10-28).
--
-- A recurring allowance was linked to the FIRST payout that swept it
-- (payout_id set) and was never picked up again, so "Recurring monthly" only
-- changed proration and HR's monthly allowances silently stopped after one month.
--
-- New model:
--   * A recurring row with source_allowance_id NULL is the TEMPLATE. It is never
--     linked to a payout. period_month = first month it pays. HR edits it to
--     change future months and voids it to stop them.
--   * Each month's batch inserts a CHILD row (source_allowance_id = template.id,
--     period_month = that month) linked to that month's payout. One child per
--     template per month, so a paid month keeps its own immutable record.
--
-- Backfill: recurring rows already consumed by a payout become a template plus
-- one child carrying the old link (same payout, the batch's month).
--
-- payroll_staff_allowances IS system-versioned: the history twin gets the same
-- column in the same position (yannis_capture_history copies rows positionally).

ALTER TABLE payroll_staff_allowances
  ADD COLUMN IF NOT EXISTS source_allowance_id uuid REFERENCES payroll_staff_allowances(id);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payroll_staff_allowances_history'
  ) THEN
    ALTER TABLE payroll_staff_allowances_history ADD COLUMN IF NOT EXISTS source_allowance_id uuid;
  END IF;
END $$;

-- "Has this template already produced a row for month M?"
CREATE INDEX IF NOT EXISTS payroll_staff_allowances_source_month_idx
  ON payroll_staff_allowances (source_allowance_id, period_month)
  WHERE source_allowance_id IS NOT NULL;

-- Backfill 1: a child row for every consumed recurring allowance, carrying its link.
INSERT INTO payroll_staff_allowances
  (id, staff_id, amount, name, notes, recurring, status, approved_by, payout_id, period_month, created_at, source_allowance_id)
SELECT uuidv7(), a.staff_id, a.amount, a.name, a.notes, true, a.status, a.approved_by,
       a.payout_id, b.period_month, a.created_at, a.id
FROM payroll_staff_allowances a
JOIN payout_records p ON p.id = a.payout_id
JOIN payroll_batches b ON b.id = p.batch_id
WHERE a.recurring = true
  AND a.source_allowance_id IS NULL
  AND a.payout_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM payroll_staff_allowances c
    WHERE c.source_allowance_id = a.id AND c.period_month = b.period_month
  );

-- Backfill 2: unlink the templates. A NULL start month takes the consumed month.
UPDATE payroll_staff_allowances t
SET payout_id = NULL,
    period_month = COALESCE(t.period_month, c.period_month)
FROM payroll_staff_allowances c
WHERE c.source_allowance_id = t.id
  AND c.payout_id = t.payout_id
  AND t.recurring = true
  AND t.source_allowance_id IS NULL
  AND t.payout_id IS NOT NULL;
