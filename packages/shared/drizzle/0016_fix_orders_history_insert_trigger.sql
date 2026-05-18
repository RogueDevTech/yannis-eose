-- ============================================
-- Fix: orders & order_items history insert triggers
-- The generic yannis_capture_history_insert uses EXECUTE ... USING NEW,
-- which causes postgres.js to fail serializing Date objects during
-- the prepared statement Bind phase.
-- Replace with explicit column-list triggers (same fix as 0012 for products).
-- ============================================

-- ── orders: explicit column trigger ─────────────────────────────

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_orders()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO orders_history (
    id, campaign_id, media_buyer_id, assigned_cs_id,
    logistics_provider_id, logistics_location_id, rider_id,
    status, items, customer_name, customer_phone_hash,
    customer_address, delivery_address,
    total_amount, landed_cost, delivery_fee,
    delivery_notes, parent_order_id,
    created_at, confirmed_at, allocated_at, dispatched_at, delivered_at,
    valid_from, valid_to, updated_at, modified_by,
    delivery_otp, delivery_gps_lat, delivery_gps_lng,
    callback_scheduled_at, callback_attempts, callback_notes,
    is_duplicate, duplicate_of_id, locked_until, locked_by
  ) VALUES (
    NEW.id, NEW.campaign_id, NEW.media_buyer_id, NEW.assigned_cs_id,
    NEW.logistics_provider_id, NEW.logistics_location_id, NEW.rider_id,
    NEW.status, NEW.items, NEW.customer_name, NEW.customer_phone_hash,
    NEW.customer_address, NEW.delivery_address,
    (NEW.total_amount)::numeric, (NEW.landed_cost)::numeric, (NEW.delivery_fee)::numeric,
    NEW.delivery_notes, NEW.parent_order_id,
    NEW.created_at, NEW.confirmed_at, NEW.allocated_at, NEW.dispatched_at, NEW.delivered_at,
    NEW.valid_from, NEW.valid_to, NEW.updated_at, NEW.modified_by,
    NEW.delivery_otp, (NEW.delivery_gps_lat)::numeric, (NEW.delivery_gps_lng)::numeric,
    NEW.callback_scheduled_at, NEW.callback_attempts, NEW.callback_notes,
    NEW.is_duplicate, NEW.duplicate_of_id, NEW.locked_until, NEW.locked_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace generic trigger with orders-specific one
DROP TRIGGER IF EXISTS trg_orders_capture_history_insert ON orders;
CREATE TRIGGER trg_orders_capture_history_insert
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_orders();

-- ── order_items: explicit column trigger ─────────────────────────

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_order_items()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO order_items_history (
    id, order_id, product_id, quantity,
    unit_price, batch_id,
    valid_from, valid_to, created_at, updated_at,
    modified_by, offer_label
  ) VALUES (
    NEW.id, NEW.order_id, NEW.product_id, NEW.quantity,
    (NEW.unit_price)::numeric, NEW.batch_id,
    NEW.valid_from, NEW.valid_to, NEW.created_at, NEW.updated_at,
    NEW.modified_by, NEW.offer_label
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace generic trigger with order_items-specific one
DROP TRIGGER IF EXISTS trg_order_items_capture_history_insert ON order_items;
CREATE TRIGGER trg_order_items_capture_history_insert
  AFTER INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_order_items();
