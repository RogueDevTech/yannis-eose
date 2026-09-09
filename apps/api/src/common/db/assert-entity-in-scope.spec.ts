import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  isEntityInScope,
  assertEntityInScope,
  assertEntityInScopeAny,
  assertGroupInScope,
} from './assert-entity-in-scope';

/**
 * Companion to `branchScopeCondition` (which guards LIST queries). This helper
 * is the only thing standing between a client-supplied entity id and a
 * cross-company read/mutation, so these tests lock the boundary: an org-wide
 * caller passes everything, a company-scoped caller passes only rows inside
 * their own branch set.
 */
describe('assert-entity-in-scope', () => {
  const A = '00000000-0000-0000-0000-0000000000aa';
  const B = '00000000-0000-0000-0000-0000000000bb';
  /** Sentinel the tRPC context substitutes for a stale/unresolved company session. */
  const UNRESOLVED = '00000000-0000-0000-0000-000000000000';

  const forbidden = (fn: () => void) => {
    expect(fn).toThrow(TRPCError);
    try {
      fn();
    } catch (e) {
      expect((e as TRPCError).code).toBe('FORBIDDEN');
    }
  };

  describe('isEntityInScope', () => {
    it('admits everything for an org-wide caller (null scope)', () => {
      expect(isEntityInScope(A, null)).toBe(true);
      expect(isEntityInScope(null, null)).toBe(true);
    });

    it('admits a row whose branch is inside the active company', () => {
      expect(isEntityInScope(A, [A, B])).toBe(true);
    });

    it('rejects a row from another company', () => {
      expect(isEntityInScope(B, [A])).toBe(false);
    });

    it('rejects everything when the company is selected but unresolved', () => {
      expect(isEntityInScope(A, [])).toBe(false);
    });

    it('rejects a branchless row for a scoped caller by default', () => {
      expect(isEntityInScope(null, [A])).toBe(false);
      expect(isEntityInScope(undefined, [A])).toBe(false);
    });

    it('admits a branchless row when the caller opts out of the strict rule', () => {
      expect(isEntityInScope(null, [A], { denyBranchlessWhenScoped: false })).toBe(true);
    });
  });

  describe('assertEntityInScope', () => {
    it('is a no-op for an in-scope row', () => {
      expect(() => assertEntityInScope(A, [A])).not.toThrow();
    });

    it('throws FORBIDDEN for a cross-company row', () => {
      forbidden(() => assertEntityInScope(B, [A]));
    });
  });

  describe('assertEntityInScopeAny', () => {
    // An order carries both `branch_id` (marketing) and `servicing_branch_id`
    // (fulfilment) and these legitimately differ across branches, so either one
    // landing inside the company must admit the row.
    it('admits when only the marketing branch is in the company', () => {
      expect(() => assertEntityInScopeAny([A, B], [A])).not.toThrow();
    });

    it('admits when only the servicing branch is in the company', () => {
      expect(() => assertEntityInScopeAny([B, A], [A])).not.toThrow();
    });

    it('rejects when neither branch is in the company', () => {
      forbidden(() => assertEntityInScopeAny([B, B], [A]));
    });

    it('rejects a fully branchless order for a scoped caller', () => {
      forbidden(() => assertEntityInScopeAny([null, null], [A]));
    });

    it('admits any order for an org-wide caller', () => {
      expect(() => assertEntityInScopeAny([B, null], null)).not.toThrow();
    });

    it('rejects against the unresolved-session sentinel', () => {
      forbidden(() => assertEntityInScopeAny([A, A], [UNRESOLVED]));
    });
  });

  describe('assertGroupInScope', () => {
    it('is a no-op for an org-wide caller', () => {
      expect(() => assertGroupInScope(B, null)).not.toThrow();
    });

    it('admits a matching company', () => {
      expect(() => assertGroupInScope(A, A)).not.toThrow();
    });

    it('rejects a mismatched company', () => {
      forbidden(() => assertGroupInScope(B, A));
    });

    it('rejects a groupless row for a scoped caller', () => {
      forbidden(() => assertGroupInScope(null, A));
    });
  });
});

/**
 * `cart_abandonments` has no branch column — a cart's company is derived through
 * `campaign_id -> campaigns.branch_id`. `pullFromCarts` accepts a client-supplied
 * id list, so this reproduces the accept/reject decision that
 * `assertAbandonedCartsInScope` makes over the joined rows.
 */
describe('abandoned-cart pull scoping (campaign-derived company)', () => {
  const A = '00000000-0000-0000-0000-0000000000aa';
  const B = '00000000-0000-0000-0000-0000000000bb';

  /** Mirrors the in-service filter: a cart is pullable only via its campaign's branch. */
  const rejectedCarts = (
    rows: Array<{ id: string; branchId: string | null }>,
    effectiveBranchIds: string[] | null,
  ): string[] => {
    if (effectiveBranchIds == null) return [];
    const inScope = new Set(
      rows.filter((r) => r.branchId != null && effectiveBranchIds.includes(r.branchId)).map((r) => r.id),
    );
    return rows.map((r) => r.id).filter((id) => !inScope.has(id));
  };

  it('pulls carts whose campaign is in the caller company', () => {
    expect(rejectedCarts([{ id: 'c1', branchId: A }], [A])).toEqual([]);
  });

  it('refuses a cart whose campaign belongs to another company', () => {
    expect(rejectedCarts([{ id: 'c1', branchId: B }], [A])).toEqual(['c1']);
  });

  it('refuses the whole batch when only some carts are foreign', () => {
    const rows = [
      { id: 'c1', branchId: A },
      { id: 'c2', branchId: B },
    ];
    expect(rejectedCarts(rows, [A])).toEqual(['c2']);
  });

  it('refuses a campaignless cart for a scoped caller (no derivable company)', () => {
    expect(rejectedCarts([{ id: 'c1', branchId: null }], [A])).toEqual(['c1']);
  });

  it('lets the org-wide auto-sync cron pull anything', () => {
    const rows = [
      { id: 'c1', branchId: A },
      { id: 'c2', branchId: B },
      { id: 'c3', branchId: null },
    ];
    expect(rejectedCarts(rows, null)).toEqual([]);
  });
});
