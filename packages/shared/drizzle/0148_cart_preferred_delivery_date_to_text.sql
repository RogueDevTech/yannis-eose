-- Migration 0148: Change cart_abandonments.preferred_delivery_date from DATE to TEXT
--
-- The form sends freetext delivery preference strings like "As soon as possible",
-- "Within 1-2 days", "Next week" — not ISO date values. The orders table already
-- stores this as TEXT; the cart table was incorrectly typed as DATE, causing
-- PostgresError on every cart.save with a delivery preference selected.

ALTER TABLE cart_abandonments
  ALTER COLUMN preferred_delivery_date TYPE text
  USING preferred_delivery_date::text;
