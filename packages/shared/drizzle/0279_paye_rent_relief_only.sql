-- 0279: PAYE reliefs = Annual Rent Relief (20%) only; drop NHF/Pension.
-- Also ensure the lowest (from 0) progressive band rate is at least 15%.

UPDATE payroll_tax_band_configs
SET
  reliefs = '[{"name":"Annual Rent Relief (20%)","basis":"PERCENT_OF_GROSS","rate":20}]'::jsonb,
  updated_at = now()
WHERE effective_to IS NULL
  AND (
    reliefs @> '[{"name":"Pension (8%)"}]'::jsonb
    OR reliefs @> '[{"name":"NHF (2.5%)"}]'::jsonb
    OR reliefs = '[]'::jsonb
    OR NOT (reliefs @> '[{"name":"Annual Rent Relief (20%)"}]'::jsonb)
  );

-- Raise first-band rates below 15% up to the HR minimum.
UPDATE payroll_tax_band_configs
SET
  bands = (
    SELECT jsonb_agg(
      CASE
        WHEN (band->>'fromAmount')::numeric = 0
          AND COALESCE((band->>'rate')::numeric, 0) < 15
        THEN jsonb_set(band, '{rate}', '15')
        ELSE band
      END
      ORDER BY ordinality
    )
    FROM jsonb_array_elements(bands) WITH ORDINALITY AS t(band, ordinality)
  ),
  updated_at = now()
WHERE effective_to IS NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(bands) AS band
    WHERE (band->>'fromAmount')::numeric = 0
      AND COALESCE((band->>'rate')::numeric, 0) < 15
  );
