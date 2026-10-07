-- Migration 0351: orders.offer_check — "Check price" flag (2026-10-07).
--
-- The public order form's offer/price check used to REJECT a submit whose
-- price/quantity/label did not match an active offer (the customer saw an error
-- and ended up in Carts). It now accepts the order and records why it did not
-- match here. CS must clear the flag ("Price checked") before CONFIRMED.
--   PRICE_NOT_IN_OFFERS  submitted line matches no active offer tier
--   NO_ACTIVE_OFFERS     the form's offer group has no active items
--   PRODUCT_NOT_ON_FORM  submitted product is not the form's product
--   PRODUCT_MISSING      the form's product no longer exists
--   CHECK_UNAVAILABLE    the check itself errored; verify by hand
-- NULL = matched (or not an edge-form order).
--
-- orders IS system-versioned: orders_history gets the same column in the same
-- migration (yannis_capture_history copies rows positionally).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_check text;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders_history'
  ) THEN
    ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS offer_check text;
  END IF;
END $$;
