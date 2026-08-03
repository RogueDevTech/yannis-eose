-- Migration 0287: Payroll batches can be scoped to CONTRACTORS or ALL (no branch
-- / no department), not just the classic (branch × department × month) slot.
--
-- Context: CEO wants a payroll batch that groups contractors (who often have no
-- branch/department) or spans everyone company-wide. `scope_type` already exists
-- and becomes the AUTHORITATIVE discriminator; branch_id / department become
-- nullable for the two new null-scope types.
--
-- Safe to change freely: there are NO payroll batches in production as of
-- 2026-08-03, so no data migration / backfill and no dedup conflicts.
--
-- HISTORY-TRIGGER SAFETY: payroll_batches uses the generic capture functions
-- (INSERT INTO payroll_batches_history SELECT ($1).*), a positional copy. Any
-- column nullability change that lets the LIVE table hold NULLs must be mirrored
-- on the history table, or a NULL row fails the history NOT NULL and every
-- payroll_batches write breaks. Both tables are updated below.

-- 1. New scope-type enum values. Added in their own statements; must be committed
--    before any later migration/runtime references them as literals.
ALTER TYPE payroll_batch_scope_type ADD VALUE IF NOT EXISTS 'CONTRACTORS';
ALTER TYPE payroll_batch_scope_type ADD VALUE IF NOT EXISTS 'ALL';

-- 2. Live table: branch_id / department nullable for null-scope batches.
ALTER TABLE payroll_batches ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE payroll_batches ALTER COLUMN department DROP NOT NULL;

-- 3. Mirror onto payroll_batches_history (holds all historical shapes; never
--    rejects a captured row).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payroll_batches_history'
  ) THEN
    ALTER TABLE payroll_batches_history ALTER COLUMN branch_id DROP NOT NULL;
    ALTER TABLE payroll_batches_history ALTER COLUMN department DROP NOT NULL;
  END IF;
END $$;

-- 4. Replace the single unique index with two partial indexes so dedup still
--    holds with NULLs (Postgres treats NULL as distinct in a plain unique index,
--    which would let duplicate contractor/all batches slip through).
DROP INDEX IF EXISTS uq_payroll_batch_per_branch_dept_month;

-- 4a. Classic staff slot: one batch per (branch, month, department).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_batch_dept_slot
  ON payroll_batches (branch_id, period_month, department)
  WHERE branch_id IS NOT NULL AND department IS NOT NULL;

-- 4b. Null-scope slot (CONTRACTORS / ALL): one batch per
--     (scope_type, month, branch, run_label). branch_id is included so a Head can
--     run a CONTRACTORS batch for their own branch distinct from an org-wide one;
--     run_label distinguishes intentional re-runs. COALESCE keeps NULLs from
--     defeating uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_batch_null_scope
  ON payroll_batches (
    scope_type,
    period_month,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(run_label, '')
  )
  WHERE department IS NULL;
