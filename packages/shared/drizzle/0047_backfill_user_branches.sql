-- Backfill: assign non-SuperAdmin users who have no user_branches row
-- to the branch referenced by their primary_branch_id.
-- Falls back to the oldest branch in the system if primary_branch_id is NULL.
-- This is safe and idempotent — only touches users with zero existing memberships.

INSERT INTO user_branches (user_id, branch_id, is_primary)
SELECT
  u.id,
  COALESCE(
    u.primary_branch_id,
    (SELECT id FROM branches WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1)
  ),
  true
FROM users u
WHERE u.role != 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id
  )
  AND (
    u.primary_branch_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM branches WHERE status = 'ACTIVE')
  )
ON CONFLICT DO NOTHING;
