-- 0289: Correct the Annual Rent Relief basis.
--
-- Migration 0279 seeded the active tax-band config's rent relief with the WRONG
-- basis: `PERCENT_OF_GROSS` and no cap, so PAYE computed 20% of GROSS (uncapped)
-- and ignored each employee's declared `annual_rent`. The Nigerian rule (and
-- `defaultPayeBandConfig()` in code) is 20% of the employee's DECLARED annual
-- rent, capped at ₦500,000/yr. The compute path already handles
-- `PERCENT_OF_ANNUAL_RENT` correctly; only the stored config was stale.
--
-- Repair every active config's rent-relief row in place so the correct relief
-- surfaces on generated payroll.

UPDATE payroll_tax_band_configs
SET
  reliefs = '[{"name":"Annual Rent Relief (20%)","basis":"PERCENT_OF_ANNUAL_RENT","rate":20,"cap":500000}]'::jsonb,
  updated_at = now()
WHERE effective_to IS NULL
  AND reliefs @> '[{"name":"Annual Rent Relief (20%)"}]'::jsonb
  AND NOT (
    reliefs @> '[{"name":"Annual Rent Relief (20%)","basis":"PERCENT_OF_ANNUAL_RENT","rate":20,"cap":500000}]'::jsonb
  );
