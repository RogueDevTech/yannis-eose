-- ============================================
-- Stock transfer approval gate
-- ============================================
-- Adds a conditional approval step before stock leaves the source location.
-- The `transfer_status` enum already includes 'PENDING' (was previously unused —
-- the service jumped straight to 'IN_TRANSIT' on initiate). We now reuse it as
-- the "awaiting source-authority approval" state. New 'REJECTED' value is added
-- for the rejection terminal state.
--
-- New columns track who approved/rejected and when, plus the rejection reason.
-- Source stock is NOT deducted while the row is PENDING — deduction is the
-- side effect of approval. Rejection is therefore inventory-neutral.
--
-- See CLAUDE.md → "When Building the Third-Party Logistics Module" → "Transfer
-- Approval Gate" for the full state machine + source-authority rule.

-- ── New enum value ───────────────────────────────────────────
ALTER TYPE "transfer_status" ADD VALUE IF NOT EXISTS 'REJECTED';

-- ── stock_transfers: approval / rejection columns ────────────
-- `initiated_by` is the actor who created the transfer row. We store it
-- explicitly (rather than inferring from the TRANSFER_OUT movement) because
-- PENDING transfers have no movement yet — the deduction is the side effect
-- of approval, not initiate.
ALTER TABLE "stock_transfers"
  ADD COLUMN IF NOT EXISTS "initiated_by" uuid REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "approved_by" uuid REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "approved_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "rejected_by" uuid REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "rejected_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "rejection_reason" text;

-- Backfill `initiated_by` for existing rows from the TRANSFER_OUT movement
-- so older transfers still show the right initiator in the UI. Best-effort —
-- if a row has no matching movement (shouldn't happen in practice), it stays NULL.
UPDATE "stock_transfers" st
SET "initiated_by" = sm."actor_id"
FROM "stock_movements" sm
WHERE sm."reference_id" = st."id"
  AND sm."movement_type" = 'TRANSFER_OUT'
  AND st."initiated_by" IS NULL;

-- ── stock_transfers_history: mirror the same columns ─────────
-- (per the "alter *_history in the same migration" rule; the generic
-- yannis_capture_history_insert trigger uses `INSERT … SELECT ($1).*`
-- so column-shape parity is all that's needed.)
ALTER TABLE "stock_transfers_history"
  ADD COLUMN IF NOT EXISTS "initiated_by" uuid,
  ADD COLUMN IF NOT EXISTS "approved_by" uuid,
  ADD COLUMN IF NOT EXISTS "approved_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "rejected_by" uuid,
  ADD COLUMN IF NOT EXISTS "rejected_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "rejection_reason" text;

-- Useful for the "Pending approval" tab query (small index — pending count is bounded).
CREATE INDEX IF NOT EXISTS "stock_transfers_pending_idx"
  ON "stock_transfers" ("transfer_status")
  WHERE "transfer_status" = 'PENDING';
