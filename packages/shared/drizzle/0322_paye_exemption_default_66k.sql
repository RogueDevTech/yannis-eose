-- Migration 0322: PAYE low-income exemption default ₦66,667 → ₦66,000.
--
-- HR policy update: the monthly PAYE exemption floor is now ₦66,000 (statutory
-- minimum-wage floor) rather than the old ₦800k/yr ÷ 12 ≈ ₦66,667. Staff whose
-- monthly gross OR net-before-PAYE falls below this pay ZERO PAYE. The value is
-- config-driven per company (payroll_tax_band_configs.low_income_exemption_monthly);
-- this migration moves the column DEFAULT and re-bases existing rows that still
-- carry the old default.
--
-- SAFETY: we only UPDATE rows that still hold the exact old default 66667. Any
-- company where HR deliberately customized the threshold (to any other value,
-- including 0 = disabled) is left untouched.
--
-- No column added → no history-twin structural change required (the positional
-- yannis_capture_history() copy is unaffected by a DEFAULT change).

-- ── 1. Move the column default ───────────────────────────────────────────────
ALTER TABLE payroll_tax_band_configs
  ALTER COLUMN low_income_exemption_monthly SET DEFAULT 66000;

-- ── 2. Re-base existing rows still on the old default (only exact 66667) ──────
UPDATE payroll_tax_band_configs
  SET low_income_exemption_monthly = 66000
  WHERE low_income_exemption_monthly = 66667;
