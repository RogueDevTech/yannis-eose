-- ============================================
-- Offer groups (multi-item offers) for Edge forms
-- ============================================
-- Replaces the legacy per-product offer_templates tier editor with a reusable
-- "group" that can contain multiple offer items (each item links to a product).
--
-- NOTE: This does NOT delete legacy offer_templates. A separate admin action
-- archives legacy tiers and detaches campaigns.

-- ---------------------------------------------------------------------------
-- 1) Main tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS offer_groups (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status record_status NOT NULL DEFAULT 'ACTIVE',
  created_by uuid NOT NULL REFERENCES users(id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_groups_status_idx ON offer_groups (status);
CREATE INDEX IF NOT EXISTS offer_groups_created_at_idx ON offer_groups (created_at);

CREATE TABLE IF NOT EXISTS offer_group_items (
  id uuid PRIMARY KEY,
  offer_group_id uuid NOT NULL REFERENCES offer_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  label text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  price numeric(12,2) NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  status record_status NOT NULL DEFAULT 'ACTIVE',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_group_items_group_sort_idx
  ON offer_group_items (offer_group_id, sort_order);
CREATE INDEX IF NOT EXISTS offer_group_items_product_idx
  ON offer_group_items (product_id);
CREATE INDEX IF NOT EXISTS offer_group_items_status_idx
  ON offer_group_items (status);

-- ---------------------------------------------------------------------------
-- 2) Campaign link (nullable)
-- ---------------------------------------------------------------------------

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS offer_group_id uuid REFERENCES offer_groups(id);

DO $hist$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaigns_history'
  ) THEN
    EXECUTE 'ALTER TABLE campaigns_history ADD COLUMN IF NOT EXISTS offer_group_id uuid';
  END IF;
END;
$hist$;

-- ---------------------------------------------------------------------------
-- 3) History tables + temporal triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  _constraint RECORD;
BEGIN
  -- offer_groups_history
  EXECUTE 'CREATE TABLE IF NOT EXISTS offer_groups_history (LIKE offer_groups INCLUDING ALL)';

  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'offer_groups_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE offer_groups_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  FOR _constraint IN
    SELECT i.relname AS index_name
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE t.relname = 'offer_groups_history' AND ix.indisunique
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', _constraint.index_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS offer_groups_history_temporal_idx
    ON offer_groups_history (id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_offer_groups_stamp_actor ON offer_groups;
  CREATE TRIGGER trg_offer_groups_stamp_actor
    BEFORE INSERT OR UPDATE ON offer_groups
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_offer_groups_capture_history ON offer_groups;
  CREATE TRIGGER trg_offer_groups_capture_history
    BEFORE UPDATE OR DELETE ON offer_groups
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_offer_groups_history_immutable ON offer_groups_history;
  CREATE TRIGGER trg_offer_groups_history_immutable
    BEFORE UPDATE OR DELETE ON offer_groups_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();

  -- offer_group_items_history
  EXECUTE 'CREATE TABLE IF NOT EXISTS offer_group_items_history (LIKE offer_group_items INCLUDING ALL)';

  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'offer_group_items_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE offer_group_items_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  FOR _constraint IN
    SELECT i.relname AS index_name
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE t.relname = 'offer_group_items_history' AND ix.indisunique
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', _constraint.index_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS offer_group_items_history_temporal_idx
    ON offer_group_items_history (id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_offer_group_items_stamp_actor ON offer_group_items;
  CREATE TRIGGER trg_offer_group_items_stamp_actor
    BEFORE INSERT OR UPDATE ON offer_group_items
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_offer_group_items_capture_history ON offer_group_items;
  CREATE TRIGGER trg_offer_group_items_capture_history
    BEFORE UPDATE OR DELETE ON offer_group_items
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_offer_group_items_history_immutable ON offer_group_items_history;
  CREATE TRIGGER trg_offer_group_items_history_immutable
    BEFORE UPDATE OR DELETE ON offer_group_items_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- ---------------------------------------------------------------------------
-- 4) INSERT capture triggers (numeric present on items.price)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_offer_groups()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO offer_groups_history (
    id, name, status, created_by,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.name, NEW.status, NEW.created_by,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_offer_groups_capture_history_insert ON offer_groups;
CREATE TRIGGER trg_offer_groups_capture_history_insert
  AFTER INSERT ON offer_groups
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_offer_groups();

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_offer_group_items()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO offer_group_items_history (
    id, offer_group_id, product_id,
    label, quantity, price, image_url, sort_order, status,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.offer_group_id, NEW.product_id,
    NEW.label, NEW.quantity, (NEW.price)::numeric, NEW.image_url, NEW.sort_order, NEW.status,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_offer_group_items_capture_history_insert ON offer_group_items;
CREATE TRIGGER trg_offer_group_items_capture_history_insert
  AFTER INSERT ON offer_group_items
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_offer_group_items();

