-- Phase C — Per-team setting overrides + system enforce flag.
--
-- Background: every team (CS or Marketing) inherits configurable behaviour
-- from `system_settings`. Heads / supervisors may override a value at the team
-- level (e.g. one CS team runs claim mode while the org default is manual).
-- A `system_settings.is_enforced = true` row wins over any team override —
-- giving SuperAdmin / Admin a "lock from the top" lever.
--
-- Resolution order (read by SettingsService.getEffectiveTeamSetting):
--   1. enforced system value (system_settings.value where is_enforced = true)
--   2. team override (branch_team_settings.value)
--   3. system default (system_settings.value where is_enforced = false)
--
-- The table mirrors `system_settings` shape (key/value/jsonb/updatedBy) so the
-- resolver can swap a row in any layer without coercion.

CREATE TABLE IF NOT EXISTS branch_team_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES branch_teams(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT branch_team_settings_team_key_unique UNIQUE (team_id, key)
);

CREATE INDEX IF NOT EXISTS idx_branch_team_settings_team_id
  ON branch_team_settings(team_id);

CREATE INDEX IF NOT EXISTS idx_branch_team_settings_key
  ON branch_team_settings(key);

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS is_enforced boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN system_settings.is_enforced IS
  'When true, this system value overrides any branch_team_settings override for the same key.';

-- Sync system_settings_history (created via LIKE INCLUDING ALL in migration 0027).
-- Without this, the capture_history trigger on system_settings will fail when
-- the new column is set on a write.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'system_settings_history'
  ) THEN
    ALTER TABLE system_settings_history
      ADD COLUMN IF NOT EXISTS is_enforced boolean NOT NULL DEFAULT false;
  END IF;
END $$;
