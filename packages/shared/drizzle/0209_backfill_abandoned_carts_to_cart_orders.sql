-- Backfill: pull all existing ABANDONED carts that are not yet in cart_orders
-- and not already converted to an order. These were abandoned before the
-- auto-pull cron was added. The cron would catch them eventually, but this
-- ensures they appear on the Cart Orders page immediately after deploy.

INSERT INTO cart_orders (
  id, order_number, source_cart_id,
  campaign_id, media_buyer_id,
  status, customer_name, customer_phone_hash, customer_phone,
  customer_address, delivery_address,
  total_amount,
  delivery_notes, delivery_state, customer_gender,
  preferred_delivery_date, payment_method, customer_email,
  order_source, custom_fields,
  created_at, valid_from, updated_at
)
SELECT
  gen_random_uuid(), nextval('order_number_seq'), ca.id,
  ca.campaign_id, ca.media_buyer_id,
  'UNPROCESSED', ca.customer_name, ca.customer_phone_hash, ca.customer_phone,
  ca.customer_address, ca.delivery_address,
  COALESCE(
    (SELECT p.base_sale_price FROM products p WHERE p.id = ca.product_id LIMIT 1),
    '0'
  )::numeric,
  ca.delivery_notes, ca.delivery_state, ca.customer_gender,
  ca.preferred_delivery_date, ca.payment_method, ca.customer_email,
  'online', ca.custom_field_values,
  ca.created_at, NOW(), NOW()
FROM cart_abandonments ca
WHERE ca.status = 'ABANDONED'
  AND ca.id NOT IN (SELECT source_cart_id FROM cart_orders)
  AND ca.id NOT IN (SELECT cart_id FROM follow_up_orders WHERE cart_id IS NOT NULL)
  AND ca.converted_order_id IS NULL;

-- Also create cart_order_items for each backfilled cart order
INSERT INTO cart_order_items (
  id, cart_order_id, product_id, quantity, unit_price, offer_label,
  valid_from, created_at, updated_at
)
SELECT
  gen_random_uuid(), co.id, ca.product_id, COALESCE(ca.quantity, 1),
  COALESCE(
    (SELECT p.base_sale_price FROM products p WHERE p.id = ca.product_id LIMIT 1),
    '0'
  ),
  ca.offer_label,
  NOW(), NOW(), NOW()
FROM cart_orders co
JOIN cart_abandonments ca ON ca.id = co.source_cart_id
WHERE NOT EXISTS (
  SELECT 1 FROM cart_order_items coi WHERE coi.cart_order_id = co.id
);

-- Timeline events for backfilled cart orders
INSERT INTO cart_order_timeline_events (
  id, cart_order_id, event_type, actor_name, description, created_at
)
SELECT
  gen_random_uuid(), co.id, 'ORDER_RECEIVED', 'System',
  'Cart order created from abandoned cart.',
  co.created_at
FROM cart_orders co
WHERE NOT EXISTS (
  SELECT 1 FROM cart_order_timeline_events cote WHERE cote.cart_order_id = co.id
);
