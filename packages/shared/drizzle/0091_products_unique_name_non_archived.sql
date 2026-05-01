-- 0091: Prevent duplicate non-archived products by normalized name.
-- Keep one canonical row per name and archive the rest.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(name))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM products
  WHERE status IN ('ACTIVE', 'INACTIVE')
)
UPDATE products p
SET
  status = 'ARCHIVED',
  updated_at = now()
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name_non_archived
ON products ((lower(trim(name))))
WHERE status IN ('ACTIVE', 'INACTIVE');
