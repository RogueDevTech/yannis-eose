-- Migration 0217: Backfill org-wide users into their company group's branches.
--
-- Non-branch-eligible roles (STOCK_MANAGER, FINANCE_OFFICER, HR_MANAGER,
-- HEAD_OF_LOGISTICS, HEAD_OF_CS, HEAD_OF_MARKETING) created before the
-- company-group isolation feature had NO user_branches entries. Without
-- branch memberships, the login flow can't determine their activeGroupId,
-- and effectiveBranchIds stays null — they see data from all groups.
--
-- This migration assigns every org-wide user (with zero branch memberships)
-- to ALL branches in the first active company group (oldest by created_at).
-- Users who already have branch memberships are untouched.
--
-- Safe to re-run: the unique index on (user_id, branch_id) prevents duplicates.

INSERT INTO user_branches (user_id, branch_id, is_primary, role_in_branch)
SELECT
  u.id,
  b.id,
  false,
  NULL
FROM users u
CROSS JOIN (
  SELECT b2.id
  FROM branches b2
  WHERE b2.status = 'ACTIVE'
    AND b2.group_id = (
      SELECT bg.id
      FROM branch_groups bg
      WHERE bg.status = 'ACTIVE'
      ORDER BY bg.created_at ASC
      LIMIT 1
    )
) b
WHERE u.role IN (
  'STOCK_MANAGER',
  'FINANCE_OFFICER',
  'HR_MANAGER',
  'HEAD_OF_LOGISTICS',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING'
)
AND u.status != 'DEACTIVATED'
AND NOT EXISTS (
  SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id
)
ON CONFLICT (user_id, branch_id) DO NOTHING;
