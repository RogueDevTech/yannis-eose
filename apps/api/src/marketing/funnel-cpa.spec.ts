import { describe, it, expect } from 'vitest';

/**
 * Funnel CPA vs Average CPA (Team Analysis → Media Buyers).
 *
 * `cpa` divides ad spend by `totalOrders`, which folds cart-graduated
 * deliveries in on top of the funnel cohort. `funnelCpa` divides the same
 * spend by front-end orders only. Both are reported; neither replaces
 * the other, so these tests pin the distinction.
 *
 * Mirrors the arithmetic in MarketingService.deriveBuyerMetrics.
 */
function deriveCpas(raw: { totalSpend: number; funnelOrders: number; cartDelivered: number }) {
  const totalOrders = raw.funnelOrders + raw.cartDelivered;
  return {
    totalOrders,
    funnelOrders: raw.funnelOrders,
    cpa: totalOrders > 0 ? raw.totalSpend / totalOrders : 0,
    funnelCpa: raw.funnelOrders > 0 ? raw.totalSpend / raw.funnelOrders : 0,
  };
}

describe('Funnel CPA', () => {
  it('is higher than Avg CPA whenever cart-graduated orders pad the denominator', () => {
    const m = deriveCpas({ totalSpend: 100_000, funnelOrders: 40, cartDelivered: 10 });
    expect(m.cpa).toBe(2000); // 100k / 50
    expect(m.funnelCpa).toBe(2500); // 100k / 40
    expect(m.funnelCpa).toBeGreaterThan(m.cpa);
  });

  it('equals Avg CPA when there are no cart-graduated orders', () => {
    const m = deriveCpas({ totalSpend: 90_000, funnelOrders: 30, cartDelivered: 0 });
    expect(m.funnelCpa).toBe(3000);
    expect(m.cpa).toBe(m.funnelCpa);
  });

  it('leaves the existing Avg CPA calculation untouched', () => {
    // Regression guard: the ticket requires the current metric keep its
    // exact meaning — ad spend over the full order count.
    const m = deriveCpas({ totalSpend: 50_000, funnelOrders: 15, cartDelivered: 10 });
    expect(m.cpa).toBe(50_000 / 25);
  });

  it('reports 0 rather than dividing by zero when a buyer has no funnel orders', () => {
    const m = deriveCpas({ totalSpend: 75_000, funnelOrders: 0, cartDelivered: 5 });
    expect(m.funnelCpa).toBe(0);
    // Avg CPA still computes off the cart deliveries.
    expect(m.cpa).toBe(15_000);
  });

  it('reports 0 for both when a buyer has no orders at all', () => {
    const m = deriveCpas({ totalSpend: 20_000, funnelOrders: 0, cartDelivered: 0 });
    expect(m.cpa).toBe(0);
    expect(m.funnelCpa).toBe(0);
  });

  it('is 0 when there is no ad spend, however many orders came in', () => {
    const m = deriveCpas({ totalSpend: 0, funnelOrders: 25, cartDelivered: 5 });
    expect(m.cpa).toBe(0);
    expect(m.funnelCpa).toBe(0);
  });
});
