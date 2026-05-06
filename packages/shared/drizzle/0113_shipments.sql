-- ============================================
-- Inbound shipments — supplier → warehouse receipt workflow
-- ============================================
-- Multi-line parent ("shipments") + line items ("shipment_lines"). Lifecycle:
--   CREATED → IN_TRANSIT → ARRIVED → VERIFIED → CLOSED   (CANCELLED at any pre-VERIFY stage)
--
-- On VERIFY, every line writes a stock_batches row + upserts inventory_levels.stock_count
-- + logs an INTAKE stock_movement, atomically inside one withActorAndBranch tx.
-- Branch context flows through `destination_location_id → logistics_locations.branch_id`
-- — no separate branch_id on this table.
--
-- Reference number is `SHIP-YYYY-XXXX`, computed from the SERIAL `reference_number`.
-- Mirrors the invoice numbering pattern (`finance.service.ts::formatReference`).

DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM (
    'CREATED', 'IN_TRANSIT', 'ARRIVED', 'VERIFIED', 'CLOSED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY,
  reference_number serial NOT NULL UNIQUE,
  label text,
  status shipment_status NOT NULL DEFAULT 'CREATED',
  destination_location_id uuid NOT NULL REFERENCES logistics_locations(id),
  supplier_name text,
  supplier_reference text,
  expected_arrival_at timestamptz,
  arrived_at timestamptz,
  verified_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  total_landing_cost numeric(14,2) NOT NULL DEFAULT 0,
  cancelled_reason text,
  verified_by uuid REFERENCES users(id),
  closed_by uuid REFERENCES users(id),
  cancelled_by uuid REFERENCES users(id),
  notes text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipments_status_idx ON shipments (status);
CREATE INDEX IF NOT EXISTS shipments_destination_location_idx ON shipments (destination_location_id);
CREATE INDEX IF NOT EXISTS shipments_expected_arrival_idx ON shipments (expected_arrival_at);
CREATE INDEX IF NOT EXISTS shipments_arrived_at_idx ON shipments (arrived_at);

CREATE TABLE IF NOT EXISTS shipment_lines (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  expected_quantity integer NOT NULL,
  received_quantity integer,
  factory_cost numeric(12,2) NOT NULL,
  allocated_landing_cost numeric(12,2),
  batch_id uuid REFERENCES stock_batches(id),
  variance_reason text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipment_lines_shipment_idx ON shipment_lines (shipment_id);
CREATE INDEX IF NOT EXISTS shipment_lines_product_idx ON shipment_lines (product_id);
CREATE INDEX IF NOT EXISTS shipment_lines_batch_idx ON shipment_lines (batch_id);

-- ── History tables + temporal triggers (parent) ───────────────
DO $$
DECLARE
  _constraint RECORD;
BEGIN
  EXECUTE 'CREATE TABLE IF NOT EXISTS shipments_history (LIKE shipments INCLUDING ALL)';

  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'shipments_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE shipments_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  -- Drop unique INDEXES copied by INCLUDING ALL — history rows aren't unique by id
  -- and the SERIAL reference_number unique would block updates.
  FOR _constraint IN
    SELECT i.relname AS index_name
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE t.relname = 'shipments_history' AND ix.indisunique
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', _constraint.index_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS shipments_history_temporal_idx
    ON shipments_history (id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_shipments_stamp_actor ON shipments;
  CREATE TRIGGER trg_shipments_stamp_actor
    BEFORE INSERT OR UPDATE ON shipments
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_shipments_capture_history ON shipments;
  CREATE TRIGGER trg_shipments_capture_history
    BEFORE UPDATE OR DELETE ON shipments
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_shipments_history_immutable ON shipments_history;
  CREATE TRIGGER trg_shipments_history_immutable
    BEFORE UPDATE OR DELETE ON shipments_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- ── History + triggers (lines) ────────────────────────────────
DO $$
DECLARE
  _constraint RECORD;
BEGIN
  EXECUTE 'CREATE TABLE IF NOT EXISTS shipment_lines_history (LIKE shipment_lines INCLUDING ALL)';

  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'shipment_lines_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE shipment_lines_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  FOR _constraint IN
    SELECT i.relname AS index_name
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE t.relname = 'shipment_lines_history' AND ix.indisunique
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', _constraint.index_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS shipment_lines_history_temporal_idx
    ON shipment_lines_history (id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_shipment_lines_stamp_actor ON shipment_lines;
  CREATE TRIGGER trg_shipment_lines_stamp_actor
    BEFORE INSERT OR UPDATE ON shipment_lines
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_shipment_lines_capture_history ON shipment_lines;
  CREATE TRIGGER trg_shipment_lines_capture_history
    BEFORE UPDATE OR DELETE ON shipment_lines
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_shipment_lines_history_immutable ON shipment_lines_history;
  CREATE TRIGGER trg_shipment_lines_history_immutable
    BEFORE UPDATE OR DELETE ON shipment_lines_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- ── INSERT capture: explicit-cast triggers (numeric columns present) ──
-- The generic dynamic-SQL trigger drops numeric type info (text-via-USING NEW),
-- causing "column X is of type numeric but expression is of type text" on the
-- history mirror. Pattern from 0012_fix_capture_history_insert_numeric.sql.

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_shipments()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO shipments_history (
    id, reference_number, label, status,
    destination_location_id, supplier_name, supplier_reference,
    expected_arrival_at, arrived_at, verified_at, closed_at, cancelled_at,
    total_landing_cost, cancelled_reason,
    verified_by, closed_by, cancelled_by, notes,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.reference_number, NEW.label, NEW.status,
    NEW.destination_location_id, NEW.supplier_name, NEW.supplier_reference,
    NEW.expected_arrival_at, NEW.arrived_at, NEW.verified_at, NEW.closed_at, NEW.cancelled_at,
    (NEW.total_landing_cost)::numeric, NEW.cancelled_reason,
    NEW.verified_by, NEW.closed_by, NEW.cancelled_by, NEW.notes,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipments_capture_history_insert ON shipments;
CREATE TRIGGER trg_shipments_capture_history_insert
  AFTER INSERT ON shipments
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_shipments();

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_shipment_lines()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO shipment_lines_history (
    id, shipment_id, product_id,
    expected_quantity, received_quantity,
    factory_cost, allocated_landing_cost,
    batch_id, variance_reason,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.shipment_id, NEW.product_id,
    NEW.expected_quantity, NEW.received_quantity,
    (NEW.factory_cost)::numeric, (NEW.allocated_landing_cost)::numeric,
    NEW.batch_id, NEW.variance_reason,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipment_lines_capture_history_insert ON shipment_lines;
CREATE TRIGGER trg_shipment_lines_capture_history_insert
  AFTER INSERT ON shipment_lines
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_shipment_lines();
