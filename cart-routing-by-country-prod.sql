-- ============================================================================
-- CART ORDER ROUTING BY COUNTRY — PRODUCTION
--
-- Routes each country's cart orders to that country's CS branch:
--   Ghana carts    -> Ghana        (01a04e0c-c6c9-7e91-8587-2791e18f5d20)
--   Kenya carts    -> Kenya        (01a029fe-4479-71f3-9e74-51d97ae82014)
--   Tanzania carts -> Tanzania     (01a029fe-e610-7b6c-84d1-bac8d646355c)
--   Zambia carts   -> Zambia       (01a029ad-906a-781e-8457-d94fe403f497)
--   Nigeria carts  -> existing "NGN carts → Lagos" rule, LEFT UNTOUCHED
--   anything else  -> "All other countries" round-robin fallback
--
-- HOW IT WORKS (already built — no code change needed):
--   cart_order_routing_rules.currency_code: NULL = any country; otherwise the
--   rule only matches carts whose currency matches. The matcher sorts
--   currency-specific rules AHEAD of the NULL catch-all, so a specific rule
--   always wins (cart-orders.service.ts routing matcher).
--
-- RUN:
--   psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -f cart-routing-by-country-prod.sql
--
-- SAFETY
--   • One transaction. Any failure = full rollback, nothing changes.
--   • Idempotent: fixed rule ids + ON CONFLICT DO UPDATE. Re-running is a no-op.
--   • Currency codes are RESOLVED from the currencies table by country name,
--     not hardcoded, so a rule can never reference a currency prod doesn't have.
--   • Aborts before writing if: migration 0337 is missing, a target branch is
--     not ACTIVE, or a country has no active currency.
--   • The existing NGN → Lagos rule is NOT modified. Nothing is deleted.
--   • Only routing CONFIG changes. No cart_orders rows are touched, and
--     already-routed carts are NOT moved — this affects new carts only.
-- ============================================================================

BEGIN;

-- Stamp the audit trail with a real actor (temporal history / modified_by).
-- >>> Replace if a different user is making this change. <<<
SET LOCAL yannis.current_user_id = '019fb4e9-5fe4-7006-9c27-2a5b7d265662';


-- ── STEP 1. The mapping: country -> target CS branch ───────────────────────
-- Branch ids are from the prod ACTIVE branch list. Currency is resolved in
-- STEP 2 from the currencies table rather than hardcoded here.
CREATE TEMP TABLE _map (country_name text PRIMARY KEY, branch_id uuid NOT NULL)
ON COMMIT DROP;

INSERT INTO _map (country_name, branch_id) VALUES
  ('Ghana',    '01a04e0c-c6c9-7e91-8587-2791e18f5d20'),
  ('Kenya',    '01a029fe-4479-71f3-9e74-51d97ae82014'),
  ('Tanzania', '01a029fe-e610-7b6c-84d1-bac8d646355c'),
  ('Zambia',   '01a029ad-906a-781e-8457-d94fe403f497');
  -- Nigeria intentionally omitted: "NGN carts → Lagos" already covers it.


-- ── STEP 2. Resolve each country's active currency code ────────────────────
CREATE TEMP TABLE _country_routing ON COMMIT DROP AS
SELECT m.country_name,
       m.branch_id,
       (SELECT UPPER(c.code) FROM currencies c
         WHERE c.active AND LOWER(c.country_name) = LOWER(m.country_name)
         LIMIT 1) AS currency_code
FROM _map m;


