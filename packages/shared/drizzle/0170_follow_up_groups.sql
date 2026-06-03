-- ============================================
-- Follow-Up Groups
-- ============================================
-- Named groups of CS closers that can be assigned follow-up batches.
-- Groups can span multiple branches. Members are CS closers.

CREATE TABLE IF NOT EXISTS follow_up_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follow_up_group_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  uuid NOT NULL REFERENCES follow_up_groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_group_members_group_id ON follow_up_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_group_members_user_id ON follow_up_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_groups_created_by ON follow_up_groups(created_by_id);

-- Add group + assignment mode columns to follow_up_batches
ALTER TABLE follow_up_batches
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES follow_up_groups(id),
  ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'MANUAL';

CREATE INDEX IF NOT EXISTS idx_follow_up_batches_group_id ON follow_up_batches(group_id);

-- Add assigned_cs_id to follow_up_batch_items for manual/auto assignment tracking
ALTER TABLE follow_up_batch_items
  ADD COLUMN IF NOT EXISTS assigned_cs_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_follow_up_batch_items_assigned_cs ON follow_up_batch_items(assigned_cs_id);
