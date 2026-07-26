-- ============================================
-- Payroll Module PRD — schema extensions
-- Config-driven pay roles, product tiers, PAYE bands, contractors, payslip snapshots
-- ============================================

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE payroll_pay_role_category AS ENUM (
    'CS', 'MEDIA_BUYING', 'LOGISTICS', 'OPERATIONS', 'SUPPORT', 'LEADERSHIP', 'CONTRACTOR'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_employment_type AS ENUM ('STAFF', 'CONTRACTOR_AGENCY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_salary_basis AS ENUM ('FORMULA_BASED', 'FLAT_RATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_tax_status AS ENUM (
    'STANDARD_PAYE', 'EMPLOYER_SUBSIDIZED_PAYE', 'GROSS_NO_DEDUCTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_onboarding_status AS ENUM (
    'NOT_APPLICABLE', 'PENDING_APPROVAL', 'ACTIVE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_batch_scope_type AS ENUM ('ALL_BRANCHES', 'BRANCHES', 'EMPLOYEES', 'DEPARTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_payslip_line_status AS ENUM ('OK', 'NEEDS_ATTENTION', 'MANUALLY_OVERRIDDEN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Pay roles (Role Library) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_pay_roles (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES branch_groups(id),
  name text NOT NULL,
  category payroll_pay_role_category NOT NULL,
  reports_to_required boolean NOT NULL DEFAULT false,
  per_product_bonus boolean NOT NULL DEFAULT false,
  commission_plan_id uuid REFERENCES commission_plans(id),
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_pay_roles_group_idx ON payroll_pay_roles (group_id);
CREATE INDEX IF NOT EXISTS payroll_pay_roles_active_idx ON payroll_pay_roles (active) WHERE active = true;

-- ── Product tier configs (CS per-product DR tiers) ───────────
CREATE TABLE IF NOT EXISTS payroll_product_tier_configs (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES branch_groups(id),
  product_id uuid REFERENCES products(id),
  product_name text NOT NULL,
  branch_ids uuid[],
  active boolean NOT NULL DEFAULT true,
  tier_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_product_tier_configs_group_idx
  ON payroll_product_tier_configs (group_id);

-- ── PAYE tax band configs ────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_tax_band_configs (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES branch_groups(id),
  label text NOT NULL DEFAULT 'Default PAYE',
  tax_free_threshold numeric(14, 2) NOT NULL DEFAULT 800000,
  bands jsonb NOT NULL DEFAULT '[]'::jsonb,
  reliefs jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_tax_band_configs_group_effective_idx
  ON payroll_tax_band_configs (group_id, effective_from DESC);

-- ── External contractors (agency vendors) ────────────────────
CREATE TABLE IF NOT EXISTS payroll_contractors (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES branch_groups(id),
  name text NOT NULL,
  branch_id uuid REFERENCES branches(id),
  monthly_fee numeric(14, 2) NOT NULL,
  bank_name text,
  bank_code text,
  account_number text,
  account_name text,
  bank_verified boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_contractors_group_idx ON payroll_contractors (group_id);
CREATE INDEX IF NOT EXISTS payroll_contractors_branch_idx ON payroll_contractors (branch_id);

-- ── Extend users with payroll profile ────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_role_id uuid REFERENCES payroll_pay_roles(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type payroll_employment_type DEFAULT 'STAFF';
ALTER TABLE users ADD COLUMN IF NOT EXISTS salary_basis payroll_salary_basis DEFAULT 'FORMULA_BASED';
ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_status payroll_tax_status DEFAULT 'STANDARD_PAYE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reports_to_user_id uuid REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_linked boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_payroll_status payroll_onboarding_status DEFAULT 'NOT_APPLICABLE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS payroll_employee_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_verification_status text DEFAULT 'UNVERIFIED';

CREATE INDEX IF NOT EXISTS users_pay_role_id_idx ON users (pay_role_id);
CREATE INDEX IF NOT EXISTS users_reports_to_idx ON users (reports_to_user_id);

-- Sync users_history
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users_history') THEN
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS pay_role_id uuid;
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS employment_type payroll_employment_type;
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS salary_basis payroll_salary_basis;
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS tax_status payroll_tax_status;
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS reports_to_user_id uuid;
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS crm_linked boolean;
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS onboarding_payroll_status payroll_onboarding_status;
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS payroll_employee_id text;
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS bank_verification_status text;
  END IF;
END $$;

-- Link commission_plans to pay roles
ALTER TABLE commission_plans ADD COLUMN IF NOT EXISTS pay_role_id uuid REFERENCES payroll_pay_roles(id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'commission_plans_history') THEN
    ALTER TABLE commission_plans_history ADD COLUMN IF NOT EXISTS pay_role_id uuid;
  END IF;
END $$;

-- ── Extend payroll_batches ───────────────────────────────────
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS scope_type payroll_batch_scope_type DEFAULT 'DEPARTMENT';
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS scope_branch_ids uuid[];
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS scope_employee_ids uuid[];
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS include_contractors boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS run_label text;
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS disbursement_date date;
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS proof_of_payment_url text;
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS total_gross numeric(14, 2) DEFAULT 0;
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS total_tax numeric(14, 2) DEFAULT 0;
ALTER TABLE payroll_batches ADD COLUMN IF NOT EXISTS total_net numeric(14, 2) DEFAULT 0;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payroll_batches_history') THEN
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS scope_type payroll_batch_scope_type;
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS scope_branch_ids uuid[];
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS scope_employee_ids uuid[];
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS include_contractors boolean;
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS run_label text;
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS disbursement_date date;
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS proof_of_payment_url text;
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS total_gross numeric(14, 2);
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS total_tax numeric(14, 2);
    ALTER TABLE payroll_batches_history ADD COLUMN IF NOT EXISTS total_net numeric(14, 2);
  END IF;
END $$;

-- ── Extend payout_records (PayslipLine snapshot) ─────────────
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES payroll_contractors(id);
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS metrics_snapshot jsonb;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS bonus_breakdown jsonb;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS allowances_total numeric(12, 2) DEFAULT 0;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS gross_pay numeric(12, 2) DEFAULT 0;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS paye_tax numeric(12, 2) DEFAULT 0;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS employer_paye_subsidy numeric(12, 2) DEFAULT 0;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS net_pay numeric(12, 2) DEFAULT 0;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS line_status payroll_payslip_line_status DEFAULT 'OK';
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS override_reason text;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS manual_adjustments jsonb DEFAULT '[]'::jsonb;
ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS pay_role_name text;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payout_records_history') THEN
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS contractor_id uuid;
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS metrics_snapshot jsonb;
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS bonus_breakdown jsonb;
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS allowances_total numeric(12, 2);
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS gross_pay numeric(12, 2);
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS paye_tax numeric(12, 2);
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS employer_paye_subsidy numeric(12, 2);
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS net_pay numeric(12, 2);
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS line_status payroll_payslip_line_status;
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS override_reason text;
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS manual_adjustments jsonb;
    ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS pay_role_name text;
  END IF;
END $$;

-- Allow contractor-only payout lines (no staff)
ALTER TABLE payout_records ALTER COLUMN staff_id DROP NOT NULL;

-- ── History tables + temporal triggers for new tables ─────────
DO $$
DECLARE
  tbl text;
  _constraint RECORD;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'payroll_pay_roles',
    'payroll_product_tier_configs',
    'payroll_tax_band_configs',
    'payroll_contractors'
  ]
  LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_history (LIKE %I INCLUDING ALL)', tbl, tbl);

    FOR _constraint IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name = tbl || '_history'
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', tbl || '_history', _constraint.constraint_name);
    END LOOP;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (id, valid_from, valid_to)',
      tbl || '_history_temporal_idx',
      tbl || '_history'
    );

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_stamp_actor ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_stamp_actor BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()',
      tbl, tbl
    );

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_capture_history ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_capture_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()',
      tbl, tbl
    );

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_history_immutable ON %I_history', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_history_immutable BEFORE UPDATE OR DELETE ON %I_history FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable()',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Audit table registration
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_table_registry') THEN
    INSERT INTO audit_table_registry (table_name) VALUES
      ('payroll_pay_roles'),
      ('payroll_product_tier_configs'),
      ('payroll_tax_band_configs'),
      ('payroll_contractors')
    ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
