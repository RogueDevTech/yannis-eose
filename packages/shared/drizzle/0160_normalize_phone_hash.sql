-- 0160: Rehash customer_phone_hash using the canonical format:
--   sha256('yannis:phone:' || normalized_digits)
-- Nigerian local format (0XXXXXXXXXX, 11 digits) → international (234XXXXXXXXXX).
-- This aligns the API's hashPhone() with the edge-worker's hashPhone() so that
-- the 7-day dedup findExistingOrderForDedup correctly matches orders regardless
-- of whether the phone was entered as 08012345678 or +2348012345678.
--
-- Only rehashes rows where customer_phone is NOT NULL (raw phone is stored).
-- Uses pgcrypto's digest() for SHA-256.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Orders table
UPDATE orders
SET customer_phone_hash = encode(
  digest(
    'yannis:phone:' || CASE
      WHEN length(regexp_replace(customer_phone, '\D', '', 'g')) = 11
        AND regexp_replace(customer_phone, '\D', '', 'g') LIKE '0%'
      THEN '234' || substring(regexp_replace(customer_phone, '\D', '', 'g') FROM 2)
      ELSE regexp_replace(customer_phone, '\D', '', 'g')
    END,
    'sha256'
  ),
  'hex'
)
WHERE customer_phone IS NOT NULL
  AND customer_phone != '';

-- Cart abandonments table
UPDATE cart_abandonments
SET customer_phone_hash = encode(
  digest(
    'yannis:phone:' || CASE
      WHEN length(regexp_replace(customer_phone, '\D', '', 'g')) = 11
        AND regexp_replace(customer_phone, '\D', '', 'g') LIKE '0%'
      THEN '234' || substring(regexp_replace(customer_phone, '\D', '', 'g') FROM 2)
      ELSE regexp_replace(customer_phone, '\D', '', 'g')
    END,
    'sha256'
  ),
  'hex'
)
WHERE customer_phone IS NOT NULL
  AND customer_phone != '';

-- Cross-funnel attempts table
UPDATE cross_funnel_attempts
SET customer_phone_hash = encode(
  digest(
    'yannis:phone:' || CASE
      WHEN length(regexp_replace(customer_phone, '\D', '', 'g')) = 11
        AND regexp_replace(customer_phone, '\D', '', 'g') LIKE '0%'
      THEN '234' || substring(regexp_replace(customer_phone, '\D', '', 'g') FROM 2)
      ELSE regexp_replace(customer_phone, '\D', '', 'g')
    END,
    'sha256'
  ),
  'hex'
)
WHERE customer_phone IS NOT NULL
  AND customer_phone != '';
