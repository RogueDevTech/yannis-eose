-- Add last_action_at to users for CS dispatch tiebreaker and inactivity tracking
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_action_at" timestamp with time zone;
