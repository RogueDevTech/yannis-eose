-- ============================================================================
-- BRANCH ATTRIBUTION AUDIT — PRODUCTION (READ ONLY)
-- Nigeria (NGN) orders appearing on the wrong branch, for BOTH:
--   • MB  side -> orders.branch_id           (marketing attribution)
--   • CS  side -> orders.servicing_branch_id (CS routing)
-- Every statement is a SELECT. Nothing is written.
-- ============================================================================


-- ── Q1. THE THREE ORDERS FROM THE SCREENSHOT ───────────────────────────────
-- Full attribution picture. order_number is an INTEGER; the YNS- prefix is
-- display-only, so we match on the numeric part.
SELECT
  'YNS-' || o.order_number       AS order_id,
  o.currency_code,
  o.order_source,
  bm.name                        AS marketing_branch,
  bs.name                        AS servicing_branch,
  mb.name                        AS media_buyer,
  bmb.name                       AS mb_primary_branch,
  cs.name                        AS cs_closer,
  bcs.name                       AS cs_primary_branch,
  c.name                         AS campaign,
  bc.name                        AS campaign_branch,
  o.created_at
FROM orders o
LEFT JOIN branches bm  ON bm.id  = o.branch_id
LEFT JOIN branches bs  ON bs.id  = o.servicing_branch_id
LEFT JOIN users    mb  ON mb.id  = o.media_buyer_id
LEFT JOIN branches bmb ON bmb.id = mb.primary_branch_id
LEFT JOIN users    cs  ON cs.id  = o.assigned_cs_id
LEFT JOIN branches bcs ON bcs.id = cs.primary_branch_id
LEFT JOIN campaigns c  ON c.id   = o.campaign_id
LEFT JOIN branches bc  ON bc.id  = c.branch_id
WHERE o.order_number IN (77169, 74805, 73324);


-- ── Q2. WHICH ROUTING RULE SENT THEM THERE ─────────────────────────────────
-- Shows the catch-all (currency_code IS NULL) rules that match EVERY country.
-- These are the prime suspects for cross-country mis-routing.
SELECT
  r.id                                   AS rule_id,
  ob.name                                AS owner_branch,
  COALESCE(r.currency_code,'(ANY COUNTRY - catch-all)') AS rule_country,
  p.name                                 AS product,
  r.priority,
  r.enabled,
  tb.name                                AS routes_to_branch
FROM cs_order_routing_rules r
LEFT JOIN branches ob ON ob.id = r.owner_branch_id
LEFT JOIN products p  ON p.id  = r.product_id
LEFT JOIN cs_order_routing_rule_targets t ON t.rule_id = r.id
LEFT JOIN branches tb ON tb.id = t.servicing_branch_id
WHERE r.enabled = TRUE
ORDER BY (r.currency_code IS NULL) DESC, ob.name, r.priority DESC;


-- ── Q3. CS SIDE: NGN orders serviced by a branch with no NGN activity ──────
-- A branch's country is inferred from the currencies of orders it services.
-- Flags NGN orders routed into a branch that otherwise handles another country.
WITH branch_currency AS (
  SELECT servicing_branch_id AS branch_id,
         currency_code,
         COUNT(*) AS orders
  FROM orders
  WHERE deleted_at IS NULL AND servicing_branch_id IS NOT NULL
  GROUP BY 1,2
),
branch_main AS (
  SELECT DISTINCT ON (branch_id) branch_id, currency_code AS dominant_currency
  FROM branch_currency ORDER BY branch_id, orders DESC
)
SELECT
  b.name                    AS servicing_branch,
  bm.dominant_currency      AS branch_normally_handles,
  o.currency_code           AS this_order_currency,
  COUNT(*)                  AS orders
FROM orders o
JOIN branch_main bm ON bm.branch_id = o.servicing_branch_id
JOIN branches b     ON b.id = o.servicing_branch_id
WHERE o.deleted_at IS NULL
  AND o.currency_code IS DISTINCT FROM bm.dominant_currency
GROUP BY 1,2,3
ORDER BY 4 DESC;


-- ── Q4. MB SIDE: orders whose marketing branch != the media buyer's branch ─
-- Splits by cause so you can see which is the campaign-precedence rule
-- (orders.service.ts resolveBranchIdForNewOrder) vs. something else.
SELECT
  CASE
    WHEN o.campaign_id IS NULL              THEN 'no campaign - fallback branch used'
    WHEN o.branch_id = c.branch_id          THEN 'campaign branch overrode MB branch'
    WHEN c.branch_id IS NULL                THEN 'campaign has no branch'
    ELSE 'UNEXPLAINED - matches neither campaign nor MB'
  END                          AS cause,
  o.currency_code,
  COUNT(*)                     AS orders
FROM orders o
JOIN users u ON u.id = o.media_buyer_id
LEFT JOIN campaigns c ON c.id = o.campaign_id
WHERE o.deleted_at IS NULL
  AND o.branch_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM user_branches ub
                  WHERE ub.user_id = u.id AND ub.branch_id = o.branch_id)
  AND u.primary_branch_id IS DISTINCT FROM o.branch_id
GROUP BY 1,2
ORDER BY 3 DESC;


-- ── Q5. CS SIDE: closer assigned outside the servicing branch ──────────────
-- The CS equivalent of Q4: order serviced by branch X but the assigned closer
-- is not a member of branch X.
SELECT
  bs.name                AS servicing_branch,
  bcs.name               AS closer_primary_branch,
  o.currency_code,
  COUNT(*)               AS orders
FROM orders o
JOIN users cs      ON cs.id = o.assigned_cs_id
LEFT JOIN branches bs  ON bs.id  = o.servicing_branch_id
LEFT JOIN branches bcs ON bcs.id = cs.primary_branch_id
WHERE o.deleted_at IS NULL
  AND o.servicing_branch_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM user_branches ub
                  WHERE ub.user_id = cs.id AND ub.branch_id = o.servicing_branch_id)
  AND cs.primary_branch_id IS DISTINCT FROM o.servicing_branch_id
GROUP BY 1,2,3
ORDER BY 4 DESC;


-- ── Q6. HEADLINE COUNTS for both sides, NGN only ───────────────────────────
SELECT
  COUNT(*) FILTER (
    WHERE o.media_buyer_id IS NOT NULL AND o.branch_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM user_branches ub
                      WHERE ub.user_id=o.media_buyer_id AND ub.branch_id=o.branch_id)
  )                                            AS mb_side_wrong_branch,
  COUNT(*) FILTER (
    WHERE o.assigned_cs_id IS NOT NULL AND o.servicing_branch_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM user_branches ub
                      WHERE ub.user_id=o.assigned_cs_id AND ub.branch_id=o.servicing_branch_id)
  )                                            AS cs_side_wrong_branch,
  COUNT(*)                                     AS ngn_orders_total
FROM orders o
WHERE o.deleted_at IS NULL
  AND COALESCE(o.currency_code,'NGN') = 'NGN';
