-- ============================================
-- Marketing Automation — message templates (own table)
-- ============================================
-- automation_message_templates — the message content an automation rule sends.
-- Deliberately SEPARATE from the CS `message_templates` table (SMS/WhatsApp only,
-- no subject) so email automations are first-class: this table has its own channel
-- enum (incl. EMAIL) and a `subject` column for email. Durable config → full
-- temporal history, mirroring automation_rules.
--
-- A rule's `automation_rules.template_id` FK will point here once the picker ships;
-- the engine renders `body` (with {{placeholder}} substitution) and, for email,
-- uses `subject` (falling back to the rule name when null).

-- ── Enum ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE automation_message_channel AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE automation_message_template_status AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_message_templates (
  id uuid PRIMARY KEY,
  -- Company boundary. NULL = org-wide. Mirrors automation_rules.group_id.
  group_id uuid REFERENCES branch_groups(id),
  name text NOT NULL,
  channel automation_message_channel NOT NULL,
  -- Email subject line. NULL for SMS/WhatsApp (they have no subject); email falls
  -- back to the rule name when this is null.
  subject text,
  -- Message body with {{placeholder}} syntax (same convention as CS templates).
  body text NOT NULL,
  status automation_message_template_status NOT NULL DEFAULT 'ACTIVE',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_message_templates_group_idx
  ON automation_message_templates (group_id);
CREATE INDEX IF NOT EXISTS automation_message_templates_channel_idx
  ON automation_message_templates (channel);
CREATE INDEX IF NOT EXISTS automation_message_templates_active_idx
  ON automation_message_templates (status) WHERE status = 'ACTIVE';

-- Durable config → full temporal history table.
CREATE TABLE IF NOT EXISTS automation_message_templates_history (
  LIKE automation_message_templates INCLUDING ALL
);

-- ── Temporal triggers (full stamp + capture-history + immutable-history) ──
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_automation_message_templates_stamp_actor ON automation_message_templates;
  CREATE TRIGGER trg_automation_message_templates_stamp_actor
    BEFORE INSERT OR UPDATE ON automation_message_templates
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_automation_message_templates_capture_history ON automation_message_templates;
  CREATE TRIGGER trg_automation_message_templates_capture_history
    BEFORE UPDATE OR DELETE ON automation_message_templates
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_automation_message_templates_history_immutable ON automation_message_templates_history;
  CREATE TRIGGER trg_automation_message_templates_history_immutable
    BEFORE UPDATE OR DELETE ON automation_message_templates_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- ── Audit table registration ─────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_table_registry') THEN
    INSERT INTO audit_table_registry (table_name) VALUES
      ('automation_message_templates')
    ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
