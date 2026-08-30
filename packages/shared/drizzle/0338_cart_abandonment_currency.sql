-- 0338: Capture currency on cart abandonments so cart orders can route + graduate
-- per-country.
--
-- Cart intake (cart.save, edge form) now stamps the customer's selected currency
-- onto cart_abandonments — the SAME value orders.create already stamps
-- (STAMP-never-reject: absent/blank → NGN downstream). This is what
-- 0337 (routing-rule currency) needs to match against: without a currency ON the
-- cart, every cart defaulted to NGN and country-scoped cart routing was inert.
--
-- Nullable (NOT NGN-default) on purpose: a progressive phone-only save may land
-- before the customer picks a currency, and the downstream consumers default a
-- NULL to NGN. History twin synced in the SAME migration (mandatory — a column
-- mismatch between a table and its _history twin makes ALL updates fail; see
-- MEMORY feedback_history_table_trigger_trap and the 0257 precedent).

ALTER TABLE cart_abandonments
  ADD COLUMN IF NOT EXISTS currency_code text;

ALTER TABLE cart_abandonments_history
  ADD COLUMN IF NOT EXISTS currency_code text;
