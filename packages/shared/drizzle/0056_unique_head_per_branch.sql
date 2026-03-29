-- Migration: enforce one active HEAD_OF_* per branch
-- Each branch can have at most one active HEAD_OF_CS, HEAD_OF_MARKETING, HEAD_OF_LOGISTICS.
-- Uses a partial unique index so it only applies to ACTIVE users with those roles
-- and only when primary_branch_id is set.

CREATE UNIQUE INDEX uq_active_head_of_cs_per_branch
  ON users (role, primary_branch_id)
  WHERE role = 'HEAD_OF_CS'
    AND status = 'ACTIVE'
    AND primary_branch_id IS NOT NULL;

CREATE UNIQUE INDEX uq_active_head_of_marketing_per_branch
  ON users (role, primary_branch_id)
  WHERE role = 'HEAD_OF_MARKETING'
    AND status = 'ACTIVE'
    AND primary_branch_id IS NOT NULL;

CREATE UNIQUE INDEX uq_active_head_of_logistics_per_branch
  ON users (role, primary_branch_id)
  WHERE role = 'HEAD_OF_LOGISTICS'
    AND status = 'ACTIVE'
    AND primary_branch_id IS NOT NULL;
