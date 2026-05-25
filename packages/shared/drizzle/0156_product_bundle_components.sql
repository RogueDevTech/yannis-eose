-- Migration 0156: Product bundle components
-- Allows a product to be defined as a "bundle" composed of child products
-- with quantities. Inventory operations expand bundles into their components
-- so stock is checked/reserved/deducted from the child products.

CREATE TABLE IF NOT EXISTS product_bundle_components (
  id uuid PRIMARY KEY,
  bundle_product_id uuid NOT NULL REFERENCES products(id),
  component_product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL CHECK (quantity > 0),

  -- Temporal audit columns
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A product can only appear once as a component of a given bundle
  UNIQUE (bundle_product_id, component_product_id),
  -- A bundle cannot reference itself
  CHECK (bundle_product_id != component_product_id)
);

CREATE INDEX IF NOT EXISTS idx_bundle_components_bundle
  ON product_bundle_components (bundle_product_id);

CREATE INDEX IF NOT EXISTS idx_bundle_components_component
  ON product_bundle_components (component_product_id);

-- History table (same columns, no constraints)
CREATE TABLE IF NOT EXISTS product_bundle_components_history (LIKE product_bundle_components);

-- Temporal triggers
CREATE TRIGGER trg_product_bundle_components_stamp
  BEFORE INSERT OR UPDATE ON product_bundle_components
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

CREATE TRIGGER trg_product_bundle_components_history
  BEFORE UPDATE OR DELETE ON product_bundle_components
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

CREATE TRIGGER trg_product_bundle_components_history_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON product_bundle_components_history
  FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
