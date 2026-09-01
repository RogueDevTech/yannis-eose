-- ============================================
-- Migration 0340: User-requested pause for a running import job
-- ============================================
-- Adds import_jobs.pause_requested: a cooperative stop flag so the operator can
-- pause a draining import from the Recent imports table and Continue it later.
--
-- Why a flag and not a direct status write: the worker drains the file in
-- chunks, and each chunk ends by flipping the job back to PENDING and
-- self-kicking the next one (BulkImportService.drainChunk). Writing
-- status='PAUSED' onto a PROCESSING job would simply be overwritten by the
-- in-flight chunk's boundary write, and the import would carry on. Instead the
-- request is recorded here and the worker honours it AT THE CHUNK BOUNDARY,
-- where the cursor and per-row records are already consistent. Worst case the
-- pause lands one chunk later, never mid-row.
--
-- Resume clears the flag (see BulkImportService.resume) so a paused job can be
-- continued from its saved cursor exactly as a parse-error pause already is.
--
-- HISTORY TWIN: import_jobs has an import_jobs_history table + a
-- yannis_capture_history() trigger (migration 0332). That function does
-- `SELECT ($1).*` against the twin, so a column present on the base table but
-- missing from the twin makes EVERY UPDATE on import_jobs fail. Both tables are
-- therefore altered together, in this one migration.

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS pause_requested boolean NOT NULL DEFAULT false;

ALTER TABLE import_jobs_history
  ADD COLUMN IF NOT EXISTS pause_requested boolean;

COMMENT ON COLUMN import_jobs.pause_requested IS
  'Operator asked to pause: the worker stops at the next chunk boundary and sets status=PAUSED. Cleared on resume.';
