-- Migration 0312: Reset BRANCH_ADMIN users to their (slim) role template.
--
-- BRANCH_ADMIN was reduced to a slim role (attendance + branch roster + audit/
-- exports; CEO directive 2026-08-13). But existing branch-admin users carry
-- per-user `user_permissions` GRANT rows stamped from the OLD broad template
-- (orders / inventory / finance / marketing / logistics / branches / settings /
-- data.import / order approvals, etc.). Those over-grants override the template
-- in the effective-permission calc (template ∪ role_perms ∪ user_grants), so a
-- branch admin still sees every module. This migration soft-closes every active
-- BRANCH_ADMIN user grant whose code is NOT in the new template set, collapsing
-- their effective access to exactly the template.
--
-- Soft-close (valid_to = now()) matches the temporal model the app reads
-- (effective set = rows WHERE valid_to IS NULL AND granted = true), preserving
-- the audit trail. The RBAC boot re-seed then restamps the merged snapshot.
--
-- Idempotent: a second run finds no still-open excess grants (they're closed).

UPDATE user_permissions up
SET valid_to = now()
FROM users u, permissions p
WHERE up.user_id = u.id
  AND up.permission_id = p.id
  AND u.role = 'BRANCH_ADMIN'
  AND up.valid_to IS NULL
  AND up.granted = true
  AND p.code NOT IN (
    'attendance.read',
    'attendance.manage',
    'users.read',
    'hr.read',
    'audit.read',
    'orders.export',
    'inventory.export',
    'finance.export',
    'audit.export',
    'hr.export',
    'marketing.export',
    'logistics.export',
    'data.export'
  );
