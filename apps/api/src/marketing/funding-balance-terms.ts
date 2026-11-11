import { and, eq, gte, inArray, lte, sql, sum, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { Tx } from '../common/db/with-actor';

type Db = PostgresJsDatabase<typeof schema> | Tx;

/**
 * Refund + adjustment terms of a funding balance (mig 0361). ONE definition,
 * added by every balance formula (wallet checks, Recipient Balances, the
 * single-user balance, the reconciliation check, the audit script):
 *
 *   available += refundsIn + credits - debits - refundsHeld - refundsOut
 *
 *   refundsHeld = refunds this person asked for, still PENDING or APPROVED
 *                 (held so the same money cannot be spent or refunded twice)
 *   refundsOut  = refunds this person COMPLETED back to a funder
 *   refundsIn   = refunds COMPLETED to this person (they were the funder)
 *   credits / debits = APPROVED adjustments
 *
 * REJECTED / CANCELLED refunds and PENDING / REJECTED adjustments never count.
 */
export interface FundingExtraTerms {
  refundsHeld: number;
  refundsOut: number;
  refundsIn: number;
  credits: number;
  debits: number;
}

export function emptyExtraTerms(): FundingExtraTerms {
  return { refundsHeld: 0, refundsOut: 0, refundsIn: 0, credits: 0, debits: 0 };
}

export function extraNet(t: FundingExtraTerms): number {
  return t.refundsIn + t.credits - t.debits - t.refundsHeld - t.refundsOut;
}

/**
 * Optional date window. Completed refunds are dated by completed_at, held
 * refunds by requested_at, adjustments by reviewed_at (approval).
 */
export interface ExtraTermsRange {
  start?: Date;
  end?: Date;
}

function rangeConds(col: SQL | Parameters<typeof gte>[0], range?: ExtraTermsRange): SQL[] {
  const out: SQL[] = [];
  if (range?.start) out.push(gte(col as never, range.start));
  if (range?.end) out.push(lte(col as never, range.end));
  return out;
}

/**
 * Terms per user. `userIds` null = every user (org-wide totals). Users with no
 * refunds or adjustments are absent from the map: use `?? emptyExtraTerms()`.
 */
export async function loadFundingExtraTerms(
  db: Db,
  userIds: string[] | null,
  range?: ExtraTermsRange,
): Promise<Map<string, FundingExtraTerms>> {
  const out = new Map<string, FundingExtraTerms>();
  if (userIds && userIds.length === 0) return out;
  const r = schema.marketingFundingRefunds;
  const a = schema.marketingFundingAdjustments;

  const [held, refundedOut, refundedIn, adjustments] = await Promise.all([
    db
      .select({ userId: r.refunderId, total: sum(r.amount) })
      .from(r)
      .where(
        and(
          inArray(r.status, ['PENDING', 'APPROVED']),
          userIds ? inArray(r.refunderId, userIds) : undefined,
          ...rangeConds(r.requestedAt, range),
        ),
      )
      .groupBy(r.refunderId),
    db
      .select({ userId: r.refunderId, total: sum(r.amount) })
      .from(r)
      .where(
        and(
          eq(r.status, 'COMPLETED'),
          userIds ? inArray(r.refunderId, userIds) : undefined,
          ...rangeConds(r.completedAt, range),
        ),
      )
      .groupBy(r.refunderId),
    db
      .select({ userId: r.funderId, total: sum(r.amount) })
      .from(r)
      .where(
        and(
          eq(r.status, 'COMPLETED'),
          userIds ? inArray(r.funderId, userIds) : undefined,
          ...rangeConds(r.completedAt, range),
        ),
      )
      .groupBy(r.funderId),
    db
      .select({ userId: a.userId, direction: a.direction, total: sum(a.amount) })
      .from(a)
      .where(
        and(
          eq(a.status, 'APPROVED'),
          userIds ? inArray(a.userId, userIds) : undefined,
          ...rangeConds(a.reviewedAt, range),
        ),
      )
      .groupBy(a.userId, a.direction),
  ]);

  const get = (id: string) => {
    let t = out.get(id);
    if (!t) {
      t = emptyExtraTerms();
      out.set(id, t);
    }
    return t;
  };
  for (const row of held) get(row.userId).refundsHeld += Number(row.total ?? 0);
  for (const row of refundedOut) get(row.userId).refundsOut += Number(row.total ?? 0);
  for (const row of refundedIn) get(row.userId).refundsIn += Number(row.total ?? 0);
  for (const row of adjustments) {
    const t = get(row.userId);
    if (row.direction === 'CREDIT') t.credits += Number(row.total ?? 0);
    else t.debits += Number(row.total ?? 0);
  }
  return out;
}

/** Terms for one user. */
export async function loadFundingExtraTermsForUser(
  db: Db,
  userId: string,
  range?: ExtraTermsRange,
): Promise<FundingExtraTerms> {
  const map = await loadFundingExtraTerms(db, [userId], range);
  return map.get(userId) ?? emptyExtraTerms();
}

/** Serialise every balance-checked write for one user. Transaction-scoped. */
export async function lockFundingBalance(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'funding-balance:' + userId}))`);
}

/**
 * Companies (branch_groups) a user belongs to, through their branch
 * memberships or primary branch. Two people "share a company" when these
 * overlap. Used by refunds and peer transfers so money never crosses companies.
 */
export async function userCompanyIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.execute<{ group_id: string }>(sql`
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
