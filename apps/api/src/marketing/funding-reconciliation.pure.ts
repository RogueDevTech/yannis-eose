/**
 * Funding reconciliation maths (2026-11-10). Pure: no database, no clock.
 *
 * One definition of how a funding balance moves, shared by the Funding Ledger,
 * the Reconciliation page, month close and the exports:
 *
 *   closing = opening
 *           + received   (funding marked Received, dated when it was received)
 *           + refundsIn  (refunds completed TO this person)
 *           + credits    (approved adjustments)
 *           + corrections (later changes inside a closed month, see below)
 *           - distributed (funding this person sent; leaves at send time)
 *           - expenses   (APPROVED expenses, dated by spend date)
 *           - refundsOut (refunds this person completed back to a funder)
 *           - debits     (approved adjustments)
 *
 * Pending expenses and pending/approved refunds are NOT movements: they are
 * holds. They already leave the AVAILABLE balance (so they cannot be spent
 * twice) but they do not touch the reconciled closing balance until final.
 *   available = closing - holds
 *
 * Carry-forward is never stored: a period's opening is the sum of every final
 * movement before it, so a week's closing is the next week's opening by
 * construction and nothing is counted twice.
 */

export type FundingMovementKind =
  | 'funding_in'
  | 'funding_out'
  | 'expense'
  | 'refund_out'
  | 'refund_in'
  | 'adjustment_credit'
  | 'adjustment_debit'
  | 'correction';

export interface FundingMovement {
  id: string;
  kind: FundingMovementKind;
  /** Human reference: TXN-…, EXP-…, RF-…, ADJ-…. */
  reference: string;
  /** Reconciliation date (instant). */
  at: Date;
  /** Always positive. */
  amount: number;
  /** Signed effect on the balance. */
  effect: number;
  status: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  description: string;
  /** funding_in: its own id. refund_out / refund_in: the original funding. */
  fundingId: string | null;
}

export interface FundingHold {
  id: string;
  kind: 'expense' | 'refund_out';
  reference: string;
  at: Date;
  amount: number;
  status: string;
  description: string;
  counterpartyName: string | null;
  fundingId: string | null;
}

export interface FundingTotals {
  received: number;
  distributed: number;
  expenses: number;
  refundsOut: number;
  refundsIn: number;
  credits: number;
  debits: number;
  corrections: number;
}

export interface FundingWindow extends FundingTotals {
  opening: number;
  closing: number;
}

/** Round to kobo so floating sums never show ₦0.0000001 differences. */
export function kobo(n: number): number {
  return Math.round(n * 100) / 100;
}

export function emptyTotals(): FundingTotals {
  return { received: 0, distributed: 0, expenses: 0, refundsOut: 0, refundsIn: 0, credits: 0, debits: 0, corrections: 0 };
}

export function addToTotals(t: FundingTotals, m: FundingMovement): void {
  switch (m.kind) {
    case 'funding_in':
      t.received += m.amount;
      break;
    case 'funding_out':
      t.distributed += m.amount;
      break;
    case 'expense':
      t.expenses += m.amount;
      break;
    case 'refund_out':
      t.refundsOut += m.amount;
      break;
    case 'refund_in':
      t.refundsIn += m.amount;
      break;
    case 'adjustment_credit':
      t.credits += m.amount;
      break;
    case 'adjustment_debit':
      t.debits += m.amount;
      break;
    case 'correction':
      t.corrections += m.effect;
      break;
  }
}

export function netOfTotals(t: FundingTotals): number {
  return (
    t.received + t.refundsIn + t.credits + t.corrections - t.distributed - t.expenses - t.refundsOut - t.debits
  );
}

function roundTotals<T extends FundingTotals>(t: T): T {
  const out = { ...t };
  for (const k of Object.keys(out) as Array<keyof T>) {
    const v = out[k];
    if (typeof v === 'number') (out[k] as unknown as number) = kobo(v);
  }
  return out;
}

/** Oldest first; ties broken by id so the order is stable. */
export function sortMovements<T extends { at: Date; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
}

/**
 * Opening, totals and closing for [start, end]. `start` null = from the
 * beginning, `end` null = up to now. Movements must be the complete list for
 * the person (any order).
 */
export function computeWindow(movements: FundingMovement[], start: Date | null, end: Date | null): FundingWindow {
  let opening = 0;
  const totals = emptyTotals();
  for (const m of movements) {
    const t = m.at.getTime();
    if (start && t < start.getTime()) {
      opening += m.effect;
      continue;
    }
    if (end && t > end.getTime()) continue;
    addToTotals(totals, m);
  }
  const closing = opening + netOfTotals(totals);
  return roundTotals({ ...totals, opening, closing });
}

