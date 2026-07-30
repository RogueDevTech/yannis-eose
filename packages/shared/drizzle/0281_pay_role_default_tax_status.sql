-- Migration 0281: Default tax status on pay roles
--
-- Payroll Config → role/formula editor owns the tax treatment for everyone
-- assigned to that role. STANDARD_PAYE by default; GROSS_NO_DEDUCTION = "None"
-- (no PAYE calculated). History table must stay in lockstep with the live table.

BEGIN;

ALTER TABLE payroll_pay_roles
  ADD COLUMN IF NOT EXISTS default_tax_status payroll_tax_status
    NOT NULL
    DEFAULT 'STANDARD_PAYE';

ALTER TABLE payroll_pay_roles_history
  ADD COLUMN IF NOT EXISTS default_tax_status payroll_tax_status;

COMMIT;
