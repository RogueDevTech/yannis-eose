-- ============================================
-- Add transfer_remittances (3PL → warehouse remit with receipt; HoL marks received)
-- ============================================

CREATE TYPE remittance_status AS ENUM ('SENT', 'RECEIVED', 'DISPUTED');

CREATE TABLE transfer_remittances (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  from_location_id text NOT NULL REFERENCES logistics_locations(id),
  to_location_id text NOT NULL REFERENCES logistics_locations(id),
  product_id text NOT NULL REFERENCES products(id),
  quantity_sent integer NOT NULL,
  quantity_received integer,
  receipt_url text NOT NULL,
  status remittance_status NOT NULL DEFAULT 'SENT',
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by text NOT NULL REFERENCES users(id),
  received_at timestamptz,
  received_by text REFERENCES users(id),
  shrinkage_reason text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text
);

CREATE TABLE transfer_remittances_history (LIKE transfer_remittances INCLUDING ALL);

ALTER TABLE transfer_remittances_history DROP CONSTRAINT IF EXISTS transfer_remittances_history_pkey;

CREATE INDEX IF NOT EXISTS transfer_remittances_history_temporal_idx
  ON transfer_remittances_history (id, valid_from, valid_to);

CREATE TRIGGER trg_transfer_remittances_stamp_actor
  BEFORE INSERT OR UPDATE ON transfer_remittances
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

CREATE TRIGGER trg_transfer_remittances_capture_history
  BEFORE UPDATE OR DELETE ON transfer_remittances
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

CREATE TRIGGER trg_transfer_remittances_capture_history_insert
  AFTER INSERT ON transfer_remittances
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert();

CREATE TRIGGER trg_transfer_remittances_history_immutable
  BEFORE UPDATE OR DELETE ON transfer_remittances_history
  FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
