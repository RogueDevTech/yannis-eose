-- Fix mb_fund_transfers temporal audit wiring.
--
-- Migration 0233 created `mb_fund_transfers` with a legacy `sys_period tstzrange`
-- column and NO audit triggers. But the Drizzle schema uses `...temporalColumns`
-- (valid_from / valid_to / modified_by) and every write goes through
-- `withActor()`, which relies on the `yannis_stamp_actor` +
-- `yannis_capture_history` triggers.
--
-- Result: sending funds to an MB failed with
--   column "valid_from" of relation "mb_fund_transfers" does not exist
-- because the stamp trigger (and history capture) reference valid_from /
-- modified_by that never existed on this table.
--
-- This forward migration:
--   1. Adds valid_from / valid_to / modified_by to the main table.
--   2. Rebuilds mb_fund_transfers_history to match the corrected main table
--      exactly (yannis_capture_history does `INSERT ... SELECT ($1).*`, so the
--      history column set + order must be identical). Safe to drop-and-recreate:
--      the feature was failing on first insert, so no history rows exist.
--   3. Attaches the standard stamp + history triggers.
--   4. Drops the now-unused legacy sys_period column.

-- 1. Temporal columns on the main table -------------------------------------
ALTER TABLE mb_fund_transfers
  ADD COLUMN IF NOT EXISTS valid_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_to    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS modified_by UUID;

-- 4a. Drop legacy temporal column BEFORE rebuilding history so the history
--     table (LIKE main) never carries it. Guarded — no-op if already gone.
ALTER TABLE mb_fund_transfers DROP COLUMN IF EXISTS sys_period;

-- 2. Rebuild history table to mirror the corrected main table ----------------
DROP TABLE IF EXISTS mb_fund_transfers_history;
CREATE TABLE mb_fund_transfers_history (LIKE mb_fund_transfers INCLUDING ALL);

-- History holds many versions of the same row: drop PK + any unique indexes.
ALTER TABLE mb_fund_transfers_history DROP CONSTRAINT IF EXISTS mb_fund_transfers_history_pkey;

-- 3. Audit triggers (same pattern as every other temporal table) ------------
CREATE OR REPLACE TRIGGER trg_mb_fund_transfers_stamp
  BEFORE INSERT OR UPDATE ON mb_fund_transfers
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

CREATE OR REPLACE TRIGGER trg_mb_fund_transfers_history
  BEFORE UPDATE OR DELETE ON mb_fund_transfers
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();
