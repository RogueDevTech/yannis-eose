-- 0326_currency_color
--
-- Multi-currency: per-currency accent colour. Admin picks a colour when adding a
-- non-default currency; the app tints that currency's order number + amount so
-- foreign-currency rows are visually distinct from the base (NGN) rows.
--
-- Nullable — the base/default currency (and any currency without a colour) keeps
-- the current neutral rendering. Feature stays dormant until a 2nd currency
-- exists, so this column is inert on single-currency installs.
--
-- HISTORY TWIN (trigger-trap rule): currencies has a positional temporal trigger
-- (yannis_capture_history() does `SELECT ($1).*`). The column MUST be added to
-- BOTH currencies and currencies_history, appended in the same order, or every
-- UPDATE on currencies fails with a column-mismatch. Both tables started with an
-- identical column list (history was `LIKE currencies INCLUDING ALL`), so an
-- appended column stays positionally aligned across the twin.

ALTER TABLE currencies         ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE currencies_history ADD COLUMN IF NOT EXISTS color text;
