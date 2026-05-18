-- ============================================
-- Fix: stock_batches INSERT history trigger numeric safety
-- The generic INSERT trigger can coerce numeric payloads through dynamic SQL paths.
-- Use a stock_batches-specific trigger with explicit ::numeric casts.
-- ============================================

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_stock_batches()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO stock_batches_history (
    id,
    product_id,
    factory_cost,
    landing_cost,
    total_landed_cost,
    quantity,
    remaining_quantity,
    received_at,
    valid_from,
    valid_to,
    modified_by,
    created_at,
    updated_at
  ) SELECT
    NEW.id,
    NEW.product_id,
    (NEW.factory_cost)::numeric,
    (NEW.landing_cost)::numeric,
    (NEW.total_landed_cost)::numeric,
    NEW.quantity,
    NEW.remaining_quantity,
    NEW.received_at,
    NEW.valid_from,
    NEW.valid_to,
    NEW.modified_by,
    NEW.created_at,
    NEW.updated_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_batches_capture_history_insert ON stock_batches;
CREATE TRIGGER trg_stock_batches_capture_history_insert
  AFTER INSERT ON stock_batches
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_stock_batches();
