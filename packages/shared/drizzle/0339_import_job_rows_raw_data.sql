-- ============================================
-- Migration 0339: Keep the source cells of FAILED import rows
-- ============================================
-- Adds import_job_rows.raw_data: the original spreadsheet cells for a row that
-- FAILED to import, so the import job page can show the user WHAT was on that
-- row and let them fix it and submit it, without re-uploading the whole file.
--
-- Previously a failed row stored only (row_index, external_id, reason). The page
-- could therefore render nothing but a row number and an error string — the user
-- had no way to see the offending values, let alone correct them.
--
-- Scope + size: written ONLY for FAILED rows (see BulkImportService.drainChunk).
-- A clean import stores zero extra bytes. A failure stores one small JSON object
-- of that row's mapped cells, capped in app code (MAX_RAW_DATA_CELLS /
-- MAX_RAW_DATA_VALUE_LEN) so a pathological file can't bloat the table.
--
-- Still TRANSIENT / non-audited, exactly like the rest of this table: no
-- _history twin, no temporal triggers, ON DELETE CASCADE from import_jobs.
-- The authoritative audit trail remains orders_history — a row fixed and
-- submitted from the UI goes through the normal audited import path.
--
-- NOTE (Pillar 2): raw_data holds the customer phone as typed in the source
-- file. It is served ONLY to the SuperAdmin/Support importer who uploaded the
-- file (same gate as the import itself) and only for rows that FAILED, i.e.
-- data they already hold in the spreadsheet on their own machine. It is never
-- exposed on any customer-facing or general order surface.

ALTER TABLE import_job_rows
  ADD COLUMN IF NOT EXISTS raw_data jsonb;

COMMENT ON COLUMN import_job_rows.raw_data IS
  'Original source cells for a FAILED row, so the user can view/fix/resubmit it. NULL for IMPORTED/WARNING rows.';