/** Movements inside [start, end], oldest first, each with the balance after it. */
export function withRunningBalance(
  movements: FundingMovement[],
  start: Date | null,
  end: Date | null,
): { opening: number; rows: Array<FundingMovement & { runningBalance: number }> } {
  const sorted = sortMovements(movements);
  let balance = 0;
  const rows: Array<FundingMovement & { runningBalance: number }> = [];
  let opening = 0;
  for (const m of sorted) {
    const t = m.at.getTime();
    if (start && t < start.getTime()) {
      balance += m.effect;
      opening = balance;
      continue;
    }
    if (end && t > end.getTime()) break;
    balance += m.effect;
    rows.push({ ...m, runningBalance: kobo(balance) });
  }
  return { opening: kobo(start ? opening : 0), rows };
}

// ── Month close baseline ────────────────────────────────────────────────────

export interface CloseBaseline {
  /** Last instant of the closed month. */
  periodEnd: Date;
  /** First instant of the following month. */
  nextStart: Date;
  /** Frozen closing balance at close. */
  frozenClosing: number;
}

/**
 * After a month is closed, its closing balance must not change silently. If a
 * later change lands inside the closed month (backdated expense, late approval,
 * a reversal), the live balance at the close date drifts from the frozen one.
 * That drift is shown ONCE, as a "Prior-period corrections" movement on the
 * first instant of the next month. Periods starting after the close therefore
 * open from the frozen figure and carry the correction explicitly.
 *
 * Returns the movement list to use for periods that start after the close,
 * plus the drift amount.
 */
export function applyCloseBaseline(
  movements: FundingMovement[],
  baseline: CloseBaseline,
): { movements: FundingMovement[]; drift: number } {
  const liveAtClose = movements
    .filter((m) => m.at.getTime() <= baseline.periodEnd.getTime())
    .reduce((s, m) => s + m.effect, 0);
  const drift = kobo(liveAtClose - baseline.frozenClosing);
  const after = movements.filter((m) => m.at.getTime() > baseline.periodEnd.getTime());
  const out: FundingMovement[] = [
    {
      id: '00000000-0000-0000-0000-00000000c105',
      kind: 'correction',
      reference: 'CLOSED',
      at: baseline.periodEnd,
      amount: Math.abs(baseline.frozenClosing),
      effect: baseline.frozenClosing,
      status: 'CLOSED',
      counterpartyId: null,
      counterpartyName: null,
      description: 'Closed balance brought forward',
      fundingId: null,
    },
    ...after,
  ];
  if (Math.abs(drift) >= 0.005) {
    out.push({
      id: '00000000-0000-0000-0000-00000000c0aa',
      kind: 'correction',
      reference: 'PRIOR-PERIOD',
      at: baseline.nextStart,
      amount: Math.abs(drift),
      effect: drift,
      status: 'APPROVED',
      counterpartyId: null,
      counterpartyName: null,
      description: 'Prior-period corrections: changes dated in a closed month',
      fundingId: null,
    });
  }
  return { movements: out, drift };
}

/**
 * computeWindow for a period, using the closed baseline when the whole period
 * starts after the close. The synthetic "closed balance" row sits exactly on
 * the close instant, so it only ever lands in the opening.
 */
export function computeWindowWithClose(
  movements: FundingMovement[],
  start: Date | null,
  end: Date | null,
  baseline: CloseBaseline | null,
): FundingWindow & { usesClose: boolean } {
  if (baseline && start && start.getTime() > baseline.periodEnd.getTime()) {
    const { movements: eff } = applyCloseBaseline(movements, baseline);
    return { ...computeWindow(eff, start, end), usesClose: true };
  }
  return { ...computeWindow(movements, start, end), usesClose: false };
}

// ── Lagos calendar periods ──────────────────────────────────────────────────

