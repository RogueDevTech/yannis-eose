import { describe, it, expect } from 'vitest';
import { PgDialect, pgTable, uuid } from 'drizzle-orm/pg-core';
import { branchScopeCondition } from './branch-scope-condition';

/** Stand-in for any branch-scoped table (orders, cart_orders, follow_up_orders). */
const scopedTable = pgTable('follow_up_orders', {
  servicingBranchId: uuid('servicing_branch_id'),
});

/**
 * The company boundary is enforced entirely by this helper — every branch-scoped
 * list and aggregate across orders, cart, follow-up, marketing, finance and
 * logistics routes through it. These tests lock the invariant that a branchless
 * row is never admitted into a company-scoped user's view.
 */
describe('branchScopeCondition', () => {
  const dialect = new PgDialect();
  const col = scopedTable.servicingBranchId;
  const A = '00000000-0000-0000-0000-0000000000aa';
  const B = '00000000-0000-0000-0000-0000000000bb';

  /** Render the condition to real SQL text so assertions inspect what Postgres runs. */
  const toSql = (cond: ReturnType<typeof branchScopeCondition>): string =>
    cond ? dialect.sqlToQuery(cond).sql : '';

  it('returns no filter for a truly global user', () => {
    expect(branchScopeCondition(col, null, null)).toBeNull();
  });

  it('matches exactly when a specific branch is selected', () => {
    const sql = toSql(branchScopeCondition(col, A, [A, B]));
    expect(sql).toContain('=');
    expect(sql.toLowerCase()).not.toContain('is null');
  });

  it('does NOT admit NULL-branch rows for a single-branch company scope', () => {
    // Regression: a follow-up copy that inherited a NULL servicing branch was
    // visible to every company at once.
    const sql = toSql(branchScopeCondition(col, null, [A]));
    expect(sql).not.toBe('');
    expect(sql.toLowerCase()).not.toContain('is null');
  });

  it('does NOT admit NULL-branch rows for a multi-branch company scope', () => {
    const sql = toSql(branchScopeCondition(col, null, [A, B]));
    expect(sql.toLowerCase()).toContain('in ');
    expect(sql.toLowerCase()).not.toContain('is null');
  });

  it('matches nothing when a company is selected but no branches resolved', () => {
    expect(toSql(branchScopeCondition(col, null, [])).toLowerCase()).toContain('false');
  });

  it('accepts the BranchScope object overload with the same guarantee', () => {
    const sql = toSql(branchScopeCondition(col, { branchId: null, effectiveBranchIds: [A] }));
    expect(sql).not.toBe('');
    expect(sql.toLowerCase()).not.toContain('is null');
  });
});
