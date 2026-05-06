-- Product catalog gallery + offer_templates quantity / tier images + backfill from legacy products.offers

-- ---------------------------------------------------------------------------
-- 1. New columns on main tables
-- ---------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS gallery_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE offer_templates ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;
ALTER TABLE offer_templates ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. History tables (temporal mirror)
-- ---------------------------------------------------------------------------

ALTER TABLE products_history ADD COLUMN IF NOT EXISTS gallery_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $hist$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'offer_templates_history'
  ) THEN
    EXECUTE 'ALTER TABLE offer_templates_history ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1';
    EXECUTE $sql$
ALTER TABLE offer_templates_history ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb
$sql$;
  END IF;
END;
$hist$;

-- ---------------------------------------------------------------------------
-- 3. Backfill offer_templates from legacy JSON (one row per tier) when the
--    product has no templates yet. Clear products.offers afterward.
-- ---------------------------------------------------------------------------

WITH super_actor AS (
  SELECT id FROM users WHERE role = 'SUPER_ADMIN'::user_role ORDER BY created_at ASC LIMIT 1
),
fallback_actor AS (
  SELECT id FROM users ORDER BY created_at ASC LIMIT 1
),
actor AS (
  SELECT COALESCE((SELECT id FROM super_actor), (SELECT id FROM fallback_actor)) AS id
)
INSERT INTO offer_templates (
  id,
  product_id,
  name,
  price,
  variants,
  quantity,
  image_urls,
  created_by,
  status,
  valid_from,
  valid_to,
  modified_by,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  p.id,
  COALESCE(NULLIF(trim(elem->>'label'), ''), 'Offer'),
  COALESCE((elem->>'price')::numeric, p.base_sale_price),
  NULL,
  GREATEST(1, COALESCE((elem->>'qty')::integer, 1)),
  COALESCE(elem->'imageUrls', '[]'::jsonb),
  (SELECT id FROM actor),
  'ACTIVE',
  now(),
  NULL,
  NULL,
  now(),
  now()
FROM products p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.offers, '[]'::jsonb)) AS elem
WHERE COALESCE(jsonb_array_length(COALESCE(p.offers, '[]'::jsonb)), 0) > 0
  AND NOT EXISTS (SELECT 1 FROM offer_templates ot WHERE ot.product_id = p.id);

-- Optional: seed product gallery from distinct legacy tier image URLs (before clearing offers)
UPDATE products p
SET gallery_image_urls = COALESCE(
  (
    SELECT jsonb_agg(to_jsonb(t.img))
    FROM (
      SELECT DISTINCT trim(j.txt) AS img
      FROM jsonb_array_elements(COALESCE(p.offers, '[]'::jsonb)) o,
      LATERAL jsonb_array_elements_text(COALESCE(o->'imageUrls', '[]'::jsonb)) AS j(txt)
      WHERE trim(j.txt) ~ '^https?://'
    ) t
  ),
  '[]'::jsonb
)
WHERE COALESCE(jsonb_array_length(COALESCE(p.offers, '[]'::jsonb)), 0) > 0;

-- Recompute list price from active templates where we now have rows
UPDATE products p
SET base_sale_price = sub.min_price
FROM (
  SELECT product_id, MIN(price::numeric) AS min_price
  FROM offer_templates
  WHERE status = 'ACTIVE'
  GROUP BY product_id
) sub
WHERE p.id = sub.product_id
  AND EXISTS (SELECT 1 FROM offer_templates ot WHERE ot.product_id = p.id);

UPDATE products
SET offers = '[]'::jsonb
WHERE COALESCE(jsonb_array_length(COALESCE(offers, '[]'::jsonb)), 0) > 0;
