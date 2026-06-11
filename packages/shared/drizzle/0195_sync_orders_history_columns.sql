-- Sync orders_history with columns added to orders since last history sync.
-- The audit trigger copies the full row on UPDATE; missing columns cause
-- "INSERT has more expressions than target columns" errors.

DO $$
DECLARE
  col RECORD;
BEGIN
  -- For each column in orders that doesn't exist in orders_history, add it.
  FOR col IN
    SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
           c.character_maximum_length, c.numeric_precision, c.numeric_scale
    FROM information_schema.columns c
    WHERE c.table_name = 'orders'
      AND c.column_name NOT IN (
        SELECT column_name FROM information_schema.columns WHERE table_name = 'orders_history'
      )
      AND c.table_schema = current_schema()
  LOOP
    EXECUTE format(
      'ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS %I %s',
      col.column_name,
      CASE
        WHEN col.udt_name = 'uuid' THEN 'uuid'
        WHEN col.udt_name = 'text' THEN 'text'
        WHEN col.udt_name = 'bool' THEN 'boolean'
        WHEN col.udt_name = 'int4' THEN 'integer'
        WHEN col.udt_name = 'int8' THEN 'bigint'
        WHEN col.udt_name = 'numeric' THEN format('numeric(%s,%s)', col.numeric_precision, col.numeric_scale)
        WHEN col.udt_name = 'timestamptz' THEN 'timestamptz'
        WHEN col.udt_name = 'timestamp' THEN 'timestamp'
        WHEN col.udt_name = 'jsonb' THEN 'jsonb'
        WHEN col.udt_name = 'json' THEN 'json'
        WHEN col.udt_name = 'date' THEN 'date'
        ELSE col.udt_name -- fallback: use the raw type name (covers enums etc.)
      END
    );
    RAISE NOTICE 'Added missing column % to orders_history', col.column_name;
  END LOOP;
END $$;
