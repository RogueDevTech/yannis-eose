-- ============================================================================
-- Phase 1 — Double-Entry General Ledger Foundation
--
-- Tables: accounts, fiscal_years, journal_entries (voucher header), gl_entries
-- (the immutable ledger = the journal lines). Replicates the client's ERPNext
-- accounting engine. Trial Balance / P&L / Balance Sheet are all queries over
-- gl_entries.
--
-- accounts / fiscal_years / journal_entries: standard temporal audit (history
-- twin + capture triggers), since they are editable.
--
-- gl_entries: APPEND-ONLY. No history twin — corrections are reversing entries,
-- never edits. A BEFORE UPDATE OR DELETE trigger hard-blocks all mutation.
-- ============================================================================

-- ─── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE gl_root_type AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gl_account_type AS ENUM (
    'BANK', 'CASH', 'RECEIVABLE', 'PAYABLE', 'STOCK', 'COST_OF_GOODS_SOLD',
    'TAX', 'FIXED_ASSET', 'INDIRECT_EXPENSE', 'INDIRECT_INCOME', 'DIRECT_INCOME',
    'EQUITY', 'ROUND_OFF', 'TEMPORARY', 'DEPRECIATION', 'EXPENSE_ACCOUNT',
    'CHARGEABLE', 'STOCK_RECEIVED_BUT_NOT_BILLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gl_voucher_type AS ENUM ('JOURNAL_ENTRY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE journal_entry_status AS ENUM ('POSTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fiscal_year_status AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── accounts (Chart of Accounts tree) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id                uuid PRIMARY KEY NOT NULL,
  group_id          uuid REFERENCES branch_groups (id),
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  root_type         gl_root_type NOT NULL,
  account_type      gl_account_type,
  is_group          BOOLEAN NOT NULL DEFAULT FALSE,
  parent_account_id uuid,
  balance           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to          TIMESTAMPTZ,
  modified_by       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_group_code_uidx ON accounts (group_id, code);
CREATE INDEX IF NOT EXISTS accounts_parent_idx ON accounts (parent_account_id);
CREATE INDEX IF NOT EXISTS accounts_group_roottype_idx ON accounts (group_id, root_type);

-- ─── fiscal_years (period-lock guard) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_years (
  id           uuid PRIMARY KEY NOT NULL,
  group_id     uuid REFERENCES branch_groups (id),
  name         TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  status       fiscal_year_status NOT NULL DEFAULT 'OPEN',
  valid_from   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to     TIMESTAMPTZ,
  modified_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fiscal_years_group_dates_idx ON fiscal_years (group_id, start_date, end_date);

-- ─── journal_entries (voucher header) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id              uuid PRIMARY KEY NOT NULL,
  group_id        uuid REFERENCES branch_groups (id),
  entry_number    SERIAL NOT NULL UNIQUE,
  posting_date    DATE NOT NULL,
  description     TEXT NOT NULL,
  total_debit     NUMERIC(12, 2) NOT NULL,
  total_credit    NUMERIC(12, 2) NOT NULL,
  status          journal_entry_status NOT NULL DEFAULT 'POSTED',
  reversal_of_id  uuid,
  fiscal_year_id  uuid REFERENCES fiscal_years (id),
  idempotency_key TEXT,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to        TIMESTAMPTZ,
  modified_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journal_entries_group_date_idx ON journal_entries (group_id, posting_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_group_idem_uidx
  ON journal_entries (group_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ─── gl_entries (immutable ledger = journal lines) ───────────────────────────
CREATE TABLE IF NOT EXISTS gl_entries (
  id             uuid PRIMARY KEY NOT NULL,
  group_id       uuid REFERENCES branch_groups (id),
  account_id     uuid NOT NULL REFERENCES accounts (id),
  posting_date   DATE NOT NULL,
  debit          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  credit         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  voucher_type   gl_voucher_type NOT NULL,
  voucher_id     uuid NOT NULL,
  party_type     TEXT,
  party_id       uuid,
  remarks        TEXT,
  fiscal_year_id uuid REFERENCES fiscal_years (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modified_by    TEXT,
  CONSTRAINT gl_entries_nonneg_chk CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT gl_entries_one_sided_chk CHECK ((debit = 0) <> (credit = 0))
);

CREATE INDEX IF NOT EXISTS gl_entries_account_date_idx ON gl_entries (account_id, posting_date);
CREATE INDEX IF NOT EXISTS gl_entries_voucher_idx ON gl_entries (voucher_type, voucher_id);
CREATE INDEX IF NOT EXISTS gl_entries_group_date_idx ON gl_entries (group_id, posting_date);
CREATE INDEX IF NOT EXISTS gl_entries_party_idx ON gl_entries (party_type, party_id) WHERE party_id IS NOT NULL;

-- ─── Temporal audit (accounts, fiscal_years, journal_entries) ─────────────────
-- Same pattern as 0072_stock_reconciliations.sql: history twin + capture triggers.
DO $$
DECLARE
  _t TEXT;
  _tables TEXT[] := ARRAY['accounts', 'fiscal_years', 'journal_entries'];
  _constraint RECORD;
  _idx RECORD;
BEGIN
  FOREACH _t IN ARRAY _tables LOOP
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

    -- `LIKE ... INCLUDING ALL` also copies plain UNIQUE INDEXes (not just
    -- constraints). A history table stores many versions of the same row, so any
    -- uniqueness on the base columns (e.g. accounts (group_id, code)) MUST be
    -- dropped or the capture trigger fails on the 2nd version. Drop every unique
    -- index on the history table except the temporal one we add below.
    FOR _idx IN
      SELECT i.indexname
      FROM pg_indexes i
      JOIN pg_class c ON c.relname = i.indexname
      JOIN pg_index ix ON ix.indexrelid = c.oid
      WHERE i.schemaname = 'public'
        AND i.tablename = _t || '_history'
        AND ix.indisunique
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS %I', _idx.indexname);
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
  END LOOP;
END;
$$;

-- ─── gl_entries append-only enforcement ──────────────────────────────────────
-- No history twin. gl_entries has no valid_from column, so it uses a dedicated
-- stamp function that only sets modified_by (the shared yannis_stamp_actor also
-- writes NEW.valid_from and would fail on this table). A hard block on any
-- UPDATE/DELETE makes the ledger immutable — corrections are reversing entries.
CREATE OR REPLACE FUNCTION gl_entries_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  NEW.modified_by := current_setting('yannis.current_user_id', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gl_entries_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'gl_entries is append-only; post a reversing entry instead of editing (op: %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gl_entries_stamp_actor ON gl_entries;
CREATE TRIGGER trg_gl_entries_stamp_actor
  BEFORE INSERT ON gl_entries
  FOR EACH ROW EXECUTE FUNCTION gl_entries_stamp_actor();

DROP TRIGGER IF EXISTS trg_gl_entries_immutable ON gl_entries;
CREATE TRIGGER trg_gl_entries_immutable
  BEFORE UPDATE OR DELETE ON gl_entries
  FOR EACH ROW EXECUTE FUNCTION gl_entries_immutable();
