-- ============================================
-- Staff Onboarding records
-- ============================================
-- Per-user onboarding profile data captured AFTER the user is already active.
-- Does NOT gate the user's normal login/use of the app — the user's
-- `users.status` stays ACTIVE on creation. This table is for HR record-keeping
-- and the post-invite "complete your onboarding" flow.
--
-- Lifecycle:
--   NOT_STARTED  — staff hasn't opened the form yet (default on user create)
--   IN_PROGRESS  — staff has saved drafts but not yet submitted to HR
--   SUBMITTED    — staff clicked "Submit for HR review"; locked for staff edits
--   APPROVED     — HR approved; permanently locked for staff (HR can still edit)
--
-- HR can view + edit anyone's onboarding through the user detail page.
-- Staff hit a popup "Complete your onboarding" on login when status is
-- NOT_STARTED / IN_PROGRESS, dismissable as a "skip" (no enforcement).
--
-- Two guarantors per Nigerian standard practice (mandatory at SUBMITTED).
--
-- File URLs (proof of address, supporting documents, guarantor letters) are
-- R2/S3 keys uploaded via the existing FileUpload flow — Pillar 2 handling
-- (column-stripped for non-HR/non-admin viewers in the service layer).

DO $$ BEGIN
  CREATE TYPE onboarding_status AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE staff_gender AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS staff_onboarding (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  status onboarding_status NOT NULL DEFAULT 'NOT_STARTED',

  -- Personal details (filled by staff)
  gender staff_gender,
  date_of_birth date,
  residential_address text,
  proof_of_address_url text,

  -- Free-form supporting documents — array of { label, url } objects.
  -- Staff can attach as many as needed (ID card, NYSC certificate, school cert, etc.).
  supporting_documents jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Guarantor 1 (required at SUBMITTED — service-level validation, not DB).
  guarantor1_name text,
  guarantor1_phone text,
  guarantor1_email text,
  guarantor1_address text,
  guarantor1_relationship text,
  guarantor1_letter_url text,

  -- Guarantor 2 (required at SUBMITTED — service-level validation, not DB).
  guarantor2_name text,
  guarantor2_phone text,
  guarantor2_email text,
  guarantor2_address text,
  guarantor2_relationship text,
  guarantor2_letter_url text,

  -- Workflow stamps
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),

  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One onboarding record per user (1:1).
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_onboarding_user_id
  ON staff_onboarding (user_id);

CREATE INDEX IF NOT EXISTS staff_onboarding_status_idx ON staff_onboarding (status);
CREATE INDEX IF NOT EXISTS staff_onboarding_submitted_at_idx ON staff_onboarding (submitted_at);

-- ── History table + temporal triggers ─────────────────────────
DO $$
DECLARE
  _constraint RECORD;
BEGIN
  EXECUTE 'CREATE TABLE IF NOT EXISTS staff_onboarding_history (LIKE staff_onboarding INCLUDING ALL)';

  -- Drop PK + uniques (constraint form)
  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'staff_onboarding_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE staff_onboarding_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  -- Drop unique INDEXES copied by INCLUDING ALL (unique indexes ≠ constraints).
  -- See CLAUDE.md → "Do NOT use LIKE … INCLUDING ALL …" — the user_id unique
  -- would block multi-version history rows for the same user.
  EXECUTE 'DROP INDEX IF EXISTS uq_staff_onboarding_user_id_history';
  EXECUTE 'DROP INDEX IF EXISTS staff_onboarding_history_user_id_idx';
  -- Programmatic safety net — drop any *unique* index attached to history
  -- regardless of name, leaving non-unique indexes alone.
  FOR _constraint IN
    SELECT i.relname AS index_name
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE t.relname = 'staff_onboarding_history' AND ix.indisunique
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', _constraint.index_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS staff_onboarding_history_temporal_idx
    ON staff_onboarding_history (id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_staff_onboarding_stamp_actor ON staff_onboarding;
  CREATE TRIGGER trg_staff_onboarding_stamp_actor
    BEFORE INSERT OR UPDATE ON staff_onboarding
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_staff_onboarding_capture_history ON staff_onboarding;
  CREATE TRIGGER trg_staff_onboarding_capture_history
    BEFORE UPDATE OR DELETE ON staff_onboarding
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_staff_onboarding_history_immutable ON staff_onboarding_history;
  CREATE TRIGGER trg_staff_onboarding_history_immutable
    BEFORE UPDATE OR DELETE ON staff_onboarding_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- ── INSERT capture (no numeric columns, generic dynamic trigger is fine) ──
DROP TRIGGER IF EXISTS trg_staff_onboarding_capture_history_insert ON staff_onboarding;
CREATE TRIGGER trg_staff_onboarding_capture_history_insert
  AFTER INSERT ON staff_onboarding
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert();
