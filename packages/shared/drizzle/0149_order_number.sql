-- 0149: Add sequential order_number for human-friendly order references.
-- Displayed as YNS-XXXXX (e.g. YNS-10042). The prefix is cosmetic (app-side).
-- Backfills existing orders by created_at order so numbering is chronological.

-- 1. Create sequence
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 10000;

-- 2. Add column to BOTH tables BEFORE any UPDATE (temporal trigger copies to history)
ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS order_number integer;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_number integer;

-- 3. Backfill existing rows that don't have a number yet (idempotent on re-run)
WITH numbered AS (
  SELECT id, nextval('order_number_seq') AS num
  FROM orders
  WHERE order_number IS NULL
  ORDER BY created_at ASC
)
UPDATE orders SET order_number = numbered.num
FROM numbered WHERE orders.id = numbered.id;

-- 4. Set NOT NULL + default for new rows + unique constraint
ALTER TABLE orders
  ALTER COLUMN order_number SET DEFAULT nextval('order_number_seq'),
  ALTER COLUMN order_number SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_order_number_unique UNIQUE (order_number);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
