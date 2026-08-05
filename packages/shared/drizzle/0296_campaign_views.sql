-- Migration 0296: Form Analytics — campaign_views telemetry + attribution keys.
--
-- Adds form-landing tracking for the Marketing "Analytics" page. A row is written
-- per public-form load by the edge worker's fire-and-forget /track-view beacon;
-- a later leave-beacon fills dwell_ms. Orders and started-carts carry an optional
-- session_id so a delivered order can be matched back to the view that produced it.
--
-- HISTORY-TRIGGER SAFETY (yannis_capture_history does `INSERT INTO <t>_history
-- SELECT ($1).*` — a positional copy, so any column added to a system-versioned
-- table MUST also be added to its _history twin or every UPDATE/DELETE fails):
--   * orders             IS system-versioned -> sync orders_history.
--   * cart_abandonments   IS system-versioned (migration 0027) -> sync
--                          cart_abandonments_history.
--   * campaign_views      is NON-temporal telemetry: it is deliberately NOT
--                          added to the history-capture trigger loop, has no
--                          _history twin, and carries no valid_from/valid_to/
--                          modified_by. This is an intentional, documented
--                          exception to the "alter a table -> sync _history" rule,
--                          which governs auditable business tables, not new
--                          high-cardinality telemetry.

-- 1. campaign_views telemetry table (non-temporal, no history triggers).
CREATE TABLE IF NOT EXISTS campaign_views (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  media_buyer_id uuid REFERENCES users(id),
  branch_id uuid REFERENCES branches(id),
  session_id text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  dwell_ms integer,
  -- Raw worker formMode string ('hosted'|'iframe'|'embedded'|'fallback'), NOT the
  -- deployment_type enum (different casing + a 'fallback' value the enum lacks).
  deployment_type text,
  referrer text,
  user_agent text,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_views_campaign_idx ON campaign_views (campaign_id);
CREATE INDEX IF NOT EXISTS campaign_views_viewed_at_idx ON campaign_views (viewed_at);
CREATE INDEX IF NOT EXISTS campaign_views_session_idx ON campaign_views (session_id);
CREATE INDEX IF NOT EXISTS campaign_views_branch_idx ON campaign_views (branch_id);
CREATE INDEX IF NOT EXISTS campaign_views_mb_idx ON campaign_views (media_buyer_id);
CREATE INDEX IF NOT EXISTS campaign_views_campaign_viewed_idx ON campaign_views (campaign_id, viewed_at);

-- 2. orders.session_id (attribution key) + history sync.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS session_id text;
CREATE INDEX IF NOT EXISTS orders_session_id_idx ON orders (session_id);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders_history'
  ) THEN
    ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS session_id text;
  END IF;
END $$;

-- 3. cart_abandonments.session_id (attribution key) + history sync.
ALTER TABLE cart_abandonments ADD COLUMN IF NOT EXISTS session_id text;
CREATE INDEX IF NOT EXISTS cart_abandonments_session_id_idx ON cart_abandonments (session_id);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cart_abandonments_history'
  ) THEN
    ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS session_id text;
  END IF;
END $$;
