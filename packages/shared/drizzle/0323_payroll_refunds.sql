-- Migration 0323: Staff refunds (post-tax) — HR records cash owed back to staff.
--
-- A refund is money the company reimburses to a staff member (out-of-pocket
-- expense, over-deduction, etc.). It is added to net pay AFTER PAYE + statutory
-- and is NEVER taxed. Kept in its own table so every refund is independently
-- traceable, per doc §10 (Base ≠ Allowance ≠ Bonus ≠ Add-on ≠ Deduction ≠ PAYE
-- ≠ Refund). Mirrors earnings_adjustments: no group column — company scope is
-- enforced at query time via staff_id → user_branches ∩ effectiveBranchIds.
--
-- Also adds payout_records.refund_total (+ history twin) so payslips + exports
-- surface the refund line, mirroring add_ons_total.

-- ── 1. refund_status enum ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE refund_status AS ENUM ('APPROVED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. payroll_refunds table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_refunds (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES users(id),
  amount numeric(12, 2) NOT NULL,
  reason text NOT NULL,
  notes text,
  doc_url text,
  refund_date date NOT NULL,
  status refund_status NOT NULL DEFAULT 'APPROVED',
  approved_by uuid NOT NULL REFERENCES users(id),
  payout_id uuid REFERENCES payout_records(id),
  period_month date,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- temporalColumns (must match the Drizzle `temporalColumns` helper exactly:
  -- valid_from, valid_to, modified_by — the positional history trigger copies by
  -- ordinal position, so column order + names must line up with the schema).
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid
);

CREATE INDEX IF NOT EXISTS payroll_refunds_staff_idx ON payroll_refunds (staff_id);
-- Batch sweep looks up approved, not-yet-swept refunds for a period.
CREATE INDEX IF NOT EXISTS payroll_refunds_sweep_idx
  ON payroll_refunds (staff_id, status, payout_id, period_month);

-- ── 3. History twin + temporal audit triggers (same pattern as 0072) ─────────
DO $$
DECLARE
  _t TEXT := 'payroll_refunds';
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

-- ── 4. payout_records.refund_total (+ history twin, positional-aligned) ──────
ALTER TABLE payout_records
  ADD COLUMN IF NOT EXISTS refund_total numeric(12, 2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payout_records_history'
  ) THEN
    ALTER TABLE payout_records_history
      ADD COLUMN IF NOT EXISTS refund_total numeric(12, 2);
  END IF;
END $$;
