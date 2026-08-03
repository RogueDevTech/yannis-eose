-- ============================================================================
-- JULY 2026 PERFORMANCE-BONUS DIAGNOSTIC  (READ-ONLY — no writes, no locks)
-- ----------------------------------------------------------------------------
-- Purpose: explain why Media Buyers show ₦0 performance bonus for July 2026.
--
-- The bonus GATE (which tier fires, and the minimumFloor) is keyed on
-- INDIVIDUAL_DR, which the app computes as a *cohort* rate:
--     individualDr = deliveredCohort / totalOrders * 100
--   where
--     totalOrders     = orders CREATED in the period (status <> DELETED)
--     deliveredCohort = orders CREATED in the period AND delivered in the period
--
-- This query reproduces that number per staff member, alongside the delivered
-- count the bonus actually PAYS on, and the configured threshold/floor pulled
-- from the resolved formula JSON — so you can see whether ₦0 is legitimate
-- (cohort DR below the configured threshold, i.e. carry-over working as intended)
-- or a misconfiguration (threshold/floor set so nothing ever qualifies).
--
-- HOW TO RUN (against PRODUCTION, europe-west2 Cloud SQL):
--   psql "$PROD_DATABASE_URL" -v branch_name="'Lagos Branch'" \
--        -v period_start="'2026-07-01'" -v period_end="'2026-07-31'" \
--        -f july_bonus_diagnostic.sql
--
-- If your psql can't pass -v, just replace the three :vars below inline.
-- ============================================================================

\set ON_ERROR_STOP on

