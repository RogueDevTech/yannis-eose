-- Backfill REMITTED status to cart_orders and follow_up_orders for graduated
-- orders that were already remitted in the orders table. Going forward, the
-- logistics service syncs this automatically on remittance.
--
-- Safe: only changes status from DELIVERED → REMITTED on source table rows
-- whose graduated counterpart is already REMITTED. No count changes.

-- 1. Cart orders: link via source_cart_id = cart_id (set during graduation)
UPDATE cart_orders co
SET status = 'REMITTED', updated_at = NOW()
FROM orders o
WHERE o.status = 'REMITTED'
  AND o.order_source = 'online'
  AND o.is_follow_up = false
  AND o.deleted_at IS NULL
  AND co.source_cart_id = o.cart_id
  AND co.status = 'DELIVERED'
  AND co.deleted_at IS NULL;

-- 2. Follow-up orders (including delivered follow-up): graduated orders have is_follow_up=true
UPDATE follow_up_orders fo
SET status = 'REMITTED', updated_at = NOW()
FROM orders o
WHERE o.status = 'REMITTED'
  AND o.is_follow_up = true
  AND o.deleted_at IS NULL
  AND fo.customer_phone_hash = o.customer_phone_hash
  AND fo.status = 'DELIVERED'
  AND fo.deleted_at IS NULL;
