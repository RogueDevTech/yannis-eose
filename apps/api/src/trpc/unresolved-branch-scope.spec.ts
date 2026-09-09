import { describe, it, expect } from 'vitest';
import { isEntityInScope } from '../common/db/assert-entity-in-scope';

/**
 * Unresolved company scope must stay distinguishable from a real violation.
 *
 * When a company is selected but `selectedBranchIds` is empty (stale session,
 * or the race before the /auth/me backfill lands), trpc/context.ts used to
 * substitute a sentinel branch UUID. That kept LIST queries fail-closed, but
 * once per-entity guards (`assertEntityInScope*`) landed on by-id procedures
 * the sentinel reached `includes()` and read as a genuine cross-company
 * violation: a fully authorized user mid-backfill was told "This record is not
 * in your company." about their own order.
 *
 * Context now emits `[]` for that state — the shape the guard already treats as
 * "selected but unresolved". These tests pin the distinction so the sentinel
 * cannot come back.
 */

const SENTINEL = '00000000-0000-0000-0000-000000000000';
const OWN_BRANCH = '00000000-0000-0000-0000-0000000000aa';

describe('unresolved company scope', () => {
  it('denies a real cross-company row', () => {
    const otherCompanyBranch = '00000000-0000-0000-0000-0000000000bb';
    expect(isEntityInScope(otherCompanyBranch, [OWN_BRANCH])).toBe(false);
  });

  it('denies while the session scope is unresolved (fail closed)', () => {
    // Same outcome as before the fix — unresolved must never leak org-wide.
    expect(isEntityInScope(OWN_BRANCH, [])).toBe(false);
  });

  it('admits the row once the backfill resolves the scope', () => {
    // The regression: with the sentinel this stayed denied until the session
    // refreshed, because [SENTINEL] never contained the real branch.
    expect(isEntityInScope(OWN_BRANCH, [SENTINEL])).toBe(false);
    expect(isEntityInScope(OWN_BRANCH, [OWN_BRANCH])).toBe(true);
  });

  it('keeps org-wide callers unrestricted', () => {
    expect(isEntityInScope(OWN_BRANCH, null)).toBe(true);
  });
});
