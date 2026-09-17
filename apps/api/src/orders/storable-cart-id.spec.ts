/**
 * `orders.cart_id` must never be able to destroy an order.
 *
 * PILLAR 1 regression. The column has an FK to `cart_abandonments(id)` and
 * exists only so HoCS can filter "Recovered from cart". The insert passed the
 * incoming id straight through, so an id with no cart row raised
 * `orders_cart_id_fkey` and the WHOLE order was rejected — on the public
 * edge-form intake path, for a purely cosmetic tag.
 *
 * It is reachable on the happy path: carts upsert on (campaign_id, phone_hash)
 * with a server-generated id, and the worker's `/cart` returns
 * `{ buffered: true }` with NO id when the API is briefly 5xx, so the row lands
 * via QStash later. A form session that already captured an id keeps it, and
 * the order can arrive referencing a row that is still queued.
 *
 * These tests drive the real `resolveStorableCartId` against a stubbed db, so
 * they pin the behaviour without standing up the whole Nest graph.
 */
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

type CartRow = { id: string };

/** Minimal stand-in for the drizzle select chain the helper uses. */
function dbReturning(rows: CartRow[] | (() => never)) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (typeof rows === 'function') rows();
            return rows;
          },
        }),
      }),
    }),
  };
}

/**
 * Build just enough of the service to call the private helper. Constructing
 * OrdersService for real would drag in ~20 injected deps; the helper only
 * touches `this.db` and `this.logger`.
 */
interface HelperHarness {
  db: unknown;
  logger: { warn: ReturnType<typeof vi.fn> };
  resolveStorableCartId: (id: string | null | undefined) => Promise<string | null>;
}

function serviceWith(db: unknown): HelperHarness {
  // `resolveStorableCartId` is private, so intersecting the class type with it
  // collapses to `never`. Go through `unknown` and describe only the three
  // members the helper actually touches.
  const svc = Object.create(OrdersService.prototype) as unknown as HelperHarness;
  svc.db = db;
  svc.logger = { warn: vi.fn() };
  return svc;
}

const CART_ID = '0192f8c4-1111-7000-8000-000000000001';

describe('resolveStorableCartId', () => {
  it('keeps the id when the cart row exists', async () => {
    const svc = serviceWith(dbReturning([{ id: CART_ID }]));
    await expect(svc.resolveStorableCartId(CART_ID)).resolves.toBe(CART_ID);
  });

  // The prod failure: cart save was buffered to QStash, row not inserted yet.
  it('drops the id when the cart row is missing, so the order survives', async () => {
    const svc = serviceWith(dbReturning([]));
    await expect(svc.resolveStorableCartId(CART_ID)).resolves.toBeNull();
  });

  it('warns when it drops an id, so the race is visible in logs', async () => {
    const svc = serviceWith(dbReturning([]));
    await svc.resolveStorableCartId(CART_ID);
    expect(svc.logger.warn).toHaveBeenCalledWith(expect.stringContaining(CART_ID));
  });

  // Degrade to an untagged order, never a lost one.
  it('drops the id when the lookup itself throws', async () => {
    const svc = serviceWith(
      dbReturning(() => {
        throw new Error('connection reset');
      }),
    );
    await expect(svc.resolveStorableCartId(CART_ID)).resolves.toBeNull();
  });

  it.each<[string | null | undefined, string]>([
    [null, 'null'],
    [undefined, 'undefined'],
    ['', 'empty string'],
  ])('returns null for %s (%s) without querying', async (input, _label) => {
    const select = vi.fn();
    const svc = serviceWith({ select });
    await expect(svc.resolveStorableCartId(input)).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });
});
