-- Add order_source to orders for reporting (edge-form | offline).
-- Set by API on create; offline = CS manual entry, edge-form = sales form.

-- ── orders ────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_source text;

-- ── orders_history (keep in sync with orders) ─────────────────
ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS order_source text;

-- ── Update the explicit-column INSERT trigger ─────────────────
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_orders()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO orders_history (
    id, campaign_id, media_buyer_id, assigned_cs_id,
    logistics_provider_id, logistics_location_id, rider_id,
    status, items, customer_name, customer_phone_hash, customer_phone,
    customer_address, delivery_address,
    total_amount, landed_cost, delivery_fee,
    delivery_notes, delivery_proof_url, parent_order_id,
    order_source,
    created_at, confirmed_at, allocated_at, dispatched_at, delivered_at,
    valid_from, valid_to, updated_at, modified_by,
    delivery_otp, delivery_gps_lat, delivery_gps_lng,
    callback_scheduled_at, callback_attempts, callback_notes,
    is_duplicate, duplicate_of_id, locked_until, locked_by,
    delivery_state, customer_gender, preferred_delivery_date,
    payment_method, payment_status, payment_reference, payment_provider, customer_email
  ) VALUES (
    NEW.id, NEW.campaign_id, NEW.media_buyer_id, NEW.assigned_cs_id,
    NEW.logistics_provider_id, NEW.logistics_location_id, NEW.rider_id,
    NEW.status, NEW.items, NEW.customer_name, NEW.customer_phone_hash, NEW.customer_phone,
    NEW.customer_address, NEW.delivery_address,
    (NEW.total_amount)::numeric, (NEW.landed_cost)::numeric, (NEW.delivery_fee)::numeric,
    NEW.delivery_notes, NEW.delivery_proof_url, NEW.parent_order_id,
    NEW.order_source,
    NEW.created_at, NEW.confirmed_at, NEW.allocated_at, NEW.dispatched_at, NEW.delivered_at,
    NEW.valid_from, NEW.valid_to, NEW.updated_at, NEW.modified_by,
    NEW.delivery_otp, (NEW.delivery_gps_lat)::numeric, (NEW.delivery_gps_lng)::numeric,
    NEW.callback_scheduled_at, NEW.callback_attempts, NEW.callback_notes,
    NEW.is_duplicate, NEW.duplicate_of_id, NEW.locked_until, NEW.locked_by,
    NEW.delivery_state, NEW.customer_gender, NEW.preferred_delivery_date,
    NEW.payment_method, NEW.payment_status, NEW.payment_reference, NEW.payment_provider, NEW.customer_email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
