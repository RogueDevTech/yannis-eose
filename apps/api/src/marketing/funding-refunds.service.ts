import type { Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, ilike, inArray, or, sql, sum, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, canonicalPermissionCode } from '@yannis/shared';
import type {
  CreateFundingAdjustmentInput,
  ListFundingAdjustmentsInput,
  ListFundingRefundsInput,
  RequestFundingRefundInput,
  ReviewFundingAdjustmentInput,
  ReviewFundingRefundInput,
} from '@yannis/shared';
import { uuidv7 } from 'uuidv7';
import type { EventsService } from '../events/events.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { GeneralLedgerService } from '../finance/general-ledger.service';
import { runGlPostWithFinanceAlert } from '../finance/gl-posting-notify';
import { withActor, type Tx } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevel } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import { lockFundingBalance } from './funding-balance-terms';

type Db = PostgresJsDatabase<typeof schema>;

/** Roles that disburse company money rather than a personal marketing wallet. */
const COMPANY_FUNDER_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER']);

export interface FundingRefundsDeps {
  db: Db;
  events: EventsService;
  notifications: NotificationsService;
  generalLedger: GeneralLedgerService;
  logger: Logger;
  /** The person's available balance, same formula as the wallet checks (holds included). */
  computeAvailableInTx: (tx: Tx, userId: string) => Promise<number>;
  /** Users in the caller's company scope; null = global caller with no company selected. Fail-closed. */
  getScopeUserIds: (actor: SessionUser, effectiveBranchIds: string[] | null | undefined) => Promise<string[] | null>;
}

