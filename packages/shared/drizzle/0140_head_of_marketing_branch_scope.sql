-- 0140_head_of_marketing_branch_scope.sql
--
-- Product change 2026-05-11:
-- Head of Marketing is no longer an org-wide branch-visibility role.
-- Branch assignments define which branches a HoM may switch between.
--
-- Code changes in the permission catalog remove the default
-- `marketing.scope.global` grant from the HEAD_OF_MARKETING system template.
-- This migration backfills existing rows so current HoM accounts stop
-- inheriting org-wide branch access after deploy.

-- Step 0: marker for the one-time bootstrap restamp that reapplies current
-- HoM snapshots after the permission catalog sync. The service inserts the row
-- when complete so the fix stays idempotent across restarts.
CREATE TABLE IF NOT EXISTS _yannis_hom_branch_scope_applied (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Step 1: clear the explicit org-wide-head flag on existing HoM users.
UPDATE users
SET scope_org_wide_head = FALSE
WHERE role = 'HEAD_OF_MARKETING'
  AND scope_org_wide_head = TRUE;

-- Step 2: drop stamped `marketing.scope.global` rows from HoM snapshots.
-- New baseline rows are re-seeded from code on boot; this removes the legacy
-- global-scope grant for existing HoM accounts immediately.
DELETE FROM user_permissions up
USING users u, permissions p
WHERE up.user_id = u.id
  AND up.permission_id = p.id
  AND u.role = 'HEAD_OF_MARKETING'
  AND p.code = 'marketing.scope.global'
  AND up.valid_to IS NULL;
