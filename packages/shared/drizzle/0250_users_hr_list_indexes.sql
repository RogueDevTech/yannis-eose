-- HR Users page performance — the users.list + rosterSummary queries use
-- subqueries on user_branches(branch_id) for company-wide scoping and
-- ORDER BY created_at DESC. Without indexes these are full seq scans,
-- causing 15-20s page loads and timeouts on /hr/users.

-- user_branches.branch_id — the company-wide user list filters via
-- IN (SELECT user_id FROM user_branches WHERE branch_id IN (...)).
-- The existing unique index on (user_id, branch_id) is ordered user-first
-- so branch_id lookups still seq-scan.
CREATE INDEX IF NOT EXISTS idx_user_branches_branch_id
  ON user_branches (branch_id);

-- users.status + created_at — list query filters by status (ne DEACTIVATED)
-- and orders by created_at DESC. Composite index covers both.
CREATE INDEX IF NOT EXISTS idx_users_status_created_at
  ON users (status, created_at DESC);
