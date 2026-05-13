import { describe, expect, it } from 'vitest';
import { buildOrdersListOpts } from './orders.router';

describe('buildOrdersListOpts', () => {
  it('enables customer_phone list search when user holds canonical orders.view', () => {
    const user = {
      id: 'u1',
      role: 'HEAD_OF_CS',
      permissions: ['orders.view'],
      currentBranchId: 'b1',
    } as any;
    expect(buildOrdersListOpts(user, {})?.searchIncludeCustomerPhone).toBe(true);
  });

  it('enables customer_phone list search when user holds legacy orders.read', () => {
    const user = {
      id: 'u1',
      role: 'HEAD_OF_CS',
      permissions: ['orders.read'],
      currentBranchId: 'b1',
    } as any;
    expect(buildOrdersListOpts(user, {})?.searchIncludeCustomerPhone).toBe(true);
  });

  it('does not set searchIncludeCustomerPhone without orders view capability', () => {
    const user = {
      id: 'u1',
      role: 'LOGISTICS',
      permissions: ['logistics.overview.view'],
      currentBranchId: 'b1',
    } as any;
    expect(buildOrdersListOpts(user, {})?.searchIncludeCustomerPhone).toBeUndefined();
  });
});
