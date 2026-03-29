import { describe, it, expect } from 'vitest';
import { hasFinanceAccess, stripFinanceFields } from './strip-finance-fields';

// ---------------------------------------------------------------------------
// hasFinanceAccess
// ---------------------------------------------------------------------------

describe('hasFinanceAccess', () => {
  it('grants access to SUPER_ADMIN', () => {
    expect(hasFinanceAccess({ role: 'SUPER_ADMIN' })).toBe(true);
  });

  it('grants access to FINANCE_OFFICER', () => {
    expect(hasFinanceAccess({ role: 'FINANCE_OFFICER' })).toBe(true);
  });

  it('grants access to user with finance.costView permission', () => {
    expect(hasFinanceAccess({ role: 'CS_AGENT', permissions: ['finance.costView'] })).toBe(true);
  });

  it('denies access to CS_AGENT without permission', () => {
    expect(hasFinanceAccess({ role: 'CS_AGENT' })).toBe(false);
  });

  it('denies access to MEDIA_BUYER without permission', () => {
    expect(hasFinanceAccess({ role: 'MEDIA_BUYER' })).toBe(false);
  });

  it('denies access to HEAD_OF_MARKETING without permission', () => {
    expect(hasFinanceAccess({ role: 'HEAD_OF_MARKETING' })).toBe(false);
  });

  it('denies access to TPL_RIDER without permission', () => {
    expect(hasFinanceAccess({ role: 'TPL_RIDER' })).toBe(false);
  });

  it('denies access even with unrelated permissions', () => {
    expect(hasFinanceAccess({ role: 'CS_AGENT', permissions: ['orders.view', 'cs.assign'] })).toBe(false);
  });

  it('grants access to non-elevated role if permissions array includes finance.costView', () => {
    expect(hasFinanceAccess({ role: 'HR_MANAGER', permissions: ['finance.costView'] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stripFinanceFields — flat objects
// ---------------------------------------------------------------------------

describe('stripFinanceFields — flat object', () => {
  it('nullifies costPrice on a flat object', () => {
    const result = stripFinanceFields({ id: '123', name: 'Widget', costPrice: 5000 });
    expect(result.costPrice).toBeNull();
  });

  it('nullifies all sensitive fields in one pass', () => {
    const input = {
      id: '123',
      name: 'Widget',
      costPrice: 5000,
      factoryCost: 4000,
      landingCost: 500,
      totalLandedCost: 4500,
      landedCost: 4500,
      margin: 0.45,
      internalFulfillmentCost: 200,
    };
    const result = stripFinanceFields(input);
    expect(result.costPrice).toBeNull();
    expect(result.factoryCost).toBeNull();
    expect(result.landingCost).toBeNull();
    expect(result.totalLandedCost).toBeNull();
    expect(result.landedCost).toBeNull();
    expect(result.margin).toBeNull();
    expect(result.internalFulfillmentCost).toBeNull();
  });

  it('leaves non-sensitive sibling fields untouched', () => {
    const input = { id: 'abc', name: 'Product', sellingPrice: 10000, costPrice: 5000 };
    const result = stripFinanceFields(input);
    expect(result.id).toBe('abc');
    expect(result.name).toBe('Product');
    expect(result.sellingPrice).toBe(10000);
    expect(result.costPrice).toBeNull();
  });

  it('handles snake_case variants', () => {
    const input = { cost_price: 5000, factory_cost: 4000, landing_cost: 500, total_landed_cost: 4500, landed_cost: 4500, internal_fulfillment_cost: 200 };
    const result = stripFinanceFields(input);
    expect(result.cost_price).toBeNull();
    expect(result.factory_cost).toBeNull();
    expect(result.landing_cost).toBeNull();
    expect(result.total_landed_cost).toBeNull();
    expect(result.landed_cost).toBeNull();
    expect(result.internal_fulfillment_cost).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stripFinanceFields — nested objects
// ---------------------------------------------------------------------------

describe('stripFinanceFields — nested objects', () => {
  it('recurses into nested objects', () => {
    const input = {
      order: {
        id: 'ord-1',
        product: {
          name: 'Widget',
          costPrice: 5000,
          sellingPrice: 10000,
        },
      },
    };
    const result = stripFinanceFields(input);
    expect(result.order.product.costPrice).toBeNull();
    expect(result.order.product.name).toBe('Widget');
    expect(result.order.product.sellingPrice).toBe(10000);
  });

  it('recurses into arrays', () => {
    const input = [
      { id: '1', costPrice: 5000, name: 'A' },
      { id: '2', costPrice: 6000, name: 'B' },
    ];
    const result = stripFinanceFields(input);
    expect(result[0]!.costPrice).toBeNull();
    expect(result[1]!.costPrice).toBeNull();
    expect(result[0]!.name).toBe('A');
    expect(result[1]!.name).toBe('B');
  });

  it('handles arrays nested inside objects', () => {
    const input = {
      items: [
        { productId: 'p1', quantity: 2, costPrice: 5000 },
        { productId: 'p2', quantity: 1, costPrice: 3000 },
      ],
      totalAmount: 20000,
    };
    const result = stripFinanceFields(input);
    expect(result.items[0]!.costPrice).toBeNull();
    expect(result.items[1]!.costPrice).toBeNull();
    expect(result.items[0]!.quantity).toBe(2);
    expect(result.totalAmount).toBe(20000);
  });
});

// ---------------------------------------------------------------------------
// stripFinanceFields — edge cases
// ---------------------------------------------------------------------------

describe('stripFinanceFields — edge cases', () => {
  it('returns null as-is', () => {
    expect(stripFinanceFields(null)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(stripFinanceFields(undefined)).toBeUndefined();
  });

  it('returns primitive strings as-is', () => {
    expect(stripFinanceFields('hello')).toBe('hello');
  });

  it('returns primitive numbers as-is', () => {
    expect(stripFinanceFields(42)).toBe(42);
  });

  it('does not mutate the original object', () => {
    const original = { costPrice: 5000, name: 'Widget' };
    const result = stripFinanceFields(original);
    expect(original.costPrice).toBe(5000); // unchanged
    expect(result.costPrice).toBeNull();
  });

  it('handles Date instances without stripping', () => {
    const date = new Date('2026-01-01');
    const input = { createdAt: date, costPrice: 5000 };
    const result = stripFinanceFields(input);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.costPrice).toBeNull();
  });
});
