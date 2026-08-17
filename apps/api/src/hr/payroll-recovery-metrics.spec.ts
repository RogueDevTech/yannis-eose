/**
 * Correctness harness for the RECOVERY_COMBINED delivered-metric rule used by the
 * "Customer Support – Follow-up on Delivered Orders" pay category.
 *
 * The invariant that matters most (and is easy to get wrong): a follow_up_orders
 * row that reaches DELIVERED graduates into an `orders` row flagged
 * is_delivered_follow_up = true — the SAME physical delivery in two tables. So
 * the recovery count sums:
 *   - orders WHERE is_delivered_follow_up = true   (already includes graduated
 *     follow-ups + CS-created delivered follow-ups)
 *   - cart_orders                                  (graduated as order_source
 *     'online', NOT flagged — no overlap)
 * and DELIBERATELY excludes the follow_up_orders table, so no delivery is paid
 * twice. `aggregateRecoveryCombinedMetrics` is the pure reference for the SQL in
 * `getRecoveryCombinedStaffMetrics`.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateRecoveryCombinedMetrics,
  type RecoveryMetricRow,
} from './payroll-metrics.service';

const START = new Date('2026-05-01T00:00:00.000Z');
const END = new Date('2026-05-31T23:59:59.999Z');
const IN = new Date('2026-05-15T12:00:00.000Z');
const BEFORE = new Date('2026-04-20T12:00:00.000Z');
const AFTER = new Date('2026-06-05T12:00:00.000Z');

const CS = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function row(partial: Partial<RecoveryMetricRow> & { id: string; status: string }): RecoveryMetricRow {
  return {
    assignedCsId: null,
    mediaBuyerId: null,
    createdAt: IN,
    deliveredAt: IN,
    ...partial,
  };
}

describe('aggregateRecoveryCombinedMetrics — recovery delivered count', () => {
  it('sums orders(is_delivered_follow_up) + cart_orders, NOT follow_up_orders', () => {
    const orders: RecoveryMetricRow[] = [
      // delivered follow-up (graduated OR CS-created) attributed to CS → counts.
      row({ id: 'o1', status: 'DELIVERED', assignedCsId: CS, isDeliveredFollowUp: true }),
      // a normal funnel order (not flagged) → must NOT count for recovery.
      row({ id: 'o2', status: 'DELIVERED', assignedCsId: CS, isDeliveredFollowUp: false }),
    ];
    const cartOrders: RecoveryMetricRow[] = [
      row({ id: 'c1', status: 'REMITTED', mediaBuyerId: CS }),
    ];
    // The follow_up_orders row is the SOURCE of o1's graduation. If we summed it,
    // o1's delivery would be double-counted. It must be ignored.
    const followUpOrders: RecoveryMetricRow[] = [
      row({ id: 'f1', status: 'DELIVERED', assignedCsId: CS }),
    ];

    const m = aggregateRecoveryCombinedMetrics(
      { orders, cartOrders, followUpOrders },
      CS,
      START,
      END,
    );
    // o1 (delivered-follow-up) + c1 (cart) = 2. o2 excluded (not flagged), f1
    // excluded (follow_up_orders table not summed).
    expect(m.deliveredCount).toBe(2);
    expect(m.deliveredCohortCount).toBe(2);
    // totalOrders: o1 + c1 (both created in-window, non-DELETED). o2 excluded.
    expect(m.totalOrders).toBe(2);
  });

  it('does not double-count when follow_up_orders is passed alongside its graduated copy', () => {
    // Same delivery in two tables: a follow_up_orders row (f1) and its graduated
    // orders copy (o1, flagged). Passing both must still count exactly once.
    const orders = [row({ id: 'o1', status: 'DELIVERED', assignedCsId: CS, isDeliveredFollowUp: true })];
    const followUpOrders = [row({ id: 'f1', status: 'DELIVERED', assignedCsId: CS })];

    const m = aggregateRecoveryCombinedMetrics(
      { orders, cartOrders: [], followUpOrders },
      CS,
      START,
      END,
    );
    expect(m.deliveredCount).toBe(1);
  });

  it('respects attribution (assignedCsId OR mediaBuyerId) and ignores others', () => {
    const orders = [
      row({ id: 'o1', status: 'DELIVERED', assignedCsId: OTHER, isDeliveredFollowUp: true }),
      row({ id: 'o2', status: 'DELIVERED', mediaBuyerId: CS, isDeliveredFollowUp: true }),
    ];
    const cartOrders = [row({ id: 'c1', status: 'DELIVERED', assignedCsId: OTHER })];

    const m = aggregateRecoveryCombinedMetrics({ orders, cartOrders }, CS, START, END);
    // Only o2 is attributed to CS.
    expect(m.deliveredCount).toBe(1);
  });

  it('applies the same window + status + carry-over rules as the funnel path', () => {
    const orders: RecoveryMetricRow[] = [
      // delivered out of window → not deliveredCount; created in-window → total + cohort.
      row({ id: 'o1', status: 'DELIVERED', assignedCsId: CS, isDeliveredFollowUp: true, deliveredAt: AFTER }),
      // carry-over: delivered in-window, created before → deliveredCount only.
      row({ id: 'o2', status: 'DELIVERED', assignedCsId: CS, isDeliveredFollowUp: true, createdAt: BEFORE }),
      // returned in-window → returnedCount.
      row({ id: 'o3', status: 'RETURNED', assignedCsId: CS, isDeliveredFollowUp: true }),
      // DELETED → excluded everywhere.
      row({ id: 'o4', status: 'DELETED', assignedCsId: CS, isDeliveredFollowUp: true }),
    ];
    const cartOrders: RecoveryMetricRow[] = [
      row({ id: 'c1', status: 'DELIVERED', assignedCsId: CS }),
    ];

    const m = aggregateRecoveryCombinedMetrics({ orders, cartOrders }, CS, START, END);
    // deliveredCount: o2 (carry-over) + c1 = 2. o1 delivered out of window.
    expect(m.deliveredCount).toBe(2);
    // totalOrders: o1 (created in-window) + c1 = 2. o2 created before, o3 returned
    // but created in-window counts, o4 DELETED excluded. → o1 + o3 + c1 = 3.
    expect(m.totalOrders).toBe(3);
    // deliveredCohortCount: delivered-status AND created in-window → o1 + c1 = 2.
    expect(m.deliveredCohortCount).toBe(2);
    expect(m.returnedCount).toBe(1);
  });

  it('returns zeros when nothing is attributed', () => {
    const m = aggregateRecoveryCombinedMetrics({ orders: [], cartOrders: [] }, CS, START, END);
    expect(m).toEqual({ deliveredCount: 0, totalOrders: 0, deliveredCohortCount: 0, returnedCount: 0, qualifyingRevenue: 0 });
  });
});
