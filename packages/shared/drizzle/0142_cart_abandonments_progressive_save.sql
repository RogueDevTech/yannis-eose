-- Cart abandonment: store every field the customer typed before dropping off,
-- plus a back-link from orders → cart so recovered conversions are traceable.
--
-- WHY today: cart_abandonments only carries name + phone + product. When CS
-- recovers a cart manually they re-type everything the customer already typed.
-- The edge form already collects email/address/state/payment/etc; we just stop
-- persisting the moment the customer stops typing. Saving progressively turns
-- recovery into one-tap (modal pre-fills every captured field).
--
-- WHY back-link: today an offline order created from a recovered cart has no
-- link to the originating cart row. MB attribution is lost (CS modal has no MB
-- picker), and the `/admin/orders` page can't surface "recovered" orders.
-- Adding orders.cart_id closes the loop and unblocks the filter pill.
--
-- AUDIT: cart_abandonments is on the audit-excluded list (migration 0119), so
-- no `cart_abandonments_history` columns to sync. orders IS system-versioned;
-- orders_history is synced for cart_id below.

ALTER TABLE cart_abandonments
  ADD COLUMN IF NOT EXISTS customer_email          TEXT,
  ADD COLUMN IF NOT EXISTS customer_address        TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address        TEXT,
  ADD COLUMN IF NOT EXISTS delivery_state          TEXT,
  ADD COLUMN IF NOT EXISTS delivery_notes          TEXT,
  ADD COLUMN IF NOT EXISTS customer_gender         TEXT,
  ADD COLUMN IF NOT EXISTS preferred_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS payment_method          TEXT,
  ADD COLUMN IF NOT EXISTS quantity                INTEGER,
  ADD COLUMN IF NOT EXISTS custom_field_values     JSONB;

-- Orders ↔ cart back-link. NULL = order was created directly (not from a cart).
ALTER TABLE orders         ADD COLUMN IF NOT EXISTS cart_id UUID REFERENCES cart_abandonments(id);
ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS cart_id UUID;
CREATE INDEX IF NOT EXISTS orders_cart_id_idx ON orders (cart_id) WHERE cart_id IS NOT NULL;
