-- ============================================
-- Migration 0332: Resumable bulk-import jobs (large-file order import)
-- ============================================
-- A background, resumable importer for large CRM Excel/CSV exports (100k+ rows).
-- The file is uploaded to object storage; a job row tracks progress so a @Cron
-- worker can process bounded chunks, persist a cursor, and RESUME from exactly
-- where it stopped after a stop / error / server restart. Continue and Retry are
-- safe because each order is upserted by a caller-supplied external id — the
-- import is IDEMPOTENT (reprocessing a row overwrites, never duplicates).
--
-- Two schema changes:
--   1. orders.import_external_id  — the unique key from the source file, plus a
--      PARTIAL UNIQUE INDEX so Postgres itself forbids duplicates and enables
--      ON CONFLICT DO UPDATE (override on re-import).
--   2. import_jobs (+ history twin) — the job/progress record.

-- ── 1. orders.import_external_id + orders_history twin ───────────────────────
-- orders_history uses the EXPLICIT-COLUMN AFTER-INSERT-only capture trigger
-- (yannis_capture_history_insert_orders, mig 0016) — see 0318's note. Appending
-- a column does NOT break UPDATE writes; we still add it to the twin to keep the
-- schemas aligned. Nullable, no default on the twin.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS import_external_id text;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='orders_history') THEN
    ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS import_external_id text;
  END IF;
END $$;

-- Partial unique index: only rows that carry an external id participate. This is
-- BOTH the duplicate guard and the ON CONFLICT target for the idempotent upsert.
-- (Partial-index upserts MUST pass a matching WHERE in the app — see MEMORY
-- feedback_partial_index_onconflict.)
CREATE UNIQUE INDEX IF NOT EXISTS orders_import_external_id_uidx
  ON orders (import_external_id)
  WHERE import_external_id IS NOT NULL;

-- ── 2. import_job_status enum ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE import_job_status AS ENUM (
    'PENDING',     -- created, not yet picked up by the worker
    'PROCESSING',  -- worker is actively draining a chunk
    'PAUSED',      -- stopped after an error/limit; resumable via Continue
    'COMPLETED',   -- all rows processed
    'FAILED'       -- fatal (e.g. file unreadable); resumable via Continue/Retry
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. import_jobs table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY,
  resource_type text NOT NULL DEFAULT 'orders',
  status import_job_status NOT NULL DEFAULT 'PENDING',
  file_url text NOT NULL,
  file_key text,                -- object-storage key (for server-side download)
  file_name text,
  file_type text,               -- 'xlsx' | 'csv'
  -- Column-mapping + import options chosen in the UI (branchId, mediaBuyerId,
  -- assignedCsId, targetStatus, header→field map, externalId column, etc.).
  config jsonb,
  total_rows integer NOT NULL DEFAULT 0,     -- 0 until first pass counts them
  processed_rows integer NOT NULL DEFAULT 0, -- successfully upserted so far
  failed_rows integer NOT NULL DEFAULT 0,
  -- Resume cursor: the 0-based row index to START the next chunk from. On resume
  -- the worker skips rows [0, cursor). Upserts make any re-touch harmless.
  cursor integer NOT NULL DEFAULT 0,
  -- Per-row failures: [{ row, externalId, reason }]. Powers Retry Failed + the
  -- error viewer. Capped in app code to avoid unbounded growth.
  error_log jsonb,
  last_error text,              -- last fatal/pause reason for the UI banner
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- temporalColumns (must match the Drizzle helper: valid_from, valid_to, modified_by).
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid
);

CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs (status);
CREATE INDEX IF NOT EXISTS import_jobs_created_by_idx ON import_jobs (created_by);

-- ── 4. History twin + temporal audit triggers (same pattern as 0325) ─────────
DO $$
DECLARE
  _t TEXT := 'import_jobs';
  _constraint RECORD;
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I (LIKE %I INCLUDING ALL)', _t || '_history', _t);

  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = _t || '_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', _t || '_history', _constraint.constraint_name);
  END LOOP;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (id, valid_from, valid_to)',
    _t || '_history_temporal_idx', _t || '_history'
  );

  EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_stamp_actor ON %I', _t, _t);
  EXECUTE format(
    'CREATE TRIGGER trg_%I_stamp_actor BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()',
    _t, _t
  );

  EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_capture_history ON %I', _t, _t);
  EXECUTE format(
    'CREATE TRIGGER trg_%I_capture_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()',
    _t, _t
  );

  EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_immutable ON %I', _t || '_history', _t || '_history');
  EXECUTE format(
    'CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable()',
    _t || '_history', _t || '_history'
  );

  EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_capture_history_insert ON %I', _t, _t);
  EXECUTE format(
    'CREATE TRIGGER trg_%I_capture_history_insert AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert()',
    _t, _t
  );
END;
$$;
