-- Migration 0280: Contractor tax status (PAYE treatment on monthly fee)
--
-- Contractors already link to pay roles for headcount. Tax was hardcoded to 0
-- on batch generate. Add per-contractor tax_status (same enum as users) so
-- Payroll Config assign / contractor edit can stamp STANDARD_PAYE (or other)
-- and monthly batches deduct via company tax bands.
--
-- Default GROSS_NO_DEDUCTION preserves today's "no PAYE" behaviour for existing
-- rows until HR assigns a taxable status.
-- History table gets the same column: temporal trigger SELECT ($1).* requires it.

BEGIN;

ALTER TABLE payroll_contractors
  ADD COLUMN IF NOT EXISTS tax_status payroll_tax_status
    NOT NULL
    DEFAULT 'GROSS_NO_DEDUCTION';

ALTER TABLE payroll_contractors_history
  ADD COLUMN IF NOT EXISTS tax_status payroll_tax_status;

COMMIT;
