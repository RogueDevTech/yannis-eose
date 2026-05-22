-- ============================================
-- 0151: Drop stale branch team / department memberships.
--
-- THE BUG:
--   Removing a user from a branch (UsersService.updateStaff branch edit, or
--   the branches.removeUser mutation) deleted their `user_branches` row but
--   left their `branch_team_members` and `branch_department_members` rows
--   behind. A user no longer in a branch kept showing in that branch's team
--   squads and department roster — and could linger as a stale team
--   supervisor (`users.is_team_supervisor`).
--
-- THE FIX (code):
--   Both branch-removal paths now cascade the team/department cleanup in the
--   same transaction and resync `users.is_team_supervisor`.
--
-- THIS MIGRATION:
--   One-off cleanup of rows that already went stale before the code fix —
--   any team/department membership whose user is not (any longer) a member of
--   the owning branch is deleted, then the supervisor flag is resynced.
-- ============================================

-- Stale team-squad memberships: user not in the team's branch.
DELETE FROM branch_team_members btm
USING branch_teams bt
WHERE bt.id = btm.team_id
  AND NOT EXISTS (
    SELECT 1 FROM user_branches ub
    WHERE ub.user_id = btm.user_id
      AND ub.branch_id = bt.branch_id
  );

-- Stale department-roster memberships: user not in the department's branch.
DELETE FROM branch_department_members bdm
USING branch_departments bd
WHERE bd.id = bdm.branch_department_id
  AND NOT EXISTS (
    SELECT 1 FROM user_branches ub
    WHERE ub.user_id = bdm.user_id
      AND ub.branch_id = bd.branch_id
  );

-- Resync the denormalised supervisor flag: a user is a team supervisor iff
-- they still hold at least one `is_supervisor` team-membership row. Guarded so
-- only rows that actually change are written (keeps temporal history clean).
UPDATE users u
SET is_team_supervisor = EXISTS (
      SELECT 1 FROM branch_team_members btm
      WHERE btm.user_id = u.id AND btm.is_supervisor = true
    )
WHERE u.is_team_supervisor <> EXISTS (
      SELECT 1 FROM branch_team_members btm
      WHERE btm.user_id = u.id AND btm.is_supervisor = true
    );
