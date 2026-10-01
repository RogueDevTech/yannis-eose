-- Migration 0348: Funding dispute -> reversal workflow.
--
-- Problem: a receiver can mark funding "Not Received" (DISPUTED), but nothing
-- could resolve it. The sender stayed debited forever and an erroneous funding
-- could not be undone without hand-edited SQL.
--
-- Model:
--   * The original marketing_funding row is NEVER deleted. An approved reversal
--     flips it to status REVERSED. Every balance / ledger query filters funding
--     by an explicit status allow-list (SENT/COMPLETED/DISPUTED), so a REVERSED
--     row drops out everywhere: the sender gets the amount back and the receiver
--     loses it (if it had been credited) with no formula changes.
--   * marketing_funding_reversals is the linked reversal transaction: one row per
--     reversed funding (UNIQUE funding_id = DB-level guard against reversing the
--     same funding twice). It is append-only: written once, never updated.
--   * marketing_funding.dispute_reason persists the receiver's dispute reason,
--     which was previously validated and then thrown away.
--
-- HISTORY TWIN: marketing_funding uses yannis_capture_history() (`SELECT ($1).*`),
-- so the new column MUST also land on marketing_funding_history or every UPDATE
-- on marketing_funding fails.
--
-- The new enum value is NOT referenced elsewhere in this file: a value added with
-- ADD VALUE cannot be used inside the same transaction.

-- 1. New funding status.
ALTER TYPE funding_status ADD VALUE IF NOT EXISTS 'REVERSED';

-- 2. Persist the receiver's dispute reason (+ history twin).
ALTER TABLE marketing_funding
  ADD COLUMN IF NOT EXISTS dispute_reason text;

ALTER TABLE marketing_funding_history
  ADD COLUMN IF NOT EXISTS dispute_reason text;

-- 3. Linked reversal transaction (append-only audit record).
CREATE TABLE IF NOT EXISTS marketing_funding_reversals (
  id uuid PRIMARY KEY,
  funding_id uuid NOT NULL REFERENCES marketing_funding(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  receiver_id uuid NOT NULL REFERENCES users(id),
  amount numeric(12, 2) NOT NULL,
  -- Status of the original funding at the moment it was reversed.
  previous_status funding_status NOT NULL,
  reason text NOT NULL,
  -- Receiver's available balance just before the reversal (null when the
  -- receiver had never been credited, i.e. previous_status SENT/DISPUTED).
  receiver_balance_before numeric(14, 2),
  reversed_by uuid NOT NULL REFERENCES users(id),
  reversed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_funding_reversals_funding_id_uq
  ON marketing_funding_reversals (funding_id);
CREATE INDEX IF NOT EXISTS marketing_funding_reversals_reversed_at_idx
  ON marketing_funding_reversals (reversed_at DESC);
