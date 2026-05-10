-- ============================================
-- Yannis EOSE — Row-Level Security (RLS)
-- Task 0.5: Database-level access control
-- ============================================
-- RLS policies use two session variables:
--   yannis.current_user_id   — set by AuditInterceptor
--   yannis.current_user_role — set by AuditInterceptor
-- These are injected on every authenticated request before any query runs.
-- ============================================

-- Helper: get current user ID from session
CREATE OR REPLACE FUNCTION yannis_current_user_id()
RETURNS TEXT AS $$
  SELECT current_setting('yannis.current_user_id', true);
$$ LANGUAGE sql STABLE;

-- Helper: get current user role from session
CREATE OR REPLACE FUNCTION yannis_current_user_role()
RETURNS TEXT AS $$
  SELECT current_setting('yannis.current_user_role', true);
$$ LANGUAGE sql STABLE;

-- Helper: check if current user has a privileged role (full access)
CREATE OR REPLACE FUNCTION yannis_is_privileged()
RETURNS BOOLEAN AS $$
  SELECT yannis_current_user_role() IN ('SUPER_ADMIN', 'FINANCE_OFFICER', 'HEAD_OF_LOGISTICS');
$$ LANGUAGE sql STABLE;

-- ============================================
-- 1. ORDERS — RLS Policies
-- ============================================
-- CS closers: assigned_cs_id = me
-- Media Buyers: media_buyer_id = me
-- 3PL Managers: logistics_location_id belongs to their provider
-- Head of CS: all orders (needs full team visibility)
-- Finance, Head of Logistics, SuperAdmin: all
-- ============================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- SuperAdmin, Finance, Head of Logistics, Head of CS: full access
CREATE POLICY orders_privileged ON orders
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'FINANCE_OFFICER', 'HEAD_OF_LOGISTICS', 'HEAD_OF_CS')
  );

-- CS Closer: see only assigned orders
CREATE POLICY orders_cs_closer ON orders
  FOR ALL
  USING (
    yannis_current_user_role() = 'CS_CLOSER'
    AND assigned_cs_id = yannis_current_user_id()
  );

-- Media Buyer: see only their campaign orders
CREATE POLICY orders_media_buyer ON orders
  FOR ALL
  USING (
    yannis_current_user_role() = 'MEDIA_BUYER'
    AND media_buyer_id = yannis_current_user_id()
  );

-- Head of Marketing: see all orders (read-only for marketing oversight)
CREATE POLICY orders_hom ON orders
  FOR SELECT
  USING (
    yannis_current_user_role() = 'HEAD_OF_MARKETING'
  );

-- 3PL Manager: see orders allocated to their location
-- Users with TPL_MANAGER role have logistics_location_id set on their user record
CREATE POLICY orders_tpl_manager ON orders
  FOR ALL
  USING (
    yannis_current_user_role() = 'TPL_MANAGER'
    AND logistics_location_id = (
      SELECT u.logistics_location_id FROM users u
      WHERE u.id = yannis_current_user_id()
    )
  );

-- 3PL Rider: see only their assigned deliveries
CREATE POLICY orders_tpl_rider ON orders
  FOR ALL
  USING (
    yannis_current_user_role() = 'TPL_RIDER'
    AND rider_id = yannis_current_user_id()
  );

-- Stock Manager: see orders for stock management (read-only)
CREATE POLICY orders_warehouse_manager ON orders
  FOR SELECT
  USING (
    yannis_current_user_role() = 'STOCK_MANAGER'
  );

-- HR Manager: see orders for commission calculations (read-only)
CREATE POLICY orders_hr_manager ON orders
  FOR SELECT
  USING (
    yannis_current_user_role() = 'HR_MANAGER'
  );

-- ============================================
-- 2. PRODUCTS — RLS + Column-Level Security
-- ============================================
-- All authenticated users can see products.
-- cost_price is restricted via a security barrier view.
-- ============================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view products
CREATE POLICY products_read_all ON products
  FOR SELECT
  USING (true);

-- Only SuperAdmin, Finance, Stock Manager can modify products
CREATE POLICY products_write ON products
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'FINANCE_OFFICER', 'STOCK_MANAGER')
  );

-- Security barrier view: masks cost_price for non-privileged roles
CREATE OR REPLACE VIEW products_safe WITH (security_barrier = true) AS
SELECT
  id, name, description, sku, base_sale_price,
  CASE
    WHEN yannis_current_user_role() IN ('SUPER_ADMIN', 'FINANCE_OFFICER')
    THEN cost_price
    ELSE NULL
  END AS cost_price,
  min_threshold, category, status,
  valid_from, valid_to, modified_by,
  created_at, updated_at
FROM products;

-- ============================================
-- 3. INVENTORY_LEVELS — RLS Policies
-- ============================================
-- 3PL Managers: see only their location
-- Stock Manager: see all (manages main warehouse + oversight)
-- Head of Logistics, SuperAdmin: see all
-- ============================================

ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;

