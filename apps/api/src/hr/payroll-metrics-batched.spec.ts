/**
 * Unit correctness harness for the batched payroll-preview metrics aggregation.
 *
 * Proves the OR-attribution semantics the batched SQL relies on: an order is
 * credited to a staff when assignedCsId = staff OR mediaBuyerId = staff, and an
 * order naming the SAME staff in BOTH columns is credited ONCE (dedup by order
 * id) — never doubled. `aggregatePayMetrics` is the pure reference for the
 * grouped `COUNT(DISTINCT o.id)` query in `getStaffMetricsBatched`.
 */

import { describe, it, expect } from 'vitest';
import { aggregatePayMetrics, type OrderMetricRow } from './payroll-metrics.service';

const START = new Date('2026-05-01T00:00:00.000Z');
const END = new Date('2026-05-31T23:59:59.999Z');
const IN = new Date('2026-05-15T12:00:00.000Z');
const BEFORE = new Date('2026-04-20T12:00:00.000Z');
const AFTER = new Date('2026-06-05T12:00:00.000Z');

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function order(partial: Partial<OrderMetricRow> & { id: string; status: string }): OrderMetricRow {
  return {
    assignedCsId: null,
    mediaBuyerId: null,
    createdAt: IN,
    deliveredAt: IN,
    ...partial,
  };
}

describe('aggregatePayMetrics — OR attribution without double-count', () => {
  it('credits an order via assignedCsId OR mediaBuyerId, deduping both-columns', () => {
    const orders: OrderMetricRow[] = [
      // A via assignedCsId only (delivered in period).
      order({ id: '1', status: 'DELIVERED', assignedCsId: A }),
      // A via mediaBuyerId only (remitted counts as delivered).
      order({ id: '2', status: 'REMITTED', mediaBuyerId: A }),
      // A in BOTH columns on ONE order — must count ONCE, not twice.
      order({ id: '3', status: 'DELIVERED', assignedCsId: A, mediaBuyerId: A }),
      // A returned (delivered-at in period).
      order({ id: '4', status: 'RETURNED', assignedCsId: A }),
      // B one delivered.
      order({ id: '5', status: 'DELIVERED', assignedCsId: B }),
    ];

    const m = aggregatePayMetrics(orders, [A, B], START, END);
    const a = m.get(A)!;
    // deliveredCount: orders 1,2,3 = 3 (order 3 deduped).
    expect(a.deliveredCount).toBe(3);
    // totalOrders: orders 1,2,3,4 all non-DELETED, created in-period = 4 (3 deduped).
    expect(a.totalOrders).toBe(4);
    // deliveredCohortCount: delivered AND created in-period = orders 1,2,3 = 3.
    expect(a.deliveredCohortCount).toBe(3);
    expect(a.returnedCount).toBe(1);

    const b = m.get(B)!;
    expect(b.deliveredCount).toBe(1);
    expect(b.totalOrders).toBe(1);
    expect(b.returnedCount).toBe(0);
  });

  it('excludes DELETED orders from totalOrders and out-of-window rows', () => {
    const orders: OrderMetricRow[] = [
      order({ id: '1', status: 'DELETED', assignedCsId: A }), // never counted
      order({ id: '2', status: 'DELIVERED', assignedCsId: A, deliveredAt: AFTER }), // delivered out of window
      order({ id: '3', status: 'DELIVERED', assignedCsId: A, createdAt: BEFORE }), // carry-over: delivered in, created before
    ];
    const m = aggregatePayMetrics(orders, [A], START, END);
    const a = m.get(A)!;
    // Order 1 DELETED → excluded everywhere. Order 2: delivered-status but
    // deliveredAt out of window → not deliveredCount; createdAt in-window &
    // non-DELETED → totalOrders; delivered-status & created in-window → cohort.
    // Order 3: deliveredAt in-window (carry-over) → deliveredCount; createdAt
    // before period → NOT in totalOrders or cohort.
    expect(a.deliveredCount).toBe(1); // order 3 only (delivered-at in window)
    expect(a.totalOrders).toBe(1); // order 2 only (created in-window, non-DELETED)
    expect(a.deliveredCohortCount).toBe(1); // order 2 (delivered-status + created in-window)
    expect(a.returnedCount).toBe(0);
  });

  it('seeds zeroed metrics for staff with no matching orders', () => {
    const m = aggregatePayMetrics([], [A, B], START, END);
    expect(m.get(A)).toEqual({ deliveredCount: 0, totalOrders: 0, deliveredCohortCount: 0, returnedCount: 0, qualifyingRevenue: 0 });
    expect(m.get(B)).toEqual({ deliveredCount: 0, totalOrders: 0, deliveredCohortCount: 0, returnedCount: 0, qualifyingRevenue: 0 });
  });

  it('ignores attribution to staff outside the requested set', () => {
    const orders: OrderMetricRow[] = [
      order({ id: '1', status: 'DELIVERED', assignedCsId: A, mediaBuyerId: B }),
    ];
    // Only A requested; B's credit for this shared order must not appear.
    const m = aggregatePayMetrics(orders, [A], START, END);
    expect(m.has(B)).toBe(false);
    expect(m.get(A)!.deliveredCount).toBe(1);
  });
});
