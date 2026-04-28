-- Add `receiver_notes` to stock_transfers so the receiver can leave a comment
-- when marking a transfer received (e.g. condition of goods, partial-delivery context,
-- coordination notes for the sender). Optional, free-text up to ~500 chars (enforced
-- at the API layer; the DB column is text for flexibility).
--
-- The history table mirrors the column so temporal audit captures it on every change.

ALTER TABLE "stock_transfers"
  ADD COLUMN IF NOT EXISTS "receiver_notes" text;

ALTER TABLE "stock_transfers_history"
  ADD COLUMN IF NOT EXISTS "receiver_notes" text;
