-- ============================================
-- Marketing — Target Groups (reusable audiences)
-- ============================================
-- target_groups        — a named audience. RULE groups auto-materialize members
--                        from a filter; UPLOAD/MANUAL groups are populated directly.
--                        Durable config → full temporal history.
-- target_group_members — materialized membership. High-volume → actor-stamp only.
--                        Identity is customer_phone_hash (no customers table); raw
--                        phone is NEVER stored here (Lead Fortress / Pillar 2).
-- target_group_sync_logs — per-run audit of the materialization cron.
--
-- Company boundary = group_id → branch_groups (NULL = org-wide), mirroring
-- automation_rules / automation_message_templates.

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE target_group_source_kind AS ENUM ('RULE', 'UPLOAD', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE target_group_member_source AS ENUM ('RULE', 'UPLOAD', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── target_groups ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS target_groups (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES branch_groups(id),
  name text NOT NULL,
  description text,
  source_kind target_group_source_kind NOT NULL DEFAULT 'RULE',
  -- RULE groups: the filter that selects members. jsonb so the builder can grow.
  -- Shape: { minOrders?, maxOrders?, statuses?, branchIds?, sinceDays?, orderSource? }
  filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS target_groups_group_idx ON target_groups (group_id);
CREATE INDEX IF NOT EXISTS target_groups_enabled_idx ON target_groups (enabled) WHERE enabled = true;

-- Durable config → full temporal history table.
CREATE TABLE IF NOT EXISTS target_groups_history (
  LIKE target_groups INCLUDING ALL
);

-- ── target_group_members ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS target_group_members (
  id uuid PRIMARY KEY,
  target_group_id uuid NOT NULL REFERENCES target_groups(id),
  -- Customer identity — the phone hash IS the customer (no customers table).
  customer_phone_hash text NOT NULL,
  customer_name text,
  customer_email text,
  -- How this member joined the group.
  source target_group_member_source NOT NULL DEFAULT 'RULE',
  added_at timestamptz NOT NULL DEFAULT now(),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One membership per (group, customer). Enables idempotent sync via ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS target_group_members_group_hash_uidx
  ON target_group_members (target_group_id, customer_phone_hash);
CREATE INDEX IF NOT EXISTS target_group_members_group_idx ON target_group_members (target_group_id);

-- ── target_group_sync_logs ───────────────────────────────────
CREATE TABLE IF NOT EXISTS target_group_sync_logs (
  id uuid PRIMARY KEY,
  triggered_by text NOT NULL,          -- 'cron' | 'manual'
  total_added integer NOT NULL DEFAULT 0,
  group_results jsonb,                 -- per-group breakdown
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Temporal triggers ────────────────────────────────────────
-- target_groups: full stamp + capture-history + immutable-history (durable config).
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_target_groups_stamp_actor ON target_groups;
  CREATE TRIGGER trg_target_groups_stamp_actor
    BEFORE INSERT OR UPDATE ON target_groups
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_target_groups_capture_history ON target_groups;
  CREATE TRIGGER trg_target_groups_capture_history
    BEFORE UPDATE OR DELETE ON target_groups
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_target_groups_history_immutable ON target_groups_history;
  CREATE TRIGGER trg_target_groups_history_immutable
    BEFORE UPDATE OR DELETE ON target_groups_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- members + sync_logs: actor-stamp only (high-volume / low-audit), matching the
-- automation_jobs precedent.
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_target_group_members_stamp_actor ON target_group_members;
  CREATE TRIGGER trg_target_group_members_stamp_actor
    BEFORE INSERT OR UPDATE ON target_group_members
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_target_group_sync_logs_stamp_actor ON target_group_sync_logs;
  CREATE TRIGGER trg_target_group_sync_logs_stamp_actor
    BEFORE INSERT OR UPDATE ON target_group_sync_logs
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();
END $$;

-- ── Audit table registration ─────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_table_registry') THEN
    INSERT INTO audit_table_registry (table_name) VALUES
      ('target_groups')
    ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
