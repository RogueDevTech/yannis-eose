-- ============================================
-- Migration 0341: Backfill accent colours for every non-base currency
-- ============================================
-- Migration 0326 added currencies.color but left it NULL, on the assumption an
-- admin would pick a colour when adding each currency. In practice most rows
-- were never coloured, so `currencyColorForCode()` returned NULL and foreign
-- currency orders rendered in the same neutral text as base (NGN) rows — the
-- whole point of the feature (telling countries apart at a glance in an order
-- list) silently did nothing.
--
-- This assigns a stable colour PER CURRENCY CODE, so the same currency reads the
-- same colour in every company. Palette is exactly the 8 presets offered in the
-- currency settings UI (CURRENCY_COLOR_PRESETS), so a backfilled value is
-- indistinguishable from one an admin picked by hand:
--   #22c55e green   #3b82f6 blue    #a855f7 purple  #ec4899 pink
--   #f97316 orange  #eab308 amber   #14b8a6 teal    #ef4444 red
--
-- Deliberate rules:
--   * ONLY rows where color IS NULL are touched — an admin's existing choice is
--     never overwritten. This also makes the migration idempotent and safe to
--     re-run.
--   * `is_default = false` ONLY. Base currency stays neutral BY DESIGN: it is
--     the reference every other colour is read against, and
--     currencyColorForCode() returns NULL for the default regardless of what
--     is stored. Colouring it would be dead data at best and, if the default
--     ever moved, misleading.
--   * Codes outside the list below fall through to a deterministic pick from
--     the same 8 presets (hashed on the code), so a currency added later still
--     gets a sensible, stable colour rather than staying invisible.
--
-- HISTORY TWIN (trigger-trap rule): currencies has a positional temporal
-- trigger — yannis_capture_history() does `SELECT ($1).*` against
-- currencies_history. This migration only UPDATEs existing rows and adds NO
-- columns, so the twin stays positionally aligned and needs no change here.
-- The UPDATE itself fires the trigger and writes history rows, which is correct:
-- the colour change is an audited mutation like any other.
--
-- ACTOR: yannis_stamp_actor() reads `yannis.current_user_id`, which is unset
-- during a migration; since 0066 that safely stamps modified_by = NULL (there
-- is no FK on the column). NULL is the right value here — this change was made
-- by a deploy, not by a person — and it matches every other data migration in
-- this folder, none of which set an actor.

UPDATE currencies
SET color = CASE upper(code)
    -- The currencies actually in use today get hand-picked, well-separated hues.
    WHEN 'GHS' THEN '#eab308'  -- amber  (Ghana)
    WHEN 'KES' THEN '#22c55e'  -- green  (Kenya)
    WHEN 'TZS' THEN '#3b82f6'  -- blue   (Tanzania)
    WHEN 'UGX' THEN '#a855f7'  -- purple (Uganda)
    WHEN 'ZAR' THEN '#ef4444'  -- red    (South Africa)
    WHEN 'EGP' THEN '#f97316'  -- orange (Egypt)
    WHEN 'XOF' THEN '#14b8a6'  -- teal   (West African CFA)
    WHEN 'XAF' THEN '#ec4899'  -- pink   (Central African CFA)
    WHEN 'MAD' THEN '#f97316'  -- orange (Morocco)
    WHEN 'RWF' THEN '#14b8a6'  -- teal   (Rwanda)
    WHEN 'ZMW' THEN '#a855f7'  -- purple (Zambia)
    WHEN 'ETB' THEN '#22c55e'  -- green  (Ethiopia)
    -- Anything else: deterministic pick from the same palette, keyed on the
    -- code so it is stable across companies and across re-runs.
    -- hashtext() can return -2147483648, whose abs() overflows a signed int
    -- and would abort the whole migration. Widen to bigint before abs().
    ELSE (ARRAY[
      '#22c55e', '#3b82f6', '#a855f7', '#ec4899',
      '#f97316', '#eab308', '#14b8a6', '#ef4444'
    ])[(abs(hashtext(upper(code))::bigint) % 8) + 1]
  END
WHERE color IS NULL
  AND is_default = false;

COMMENT ON COLUMN currencies.color IS
  'Accent colour tinting this currency''s order number + amount so foreign-currency rows stand out. NULL renders neutral. Base/default currency is always neutral regardless of value. Backfilled for non-default currencies in migration 0341.';
