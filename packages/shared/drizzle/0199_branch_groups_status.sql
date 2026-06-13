-- Add status column to branch_groups (ACTIVE / INACTIVE).
-- Defaults to ACTIVE so existing groups are unaffected.
ALTER TABLE branch_groups ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
