-- ============================================
-- Add missing dispatch_locked column to logistics_locations
-- The Drizzle schema defines this column but the initial
-- migration (0000) never included it, causing query errors.
-- ============================================

ALTER TABLE "logistics_locations"
  ADD COLUMN "dispatch_locked" boolean NOT NULL DEFAULT false;

-- Sync the history table if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'logistics_locations_history'
  ) THEN
    EXECUTE 'ALTER TABLE "logistics_locations_history" ADD COLUMN "dispatch_locked" boolean NOT NULL DEFAULT false';
  END IF;
END;
$$;
