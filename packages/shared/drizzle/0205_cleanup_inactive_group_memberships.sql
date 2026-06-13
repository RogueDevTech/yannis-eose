-- Clean up auto-assigned user_branches memberships for branches in inactive groups.
-- The syncCloserBranchMemberships boot hook (now removed) incorrectly assigned
-- all CS closers to every active branch regardless of group status.

-- 1. Delete user_branches rows for branches whose company group is INACTIVE.
DELETE FROM user_branches
WHERE branch_id IN (
  SELECT b.id FROM branches b
  INNER JOIN branch_groups bg ON bg.id = b.group_id
  WHERE bg.status = 'INACTIVE'
);

-- 2. Delete duplicate branches (same name+code). Clean up FK dependents first.
--    Keeps the earliest-created row per (LOWER(name), LOWER(code)).
--    branch_departments has onDelete CASCADE from branches, but branch_teams does not.
WITH dupes AS (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY LOWER(name), LOWER(code) ORDER BY created_at ASC) AS rn
    FROM branches
  ) ranked
  WHERE rn > 1
)
DELETE FROM branch_teams WHERE branch_id IN (SELECT id FROM dupes);

WITH dupes AS (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY LOWER(name), LOWER(code) ORDER BY created_at ASC) AS rn
    FROM branches
  ) ranked
  WHERE rn > 1
)
DELETE FROM branches WHERE id IN (SELECT id FROM dupes);
