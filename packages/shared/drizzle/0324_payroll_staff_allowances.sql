-- Migration 0324: Per-staff ad-hoc TAXABLE allowances (doc §3).
--
-- An allowance is earnings, added to GROSS before PAYE (so it is taxed), on top
-- of any role/formula allowances. `recurring` drives proration: recurring monthly
-- allowances are prorated by active days for mid-month joiners/leavers; one-time
-- allowances are paid in full. Kept in its own table for independent traceability
-- (doc §10), but folded into the existing payout_records.allowances_total bucket
-- so the gross/PAYE math stays uniform — the payslip breaks out each named line
-- from this table.
--
-- No group column: company scope via staff_id → user_branches ∩ effectiveBranchIds
-- (mirrors earnings_adjustments / payroll_refunds). Reuses the refund_status enum
-- (APPROVED / VOIDED) created in 0323.

-- ── 1. payroll_staff_allowances table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_staff_allowances (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES users(id),
  amount numeric(12, 2) NOT NULL,
  name text NOT NULL,
  notes text,
  recurring boolean NOT NULL DEFAULT false,
  status refund_status NOT NULL DEFAULT 'APPROVED',
  approved_by uuid NOT NULL REFERENCES users(id),
  payout_id uuid REFERENCES payout_records(id),
  period_month date,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- temporalColumns (must match the Drizzle helper: valid_from, valid_to, modified_by).
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid
);

CREATE INDEX IF NOT EXISTS payroll_staff_allowances_staff_idx ON payroll_staff_allowances (staff_id);
-- Batch sweep looks up approved, not-yet-swept allowances for a period.
CREATE INDEX IF NOT EXISTS payroll_staff_allowances_sweep_idx
  ON payroll_staff_allowances (staff_id, status, payout_id, period_month);

-- ── 2. History twin + temporal audit triggers (same pattern as 0072 / 0323) ──
DO $$
DECLARE
  _t TEXT := 'payroll_staff_allowances';
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
