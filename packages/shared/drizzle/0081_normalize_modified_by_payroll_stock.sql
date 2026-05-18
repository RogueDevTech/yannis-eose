-- Normalize `modified_by` to uuid on payroll_batches and stock_reconciliations (+ history).
-- Migrations 0067 and 0072 declared `modified_by` as TEXT while `yannis_stamp_actor()` (0066)
-- assigns uuid — breaking audit.globalLog UNION and actor filters.
-- Idempotent: no-op if columns are already uuid (e.g. orphan migration applied manually).

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_batches'
      AND column_name = 'modified_by' AND udt_name = 'text'
  ) THEN
    ALTER TABLE payroll_batches
      ALTER COLUMN modified_by TYPE uuid USING (modified_by::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_batches_history'
      AND column_name = 'modified_by' AND udt_name = 'text'
  ) THEN
    ALTER TABLE payroll_batches_history
      ALTER COLUMN modified_by TYPE uuid USING (modified_by::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stock_reconciliations'
      AND column_name = 'modified_by' AND udt_name = 'text'
  ) THEN
    ALTER TABLE stock_reconciliations
      ALTER COLUMN modified_by TYPE uuid USING (modified_by::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stock_reconciliations_history'
      AND column_name = 'modified_by' AND udt_name = 'text'
  ) THEN
    ALTER TABLE stock_reconciliations_history
      ALTER COLUMN modified_by TYPE uuid USING (modified_by::uuid);
  END IF;
END $$;
