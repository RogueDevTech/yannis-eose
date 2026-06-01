-- ============================================
-- Temporal audit for System-tab tables
-- ============================================
-- cs_order_routing_rules, cs_order_routing_rule_targets,
-- cs_order_routing_branch_settings, branch_teams, branch_team_settings
-- all lacked temporal columns + history tables.

-- ---------------------------------------------------------------------------
-- 1) Add temporal columns to live tables
-- ---------------------------------------------------------------------------

ALTER TABLE cs_order_routing_rules
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to   timestamptz,
  ADD COLUMN IF NOT EXISTS modified_by text;

ALTER TABLE cs_order_routing_rule_targets
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to   timestamptz,
  ADD COLUMN IF NOT EXISTS modified_by text;

ALTER TABLE cs_order_routing_branch_settings
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to   timestamptz,
  ADD COLUMN IF NOT EXISTS modified_by text;

ALTER TABLE branch_teams
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to   timestamptz,
  ADD COLUMN IF NOT EXISTS modified_by text;

ALTER TABLE branch_team_settings
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to   timestamptz,
  ADD COLUMN IF NOT EXISTS modified_by text;

-- ---------------------------------------------------------------------------
-- 2) History tables + temporal triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  _constraint RECORD;
  _tables text[] := ARRAY[
    'cs_order_routing_rules',
    'cs_order_routing_rule_targets',
    'cs_order_routing_branch_settings',
    'branch_teams',
    'branch_team_settings'
  ];
  _t text;
BEGIN
  FOREACH _t IN ARRAY _tables LOOP
    -- Create history table from live table structure
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I (LIKE %I INCLUDING ALL)', _t || '_history', _t);

    -- Drop PK / UNIQUE constraints on history (duplicates allowed)
    FOR _constraint IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name = _t || '_history'
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', _t || '_history', _constraint.constraint_name);
    END LOOP;

    -- Drop unique indexes on history
    FOR _constraint IN
      SELECT i.relname AS index_name
      FROM pg_class t2
      JOIN pg_index ix ON t2.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      WHERE t2.relname = _t || '_history' AND ix.indisunique
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS %I', _constraint.index_name);
    END LOOP;

    -- Temporal lookup index
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (id, valid_from, valid_to)',
      _t || '_history_temporal_idx',
      _t || '_history'
    );

    -- stamp_actor trigger
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_stamp_actor ON %I', _t, _t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_stamp_actor BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()',
      _t, _t
    );

    -- capture_history trigger (UPDATE + DELETE → copy OLD row)
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_capture_history ON %I', _t, _t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_capture_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()',
      _t, _t
    );

    -- immutable history trigger
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_history_immutable ON %I', _t || '_history', _t || '_history');
    EXECUTE format(
      'CREATE TRIGGER trg_%s_history_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable()',
      _t || '_history', _t || '_history'
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) INSERT capture triggers (snapshot the initial row into history)
-- ---------------------------------------------------------------------------

-- cs_order_routing_rules
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_cs_order_routing_rules()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO cs_order_routing_rules_history
    SELECT NEW.*;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cs_order_routing_rules_capture_history_insert ON cs_order_routing_rules;
CREATE TRIGGER trg_cs_order_routing_rules_capture_history_insert
  AFTER INSERT ON cs_order_routing_rules
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_cs_order_routing_rules();

-- cs_order_routing_rule_targets
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_cs_order_routing_rule_targets()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO cs_order_routing_rule_targets_history
    SELECT NEW.*;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cs_order_routing_rule_targets_capture_history_insert ON cs_order_routing_rule_targets;
CREATE TRIGGER trg_cs_order_routing_rule_targets_capture_history_insert
  AFTER INSERT ON cs_order_routing_rule_targets
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_cs_order_routing_rule_targets();

-- cs_order_routing_branch_settings
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_cs_order_routing_branch_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO cs_order_routing_branch_settings_history
    SELECT NEW.*;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cs_order_routing_branch_settings_capture_history_insert ON cs_order_routing_branch_settings;
CREATE TRIGGER trg_cs_order_routing_branch_settings_capture_history_insert
  AFTER INSERT ON cs_order_routing_branch_settings
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_cs_order_routing_branch_settings();

-- branch_teams
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_branch_teams()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO branch_teams_history
    SELECT NEW.*;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branch_teams_capture_history_insert ON branch_teams;
CREATE TRIGGER trg_branch_teams_capture_history_insert
  AFTER INSERT ON branch_teams
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_branch_teams();

-- branch_team_settings
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_branch_team_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO branch_team_settings_history
    SELECT NEW.*;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branch_team_settings_capture_history_insert ON branch_team_settings;
CREATE TRIGGER trg_branch_team_settings_capture_history_insert
  AFTER INSERT ON branch_team_settings
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_branch_team_settings();
