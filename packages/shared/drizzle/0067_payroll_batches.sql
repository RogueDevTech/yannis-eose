-- ============================================
-- Payroll Batches — multi-stage monthly workflow
-- ============================================
-- A payroll_batch groups payout_records by (branch × department × month).
-- Lifecycle: DRAFT → PENDING_HR → PENDING_FINANCE → PAID. Reject is an action
-- that drops the batch one stage; there is no terminal REJECTED status.
--
-- Heads of Department prepare DRAFTs for their team, submit to HR, who reviews,
-- adds adjustments, and forwards to Finance. CEO directive 2026-04-26.
-- See CLAUDE.md → "Payroll Workflow" for the full state machine + RBAC.

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE payroll_batch_status AS ENUM ('DRAFT', 'PENDING_HR', 'PENDING_FINANCE', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_department AS ENUM ('CS', 'MARKETING', 'LOGISTICS', 'HR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Main table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_batches (
  id uuid PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES branches(id),
  period_month date NOT NULL,
  department payroll_department NOT NULL,
  status payroll_batch_status NOT NULL DEFAULT 'DRAFT',

  prepared_by uuid REFERENCES users(id),
  prepared_at timestamptz,

  submitted_at timestamptz,
  submitted_by uuid REFERENCES users(id),

  hr_reviewed_at timestamptz,
  hr_reviewed_by uuid REFERENCES users(id),
  hr_notes text,

  finance_processed_at timestamptz,
  finance_processed_by uuid REFERENCES users(id),
  finance_reference text,

  rejection_reason text,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES users(id),

  staff_count integer NOT NULL DEFAULT 0,
  total_amount numeric(14, 2) NOT NULL DEFAULT 0,

  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One non-removed batch per (branch, period, department).
-- Service layer enforces "no duplicate generation"; DB index is the safety net.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_batch_per_branch_dept_month
  ON payroll_batches (branch_id, period_month, department);

CREATE INDEX IF NOT EXISTS payroll_batches_status_idx ON payroll_batches (status);
CREATE INDEX IF NOT EXISTS payroll_batches_period_idx ON payroll_batches (period_month DESC);
CREATE INDEX IF NOT EXISTS payroll_batches_branch_period_idx
  ON payroll_batches (branch_id, period_month DESC);

-- ── batch_id on payout_records (+ history sync) ──────────────
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES payroll_batches(id);
CREATE INDEX IF NOT EXISTS payout_records_batch_id_idx ON payout_records (batch_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payout_records_history') THEN
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS batch_id uuid;
  END IF;
END $$;

-- ── History table + temporal triggers (mirrors 0025 pattern) ──
DO $$
DECLARE
  _constraint RECORD;
BEGIN
  -- Mirror structure
  EXECUTE 'CREATE TABLE IF NOT EXISTS payroll_batches_history (LIKE payroll_batches INCLUDING ALL)';

  -- Drop PK + uniques on history (history rows are NOT unique by id)
  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'payroll_batches_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE payroll_batches_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS payroll_batches_history_temporal_idx
    ON payroll_batches_history (id, valid_from, valid_to);

  -- Stamp actor on INSERT/UPDATE
  DROP TRIGGER IF EXISTS trg_payroll_batches_stamp_actor ON payroll_batches;
  CREATE TRIGGER trg_payroll_batches_stamp_actor
    BEFORE INSERT OR UPDATE ON payroll_batches
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  -- Capture history on UPDATE/DELETE
  DROP TRIGGER IF EXISTS trg_payroll_batches_capture_history ON payroll_batches;
  CREATE TRIGGER trg_payroll_batches_capture_history
    BEFORE UPDATE OR DELETE ON payroll_batches
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  -- History rows immutable
  DROP TRIGGER IF EXISTS trg_payroll_batches_history_immutable ON payroll_batches_history;
  CREATE TRIGGER trg_payroll_batches_history_immutable
    BEFORE UPDATE OR DELETE ON payroll_batches_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- ── INSERT capture for payroll_batches ────────────────────────
-- payroll_batches has numeric (total_amount) — generic dynamic SQL trigger loses
-- the numeric type, so use an explicit-cast table-specific trigger (see CLAUDE.md
-- → "Numeric Columns, Temporal Triggers, and History Table Sync").

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_payroll_batches()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO payroll_batches_history (
    id, branch_id, period_month, department, status,
    prepared_by, prepared_at,
    submitted_at, submitted_by,
    hr_reviewed_at, hr_reviewed_by, hr_notes,
    finance_processed_at, finance_processed_by, finance_reference,
    rejection_reason, rejected_at, rejected_by,
    staff_count, total_amount,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.branch_id, NEW.period_month, NEW.department, NEW.status,
    NEW.prepared_by, NEW.prepared_at,
    NEW.submitted_at, NEW.submitted_by,
    NEW.hr_reviewed_at, NEW.hr_reviewed_by, NEW.hr_notes,
    NEW.finance_processed_at, NEW.finance_processed_by, NEW.finance_reference,
    NEW.rejection_reason, NEW.rejected_at, NEW.rejected_by,
    (NEW.staff_count)::integer, (NEW.total_amount)::numeric,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_batches_capture_history_insert ON payroll_batches;
CREATE TRIGGER trg_payroll_batches_capture_history_insert
  AFTER INSERT ON payroll_batches
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_payroll_batches();
