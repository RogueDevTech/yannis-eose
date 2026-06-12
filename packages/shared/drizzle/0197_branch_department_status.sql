-- Add status + deactivation audit columns to branch_departments.
-- Deactivated departments are hidden from dropdowns and new assignments.
ALTER TABLE branch_departments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE branch_departments ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE branch_departments ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES users(id);
