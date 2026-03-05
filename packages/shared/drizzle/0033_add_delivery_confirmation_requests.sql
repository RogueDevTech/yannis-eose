-- ============================================
-- Delivery confirmation requests: rider/3PL submit DELIVERED or PARTIALLY_DELIVERED
-- for Head of Logistics approval; on approve, order transition runs.
-- ============================================

CREATE TYPE delivery_confirmation_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE delivery_confirmation_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL REFERENCES orders(id),
  requested_by text NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  status delivery_confirmation_request_status NOT NULL DEFAULT 'PENDING',
  approved_by text REFERENCES users(id),
  approved_at timestamptz,
  rejection_reason text,
  payload jsonb NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text
);

CREATE TABLE delivery_confirmation_requests_history (LIKE delivery_confirmation_requests INCLUDING ALL);

ALTER TABLE delivery_confirmation_requests_history DROP CONSTRAINT IF EXISTS delivery_confirmation_requests_history_pkey;

CREATE INDEX IF NOT EXISTS delivery_confirmation_requests_history_temporal_idx
  ON delivery_confirmation_requests_history (id, valid_from, valid_to);

CREATE TRIGGER trg_delivery_confirmation_requests_stamp_actor
  BEFORE INSERT OR UPDATE ON delivery_confirmation_requests
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

CREATE TRIGGER trg_delivery_confirmation_requests_capture_history
  BEFORE UPDATE OR DELETE ON delivery_confirmation_requests
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

CREATE TRIGGER trg_delivery_confirmation_requests_capture_history_insert
  AFTER INSERT ON delivery_confirmation_requests
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert();

CREATE TRIGGER trg_delivery_confirmation_requests_history_immutable
  BEFORE UPDATE OR DELETE ON delivery_confirmation_requests_history
  FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
