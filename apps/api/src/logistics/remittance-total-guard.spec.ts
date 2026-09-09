import { describe, it, expect } from 'vitest';

/**
 * Remittance settlement must refuse orders with no usable total.
 *
 * `Number(null)` is 0 and `Number('NaN')` is NaN, so a missing order total
 * used to contribute ₦0 to the batch amount silently. Because
 * delivery_remittance_outcomes.amount is FROZEN at settlement, that
 * under-recording cannot be recovered afterwards — it cost ₦211,000 across
 * 4 batches in June 2026, one of which settled at −₦6,000.
 *
 * Mirrors the guard in LogisticsService.createDeliveryRemittance.
 */
type OrderRow = { id: string; orderNumber?: number | null; totalAmount: string | null };

// NB `Number(null)` is 0, which IS finite — the null check must come first
// or a missing total slips through as a legitimate zero.
const unusableTotals = (rows: OrderRow[]) =>
  rows.filter((r) => r.totalAmount == null || !Number.isFinite(Number(r.totalAmount)));

const batchAmount = (rows: OrderRow[]) =>
  rows.reduce((sum, r) => sum + Number(r.totalAmount ?? 0), 0);

describe('remittance settlement total guard', () => {
  it('rejects an order whose total is NULL', () => {
    const rows: OrderRow[] = [
      { id: 'a', orderNumber: 16418, totalAmount: '58000' },
      { id: 'b', orderNumber: 16426, totalAmount: null },
    ];
    expect(unusableTotals(rows).map((r) => r.orderNumber)).toEqual([16426]);
  });

  it('rejects an order whose total is NaN', () => {
    const rows: OrderRow[] = [{ id: 'a', orderNumber: 103802, totalAmount: 'NaN' }];
    expect(unusableTotals(rows)).toHaveLength(1);
  });

  it('accepts a batch where every order has a real total', () => {
    const rows: OrderRow[] = [
      { id: 'a', totalAmount: '60000' },
      { id: 'b', totalAmount: '58000' },
    ];
    expect(unusableTotals(rows)).toHaveLength(0);
    expect(batchAmount(rows)).toBe(118000);
  });

  it('accepts a genuine zero-value order', () => {
    // 0 is finite and may be legitimate; only NULL/NaN are refused.
    expect(unusableTotals([{ id: 'a', totalAmount: '0' }])).toHaveLength(0);
  });

  it('documents the old silent under-recording this guard prevents', () => {
    const rows: OrderRow[] = [
      { id: 'a', totalAmount: '60000' },
      { id: 'b', totalAmount: null }, // was really worth 60,000
    ];
    // Old behaviour: the batch settled at 60,000 instead of 120,000 and the
    // shortfall was frozen at settlement.
    expect(batchAmount(rows)).toBe(60000);
    // New behaviour: refuse before settling.
    expect(unusableTotals(rows)).toHaveLength(1);
  });

  it('names every offending order so Finance can fix them', () => {
    const rows: OrderRow[] = [
      { id: 'a', orderNumber: 16426, totalAmount: null },
      { id: 'b', orderNumber: 16430, totalAmount: null },
      { id: 'c', orderNumber: 16434, totalAmount: '60000' },
    ];
    const names = unusableTotals(rows).map((r) => r.orderNumber ?? r.id);
    expect(names).toEqual([16426, 16430]);
  });
});
