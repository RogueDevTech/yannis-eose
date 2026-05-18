-- Global audit log performance indexes (2026-05).
--
-- Problem: AuditService.getGlobalAuditLog UNIONs every `*_history` table and
-- sorts by `valid_from DESC`. The default temporal index on each history table
-- is `(id, valid_from, valid_to)` — fine for "all versions of one record" but
-- USELESS for the global "newest 20 audit events" query because `valid_from`
-- is not the leading column. Postgres falls back to sequential scans across
-- every history table, then a giant sort/limit at the top.
--
-- Fix: add a `(valid_from DESC)` index to every `*_history` table. Once present,
-- combined with the per-arm `ORDER BY valid_from DESC LIMIT N` rewrite in the
-- service layer, each table's contribution to the union becomes an O(log n)
-- index scan instead of a seq scan + sort.
--
-- Special case: `mirror_sessions` is append-only with `started_at`/`ended_at`
-- (no `valid_from`), so it gets a separate index on `started_at DESC`.
--
-- Idempotent — safe to re-run.

DO $$
DECLARE
  hist_table text;
BEGIN
  -- Every `*_history` table that exists in the public schema.
  FOR hist_table IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '%\_history' ESCAPE '\'
      AND table_type = 'BASE TABLE'
  LOOP
    -- Only add the index if `valid_from` actually exists on this table — some
    -- early history tables had `LIKE` without `INCLUDING DEFAULTS` and lost it.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = hist_table
        AND column_name = 'valid_from'
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (valid_from DESC)',
        hist_table || '_valid_from_desc_idx',
        hist_table
      );
    END IF;

    -- Actor-filtered audit queries (`?actorId=X`) also benefit from a
    -- (modified_by, valid_from DESC) composite. modified_by may be uuid OR
    -- legacy text — Postgres handles either fine for an index expression.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = hist_table
        AND column_name = 'modified_by'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = hist_table
        AND column_name = 'valid_from'
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (modified_by, valid_from DESC)',
        hist_table || '_actor_valid_from_idx',
        hist_table
      );
    END IF;
  END LOOP;
END $$;

-- mirror_sessions is the one auditable table that is NOT a `*_history` twin —
-- it is append-only with its own (started_at / ended_at) timestamps.
CREATE INDEX IF NOT EXISTS mirror_sessions_started_at_desc_idx
  ON mirror_sessions (started_at DESC);

CREATE INDEX IF NOT EXISTS mirror_sessions_actor_started_at_idx
  ON mirror_sessions (actor_id, started_at DESC);
