import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
// `vi.mock` is hoisted above imports, so the static import below still receives
// the mocked router modules — no top-level await needed (and `tsc` rejects one
// under this tsconfig's module target).
import { assertOrderIdInAnyTableScope } from './order-scope';

/**
 * Regression lock for the 2026-09-09 cart + follow-up outage.
 *
 * The shared order detail page serves THREE tables (`orders`, `follow_up_orders`,
 * `cart_orders`). A guard that probes only `orders` throws NOT_FOUND for a cart
 * or follow-up id, which took mark-delivered / adjust-price / copy-order /
 * assign-agent offline for both pipelines while funnel orders kept working.
 *
 * These tests pin the contract: an id is admitted when ANY of the three tables
 * admits it, and refused only when none does.
 */

const ordersGuard = vi.fn();
const followUpGuard = vi.fn();
const cartGuard = vi.fn();

vi.mock('./orders.router', () => ({
  getOrdersService: () => ({ assertOrderInCompanyScope: ordersGuard }),
  getFollowUpConfigService: () => ({ assertFollowUpOrderInCompanyScope: followUpGuard }),
}));
vi.mock('./cart-orders.router', () => ({
  getCartOrdersService: () => ({ assertCartOrderInScope: cartGuard }),
}));


const ORDER_ID = '00000000-0000-0000-0000-0000000000a1';
const SCOPE = ['00000000-0000-0000-0000-0000000000aa'];

/** What a per-table guard throws when the id isn't in ITS table. */
const notFound = () => {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
};
/** What it throws when the id IS in its table but another company owns it. */
const forbidden = () => {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'This order is not in your company.' });
};

describe('assertOrderIdInAnyTableScope', () => {
  beforeEach(() => {
    ordersGuard.mockReset();
    followUpGuard.mockReset();
    cartGuard.mockReset();
  });

  it('bypasses entirely for an org-wide caller (null scope)', async () => {
    await expect(assertOrderIdInAnyTableScope(ORDER_ID, null)).resolves.toBeUndefined();
    expect(ordersGuard).not.toHaveBeenCalled();
    expect(followUpGuard).not.toHaveBeenCalled();
    expect(cartGuard).not.toHaveBeenCalled();
  });

  it('admits a funnel order and never probes the other tables', async () => {
    ordersGuard.mockResolvedValue(undefined);
    await expect(assertOrderIdInAnyTableScope(ORDER_ID, SCOPE)).resolves.toBeUndefined();
    expect(followUpGuard).not.toHaveBeenCalled();
    expect(cartGuard).not.toHaveBeenCalled();
  });

  // The two cases the single-table guard got wrong.
  it('admits a FOLLOW-UP order the orders table does not hold', async () => {
    ordersGuard.mockImplementation(notFound);
    followUpGuard.mockResolvedValue(undefined);
    await expect(assertOrderIdInAnyTableScope(ORDER_ID, SCOPE)).resolves.toBeUndefined();
    expect(cartGuard).not.toHaveBeenCalled();
  });

  it('admits a CART order the first two tables do not hold', async () => {
    ordersGuard.mockImplementation(notFound);
    followUpGuard.mockImplementation(notFound);
    cartGuard.mockResolvedValue(undefined);
    await expect(assertOrderIdInAnyTableScope(ORDER_ID, SCOPE)).resolves.toBeUndefined();
  });

  // THE case the security argument turns on: one table refuses the id as
  // cross-company while another admits it. This must RESOLVE. It is safe because
  // the three tables' id spaces are disjoint by construction (graduation inserts
  // a fresh UUID and links via `graduatedOrderId` / `sourceCartOrderId`, never
  // reusing the source row's id), and because an admit from any table is itself
  // a complete in-company ownership claim — the guard that admitted checked the
  // same branch predicate as the one that refused.
  it('admits when one table refuses but another affirms ownership', async () => {
    ordersGuard.mockImplementation(forbidden);
    followUpGuard.mockResolvedValue(undefined);
    await expect(assertOrderIdInAnyTableScope(ORDER_ID, SCOPE)).resolves.toBeUndefined();
    expect(cartGuard).not.toHaveBeenCalled();
  });

  it('still refuses an id no table admits', async () => {
    ordersGuard.mockImplementation(notFound);
    followUpGuard.mockImplementation(notFound);
    cartGuard.mockImplementation(notFound);
    await expect(assertOrderIdInAnyTableScope(ORDER_ID, SCOPE)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  // Company isolation must survive the widened lookup: a cart order that EXISTS
  // but belongs to another company is still refused, not admitted by fallthrough.
  it('still refuses a cross-company order held by another company', async () => {
    ordersGuard.mockImplementation(forbidden);
    followUpGuard.mockImplementation(notFound);
    cartGuard.mockImplementation(forbidden);
    await expect(assertOrderIdInAnyTableScope(ORDER_ID, SCOPE)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('keeps denying an unresolved company scope (empty array)', async () => {
    // `[]` means "company selected but scope not yet resolved" — every per-table
    // guard fails closed on it, so the combined guard must too.
    ordersGuard.mockImplementation(forbidden);
    followUpGuard.mockImplementation(forbidden);
    cartGuard.mockImplementation(forbidden);
    await expect(assertOrderIdInAnyTableScope(ORDER_ID, [])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // The invariant that actually makes `[]` deny lives downstream in
    // `isEntityInScope`, so assert we PROBED rather than short-circuiting: the
    // early return must match only null/undefined, never an empty array.
    expect(ordersGuard).toHaveBeenCalledWith(ORDER_ID, []);
  });
});
