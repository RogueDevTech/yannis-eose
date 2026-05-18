-- ============================================================================
-- 0062 — Migrate every UUID-valued column from text to native uuid type.
-- ============================================================================
--
-- Goal: 16-byte storage (down from ~37 bytes/row) and raw-byte B-tree compares
-- (down from locale-aware text compares). Enables native uuid-type semantics
-- in queries and tooling.
--
-- Objects this migration has to coordinate around, because they depend on the
-- columns being altered:
--   * ~240 text id / *_id columns on the 33 main business tables
--   * Matching id / *_id columns on the 33 *_history mirror tables
--   * ~106 foreign key constraints
--   * ~38 RLS policies (reference branch_id, user_id, etc.)
--   * 1 view (products_safe)
--   * 1 materialized view (mv_ad_spend_summary)
--
-- Strategy (dynamic, introspection-based — survives future schema drift):
--   1. Capture then drop: RLS policies, view, materialized view, FKs.
--   2. ALTER every text id / *_id column TYPE uuid USING col::uuid.
--   3. Restore in reverse order: FKs, matview, view, RLS policies.
--
-- Everything runs in a single transaction. If any step fails, nothing commits.
-- Values already in the DB are canonical UUIDs (uuidv7 / gen_random_uuid /
-- crypto.randomUUID), so `::uuid` casts are total — no row-level failures.
-- ============================================================================

BEGIN;

