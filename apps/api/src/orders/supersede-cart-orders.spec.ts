import { describe, expect, it } from 'vitest';
import { partitionCartOrdersForNewFormOrder } from './orders.service';

// 2026-11-04: a form order used to delete the customer's cart order at ANY
// stage (CO-146896 was delivered, then deleted by YNS-147334).
describe('partitionCartOrdersForNewFormOrder', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 3, h));

  it('only uncalled cart orders are replaced (deleted)', () => {
    const { unworked } = partitionCartOrdersForNewFormOrder([
      { id: 'a', status: 'UNPROCESSED', createdAt: at(1) },
      { id: 'b', status: 'CS_ASSIGNED', createdAt: at(2) },
      { id: 'c', status: 'CS_ENGAGED', createdAt: at(3) },
    ]);
    expect(unworked.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('called, confirmed, delivered and remitted cart orders are never deleted', () => {
    const rows = ['CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED']
      .map((status, i) => ({ id: status, status, createdAt: at(i) }));
    const { unworked, worked } = partitionCartOrdersForNewFormOrder(rows);
    expect(unworked).toEqual([]);
    expect(worked).toHaveLength(rows.length);
  });

  it('the newest worked cart order is the one the new order is checked against', () => {
    const { worked } = partitionCartOrdersForNewFormOrder([
      { id: 'old', status: 'DELIVERED', createdAt: at(1) },
      { id: 'new', status: 'CONFIRMED', createdAt: at(9) },
    ]);
    expect(worked[0]!.id).toBe('new');
  });

  it('no cart orders: nothing deleted, nothing flagged', () => {
    expect(partitionCartOrdersForNewFormOrder([])).toEqual({ unworked: [], worked: [] });
  });
});
