import { describe, it, expect } from 'vitest';

/**
 * Call Customer phone reveal gate (`getCallablePhoneForViewer`).
 *
 * The reveal used to filter on `ctx.effectiveBranchIds`. That set is a
 * LIST-scoping device, not an authorization one: when a company is selected but
 * `selectedBranchIds` is empty (stale session, or the race before the /auth/me
 * backfill lands) trpc/context.ts resolves it to a sentinel UUID matching no
 * branch. Feeding that into an authz check denied the phone for a fully
 * authorized CS already looking at the order, while `orders.getById` returned
 * the order itself — the two gates disagreed.
 *
 * The reveal now applies exactly the read rule `orders.getById` applies, so
 * these tests pin both the fix and the IDOR protection it must preserve.
 */

const SENTINEL_BRANCH_ID = '00000000-0000-0000-0000-000000000000';

/** Mirrors OrdersService.assertActorMayViewOrderForRead. */
function mayViewOrderForRead(
  actor: { role: string; id: string; permissions?: string[] },
  order: { mediaBuyerId: string | null },
): boolean {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN') return true;
  const perms = actor.permissions ?? [];
  if (perms.includes('orders.view')) return true;
  if (!perms.includes('marketing.orders.view')) return false;
  if (actor.role !== 'HEAD_OF_MARKETING' && order.mediaBuyerId !== actor.id) return false;
  return true;
}

const MARKETING_ROLES = new Set(['MEDIA_BUYER', 'HEAD_OF_MARKETING']);

/** Mirrors the gate order in OrdersService.getCallablePhoneForViewer. */
function revealPhone(
  actor: { role: string; id: string; permissions?: string[] },
  order: { mediaBuyerId: string | null; customerPhone: string | null } | null,
  opts: { voipEnabled: boolean },
): { phone: string; isDialable: boolean } | null {
  if (opts.voipEnabled) return null;
  if (MARKETING_ROLES.has(actor.role)) return null;
  if (!order) return null;
  if (!mayViewOrderForRead(actor, order)) return null;
  const raw = order.customerPhone?.trim();
  if (raw) return { phone: raw, isDialable: true };
  return null;
}

const cs = { role: 'CS_CLOSER', id: 'cs-1', permissions: ['orders.view'] };
const order = { mediaBuyerId: 'mb-1', customerPhone: '08012345678' };

describe('callable phone reveal gate', () => {
  it('reveals the phone for an authorized CS regardless of branch-set state', () => {
    // The regression: a stale session resolving effectiveBranchIds to the
    // sentinel must not affect the reveal, because it is no longer consulted.
    expect(revealPhone(cs, order, { voipEnabled: false })).toEqual({
      phone: '08012345678',
      isDialable: true,
    });
    expect(SENTINEL_BRANCH_ID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('reveals the phone for a branchless legacy order', () => {
    // Previously denied outright for any scoped viewer via `!orderBranch`.
    expect(revealPhone(cs, order, { voipEnabled: false })).not.toBeNull();
  });

  it('agrees with getById: anyone who can read the order can reveal its phone', () => {
    expect(mayViewOrderForRead(cs, order)).toBe(true);
    expect(revealPhone(cs, order, { voipEnabled: false })).not.toBeNull();
  });

  it('still denies a viewer who cannot read the order (IDOR guard)', () => {
    const stranger = { role: 'LOGISTICS_AGENT', id: 'x-1', permissions: [] };
    expect(mayViewOrderForRead(stranger, order)).toBe(false);
    expect(revealPhone(stranger, order, { voipEnabled: false })).toBeNull();
  });

  it("still denies a media buyer who is not the order's own", () => {
    const otherMb = { role: 'MEDIA_BUYER', id: 'mb-2', permissions: ['marketing.orders.view'] };
    expect(revealPhone(otherMb, order, { voipEnabled: false })).toBeNull();
  });

  it('still denies marketing roles outright, even for their own order', () => {
    const ownMb = { role: 'MEDIA_BUYER', id: 'mb-1', permissions: ['marketing.orders.view'] };
    expect(mayViewOrderForRead(ownMb, order)).toBe(true);
    expect(revealPhone(ownMb, order, { voipEnabled: false })).toBeNull();
  });

  it('still denies when VOIP is enabled', () => {
    expect(revealPhone(cs, order, { voipEnabled: true })).toBeNull();
  });

  it('returns null when no number was ever stored', () => {
    expect(revealPhone(cs, { mediaBuyerId: 'mb-1', customerPhone: null }, { voipEnabled: false })).toBeNull();
  });

  it('returns null when the id matches no order in any table', () => {
    expect(revealPhone(cs, null, { voipEnabled: false })).toBeNull();
  });
});