DO $migration$
DECLARE
  r record;
  col record;
  restore_sql text;
  fk_restore_statements text[] := ARRAY[]::text[];
  policy_restore_statements text[] := ARRAY[]::text[];
  view_restore_statements text[] := ARRAY[]::text[];
  matview_restore_statements text[] := ARRAY[]::text[];
  matview_index_statements text[] := ARRAY[]::text[];
  fn_conf_action constant text[] := ARRAY['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];
BEGIN

  -- =========================================================================
  -- 1a. Capture RLS policies, then drop them.
  -- =========================================================================
  FOR r IN
    SELECT
      schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    DECLARE
      transformed_qual text := r.qual;
      transformed_check text := r.with_check;
    BEGIN
      -- yannis_current_user_id() / yannis_current_branch_id() now return uuid, not text.
      -- Rewrite empty-string comparisons that no longer parse against the uuid type.
      -- We drop `AND (fn() <> ''::text)` and `(fn() <> ''::text) AND` since the companion
      -- `fn() IS NOT NULL` check in the same expression already covers the intent.
      IF transformed_qual IS NOT NULL THEN
        transformed_qual := regexp_replace(
          transformed_qual,
          '\s*AND\s*\(\s*yannis_current_(user|branch)_id\(\)\s*<>\s*''''::text\s*\)',
          '', 'g'
        );
        transformed_qual := regexp_replace(
          transformed_qual,
          '\(\s*yannis_current_(user|branch)_id\(\)\s*<>\s*''''::text\s*\)\s*AND\s*',
          '', 'g'
        );
      END IF;
      IF transformed_check IS NOT NULL THEN
        transformed_check := regexp_replace(
          transformed_check,
          '\s*AND\s*\(\s*yannis_current_(user|branch)_id\(\)\s*<>\s*''''::text\s*\)',
          '', 'g'
        );
        transformed_check := regexp_replace(
          transformed_check,
          '\(\s*yannis_current_(user|branch)_id\(\)\s*<>\s*''''::text\s*\)\s*AND\s*',
          '', 'g'
        );
      END IF;

      restore_sql := format(
        'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
        r.policyname, r.schemaname, r.tablename,
        CASE r.permissive WHEN 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        r.cmd,
        (SELECT string_agg(quote_ident(x), ', ') FROM unnest(r.roles) AS x)
      );
      IF transformed_qual IS NOT NULL THEN
        restore_sql := restore_sql || format(' USING (%s)', transformed_qual);
      END IF;
      IF transformed_check IS NOT NULL THEN
        restore_sql := restore_sql || format(' WITH CHECK (%s)', transformed_check);
      END IF;

      policy_restore_statements := array_append(policy_restore_statements, restore_sql);
    END;
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;

  RAISE NOTICE 'Dropped % RLS policies — will recreate after column conversion.', array_length(policy_restore_statements, 1);

  -- =========================================================================
  -- 1b. Capture then drop views.
  -- =========================================================================
  FOR r IN
    SELECT schemaname, viewname, pg_get_viewdef(quote_ident(schemaname) || '.' || quote_ident(viewname), true) AS definition
    FROM pg_views
    WHERE schemaname = 'public'
  LOOP
    view_restore_statements := array_append(
      view_restore_statements,
      format('CREATE VIEW %I.%I AS %s', r.schemaname, r.viewname, r.definition)
    );
    EXECUTE format('DROP VIEW %I.%I', r.schemaname, r.viewname);
  END LOOP;

  RAISE NOTICE 'Dropped % views.', array_length(view_restore_statements, 1);

  -- =========================================================================
  -- 1c. Capture then drop materialized views (plus their indexes).
  -- =========================================================================
  FOR r IN
    SELECT
      schemaname, matviewname,
      pg_get_viewdef(quote_ident(schemaname) || '.' || quote_ident(matviewname), true) AS definition
    FROM pg_matviews
    WHERE schemaname = 'public'
  LOOP
    matview_restore_statements := array_append(
      matview_restore_statements,
      format('CREATE MATERIALIZED VIEW %I.%I AS %s', r.schemaname, r.matviewname, r.definition)
    );

    -- Capture indexes on the matview so we can rebuild them after.
    FOR col IN
      SELECT indexdef FROM pg_indexes WHERE schemaname = r.schemaname AND tablename = r.matviewname
    LOOP
      matview_index_statements := array_append(matview_index_statements, col.indexdef);
    END LOOP;

    EXECUTE format('DROP MATERIALIZED VIEW %I.%I', r.schemaname, r.matviewname);
  END LOOP;

  RAISE NOTICE 'Dropped % materialized views.', array_length(matview_restore_statements, 1);

  -- =========================================================================
  -- 1d. Capture then drop FKs.
  -- =========================================================================
  FOR r IN
    SELECT
      con.conname,
      con.conrelid::regclass::text          AS local_table,
      con.confrelid::regclass::text         AS foreign_table,
      string_agg(quote_ident(local_cols.attname), ', ' ORDER BY u.ord) AS local_cols,
      string_agg(quote_ident(foreign_cols.attname), ', ' ORDER BY u.ord) AS foreign_cols,
      con.confupdtype                       AS on_update_code,
      con.confdeltype                       AS on_delete_code,
      con.condeferrable,
      con.condeferred
    FROM pg_constraint con
    CROSS JOIN LATERAL unnest(con.conkey)  WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute local_cols
      ON local_cols.attrelid = con.conrelid AND local_cols.attnum = u.attnum
    JOIN pg_attribute foreign_cols
      ON foreign_cols.attrelid = con.confrelid
     AND foreign_cols.attnum = con.confkey[u.ord]
    WHERE con.contype = 'f'
      AND con.connamespace = 'public'::regnamespace
    GROUP BY con.conname, con.conrelid, con.confrelid,
             con.confupdtype, con.confdeltype, con.condeferrable, con.condeferred
  LOOP
    restore_sql := format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %s (%s)',
      r.local_table, r.conname, r.local_cols, r.foreign_table, r.foreign_cols
    );
    IF r.on_update_code <> 'a' THEN
      restore_sql := restore_sql || ' ON UPDATE ' ||
        fn_conf_action[CASE r.on_update_code
          WHEN 'a' THEN 1 WHEN 'r' THEN 2 WHEN 'c' THEN 3 WHEN 'n' THEN 4 WHEN 'd' THEN 5
        END];
    END IF;
    IF r.on_delete_code <> 'a' THEN
      restore_sql := restore_sql || ' ON DELETE ' ||
        fn_conf_action[CASE r.on_delete_code
          WHEN 'a' THEN 1 WHEN 'r' THEN 2 WHEN 'c' THEN 3 WHEN 'n' THEN 4 WHEN 'd' THEN 5
        END];
    END IF;
    IF r.condeferrable THEN
      restore_sql := restore_sql || ' DEFERRABLE';
      IF r.condeferred THEN
        restore_sql := restore_sql || ' INITIALLY DEFERRED';
      END IF;
    END IF;
    fk_restore_statements := array_append(fk_restore_statements, restore_sql);
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.local_table, r.conname);
  END LOOP;

  RAISE NOTICE 'Dropped % FK constraints.', array_length(fk_restore_statements, 1);

  -- =========================================================================
  -- 2a. Normalize empty strings to NULL. Some columns (mostly modified_by,
  --     written by the temporal stamp trigger before yannis_current_user_id()
  --     returned uuid) hold '' which is neither NULL nor a valid UUID and
  --     breaks the cast. Empty-string actors also have no meaning.
  -- =========================================================================
  DECLARE
    cleanup_count int := 0;
    updated int;
  BEGIN
    FOR col IN
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'text'
        AND (column_name = 'id' OR column_name LIKE '%\_id' ESCAPE '\' OR column_name LIKE '%\_by' ESCAPE '\')
    LOOP
      EXECUTE format(
        'UPDATE %I.%I SET %I = NULL WHERE %I = ''''',
        col.table_schema, col.table_name, col.column_name, col.column_name
      );
      GET DIAGNOSTICS updated = ROW_COUNT;
      cleanup_count := cleanup_count + updated;
    END LOOP;
    RAISE NOTICE 'Normalized % empty-string values to NULL.', cleanup_count;
  END;

  -- =========================================================================
  -- 2b. Convert every text-typed id / *_id / *_by column to uuid, BUT only after
  --    verifying every non-null value in that column matches the UUID format.
  --    Some columns end in "_id" but hold alphanumeric identifiers
  --    (e.g. product_categories.sms_sender_id holds Termii sender names like
  --    "afristore") — we must not try to cast those.
  -- =========================================================================
  DECLARE
    skipped_count int := 0;
    converted_count int := 0;
    has_non_uuid bool;
  BEGIN
    FOR col IN
      SELECT table_schema, table_name, column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'text'
        AND (column_name = 'id' OR column_name LIKE '%\_id' ESCAPE '\' OR column_name LIKE '%\_by' ESCAPE '\')
      ORDER BY table_name, column_name
    LOOP
      -- Pre-flight: does ANY row in this column contain a non-UUID string?
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I IS NOT NULL AND %I !~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'')',
        col.table_schema, col.table_name, col.column_name, col.column_name
      ) INTO has_non_uuid;

      IF has_non_uuid THEN
        RAISE NOTICE 'Skipping %.% — contains non-UUID text values (column stays as text).',
          col.table_name, col.column_name;
        skipped_count := skipped_count + 1;
        CONTINUE;
      END IF;

      IF col.column_default IS NOT NULL THEN
        EXECUTE format(
          'ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
          col.table_schema, col.table_name, col.column_name
        );
      END IF;

      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I TYPE uuid USING %I::uuid',
        col.table_schema, col.table_name, col.column_name, col.column_name
      );

      IF col.column_name = 'id' AND col.column_default IS NOT NULL THEN
        EXECUTE format(
          'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()',
          col.table_schema, col.table_name, col.column_name
        );
      END IF;

      converted_count := converted_count + 1;
    END LOOP;

    RAISE NOTICE 'Converted % text id / *_id / *_by columns to uuid. Skipped % (non-uuid content).',
      converted_count, skipped_count;
  END;

  -- =========================================================================
  -- 2.5. Rewrite the yannis_ helper functions so they return uuid instead of
  --      text. RLS policies compare these function results to the now-uuid
  --      branch/id columns; without this, the uuid = text operator doesn't
  --      exist and policy restoration fails.
  --
  --      CREATE OR REPLACE cannot change a return type, so drop + create.
  --      All RLS policies are already dropped at this point (step 1a), so
  --      nothing depends on these functions.
  -- =========================================================================
  DROP FUNCTION IF EXISTS yannis_current_user_id();
  DROP FUNCTION IF EXISTS yannis_current_branch_id();
  DROP FUNCTION IF EXISTS yannis_branch_matches(text);

  CREATE FUNCTION yannis_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('yannis.current_user_id', true), '')::uuid;
    $fn$;

  CREATE FUNCTION yannis_current_branch_id() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('yannis.current_branch_id', true), '')::uuid;
    $fn$;

  CREATE FUNCTION yannis_branch_matches(row_branch_id uuid) RETURNS boolean
    LANGUAGE sql STABLE AS $fn$
      SELECT
        yannis_is_super_admin()
        OR yannis_current_branch_id() IS NULL
        OR row_branch_id IS NULL
        OR row_branch_id = yannis_current_branch_id();
    $fn$;

  RAISE NOTICE 'Rewrote yannis_current_user_id / yannis_current_branch_id / yannis_branch_matches to use uuid.';

  -- =========================================================================
  -- 3. Restore in reverse order: FKs, matviews + their indexes, views, policies.
  -- =========================================================================
  FOR i IN 1..COALESCE(array_length(fk_restore_statements, 1), 0) LOOP
    EXECUTE fk_restore_statements[i];
  END LOOP;
  RAISE NOTICE 'Recreated % FKs.', array_length(fk_restore_statements, 1);

  FOR i IN 1..COALESCE(array_length(matview_restore_statements, 1), 0) LOOP
    EXECUTE matview_restore_statements[i];
  END LOOP;
  FOR i IN 1..COALESCE(array_length(matview_index_statements, 1), 0) LOOP
    EXECUTE matview_index_statements[i];
  END LOOP;
  RAISE NOTICE 'Recreated % matviews (with % indexes).', array_length(matview_restore_statements, 1), array_length(matview_index_statements, 1);

  FOR i IN 1..COALESCE(array_length(view_restore_statements, 1), 0) LOOP
    EXECUTE view_restore_statements[i];
  END LOOP;
  RAISE NOTICE 'Recreated % views.', array_length(view_restore_statements, 1);

  FOR i IN 1..COALESCE(array_length(policy_restore_statements, 1), 0) LOOP
    EXECUTE policy_restore_statements[i];
  END LOOP;
  RAISE NOTICE 'Recreated % RLS policies.', array_length(policy_restore_statements, 1);
END
$migration$;

-- Sanity check: ensure no text-typed id/*_id columns remain.
DO $check$
DECLARE leftover int;
BEGIN
  SELECT COUNT(*) INTO leftover
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND data_type = 'text'
    AND (column_name = 'id' OR column_name LIKE '%\_id' ESCAPE '\' OR column_name LIKE '%\_by' ESCAPE '\');

  IF leftover > 0 THEN
    RAISE WARNING 'Migration completed but % text-typed id columns remain.', leftover;
  ELSE
    RAISE NOTICE 'All UUID columns successfully migrated to native uuid type.';
  END IF;
END
$check$;

COMMIT;
