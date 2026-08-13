-- Migration 0315: Restamp BRANCH_ADMIN template grants into user_permissions.
--
-- Migration 0312 soft-closed every BRANCH_ADMIN user_permissions grant NOT in the
-- slim template, expecting the RBAC boot re-seed to restamp the template grants.
-- But that backfill is ONE-TIME (guarded by _yannis_permission_snapshot_applied,
-- already applied), so it never re-added the template — leaving branch admins with
-- ZERO open grants. Runtime reads the effective set as
--   user_permissions WHERE valid_to IS NULL AND granted = true
-- so a branch admin ends up with NO permissions at all (empty nav, empty
-- attendance grid, etc.).
--
-- This migration OPENS the current BRANCH_ADMIN role_permissions template grants
-- on every BRANCH_ADMIN user's user_permissions. Deriving from role_permissions
-- (not a hardcoded list) keeps it in sync with the template automatically.
--
-- Idempotent: re-opens existing rows and inserts any missing ones. modified_by is
-- left NULL (System) via the stamp-actor trigger, matching 0312's approach.

INSERT INTO user_permissions (user_id, permission_id, granted, valid_from, valid_to)
SELECT u.id, rp.permission_id, true, now(), NULL
FROM users u
CROSS JOIN role_permissions rp
WHERE u.role = 'BRANCH_ADMIN'
  AND rp.role = 'BRANCH_ADMIN'
ON CONFLICT (user_id, permission_id)
DO UPDATE SET granted = true, valid_to = NULL, valid_from = now();
