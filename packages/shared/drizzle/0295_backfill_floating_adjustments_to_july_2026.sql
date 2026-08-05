-- Migration 0295: Pin every still-floating earnings adjustment to July 2026.
--
-- Migration 0293 backfilled floating adjustments (period_month IS NULL) once, but
-- rows created afterwards through the "omit month" create path came in floating
-- again. A NULL month means "next batch, any month", so such a row is swept into
-- whichever batch generates first and can silently zero out an unrelated staff
-- member's net (observed: two -N200,000 "Refund" deductions floating into the
-- July batch). Going forward period_month is REQUIRED at creation
-- (createAdjustmentSchema), so this is the final one-time cleanup of the legacy
-- floating rows.
--
-- Target: ALL rows with period_month IS NULL -> 2026-07-01 (the open payroll
-- period). Per the operator decision, every floating adjustment belongs to the
-- July run regardless of when it was created.
--
-- Idempotent: once a row has a period_month it is skipped, so re-running is a
-- no-op. Scope is intentionally NOT restricted to payout_id IS NULL — a floating
-- row already linked into a batch is still ambiguous and should carry the same
-- explicit July target.
--
-- HISTORY-TRIGGER SAFETY: earnings_adjustments carries the generic
-- yannis_capture_history trigger (positional `SELECT ($1).*`). This migration
-- only UPDATEs an existing column's value — no schema change — so the history
-- table stays column-aligned and each UPDATE is captured normally.

UPDATE earnings_adjustments
   SET period_month = DATE '2026-07-01'
 WHERE period_month IS NULL;
