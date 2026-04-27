-- budgets + approval_requests (Drizzle schema existed; no journaled CREATE before).
-- 0025 only wired audit when base tables already existed. History INSERT triggers
-- yannis_capture_history_insert_{budgets,approval_requests} are defined in 0025.

DO $$ BEGIN
  CREATE TYPE approval_request_type AS ENUM (
    'MEDIA_SPEND', 'PROCUREMENT', 'LOGISTICS_REIMBURSEMENT', 'AD_HOC'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM (
    'PENDING', 'APPROVED', 'REJECTED', 'QUERIED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS budgets (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  department_or_campaign text NOT NULL,
  total_budget numeric(12, 2) NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY,
  type approval_request_type NOT NULL,
  requester_id uuid NOT NULL REFERENCES users (id),
  amount numeric(12, 2) NOT NULL,
  description text NOT NULL,
  status approval_status NOT NULL DEFAULT 'PENDING',
  approver_id uuid REFERENCES users (id),
  approval_reason text,
  approved_at timestamptz,
  budget_id uuid REFERENCES budgets (id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS budgets_created_at_idx ON budgets (created_at DESC);
CREATE INDEX IF NOT EXISTS approval_requests_created_at_idx ON approval_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS approval_requests_budget_id_idx ON approval_requests (budget_id);

-- ── budgets: history + temporal triggers ─────────────────────
DO $$
DECLARE
  _constraint RECORD;
BEGIN
  EXECUTE 'CREATE TABLE IF NOT EXISTS budgets_history (LIKE budgets INCLUDING ALL)';

  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'budgets_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE budgets_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS budgets_history_temporal_idx
    ON budgets_history (id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_budgets_stamp_actor ON budgets;
  CREATE TRIGGER trg_budgets_stamp_actor
    BEFORE INSERT OR UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_budgets_capture_history ON budgets;
  CREATE TRIGGER trg_budgets_capture_history
    BEFORE UPDATE OR DELETE ON budgets
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_budgets_history_immutable ON budgets_history;
  CREATE TRIGGER trg_budgets_history_immutable
    BEFORE UPDATE OR DELETE ON budgets_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

DROP TRIGGER IF EXISTS trg_budgets_capture_history_insert ON budgets;
CREATE TRIGGER trg_budgets_capture_history_insert
  AFTER INSERT ON budgets
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_budgets();

-- ── approval_requests: history + temporal triggers ───────────
DO $$
DECLARE
  _constraint RECORD;
BEGIN
  EXECUTE 'CREATE TABLE IF NOT EXISTS approval_requests_history (LIKE approval_requests INCLUDING ALL)';

  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'approval_requests_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE approval_requests_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS approval_requests_history_temporal_idx
    ON approval_requests_history (id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_approval_requests_stamp_actor ON approval_requests;
  CREATE TRIGGER trg_approval_requests_stamp_actor
    BEFORE INSERT OR UPDATE ON approval_requests
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_approval_requests_capture_history ON approval_requests;
  CREATE TRIGGER trg_approval_requests_capture_history
    BEFORE UPDATE OR DELETE ON approval_requests
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_approval_requests_history_immutable ON approval_requests_history;
  CREATE TRIGGER trg_approval_requests_history_immutable
    BEFORE UPDATE OR DELETE ON approval_requests_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

DROP TRIGGER IF EXISTS trg_approval_requests_capture_history_insert ON approval_requests;
CREATE TRIGGER trg_approval_requests_capture_history_insert
  AFTER INSERT ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_approval_requests();
