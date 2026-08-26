-- ============================================
-- Migration 0333: product + logistics-provider display numbers (PDT-N / LOG-N)
-- ============================================
-- Human-facing incremental codes so a person filling a bulk-import sheet can
-- reference a product / logistics provider by a short code (rendered app-side as
-- "PDT-1", "LOG-1") instead of pasting a UUID. Mirrors the existing precedents:
--   - orders.order_number   (serial, mig 0149, shown as YNS-XXXXX)
--   - users.user_number     (serial, mig 0256, shown as USR-N)
--   - branches.code         (text,   already present)
-- Only the integer is stored; the "PDT-"/"LOG-" prefix is cosmetic (app-side).
-- Codes are GLOBAL (one shared sequence per table), matching order_number /
-- user_number. Company isolation is enforced at RESOLVE time in the importer
-- (a code only resolves to an entity in the caller's company), not by the code.
--
-- History-twin trigger notes (verified against dev before writing):
--   - products            → EXPLICIT-column INSERT trigger
--     (yannis_capture_history_insert_products, mig 0012). Must be rebuilt to
--     carry the new column, else history INSERT rows get NULL product_number.
--   - logistics_providers → GENERIC positional INSERT trigger
--     (yannis_capture_history_insert = SELECT ($1).*). No function rebuild; but
--     the column MUST be appended to BOTH table and twin so positional parity
--     (required by the generic UPDATE trigger yannis_capture_history) holds.

-- ── 1. products.product_number + products_history twin ───────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_number serial;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products_history') THEN
    -- Nullable, no default on the twin (house rule).
    ALTER TABLE products_history ADD COLUMN IF NOT EXISTS product_number integer;
  END IF;
END $$;

-- Backfill existing products in creation order so numbers read as PDT-1, PDT-2…
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM products WHERE product_number IS NULL
)
UPDATE products SET product_number = numbered.rn
FROM numbered WHERE products.id = numbered.id;

-- Advance the serial's sequence past the current max so new inserts never collide.
SELECT setval(
  pg_get_serial_sequence('products','product_number'),
  COALESCE((SELECT MAX(product_number) FROM products), 0) + 1,
  false
);

CREATE UNIQUE INDEX IF NOT EXISTS products_product_number_uidx ON products (product_number);

-- Rebuild the explicit products INSERT-capture function to carry product_number.
-- (Keeps the numeric ::casts from mig 0012 that prevent text-type loss.)
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_products()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO products_history (
    id, name, description, offers,
    base_sale_price, cost_price,
    category, category_id, status,
    product_number,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.name, NEW.description, NEW.offers,
    (NEW.base_sale_price)::numeric, (NEW.cost_price)::numeric,
    NEW.category, NEW.category_id, NEW.status,
    NEW.product_number,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. logistics_providers.provider_number + history twin ────────────────────
-- Generic positional capture: append to BOTH so SELECT ($1).* parity holds.
ALTER TABLE logistics_providers ADD COLUMN IF NOT EXISTS provider_number serial;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='logistics_providers_history') THEN
    ALTER TABLE logistics_providers_history ADD COLUMN IF NOT EXISTS provider_number integer;
  END IF;
END $$;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM logistics_providers WHERE provider_number IS NULL
)
UPDATE logistics_providers SET provider_number = numbered.rn
FROM numbered WHERE logistics_providers.id = numbered.id;

SELECT setval(
  pg_get_serial_sequence('logistics_providers','provider_number'),
  COALESCE((SELECT MAX(provider_number) FROM logistics_providers), 0) + 1,
  false
);

CREATE UNIQUE INDEX IF NOT EXISTS logistics_providers_provider_number_uidx
  ON logistics_providers (provider_number);