const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** YYYY-MM-DD in Africa/Lagos (UTC+1, no DST). */
export function lagosYmd(d: Date): string {
  return new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** First instant of a Lagos calendar day. */
export function lagosDayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+01:00`);
}

/** Last instant of a Lagos calendar day. */
export function lagosDayEnd(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+01:00`);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing ymd (weeks run Monday to Sunday). */
export function weekStart(ymd: string): string {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function monthEnd(ymd: string): string {
  const [y, m] = ymd.slice(0, 7).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.slice(0, 7).split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}

export interface PeriodBucket {
  label: string;
  startDate: string;
  endDate: string;
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function dayLabel(ymd: string): string {
  return DAY_LABEL.format(new Date(`${ymd}T12:00:00Z`));
}

/**
 * Sub-periods for the "how the balance carried forward" table:
 * a week shows its days, a month its weeks (clipped to the month), a short
 * custom range its days, anything longer its months.
 */
export function bucketsFor(startDate: string, endDate: string): PeriodBucket[] {
  const span = daysBetween(startDate, endDate) + 1;
  const out: PeriodBucket[] = [];
  if (span <= 1) return out;
  if (span <= 14) {
    for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
      out.push({ label: dayLabel(d), startDate: d, endDate: d });
    }
    return out;
  }
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  if (span <= 31 && sameMonth) {
    for (let s = startDate; s <= endDate; ) {
      const wkEnd = addDays(weekStart(s), 6);
      const e = wkEnd < endDate ? wkEnd : endDate;
      out.push({ label: `${dayLabel(s)} to ${dayLabel(e)}`, startDate: s, endDate: e });
      s = addDays(e, 1);
    }
    return out;
  }
  for (let s = startDate; s <= endDate; ) {
    const mEnd = monthEnd(s);
    const e = mEnd < endDate ? mEnd : endDate;
    const whole = s === monthStart(s) && e === mEnd;
    out.push({
      label: whole ? MONTH_LABEL.format(new Date(`${s}T12:00:00Z`)) : `${dayLabel(s)} to ${dayLabel(e)}`,
      startDate: s,
      endDate: e,
    });
    s = addDays(e, 1);
  }
  return out;
}

// ── Remaining per funding (first in, first out) ─────────────────────────────

export interface FundingSourceAllocation {
  /** marketing_funding id, or a synthetic id for other credits. */
  sourceId: string;
  kind: 'funding' | 'refund_in' | 'adjustment' | 'correction';
  reference: string;
  funderName: string | null;
  at: Date;
  amount: number;
  /** Completed refunds made against this funding. */
  refunded: number;
  /** Consumed by expenses, funding sent on and debits (first in, first out). */
  used: number;
  remaining: number;
}

/**
 * Spending is not linked to a specific funding in the data, so "how much of
 * each funding is left" is an ALLOCATION. Refunds ARE linked to a funding, so:
 *   1. every refund is set against its own funding first (never another one);
 *   2. every other debit consumes the oldest credit that still has money.
 * A debit with nothing left to consume becomes an overdraft that the next
 * credit pays off. Sum(remaining) - overdraft = closing balance.
 */
export function allocateFifo(movements: FundingMovement[]): {
  sources: FundingSourceAllocation[];
  overdraft: number;
} {
  const sorted = sortMovements(movements);

  // Pass 1: refunds reserved against their own funding (capped at its amount).
  const fundingAmount = new Map<string, number>();
  for (const m of sorted) if (m.kind === 'funding_in' && m.fundingId) fundingAmount.set(m.fundingId, m.effect);
  const reserved = new Map<string, number>();
  const refundExcess = new Set<string>(); // refund movement ids whose own funding could not cover them
  const excessAmount = new Map<string, number>();
  for (const m of sorted) {
    if (m.kind !== 'refund_out') continue;
    const amt = -m.effect;
    const cap = m.fundingId ? fundingAmount.get(m.fundingId) : undefined;
    if (!m.fundingId || cap === undefined) {
      refundExcess.add(m.id);
      excessAmount.set(m.id, amt);
      continue;
    }
    const already = reserved.get(m.fundingId) ?? 0;
    const take = Math.min(amt, Math.max(0, cap - already));
    reserved.set(m.fundingId, already + take);
    if (amt - take > 0.000001) {
      refundExcess.add(m.id);
      excessAmount.set(m.id, amt - take);
    }
  }

  // Pass 2: chronological first-in-first-out for everything else.
  const sources: FundingSourceAllocation[] = [];
  let overdraft = 0;

  const consume = (amount: number) => {
    let left = amount;
    for (const s of sources) {
      if (left <= 0.000001) break;
      if (s.remaining <= 0) continue;
      const take = Math.min(left, s.remaining);
      s.remaining -= take;
      s.used += take;
      left -= take;
    }
    if (left > 0.000001) overdraft += left;
  };

  for (const m of sorted) {
    if (m.effect > 0) {
      const isFunding = m.kind === 'funding_in';
      const held = isFunding && m.fundingId ? (reserved.get(m.fundingId) ?? 0) : 0;
      const src: FundingSourceAllocation = {
        sourceId: isFunding ? (m.fundingId ?? m.id) : m.id,
        kind: isFunding ? 'funding' : m.kind === 'refund_in' ? 'refund_in' : m.kind === 'correction' ? 'correction' : 'adjustment',
        reference: m.reference,
        funderName: m.counterpartyName,
        at: m.at,
        amount: m.effect,
        refunded: held,
        used: 0,
        remaining: m.effect - held,
      };
      // A new credit first pays off any overdraft.
      if (overdraft > 0 && src.remaining > 0) {
        const pay = Math.min(overdraft, src.remaining);
        src.remaining -= pay;
        src.used += pay;
        overdraft -= pay;
      }
      sources.push(src);
    } else if (m.effect < 0) {
      if (m.kind === 'refund_out') {
        // Already set against its own funding; only an uncovered excess is spread.
        if (refundExcess.has(m.id)) consume(excessAmount.get(m.id) ?? 0);
      } else {
        consume(-m.effect);
      }
    }
  }

  return {
    sources: sources.map((s) => ({
      ...s,
      amount: kobo(s.amount),
      refunded: kobo(s.refunded),
      used: kobo(s.used),
      remaining: kobo(s.remaining),
    })),
    overdraft: kobo(overdraft),
  };
}
