-- Add is_follow_up flag to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_follow_up boolean NOT NULL DEFAULT false;
