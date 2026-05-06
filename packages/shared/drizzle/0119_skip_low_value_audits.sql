-- Stop generating audit history rows for five high-churn / low-signal tables (2026-05).
--
-- Why: every UPDATE on these tables fires a `capture_history` trigger that
-- copies the OLD row to `<table>_history`. For the five tables below, the
-- per-write overhead is non-trivial (every order CONFIRMED / AGENT_ASSIGNED /
-- DELIVERED touches `inventory_levels` and `stock_batches`) AND the resulting
-- history rows have no forensic value:
--
--   - inventory_levels  — `(stock_count, reserved_count)` deltas with no
--                         business context. The order's own audit row + the
--                         `stock_movements` ledger already say WHY.
--   - stock_batches     — `remaining_quantity` decrements per FIFO step. Same:
--                         `stock_movements` is the canonical movement ledger.
--   - stock_movements   — append-only ledger; every row is itself the audit.
--                         `*_history` is a 1:1 duplicate.
--   - call_logs         — append-only call attempts; the row IS the record.
--   - cart_abandonments — most state transitions are cron-driven (PENDING →
--                         ABANDONED) with a "System" actor. No human story.
--
-- What this migration does:
--   1. DROPs the `capture_history` (UPDATE/DELETE) trigger on each table.
--   2. DROPs the `capture_history_insert` (INSERT) trigger on each table.
--   3. KEEPs the `stamp_actor` trigger so `modified_by` still gets stamped on
--      the live row (other code may join on it).
--   4. KEEPs the existing `<table>_history` table and its rows. Old data
--      stays queryable directly via SQL by SuperAdmin if a forensic question
--      ever needs it; we just stop adding new rows.
--
-- Reversible: re-installing the triggers via the same DDL pattern used in
-- migrations 0003 + 0005 + 0027 brings auditing back. To recover write-side
-- visibility for one of these tables, hand-write a fresh migration that
-- re-runs the trigger creation block for that table only.
--
-- Idempotent: every DROP is `IF EXISTS`.

DO $$
DECLARE
  _tables TEXT[] := ARRAY[
    'inventory_levels',
    'stock_batches',
    'stock_movements',
    'call_logs',
    'cart_abandonments'
  ];
  _t TEXT;
BEGIN
  FOREACH _t IN ARRAY _tables
  LOOP
    -- Skip cleanly if the live table doesn't exist (e.g. partial schema)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _t
    ) THEN
      RAISE NOTICE 'skipping % (table not present)', _t;
      CONTINUE;
    END IF;

    -- 1. UPDATE/DELETE history capture — the heavy one for inventory_levels +
    -- stock_batches because every order transition fires it.
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_capture_history ON %I',
      _t, _t
    );

    -- 2. INSERT history capture (only present on some tables, IF EXISTS handles).
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_capture_history_insert ON %I',
      _t, _t
    );

    -- 3. KEEP `trg_<t>_stamp_actor` — `modified_by` is still useful on the
    --    live row even when we no longer keep its history.
    -- 4. KEEP `trg_<t>_history_immutable` on the history table — the existing
    --    rows must still be tamper-proof.

    RAISE NOTICE 'audit history capture disabled for: % (history table preserved)', _t;
  END LOOP;
END;
$$;
