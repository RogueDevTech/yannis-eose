-- ============================================
-- Fix: yannis_capture_history_insert numeric type loss
-- When using SELECT ($1).* with USING NEW in dynamic SQL,
-- PostgreSQL loses numeric type info (params arrive as text).
-- Use products-specific trigger with explicit ::numeric casts.
-- ============================================

-- Sync products_history with products (0006 added offers, removed sku)
ALTER TABLE products_history ADD COLUMN IF NOT EXISTS offers jsonb NOT NULL DEFAULT '[]';
ALTER TABLE products_history DROP COLUMN IF EXISTS sku;

-- Products-specific: explicit cast for numeric columns
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_products()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO products_history (
    id, name, description, offers,
    base_sale_price, cost_price,
    category, category_id, status,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.name, NEW.description, NEW.offers,
    (NEW.base_sale_price)::numeric, (NEW.cost_price)::numeric,
    NEW.category, NEW.category_id, NEW.status,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop generic trigger for products, add products-specific one
DROP TRIGGER IF EXISTS trg_products_capture_history_insert ON products;
CREATE TRIGGER trg_products_capture_history_insert
  AFTER INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_products();

-- Keep generic function for other tables (unchanged behavior)
CREATE OR REPLACE FUNCTION yannis_capture_history_insert()
RETURNS TRIGGER AS $$
DECLARE
  _history_table TEXT;
BEGIN
  _history_table := TG_TABLE_NAME || '_history';
  EXECUTE format(
    'INSERT INTO %I SELECT ($1).*',
    _history_table
  ) USING NEW;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
