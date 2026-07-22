-- 0258: Backfill ungraduated follow-up and cart orders
--
-- 80 follow-up orders and 4 cart orders are DELIVERED in their source tables
-- but have no graduated copy in the orders table. The graduation was silently
-- blocked by the dedup guard (14-day window), but these are genuine deliveries
-- with no matching order. This migration creates the missing graduated copies.
--
-- Going forward, the pre-delivery dedup guard (added in the same release)
-- blocks the DELIVERED transition entirely if graduation would fail, so this
-- scenario cannot recur.

-- 1. Graduate orphaned follow-up orders → orders table
INSERT INTO orders (
  id, campaign_id, media_buyer_id, assigned_cs_id,
  logistics_provider_id, logistics_location_id, rider_id,
  status, items, customer_name, customer_phone_hash, customer_phone,
  customer_address, delivery_address, total_amount, landed_cost,
  delivery_fee, delivery_notes, delivery_state, customer_gender,
  preferred_delivery_date, payment_method, payment_status,
  payment_reference, payment_provider, customer_email,
  order_source, custom_fields, branch_id, servicing_branch_id,
  cart_id, delivery_proof_url, delivery_discount_amount,
  delivery_otp, delivery_gps_lat, delivery_gps_lng,
  is_follow_up, is_delivered_follow_up, follow_up_source_order_id,
  confirmed_at, allocated_at, dispatched_at, delivered_at, created_at
)
SELECT
  gen_random_uuid(),
  fo.campaign_id, fo.media_buyer_id, fo.assigned_cs_id,
  fo.logistics_provider_id, fo.logistics_location_id, fo.rider_id,
  'DELIVERED', fo.items, fo.customer_name, fo.customer_phone_hash, fo.customer_phone,
  fo.customer_address, fo.delivery_address, fo.total_amount, fo.landed_cost,
  fo.delivery_fee, fo.delivery_notes, fo.delivery_state, fo.customer_gender,
  fo.preferred_delivery_date, fo.payment_method, fo.payment_status,
  fo.payment_reference, fo.payment_provider, fo.customer_email,
  CASE
    WHEN fo.order_source = 'delivered_follow_up' THEN 'delivered_follow_up'
    WHEN fo.cart_id IS NOT NULL AND fo.source_order_id IS NULL THEN 'online'
    ELSE COALESCE(
      (SELECT o2.order_source FROM orders o2 WHERE o2.id = fo.source_order_id LIMIT 1),
      'follow-up'
    )
  END,
  fo.custom_fields, fo.branch_id, fo.servicing_branch_id,
  fo.cart_id, fo.delivery_proof_url, fo.delivery_discount_amount,
  fo.delivery_otp, fo.delivery_gps_lat, fo.delivery_gps_lng,
  true,
  (fo.order_source = 'delivered_follow_up'),
  fo.source_order_id,
  fo.confirmed_at, fo.allocated_at, fo.dispatched_at, fo.delivered_at,
  COALESCE(
    (SELECT o2.created_at FROM orders o2 WHERE o2.id = fo.source_order_id LIMIT 1),
    fo.created_at
  )
FROM follow_up_orders fo
WHERE fo.status = 'DELIVERED'
  AND fo.deleted_at IS NULL
  -- No graduated copy exists (by phone hash + order_source)
  AND NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.customer_phone_hash = fo.customer_phone_hash
      AND o.order_source = 'delivered_follow_up'
      AND o.deleted_at IS NULL
  )
  -- No matching delivered order exists (genuine, not duplicate)
  AND NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN follow_up_order_items fi ON fi.follow_up_order_id = fo.id
      AND fi.product_id = oi.product_id
    WHERE o.customer_phone_hash = fo.customer_phone_hash
      AND o.status IN ('DELIVERED', 'REMITTED')
      AND o.deleted_at IS NULL
  );

-- 2. Copy follow-up order items to the graduated orders.
-- Join on (phone_hash + follow_up_source_order_id + delivered_at) to find
-- the graduated row we just inserted.
INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
SELECT
  gen_random_uuid(),
  o.id,
  fi.product_id,
  fi.quantity,
  fi.unit_price
