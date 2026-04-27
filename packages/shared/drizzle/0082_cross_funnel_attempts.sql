-- Cross-funnel attempt tracking.
-- When the same customer (phone) tries to order the same product via a DIFFERENT
-- Media Buyer's funnel within the 6-hour dedup window, we log the attempt here
-- instead of creating an order. The first MB to submit wins attribution.
--
-- These rows are STRICTLY per-MB visibility (each MB sees only their own).
-- They are NOT visible to CS, NOT counted in any order metric, NOT in pipelines.
-- Purpose: each MB can see their funnel is generating real interest even when
-- they don't win attribution.
-- (Renamed from orphan `0079_cross_funnel_attempts.sql` — journaled tag was 0079_order_soft_delete.)

CREATE TABLE IF NOT EXISTS cross_funnel_attempts (
  id uuid PRIMARY KEY,
  customer_phone_hash text NOT NULL,
  customer_name text NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id),
  media_buyer_id uuid NOT NULL REFERENCES users(id),
  campaign_id uuid REFERENCES campaigns(id),
  branch_id uuid REFERENCES branches(id),
  original_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  original_media_buyer_id uuid REFERENCES users(id),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cfa_media_buyer_attempted_at_idx
  ON cross_funnel_attempts (media_buyer_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS cfa_branch_attempted_at_idx
  ON cross_funnel_attempts (branch_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS cfa_phone_product_idx
  ON cross_funnel_attempts (customer_phone_hash, product_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS cfa_original_order_idx
  ON cross_funnel_attempts (original_order_id);