const naira = (n: number) =>
  `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const toKobo = (n: number) => Math.round(n * 100);

/** RF-XXXXXXXXXX: the random tail of a UUIDv7 (40 bits), so it never collides in practice. */
function makeReference(prefix: 'RF' | 'ADJ', id: string): string {
  return `${prefix}-${id.replace(/-/g, '').slice(-10).toUpperCase()}`;
}

/**
 * Funding reference shown on refunds, the ledger and the reconciliation. Uses
 * the random tail of the UUIDv7: its first characters are a timestamp, so a
 * prefix-based code repeats across every funding sent within hours.
 */
export function fundingTxnReference(fundingId: string): string {
  return `TXN-${fundingId.replace(/-/g, '').slice(-8).toUpperCase()}`;
}

function hasPermission(actor: SessionUser, code: string): boolean {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'SUPPORT') return true;
  const want = canonicalPermissionCode(code);
  return (actor.permissions ?? []).some((p) => p === code || canonicalPermissionCode(p) === want);
}

/**
 * Funding refunds (ticket 1) and adjustments (ticket 2), mig 0361.
 *
 * Refund lifecycle: PENDING -> APPROVED -> COMPLETED, or REJECTED / CANCELLED.
 * Balances are derived from rows (see funding-balance-terms.ts), so the
 * "deduct one side, credit the other" step is a single status update inside one
 * transaction: it cannot half-apply.
 */
export class FundingRefundsService {
  constructor(private readonly deps: FundingRefundsDeps) {}

  private get db() {
    return this.deps.db;
  }

  /** Companies (branch groups) a user belongs to, via branch membership or primary branch. */
  private async userGroupIds(tx: Tx, userId: string): Promise<string[]> {
    const rows = await tx.execute<{ group_id: string }>(sql`
      SELECT DISTINCT b.group_id
      FROM branches b
      WHERE b.group_id IS NOT NULL
        AND (
          b.id IN (SELECT ub.branch_id FROM user_branches ub WHERE ub.user_id = ${userId})
          OR b.id = (SELECT u.primary_branch_id FROM users u WHERE u.id = ${userId})
        )
    `);
    return (rows as unknown as Array<{ group_id: string }>).map((r) => r.group_id);
  }

  // ── Refunds ───────────────────────────────────────────────────────────────

  /**
   * The caller's fundings that can still be refunded: marked Received, not
   * reversed, with an amount left after earlier refunds (completed or open).
   */
  async listRefundableFundings(actor: SessionUser) {
    const f = schema.marketingFunding;
    const r = schema.marketingFundingRefunds;
    const sender = alias(schema.users, 'sender');
    const committed = sql<string>`COALESCE((
      SELECT SUM(${r.amount}) FROM ${r}
      WHERE ${r.fundingId} = ${f.id} AND ${r.status} IN ('PENDING', 'APPROVED', 'COMPLETED')
    ), 0)`;
    const rows = await this.db
      .select({
        id: f.id,
        amount: f.amount,
        sentAt: f.sentAt,
        verifiedAt: f.verifiedAt,
        notes: f.notes,
        senderId: f.senderId,
        senderName: sender.name,
        senderRole: sender.role,
        committed,
      })
      .from(f)
      .leftJoin(sender, eq(sender.id, f.senderId))
      .where(and(eq(f.receiverId, actor.id), eq(f.status, 'COMPLETED')))
      .orderBy(desc(f.verifiedAt), desc(f.sentAt))
      .limit(200);

    const available = await this.db.transaction((tx) => this.deps.computeAvailableInTx(tx, actor.id));

    return {
      available: String(Math.max(0, available)),
      fundings: rows
        .map((row) => {
          const refundable = Number(row.amount) - Number(row.committed);
          return {
            id: row.id,
            reference: fundingTxnReference(row.id),
            amount: row.amount,
            alreadyRefunded: String(Number(row.committed)),
            refundable: String(Math.max(0, refundable)),
            receivedAt: (row.verifiedAt ?? row.sentAt).toISOString(),
            funderId: row.senderId,
            funderName: row.senderName ?? 'Unknown',
            notes: row.notes,
          };
        })
        .filter((row) => Number(row.refundable) > 0),
    };
  }

  /** Company rule: shared membership of refunder and funder, not the top-bar selection. */
  async requestRefund(input: RequestFundingRefundInput, actor: SessionUser) {
    const reason = input.reason.trim();

    const refund = await withActor(this.db, { id: actor.id }, async (tx) => {
      // Row lock on the original funding: two refund requests against the same
      // funding serialise here, so they cannot both pass the "refundable" check.
      const [funding] = await tx
        .select()
        .from(schema.marketingFunding)
        .where(eq(schema.marketingFunding.id, input.fundingId))
        .limit(1)
        .for('update');
      if (!funding || funding.receiverId !== actor.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Funding not found. You can only refund funding you received.' });
      }
      if (funding.status !== 'COMPLETED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            funding.status === 'SENT'
              ? 'Mark this funding Received before refunding it.'
              : 'Only funding you marked Received can be refunded.',
        });
      }

      const [funder] = await tx
        .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, funding.senderId))
        .limit(1);
      if (!funder) throw new TRPCError({ code: 'NOT_FOUND', message: 'The original funder no longer exists.' });

      // Company boundary: refunder and funder must share a company, so money never
      // moves between companies' balances. Works whether a Media Buyer belongs to
      // one company or several. Company-money funders (Admin / Finance) with no
      // branch membership act for every company.
      const [refunderGroups, funderGroups] = await Promise.all([
        this.userGroupIds(tx, actor.id),
        this.userGroupIds(tx, funder.id),
      ]);
      let groupId: string | null = null;
      if (funderGroups.length === 0 && COMPANY_FUNDER_ROLES.has(funder.role)) {
        groupId =
          actor.activeGroupId && refunderGroups.includes(actor.activeGroupId)
            ? actor.activeGroupId
            : (refunderGroups[0] ?? null);
      } else {
        const shared = refunderGroups.filter((g) => funderGroups.includes(g));
        if (shared.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You and this funder are not in the same company, so this refund is not allowed.',
          });
        }
        groupId = actor.activeGroupId && shared.includes(actor.activeGroupId) ? actor.activeGroupId : shared[0]!;
      }

      // Same lock as every balance-checked write for this person.
      await lockFundingBalance(tx, actor.id);

      const [committedRow] = await tx
        .select({ total: sum(schema.marketingFundingRefunds.amount) })
        .from(schema.marketingFundingRefunds)
        .where(
          and(
            eq(schema.marketingFundingRefunds.fundingId, funding.id),
            inArray(schema.marketingFundingRefunds.status, ['PENDING', 'APPROVED', 'COMPLETED']),
          ),
        );
      const refundableOnFunding = Number(funding.amount) - Number(committedRow?.total ?? 0);
      const available = await this.deps.computeAvailableInTx(tx, actor.id);

      if (toKobo(input.amount) > toKobo(refundableOnFunding)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            refundableOnFunding <= 0
              ? 'This funding has already been fully refunded or has refunds waiting.'
              : `You can refund at most ${naira(refundableOnFunding)} of this funding.`,
        });
      }
      if (toKobo(input.amount) > toKobo(available)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `You can refund at most your unspent balance: ${naira(Math.max(0, available))}.`,
        });
      }

      const id = uuidv7();
      const [inserted] = await tx
        .insert(schema.marketingFundingRefunds)
        .values({
          id,
          reference: makeReference('RF', id),
          fundingId: funding.id,
          refunderId: actor.id,
          funderId: funder.id,
          groupId,
          amount: sql`${input.amount}::numeric`,
          currencyCode: 'NGN',
          reason,
          receiptUrl: input.receiptUrl ?? null,
          status: 'PENDING',
        })
        .returning();
      if (!inserted) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to record refund' });
      return { ...inserted, funderRole: funder.role };
    });

    const body = `${actor.name} wants to return ${naira(input.amount)} of your funding ${fundingTxnReference(refund.fundingId)}. Ref ${refund.reference}. Status: Pending your approval.`;
    const data = { refundId: refund.id, reference: refund.reference, amount: refund.amount, status: refund.status };
    this.deps.notifications.enqueueCreate({
      userId: refund.funderId,
      type: 'funding:refund_requested',
      title: 'Refund requested',
      body,
      data,
    });
    if (COMPANY_FUNDER_ROLES.has(refund.funderRole) && refund.funderRole !== 'FINANCE_OFFICER') {
      // Company money went out; Finance confirms it came back.
      this.deps.notifications.enqueueCreateForRole(
        'FINANCE_OFFICER',
        { type: 'funding:refund_requested', title: 'Refund requested', body, data },
        actor.activeGroupId ?? null,
      );
    }
    this.deps.events.emitToUser(refund.funderId, 'funding:refund', data);
    const { funderRole: _r, ...row } = refund;
    return row;
  }

  /** Funder (or Admin, or Finance for company money) may act; the refunder never. */
  private async assertCanActAsFunder(
    tx: Tx,
    actor: SessionUser,
    refund: typeof schema.marketingFundingRefunds.$inferSelect,
    scope: string[] | null,
  ): Promise<void> {
    if (actor.id === refund.refunderId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'The person returning the money cannot approve their own refund.' });
    }
    if (actor.id === refund.funderId) return;
    const inScope = !scope || scope.includes(refund.refunderId);
    if (isAdminLevel(actor) && inScope) return;
    const [funder] = await tx
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, refund.funderId))
      .limit(1);
    const companyMoney = !!funder && COMPANY_FUNDER_ROLES.has(funder.role);
    if (companyMoney && inScope && hasFinanceAccess(actor) && actor.role !== 'AUDITOR') return;
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the original funder can review this refund.' });
  }

  private async lockRefund(tx: Tx, refundId: string) {
    const [row] = await tx
      .select()
      .from(schema.marketingFundingRefunds)
      .where(eq(schema.marketingFundingRefunds.id, refundId))
      .limit(1)
      .for('update');
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Refund not found' });
    return row;
  }

  async reviewRefund(input: ReviewFundingRefundInput, actor: SessionUser, effectiveBranchIds?: string[] | null) {
    const scope = await this.deps.getScopeUserIds(actor, effectiveBranchIds);
    const updated = await withActor(this.db, { id: actor.id }, async (tx) => {
      const refund = await this.lockRefund(tx, input.refundId);
      await this.assertCanActAsFunder(tx, actor, refund, scope);
      if (refund.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `This refund is already ${refund.status.toLowerCase()}.` });
      }
      const [row] = await tx
        .update(schema.marketingFundingRefunds)
        .set({
          status: input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: input.note?.trim() || null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.marketingFundingRefunds.id, refund.id), eq(schema.marketingFundingRefunds.status, 'PENDING')))
        .returning();
      if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Refund changed while saving. Refresh and try again.' });
      return row;
    });

    const approved = updated.status === 'APPROVED';
    const data = { refundId: updated.id, reference: updated.reference, amount: updated.amount, status: updated.status };
    this.deps.notifications.enqueueCreate({
      userId: updated.refunderId,
      type: approved ? 'funding:refund_approved' : 'funding:refund_rejected',
      title: approved ? 'Refund approved' : 'Refund rejected',
      body: approved
        ? `Your refund ${updated.reference} of ${naira(Number(updated.amount))} was approved. Send the money back; it completes when ${actor.name} confirms it arrived. Status: Approved.`
        : `Your refund ${updated.reference} of ${naira(Number(updated.amount))} was rejected: ${updated.reviewNote ?? ''}. The amount is back in your balance. Status: Rejected.`,
      data,
    });
    this.deps.events.emitToUser(updated.refunderId, 'funding:refund', data);
    return updated;
  }

  /**
   * The funder confirms the money arrived. One transaction: the refund flips
   * to COMPLETED, which (by the shared balance formula) debits the refunder
   * and credits the funder together. Both balances are locked first, in id
   * order, so concurrent writes for either person wait.
   */
  async completeRefund(refundId: string, actor: SessionUser, effectiveBranchIds?: string[] | null) {
    const scope = await this.deps.getScopeUserIds(actor, effectiveBranchIds);
    const { refund, funding } = await withActor(this.db, { id: actor.id }, async (tx) => {
      const found = await this.lockRefund(tx, refundId);
      await this.assertCanActAsFunder(tx, actor, found, scope);
      if (found.status !== 'APPROVED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: found.status === 'PENDING' ? 'Approve the refund first.' : `This refund is already ${found.status.toLowerCase()}.`,
        });
      }
      for (const id of [found.refunderId, found.funderId].sort()) await lockFundingBalance(tx, id);

      const [orig] = await tx
        .select()
        .from(schema.marketingFunding)
        .where(eq(schema.marketingFunding.id, found.fundingId))
        .limit(1)
        .for('update');
      if (!orig || orig.status !== 'COMPLETED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The original funding is no longer marked Received.' });
      }
      const [committed] = await tx
        .select({ total: sum(schema.marketingFundingRefunds.amount) })
        .from(schema.marketingFundingRefunds)
        .where(
          and(
            eq(schema.marketingFundingRefunds.fundingId, orig.id),
            inArray(schema.marketingFundingRefunds.status, ['PENDING', 'APPROVED', 'COMPLETED']),
          ),
        );
      if (toKobo(Number(committed?.total ?? 0)) > toKobo(Number(orig.amount))) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Refunds on this funding exceed its amount. Contact an admin.' });
      }

      const [row] = await tx
        .update(schema.marketingFundingRefunds)
        .set({ status: 'COMPLETED', completedBy: actor.id, completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.marketingFundingRefunds.id, found.id), eq(schema.marketingFundingRefunds.status, 'APPROVED')))
        .returning();
      if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Refund changed while saving. Refresh and try again.' });
      return { refund: row, funding: orig };
    });

    // The original disbursement was expensed in the GL when it came from a
    // funding request; return this part. Non-fatal, Finance is alerted on failure.
    if (funding.sourceFundingRequestId) {
      const requestId = funding.sourceFundingRequestId;
      await runGlPostWithFinanceAlert(
        this.deps.notifications,
        this.deps.logger,
        'Marketing funding refund',
        refund.id,
        () => this.deps.generalLedger.postMarketingFundingRefund(refund.id, requestId, Number(refund.amount), { id: actor.id }),
      );
    }

    const data = { refundId: refund.id, reference: refund.reference, amount: refund.amount, status: refund.status };
    const amt = naira(Number(refund.amount));
    this.deps.notifications.enqueueCreate({
      userId: refund.refunderId,
      type: 'funding:refund_completed',
      title: 'Refund completed',
      body: `${amt} returned to your funder is confirmed. Ref ${refund.reference}. Status: Completed.`,
      data,
    });
    this.deps.notifications.enqueueCreate({
      userId: refund.funderId,
      type: 'funding:refund_completed',
      title: 'Refund completed',
      body: `${amt} refund ${refund.reference} is complete and credited to your funding balance. Status: Completed.`,
      data,
    });
    this.deps.events.emitToUser(refund.refunderId, 'funding:refund', data);
    this.deps.events.emitToUser(refund.funderId, 'funding:refund', data);
    return refund;
  }

  /** The refunder withdraws a refund that is not complete yet; the hold is released. */
  async cancelRefund(refundId: string, actor: SessionUser) {
    const row = await withActor(this.db, { id: actor.id }, async (tx) => {
      const found = await this.lockRefund(tx, refundId);
      if (found.refunderId !== actor.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the person who requested the refund can cancel it.' });
      }
      if (found.status !== 'PENDING' && found.status !== 'APPROVED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `This refund is already ${found.status.toLowerCase()}.` });
      }
      const [updated] = await tx
        .update(schema.marketingFundingRefunds)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.marketingFundingRefunds.id, found.id), eq(schema.marketingFundingRefunds.status, found.status)))
        .returning();
      if (!updated) throw new TRPCError({ code: 'CONFLICT', message: 'Refund changed while saving. Refresh and try again.' });
      return updated;
    });
    const data = { refundId: row.id, reference: row.reference, amount: row.amount, status: row.status };
    this.deps.notifications.enqueueCreate({
      userId: row.funderId,
      type: 'funding:refund_rejected',
      title: 'Refund cancelled',
      body: `${actor.name} cancelled refund ${row.reference} of ${naira(Number(row.amount))}. Status: Cancelled.`,
      data,
    });
    this.deps.events.emitToUser(row.funderId, 'funding:refund', data);
    return row;
  }

  async listRefunds(input: ListFundingRefundsInput, actor: SessionUser, effectiveBranchIds?: string[] | null) {
    const r = schema.marketingFundingRefunds;
    const refunder = alias(schema.users, 'refunder');
    const funder = alias(schema.users, 'funder');
    const reviewer = alias(schema.users, 'reviewer');
    const completer = alias(schema.users, 'completer');

    let viewCond: SQL | undefined;
    if (input.view === 'mine') {
      viewCond = eq(r.refunderId, actor.id);
    } else {
      const scope = await this.deps.getScopeUserIds(actor, effectiveBranchIds);
      const scopeCond = scope ? or(inArray(r.refunderId, scope.length ? scope : [actor.id]), eq(r.funderId, actor.id)) : undefined;
      if (input.view === 'to_review') {
        const companyFunders = sql`${r.funderId} IN (SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'))`;
        if (isAdminLevel(actor)) {
          // Admin may act on any refund in their company (global admin: all).
          viewCond = scope ? or(eq(r.funderId, actor.id), inArray(r.refunderId, scope.length ? scope : [actor.id])) : undefined;
        } else if (hasFinanceAccess(actor) && actor.role !== 'AUDITOR') {
          // Finance confirms company money coming back.
          viewCond = or(eq(r.funderId, actor.id), and(scopeCond, companyFunders));
        } else {
          viewCond = eq(r.funderId, actor.id);
        }
      } else {
        if (!isAdminLevel(actor) && !hasPermission(actor, 'marketing.funding.reconcile')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot view every refund.' });
        }
        viewCond = scopeCond;
      }
    }

    const search = input.search?.trim();
    const searchCond = search
      ? or(
          ilike(r.reference, `%${search}%`),
          ilike(refunder.name, `%${search}%`),
          ilike(funder.name, `%${search}%`),
          ilike(r.reason, `%${search}%`),
        )
      : undefined;
    const baseWhere = and(viewCond, searchCond);
    const where = and(baseWhere, input.status ? eq(r.status, input.status) : undefined);

    const [rows, totalRow, statusRows] = await Promise.all([
      this.db
        .select({
          id: r.id,
          reference: r.reference,
          fundingId: r.fundingId,
          fundingAmount: schema.marketingFunding.amount,
          fundingSentAt: schema.marketingFunding.sentAt,
          fundingReceivedAt: schema.marketingFunding.verifiedAt,
          refunderId: r.refunderId,
          refunderName: refunder.name,
          funderId: r.funderId,
          funderName: funder.name,
          amount: r.amount,
          currencyCode: r.currencyCode,
          reason: r.reason,
          receiptUrl: r.receiptUrl,
          status: r.status,
          requestedAt: r.requestedAt,
          reviewedAt: r.reviewedAt,
          reviewedByName: reviewer.name,
          reviewNote: r.reviewNote,
          completedAt: r.completedAt,
          completedByName: completer.name,
          cancelledAt: r.cancelledAt,
        })
        .from(r)
        .innerJoin(schema.marketingFunding, eq(schema.marketingFunding.id, r.fundingId))
        .leftJoin(refunder, eq(refunder.id, r.refunderId))
        .leftJoin(funder, eq(funder.id, r.funderId))
        .leftJoin(reviewer, eq(reviewer.id, r.reviewedBy))
        .leftJoin(completer, eq(completer.id, r.completedBy))
        .where(where)
        .orderBy(desc(r.requestedAt))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      this.db
        .select({ c: count(), total: sum(r.amount) })
        .from(r)
        .leftJoin(refunder, eq(refunder.id, r.refunderId))
        .leftJoin(funder, eq(funder.id, r.funderId))
        .where(where),
      this.db
        .select({ status: r.status, c: count() })
        .from(r)
        .leftJoin(refunder, eq(refunder.id, r.refunderId))
        .leftJoin(funder, eq(funder.id, r.funderId))
        .where(baseWhere)
        .groupBy(r.status),
    ]);

    const statusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, COMPLETED: 0, CANCELLED: 0 } as Record<string, number>;
    for (const s of statusRows) statusCounts[s.status] = Number(s.c);

    return {
      records: rows.map((row) => ({
        ...row,
        fundingReference: fundingTxnReference(row.fundingId),
        fundingSentAt: row.fundingSentAt.toISOString(),
        fundingReceivedAt: row.fundingReceivedAt?.toISOString() ?? null,
        requestedAt: row.requestedAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        canReview: input.view === 'to_review' && row.refunderId !== actor.id,
      })),
      pagination: { page: input.page, limit: input.limit, total: Number(totalRow[0]?.c ?? 0) },
      filteredTotalAmount: totalRow[0]?.total ?? '0',
      statusCounts,
    };
  }

  // ── Adjustments ───────────────────────────────────────────────────────────

  async createAdjustment(input: CreateFundingAdjustmentInput, actor: SessionUser, effectiveBranchIds?: string[] | null) {
    const scope = await this.deps.getScopeUserIds(actor, effectiveBranchIds);
    if (scope && !scope.includes(input.userId)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'That person is not in your company.' });
    }
    const row = await withActor(this.db, { id: actor.id }, async (tx) => {
      const [target] = await tx
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, input.userId))
        .limit(1);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      if (input.relatedFundingId) {
        const [f] = await tx
          .select({ senderId: schema.marketingFunding.senderId, receiverId: schema.marketingFunding.receiverId })
          .from(schema.marketingFunding)
          .where(eq(schema.marketingFunding.id, input.relatedFundingId))
          .limit(1);
        if (!f || (f.senderId !== input.userId && f.receiverId !== input.userId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'The related funding does not involve this person.' });
        }
      }
      const id = uuidv7();
      const [inserted] = await tx
        .insert(schema.marketingFundingAdjustments)
        .values({
          id,
          reference: makeReference('ADJ', id),
          userId: input.userId,
          direction: input.direction,
          amount: sql`${input.amount}::numeric`,
          currencyCode: 'NGN',
          reason: input.reason.trim(),
          relatedFundingId: input.relatedFundingId ?? null,
          relatedPeriodMonth: input.relatedPeriodMonth ? `${input.relatedPeriodMonth}-01` : null,
          status: 'PENDING',
          requestedBy: actor.id,
        })
        .returning();
      if (!inserted) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to record adjustment' });
      return { ...inserted, targetName: target.name };
    });

    const payload = {
      type: 'funding:adjustment' as const,
      title: 'Funding adjustment needs approval',
      body: `${actor.name} requested a ${row.direction.toLowerCase()} of ${naira(Number(row.amount))} on ${row.targetName}'s funding balance. Ref ${row.reference}. A different approver must review it.`,
      data: { adjustmentId: row.id, reference: row.reference, amount: row.amount, status: row.status },
    };
    this.deps.notifications.enqueueCreateForRole('FINANCE_OFFICER', payload, actor.activeGroupId ?? null);
    this.deps.notifications.enqueueCreateForRole('ADMIN', payload, actor.activeGroupId ?? null);
    const { targetName: _t, ...out } = row;
    return out;
  }

  /** Four eyes: the approver must not be the person who requested it. */
  async reviewAdjustment(input: ReviewFundingAdjustmentInput, actor: SessionUser, effectiveBranchIds?: string[] | null) {
    const scope = await this.deps.getScopeUserIds(actor, effectiveBranchIds);
    const row = await withActor(this.db, { id: actor.id }, async (tx) => {
      const [found] = await tx
        .select()
        .from(schema.marketingFundingAdjustments)
        .where(eq(schema.marketingFundingAdjustments.id, input.adjustmentId))
        .limit(1)
        .for('update');
      if (!found || (scope && !scope.includes(found.userId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Adjustment not found' });
      }
      if (found.requestedBy === actor.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Someone other than the requester must approve this adjustment.' });
      }
      if (found.userId === actor.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot approve an adjustment to your own balance.' });
      }
      if (found.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `This adjustment is already ${found.status.toLowerCase()}.` });
      }
      // Serialise with every other balance write for this person.
      await lockFundingBalance(tx, found.userId);
      const [updated] = await tx
        .update(schema.marketingFundingAdjustments)
        .set({
          status: input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: input.note?.trim() || null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.marketingFundingAdjustments.id, found.id), eq(schema.marketingFundingAdjustments.status, 'PENDING')))
        .returning();
      if (!updated) throw new TRPCError({ code: 'CONFLICT', message: 'Adjustment changed while saving. Refresh and try again.' });
      return updated;
    });

    const approved = row.status === 'APPROVED';
    const data = { adjustmentId: row.id, reference: row.reference, amount: row.amount, status: row.status };
    const sign = row.direction === 'CREDIT' ? 'added to' : 'taken from';
    this.deps.notifications.enqueueCreate({
      userId: row.userId,
      type: 'funding:adjustment',
      title: approved ? 'Funding adjustment applied' : 'Funding adjustment rejected',
      body: approved
        ? `${naira(Number(row.amount))} was ${sign} your funding balance. Ref ${row.reference}. Reason: ${row.reason}`
        : `Adjustment ${row.reference} was rejected and did not change your balance.`,
      data,
    });
    this.deps.notifications.enqueueCreate({
      userId: row.requestedBy,
      type: 'funding:adjustment',
      title: approved ? 'Adjustment approved' : 'Adjustment rejected',
      body: `Adjustment ${row.reference} (${naira(Number(row.amount))}) was ${approved ? 'approved' : `rejected: ${row.reviewNote ?? ''}`}.`,
      data,
    });
    return row;
  }

  async listAdjustments(input: ListFundingAdjustmentsInput, actor: SessionUser, effectiveBranchIds?: string[] | null) {
    const a = schema.marketingFundingAdjustments;
    const target = alias(schema.users, 'target');
    const requester = alias(schema.users, 'requester');
    const reviewer = alias(schema.users, 'reviewer');
    const scope = await this.deps.getScopeUserIds(actor, effectiveBranchIds);
    if (scope && scope.length === 0) {
      return { records: [], pagination: { page: input.page, limit: input.limit, total: 0 } };
    }
    const where = and(
      scope ? inArray(a.userId, scope) : undefined,
      input.status ? eq(a.status, input.status) : undefined,
      input.userId ? eq(a.userId, input.userId) : undefined,
    );
    const [rows, totalRow] = await Promise.all([
      this.db
        .select({
          id: a.id,
          reference: a.reference,
          userId: a.userId,
          userName: target.name,
          direction: a.direction,
          amount: a.amount,
          currencyCode: a.currencyCode,
          reason: a.reason,
          relatedFundingId: a.relatedFundingId,
          relatedPeriodMonth: a.relatedPeriodMonth,
          status: a.status,
          requestedBy: a.requestedBy,
          requestedByName: requester.name,
          requestedAt: a.requestedAt,
          reviewedByName: reviewer.name,
          reviewedAt: a.reviewedAt,
          reviewNote: a.reviewNote,
        })
        .from(a)
        .leftJoin(target, eq(target.id, a.userId))
        .leftJoin(requester, eq(requester.id, a.requestedBy))
        .leftJoin(reviewer, eq(reviewer.id, a.reviewedBy))
        .where(where)
        .orderBy(desc(a.requestedAt))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      this.db.select({ c: count() }).from(a).where(where),
    ]);
    return {
      records: rows.map((row) => ({
        ...row,
        relatedFundingReference: row.relatedFundingId ? fundingTxnReference(row.relatedFundingId) : null,
        requestedAt: row.requestedAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        canReview: row.status === 'PENDING' && row.requestedBy !== actor.id && row.userId !== actor.id,
      })),
      pagination: { page: input.page, limit: input.limit, total: Number(totalRow[0]?.c ?? 0) },
    };
  }
}
