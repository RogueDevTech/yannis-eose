-- ============================================
-- Multi-currency — Phase 7: Single-currency payroll batches (DORMANT)
-- ============================================
-- A payroll batch is single-currency: it pays one currency and totals never mix.
-- Currency lives on the BATCH (not on users) — this deliberately avoids touching
-- the users_history EXPLICIT-COLUMN trigger functions, which are actively edited
-- by the in-flight HR/PAYE-corrections work (mig 0306-0311). Per-staff pay
-- currency is the batch's currency.
--
-- DORMANT: default 'NGN' means every existing + future batch is unchanged until
-- HR creates a non-NGN batch. Non-NGN batches bypass the Nigerian PAYE engine
-- (flat pay; statutory NGN-only) — enforced in the shared pure helper
-- `isNigerianTaxCurrency()` (currency/payroll-currency.ts), NOT here.
--
-- payroll_batches uses the GENERIC POSITIONAL history trigger (0067 created it
-- via `LIKE ... INCLUDING ALL` with PK/uniques dropped). Appending currency_code
-- to BOTH payroll_batches and payroll_batches_history keeps column order aligned.

ALTER TABLE payroll_batches
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'NGN';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'payroll_batches_history') THEN
    -- History twin: nullable, no default (positional capture of pre-migration rows).
    ALTER TABLE payroll_batches_history
      ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;
