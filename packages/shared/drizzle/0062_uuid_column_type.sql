-- ============================================================================
-- 0062 — Migrate every UUID-valued column from text to native uuid type.
-- ============================================================================
--
-- Goal: 16-byte storage (down from ~37 bytes/row) and raw-byte B-tree compares
-- (down from locale-aware text compares). Enables native uuid-type semantics
-- in queries and tooling.
--
-- Values already in the DB are valid canonical UUIDs (gen_random_uuid() / crypto
-- randomUUID() / uuidv7()), so `col::uuid` cast is total — no row-level failures
-- expected. If a cast does fail, the whole migration rolls back on the bad row.
--
-- This touches:
--   * ~240 text id / *_id columns on the 33 main business tables
--   * Matching id / *_id columns on the 33 *_history mirror tables
--   * Every FK constraint referencing or pointing at those columns
--
-- Strategy (dynamic, introspection-based — survives future schema drift):
--   1. Capture every FK constraint on public schema so we can restore them.
--   2. DROP every FK (we'll re-add at the end).
--   3. For every text-typed column named 'id' or ending '_id' on public schema:
--        a. DROP DEFAULT if any (avoids cast errors on old gen_random_uuid() defaults)
--        b. ALTER COLUMN ... TYPE uuid USING col::uuid
--        c. For primary-key 'id' columns: SET DEFAULT gen_random_uuid() again as a
--           backstop (the canonical source remains the uuidv7() app-side generator).
--   4. Re-add every FK captured in step 1 with original action clauses.
--
-- Everything runs in a single transaction. If any step fails, nothing commits.
-- ============================================================================

BEGIN;

-- Guard: if any target column already has a non-text type, just skip it silently.
-- (Makes this migration idempotent if partially re-run.)

DO $migration$
DECLARE
  fk record;
  col record;
  restore_sql text;
  restore_statements text[] := ARRAY[]::text[];
  on_delete_map constant text[] := ARRAY['', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'NO ACTION'];
  -- pg_constraint.confdeltype: 'a'=NO ACTION, 'r'=RESTRICT, 'c'=CASCADE, 'n'=SET NULL, 'd'=SET DEFAULT
  fn_conf_action constant text[] := ARRAY['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];
BEGIN

  -- =========================================================================
  -- 1 + 2. Capture every FK, then drop them all. We'll recreate at the end.
  -- =========================================================================
  FOR fk IN
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
    -- Build the ADD CONSTRAINT statement so we can restore it later.
    restore_sql := format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %s (%s)',
      fk.local_table, fk.conname, fk.local_cols, fk.foreign_table, fk.foreign_cols
    );

    IF fk.on_update_code <> 'a' THEN
      restore_sql := restore_sql || ' ON UPDATE ' ||
        fn_conf_action[CASE fk.on_update_code
          WHEN 'a' THEN 1 WHEN 'r' THEN 2 WHEN 'c' THEN 3 WHEN 'n' THEN 4 WHEN 'd' THEN 5
        END];
    END IF;
    IF fk.on_delete_code <> 'a' THEN
      restore_sql := restore_sql || ' ON DELETE ' ||
        fn_conf_action[CASE fk.on_delete_code
          WHEN 'a' THEN 1 WHEN 'r' THEN 2 WHEN 'c' THEN 3 WHEN 'n' THEN 4 WHEN 'd' THEN 5
        END];
    END IF;
    IF fk.condeferrable THEN
      restore_sql := restore_sql || ' DEFERRABLE';
      IF fk.condeferred THEN
        restore_sql := restore_sql || ' INITIALLY DEFERRED';
      END IF;
    END IF;

    restore_statements := array_append(restore_statements, restore_sql);

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.local_table, fk.conname);
  END LOOP;

  RAISE NOTICE 'Dropped % foreign key constraints — will recreate after column conversion.', array_length(restore_statements, 1);

  -- =========================================================================
  -- 3. Convert every text-typed id / *_id column to uuid.
  --    Covers main tables AND *_history mirror tables.
  -- =========================================================================
  FOR col IN
    SELECT
      table_schema,
      table_name,
      column_name,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'text'
      AND (column_name = 'id' OR column_name LIKE '%\_id' ESCAPE '\')
    ORDER BY table_name, column_name
  LOOP
    -- Drop any existing default (it may reference text-type functions that would cast awkwardly).
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

    -- Restore a uuid-native default only on primary-key 'id' columns (not FKs).
    -- This is a backstop — the canonical ID source is uuidv7() generated app-side.
    IF col.column_name = 'id' AND col.column_default IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()',
        col.table_schema, col.table_name, col.column_name
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'Converted text id / *_id columns to uuid.';

  -- =========================================================================
  -- 4. Restore every FK constraint captured in step 1.
  -- =========================================================================
  FOR i IN 1..array_length(restore_statements, 1) LOOP
    EXECUTE restore_statements[i];
  END LOOP;

  RAISE NOTICE 'Recreated % foreign key constraints.', array_length(restore_statements, 1);
END
$migration$;

-- Quick verification query (non-fatal, just prints remaining text-id columns if any slipped through).
DO $check$
DECLARE
  leftover_count int;
BEGIN
  SELECT COUNT(*) INTO leftover_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND data_type = 'text'
    AND (column_name = 'id' OR column_name LIKE '%\_id' ESCAPE '\');

  IF leftover_count > 0 THEN
    RAISE WARNING 'Migration completed but % text-typed id columns remain (inspect manually).', leftover_count;
  ELSE
    RAISE NOTICE 'All UUID columns successfully migrated to native uuid type.';
  END IF;
END
$check$;

COMMIT;
