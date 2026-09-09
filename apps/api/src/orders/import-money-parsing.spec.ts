import { describe, it, expect } from 'vitest';

/**
 * Money-cell parsing in the bulk importer.
 *
 * `Number('abc')` is NaN, and NaN is a VALID value for a Postgres numeric
 * column — it inserts silently, then poisons every SUM() it reaches, because
 * SUM over a set containing NaN returns NaN rather than a skewed number. That
 * broke delivered-revenue reporting for whole months on prod (11 orders, all
 * order_source='import'). These pin the finite-number guard.
 *
 * Mirrors the parsing in BulkImportService.mapRow.
 */
function parseMoneyCells(
  raw: { totalAmount?: string; unitPrice?: string },
  config: { defaultUnitPrice?: number } = {},
) {
  const warnings: Array<{ field: string; code: string }> = [];

  const totalParsed =
    raw.totalAmount != null && raw.totalAmount !== '' ? Number(raw.totalAmount) : undefined;
  const totalAmount =
    totalParsed != null && Number.isFinite(totalParsed) ? totalParsed : undefined;
  if (totalParsed != null && !Number.isFinite(totalParsed)) {
    warnings.push({ field: 'totalAmount', code: String(raw.totalAmount) });
  }

  const unitParsed =
    raw.unitPrice != null && raw.unitPrice !== '' ? Number(raw.unitPrice) : undefined;
  let unitPrice: number;
  if (unitParsed != null && Number.isFinite(unitParsed)) {
    unitPrice = unitParsed;
  } else if (unitParsed != null && !Number.isFinite(unitParsed)) {
    warnings.push({ field: 'unitPrice', code: String(raw.unitPrice) });
    unitPrice = totalAmount ?? config.defaultUnitPrice ?? 0;
  } else if (totalAmount != null) {
    unitPrice = totalAmount;
  } else {
    unitPrice = config.defaultUnitPrice ?? 0;
  }

  return { totalAmount, unitPrice, warnings };
}

describe('bulk import money parsing', () => {
  it('never yields NaN for an unparseable total', () => {
    const r = parseMoneyCells({ totalAmount: 'N/A' });
    expect(r.totalAmount).toBeUndefined();
    expect(Number.isNaN(r.totalAmount as number)).toBe(false);
  });

  it('warns which cell was unreadable instead of failing silently', () => {
    const r = parseMoneyCells({ totalAmount: 'abc' });
    expect(r.warnings).toEqual([{ field: 'totalAmount', code: 'abc' }]);
  });

  it('never yields NaN for an unparseable unit price', () => {
    const r = parseMoneyCells({ unitPrice: '--' }, { defaultUnitPrice: 500 });
    expect(Number.isNaN(r.unitPrice)).toBe(false);
    expect(r.unitPrice).toBe(500);
    expect(r.warnings).toEqual([{ field: 'unitPrice', code: '--' }]);
  });

  it('falls back to the order total when the unit price cell is junk', () => {
    const r = parseMoneyCells({ totalAmount: '60000', unitPrice: 'oops' });
    expect(r.unitPrice).toBe(60000);
  });

  it('still parses normal values', () => {
    const r = parseMoneyCells({ totalAmount: '120000' });
    expect(r.totalAmount).toBe(120000);
    expect(r.unitPrice).toBe(120000);
    expect(r.warnings).toEqual([]);
  });

  it('treats a blank cell as absent, not as a warning', () => {
    const r = parseMoneyCells({ totalAmount: '', unitPrice: '' }, { defaultUnitPrice: 0 });
    expect(r.totalAmount).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('a NaN total does not survive into a SUM', () => {
    // The actual prod failure: one NaN row turned an entire month's
    // revenue into NaN rather than a merely-wrong number.
    const rows = [parseMoneyCells({ totalAmount: '60000' }), parseMoneyCells({ totalAmount: 'x' })];
    const sum = rows.reduce((acc, r) => acc + (r.totalAmount ?? 0), 0);
    expect(sum).toBe(60000);
    expect(Number.isNaN(sum)).toBe(false);
  });
});

/**
 * Cart-graduation invoice totals. `unitPrice` IS the offer/line total, so
 * multiplying by quantity billed a "BUY 2 GET 1 FREE" line (qty 3 @ 120,000)
 * as 360,000. Overstated 7 prod invoices by 1,497,000 before the fix.
 */
describe('graduated cart invoice total', () => {
  const invoiceTotal = (items: Array<{ unitPrice: string; quantity: number }>) =>
    items.reduce((sum, it) => sum + Number(it.unitPrice), 0);

  it('sums the offer price without multiplying by quantity', () => {
    expect(invoiceTotal([{ unitPrice: '120000', quantity: 3 }])).toBe(120000);
  });

  it('sums across multiple offer lines', () => {
    expect(
      invoiceTotal([
        { unitPrice: '120000', quantity: 3 },
        { unitPrice: '58000', quantity: 2 },
      ]),
    ).toBe(178000);
  });

  it('is unchanged for the common quantity-1 case', () => {
    expect(invoiceTotal([{ unitPrice: '60000', quantity: 1 }])).toBe(60000);
  });
});
