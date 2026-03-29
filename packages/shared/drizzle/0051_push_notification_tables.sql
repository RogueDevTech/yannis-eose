-- Push Notification System Tables
-- Migration: 0051_push_notification_tables.sql
-- IDs and user FKs use TEXT to match users.id / uuidv7Pk() (not native uuid).

-- Enums
DO $$ BEGIN
  CREATE TYPE "push_trigger_type" AS ENUM('MIRROR', 'BROADCAST', 'AUTOMATION');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "push_delivery_status" AS ENUM('SENT', 'FAILED', 'SHOWN', 'CLICKED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "push_target_type" AS ENUM('ALL', 'ROLE', 'USER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "push_automation_trigger" AS ENUM('CRON', 'EVENT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- push_subscriptions: one row per browser/device per user
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions" ("user_id");

-- push_broadcasts: admin-triggered broadcast records
CREATE TABLE IF NOT EXISTS "push_broadcasts" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "target_type" "push_target_type" NOT NULL,
  "target_role" text,
  "target_user_id" text REFERENCES "users"("id"),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "branch_id" text REFERENCES "branches"("id"),
  "sent_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "push_broadcasts_created_by_idx" ON "push_broadcasts" ("created_by");
CREATE INDEX IF NOT EXISTS "push_broadcasts_sent_at_idx" ON "push_broadcasts" ("sent_at");

-- push_automation_rules: CRON and EVENT-based automation rules (temporal columns per Drizzle schema)
CREATE TABLE IF NOT EXISTS "push_automation_rules" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "trigger_type" "push_automation_trigger" NOT NULL,
  "cron_expr" text,
  "event_key" text,
  "target_type" "push_target_type" NOT NULL,
  "target_role" text,
  "target_user_id" text REFERENCES "users"("id"),
  "title_template" text NOT NULL,
  "body_template" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "branch_id" text REFERENCES "branches"("id"),
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "last_fired_at" timestamptz,
  "valid_from" timestamptz DEFAULT now() NOT NULL,
  "valid_to" timestamptz,
  "modified_by" text
);

CREATE INDEX IF NOT EXISTS "push_automation_rules_is_active_idx" ON "push_automation_rules" ("is_active");
CREATE INDEX IF NOT EXISTS "push_automation_rules_trigger_type_idx" ON "push_automation_rules" ("trigger_type");

-- push_delivery_log: per-attempt delivery log
CREATE TABLE IF NOT EXISTS "push_delivery_log" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "broadcast_id" text REFERENCES "push_broadcasts"("id") ON DELETE SET NULL,
  "automation_rule_id" text REFERENCES "push_automation_rules"("id") ON DELETE SET NULL,
  "trigger_type" "push_trigger_type" NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "status" "push_delivery_status" NOT NULL DEFAULT 'SENT',
  "failure_reason" text,
  "sent_at" timestamptz DEFAULT now() NOT NULL,
  "shown_at" timestamptz,
  "clicked_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "push_delivery_log_user_id_idx" ON "push_delivery_log" ("user_id");
CREATE INDEX IF NOT EXISTS "push_delivery_log_status_idx" ON "push_delivery_log" ("status");
CREATE INDEX IF NOT EXISTS "push_delivery_log_trigger_type_idx" ON "push_delivery_log" ("trigger_type");
CREATE INDEX IF NOT EXISTS "push_delivery_log_broadcast_id_idx" ON "push_delivery_log" ("broadcast_id");
CREATE INDEX IF NOT EXISTS "push_delivery_log_sent_at_idx" ON "push_delivery_log" ("sent_at");