-- Nigeria calendar window (WAT, UTC+1) — matches nigeriaDayStart/End in the app.
WITH params AS (
  SELECT
    (:period_start || 'T00:00:00+01:00')::timestamptz AS p_start,
    (:period_end   || 'T23:59:59.999+01:00')::timestamptz AS p_end,
    :branch_name AS branch_name
),
-- Marketing staff in scope (mirrors DEPARTMENT_ROLES.MARKETING).
staff AS (
  SELECT u.id, u.name, u.role, u.pay_role_id, u.commission_plan_id,
         u.salary_basis, u.onboarding_payroll_status, u.primary_branch_id
  FROM users u
  JOIN branches b ON b.id = u.primary_branch_id
  , params
  WHERE u.role IN ('MEDIA_BUYER', 'HEAD_OF_MARKETING')
    AND u.status = 'ACTIVE'
    AND b.name = params.branch_name
),
-- Resolve each staff member's active formula plan the way the app does:
--   1) plan linked on the pay role, else
--   2) latest open plan for the pay role, else
--   3) personal commission_plan_id / role-default open plan.
resolved_plan AS (
  SELECT s.id AS staff_id,
         COALESCE(pr_plan.id, byrole_plan.id, personal_plan.id) AS plan_id,
         COALESCE(pr_plan.plan_name, byrole_plan.plan_name, personal_plan.plan_name) AS plan_name,
         COALESCE(pr_plan.rules, byrole_plan.rules, personal_plan.rules) AS rules
  FROM staff s
  LEFT JOIN payroll_pay_roles pr ON pr.id = s.pay_role_id
  LEFT JOIN commission_plans pr_plan ON pr_plan.id = pr.commission_plan_id
  LEFT JOIN LATERAL (
    SELECT cp.* FROM commission_plans cp
    WHERE cp.pay_role_id = s.pay_role_id AND cp.effective_to IS NULL
    ORDER BY cp.effective_from DESC LIMIT 1
  ) byrole_plan ON s.pay_role_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT cp.* FROM commission_plans cp
    WHERE (cp.id = s.commission_plan_id OR (s.commission_plan_id IS NULL AND cp.role = s.role))
      AND cp.effective_to IS NULL
    ORDER BY cp.effective_from DESC LIMIT 1
  ) personal_plan ON s.pay_role_id IS NULL
),
-- Order metrics per staff, scoped to the July window (attribution = CS or MB).
metrics AS (
  SELECT s.id AS staff_id,
    -- totalOrders: created in period, not DELETED
    COUNT(*) FILTER (
      WHERE o.status <> 'DELETED'
        AND o.created_at >= p.p_start AND o.created_at <= p.p_end
    ) AS total_orders,
    -- deliveredCohort: created in period AND delivered (DELIVERED/REMITTED) in period
    COUNT(*) FILTER (
      WHERE o.status IN ('DELIVERED','REMITTED')
        AND o.created_at >= p.p_start AND o.created_at <= p.p_end
    ) AS delivered_cohort,
    -- deliveredCount: delivered in period by delivered_at (regardless of creation) — what bonus PAYS on
    COUNT(*) FILTER (
      WHERE o.status IN ('DELIVERED','REMITTED')
        AND o.delivered_at >= p.p_start AND o.delivered_at <= p.p_end
    ) AS delivered_count,
    -- carry-over slice: delivered in period but created BEFORE period
    COUNT(*) FILTER (
      WHERE o.status IN ('DELIVERED','REMITTED')
        AND o.delivered_at >= p.p_start AND o.delivered_at <= p.p_end
        AND o.created_at < p.p_start
    ) AS delivered_carryover
  FROM staff s
  CROSS JOIN params p
  LEFT JOIN orders o
    ON (o.assigned_cs_id = s.id OR o.media_buyer_id = s.id)
  GROUP BY s.id
)
SELECT
  s.name AS staff,
  s.role,
  CASE WHEN s.pay_role_id IS NOT NULL THEN 'pay-role' ELSE 'personal/legacy' END AS plan_via,
  rp.plan_name,
  (rp.plan_id IS NOT NULL) AS has_plan,
  m.total_orders,
  m.delivered_cohort,
  m.delivered_count,
  m.delivered_carryover,
  -- The exact number the bonus GATE evaluates:
  ROUND(
    CASE WHEN m.total_orders > 0
         THEN (m.delivered_cohort::numeric / m.total_orders) * 100
         ELSE 0 END, 1
  ) AS cohort_dr_pct,
  -- Pull the first bonus tier threshold + the minimumFloor threshold from the
  -- formula JSON so you can compare cohort_dr_pct against what's required.
  (rp.rules -> 'bonusTiers' -> 0 ->> 'metric')    AS tier0_metric,
  (rp.rules -> 'bonusTiers' -> 0 ->> 'operator')  AS tier0_op,
  (rp.rules -> 'bonusTiers' -> 0 ->> 'threshold') AS tier0_threshold,
  (rp.rules -> 'bonusTiers' -> 0 ->> 'kind')      AS tier0_kind,
  (rp.rules -> 'bonusTiers' -> 0 ->> 'amount')    AS tier0_amount,
  (rp.rules -> 'minimumFloor' ->> 'metric')       AS floor_metric,
  (rp.rules -> 'minimumFloor' ->> 'operator')     AS floor_op,
  (rp.rules -> 'minimumFloor' ->> 'threshold')    AS floor_threshold,
  (rp.rules -> 'minimumFloor' ->> 'fallbackBonus') AS floor_fallback,
  jsonb_array_length(COALESCE(rp.rules -> 'bonusTiers', '[]'::jsonb)) AS n_bonus_tiers,
  -- Quick verdict heuristic (INDIVIDUAL_DR floor case): would the floor fire?
  CASE
    WHEN rp.plan_id IS NULL THEN 'NO PLAN → bonus 0 (config gap)'
    WHEN jsonb_array_length(COALESCE(rp.rules -> 'bonusTiers', '[]'::jsonb)) = 0
      THEN 'NO BONUS TIERS → bonus 0 (config gap)'
    WHEN (rp.rules -> 'minimumFloor' ->> 'metric') = 'INDIVIDUAL_DR'
         AND (rp.rules -> 'minimumFloor' ->> 'operator') = 'LT'
         AND (CASE WHEN m.total_orders > 0
                   THEN (m.delivered_cohort::numeric / m.total_orders) * 100 ELSE 0 END)
             < (rp.rules -> 'minimumFloor' ->> 'threshold')::numeric
      THEN 'FLOOR FIRES → bonus = fallback (likely 0). Cohort DR below floor.'
    WHEN (rp.rules -> 'bonusTiers' -> 0 ->> 'metric') = 'INDIVIDUAL_DR'
         AND (CASE WHEN m.total_orders > 0
                   THEN (m.delivered_cohort::numeric / m.total_orders) * 100 ELSE 0 END)
             < (rp.rules -> 'bonusTiers' -> 0 ->> 'threshold')::numeric
      THEN 'DR BELOW TIER THRESHOLD → no tier matches → bonus 0 (legitimate/carry-over)'
    ELSE 'DR meets threshold → bonus SHOULD be > 0. If it is 0, investigate formula.'
  END AS verdict
FROM staff s
LEFT JOIN resolved_plan rp ON rp.staff_id = s.id
LEFT JOIN metrics m ON m.staff_id = s.id
ORDER BY m.delivered_count DESC NULLS LAST, s.name;
