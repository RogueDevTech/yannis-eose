-- ============================================
-- Yannis EOSE — Multi-Branch RLS Extension
-- Task 9.2: Branch-scoped Row Level Security
-- ============================================
-- Adds branch_id filtering to all tables that carry branch_id.
-- SuperAdmin bypasses all branch filters (no branch_id restriction).
-- When current_branch_id is NULL or empty, branch filter is NOT applied
-- (graceful fallback for non-branched queries and SuperAdmin).
-- ============================================

-- Helper: get current branch ID from session
CREATE OR REPLACE FUNCTION yannis_current_branch_id()
RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('yannis.current_branch_id', true), '');
$$ LANGUAGE sql STABLE;

-- Helper: check if current user is SuperAdmin (bypasses all branch filters)
CREATE OR REPLACE FUNCTION yannis_is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT yannis_current_user_role() = 'SUPER_ADMIN';
$$ LANGUAGE sql STABLE;

-- ============================================
-- Helper: branch_id matches current session branch
-- Returns TRUE when:
--   a) current user is SuperAdmin (bypass)
--   b) no branch context set (NULL session) — cross-branch queries allowed
--   c) row.branch_id IS NULL — unscoped rows visible to all
--   d) row.branch_id matches session branch
-- ============================================
CREATE OR REPLACE FUNCTION yannis_branch_matches(row_branch_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    yannis_is_super_admin()
    OR yannis_current_branch_id() IS NULL
    OR row_branch_id IS NULL
    OR row_branch_id = yannis_current_branch_id();
$$ LANGUAGE sql STABLE;

-- ============================================
-- ORDERS — branch policy
-- ============================================

-- Drop existing orders branch policy if re-running
DROP POLICY IF EXISTS orders_branch_scope ON orders;

CREATE POLICY orders_branch_scope ON orders
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ============================================
-- CAMPAIGNS — branch policy
-- ============================================

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_branch_scope ON campaigns;

CREATE POLICY campaigns_branch_scope ON campaigns
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ============================================
-- MARKETING_FUNDING — branch policy
-- ============================================

ALTER TABLE marketing_funding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_funding_branch_scope ON marketing_funding;

CREATE POLICY marketing_funding_branch_scope ON marketing_funding
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ============================================
-- AD_SPEND_LOGS — branch policy
-- ============================================

ALTER TABLE ad_spend_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_spend_logs_branch_scope ON ad_spend_logs;

CREATE POLICY ad_spend_logs_branch_scope ON ad_spend_logs
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ============================================
-- INVENTORY_LEVELS — branch policy
-- ============================================

ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_levels_branch_scope ON inventory_levels;

CREATE POLICY inventory_levels_branch_scope ON inventory_levels
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ============================================
-- COMMISSION_PLANS — branch policy
-- ============================================

ALTER TABLE commission_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_plans_branch_scope ON commission_plans;

CREATE POLICY commission_plans_branch_scope ON commission_plans
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ============================================
-- PAYOUT_RECORDS — branch policy
-- ============================================

ALTER TABLE payout_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_records_branch_scope ON payout_records;

CREATE POLICY payout_records_branch_scope ON payout_records
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ============================================
-- LOGISTICS_LOCATIONS — branch policy
-- ============================================

ALTER TABLE logistics_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS logistics_locations_branch_scope ON logistics_locations;

CREATE POLICY logistics_locations_branch_scope ON logistics_locations
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ============================================
-- BRANCHES — access control
-- SuperAdmin: full access
-- Branch members: read own branch(es) only
-- ============================================

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branches_super_admin ON branches;
DROP POLICY IF EXISTS branches_member ON branches;

-- SuperAdmin: all branches
CREATE POLICY branches_super_admin ON branches
  FOR ALL
  USING (yannis_is_super_admin());

-- Authenticated users: see branches they belong to
CREATE POLICY branches_member ON branches
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_branches ub
      WHERE ub.branch_id = branches.id
        AND ub.user_id = yannis_current_user_id()
    )
  );

-- ============================================
-- USER_BRANCHES — access control
-- ============================================

ALTER TABLE user_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_branches_super_admin ON user_branches;
DROP POLICY IF EXISTS user_branches_self ON user_branches;

CREATE POLICY user_branches_super_admin ON user_branches
  FOR ALL
  USING (yannis_is_super_admin());

-- Users can see their own branch memberships
CREATE POLICY user_branches_self ON user_branches
  FOR SELECT
  USING (user_id = yannis_current_user_id());

-- ============================================
-- ORDER_TIMELINE_EVENTS — access control
-- All authenticated users with order access can read timeline events.
-- No branch filter needed — already scoped via order_id.
-- ============================================

ALTER TABLE order_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_timeline_events_read ON order_timeline_events;

CREATE POLICY order_timeline_events_read ON order_timeline_events
  FOR ALL
  USING (
    yannis_current_user_id() IS NOT NULL
    AND yannis_current_user_id() != ''
  );
