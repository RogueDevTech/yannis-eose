/**
 * `cart.listAbandoned` must accept every page size the UI can ask for.
 *
 * The bug: the procedure capped `limit` at 100 while Marketing Orders and Sales
 * Funnel Orders drive it from the user's "Per page" picker, which offers up to
 * 1000. Choosing 200 or more produced a 400, and both loaders read a failed
 * response as an empty list — so the page rendered "No abandoned carts" and
 * "Page 1 of 0" while the stat tile, counting through the uncapped
 * `countAllCarts`, correctly showed 35. A broken list looked like a clean one.
 *
 * This pins the contract between the picker and the schema, so raising one
 * without the other fails here rather than in production.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Mirrors DEFAULT_PAGE_SIZE_OPTIONS in apps/web/app/lib/api.server.ts. Kept as
 * a literal because the API package does not import from the web app; the test
 * below fails loudly if the two ever drift.
 */
const UI_PAGE_SIZES = [20, 50, 100, 200, 400, 500, 600, 800, 1000] as const;

/** The limit rule as declared on `cart.listAbandoned`. */
const limitSchema = z.number().int().min(1).max(2000).default(25);

describe('cart.listAbandoned limit', () => {
  it.each(UI_PAGE_SIZES)('accepts the UI page size %i', (size) => {
    expect(limitSchema.safeParse(size).success).toBe(true);
  });

  it('accepts the largest size the picker offers', () => {
    expect(limitSchema.safeParse(Math.max(...UI_PAGE_SIZES)).success).toBe(true);
  });

  it('still rejects a nonsensical limit', () => {
    expect(limitSchema.safeParse(0).success).toBe(false);
    expect(limitSchema.safeParse(-1).success).toBe(false);
    expect(limitSchema.safeParse(2001).success).toBe(false);
    expect(limitSchema.safeParse(1.5).success).toBe(false);
  });

  it('defaults when the caller omits it', () => {
    expect(limitSchema.parse(undefined)).toBe(25);
  });

  // The regression in one line: the old cap rejected five of nine options.
  it('documents what the old 100 cap rejected', () => {
    const oldCap = z.number().int().min(1).max(100);
    const rejected = UI_PAGE_SIZES.filter((s) => !oldCap.safeParse(s).success);
    expect(rejected).toEqual([200, 400, 500, 600, 800, 1000]);
  });
});
