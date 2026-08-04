-- ============================================
-- Marketing Automation — foundation (Phase 1 thin slice)
-- ============================================
-- Three tables:
--   automation_rules       — CEO-configured rules (event journeys + segment broadcasts).
--                            Durable config → full temporal history.
--   automation_jobs        — one scheduled send per customer (the "wait 2h" queue).
--                            High-volume + ephemeral → actor-stamp only, no history table.
--   message_suppressions   — per-channel opt-out list, checked before every send.
--                            Actor-stamp only, no history table.
--
-- Identity note: there is no customers table. A customer is a customer_phone_hash.
-- Jobs + suppressions key on customer_phone_hash (email suppressions may also key on email).

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE automation_rule_kind AS ENUM ('EVENT', 'SEGMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE automation_channel AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE automation_job_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_suppression_channel AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'ALL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_suppression_reason AS ENUM ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Automation rules ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY,
  -- Company boundary. NULL = org-wide (SuperAdmin). Mirrors payroll/GL group scoping.
  group_id uuid REFERENCES branch_groups(id),
  name text NOT NULL,
  -- EVENT = per-customer reactive journey; SEGMENT = audience broadcast.
  kind automation_rule_kind NOT NULL,
  channel automation_channel NOT NULL,
  -- FK to the reused message_templates table (rendered content lives there).
  template_id uuid REFERENCES message_templates(id),
  -- Trigger definition. For EVENT: the event type + params (e.g. {"event":"ORDER_PLACED"}).
  -- For SEGMENT: the audience/segment definition. Kept as jsonb so the rule builder
  -- can evolve without a migration per new trigger type.
  trigger jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Optional additional AND/OR condition tree from the rule builder.
  conditions jsonb,
  -- EVENT rules: delay before send, in minutes (e.g. 120 = "2 hours later"). NULL = immediate.
  delay_minutes integer,
  -- SEGMENT rules: cron expression for the recurring broadcast. NULL = manual-only.
  schedule_cron text,
  -- Whether this rule honors the suppression/opt-out list. CEO can override per rule.
  respect_opt_out boolean NOT NULL DEFAULT true,
  -- Higher = evaluated first (mirrors follow_up_rules.priority).
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  -- Branch scope filter for the trigger/segment. NULL = all branches in the company.
  source_branch_id uuid REFERENCES branches(id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_rules_group_idx ON automation_rules (group_id);
CREATE INDEX IF NOT EXISTS automation_rules_enabled_idx ON automation_rules (enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS automation_rules_kind_idx ON automation_rules (kind);

-- Durable config → full temporal history table.
CREATE TABLE IF NOT EXISTS automation_rules_history (
  LIKE automation_rules INCLUDING ALL
);

-- ── Automation jobs (delayed-send queue) ─────────────────────
CREATE TABLE IF NOT EXISTS automation_jobs (
  id uuid PRIMARY KEY,
  rule_id uuid NOT NULL REFERENCES automation_rules(id),
  -- Customer identity (no customers table — the hash IS the customer).
  customer_phone_hash text NOT NULL,
  -- The order that triggered this job (for placeholder rendering + eligibility re-check).
  order_id uuid,
  channel automation_channel NOT NULL,
  -- When the send becomes due. The poller cron drains rows where scheduled_at <= now().
  scheduled_at timestamptz NOT NULL,
  status automation_job_status NOT NULL DEFAULT 'PENDING',
  -- Populated once processed.
  sent_at timestamptz,
  outbound_message_id uuid REFERENCES outbound_messages(id),
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Poller lookup: due + pending.
CREATE INDEX IF NOT EXISTS automation_jobs_due_idx
  ON automation_jobs (scheduled_at)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS automation_jobs_rule_idx ON automation_jobs (rule_id);
-- Anti-double-fire: one PENDING job per (rule, customer, order). Partial so re-fires
-- are allowed after the prior one resolves (SENT/FAILED/…).
CREATE UNIQUE INDEX IF NOT EXISTS automation_jobs_dedup_idx
  ON automation_jobs (rule_id, customer_phone_hash, order_id)
  WHERE status = 'PENDING';

-- ── Message suppressions (opt-out list) ──────────────────────
CREATE TABLE IF NOT EXISTS message_suppressions (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES branch_groups(id),
  -- Suppress by phone hash (SMS/WhatsApp) and/or email (email channel).
  customer_phone_hash text,
  customer_email text,
  channel message_suppression_channel NOT NULL DEFAULT 'ALL',
  reason message_suppression_reason NOT NULL DEFAULT 'UNSUBSCRIBED',
  note text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- At least one identifier must be present.
  CONSTRAINT message_suppressions_identity_chk
    CHECK (customer_phone_hash IS NOT NULL OR customer_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS message_suppressions_phone_idx ON message_suppressions (customer_phone_hash);
CREATE INDEX IF NOT EXISTS message_suppressions_email_idx ON message_suppressions (customer_email);

-- ── Temporal triggers ────────────────────────────────────────
-- automation_rules: full stamp + capture-history + immutable-history (durable config).
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_automation_rules_stamp_actor ON automation_rules;
  CREATE TRIGGER trg_automation_rules_stamp_actor
    BEFORE INSERT OR UPDATE ON automation_rules
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_automation_rules_capture_history ON automation_rules;
  CREATE TRIGGER trg_automation_rules_capture_history
    BEFORE UPDATE OR DELETE ON automation_rules
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_automation_rules_history_immutable ON automation_rules_history;
  CREATE TRIGGER trg_automation_rules_history_immutable
    BEFORE UPDATE OR DELETE ON automation_rules_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- automation_jobs + message_suppressions: actor-stamp only (no history table),
-- matching the follow_up_rules precedent for high-volume / low-audit config.
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_automation_jobs_stamp_actor ON automation_jobs;
  CREATE TRIGGER trg_automation_jobs_stamp_actor
    BEFORE INSERT OR UPDATE ON automation_jobs
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_message_suppressions_stamp_actor ON message_suppressions;
  CREATE TRIGGER trg_message_suppressions_stamp_actor
    BEFORE INSERT OR UPDATE ON message_suppressions
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();
END $$;

-- ── Audit table registration ─────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_table_registry') THEN
    INSERT INTO audit_table_registry (table_name) VALUES
      ('automation_rules')
    ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
