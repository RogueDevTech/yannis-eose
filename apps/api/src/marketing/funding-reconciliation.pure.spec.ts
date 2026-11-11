import { describe, expect, it } from 'vitest';
import {
  allocateFifo,
  applyCloseBaseline,
  bucketsFor,
  computeWindow,
  computeWindowWithClose,
  lagosDayEnd,
  lagosDayStart,
  lagosYmd,
  monthEnd,
  weekStart,
  withRunningBalance,
  type FundingMovement,
  type FundingMovementKind,
} from './funding-reconciliation.pure';

let seq = 0;
function mv(kind: FundingMovementKind, ymd: string, amount: number, extra: Partial<FundingMovement> = {}): FundingMovement {
  seq += 1;
  const debit = ['funding_out', 'expense', 'refund_out', 'adjustment_debit'].includes(kind);
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    kind,
    reference: `R${seq}`,
    at: new Date(`${ymd}T10:00:00+01:00`),
    amount,
    effect: debit ? -amount : amount,
    status: 'COMPLETED',
    counterpartyId: null,
    counterpartyName: null,
    description: kind,
    fundingId: null,
    ...extra,
  };
}

const day = (ymd: string) => lagosDayStart(ymd);
const dayEnd = (ymd: string) => lagosDayEnd(ymd);

describe('computeWindow: the ticket examples', () => {
  it('weekly: 100k opening + 300k funding - 250k expenses = 150k, and next week opens at 150k', () => {
    const movements = [
      mv('funding_in', '2026-10-28', 100_000), // previous week
      mv('funding_in', '2026-11-03', 300_000),
      mv('expense', '2026-11-05', 250_000),
    ];
    const wk = computeWindow(movements, day('2026-11-02'), dayEnd('2026-11-08'));
    expect(wk).toMatchObject({ opening: 100_000, received: 300_000, expenses: 250_000, refundsOut: 0, closing: 150_000 });

    const next = computeWindow(movements, day('2026-11-09'), dayEnd('2026-11-15'));
    expect(next.opening).toBe(150_000);
    expect(next.received).toBe(0); // the carried balance is not new funding
    expect(next.closing).toBe(150_000);
  });

  it('monthly: September closing becomes October opening', () => {
    const movements = [mv('funding_in', '2026-09-02', 400_000), mv('expense', '2026-09-20', 250_000)];
    const sep = computeWindow(movements, day('2026-09-01'), dayEnd('2026-09-30'));
    const oct = computeWindow(movements, day('2026-10-01'), dayEnd('2026-10-31'));
    expect(sep.closing).toBe(150_000);
    expect(oct.opening).toBe(150_000);
    expect(oct.received).toBe(0);
  });

  it('weeks inside a month add up to the month (no transaction counted twice)', () => {
    const movements = [
      mv('funding_in', '2026-10-01', 500_000),
      mv('expense', '2026-10-06', 120_000),
      mv('refund_out', '2026-10-13', 30_000),
      mv('refund_in', '2026-10-20', 10_000),
      mv('adjustment_credit', '2026-10-27', 5_000),
      mv('adjustment_debit', '2026-10-31', 2_000),
    ];
    const month = computeWindow(movements, day('2026-10-01'), dayEnd('2026-10-31'));
    const buckets = bucketsFor('2026-10-01', '2026-10-31');
    let carried = month.opening;
    let sumExpenses = 0;
    for (const b of buckets) {
      const w = computeWindow(movements, day(b.startDate), dayEnd(b.endDate));
      expect(w.opening).toBe(carried);
      carried = w.closing;
      sumExpenses += w.expenses;
    }
    expect(carried).toBe(month.closing);
    expect(sumExpenses).toBe(month.expenses);
    expect(month.closing).toBe(500_000 - 120_000 - 30_000 + 10_000 + 5_000 - 2_000);
  });

  it('refund direction: paid out reduces, received back increases', () => {
    const w = computeWindow([mv('refund_out', '2026-11-03', 40_000), mv('refund_in', '2026-11-04', 15_000)], null, null);
    expect(w.refundsOut).toBe(40_000);
    expect(w.refundsIn).toBe(15_000);
    expect(w.closing).toBe(-25_000);
  });
});

describe('running balance', () => {
  it('starts from the opening and ends on the closing', () => {
    const movements = [mv('funding_in', '2026-10-01', 100), mv('expense', '2026-11-02', 30), mv('expense', '2026-11-03', 20)];
    const { opening, rows } = withRunningBalance(movements, day('2026-11-01'), dayEnd('2026-11-30'));
    expect(opening).toBe(100);
    expect(rows.map((r) => r.runningBalance)).toEqual([70, 50]);
  });
});

