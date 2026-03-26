-- ============================================================
-- Migration 0041: Feature Batch 2 — Schema Changes
--
-- Changes:
--   1. Drop order_transfer_requests table (agent transfer removed)
--   2. Drop order_transfer_request_status enum
--   3. Add BRANCH_ADMIN to user_role enum
--   4. Create branches table
--   5. Create user_branches join table
--   6. Add branch_id to orders table
--   7. Create order_timeline_events table
--   8. Add branch_id to key business tables
--   9. Create message_templates table
--  10. Create outbound_messages table
--  11. Add new enums
-- ============================================================

-- -----------------------------------------------------------
-- 1. Drop order_transfer_requests (agent-initiated transfers removed)
-- -----------------------------------------------------------
DROP TABLE IF EXISTS order_transfer_requests_history;
DROP TABLE IF EXISTS order_transfer_requests;
DROP TYPE IF EXISTS order_transfer_request_status;

-- -----------------------------------------------------------
-- 2. Add BRANCH_ADMIN to user_role enum
-- -----------------------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'BRANCH_ADMIN';

-- -----------------------------------------------------------
-- 3. New enums
-- -----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE branch_status AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_channel AS ENUM ('SMS', 'WHATSAPP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outbound_message_status AS ENUM ('SENT', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE template_status AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_mode AS ENUM ('LOAD_BALANCED', 'PERFORMANCE', 'CLAIM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE timeline_event_type AS ENUM (
    'ORDER_RECEIVED',
    'ORDER_AUTO_ASSIGNED',
    'ORDER_MANUALLY_ASSIGNED',
    'ORDER_REASSIGNED',
    'ORDER_CLAIMED',
    'ORDER_VIEWED',
    'CALL_INITIATED',
    'CALL_COMPLETED',
    'CALL_NO_ANSWER',
    'CALL_FAILED',
    'MANUAL_CALL_LOGGED',
    'SMS_SENT',
    'WHATSAPP_SENT',
    'ORDER_CONFIRMED',
    'ORDER_CANCELLED',
    'ADDRESS_UPDATED',
    'QUANTITY_UPDATED',
    'CALLBACK_SCHEDULED',
    'ORDER_ALLOCATED',
    'ORDER_DISPATCHED',
    'ORDER_IN_TRANSIT',
    'ORDER_DELIVERED',
    'ORDER_PARTIALLY_DELIVERED',
    'ORDER_RETURNED',
    'ORDER_RESTOCKED',
    'ORDER_WRITTEN_OFF',
    'SUPERVISOR_WATCHING',
    'PAYMENT_RECEIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------
-- 4. Create branches table
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,
  status        branch_status NOT NULL DEFAULT 'ACTIVE',
  settings      JSONB,
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to      TIMESTAMPTZ,
  modified_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches_history (
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  status      branch_status NOT NULL,
  settings    JSONB,
  valid_from  TIMESTAMPTZ NOT NULL,
  valid_to    TIMESTAMPTZ,
  modified_by TEXT
);

-- -----------------------------------------------------------
-- 5. Create user_branches join table
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_branches (
  user_id         TEXT NOT NULL REFERENCES users(id),
  branch_id       TEXT NOT NULL REFERENCES branches(id),
  role_in_branch  user_role,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, branch_id)
);

-- -----------------------------------------------------------
-- 6. Add branch_id to orders (nullable for existing data)
-- -----------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS branch_id TEXT;

-- -----------------------------------------------------------
-- 7. Add branch_id to other business tables
-- -----------------------------------------------------------
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
ALTER TABLE campaigns_history ADD COLUMN IF NOT EXISTS branch_id TEXT;

ALTER TABLE marketing_funding ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
ALTER TABLE marketing_funding_history ADD COLUMN IF NOT EXISTS branch_id TEXT;

ALTER TABLE ad_spend_logs ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
ALTER TABLE ad_spend_logs_history ADD COLUMN IF NOT EXISTS branch_id TEXT;

ALTER TABLE inventory_levels ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
ALTER TABLE inventory_levels_history ADD COLUMN IF NOT EXISTS branch_id TEXT;

ALTER TABLE commission_plans ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
ALTER TABLE commission_plans_history ADD COLUMN IF NOT EXISTS branch_id TEXT;

ALTER TABLE payout_records ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
ALTER TABLE payout_records_history ADD COLUMN IF NOT EXISTS branch_id TEXT;

ALTER TABLE logistics_locations ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES branches(id);
ALTER TABLE logistics_locations_history ADD COLUMN IF NOT EXISTS branch_id TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_branch_id TEXT REFERENCES branches(id);
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS primary_branch_id TEXT;

-- -----------------------------------------------------------
-- 8. Create order_timeline_events table (append-only, no history table needed)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_timeline_events (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     TEXT NOT NULL REFERENCES orders(id),
  event_type   timeline_event_type NOT NULL,
  actor_id     TEXT REFERENCES users(id),
  actor_name   TEXT,
  description  TEXT NOT NULL,
  metadata     JSONB,
  branch_id    TEXT REFERENCES branches(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_timeline_events_order_id_created_at
  ON order_timeline_events (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_timeline_events_branch_id
  ON order_timeline_events (branch_id);

-- -----------------------------------------------------------
-- 9. Create message_templates table
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  channel     message_channel NOT NULL,
  body        TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  branch_id   TEXT REFERENCES branches(id),
  status      template_status NOT NULL DEFAULT 'ACTIVE',
  valid_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to    TIMESTAMPTZ,
  modified_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_templates_history (
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  channel     message_channel NOT NULL,
  body        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  branch_id   TEXT,
  status      template_status NOT NULL,
  valid_from  TIMESTAMPTZ NOT NULL,
  valid_to    TIMESTAMPTZ,
  modified_by TEXT
);

-- -----------------------------------------------------------
-- 10. Create outbound_messages table (append-only)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_messages (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       TEXT NOT NULL REFERENCES orders(id),
  agent_id       TEXT NOT NULL REFERENCES users(id),
  channel        message_channel NOT NULL,
  template_id    TEXT REFERENCES message_templates(id),
  rendered_body  TEXT NOT NULL,
  status         outbound_message_status NOT NULL DEFAULT 'SENT',
  error_message  TEXT,
  branch_id      TEXT REFERENCES branches(id),
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_order_id
  ON outbound_messages (order_id, sent_at DESC);

-- -----------------------------------------------------------
-- 11. Seed: create a default branch so existing data has context
-- (Applications should migrate existing data to this branch)
-- -----------------------------------------------------------
INSERT INTO branches (id, name, code, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Main Branch', 'MAIN', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;
