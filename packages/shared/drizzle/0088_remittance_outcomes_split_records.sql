-- Split remittance settlements into explicit outcome lines (APPROVED / DISPUTED)
-- for stock transfer confirmations and delivery remittances.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'remittance_outcome_status') THEN
    CREATE TYPE remittance_outcome_status AS ENUM ('APPROVED', 'DISPUTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS stock_transfer_outcomes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  status remittance_outcome_status NOT NULL,
  quantity integer NOT NULL,
  reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL REFERENCES users(id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text
);

CREATE INDEX IF NOT EXISTS stock_transfer_outcomes_transfer_idx
  ON stock_transfer_outcomes (transfer_id);
CREATE INDEX IF NOT EXISTS stock_transfer_outcomes_status_idx
  ON stock_transfer_outcomes (status);

CREATE TABLE IF NOT EXISTS stock_transfer_outcomes_history (LIKE stock_transfer_outcomes INCLUDING ALL);
ALTER TABLE stock_transfer_outcomes_history DROP CONSTRAINT IF EXISTS stock_transfer_outcomes_history_pkey;
CREATE INDEX IF NOT EXISTS stock_transfer_outcomes_history_temporal_idx
  ON stock_transfer_outcomes_history (id, valid_from, valid_to);

DROP TRIGGER IF EXISTS trg_stock_transfer_outcomes_stamp_actor ON stock_transfer_outcomes;
CREATE TRIGGER trg_stock_transfer_outcomes_stamp_actor
  BEFORE INSERT OR UPDATE ON stock_transfer_outcomes
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

DROP TRIGGER IF EXISTS trg_stock_transfer_outcomes_capture_history ON stock_transfer_outcomes;
CREATE TRIGGER trg_stock_transfer_outcomes_capture_history
  BEFORE UPDATE OR DELETE ON stock_transfer_outcomes
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

DROP TRIGGER IF EXISTS trg_stock_transfer_outcomes_capture_history_insert ON stock_transfer_outcomes;
CREATE TRIGGER trg_stock_transfer_outcomes_capture_history_insert
  AFTER INSERT ON stock_transfer_outcomes
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert();

DROP TRIGGER IF EXISTS trg_stock_transfer_outcomes_history_immutable ON stock_transfer_outcomes_history;
CREATE TRIGGER trg_stock_transfer_outcomes_history_immutable
  BEFORE UPDATE OR DELETE ON stock_transfer_outcomes_history
  FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();

CREATE TABLE IF NOT EXISTS delivery_remittance_outcomes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  delivery_remittance_id uuid NOT NULL REFERENCES delivery_remittances(id) ON DELETE CASCADE,
  status remittance_outcome_status NOT NULL,
  amount numeric(12, 2) NOT NULL,
  order_count integer NOT NULL,
  reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL REFERENCES users(id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text
);

CREATE INDEX IF NOT EXISTS delivery_remittance_outcomes_remittance_idx
  ON delivery_remittance_outcomes (delivery_remittance_id);
CREATE INDEX IF NOT EXISTS delivery_remittance_outcomes_status_idx
  ON delivery_remittance_outcomes (status);

CREATE TABLE IF NOT EXISTS delivery_remittance_outcomes_history (LIKE delivery_remittance_outcomes INCLUDING ALL);
ALTER TABLE delivery_remittance_outcomes_history DROP CONSTRAINT IF EXISTS delivery_remittance_outcomes_history_pkey;
CREATE INDEX IF NOT EXISTS delivery_remittance_outcomes_history_temporal_idx
  ON delivery_remittance_outcomes_history (id, valid_from, valid_to);

DROP TRIGGER IF EXISTS trg_delivery_remittance_outcomes_stamp_actor ON delivery_remittance_outcomes;
CREATE TRIGGER trg_delivery_remittance_outcomes_stamp_actor
  BEFORE INSERT OR UPDATE ON delivery_remittance_outcomes
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

DROP TRIGGER IF EXISTS trg_delivery_remittance_outcomes_capture_history ON delivery_remittance_outcomes;
CREATE TRIGGER trg_delivery_remittance_outcomes_capture_history
  BEFORE UPDATE OR DELETE ON delivery_remittance_outcomes
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

DROP TRIGGER IF EXISTS trg_delivery_remittance_outcomes_capture_history_insert ON delivery_remittance_outcomes;
CREATE TRIGGER trg_delivery_remittance_outcomes_capture_history_insert
  AFTER INSERT ON delivery_remittance_outcomes
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert();

DROP TRIGGER IF EXISTS trg_delivery_remittance_outcomes_history_immutable ON delivery_remittance_outcomes_history;
CREATE TRIGGER trg_delivery_remittance_outcomes_history_immutable
  BEFORE UPDATE OR DELETE ON delivery_remittance_outcomes_history
  FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
