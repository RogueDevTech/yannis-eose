-- 0136_remove_non_branch_users_from_branches.sql
--
-- CEO directive 2026-05-10: only Marketing, Customer Support, and the
-- branch-management role belong in the branching system. Non-branch roles
-- (SuperAdmin, Admin, Finance Officer, HR Manager, Logistics, Stock, 3PL)
-- exist org-wide and shouldn't have a branch assignment.
--
-- Branch-eligible roles (kept):
--   MEDIA_BUYER, HEAD_OF_MARKETING        — Marketing department
--   CS_CLOSER, HEAD_OF_CS                 — Customer Support department
--   BRANCH_ADMIN                          — manages a single branch
--
-- All other roles get cleared from `user_branches` and have their
-- `users.primary_branch_id` set to NULL. Users themselves are NOT deleted —
-- they keep their accounts, sessions, and audit history. Only their branch
-- pinning is removed.
--
-- Idempotent: re-running the migration finds no matching rows after the
-- first execution. user_branches has no `*_history` table (join table).

-- Step 1: clear `primary_branch_id` on non-branch users so the join-table
-- delete below doesn't leave a dangling pointer to a branch they're no
-- longer a member of.
UPDATE users
SET primary_branch_id = NULL
WHERE primary_branch_id IS NOT NULL
  AND role NOT IN (
    'MEDIA_BUYER',
    'HEAD_OF_MARKETING',
    'CS_CLOSER',
    'HEAD_OF_CS',
    'BRANCH_ADMIN'
  );

-- Step 2: remove join-table rows for non-branch users.
DELETE FROM user_branches
WHERE user_id IN (
  SELECT id FROM users
  WHERE role NOT IN (
    'MEDIA_BUYER',
    'HEAD_OF_MARKETING',
    'CS_CLOSER',
    'HEAD_OF_CS',
    'BRANCH_ADMIN'
  )
);
