-- Migration 0361: funding refunds, adjustments and month close (2026-11-10).
--
-- Ticket 1 (refunds): a funding receiver (Media Buyer, or a Head of Marketing
-- funded by Finance) returns unspent money to the person who funded them.
--   PENDING   -> receiver asked; the amount is HELD (leaves their available
--                balance) so it cannot be spent or refunded twice
--   APPROVED  -> the funder agreed; still held, money is being sent back
--   COMPLETED -> the funder confirmed the money arrived; receiver debited,
--                funder credited, in one transaction
--   REJECTED / CANCELLED -> hold released, no balance effect
-- Every refund links to ONE original marketing_funding row (COMPLETED, same
-- receiver). The original row is never edited.
--
-- Ticket 2 (reconciliation):
--   * marketing_funding_adjustments: approved credit/debit corrections with a
--     reason. Requested by one Finance/Admin user, approved by ANOTHER.
--   * marketing_funding_period_closes + marketing_funding_period_balances:
--     Finance closes a month per company; each recipient's figures for that
--     month are frozen. Later changes dated inside a closed month are not
--     hidden: the reconciliation shows them as "Prior-period corrections" in
--     the first open month. Both tables are append-only.
--
-- Funding is naira-only by design (multi-currency plan row 7), so
-- currency_code is recorded for the audit trail and always 'NGN' today.
--
-- Refunds and adjustments are system-versioned (history twin + triggers,
-- same pattern as 0316 currencies).

DO $$ BEGIN
  CREATE TYPE funding_refund_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE funding_adjustment_direction AS ENUM ('CREDIT', 'DEBIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE funding_adjustment_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 1. Refunds ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_funding_refunds (
  id uuid PRIMARY KEY,
  reference text NOT NULL,
  funding_id uuid NOT NULL REFERENCES marketing_funding(id),
  refunder_id uuid NOT NULL REFERENCES users(id),
  funder_id uuid NOT NULL REFERENCES users(id),
  -- The company both parties share; the refund never crosses companies.
  group_id uuid REFERENCES branch_groups(id),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'NGN',
  reason text NOT NULL,
  receipt_url text,
  status funding_refund_status NOT NULL DEFAULT 'PENDING',
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text,
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_funding_refunds_reference_uq
  ON marketing_funding_refunds (reference);
CREATE INDEX IF NOT EXISTS marketing_funding_refunds_funding_status_idx
  ON marketing_funding_refunds (funding_id, status);
CREATE INDEX IF NOT EXISTS marketing_funding_refunds_refunder_status_idx
  ON marketing_funding_refunds (refunder_id, status);
CREATE INDEX IF NOT EXISTS marketing_funding_refunds_funder_status_idx
  ON marketing_funding_refunds (funder_id, status);

-- ── 2. Adjustments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_funding_adjustments (
  id uuid PRIMARY KEY,
  reference text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  direction funding_adjustment_direction NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'NGN',
  reason text NOT NULL,
  related_funding_id uuid REFERENCES marketing_funding(id),
  -- First day of the month this corrects, when it corrects a closed month.
  related_period_month date,
  status funding_adjustment_status NOT NULL DEFAULT 'PENDING',
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_funding_adjustments_reference_uq
  ON marketing_funding_adjustments (reference);
CREATE INDEX IF NOT EXISTS marketing_funding_adjustments_user_status_idx
  ON marketing_funding_adjustments (user_id, status);

-- ── 3. History twins + triggers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_funding_refunds_history (
  LIKE marketing_funding_refunds INCLUDING ALL
);
CREATE TABLE IF NOT EXISTS marketing_funding_adjustments_history (
  LIKE marketing_funding_adjustments INCLUDING ALL
);

DO $$
DECLARE _t text; _c text; _i text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['marketing_funding_refunds', 'marketing_funding_adjustments']
  LOOP
    -- History rows repeat ids: drop the copied PK / unique constraints and indexes.
    FOR _c IN
      SELECT tc.constraint_name FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public' AND tc.table_name = _t || '_history'
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', _t || '_history', _c);
    END LOOP;
    FOR _i IN
      SELECT indexrelid::regclass::text FROM pg_index i
      WHERE i.indisunique AND i.indrelid = format('public.%I', _t || '_history')::regclass
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS %s', _i);
    END LOOP;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || _t || '_stamp_actor', _t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()',
      'trg_' || _t || '_stamp_actor', _t
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || _t || '_capture_history', _t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()',
      'trg_' || _t || '_capture_history', _t
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || _t || '_history_immutable', _t || '_history');
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable()',
      'trg_' || _t || '_history_immutable', _t || '_history'
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS marketing_funding_refunds_history_id_idx
  ON marketing_funding_refunds_history (id, valid_to);
CREATE INDEX IF NOT EXISTS marketing_funding_adjustments_history_id_idx
  ON marketing_funding_adjustments_history (id, valid_to);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_table_registry') THEN
    INSERT INTO audit_table_registry (table_name) VALUES
      ('marketing_funding_refunds'), ('marketing_funding_adjustments')
    ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 4. Month close (append-only snapshots) ──────────────────────────────────
CREATE OR REPLACE FUNCTION yannis_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS marketing_funding_period_closes (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES branch_groups(id),
  -- First day of the closed month (Lagos calendar).
  period_month date NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  closed_by uuid NOT NULL REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  user_count integer NOT NULL DEFAULT 0,
  total_closing numeric(14, 2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One close per company per month: a double click cannot close twice.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_funding_period_closes_group_month_uq
  ON marketing_funding_period_closes (group_id, period_month);

CREATE TABLE IF NOT EXISTS marketing_funding_period_balances (
  id uuid PRIMARY KEY,
  close_id uuid NOT NULL REFERENCES marketing_funding_period_closes(id),
  user_id uuid NOT NULL REFERENCES users(id),
  opening numeric(14, 2) NOT NULL,
  received numeric(14, 2) NOT NULL,
  distributed numeric(14, 2) NOT NULL,
  expenses numeric(14, 2) NOT NULL,
  refunds_out numeric(14, 2) NOT NULL,
  refunds_in numeric(14, 2) NOT NULL,
  credits numeric(14, 2) NOT NULL,
  debits numeric(14, 2) NOT NULL,
  corrections numeric(14, 2) NOT NULL,
  closing numeric(14, 2) NOT NULL,
  pending_expenses numeric(14, 2) NOT NULL,
  pending_refunds numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_funding_period_balances_close_user_uq
  ON marketing_funding_period_balances (close_id, user_id);
CREATE INDEX IF NOT EXISTS marketing_funding_period_balances_user_idx
  ON marketing_funding_period_balances (user_id);

DROP TRIGGER IF EXISTS trg_marketing_funding_period_closes_append_only ON marketing_funding_period_closes;
CREATE TRIGGER trg_marketing_funding_period_closes_append_only
  BEFORE UPDATE OR DELETE ON marketing_funding_period_closes
  FOR EACH ROW EXECUTE FUNCTION yannis_append_only();

DROP TRIGGER IF EXISTS trg_marketing_funding_period_balances_append_only ON marketing_funding_period_balances;
CREATE TRIGGER trg_marketing_funding_period_balances_append_only
  BEFORE UPDATE OR DELETE ON marketing_funding_period_balances
  FOR EACH ROW EXECUTE FUNCTION yannis_append_only();
