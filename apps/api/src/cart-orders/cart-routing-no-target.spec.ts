import { describe, expect, it } from 'vitest';
import { noTargetServicingBranch } from './cart-routing-no-target';

const NIGERIA = 'b-nigeria';
const GHANA = 'b-ghana';
const KENYA = 'b-kenya';
const ALL = [GHANA, KENYA, NIGERIA];

describe('noTargetServicingBranch', () => {
  it('keeps the cart on its own form branch whatever the round-robin offset', () => {
    for (let offset = 0; offset < 10; offset++) {
      expect(noTargetServicingBranch(NIGERIA, ALL, offset)).toBe(NIGERIA);
    }
  });

  it('falls back to round-robin only when the form branch has no active CS', () => {
    expect(noTargetServicingBranch('b-marketing-only', ALL, 0)).toBe(GHANA);
    expect(noTargetServicingBranch('b-marketing-only', ALL, 4)).toBe(KENYA);
    expect(noTargetServicingBranch(null, ALL, 2)).toBe(NIGERIA);
  });

  it('returns null when the company has no active CS branch', () => {
    expect(noTargetServicingBranch(NIGERIA, [], 0)).toBeNull();
  });
});
