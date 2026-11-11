import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, canonicalPermissionCode } from '@yannis/shared';
import type { CloseFundingPeriodInput, FundingLedgerInput, FundingReconciliationInput } from '@yannis/shared';
import { uuidv7 } from 'uuidv7';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevel } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import type { BranchTeamsService } from '../branches/branch-teams.service';
import { fundingTxnReference } from './funding-refunds.service';
import {
  addMonths,
  allocateFifo,
  applyCloseBaseline,
  bucketsFor,
  computeWindow,
  computeWindowWithClose,
  kobo,
  lagosDayEnd,
  lagosDayStart,
  lagosYmd,
  monthEnd,
  monthStart,
  sortMovements,
  type CloseBaseline,
  type FundingHold,
  type FundingMovement,
  type FundingWindow,
} from './funding-reconciliation.pure';

type Db = PostgresJsDatabase<typeof schema>;

export interface FundingReconciliationDeps {
  db: Db;
  branchTeams: BranchTeamsService;
  getScopeUserIds: (actor: SessionUser, effectiveBranchIds: string[] | null | undefined) => Promise<string[] | null>;
  /** The balance the rest of the app shows (aggregate SQL path), for the discrepancy check. */
  getSystemBalance: (userId: string) => Promise<{
    totalReceived: string;
    totalDistributed: string;
    totalSpend: string;
    balance: string;
    refundsHeld: string;
    refundsOut: string;
    refundsIn: string;
    credits: string;
    debits: string;
  }>;
}

interface ScopeCtx {
  currentBranchId: string | null;
  effectiveBranchIds: string[] | null;
}

interface ClosedRow {
  closeId: string;
  periodMonth: string;
  closedAt: Date;
  closedByName: string | null;
  opening: number;
  received: number;
  distributed: number;
  expenses: number;
  refundsOut: number;
  refundsIn: number;
  credits: number;
  debits: number;
  corrections: number;
  closing: number;
  pendingExpenses: number;
  pendingRefunds: number;
}

const expenseRef = (id: string) => `EXP-${id.replace(/-/g, '').slice(-8).toUpperCase()}`;
const requestRef = (id: string) => `REQ-${id.replace(/-/g, '').slice(-8).toUpperCase()}`;

function hasPermission(actor: SessionUser, code: string): boolean {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'SUPPORT') return true;
  const want = canonicalPermissionCode(code);
  return (actor.permissions ?? []).some((p) => p === code || canonicalPermissionCode(p) === want);
}

function toBaseline(row: ClosedRow): CloseBaseline {
  const end = monthEnd(row.periodMonth);
  return {
    periodEnd: lagosDayEnd(end),
    nextStart: lagosDayStart(addMonths(row.periodMonth, 1)),
    frozenClosing: row.closing,
  };
}

const money = (n: number) => String(kobo(n));

function windowOut(w: FundingWindow) {
  return {
    opening: money(w.opening),
    received: money(w.received),
    distributed: money(w.distributed),
    expenses: money(w.expenses),
    refundsOut: money(w.refundsOut),
    refundsIn: money(w.refundsIn),
    credits: money(w.credits),
    debits: money(w.debits),
    corrections: money(w.corrections),
    closing: money(w.closing),
  };
}

/**
 * Funding reconciliation (ticket 2) and the Funding Ledger, from ONE movement
 * list per person. See funding-reconciliation.pure.ts for the formula.
 */
export class FundingReconciliationService {
  constructor(private readonly deps: FundingReconciliationDeps) {}

  private get db() {
    return this.deps.db;
  }

