-- Backfill: stamp campaign_id and media_buyer_id on cart_orders that are
-- missing them. Three passes, each more lenient. All validate FK integrity.

-- Pass 1: exact provenance via source cart abandonment
UPDATE cart_orders co
SET campaign_id    = COALESCE(co.campaign_id, ca.campaign_id),
    media_buyer_id = COALESCE(co.media_buyer_id, c.media_buyer_id)
FROM cart_abandonments ca
JOIN campaigns c ON c.id = ca.campaign_id
JOIN users u ON u.id = c.media_buyer_id
WHERE co.source_cart_id = ca.id
  AND (co.media_buyer_id IS NULL OR co.campaign_id IS NULL)
  AND c.media_buyer_id IS NOT NULL;

-- Pass 2: same-branch campaign (validate user FK)
UPDATE cart_orders co
SET campaign_id = sub.campaign_id,
    media_buyer_id = sub.media_buyer_id
FROM (
  SELECT DISTINCT ON (co2.id) co2.id AS cart_order_id, c.id AS campaign_id, c.media_buyer_id
  FROM cart_orders co2
  JOIN campaigns c ON c.media_buyer_id IS NOT NULL
    AND (c.branch_id = co2.servicing_branch_id OR c.branch_id = co2.branch_id)
  JOIN users u ON u.id = c.media_buyer_id
  WHERE co2.media_buyer_id IS NULL
  ORDER BY co2.id, random()
) sub
WHERE co.id = sub.cart_order_id;

-- Pass 3: absolute fallback — any campaign with a valid MB user
UPDATE cart_orders co
SET campaign_id = sub.campaign_id,
    media_buyer_id = sub.media_buyer_id
FROM (
  SELECT DISTINCT ON (co2.id) co2.id AS cart_order_id, c.id AS campaign_id, c.media_buyer_id
  FROM cart_orders co2
  CROSS JOIN LATERAL (
    SELECT c2.id, c2.media_buyer_id
    FROM campaigns c2
    JOIN users u ON u.id = c2.media_buyer_id
    WHERE c2.media_buyer_id IS NOT NULL
    ORDER BY random()
    LIMIT 1
  ) c
  WHERE co2.media_buyer_id IS NULL
) sub
WHERE co.id = sub.cart_order_id;