-- Privileged roles: full access
CREATE POLICY inventory_privileged ON inventory_levels
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'FINANCE_OFFICER', 'HEAD_OF_LOGISTICS', 'STOCK_MANAGER')
  );

-- 3PL Manager: see only their location's inventory
CREATE POLICY inventory_tpl_manager ON inventory_levels
  FOR ALL
  USING (
    yannis_current_user_role() = 'TPL_MANAGER'
    AND location_id = (
      SELECT u.logistics_location_id FROM users u
      WHERE u.id = yannis_current_user_id()
    )
  );

-- ============================================
-- 4. MARKETING_FUNDING — RLS Policies
-- ============================================
-- Media Buyers: see records where receiver_id = me
-- Head of Marketing: see records where sender_id = me
-- Finance, SuperAdmin: see all
-- ============================================

ALTER TABLE marketing_funding ENABLE ROW LEVEL SECURITY;

-- Privileged roles: full access
CREATE POLICY funding_privileged ON marketing_funding
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'FINANCE_OFFICER')
  );

-- Head of Marketing: see funding they sent
CREATE POLICY funding_hom ON marketing_funding
  FOR ALL
  USING (
    yannis_current_user_role() = 'HEAD_OF_MARKETING'
    AND sender_id = yannis_current_user_id()
  );

-- Media Buyer: see funding received
CREATE POLICY funding_media_buyer ON marketing_funding
  FOR ALL
  USING (
    yannis_current_user_role() = 'MEDIA_BUYER'
    AND receiver_id = yannis_current_user_id()
  );

-- ============================================
-- 5. PAYOUT_RECORDS — RLS Policies
-- ============================================
-- Staff: see only their own records
-- HR Manager, SuperAdmin: see all
-- ============================================

ALTER TABLE payout_records ENABLE ROW LEVEL SECURITY;

-- HR and SuperAdmin: full access
CREATE POLICY payouts_privileged ON payout_records
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'HR_MANAGER')
  );

-- All other staff: see only their own payouts
CREATE POLICY payouts_own ON payout_records
  FOR SELECT
  USING (
    staff_id = yannis_current_user_id()
  );

-- ============================================
-- 6. EARNINGS_ADJUSTMENTS — RLS Policies
-- ============================================
-- Same pattern as payout_records
-- ============================================

ALTER TABLE earnings_adjustments ENABLE ROW LEVEL SECURITY;

-- HR and SuperAdmin: full access
CREATE POLICY adjustments_privileged ON earnings_adjustments
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'HR_MANAGER')
  );

-- Staff: see only their own adjustments
CREATE POLICY adjustments_own ON earnings_adjustments
  FOR SELECT
  USING (
    staff_id = yannis_current_user_id()
  );

-- ============================================
-- 7. CAMPAIGNS — RLS Policies
-- ============================================
-- Media Buyers: see only their campaigns
-- Head of Marketing, SuperAdmin: see all
-- ============================================

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_privileged ON campaigns
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'HEAD_OF_MARKETING', 'FINANCE_OFFICER')
  );

CREATE POLICY campaigns_media_buyer ON campaigns
  FOR ALL
  USING (
    yannis_current_user_role() = 'MEDIA_BUYER'
    AND media_buyer_id = yannis_current_user_id()
  );

-- ============================================
-- 8. AD_SPEND_LOGS — RLS Policies
-- ============================================

ALTER TABLE ad_spend_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ad_spend_privileged ON ad_spend_logs
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'HEAD_OF_MARKETING', 'FINANCE_OFFICER')
  );

CREATE POLICY ad_spend_media_buyer ON ad_spend_logs
  FOR ALL
  USING (
    yannis_current_user_role() = 'MEDIA_BUYER'
    AND media_buyer_id = yannis_current_user_id()
  );

-- ============================================
-- 9. CALL_LOGS — RLS Policies
-- ============================================

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_logs_privileged ON call_logs
  FOR ALL
  USING (
    yannis_current_user_role() IN ('SUPER_ADMIN', 'HEAD_OF_CS', 'FINANCE_OFFICER')
  );

CREATE POLICY call_logs_cs_closer ON call_logs
  FOR ALL
  USING (
    yannis_current_user_role() = 'CS_CLOSER'
    AND agent_id = yannis_current_user_id()
  );

-- ============================================
-- 10. FORCE RLS on the DB role used by the app
-- ============================================
-- By default, table owners bypass RLS.
-- We need FORCE ROW LEVEL SECURITY so that even
-- the app's DB user is subject to RLS policies.
-- ============================================

ALTER TABLE orders FORCE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_levels FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_funding FORCE ROW LEVEL SECURITY;
ALTER TABLE payout_records FORCE ROW LEVEL SECURITY;
ALTER TABLE earnings_adjustments FORCE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE ad_spend_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE call_logs FORCE ROW LEVEL SECURITY;
