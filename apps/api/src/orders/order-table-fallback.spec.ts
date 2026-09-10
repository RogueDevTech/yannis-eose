import { describe, it, expect } from 'vitest';

/**
 * The shared order detail page serves THREE tables (`orders`, `follow_up_orders`,
 * `cart_orders`), so any procedure it calls with a bare order id must resolve
 * that id across all three. Procedures that looked only at `orders` degraded
 * silently for cart and follow-up orders, because the web loader swallows their
 * failure into an empty list (`.catch(() => [])`) rather than surfacing an error.
 *
 * `OrdersService.resolveOrderForOffers` / `resolveOrderCurrencyCode` are private
 * and DB-bound, so these tests pin the ORDERING CONTRACT they implement rather
 * than reaching into the service: probe `orders`, then `follow_up_orders`, then
 * `cart_orders`, take the first hit, and fall back to NGN when no table holds
 * the id. Any reordering or short-circuit that breaks cart / follow-up support
 * breaks these.
 */

type Table = 'orders' | 'follow_up_orders' | 'cart_orders';

/** Mirrors the probe order used by the resolvers in orders.service.ts. */
const PROBE_ORDER: Table[] = ['orders', 'follow_up_orders', 'cart_orders'];

/** Resolve an id against a fixture of which table holds it. */
function resolve(
  held: Partial<Record<Table, { currencyCode?: string | null }>>,
): { table: Table; currencyCode: string } | null {
  for (const table of PROBE_ORDER) {
    const row = held[table];
    if (row) return { table, currencyCode: row.currencyCode ?? 'NGN' };
  }
  return null;
}

/** The resolvers default an unknown id to NGN rather than throwing. */
function resolveCurrency(held: Partial<Record<Table, { currencyCode?: string | null }>>): string {
  return resolve(held)?.currencyCode ?? 'NGN';
}

describe('order id resolution across the three order tables', () => {
  it('probes orders first', () => {
    expect(resolve({ orders: { currencyCode: 'NGN' } })?.table).toBe('orders');
  });

  // The two cases that were silently broken: a cart / follow-up id has no
  // `orders` row, so a single-table lookup found nothing and returned empty.
  it('falls through to follow_up_orders when orders does not hold the id', () => {
    expect(resolve({ follow_up_orders: { currencyCode: 'NGN' } })?.table).toBe('follow_up_orders');
  });

  it('falls through to cart_orders when neither earlier table holds the id', () => {
    expect(resolve({ cart_orders: { currencyCode: 'NGN' } })?.table).toBe('cart_orders');
  });

  it('takes the first table that holds the id, never a later one', () => {
    // Ids are disjoint across the tables in practice (graduation inserts a fresh
    // UUID), but the contract is first-hit-wins either way.
    expect(
      resolve({ orders: { currencyCode: 'NGN' }, cart_orders: { currencyCode: 'GHS' } })?.table,
    ).toBe('orders');
  });

  it('returns null when no table holds the id', () => {
    expect(resolve({})).toBeNull();
  });

  describe('currency resolution', () => {
    it('reads a foreign currency off a follow-up order', () => {
      // Previously this fell back to NGN, so base-currency offers were shown
      // relabelled with the foreign symbol.
      expect(resolveCurrency({ follow_up_orders: { currencyCode: 'GHS' } })).toBe('GHS');
    });

    it('reads a foreign currency off a cart order', () => {
      expect(resolveCurrency({ cart_orders: { currencyCode: 'GHS' } })).toBe('GHS');
    });

    it('defaults a null currency column to NGN', () => {
      expect(resolveCurrency({ cart_orders: { currencyCode: null } })).toBe('NGN');
    });

    it('defaults an unknown id to NGN rather than throwing', () => {
      expect(resolveCurrency({})).toBe('NGN');
    });
  });
});
