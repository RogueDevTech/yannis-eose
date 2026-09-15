-- Invalid / irregular customer phone audit (READ-ONLY)
-- Context: edge form accepts malformed phones because the client-side `pattern`
-- attribute is never enforced (submit handler calls e.preventDefault() and only
-- checks emptiness), and the worker gate only requires 7-15 digits.
-- A valid NG number is 11 digits local (0XXXXXXXXXX) or 13 with country code (234XXXXXXXXXX).

-- ── 1. Scale of the problem, by month ────────────────────────────────────────
SELECT
  date_trunc('month', o.created_at)::date            AS month,
  count(*)                                           AS total_orders,
  count(*) FILTER (WHERE length(regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g')) NOT IN (11, 13)) AS bad_phone_orders,
  round(100.0 * count(*) FILTER (WHERE length(regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g')) NOT IN (11, 13)) / nullif(count(*), 0), 2) AS pct_bad
FROM orders o
WHERE o.created_at >= now() - interval '6 months'
  AND o.status <> 'DELETED'
GROUP BY 1
ORDER BY 1 DESC;

-- ── 2. Breakdown by exact digit length (what shapes are getting through) ─────
SELECT
  length(regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g')) AS digit_count,
  count(*)                                                             AS orders,
  min(o.created_at)::date                                              AS first_seen,
  max(o.created_at)::date                                              AS last_seen
FROM orders o
WHERE o.created_at >= now() - interval '6 months'
  AND o.status <> 'DELETED'
GROUP BY 1
ORDER BY 1;

-- ── 3. The actual bad rows, newest first (for CS follow-up) ──────────────────
-- NOTE: exposes raw customer_phone. Run as an authorized DBA only; do not paste
-- output into shared channels (Pillar 2).
SELECT
  o.order_number,
  o.created_at,
  o.customer_name,
  o.customer_phone,
  length(regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g')) AS digit_count,
  o.status,
  o.order_source,
  o.delivery_state,
  o.total_amount
FROM orders o
WHERE o.created_at >= now() - interval '3 months'
  AND o.status <> 'DELETED'
  AND length(regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g')) NOT IN (11, 13)
ORDER BY o.created_at DESC
LIMIT 300;

-- ── 4. Same check on the cart pipeline (cart_abandonments feed the same form) ─
SELECT
  length(regexp_replace(coalesce(ca.customer_phone,''), '\D', '', 'g')) AS digit_count,
  count(*) AS carts
FROM cart_abandonments ca
WHERE ca.created_at >= now() - interval '3 months'
GROUP BY 1
ORDER BY 1;

-- ── 5. How many customers type 234... WITHOUT a leading '+'? ─────────────────
-- These are VALID Nigerian numbers that the strict client pattern would now
-- reject (pattern requires a literal '+' before 234). If this count is material,
-- relax the pattern to '\+?234...' rather than making customers retype.
SELECT
  count(*) FILTER (WHERE o.customer_phone ~ '^234[789][0-9]{9}$')   AS bare_234_no_plus,
  count(*) FILTER (WHERE o.customer_phone ~ '^\+234[789][0-9]{9}$') AS plus_234,
  count(*) FILTER (WHERE o.customer_phone ~ '^0[789][0-9]{9}$')     AS local_0,
  count(*)                                                          AS total
FROM orders o
WHERE o.created_at >= now() - interval '3 months'
  AND o.status <> 'DELETED';

-- ── 6. Ghana pattern narrowed 0[2-9] -> 0[25]: any existing GH rows affected? ─
-- Run before deploying the narrowed Ghana rule. Expect 0 rows; a non-zero count
-- means a real GH prefix outside 2/5 is in use and the pattern needs widening.
SELECT
  o.customer_phone,
  count(*) AS orders
FROM orders o
WHERE o.created_at >= now() - interval '12 months'
  AND o.status <> 'DELETED'
  AND regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') ~ '^233'
  AND regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') !~ '^233[25]'
GROUP BY 1
ORDER BY 2 DESC;