  /**
   * Who may see someone's funding history: themselves; Admin; Finance; Head of
   * Marketing / reconcile holders; their marketing supervisor. Always within the
   * caller's company (fail-closed), so a ledger id from another company is
   * "not found" rather than readable.
   */
  async assertCanView(actor: SessionUser, userId: string, ctx: ScopeCtx): Promise<void> {
    if (actor.id === userId) return;
    const scope = await this.deps.getScopeUserIds(actor, ctx.effectiveBranchIds);
    if (scope && !scope.includes(userId)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'This person is not in your company.' });
    }
    if (
      isAdminLevel(actor) ||
      actor.role === 'HEAD_OF_MARKETING' ||
      hasPermission(actor, 'marketing.funding.reconcile') ||
      hasPermission(actor, 'marketing.fundingSummary') ||
      (hasFinanceAccess(actor) && actor.role !== 'MEDIA_BUYER')
    ) {
      return;
    }
    if (ctx.currentBranchId) {
      const supervised = await this.deps.branchTeams.listSupervisedUserIds(actor.id, ctx.currentBranchId, 'MARKETING');
      if (supervised.includes(userId)) return;
    }
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view funding for yourself or your team.' });
  }

  /** Every final movement and every hold for one person, all time. */
  async loadMovements(userId: string): Promise<{ movements: FundingMovement[]; holds: FundingHold[] }> {
    const f = schema.marketingFunding;
    const r = schema.marketingFundingRefunds;
    const a = schema.marketingFundingAdjustments;
    const sp = schema.adSpendLogs;
    const sender = alias(schema.users, 'sender');
    const receiver = alias(schema.users, 'receiver');
    const refunder = alias(schema.users, 'refunder');
    const funder = alias(schema.users, 'funder');

    const [fundIn, fundOut, spend, refundsOut, refundsIn, adjustments] = await Promise.all([
      this.db
        .select({ id: f.id, amount: f.amount, sentAt: f.sentAt, verifiedAt: f.verifiedAt, notes: f.notes, status: f.status, cpId: f.senderId, cpName: sender.name })
        .from(f)
        .leftJoin(sender, eq(sender.id, f.senderId))
        .where(and(eq(f.receiverId, userId), eq(f.status, 'COMPLETED'))),
      this.db
        .select({ id: f.id, amount: f.amount, sentAt: f.sentAt, notes: f.notes, status: f.status, cpId: f.receiverId, cpName: receiver.name })
        .from(f)
        .leftJoin(receiver, eq(receiver.id, f.receiverId))
        .where(and(eq(f.senderId, userId), inArray(f.status, ['SENT', 'COMPLETED', 'DISPUTED']))),
      this.db
        .select({
          id: sp.id,
          amount: sp.spendAmount,
          spendDate: sp.spendDate,
          status: sp.status,
          platform: sp.platform,
          category: sp.category,
          description: sp.description,
          campaignName: schema.campaigns.name,
        })
        .from(sp)
        .leftJoin(schema.campaigns, eq(schema.campaigns.id, sp.campaignId))
        .where(and(eq(sp.mediaBuyerId, userId), inArray(sp.status, ['PENDING', 'APPROVED']))),
      this.db
        .select({
          id: r.id, reference: r.reference, fundingId: r.fundingId, amount: r.amount, status: r.status,
          requestedAt: r.requestedAt, completedAt: r.completedAt, reason: r.reason, cpId: r.funderId, cpName: funder.name,
        })
        .from(r)
        .leftJoin(funder, eq(funder.id, r.funderId))
        .where(and(eq(r.refunderId, userId), inArray(r.status, ['PENDING', 'APPROVED', 'COMPLETED']))),
      this.db
        .select({
          id: r.id, reference: r.reference, fundingId: r.fundingId, amount: r.amount, status: r.status,
          completedAt: r.completedAt, reason: r.reason, cpId: r.refunderId, cpName: refunder.name,
        })
        .from(r)
        .leftJoin(refunder, eq(refunder.id, r.refunderId))
        .where(and(eq(r.funderId, userId), eq(r.status, 'COMPLETED'))),
      this.db
        .select({ id: a.id, reference: a.reference, direction: a.direction, amount: a.amount, reviewedAt: a.reviewedAt, reason: a.reason, status: a.status })
        .from(a)
        .where(and(eq(a.userId, userId), eq(a.status, 'APPROVED'))),
    ]);

    const movements: FundingMovement[] = [];
    const holds: FundingHold[] = [];

    for (const x of fundIn) {
      const amt = Number(x.amount);
      movements.push({
        id: x.id, kind: 'funding_in', reference: fundingTxnReference(x.id), at: x.verifiedAt ?? x.sentAt,
        amount: amt, effect: amt, status: x.status, counterpartyId: x.cpId, counterpartyName: x.cpName ?? null,
        description: `Funding from ${x.cpName ?? 'Unknown'}${x.notes ? `: ${x.notes}` : ''}`, fundingId: x.id,
      });
    }
    for (const x of fundOut) {
      const amt = Number(x.amount);
      movements.push({
        id: x.id, kind: 'funding_out', reference: fundingTxnReference(x.id), at: x.sentAt,
        amount: amt, effect: -amt, status: x.status, counterpartyId: x.cpId, counterpartyName: x.cpName ?? null,
        description: `Funding sent to ${x.cpName ?? 'Unknown'}${x.notes ? `: ${x.notes}` : ''}`, fundingId: x.id,
      });
    }
    for (const x of spend) {
      const amt = Number(x.amount);
      const nice = (v: string | null) => (v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : null);
      const parts = [x.campaignName, nice(x.category === 'AD_SPEND' ? x.platform : x.category), x.description].filter(Boolean);
      const description = parts.length ? parts.join(' · ') : 'Ad spend';
      if (x.status === 'APPROVED') {
        movements.push({
          id: x.id, kind: 'expense', reference: expenseRef(x.id), at: x.spendDate, amount: amt, effect: -amt,
          status: x.status, counterpartyId: null, counterpartyName: null, description, fundingId: null,
        });
      } else {
        holds.push({
          id: x.id, kind: 'expense', reference: expenseRef(x.id), at: x.spendDate, amount: amt,
          status: x.status, description, counterpartyName: null, fundingId: null,
        });
      }
    }
    for (const x of refundsOut) {
      const amt = Number(x.amount);
      const description = `Refund to ${x.cpName ?? 'Unknown'} for ${fundingTxnReference(x.fundingId)}: ${x.reason}`;
      if (x.status === 'COMPLETED' && x.completedAt) {
        movements.push({
          id: x.id, kind: 'refund_out', reference: x.reference, at: x.completedAt, amount: amt, effect: -amt,
          status: x.status, counterpartyId: x.cpId, counterpartyName: x.cpName ?? null, description, fundingId: x.fundingId,
        });
      } else {
        holds.push({
          id: x.id, kind: 'refund_out', reference: x.reference, at: x.requestedAt, amount: amt,
          status: x.status, description, counterpartyName: x.cpName ?? null, fundingId: x.fundingId,
        });
      }
    }
    for (const x of refundsIn) {
      if (!x.completedAt) continue;
      const amt = Number(x.amount);
      movements.push({
        id: x.id, kind: 'refund_in', reference: x.reference, at: x.completedAt, amount: amt, effect: amt,
        status: x.status, counterpartyId: x.cpId, counterpartyName: x.cpName ?? null,
        description: `Refund from ${x.cpName ?? 'Unknown'} for ${fundingTxnReference(x.fundingId)}: ${x.reason}`, fundingId: x.fundingId,
      });
    }
    for (const x of adjustments) {
      if (!x.reviewedAt) continue;
      const amt = Number(x.amount);
      const credit = x.direction === 'CREDIT';
      movements.push({
        id: x.id, kind: credit ? 'adjustment_credit' : 'adjustment_debit', reference: x.reference, at: x.reviewedAt,
        amount: amt, effect: credit ? amt : -amt, status: x.status, counterpartyId: null, counterpartyName: null,
        description: `Adjustment (${credit ? 'credit' : 'debit'}): ${x.reason}`, fundingId: null,
      });
    }

    return { movements: sortMovements(movements), holds: sortMovements(holds) };
  }

  /** Frozen month figures for this person, newest first. */
  async loadClosedRows(userId: string): Promise<ClosedRow[]> {
    const pb = schema.marketingFundingPeriodBalances;
    const pc = schema.marketingFundingPeriodCloses;
    const closer = alias(schema.users, 'closer');
    const rows = await this.db
      .select({
        closeId: pc.id, periodMonth: pc.periodMonth, closedAt: pc.closedAt, closedByName: closer.name,
        opening: pb.opening, received: pb.received, distributed: pb.distributed, expenses: pb.expenses,
        refundsOut: pb.refundsOut, refundsIn: pb.refundsIn, credits: pb.credits, debits: pb.debits,
        corrections: pb.corrections, closing: pb.closing, pendingExpenses: pb.pendingExpenses, pendingRefunds: pb.pendingRefunds,
      })
      .from(pb)
      .innerJoin(pc, eq(pc.id, pb.closeId))
      .leftJoin(closer, eq(closer.id, pc.closedBy))
      .where(eq(pb.userId, userId))
      .orderBy(desc(pc.periodMonth), desc(pc.closedAt));
    return rows.map((x) => ({
      closeId: x.closeId, periodMonth: String(x.periodMonth), closedAt: x.closedAt, closedByName: x.closedByName ?? null,
      opening: Number(x.opening), received: Number(x.received), distributed: Number(x.distributed), expenses: Number(x.expenses),
      refundsOut: Number(x.refundsOut), refundsIn: Number(x.refundsIn), credits: Number(x.credits), debits: Number(x.debits),
      corrections: Number(x.corrections), closing: Number(x.closing),
      pendingExpenses: Number(x.pendingExpenses), pendingRefunds: Number(x.pendingRefunds),
    }));
  }

  /**
   * Funding and expense rows dated inside a closed month that were created or
   * changed after it was closed: the transactions behind a prior-period
   * correction. Uses the history twins (a row's old version gets valid_to = the
   * moment it changed).
   */
  async loadChangedSinceClose(userId: string, periodEndAt: Date, closedAtAt: Date) {
    // Raw SQL parameters: pass instants as ISO strings with an explicit cast.
    const periodEnd = sql`${periodEndAt.toISOString()}::timestamptz`;
    const closedAt = sql`${closedAtAt.toISOString()}::timestamptz`;
    const rows = await this.db.execute<{
      id: string; kind: string; at: Date; amount: string; status: string; changed_at: Date; description: string | null;
    }>(sql`
      SELECT f.id, CASE WHEN f.receiver_id = ${userId} THEN 'funding_in' ELSE 'funding_out' END AS kind,
             COALESCE(f.verified_at, f.sent_at) AS at, f.amount::text AS amount, f.status::text AS status,
             (SELECT max(h.valid_to) FROM marketing_funding_history h WHERE h.id = f.id) AS changed_at,
             COALESCE(f.notes, '') AS description
      FROM marketing_funding f
      WHERE (f.receiver_id = ${userId} OR f.sender_id = ${userId})
        AND LEAST(f.sent_at, COALESCE(f.verified_at, f.sent_at)) <= ${periodEnd}
        AND EXISTS (SELECT 1 FROM marketing_funding_history h WHERE h.id = f.id AND h.valid_to > ${closedAt})
      UNION ALL
      SELECT s.id, 'expense', s.spend_date, s.spend_amount::text, s.status::text,
             GREATEST(s.created_at, COALESCE((SELECT max(h.valid_to) FROM ad_spend_logs_history h WHERE h.id = s.id), s.created_at)),
             COALESCE(s.description, s.category::text)
      FROM ad_spend_logs s
      WHERE s.media_buyer_id = ${userId}
        AND s.spend_date <= ${periodEnd}
        AND (s.created_at > ${closedAt}
             OR EXISTS (SELECT 1 FROM ad_spend_logs_history h WHERE h.id = s.id AND h.valid_to > ${closedAt}))
      ORDER BY 3
      LIMIT 200
    `);
    return (rows as unknown as Array<{ id: string; kind: string; at: Date; amount: string; status: string; changed_at: Date; description: string | null }>).map((x) => ({
      id: x.id,
      kind: x.kind,
      reference: x.kind === 'expense' ? expenseRef(x.id) : fundingTxnReference(x.id),
      date: new Date(x.at).toISOString(),
      amount: x.amount,
      status: x.status,
      changedAt: new Date(x.changed_at).toISOString(),
      description: x.description ?? '',
    }));
  }

  /**
   * Every row the displayed balance counts, with its effect, read straight from
   * SQL using the same status rules as getFundingBalance (an independent path
   * from loadMovements). The balance check compares these row by row.
   */
  async loadSystemRows(userId: string): Promise<Map<string, { kind: string; id: string; at: Date; effect: number; status: string }>> {
    const rows = await this.db.execute<{ kind: string; id: string; at: Date; effect: string; status: string }>(sql`
      SELECT 'funding_in' AS kind, f.id, COALESCE(f.verified_at, f.sent_at) AS at, f.amount::text AS effect, f.status::text AS status
        FROM marketing_funding f WHERE f.receiver_id = ${userId} AND f.status = 'COMPLETED'
      UNION ALL
      SELECT 'funding_out', f.id, f.sent_at, (-f.amount)::text, f.status::text
        FROM marketing_funding f WHERE f.sender_id = ${userId} AND f.status IN ('SENT', 'COMPLETED', 'DISPUTED')
      UNION ALL
      SELECT 'expense', s.id, s.spend_date, (-s.spend_amount)::text, s.status::text
        FROM ad_spend_logs s WHERE s.media_buyer_id = ${userId} AND s.status IN ('PENDING', 'APPROVED')
      UNION ALL
      SELECT 'refund_out', r.id, COALESCE(r.completed_at, r.requested_at), (-r.amount)::text, r.status::text
        FROM marketing_funding_refunds r WHERE r.refunder_id = ${userId} AND r.status IN ('PENDING', 'APPROVED', 'COMPLETED')
      UNION ALL
      SELECT 'refund_in', r.id, r.completed_at, r.amount::text, r.status::text
        FROM marketing_funding_refunds r WHERE r.funder_id = ${userId} AND r.status = 'COMPLETED'
      UNION ALL
      SELECT 'adjustment', a.id, a.reviewed_at, (CASE WHEN a.direction = 'CREDIT' THEN a.amount ELSE -a.amount END)::text, a.status::text
        FROM marketing_funding_adjustments a WHERE a.user_id = ${userId} AND a.status = 'APPROVED'
    `);
    const out = new Map<string, { kind: string; id: string; at: Date; effect: number; status: string }>();
    for (const r of rows as unknown as Array<{ kind: string; id: string; at: Date; effect: string; status: string }>) {
      out.set(`${r.kind}:${r.id}`, { kind: r.kind, id: r.id, at: new Date(r.at), effect: Number(r.effect), status: r.status });
    }
    return out;
  }

  private resolvePeriod(input: FundingReconciliationInput): { startDate: string | null; endDate: string | null } {
    if (input.view === 'all') return { startDate: null, endDate: null };
    const today = lagosYmd(new Date());
    const startDate = input.startDate ?? monthStart(today);
    const endDate = input.endDate ?? (input.startDate ? input.startDate : monthEnd(today));
    if (endDate < startDate) throw new TRPCError({ code: 'BAD_REQUEST', message: 'End date is before start date.' });
    return { startDate, endDate };
  }

  async getReconciliation(input: FundingReconciliationInput, actor: SessionUser, ctx: ScopeCtx) {
    await this.assertCanView(actor, input.userId, ctx);
    const [user] = await this.db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);
    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

    const [{ movements, holds }, closed, system, systemRows] = await Promise.all([
      this.loadMovements(user.id),
      this.loadClosedRows(user.id),
      this.deps.getSystemBalance(user.id),
      this.loadSystemRows(user.id),
    ]);
    const { startDate, endDate } = this.resolvePeriod(input);
    const start = startDate ? lagosDayStart(startDate) : null;
    const end = endDate ? lagosDayEnd(endDate) : null;

    const latest = closed[0] ?? null;
    const baseline = latest ? toBaseline(latest) : null;
    const window = computeWindowWithClose(movements, start, end, baseline);

    // A closed month shows its frozen figures; the live figures sit beside them.
    const isWholeMonth = !!startDate && !!endDate && startDate === monthStart(startDate) && endDate === monthEnd(startDate);
    const frozen = isWholeMonth ? closed.find((c) => c.periodMonth.slice(0, 7) === startDate!.slice(0, 7)) ?? null : null;
    const overlapsClosed = !!baseline && !!start && start.getTime() <= baseline.periodEnd.getTime();

    let closedPeriod: null | {
      month: string; closedAt: string; closedByName: string | null;
      frozen: ReturnType<typeof windowOut>; live: ReturnType<typeof windowOut>; drift: string;
      changedItems: Awaited<ReturnType<FundingReconciliationService['loadChangedSinceClose']>>;
    } = null;
    if (frozen) {
      const live = computeWindow(movements, start, end);
      closedPeriod = {
        month: frozen.periodMonth.slice(0, 7),
        closedAt: frozen.closedAt.toISOString(),
        closedByName: frozen.closedByName,
        frozen: windowOut({ ...frozen }),
        live: windowOut(live),
        drift: money(live.closing - frozen.closing),
        changedItems: await this.loadChangedSinceClose(user.id, end!, frozen.closedAt),
      };
    }

    let priorCorrection: null | {
      month: string; amount: string;
      changedItems: Awaited<ReturnType<FundingReconciliationService['loadChangedSinceClose']>>;
    } = null;
    if (latest && baseline && window.usesClose && Math.abs(window.corrections) >= 0.005) {
      priorCorrection = {
        month: latest.periodMonth.slice(0, 7),
        amount: money(window.corrections),
        changedItems: await this.loadChangedSinceClose(user.id, baseline.periodEnd, latest.closedAt),
      };
    }

    const summary = frozen ? windowOut({ ...frozen }) : windowOut(window);

    // Sub-periods: each opens where the previous one closed.
    const firstAt = movements[0]?.at ?? null;
    const bStart = startDate ?? (firstAt ? monthStart(lagosYmd(firstAt)) : null);
    const bEnd = endDate ?? lagosYmd(new Date());
    const breakdown = bStart
      ? (startDate ? bucketsFor(bStart, bEnd) : bucketsFor(bStart, monthEnd(bEnd))).map((b) => {
          const w = computeWindowWithClose(movements, lagosDayStart(b.startDate), lagosDayEnd(b.endDate), baseline);
          return { ...b, ...windowOut(w) };
        })
      : [];

    // Movements in the period with the running balance (same baseline as the summary).
    const effective = window.usesClose && baseline ? applyCloseBaseline(movements, baseline).movements : movements;
    let running = window.opening;
    const rows = sortMovements(effective)
      .filter((m) => (!start || m.at.getTime() >= start.getTime()) && (!end || m.at.getTime() <= end.getTime()))
      .map((m) => {
        running = kobo(running + m.effect);
        return {
          id: m.id, kind: m.kind, reference: m.reference, date: m.at.toISOString(), amount: money(m.amount),
          effect: money(m.effect), runningBalance: money(running), status: m.status,
          counterpartyName: m.counterpartyName, description: m.description,
          fundingReference: m.fundingId ? fundingTxnReference(m.fundingId) : null,
        };
      });

    // To date (live, all time) and the balance check.
    const toDate = computeWindow(movements, null, null);
    const pendingExpenses = holds.filter((h) => h.kind === 'expense').reduce((s, h) => s + h.amount, 0);
    const pendingRefunds = holds.filter((h) => h.kind === 'refund_out').reduce((s, h) => s + h.amount, 0);
    const derivedAvailable = kobo(toDate.closing - pendingExpenses - pendingRefunds);
    const systemAvailable = kobo(Number(system.balance));
    const components = [
      { key: 'received', label: 'Funds received', system: Number(system.totalReceived), derived: toDate.received },
      { key: 'distributed', label: 'Funds sent on', system: Number(system.totalDistributed), derived: toDate.distributed },
      { key: 'expenses', label: 'Expenses (approved + pending)', system: Number(system.totalSpend), derived: toDate.expenses + pendingExpenses },
      { key: 'refundsOut', label: 'Refunds paid out (completed + held)', system: Number(system.refundsOut) + Number(system.refundsHeld), derived: toDate.refundsOut + pendingRefunds },
      { key: 'refundsIn', label: 'Refunds received', system: Number(system.refundsIn), derived: toDate.refundsIn },
      { key: 'adjustments', label: 'Adjustments (net)', system: Number(system.credits) - Number(system.debits), derived: toDate.credits - toDate.debits },
    ].map((c) => ({ ...c, system: money(c.system), derived: money(c.derived), difference: money(c.derived - c.system) }));

    // Row-by-row check: which transactions make the two balances differ.
    const kindKey = (k: string) => (k === 'adjustment_credit' || k === 'adjustment_debit' ? 'adjustment' : k);
    const derivedRows = new Map<string, { kind: string; id: string; at: Date; effect: number; status: string; reference: string; description: string }>();
    for (const m of movements) {
      derivedRows.set(`${kindKey(m.kind)}:${m.id}`, { kind: m.kind, id: m.id, at: m.at, effect: m.effect, status: m.status, reference: m.reference, description: m.description });
    }
    for (const h of holds) {
      derivedRows.set(`${h.kind}:${h.id}`, { kind: h.kind, id: h.id, at: h.at, effect: -h.amount, status: h.status, reference: h.reference, description: h.description });
    }
    const refFor = (kind: string, id: string) =>
      kind === 'expense' ? expenseRef(id) : kind.startsWith('funding') ? fundingTxnReference(id) : id.slice(0, 8).toUpperCase();
    const checkItems: Array<{ reference: string; kind: string; date: string; status: string; description: string; derived: string; system: string; difference: string; reason: string }> = [];
    for (const [key, d] of derivedRows) {
      const sys = systemRows.get(key);
      if (!sys) {
        checkItems.push({ reference: d.reference, kind: d.kind, date: d.at.toISOString(), status: d.status, description: d.description, derived: money(d.effect), system: '0', difference: money(d.effect), reason: 'Counted in the transactions but not in the displayed balance' });
      } else if (Math.abs(sys.effect - d.effect) >= 0.005) {
        checkItems.push({ reference: d.reference, kind: d.kind, date: d.at.toISOString(), status: d.status, description: d.description, derived: money(d.effect), system: money(sys.effect), difference: money(d.effect - sys.effect), reason: 'Different amount on each side' });
      }
    }
    for (const [key, sys] of systemRows) {
      if (derivedRows.has(key)) continue;
      checkItems.push({ reference: refFor(sys.kind, sys.id), kind: sys.kind, date: sys.at.toISOString(), status: sys.status, description: '', derived: '0', system: money(sys.effect), difference: money(-sys.effect), reason: 'Counted in the displayed balance but missing from the transactions' });
    }

    // Optional comparison period, same rules as the main one.
    let comparison: null | { startDate: string; endDate: string; summary: ReturnType<typeof windowOut> } = null;
    if (input.compareStartDate && input.compareEndDate && input.compareEndDate >= input.compareStartDate) {
      const cw = computeWindowWithClose(
        movements,
        lagosDayStart(input.compareStartDate),
        lagosDayEnd(input.compareEndDate),
        baseline,
      );
      const cWhole = input.compareStartDate === monthStart(input.compareStartDate) && input.compareEndDate === monthEnd(input.compareStartDate);
      const cFrozen = cWhole ? closed.find((c) => c.periodMonth.slice(0, 7) === input.compareStartDate!.slice(0, 7)) ?? null : null;
      comparison = {
        startDate: input.compareStartDate,
        endDate: input.compareEndDate,
        summary: cFrozen ? windowOut({ ...cFrozen }) : windowOut(cw),
      };
    }

    // Remaining per funding, up to the end of the period.
    const fifo = allocateFifo(end ? movements.filter((m) => m.at.getTime() <= end.getTime()) : movements);

    return {
      user,
      period: { view: input.view, startDate, endDate },
      summary,
      frozen: !!frozen,
      overlapsClosed: overlapsClosed && !frozen,
      closedPeriod,
      priorCorrection,
      toDate: {
        ...windowOut(toDate),
        pendingExpenses: money(pendingExpenses),
        pendingRefunds: money(pendingRefunds),
        available: money(derivedAvailable),
      },
      check: {
        // Totals AND rows must agree: two errors can cancel out in the total.
        ok: Math.abs(derivedAvailable - systemAvailable) < 0.01 && checkItems.length === 0,
        systemAvailable: money(systemAvailable),
        derivedAvailable: money(derivedAvailable),
        difference: money(derivedAvailable - systemAvailable),
        components,
        items: checkItems.slice(0, 100),
        itemCount: checkItems.length,
      },
      comparison,
      breakdown,
      movements: rows,
      holds: holds.map((h) => ({
        id: h.id, kind: h.kind, reference: h.reference, date: h.at.toISOString(), amount: money(h.amount),
        status: h.status, description: h.description, counterpartyName: h.counterpartyName,
      })),
      funders: fifo.sources.map((s) => ({
        ...s,
        at: s.at.toISOString(),
        amount: money(s.amount),
        refunded: money(s.refunded),
        used: money(s.used),
        remaining: money(s.remaining),
      })),
      overdraft: money(fifo.overdraft),
      closedMonths: closed.map((c) => ({ month: c.periodMonth.slice(0, 7), closing: money(c.closing), closedAt: c.closedAt.toISOString() })),
    };
  }

  /**
   * Funding Ledger rows (the existing page), from the same movements as the
   * reconciliation. Holds and requests appear with no balance effect.
   */
  async getLedger(input: FundingLedgerInput, actor: SessionUser, ctx: ScopeCtx) {
    await this.assertCanView(actor, input.userId, ctx);
    const [{ movements, holds }, closed] = await Promise.all([this.loadMovements(input.userId), this.loadClosedRows(input.userId)]);
    const start = input.startDate ? lagosDayStart(input.startDate.slice(0, 10)) : null;
    const end = input.endDate ? lagosDayEnd(input.endDate.slice(0, 10)) : null;
    const baseline = closed[0] ? toBaseline(closed[0]) : null;
    const window = computeWindowWithClose(movements, start, end, baseline);
    const effective = window.usesClose && baseline ? applyCloseBaseline(movements, baseline).movements : movements;

    const requests = await this.db
      .select({
        id: schema.marketingFundingRequests.id,
        amount: schema.marketingFundingRequests.amount,
        status: schema.marketingFundingRequests.status,
        reason: schema.marketingFundingRequests.reason,
        createdAt: schema.marketingFundingRequests.createdAt,
      })
      .from(schema.marketingFundingRequests)
      .where(eq(schema.marketingFundingRequests.requesterId, input.userId));

    type Entry = {
      id: string;
      entryType: string;
      reference: string;
      eventDate: Date;
      amount: number;
      balanceEffect: number;
      runningBalance: number;
      status: string;
      description: string;
      counterpartyName: string | null;
      sortKey: number;
    };
    const inRange = (d: Date) => (!start || d.getTime() >= start.getTime()) && (!end || d.getTime() <= end.getTime());
    const typeOf = (k: FundingMovement['kind']) =>
      k === 'funding_in' ? 'transfer_in'
        : k === 'funding_out' ? 'transfer_out'
          : k === 'adjustment_credit' || k === 'adjustment_debit' ? 'adjustment'
            : k;

    const entries: Entry[] = [];
    let running = window.opening;
    for (const m of sortMovements(effective)) {
      if (!inRange(m.at)) continue;
      running = kobo(running + m.effect);
      entries.push({
        id: m.id, entryType: typeOf(m.kind), reference: m.reference, eventDate: m.at, amount: m.amount,
        balanceEffect: m.effect, runningBalance: running, status: m.status, description: m.description,
        counterpartyName: m.counterpartyName, sortKey: 0,
      });
    }
    for (const h of holds) {
      if (!inRange(h.at)) continue;
      entries.push({
        id: h.id, entryType: h.kind, reference: h.reference, eventDate: h.at, amount: h.amount, balanceEffect: 0,
        runningBalance: 0, status: h.status, description: `On hold: ${h.description}`, counterpartyName: h.counterpartyName, sortKey: 1,
      });
    }
    for (const q of requests) {
      if (!inRange(q.createdAt)) continue;
      entries.push({
        id: q.id, entryType: 'request', reference: requestRef(q.id), eventDate: q.createdAt, amount: Number(q.amount),
        balanceEffect: 0, runningBalance: 0, status: q.status, description: q.reason ?? 'Funding request', counterpartyName: null, sortKey: 1,
      });
    }
    entries.sort((x, y) => x.eventDate.getTime() - y.eventDate.getTime() || x.sortKey - y.sortKey || x.id.localeCompare(y.id));
    // Info rows show the balance as it stood at that moment.
    let last = window.opening;
    for (const e of entries) {
      if (e.sortKey === 0) last = e.runningBalance;
      else e.runningBalance = last;
    }

    const wanted = input.entryType;
    const filtered = entries.filter((e) => {
      if (wanted === 'all') return true;
      if (wanted === 'refund') return e.entryType === 'refund_in' || e.entryType === 'refund_out';
      if (wanted === 'adjustment') return e.entryType === 'adjustment' || e.entryType === 'correction';
      return e.entryType === wanted;
    });
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / input.limit));
    const offset = (input.page - 1) * input.limit;
    const totalCredits = entries.reduce((s, e) => s + (e.balanceEffect > 0 ? e.balanceEffect : 0), 0);
    const totalDebits = entries.reduce((s, e) => s + (e.balanceEffect < 0 ? -e.balanceEffect : 0), 0);

    return {
      entries: filtered.slice(offset, offset + input.limit).map((e) => ({
        id: e.id,
        entryType: e.entryType,
        reference: e.reference,
        eventDate: e.eventDate.toISOString(),
        amount: String(e.amount),
        balanceEffect: e.balanceEffect,
        runningBalance: e.runningBalance,
        status: e.status,
        description: e.description,
        counterpartyName: e.counterpartyName,
      })),
      total,
      page: input.page,
      totalPages,
      summary: {
        totalCredits: String(kobo(totalCredits)),
        totalDebits: String(kobo(totalDebits)),
        openingBalance: String(window.opening),
        closingBalance: String(window.closing),
        onHold: String(kobo(holds.reduce((s, h) => s + h.amount, 0))),
      },
    };
  }

  // ── Month close ───────────────────────────────────────────────────────────

  private async companyBranchIds(groupId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.groupId, groupId));
    return rows.map((r) => r.id);
  }

  async listCloses(actor: SessionUser) {
    const groupId = actor.activeGroupId ?? null;
    if (!groupId) return { groupId: null, closes: [], nextMonth: null as string | null, closableMonths: [] as string[] };
    const pc = schema.marketingFundingPeriodCloses;
    const closer = alias(schema.users, 'closer');
    const rows = await this.db
      .select({
        id: pc.id, periodMonth: pc.periodMonth, closedAt: pc.closedAt, closedByName: closer.name,
        userCount: pc.userCount, totalClosing: pc.totalClosing, note: pc.note,
      })
      .from(pc)
      .leftJoin(closer, eq(closer.id, pc.closedBy))
      .where(eq(pc.groupId, groupId))
      .orderBy(desc(pc.periodMonth));
    const latest = rows[0] ? String(rows[0].periodMonth) : null;
    const lastFullMonth = addMonths(monthStart(lagosYmd(new Date())), -1);
    const nextMonth = latest ? addMonths(latest, 1) : lastFullMonth;
    // Once a month is closed, only the next one can follow (no gaps). Before the
    // first close, Finance picks where to start: any of the last 24 finished months.
    const closableMonths: string[] = [];
    if (latest) {
      if (nextMonth <= lastFullMonth) closableMonths.push(nextMonth.slice(0, 7));
    } else {
      for (let i = 0; i < 24; i++) closableMonths.push(addMonths(lastFullMonth, -i).slice(0, 7));
    }
    return {
      groupId,
      closes: rows.map((r) => ({ ...r, periodMonth: String(r.periodMonth).slice(0, 7), closedAt: r.closedAt.toISOString() })),
      nextMonth: nextMonth <= lastFullMonth ? nextMonth.slice(0, 7) : null,
      closableMonths,
    };
  }

  /**
   * Close a month for the active company: freeze every recipient's figures for
   * it. Months close in order (no gaps), only once they have fully ended. The
   * unique (company, month) index makes a double click fail rather than close twice.
   */
  async closePeriod(input: CloseFundingPeriodInput, actor: SessionUser) {
    const groupId = actor.activeGroupId ?? null;
    if (!groupId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select a company in the top bar before closing a month.' });
    }
    const month = `${input.month}-01`;
    const monthLast = monthEnd(month);
    if (lagosDayEnd(monthLast).getTime() >= Date.now()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'A month can only be closed after it has ended.' });
    }
    const pc = schema.marketingFundingPeriodCloses;
    const [latest] = await this.db
      .select({ periodMonth: pc.periodMonth })
      .from(pc)
      .where(eq(pc.groupId, groupId))
      .orderBy(desc(pc.periodMonth))
      .limit(1);
    if (latest) {
      const expected = addMonths(String(latest.periodMonth), 1);
      if (month !== expected) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            month <= String(latest.periodMonth)
              ? `${input.month} is already closed.`
              : `Close ${expected.slice(0, 7)} first. Months close in order.`,
        });
      }
    }

    // Recipients in this company: Media Buyers and Heads of Marketing.
    const branchIds = await this.companyBranchIds(groupId);
    if (branchIds.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This company has no branches.' });
    const recipients = await this.db
      .selectDistinct({ id: schema.users.id })
      .from(schema.users)
      .leftJoin(schema.userBranches, eq(schema.userBranches.userId, schema.users.id))
      .where(
        and(
          inArray(schema.users.role, ['MEDIA_BUYER', 'HEAD_OF_MARKETING']),
          or(inArray(schema.userBranches.branchId, branchIds), inArray(schema.users.primaryBranchId, branchIds)),
        ),
      );

    // Anything changed from here on is flagged as "changed since close".
    const closedAt = new Date();
    const start = lagosDayStart(month);
    const end = lagosDayEnd(monthLast);
    const balances: Array<{ userId: string; w: FundingWindow; pendingExpenses: number; pendingRefunds: number }> = [];
    const ids = recipients.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      const results = await Promise.all(
        chunk.map(async (userId) => {
          const [{ movements, holds }, closed] = await Promise.all([this.loadMovements(userId), this.loadClosedRows(userId)]);
          const prev = closed.find((c) => c.periodMonth.slice(0, 10) < month) ?? null;
          const w = computeWindowWithClose(movements, start, end, prev ? toBaseline(prev) : null);
          const heldAtEnd = holds.filter((h) => h.at.getTime() <= end.getTime());
          return {
            userId,
            w,
            hasActivity: movements.some((m) => m.at.getTime() <= end.getTime()) || heldAtEnd.length > 0,
            pendingExpenses: heldAtEnd.filter((h) => h.kind === 'expense').reduce((s, h) => s + h.amount, 0),
            pendingRefunds: heldAtEnd.filter((h) => h.kind === 'refund_out').reduce((s, h) => s + h.amount, 0),
          };
        }),
      );
      for (const r of results) if (r.hasActivity) balances.push(r);
    }

    const closeId = uuidv7();
    const totalClosing = kobo(balances.reduce((s, b) => s + b.w.closing, 0));
    try {
      await withActor(this.db, { id: actor.id }, async (tx) => {
        await tx.insert(pc).values({
          id: closeId,
          groupId,
          periodMonth: month,
          closedBy: actor.id,
          closedAt,
          userCount: balances.length,
          totalClosing: sql`${totalClosing}::numeric`,
          note: input.note?.trim() || null,
        });
        for (let i = 0; i < balances.length; i += 200) {
          await tx.insert(schema.marketingFundingPeriodBalances).values(
            balances.slice(i, i + 200).map((b) => ({
              id: uuidv7(),
              closeId,
              userId: b.userId,
              opening: sql`${kobo(b.w.opening)}::numeric`,
              received: sql`${kobo(b.w.received)}::numeric`,
              distributed: sql`${kobo(b.w.distributed)}::numeric`,
              expenses: sql`${kobo(b.w.expenses)}::numeric`,
              refundsOut: sql`${kobo(b.w.refundsOut)}::numeric`,
              refundsIn: sql`${kobo(b.w.refundsIn)}::numeric`,
              credits: sql`${kobo(b.w.credits)}::numeric`,
              debits: sql`${kobo(b.w.debits)}::numeric`,
              corrections: sql`${kobo(b.w.corrections)}::numeric`,
              closing: sql`${kobo(b.w.closing)}::numeric`,
              pendingExpenses: sql`${kobo(b.pendingExpenses)}::numeric`,
              pendingRefunds: sql`${kobo(b.pendingRefunds)}::numeric`,
            })),
          );
        }
      });
    } catch (err) {
      if (err instanceof Error && /marketing_funding_period_closes_group_month_uq/.test(err.message + String((err as { cause?: unknown }).cause ?? ''))) {
        throw new TRPCError({ code: 'CONFLICT', message: `${input.month} was just closed by someone else.` });
      }
      throw err;
    }
    return { id: closeId, month: input.month, userCount: balances.length, totalClosing: String(totalClosing) };
  }

  /** Recipients the caller may reconcile (picker). */
  async listReconcilableUsers(actor: SessionUser, ctx: ScopeCtx) {
    const scope = await this.deps.getScopeUserIds(actor, ctx.effectiveBranchIds);
    const canAll =
      isAdminLevel(actor) ||
      actor.role === 'HEAD_OF_MARKETING' ||
      hasPermission(actor, 'marketing.funding.reconcile') ||
      (hasFinanceAccess(actor) && actor.role !== 'MEDIA_BUYER');
    let ids: string[] | null = scope;
    if (!canAll) {
      const supervised = ctx.currentBranchId
        ? await this.deps.branchTeams.listSupervisedUserIds(actor.id, ctx.currentBranchId, 'MARKETING')
        : [];
      ids = [actor.id, ...supervised].filter((id) => !scope || scope.includes(id) || id === actor.id);
    }
    if (ids && ids.length === 0) return [];
    const rows = await this.db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, status: schema.users.status })
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.role, ['MEDIA_BUYER', 'HEAD_OF_MARKETING']),
          ids ? inArray(schema.users.id, ids) : undefined,
        ),
      )
      .orderBy(asc(schema.users.name));
    return rows;
  }
}
