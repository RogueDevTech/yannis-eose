-- Backfill all NULL group_id references to the first (default) active branch group.
-- This ensures complete data isolation between company groups — no orphaned records.
-- CEO directive: all pre-existing data belongs to the default company group.

DO $$
DECLARE
  default_gid UUID;
BEGIN
  -- Pick the oldest active branch group as the default
  SELECT id INTO default_gid
  FROM branch_groups
  WHERE status = 'ACTIVE'
  ORDER BY created_at ASC
  LIMIT 1;

  IF default_gid IS NULL THEN
    RAISE NOTICE 'No active branch group found — skipping backfill';
    RETURN;
  END IF;

  -- Branches without a group
  UPDATE branches SET group_id = default_gid WHERE group_id IS NULL;

  -- Logistics providers without a group
  UPDATE logistics_providers SET group_id = default_gid WHERE group_id IS NULL;

  -- Products without a group
  UPDATE products SET group_id = default_gid WHERE group_id IS NULL;

  -- Product categories without a group (if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_categories' AND column_name = 'group_id'
  ) THEN
    EXECUTE format('UPDATE product_categories SET group_id = %L WHERE group_id IS NULL', default_gid);
  END IF;

  RAISE NOTICE 'Backfilled NULL group_id records to default group %', default_gid;
END $$;
