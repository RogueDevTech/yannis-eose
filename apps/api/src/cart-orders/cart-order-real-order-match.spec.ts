import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { cartRealOrderMatchesQuery, OWN_ORDER_MATCH_TYPES } from './cart-order-real-order-match';

const text = (q: ReturnType<typeof cartRealOrderMatchesQuery>) => new PgDialect().sqlToQuery(q).sql;

describe('cartRealOrderMatchesQuery', () => {
  it('includes the SAME_PRODUCT duplicate-rule match by default', () => {
    expect(text(cartRealOrderMatchesQuery(sql`true`))).toContain("'SAME_PRODUCT'");
  });

  it('ownOrderOnly leaves out SAME_PRODUCT but keeps the cart-own matches', () => {
    const q = text(cartRealOrderMatchesQuery(sql`true`, { ownOrderOnly: true }));
    expect(q).not.toContain("'SAME_PRODUCT'");
    for (const t of OWN_ORDER_MATCH_TYPES) expect(q).toContain(`'${t}'`);
  });

  it('own-order types are exactly the always-on ones', () => {
    expect([...OWN_ORDER_MATCH_TYPES].sort()).toEqual(['CART_CONVERTED', 'CART_LINK', 'SAME_SESSION']);
  });
});
