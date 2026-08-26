-- ============================================
-- Migration 0336: Per-row status for bulk imports
-- ============================================
-- Adds import_job_rows: ONE row per data row of an import file, recording that
-- row's outcome (IMPORTED / WARNING / FAILED) plus its external id and reason.
-- This powers the "see every uploaded row and its status" view on the import
-- job page — previously only FAILED/WARNING rows were kept (in
-- import_jobs.error_log); successful rows were counted but not listed.
--
-- IMPORTANT — this table is TRANSIENT operational data, NOT audited:
--   * No _history twin and no temporal triggers. A 100k-row import would
--     otherwise double every write and bloat the DB (see MEMORY
--     data_optimization_pruning). The authoritative audit trail is orders_history
--     (each imported order is a normal audited upsert); this table only mirrors
--     per-row import outcomes for troubleshooting and is safe to prune.
--   * ON DELETE CASCADE from import_jobs — pruning/deleting a job drops its rows.
--
-- Upsert-friendly: a UNIQUE (job_id, row_index) lets the worker re-stamp a row's
-- status on resume/retry (idempotent, same as the order upsert) instead of
-- inserting duplicates.

DO $$ BEGIN
  CREATE TYPE import_row_status AS ENUM (
    'IMPORTED',  -- row upserted cleanly
    'WARNING',   -- imported, but a display code did not resolve (field left NULL)
    'FAILED'     -- not imported (missing/invalid required field)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS import_job_rows (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  -- 0-based index over DATA rows (row 0 = first row after the header), matching
  -- import_jobs.cursor space.
  row_index integer NOT NULL,
  status import_row_status NOT NULL,
  -- The row's unique external id from the source file, when present.
  external_id text,
  -- For WARNING/FAILED: the human-readable reason. NULL for a clean IMPORTED row.
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One record per (job, row). The worker upserts on this so resume/retry
-- re-stamps rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS import_job_rows_job_row_uidx
  ON import_job_rows (job_id, row_index);

-- List/paginate a job's rows in row order, and filter by status, fast.
CREATE INDEX IF NOT EXISTS import_job_rows_job_status_idx
  ON import_job_rows (job_id, status);
