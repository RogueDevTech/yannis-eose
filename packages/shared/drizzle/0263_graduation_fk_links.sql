-- Add direct FK links between graduated orders and their source tables.
-- Prevents double-graduation and enables reliable status sync.

-- 1. orders table: back-links to source follow_up_orders / cart_orders rows
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_follow_up_order_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_cart_order_id UUID;

-- 2. follow_up_orders / cart_orders: forward-link to graduated order
ALTER TABLE follow_up_orders ADD COLUMN IF NOT EXISTS graduated_order_id UUID;
ALTER TABLE cart_orders ADD COLUMN IF NOT EXISTS graduated_order_id UUID;

-- 3. Backfill: link existing graduated orders to their source rows.

-- Cart orders: match via source_cart_id = cart_id
UPDATE orders o
SET source_cart_order_id = co.id
FROM cart_orders co
WHERE o.order_source = 'online'
  AND o.is_follow_up = false
  AND o.deleted_at IS NULL
  AND co.source_cart_id = o.cart_id
  AND co.deleted_at IS NULL
  AND o.source_cart_order_id IS NULL;

-- Cart orders reverse: set graduated_order_id
UPDATE cart_orders co
SET graduated_order_id = o.id
FROM orders o
WHERE o.source_cart_order_id = co.id
  AND o.deleted_at IS NULL
  AND co.graduated_order_id IS NULL;

-- Follow-up orders: match via customer_phone_hash + is_follow_up
-- Use a subquery to pick the best match (same status, latest delivered_at)
UPDATE orders o
SET source_follow_up_order_id = (
  SELECT fo.id
  FROM follow_up_orders fo
  WHERE fo.customer_phone_hash = o.customer_phone_hash
    AND fo.deleted_at IS NULL
    AND fo.status IN ('DELIVERED', 'REMITTED')
  ORDER BY
    CASE WHEN fo.status = o.status::text THEN 0 ELSE 1 END,
    fo.delivered_at DESC NULLS LAST
  LIMIT 1
)
WHERE o.is_follow_up = true
  AND o.deleted_at IS NULL
  AND o.status IN ('DELIVERED', 'REMITTED')
  AND o.source_follow_up_order_id IS NULL;

-- Follow-up orders reverse: set graduated_order_id
UPDATE follow_up_orders fo
SET graduated_order_id = o.id
FROM orders o
WHERE o.source_follow_up_order_id = fo.id
  AND o.deleted_at IS NULL
  AND fo.graduated_order_id IS NULL;

-- 4. Indexes for FK lookups
CREATE INDEX IF NOT EXISTS idx_orders_source_follow_up_order_id ON orders (source_follow_up_order_id) WHERE source_follow_up_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_source_cart_order_id ON orders (source_cart_order_id) WHERE source_cart_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_up_orders_graduated_order_id ON follow_up_orders (graduated_order_id) WHERE graduated_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_orders_graduated_order_id ON cart_orders (graduated_order_id) WHERE graduated_order_id IS NOT NULL;
