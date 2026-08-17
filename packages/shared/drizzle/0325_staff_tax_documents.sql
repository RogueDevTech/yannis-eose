-- Migration 0325: Staff tax documents (doc §5).
--
-- HR files tax documents per staff (TIN certificates, tax cards, PAYE receipts,
-- clearance certs). The file lives in GCS (doc_url, tax-docs folder); a signed
-- URL is minted on demand for download. No group column: company scope via
-- staff_id → user_branches ∩ effectiveBranchIds (mirrors the other HR tables).

-- ── 1. tax_document_type enum ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE tax_document_type AS ENUM (
    'TIN_CERTIFICATE', 'TAX_CARD', 'PAYE_RECEIPT', 'TAX_CLEARANCE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. staff_tax_documents table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_tax_documents (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES users(id),
  doc_type tax_document_type NOT NULL,
  title text NOT NULL,
  doc_url text NOT NULL,
  notes text,
  expires_on date,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- temporalColumns (must match the Drizzle helper: valid_from, valid_to, modified_by).
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid
);

CREATE INDEX IF NOT EXISTS staff_tax_documents_staff_idx ON staff_tax_documents (staff_id);

-- ── 3. History twin + temporal audit triggers (same pattern as 0072 / 0323) ──
DO $$
DECLARE
  _t TEXT := 'staff_tax_documents';
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
