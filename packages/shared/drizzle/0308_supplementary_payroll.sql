-- Migration 0308: Supplementary payroll batches.
--
-- Track A: a SUPPLEMENTARY batch pays the OUTSTANDING balance to complete an
-- already-paid original period. For each affected staff it recomputes the CORRECT
-- PAYE on the full intended salary, then pays (grossBalance - remainingPAYE), where
-- grossBalance = intendedGross - alreadyPaidGross and remainingPAYE = correctPAYE -
-- alreadyDeductedPAYE. This keeps statutory PAYE records accurate instead of taxing
-- the top-up as a fresh (untaxed) payment.
--
-- payroll_batches history is the POSITIONAL yannis_capture_history() trigger
-- (INSERT ... SELECT ($1).*), so new columns MUST be appended to the _history twin
-- in the SAME ORDER (see mig 0287/0264).

-- 1. New scope type.
ALTER TYPE payroll_batch_scope_type ADD VALUE IF NOT EXISTS 'SUPPLEMENTARY';

-- 2. Supplementary reference columns on payroll_batches.
ALTER TABLE payroll_batches
  ADD COLUMN IF NOT EXISTS references_period date;
ALTER TABLE payroll_batches
  ADD COLUMN IF NOT EXISTS references_batch_id uuid;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payroll_batches_history'
  ) THEN
    ALTER TABLE payroll_batches_history
      ADD COLUMN IF NOT EXISTS references_period date;
    ALTER TABLE payroll_batches_history
      ADD COLUMN IF NOT EXISTS references_batch_id uuid;
  END IF;
END $$;