describe('month close baseline', () => {
  it('a change inside a closed month shows once as a prior-period correction', () => {
    const movements = [mv('funding_in', '2026-09-02', 400_000), mv('expense', '2026-09-20', 250_000)];
    const baseline = {
      periodEnd: dayEnd('2026-09-30'),
      nextStart: day('2026-10-01'),
      frozenClosing: 150_000,
    };
    // After the close, an expense dated 25 Sept is approved.
    const later = [...movements, mv('expense', '2026-09-25', 20_000)];

    const { drift } = applyCloseBaseline(later, baseline);
    expect(drift).toBe(-20_000);

    const oct = computeWindowWithClose(later, day('2026-10-01'), dayEnd('2026-10-31'), baseline);
    expect(oct.usesClose).toBe(true);
    expect(oct.opening).toBe(150_000); // frozen September closing
    expect(oct.corrections).toBe(-20_000);
    expect(oct.closing).toBe(130_000);

    // November opens from October's closing; the correction is not repeated.
    const nov = computeWindowWithClose(later, day('2026-11-01'), dayEnd('2026-11-30'), baseline);
    expect(nov.opening).toBe(130_000);
    expect(nov.corrections).toBe(0);

    // Same end result as the live figures: nothing lost, nothing doubled.
    expect(nov.closing).toBe(computeWindow(later, null, null).closing);
  });

  it('no drift means no correction row', () => {
    const movements = [mv('funding_in', '2026-09-02', 1_000)];
    const { movements: eff, drift } = applyCloseBaseline(movements, {
      periodEnd: dayEnd('2026-09-30'),
      nextStart: day('2026-10-01'),
      frozenClosing: 1_000,
    });
    expect(drift).toBe(0);
    expect(eff.filter((m) => m.reference === 'PRIOR-PERIOD')).toHaveLength(0);
  });
});

describe('Lagos calendar', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekStart('2026-11-10')).toBe('2026-11-09'); // Tuesday -> Monday
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday -> previous Monday
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
  });

  it('23:30 UTC on the 31st is already the 1st in Lagos', () => {
    expect(lagosYmd(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
  });

  it('month end handles February and leap years', () => {
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
  });

  it('buckets: a month shows its weeks, a quarter its months, a week its days', () => {
    expect(bucketsFor('2026-11-01', '2026-11-30')[0]).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-01' });
    expect(bucketsFor('2026-11-01', '2026-11-30').at(-1)).toMatchObject({ endDate: '2026-11-30' });
    expect(bucketsFor('2026-07-01', '2026-09-30').map((b) => b.label)).toEqual(['Jul 2026', 'Aug 2026', 'Sept 2026']);
    expect(bucketsFor('2026-11-09', '2026-11-15')).toHaveLength(7);
    expect(bucketsFor('2026-11-09', '2026-11-09')).toHaveLength(0);
  });
});

describe('remaining per funding (first in, first out)', () => {
  it('spends the oldest funding first; refunds come out of their own funding', () => {
    const a = mv('funding_in', '2026-10-01', 100_000, { counterpartyName: 'HoM A' });
    a.fundingId = a.id;
    const b = mv('funding_in', '2026-10-05', 200_000, { counterpartyName: 'Supervisor B' });
    b.fundingId = b.id;
    const movements = [
      a,
      b,
      mv('expense', '2026-10-06', 120_000),
      mv('refund_out', '2026-10-10', 50_000, { fundingId: b.id }),
    ];
    const { sources, overdraft } = allocateFifo(movements);
    const sa = sources.find((s) => s.sourceId === a.id)!;
    const sb = sources.find((s) => s.sourceId === b.id)!;
    expect(sa).toMatchObject({ used: 100_000, refunded: 0, remaining: 0 });
    expect(sb).toMatchObject({ used: 20_000, refunded: 50_000, remaining: 130_000 });
    expect(overdraft).toBe(0);
    expect(sources.reduce((s, x) => s + x.remaining, 0)).toBe(computeWindow(movements, null, null).closing);
  });

  it('a refund stays on its own funding even when spending already used that funding', async () => {
    const f2 = mv('funding_in', '2026-09-03', 300_000, { counterpartyName: 'HoM' });
    f2.fundingId = f2.id;
    const f3 = mv('funding_in', '2026-10-02', 200_000, { counterpartyName: 'HoM' });
    f3.fundingId = f3.id;
    const movements = [
      f2,
      f3,
      mv('expense', '2026-09-15', 120_000),
      mv('expense', '2026-10-20', 250_000),
      mv('expense', '2026-10-15', 15_000),
      mv('refund_out', '2026-11-11', 20_000, { fundingId: f2.id }),
    ];
    const { sources, overdraft } = allocateFifo(movements);
    expect(sources.find((s) => s.sourceId === f2.id)).toMatchObject({ refunded: 20_000, used: 280_000, remaining: 0 });
    expect(sources.find((s) => s.sourceId === f3.id)).toMatchObject({ refunded: 0, used: 105_000, remaining: 95_000 });
    expect(overdraft).toBe(0);
    expect(sources.reduce((s, x) => s + x.remaining, 0)).toBe(computeWindow(movements, null, null).closing);
  });

  it('overspend becomes an overdraft paid off by the next funding', () => {
    const a = mv('funding_in', '2026-10-01', 10_000);
    a.fundingId = a.id;
    const b = mv('funding_in', '2026-10-09', 50_000);
    b.fundingId = b.id;
    const { sources, overdraft } = allocateFifo([a, mv('expense', '2026-10-02', 25_000), b]);
    expect(overdraft).toBe(0);
    expect(sources.find((s) => s.sourceId === b.id)).toMatchObject({ used: 15_000, remaining: 35_000 });
  });
});
