-- ============================================
-- Migration 0340: Content-based identity for imported orders
-- ============================================
-- Adds orders.import_identity_key: a normalised fingerprint of an imported
-- order's CONTENT (customer phone + product + order date), so re-importing a
-- corrected file UPDATES the existing order instead of creating a duplicate,
-- even when the source system regenerated its Order IDs between exports.
--
-- WHY NOT PHONE ALONE (the obvious choice, and the wrong one):
--   Repeat customers are normal. In a 1,000-row sample, 34 orders shared 12
--   phone numbers — one line had THREE genuinely different orders (different
--   product, date and amount). Keying on phone would have overwritten two real
--   orders with the third. Phone identifies a CUSTOMER, never an ORDER.
--
-- THE KEY: sha256(normalised_phone | product_id | order_date)
--   * phone     — digits only, last 10. Collapses the format variants a real
--                 CRM export produces for one line: 08068880766, +234...,
--                 080-6888-0766, (080) 6888 0766.
--   * product   — the resolved product UUID, not the sheet's code text.
--   * date      — calendar day only (no time), in the order's own timezone.
--   Hashed rather than stored raw so no phone digits sit in a second column
--   (Pillar 2 — the raw phone already lives in orders.customer_phone and must
--   not be duplicated into an indexable plaintext column).
--
-- PRECEDENCE (see upsertImportOrderByExternalId):
--   1. import_external_id — still the primary key when the file has one and it
--      matches. Unchanged behaviour for every existing import.
--   2. import_identity_key — the fallback that catches a re-import whose Order
--      IDs changed. Only consulted for rows coming from an import.
--
-- The index is PARTIAL + non-unique on purpose. Non-unique because legitimate
-- same-customer/same-product/same-day orders DO exist (a customer ordering the
-- same item twice in one day); the app resolves those deterministically by
-- taking the oldest match rather than letting the DB reject the insert. A unique
-- index here would hard-fail those rows mid-import.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS import_identity_key text;

DO $$ BEGIN
  IF to_regclass('public.orders_history') IS NOT NULL THEN
    -- Keep the history twin schema-aligned in the SAME migration. orders_history
    -- uses the EXPLICIT-COLUMN, AFTER-INSERT-only trigger
    -- (yannis_capture_history_insert_orders, mig 0016), so appending a column
    -- does NOT break UPDATE writes here — unlike the generic
    -- `SELECT ($1).*` capture used by other twins. Added anyway so the two
    -- schemas never drift. Nullable, no default.
    ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS import_identity_key text;
  END IF;
END $$;

-- Lookup path for the fallback match. Partial: only imported rows carry a key.
CREATE INDEX IF NOT EXISTS orders_import_identity_key_idx
  ON orders (import_identity_key)
  WHERE import_identity_key IS NOT NULL;

COMMENT ON COLUMN orders.import_identity_key IS
  'sha256(normalised phone|product|order date) for imported orders. Fallback identity when import_external_id is absent or changed between exports, so a re-import repairs instead of duplicating.';
