-- User filter preferences: per-user per-page saved filter defaults.
-- Cached in Redis; invalidated on every mutation.

CREATE TABLE IF NOT EXISTS user_filter_preferences (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_filter_prefs_user_page_uniq
  ON user_filter_preferences (user_id, page_key);

CREATE INDEX IF NOT EXISTS user_filter_prefs_user_id_idx
  ON user_filter_preferences (user_id);
