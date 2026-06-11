-- Migration 0184: Follow-Up Config System
-- CEO directive 2026-06-10: automated follow-up order recovery with config rules.
-- Adds follow_up_rules, follow_up_orders, follow_up_order_items,
-- follow_up_order_timeline_events, follow_up_sync_logs, and orders.frozen_for_follow_up.

-- ── 1. Alter orders: frozen flag ─────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS frozen_for_follow_up boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_orders_frozen_for_follow_up ON orders (frozen_for_follow_up) WHERE frozen_for_follow_up = true;

-- ── 2. follow_up_rules ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_rules (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  source_status text NOT NULL,
  age_threshold_days integer NOT NULL,
  source_branch_id uuid REFERENCES branches(id),
  target_branch_id uuid REFERENCES branches(id),
  target_group_id uuid REFERENCES follow_up_groups(id),
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  -- Temporal + audit
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- XOR: exactly one of target_branch_id or target_group_id
  CONSTRAINT follow_up_rules_target_xor CHECK (
    (target_branch_id IS NOT NULL AND target_group_id IS NULL)
    OR (target_branch_id IS NULL AND target_group_id IS NOT NULL)
  )
);

-- Prevent overlapping active rules: same source_status + source_branch combo.
-- COALESCE maps NULL (org-wide) to a sentinel UUID so the unique index works.
CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_up_rules_no_overlap
  ON follow_up_rules (source_status, COALESCE(source_branch_id, '00000000-0000-0000-0000-000000000000'))
  WHERE enabled = true;

-- ── 3. follow_up_orders ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_orders (
  id uuid PRIMARY KEY,
  order_number integer NOT NULL DEFAULT nextval('order_number_seq') UNIQUE,
  source_order_id uuid NOT NULL REFERENCES orders(id),
  follow_up_rule_id uuid REFERENCES follow_up_rules(id),
  campaign_id uuid REFERENCES campaigns(id),
  media_buyer_id uuid REFERENCES users(id),
  assigned_cs_id uuid REFERENCES users(id),
  logistics_provider_id uuid REFERENCES logistics_providers(id),
  logistics_location_id uuid REFERENCES logistics_locations(id),
  rider_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'UNPROCESSED',
  items jsonb,
  customer_name text NOT NULL,
  customer_phone_hash text NOT NULL,
  customer_phone text,
  customer_address text,
  delivery_address text,
  total_amount numeric(12,2),
  landed_cost numeric(12,2),
  delivery_fee numeric(12,2),
  delivery_notes text,
  delivery_state text,
  customer_gender text,
  preferred_delivery_date text,
  delivery_otp text,
  delivery_gps_lat numeric(10,7),
  delivery_gps_lng numeric(10,7),
  delivery_proof_url text,
  delivery_discount_amount numeric(12,2),
  resolve_receipt_url text,
  payment_method text,
  payment_status text,
  payment_reference text,
  payment_provider text,
  customer_email text,
  callback_scheduled_at timestamptz,
  callback_attempts integer NOT NULL DEFAULT 0,
  callback_notes text,
  is_duplicate text,
  duplicate_of_id uuid,
  locked_until timestamptz,
  locked_by uuid REFERENCES users(id),
  order_source text,
  custom_fields jsonb,
  branch_id uuid,
  servicing_branch_id uuid,
  cart_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  allocated_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  deleted_at timestamptz,
  -- Temporal + audit
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_orders_source ON follow_up_orders (source_order_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_orders_status ON follow_up_orders (status);
CREATE INDEX IF NOT EXISTS idx_follow_up_orders_assigned_cs ON follow_up_orders (assigned_cs_id) WHERE assigned_cs_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_up_orders_servicing_branch ON follow_up_orders (servicing_branch_id) WHERE servicing_branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_up_orders_rule ON follow_up_orders (follow_up_rule_id) WHERE follow_up_rule_id IS NOT NULL;

-- ── 4. follow_up_order_items ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_order_items (
  id uuid PRIMARY KEY,
  follow_up_order_id uuid NOT NULL REFERENCES follow_up_orders(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity integer NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  offer_label text,
  batch_id uuid REFERENCES stock_batches(id),
  -- Temporal + audit
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_order_items_order ON follow_up_order_items (follow_up_order_id);

-- ── 5. follow_up_order_timeline_events ───────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_order_timeline_events (
  id uuid PRIMARY KEY,
  follow_up_order_id uuid NOT NULL REFERENCES follow_up_orders(id),
  event_type text NOT NULL,
  actor_id uuid REFERENCES users(id),
  actor_name text,
  description text NOT NULL,
  metadata jsonb,
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_order_timeline_order ON follow_up_order_timeline_events (follow_up_order_id);

-- ── 6. follow_up_sync_logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_sync_logs (
  id uuid PRIMARY KEY,
  triggered_by text NOT NULL,
  triggered_by_user_id uuid REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_pulled integer NOT NULL DEFAULT 0,
  rule_results jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 7. Temporal stamp triggers ────────────────────────────────────────
-- yannis_stamp_actor sets modified_by from the session var on every write.
CREATE OR REPLACE TRIGGER trg_follow_up_rules_stamp
  BEFORE INSERT OR UPDATE ON follow_up_rules
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

CREATE OR REPLACE TRIGGER trg_follow_up_orders_stamp
  BEFORE INSERT OR UPDATE ON follow_up_orders
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

CREATE OR REPLACE TRIGGER trg_follow_up_order_items_stamp
  BEFORE INSERT OR UPDATE ON follow_up_order_items
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();
