-- Cart Orders: standalone table for orders recovered from abandoned carts.
-- Full order lifecycle, decoupled from the Follow-Up pipeline.
-- On DELIVERED, graduates into the orders table.

CREATE TABLE IF NOT EXISTS cart_orders (
  id UUID PRIMARY KEY,
  order_number INTEGER NOT NULL DEFAULT nextval('order_number_seq') UNIQUE,
  source_cart_id UUID NOT NULL REFERENCES cart_abandonments(id),
  campaign_id UUID REFERENCES campaigns(id),
  media_buyer_id UUID REFERENCES users(id),
  assigned_cs_id UUID REFERENCES users(id),
  logistics_provider_id UUID REFERENCES logistics_providers(id),
  logistics_location_id UUID REFERENCES logistics_locations(id),
  rider_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'UNPROCESSED',
  items JSONB,
  customer_name TEXT NOT NULL,
  customer_phone_hash TEXT NOT NULL,
  customer_phone TEXT,
  customer_address TEXT,
  delivery_address TEXT,
  total_amount NUMERIC(12, 2),
  landed_cost NUMERIC(12, 2),
  delivery_fee NUMERIC(12, 2),
  delivery_notes TEXT,
  delivery_state TEXT,
  customer_gender TEXT,
  preferred_delivery_date TEXT,
  delivery_otp TEXT,
  delivery_gps_lat NUMERIC(10, 7),
  delivery_gps_lng NUMERIC(10, 7),
  delivery_proof_url TEXT,
  delivery_discount_amount NUMERIC(12, 2),
  resolve_receipt_url TEXT,
  payment_method TEXT,
  payment_status TEXT,
  payment_reference TEXT,
  payment_provider TEXT,
  customer_email TEXT,
  callback_scheduled_at TIMESTAMPTZ,
  callback_attempts INTEGER NOT NULL DEFAULT 0,
  callback_notes TEXT,
  is_duplicate TEXT,
  duplicate_of_id UUID,
  locked_until TIMESTAMPTZ,
  locked_by UUID REFERENCES users(id),
  order_source TEXT,
  custom_fields JSONB,
  branch_id UUID,
  servicing_branch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  allocated_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  modified_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_order_items (
  id UUID PRIMARY KEY,
  cart_order_id UUID NOT NULL REFERENCES cart_orders(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  offer_label TEXT,
  batch_id UUID REFERENCES stock_batches(id),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  modified_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_order_timeline_events (
  id UUID PRIMARY KEY,
  cart_order_id UUID NOT NULL REFERENCES cart_orders(id),
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_name TEXT,
  description TEXT NOT NULL,
  metadata JSONB,
  branch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- History table for temporal audit
CREATE TABLE IF NOT EXISTS cart_orders_history (LIKE cart_orders INCLUDING ALL);
CREATE TABLE IF NOT EXISTS cart_order_items_history (LIKE cart_order_items INCLUDING ALL);

-- Temporal triggers (capture history on update/delete)
CREATE TRIGGER trg_cart_orders_capture_history
  BEFORE UPDATE OR DELETE ON cart_orders
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

CREATE TRIGGER trg_cart_order_items_capture_history
  BEFORE UPDATE OR DELETE ON cart_order_items
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

-- History table immutability triggers
CREATE TRIGGER trg_cart_orders_history_immutable
  BEFORE UPDATE OR DELETE ON cart_orders_history
  FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();

CREATE TRIGGER trg_cart_order_items_history_immutable
  BEFORE UPDATE OR DELETE ON cart_order_items_history
  FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();

-- Actor stamp triggers
CREATE TRIGGER trg_cart_orders_stamp_actor
  BEFORE INSERT OR UPDATE ON cart_orders
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

CREATE TRIGGER trg_cart_order_items_stamp_actor
  BEFORE INSERT OR UPDATE ON cart_order_items
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

-- Indexes
CREATE INDEX idx_cart_orders_status ON cart_orders(status);
CREATE INDEX idx_cart_orders_assigned_cs_id ON cart_orders(assigned_cs_id);
CREATE INDEX idx_cart_orders_servicing_branch_id ON cart_orders(servicing_branch_id);
CREATE INDEX idx_cart_orders_source_cart_id ON cart_orders(source_cart_id);
CREATE INDEX idx_cart_orders_created_at ON cart_orders(created_at);
CREATE INDEX idx_cart_order_items_cart_order_id ON cart_order_items(cart_order_id);
CREATE INDEX idx_cart_order_timeline_events_cart_order_id ON cart_order_timeline_events(cart_order_id);
