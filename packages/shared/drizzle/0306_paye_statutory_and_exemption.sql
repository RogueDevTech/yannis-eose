-- Migration 0306: PAYE statutory deductions + low-income exemption.
--
-- HR payroll corrections (Track D#5/#6):
--  1. Model Pension/NHIS as config-driven STATUTORY DEDUCTIONS taken off gross
--     before PAYE. Stored on payroll_tax_band_configs (per company group) so HR
--     can tune rates without a deploy, mirroring the existing reliefs JSONB.
--  2. Low-income PAYE exemption: staff whose monthly gross OR net-before-PAYE is
--     below `low_income_exemption_monthly` pay ZERO PAYE. Default ₦66,667/mo
--     (≈ the ₦800k/yr tax-free floor / 12). 0 disables the rule.
--  3. Persist per-payout statutory total + breakdown on payout_records so
--     payslips and the PAYE remittance export can show them.
--
-- HISTORY TWINS: payout_records_history and payroll_tax_band_configs_history use
-- the POSITIONAL yannis_capture_history() trigger (INSERT ... SELECT ($1).*), so
-- every column added to the live table MUST also be appended to its _history
-- twin in the SAME ORDER to keep the positional copy aligned (see mig 0264).

-- ── 1. payroll_tax_band_configs: statutory config + exemption threshold ──────
ALTER TABLE payroll_tax_band_configs
  ADD COLUMN IF NOT EXISTS statutory_deductions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE payroll_tax_band_configs
  ADD COLUMN IF NOT EXISTS low_income_exemption_monthly numeric(14, 2) NOT NULL DEFAULT 66667;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payroll_tax_band_configs_history'
  ) THEN
    ALTER TABLE payroll_tax_band_configs_history
      ADD COLUMN IF NOT EXISTS statutory_deductions jsonb;
    ALTER TABLE payroll_tax_band_configs_history
      ADD COLUMN IF NOT EXISTS low_income_exemption_monthly numeric(14, 2);
  END IF;
END $$;

-- ── 2. payout_records: persist statutory total + breakdown ───────────────────
ALTER TABLE payout_records
  ADD COLUMN IF NOT EXISTS statutory_total numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE payout_records
  ADD COLUMN IF NOT EXISTS statutory_breakdown jsonb DEFAULT '[]'::jsonb;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payout_records_history'
  ) THEN
    ALTER TABLE payout_records_history
      ADD COLUMN IF NOT EXISTS statutory_total numeric(12, 2);
    ALTER TABLE payout_records_history
      ADD COLUMN IF NOT EXISTS statutory_breakdown jsonb;
  END IF;
END $$;
