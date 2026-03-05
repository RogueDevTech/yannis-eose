-- ============================================
-- Comprehensive Audit Coverage — Gap 3
-- Add temporal columns + history + triggers.
-- Only runs for tables that exist.
-- ============================================

DO $$
DECLARE
  _tables TEXT[] := ARRAY[
    'permission_requests',
    'system_settings',
    'cart_abandonments',
    'permissions',
    'role_permissions',
    'user_permissions'
  ];
  _t TEXT;
  _constraint RECORD;
  _exists BOOLEAN;
BEGIN
  FOREACH _t IN ARRAY _tables
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _t
    ) INTO _exists;
    IF NOT _exists THEN
      RAISE NOTICE 'Skipping % (table does not exist)', _t;
      CONTINUE;
    END IF;

    -- Add temporal columns
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now()', _t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS valid_to timestamptz', _t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS modified_by text', _t);

    -- Create history table
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE %I INCLUDING ALL)',
      _t || '_history',
      _t
    );

    FOR _constraint IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name = _t || '_history'
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    LOOP
      EXECUTE format(
        'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
        _t || '_history',
        _constraint.constraint_name
      );
    END LOOP;

    -- Standard temporal index (id, valid_from, valid_to). Skip for role_permissions (no id column).
    IF _t <> 'role_permissions' THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (id, valid_from, valid_to)',
        _t || '_history_temporal_idx',
        _t || '_history'
      );
    ELSE
      EXECUTE 'CREATE INDEX IF NOT EXISTS role_permissions_history_temporal_idx ON role_permissions_history (role, permission_id, valid_from, valid_to)';
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_stamp_actor ON %I',
      _t, _t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_stamp_actor BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()',
      _t, _t
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_capture_history ON %I',
      _t, _t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_capture_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()',
      _t, _t
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_immutable ON %I',
      _t || '_history', _t || '_history'
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable()',
      _t || '_history', _t || '_history'
    );

    RAISE NOTICE 'Temporal audit configured for: %', _t;
  END LOOP;
END;
$$;

-- INSERT capture triggers (generic)
DO $$
DECLARE
  _tables TEXT[] := ARRAY['permission_requests', 'system_settings', 'cart_abandonments', 'permissions', 'role_permissions', 'user_permissions'];
  _t TEXT;
BEGIN
  FOREACH _t IN ARRAY _tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _t || '_history'
    ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_%I_capture_history_insert ON %I',
        _t, _t
      );
      EXECUTE format(
        'CREATE TRIGGER trg_%I_capture_history_insert
         AFTER INSERT ON %I
         FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert()',
        _t, _t
      );
      RAISE NOTICE 'INSERT audit trigger added for: %', _t;
    END IF;
  END LOOP;
END;
$$;
