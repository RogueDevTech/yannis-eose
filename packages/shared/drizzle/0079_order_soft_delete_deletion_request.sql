-- Soft-delete orders (never hard-delete) + CS-initiated archive approval workflow.
ALTER TYPE "permission_request_type" ADD VALUE IF NOT EXISTS 'ORDER_DELETION';
ALTER TYPE "timeline_event_type" ADD VALUE IF NOT EXISTS 'ORDER_ARCHIVED';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Keep INSERT history trigger aligned with live orders row shape (includes branch_id, custom_fields, order_source, deleted_at).
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_orders()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO orders_history (
    id, campaign_id, media_buyer_id, assigned_cs_id,
    logistics_provider_id, logistics_location_id, rider_id,
    status, items, customer_name, customer_phone_hash, customer_phone,
    customer_address, delivery_address,
    total_amount, landed_cost, delivery_fee,
    delivery_notes, delivery_state, customer_gender, preferred_delivery_date,
    delivery_otp, delivery_gps_lat, delivery_gps_lng,
    delivery_proof_url, delivery_discount_amount, resolve_receipt_url, parent_order_id,
    payment_method, payment_status, payment_reference, payment_provider, customer_email,
    callback_scheduled_at, callback_attempts, callback_notes,
    is_duplicate, duplicate_of_id, locked_until, locked_by,
    order_source, custom_fields, branch_id,
    created_at, confirmed_at, allocated_at, dispatched_at, delivered_at,
    deleted_at,
    valid_from, valid_to, modified_by, updated_at
  ) VALUES (
    NEW.id, NEW.campaign_id, NEW.media_buyer_id, NEW.assigned_cs_id,
    NEW.logistics_provider_id, NEW.logistics_location_id, NEW.rider_id,
    NEW.status, NEW.items, NEW.customer_name, NEW.customer_phone_hash, NEW.customer_phone,
    NEW.customer_address, NEW.delivery_address,
    (NEW.total_amount)::numeric, (NEW.landed_cost)::numeric, (NEW.delivery_fee)::numeric,
    NEW.delivery_notes, NEW.delivery_state, NEW.customer_gender, NEW.preferred_delivery_date,
    NEW.delivery_otp, (NEW.delivery_gps_lat)::numeric, (NEW.delivery_gps_lng)::numeric,
    NEW.delivery_proof_url, (NEW.delivery_discount_amount)::numeric, NEW.resolve_receipt_url, NEW.parent_order_id,
    NEW.payment_method, NEW.payment_status, NEW.payment_reference, NEW.payment_provider, NEW.customer_email,
    NEW.callback_scheduled_at, NEW.callback_attempts, NEW.callback_notes,
    NEW.is_duplicate, NEW.duplicate_of_id, NEW.locked_until, NEW.locked_by,
    NEW.order_source, NEW.custom_fields, NEW.branch_id,
    NEW.created_at, NEW.confirmed_at, NEW.allocated_at, NEW.dispatched_at, NEW.delivered_at,
    NEW.deleted_at,
    NEW.valid_from, NEW.valid_to, NEW.modified_by, NEW.updated_at
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
