-- 0092: Delete archived duplicate products when they are not referenced.
-- Keeps one canonical row per normalized name and safely removes extra archived rows
-- only when no foreign-key reference exists from any table.

CREATE TEMP TABLE _products_delete_candidates (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO _products_delete_candidates (id)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(name))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM products
  WHERE status = 'ARCHIVED'
)
SELECT id
FROM ranked
WHERE rn > 1;

DO $$
DECLARE
  ref RECORD;
BEGIN
  FOR ref IN
    SELECT
      con.conrelid::regclass::text AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND con.confrelid = 'products'::regclass
  LOOP
    EXECUTE format(
      'DELETE FROM _products_delete_candidates c
       WHERE EXISTS (
         SELECT 1
         FROM %s t
         WHERE t.%I = c.id
       )',
      ref.table_name,
      ref.column_name
    );
  END LOOP;
END $$;

DELETE FROM products p
USING _products_delete_candidates c
WHERE p.id = c.id;