-- ── STEP 3. Guards — abort the whole transaction before any write ──────────
DO $guard$
DECLARE bad text;
BEGIN
  -- 3a. Migration 0337 must have reached prod.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cart_order_routing_rules' AND column_name = 'currency_code'
  ) THEN
    RAISE EXCEPTION
      'cart_order_routing_rules.currency_code is missing. Deploy migration 0337 first.';
  END IF;

  -- 3b. Every country must have an active currency on prod.
  SELECT STRING_AGG(country_name, ', ') INTO bad
  FROM _country_routing WHERE currency_code IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      E'No ACTIVE currency found for: %\nAdd the currency first, or remove that country from STEP 1.', bad;
  END IF;

  -- 3c. Every target branch must exist and be ACTIVE.
  SELECT STRING_AGG(format('%s -> %s', cr.country_name, cr.branch_id), E'\n  ') INTO bad
  FROM _country_routing cr
  LEFT JOIN branches b ON b.id = cr.branch_id AND b.status = 'ACTIVE'
  WHERE b.id IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION E'These target branches do not exist or are not ACTIVE:\n  %', bad;
  END IF;

  -- 3d. Two countries must not resolve to the same currency (would collide on id).
  SELECT STRING_AGG(currency_code, ', ') INTO bad
  FROM (SELECT currency_code FROM _country_routing
        GROUP BY currency_code HAVING COUNT(*) > 1) d;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Multiple countries share currency (%). Cannot route separately.', bad;
  END IF;
END $guard$;


-- ── STEP 4. Upsert one routing rule per country ────────────────────────────
-- Deterministic id per currency so re-runs update in place, never duplicate.
-- Priority 50 sits above the catch-all; irrelevant vs the NGN rule because the
-- matcher filters by currency before priority is ever considered.
INSERT INTO cart_order_routing_rules
  (id, name, source_branch_id, target_branch_id, currency_code, priority, enabled)
SELECT
  uuid_in(md5('cart-routing-' || cr.currency_code)::cstring)::uuid,
  cr.country_name || ' carts to ' || b.name,
  NULL,            -- source: all marketing branches
  cr.branch_id,    -- target: that country's CS branch
  cr.currency_code,
  50,
  true
FROM _country_routing cr
JOIN branches b ON b.id = cr.branch_id
ON CONFLICT (id) DO UPDATE
  SET name             = EXCLUDED.name,
      target_branch_id = EXCLUDED.target_branch_id,
      currency_code    = EXCLUDED.currency_code,
      priority         = EXCLUDED.priority,
      enabled          = EXCLUDED.enabled,
      updated_at       = now();


-- ── STEP 5. "All other countries" fallback ─────────────────────────────────
-- Catches carts in any currency without its own rule. NULL target = round-robin
-- across CS branches. Priority 0 so every specific rule beats it.
INSERT INTO cart_order_routing_rules
  (id, name, source_branch_id, target_branch_id, currency_code, priority, enabled)
VALUES
  ('a0000000-0000-0000-0000-0000000000ff', 'All other countries (round-robin)',
   NULL, NULL, NULL, 0, true)
ON CONFLICT (id) DO UPDATE
  SET name          = EXCLUDED.name,
      currency_code = NULL,
      priority      = EXCLUDED.priority,
      enabled       = EXCLUDED.enabled,
      updated_at    = now();


-- ── STEP 6. Verify — this is exactly what the Cart Order Routing page shows ─
\echo ''
\echo '=== FINAL ROUTING RULES (what the UI will render) ==='
SELECT
  r.priority                                                 AS "#",
  r.name                                                     AS "Rule Name",
  COALESCE(sb.name, 'All branches')                          AS "Source",
  COALESCE(tb.name, 'Round-robin')                           AS "Target",
  COALESCE(cur.country_name, r.currency_code, 'Any country') AS "Country",
  CASE WHEN r.enabled THEN 'Active' ELSE 'Inactive' END      AS "Status"
FROM cart_order_routing_rules r
LEFT JOIN branches sb ON sb.id = r.source_branch_id
LEFT JOIN branches tb ON tb.id = r.target_branch_id
LEFT JOIN (SELECT DISTINCT ON (UPPER(code)) UPPER(code) AS code, country_name
           FROM currencies WHERE active) cur
       ON cur.code = UPPER(r.currency_code)
ORDER BY r.priority DESC, r.name;

COMMIT;
-- If the table above looks wrong, run ROLLBACK instead of COMMIT.
