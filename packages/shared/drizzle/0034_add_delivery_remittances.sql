-- Delivery remittances: 3PL selects delivered orders + payment receipt(s); Finance marks received.

CREATE TABLE IF NOT EXISTS delivery_remittances (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  logistics_location_id text NOT NULL REFERENCES logistics_locations(id),
  sent_by text NOT NULL REFERENCES users(id),
  receipt_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status remittance_status NOT NULL DEFAULT 'SENT',
  sent_at timestamptz NOT NULL DEFAULT NOW(),
  received_at timestamptz,
  received_by text REFERENCES users(id),
  dispute_reason text,
  notes text,
  valid_from timestamptz NOT NULL DEFAULT NOW(),
  valid_to timestamptz,
  modified_by text
);

CREATE TABLE IF NOT EXISTS delivery_remittance_orders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  delivery_remittance_id text NOT NULL REFERENCES delivery_remittances(id) ON DELETE CASCADE,
  order_id text NOT NULL REFERENCES orders(id),
  UNIQUE(order_id)
);

CREATE INDEX IF NOT EXISTS delivery_remittances_location_idx ON delivery_remittances(logistics_location_id);
CREATE INDEX IF NOT EXISTS delivery_remittances_status_idx ON delivery_remittances(status);
CREATE INDEX IF NOT EXISTS delivery_remittance_orders_remittance_idx ON delivery_remittance_orders(delivery_remittance_id);
CREATE INDEX IF NOT EXISTS delivery_remittance_orders_order_idx ON delivery_remittance_orders(order_id);
