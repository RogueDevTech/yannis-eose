-- Add offers JSONB column to products (bundle pricing)
ALTER TABLE products ADD COLUMN IF NOT EXISTS offers jsonb NOT NULL DEFAULT '[]';

-- Add offer_label to order_items (records which bundle was selected)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS offer_label text;

-- Migrate existing products: create a "Standard" offer from baseSalePrice
UPDATE products SET offers = jsonb_build_array(
  jsonb_build_object('label', 'Standard', 'qty', 1, 'price', base_sale_price::text)
) WHERE offers = '[]'::jsonb;

-- Drop view that depends on sku before dropping the column
DROP VIEW IF EXISTS products_safe;

-- Remove SKU column and its unique constraint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_unique;
ALTER TABLE products DROP COLUMN IF EXISTS sku;

-- Recreate products_safe view without sku, with offers (cost_price masked for non-privileged roles)
CREATE OR REPLACE VIEW products_safe WITH (security_barrier = true) AS
SELECT
  id, name, description, offers, base_sale_price,
  CASE
    WHEN yannis_current_user_role() IN ('SUPER_ADMIN', 'FINANCE_OFFICER')
    THEN cost_price
    ELSE NULL
  END AS cost_price,
  min_threshold, category, category_id, status,
  valid_from, valid_to, modified_by,
  created_at, updated_at
FROM products;
