-- Migration 0360: grant Media Buyers the countries of the forms they run (2026-11-08).
--
-- 581b6a3a limits a Media Buyer to building forms for the countries in their
-- user_countries grant (per company; no grant = base country only). Until then
-- MBs could build any country's form, so MBs running Ghana / Tanzania / Zambia /
-- Kenya forms were never granted those countries. Without this backfill they
-- could no longer create or re-country forms for markets they already run.
--
-- A form's country = formConfig.pinnedCurrency, else the currency of its
-- formConfig.deliveryCountry in that company, else the company base currency
-- (same rule as MarketingService.formConfigCurrencyCodes). ACTIVE forms only.
--
-- ADDS rows only, never removes a grant; idempotent (ON CONFLICT DO NOTHING).
-- An MB with NO grant in a company implicitly has its base country today; that
-- base is granted explicitly too, so adding Ghana never takes Nigeria away.
--
-- Sessions carry currencyCodes from login: affected MBs pick the new grant up on
-- their next login or company switch.

WITH form_country AS (
  SELECT DISTINCT c.media_buyer_id AS user_id, b.group_id,
         COALESCE(
           NULLIF(upper(trim(c.form_config->>'pinnedCurrency')), ''),
           (SELECT cur.code FROM currencies cur
             WHERE cur.group_id = b.group_id AND cur.active
               AND lower(trim(cur.country_name)) = lower(trim(c.form_config->>'deliveryCountry'))
             LIMIT 1),
           (SELECT cur.code FROM currencies cur
             WHERE cur.group_id = b.group_id AND cur.active AND cur.is_default LIMIT 1)
         ) AS currency_code
  FROM campaigns c
  JOIN branches b ON b.id = c.branch_id
  JOIN users u ON u.id = c.media_buyer_id
  WHERE c.valid_to IS NULL AND c.status = 'ACTIVE' AND u.role = 'MEDIA_BUYER'
    AND b.group_id IS NOT NULL
),
-- An MB with NO grant in a company currently gets its base country implicitly.
-- Keep that: granting only Ghana would otherwise take Nigeria away.
keep_base AS (
  SELECT DISTINCT fc.user_id, fc.group_id, cur.code AS currency_code
  FROM form_country fc
  JOIN currencies cur ON cur.group_id = fc.group_id AND cur.active AND cur.is_default
  WHERE NOT EXISTS (SELECT 1 FROM user_countries uc
                     WHERE uc.user_id = fc.user_id AND uc.group_id = fc.group_id)
)
INSERT INTO user_countries (user_id, group_id, currency_code)
SELECT user_id, group_id, currency_code FROM form_country WHERE currency_code IS NOT NULL
UNION
SELECT user_id, group_id, currency_code FROM keep_base
ON CONFLICT (user_id, group_id, currency_code) DO NOTHING;