FROM follow_up_order_items fi
JOIN follow_up_orders fo ON fo.id = fi.follow_up_order_id
JOIN orders o ON o.customer_phone_hash = fo.customer_phone_hash
  AND o.is_follow_up = true
  AND o.delivered_at = fo.delivered_at
  AND o.deleted_at IS NULL
  AND o.status = 'DELIVERED'
  -- Match on source order ID to avoid cross-matching
  AND (
    (fo.source_order_id IS NOT NULL AND o.follow_up_source_order_id = fo.source_order_id)
    OR (fo.source_order_id IS NULL AND o.follow_up_source_order_id IS NULL)
  )
WHERE fo.status = 'DELIVERED'
  AND fo.deleted_at IS NULL
  -- Only for orders that didn't have items yet (idempotent)
  AND NOT EXISTS (
    SELECT 1 FROM order_items oi2
    WHERE oi2.order_id = o.id AND oi2.product_id = fi.product_id
  );

-- 3. Graduate orphaned cart orders → orders table (4 orders)
INSERT INTO orders (
  id, campaign_id, media_buyer_id, assigned_cs_id,
  logistics_provider_id, logistics_location_id, rider_id,
  status, items, customer_name, customer_phone_hash, customer_phone,
  customer_address, delivery_address, total_amount, landed_cost,
  delivery_fee, delivery_notes, delivery_state, customer_gender,
  preferred_delivery_date, payment_method, payment_status,
  payment_reference, payment_provider, customer_email,
  order_source, custom_fields, branch_id, servicing_branch_id,
  cart_id, delivery_proof_url,
  is_follow_up, is_delivered_follow_up,
  confirmed_at, allocated_at, dispatched_at, delivered_at, created_at
)
SELECT
  gen_random_uuid(),
  co.campaign_id, co.media_buyer_id, co.assigned_cs_id,
  co.logistics_provider_id, co.logistics_location_id, co.rider_id,
  'DELIVERED', co.items, co.customer_name, co.customer_phone_hash, co.customer_phone,
  co.customer_address, co.delivery_address, co.total_amount, co.landed_cost,
  co.delivery_fee, co.delivery_notes, co.delivery_state, co.customer_gender,
  co.preferred_delivery_date, co.payment_method, co.payment_status,
  co.payment_reference, co.payment_provider, co.customer_email,
  'online', co.custom_fields, co.branch_id, co.servicing_branch_id,
  co.source_cart_id, co.delivery_proof_url,
  false, false,
  co.confirmed_at, co.allocated_at, co.dispatched_at, co.delivered_at, co.created_at
FROM cart_orders co
WHERE co.status = 'DELIVERED'
  AND co.deleted_at IS NULL
  -- No graduated copy exists
  AND NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o.customer_phone_hash = co.customer_phone_hash
      AND o.order_source = 'online'
      AND o.deleted_at IS NULL
      AND o.status IN ('DELIVERED', 'REMITTED')
  )
  -- No matching delivered order exists (genuine, not duplicate)
  AND NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN cart_order_items ci ON ci.cart_order_id = co.id
      AND ci.product_id = oi.product_id
    WHERE o.customer_phone_hash = co.customer_phone_hash
      AND o.status IN ('DELIVERED', 'REMITTED')
      AND o.deleted_at IS NULL
  );

-- 4. Copy cart order items to graduated orders
INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
SELECT
  gen_random_uuid(),
  o.id,
  ci.product_id,
  ci.quantity,
  ci.unit_price
FROM cart_order_items ci
JOIN cart_orders co ON co.id = ci.cart_order_id
JOIN orders o ON o.customer_phone_hash = co.customer_phone_hash
  AND o.order_source = 'online'
  AND o.delivered_at = co.delivered_at
  AND o.deleted_at IS NULL
  AND o.status = 'DELIVERED'
WHERE co.status = 'DELIVERED'
  AND co.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM order_items oi2
    WHERE oi2.order_id = o.id AND oi2.product_id = ci.product_id
  );
