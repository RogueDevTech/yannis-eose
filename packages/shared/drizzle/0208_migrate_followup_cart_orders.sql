-- Migrate ALL cart-origin follow-up orders into the new cart_orders table.
-- Cart-origin follow-ups: source_order_id IS NULL AND cart_id IS NOT NULL.
-- This includes delivered ones so the Cart Orders page has complete history.

-- Step 1: Insert ALL cart-origin follow-up orders into cart_orders
INSERT INTO cart_orders (
  id, order_number, source_cart_id,
  campaign_id, media_buyer_id, assigned_cs_id,
  logistics_provider_id, logistics_location_id, rider_id,
  status, items, customer_name, customer_phone_hash, customer_phone,
  customer_address, delivery_address,
  total_amount, landed_cost, delivery_fee,
  delivery_notes, delivery_state, customer_gender,
  preferred_delivery_date, delivery_otp, delivery_gps_lat, delivery_gps_lng,
  delivery_proof_url, delivery_discount_amount, resolve_receipt_url,
  payment_method, payment_status, payment_reference, payment_provider,
  customer_email,
  callback_scheduled_at, callback_attempts, callback_notes,
  is_duplicate, duplicate_of_id,
  locked_until, locked_by,
  order_source, custom_fields, branch_id, servicing_branch_id,
  created_at, confirmed_at, allocated_at, dispatched_at, delivered_at, deleted_at,
  valid_from, valid_to, modified_by, updated_at
)
SELECT
  id, order_number, cart_id,
  campaign_id, media_buyer_id, assigned_cs_id,
  logistics_provider_id, logistics_location_id, rider_id,
  status, items, customer_name, customer_phone_hash, customer_phone,
  customer_address, delivery_address,
  total_amount, landed_cost, delivery_fee,
  delivery_notes, delivery_state, customer_gender,
  preferred_delivery_date, delivery_otp, delivery_gps_lat, delivery_gps_lng,
  delivery_proof_url, delivery_discount_amount, resolve_receipt_url,
  payment_method, payment_status, payment_reference, payment_provider,
  customer_email,
  callback_scheduled_at, callback_attempts, callback_notes,
  is_duplicate, duplicate_of_id,
  locked_until, locked_by,
  order_source, custom_fields, branch_id, servicing_branch_id,
  created_at, confirmed_at, allocated_at, dispatched_at, delivered_at, deleted_at,
  valid_from, valid_to, modified_by, updated_at
FROM follow_up_orders
WHERE source_order_id IS NULL
  AND cart_id IS NOT NULL;

-- Step 2: Copy their line items into cart_order_items
INSERT INTO cart_order_items (
  id, cart_order_id, product_id, quantity, unit_price, offer_label, batch_id,
  valid_from, valid_to, modified_by, created_at, updated_at
)
SELECT
  foi.id, foi.follow_up_order_id, foi.product_id, foi.quantity, foi.unit_price,
  foi.offer_label, foi.batch_id,
  foi.valid_from, foi.valid_to, foi.modified_by, foi.created_at, foi.updated_at
FROM follow_up_order_items foi
INNER JOIN follow_up_orders fo ON fo.id = foi.follow_up_order_id
WHERE fo.source_order_id IS NULL
  AND fo.cart_id IS NOT NULL;

-- Step 3: Copy timeline events
INSERT INTO cart_order_timeline_events (
  id, cart_order_id, event_type, actor_id, actor_name, description, metadata, branch_id, created_at
)
SELECT
  fote.id, fote.follow_up_order_id, fote.event_type, fote.actor_id, fote.actor_name,
  fote.description, fote.metadata, fote.branch_id, fote.created_at
FROM follow_up_order_timeline_events fote
INNER JOIN follow_up_orders fo ON fo.id = fote.follow_up_order_id
WHERE fo.source_order_id IS NULL
  AND fo.cart_id IS NOT NULL;

-- Step 4: Soft-delete the migrated follow-up orders so they no longer appear
-- in the follow-up views (they're now in cart_orders).
UPDATE follow_up_orders
SET deleted_at = NOW(), status = 'DELETED', updated_at = NOW()
WHERE source_order_id IS NULL
  AND cart_id IS NOT NULL
  AND deleted_at IS NULL;
