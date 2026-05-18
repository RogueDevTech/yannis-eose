-- Permission snapshot model: bookkeeping for one-time backfill on API bootstrap.
-- Rows are inserted by PermissionSnapshotBackfillService after stamping user_permissions
-- from the legacy union formula (template ∪ role_permissions ∪ user rows).

CREATE TABLE IF NOT EXISTS _yannis_permission_snapshot_applied (
  singleton_key smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_key = 1),
  applied_at timestamptz NOT NULL DEFAULT now()
);
