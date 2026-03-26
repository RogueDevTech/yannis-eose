-- Prevent duplicate (user_id, branch_id) memberships
CREATE UNIQUE INDEX IF NOT EXISTS user_branches_user_branch_uniq
  ON user_branches (user_id, branch_id);
