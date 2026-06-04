-- Add status column to follow_up_batches for soft-delete (ACTIVE / REVERTED)
ALTER TABLE follow_up_batches
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
