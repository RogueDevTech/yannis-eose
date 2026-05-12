# CS and Marketing Branch Scope Design

## Goal

Make Customer Support and Marketing pages honor the actively selected branch by default, so users do not see mixed branch data while a specific branch is selected.

## Approved Rule

Selected branch by default, explicit global only.

- If a CS or Marketing page is branch-operational, reads should scope to the active selected branch.
- Org-wide behavior should exist only when it is intentional and clearly named.
- The branch switcher remains the source of truth for the active branch.

## Audit Summary

### Marketing

Marketing is already mostly aligned. Its router layer already threads `ctx.currentBranchId` through the majority of list, summary, and bundle procedures. This pass should only patch real outliers if found.

### Customer Support

CS is mixed today.

- Already branch-aware:
  - closer workloads
  - closer workload orders
  - main queue reads
- Still org-wide:
  - scheduled callbacks
  - flagged duplicates
  - inactive agents
  - CS leaderboard
  - claim queue
  - CS team roster

## Implementation

1. Add optional `branchId` parameters to the CS service methods that still read org-wide by default.
2. Thread `ctx.currentBranchId` into the matching tRPC procedures and bundle endpoints.
3. Keep non-page system paths (such as cron-driven callback notifications) unchanged unless branch scoping is explicitly required there.
4. Keep Marketing unchanged unless the audit finds a real selected-branch miss.

## Verification

- On `/admin/cs/queue`, selecting a branch should scope:
  - workloads
  - callbacks
  - duplicates
  - inactive agents
  - leaderboard-related data
  - claim queue
- On `/admin/cs/team`, the selected branch should scope the visible CS roster and related metrics.
- Marketing pages should be checked for remaining selected-branch misses; if none are found, no marketing code changes are needed in this pass.
