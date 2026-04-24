-- Migration: extend "one active head per branch" rule to HR_MANAGER (CEO directive 2026-04-23).
-- HR_MANAGER joins HEAD_OF_CS, HEAD_OF_MARKETING, HEAD_OF_LOGISTICS as a role that cannot have
-- two concurrent active holders within the same branch. Service-level check in users.service.ts
-- emits a friendly error before submit; this index is the DB-level safety net.

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_hr_manager_per_branch
  ON users (role, primary_branch_id)
  WHERE role = 'HR_MANAGER'
    AND status = 'ACTIVE'
    AND primary_branch_id IS NOT NULL;
