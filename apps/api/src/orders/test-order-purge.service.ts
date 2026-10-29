import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gte, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, formatOrderNumber } from '@yannis/shared';
import { SYSTEM_ACTOR_ID } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { CacheService } from '../common/cache/cache.service';
import { FollowUpConfigService } from './follow-up-config.service';
import { CartOrdersService } from '../cart-orders/cart-orders.service';
import { DuplicateRulesService } from '../settings/duplicate-rules.service';

/**
 * Order statuses that have NOT moved any inventory yet. Test orders past
 * CONFIRMED have reserved / allocated / deducted stock from batches — the
 * cron skips them and logs them for manual review instead (CEO directive
 * 2026-05-22). CANCELLED and DELETED are also stock-neutral because the
 * lifecycle only allows them from pre-confirmation states.
 */
const STOCK_NEUTRAL_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CANCELLED', 'DELETED'] as const;

/**
 * Pre-deletion statuses the cron actually transitions to DELETED.
 * Excludes DELETED itself (no-op), CANCELLED (already terminal), and every
 * stock-moved status.
 */
const PRE_DELETE_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CANCELLED'] as const;

/**
 * Hard cap on orders cancelled per run — a guardrail so a mis-firing match
 * can never sweep the table in one pass. A genuine backlog drains across runs.
 */
const MAX_PER_RUN = 200;

/**
 * Whole-word "test" match anywhere in the customer name: catches `test`,
 * `Test 1`, `test-order`, `TEST2`, `Abraham test`, `test Abraham`, and
 * `John test doe`. The leading `(^|[^[:alpha:]])` and trailing
 * `([^[:alpha:]]|$)` are the safety net — a real customer named
 * `Testimony`, `Tester`, `latest`, or `contest` can never match because
 * "test" must be flanked by a non-letter on each side (start/end of name
 * counts). `~*` is case-insensitive; `btrim` tolerates stray leading or
 * trailing whitespace in the stored name.
 */
const TEST_NAME_MATCH = sql`btrim(${schema.orders.customerName}) ~* '(^|[^[:alpha:]])test([^[:alpha:]]|$)'`;
const TEST_NAME_MATCH_CART = sql`btrim(${schema.cartOrders.customerName}) ~* '(^|[^[:alpha:]])test([^[:alpha:]]|$)'`;
const TEST_NAME_MATCH_FU = sql`btrim(${schema.followUpOrders.customerName}) ~* '(^|[^[:alpha:]])test([^[:alpha:]]|$)'`;

/**
 * Extra days the duplicate cleanup looks back beyond a company's window, so a
 * missed or failed run (deploy, restart) is caught up by the next one.
 */
const DUPLICATE_LOOKBACK_MARGIN_DAYS = 2;

type CleanupCronRule = { mode: 'DELETE' | 'FLAG' | 'OFF'; windowDays: number };

export type DuplicateLoserRow = {
  loser_id: string;
  loser_customer_name: string;
  loser_customer_phone: string | null;
  loser_customer_phone_hash: string;
  loser_mb_id: string | null;
  loser_campaign_id: string | null;
  loser_branch_id: string | null;
  loser_status: string;
  winner_id: string;
  winner_mb_id: string | null;
  winner_order_number: number | null;
  product_id: string;
  rule_mode: 'DELETE' | 'FLAG';
};

/**
 * The duplicate cleanup's matching query: one row per loser with its winner.
 *
 * A loser is checked for its company's whole window (plus a small margin), not
 * just the last 48 hours: a pair often only becomes a duplicate later, when the
 * newer order moves past the older one (customer re-ordered and got delivered
 * while the first copy sat in CS_ENGAGED). The 48h lookback left those copies
 * in CS queues for good (131 found by hand on 2026-10-29).
 *
 * Phone digits are worked out once per order and matched with two equality
 * joins (hash, last 9 digits) instead of a regex inside an OR join, so the
 * wider scan stays cheap.
 */
export function duplicateLosersQuery(opts: {
  companyRules: Array<{ groupId: string } & CleanupCronRule>;
  fallback: CleanupCronRule;
  /** Every order instead of the window lookback. Heavy: never on a schedule. */
  allDates?: boolean;
}): SQL {
  const { companyRules, fallback } = opts;
  // One row per company that has its own setting; everyone else uses the fallback.
  const cfgRows = companyRules.length > 0
    ? sql.join(
        companyRules.map((r) => sql`(${r.groupId}::uuid, ${r.mode}::text, ${r.windowDays}::int)`),
        sql`, `,
      )
    : sql`(NULL::uuid, NULL::text, NULL::int)`;
  const maxWindow = Math.max(fallback.windowDays, ...companyRules.map((r) => r.windowDays));
  // Losers reach back window + margin; their winners up to one more window.
  const horizon = opts.allDates
    ? sql`TRUE`
    : sql`o.created_at >= NOW() - make_interval(days => ${2 * maxWindow + DUPLICATE_LOOKBACK_MARGIN_DAYS}::int)`;
  const loserLookback = opts.allDates
    ? sql`TRUE`
    : sql`l.created_at >= NOW() - make_interval(days => l.window_days + ${DUPLICATE_LOOKBACK_MARGIN_DAYS}::int)`;

  return sql`
    WITH cfg(group_id, mode, window_days) AS (VALUES ${cfgRows}),
    base AS MATERIALIZED (
      SELECT o.id, o.order_number, o.status, o.is_duplicate, o.customer_name,
             o.customer_phone, o.customer_phone_hash, o.media_buyer_id, o.campaign_id,
             o.branch_id, o.currency_code, o.created_at, o.delivered_at,
             COALESCE(cfg.mode, ${fallback.mode}::text) AS rule_mode,
             COALESCE(cfg.window_days, ${fallback.windowDays}::int) AS window_days,
             nullif(right(regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g'), 9), '') AS tail,
             CASE o.status::text
               WHEN 'REMITTED' THEN 10 WHEN 'DELIVERED' THEN 9 WHEN 'PARTIALLY_DELIVERED' THEN 8
               WHEN 'IN_TRANSIT' THEN 7 WHEN 'DISPATCHED' THEN 6 WHEN 'AGENT_ASSIGNED' THEN 5
               WHEN 'CONFIRMED' THEN 4 WHEN 'CS_ENGAGED' THEN 3 WHEN 'CS_ASSIGNED' THEN 2
               WHEN 'UNPROCESSED' THEN 1 ELSE 0 END AS rank
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      LEFT JOIN cfg ON cfg.group_id = b.group_id
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN ('CANCELLED', 'DELETED')
        AND ${horizon}
    ),
    -- Same phone = phone_hash OR last 9 digits: '0803…' and '803…' hash differently.
    -- Same country: a Kenyan and a Tanzanian 07… number can share the last 9
    -- digits (and the phone hash, which reads every 10-digit 0… as Ghana) but
    -- are different customers.
    same_customer AS (
      SELECT l.id AS loser_id, w.id AS winner_id
      FROM base l
      JOIN base w ON w.customer_phone_hash = l.customer_phone_hash
                 AND w.currency_code = l.currency_code AND w.id <> l.id
      WHERE l.customer_phone_hash IS NOT NULL AND l.rule_mode <> 'OFF' AND ${loserLookback}
      UNION
      SELECT l.id, w.id
      FROM base l
      JOIN base w ON w.tail = l.tail
                 AND w.currency_code = l.currency_code AND w.id <> l.id
      WHERE l.customer_phone_hash IS NOT NULL AND l.rule_mode <> 'OFF' AND ${loserLookback}
        AND length(l.tail) = 9
    )
    SELECT DISTINCT ON (l.id)
      l.id                  AS loser_id,
      l.customer_name       AS loser_customer_name,
      l.customer_phone      AS loser_customer_phone,
      l.customer_phone_hash AS loser_customer_phone_hash,
      l.media_buyer_id      AS loser_mb_id,
      l.campaign_id         AS loser_campaign_id,
      l.branch_id           AS loser_branch_id,
      l.status              AS loser_status,
      w.id                  AS winner_id,
      w.media_buyer_id      AS winner_mb_id,
      w.order_number        AS winner_order_number,
      shared.product_id     AS product_id,
      l.rule_mode           AS rule_mode
    FROM same_customer sc
    JOIN base l ON l.id = sc.loser_id
    JOIN base w ON w.id = sc.winner_id
    -- Both orders carry the same product.
    JOIN LATERAL (
      SELECT a.product_id FROM order_items a
      JOIN order_items c ON c.product_id = a.product_id AND c.order_id = w.id
      WHERE a.order_id = l.id
      LIMIT 1
    ) shared ON TRUE
    WHERE ABS(EXTRACT(EPOCH FROM (l.created_at - w.created_at))) <= l.window_days * 86400
      -- CS already decided: "not a duplicate" (DISMISSED) or merged. Never re-flag or delete.
      AND l.is_duplicate IS DISTINCT FROM 'DISMISSED'
      AND l.is_duplicate IS DISTINCT FROM 'MERGED'
      -- Flag-only companies: an order already flagged, dismissed or merged is settled.
      AND NOT (l.rule_mode = 'FLAG' AND l.is_duplicate IS NOT NULL)
      -- A flag-only copy (past CS_ENGAGED) that is already flagged needs nothing
      -- new (without this it is re-flagged, with a new timeline entry, every run).
      AND NOT (l.is_duplicate = 'FLAGGED' AND l.status::text NOT IN ('UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'))
      -- A completed order is a finished transaction, not an open duplicate.
      -- If the winner was already delivered before the loser was even created,
      -- the loser is a legitimate repeat purchase (customer re-ordering the same
      -- product weeks later) and must NOT be auto-deleted. Only collapse when the
      -- winner was still open at the time the loser came in.
      AND NOT (
        w.status IN ('DELIVERED', 'REMITTED')
        AND w.delivered_at IS NOT NULL
        AND w.delivered_at < l.created_at
      )
      AND (
        w.rank > l.rank
        OR (w.rank = l.rank AND w.created_at < l.created_at)
        OR (w.rank = l.rank AND w.created_at = l.created_at AND w.id < l.id)
      )
    ORDER BY l.id, w.rank DESC, w.created_at ASC
    LIMIT ${MAX_PER_RUN}
  `;
}

/**
 * TestOrderPurgeService — scheduled auto-deletion of test orders.
 *
 * Every 2 hours it scans the **last 48 hours** of orders, finds the ones
 * whose customer name contains the whole word "test" anywhere (see
 * `TEST_NAME_MATCH`), and **transitions** the pre-confirmation + cancelled
 * ones to `DELETED` inside one SYSTEM-attributed transaction. DELETED orders
 * are excluded from ALL metrics/counts but the row stays in the DB (audit
 * trail preserved). Admin/SuperAdmin can restore to UNPROCESSED.
 *
 * Stock-moved test orders are never auto-deleted — they are surfaced as a
 * warning for a human to clean up alongside inventory.
 *
 * The matcher's deliberately wide and the per-run cap (`MAX_PER_RUN`) is the
 * guardrail: a mis-firing run can't sweep more than that in one tick.
 */
@Injectable()
export class TestOrderPurgeService implements OnApplicationBootstrap {

  /** Company order prefix for a record, via its branch. */
  private async resolveOrderPrefix(rec: {
    servicingBranchId?: string | null;
    branchId?: string | null;
  }): Promise<string | null> {
    const branchId = rec.servicingBranchId ?? rec.branchId;
    if (!branchId) return null;
    const [row] = await this.db
      .select({ orderPrefix: schema.branchGroups.orderPrefix })
      .from(schema.branches)
      .innerJoin(schema.branchGroups, eq(schema.branchGroups.id, schema.branches.groupId))
      .where(eq(schema.branches.id, branchId))
      .limit(1);
    return row?.orderPrefix ?? null;
  }
  private readonly logger = new Logger('TestOrderPurge');

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cache: CacheService,
    private readonly followUpService: FollowUpConfigService,
    private readonly cartOrdersService: CartOrdersService,
    private readonly duplicateRules: DuplicateRulesService,
  ) {}

  /**
   * Boot-time sweep — fires 30s after startup so the API is fully up and
   * serving requests first. Runs all three purge passes with `allDates=true`
   * in sequence, with 2s pauses between passes to avoid sustained DB load.
   * Loops until no more targets remain (drains across MAX_PER_RUN batches).
   * Errors are swallowed so a purge hiccup never blocks the API.
   */
  async onApplicationBootstrap(): Promise<void> {
    setTimeout(() => void this.runBootSweep(), 30_000);
  }

  private async runBootSweep(): Promise<void> {
    this.logger.log('Boot sweep starting (30s post-startup)');
    const pause = () => new Promise<void>((r) => setTimeout(r, 2000));

    // Each pass loops until it returns 0 deletions (table is clean).
    // The MAX_PER_RUN cap inside each method prevents any single batch
    // from being too large; the pause between batches keeps DB load low.
    const drain = async (name: string, fn: (allDates: boolean) => Promise<{ deleted: number }>) => {
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const result = await fn.call(this, true);
          total += result.deleted;
          if (result.deleted === 0) break;
          this.logger.log(`Boot sweep [${name}]: batch deleted ${result.deleted}, draining next batch…`);
          await pause();
        } catch (err) {
          this.logger.error(`Boot sweep [${name}] failed: ${(err as Error)?.message ?? err}`);
          break;
        }
      }
      if (total > 0) this.logger.log(`Boot sweep [${name}]: done — ${total} total deleted`);
    };

    await drain('test-orders', this.purgeTestOrders);
    await drain('test-cart-orders', this.purgeTestCartOrders);
    await drain('test-follow-up-orders', this.purgeTestFollowUpOrders);
    // Universal dedup sweep skipped on boot — migration 0159 handles the
    // historical cleanup, and the 2-hour cron (each company's window plus a
    // margin) catches ongoing slips. The full-table self-join is too heavy to run on every
    // API restart without blocking the connection pool.

    try {
      await this.backfillDuplicateOfIdFromTimeline();
    } catch (err) {
      this.logger.error(`duplicate_of_id backfill failed: ${(err as Error)?.message ?? err}`);
    }

    this.logger.log('Boot sweep complete');
  }

  /**
   * One-time backfill: older auto-flagged duplicates were marked
   * `is_duplicate='FLAGGED'` but never had `duplicate_of_id` populated, so the
   * "Compare with original" button on the order detail page had no target and
   * stayed hidden. The winner id was always recorded in the
   * `ORDER_DUPLICATE_FLAGGED` timeline event metadata (`{ winnerId }`), so we
   * recover it from there. Guarded to only set a winner that still exists and
   * isn't the order itself. Idempotent — skips rows that already have a value.
   */
  private async backfillDuplicateOfIdFromTimeline(): Promise<void> {
    // withActor so the history trigger attributes these updates to the system
    // actor. updated_at is left untouched: this is a metadata-only repair and
    // bumping it would float old deleted orders to the top of recency sorts.
    let rows = 0;
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      const result = await tx.execute(sql`
        UPDATE orders o
        SET duplicate_of_id = w.winner_id
        FROM (
          SELECT DISTINCT ON (te.order_id)
            te.order_id,
            (te.metadata->>'winnerId')::uuid AS winner_id
          FROM order_timeline_events te
          WHERE te.event_type = 'ORDER_DUPLICATE_FLAGGED'
            AND te.metadata->>'winnerId' IS NOT NULL
          ORDER BY te.order_id, te.created_at DESC
        ) w
        JOIN orders win ON win.id = w.winner_id
        WHERE o.id = w.order_id
          AND o.duplicate_of_id IS NULL
          AND o.is_duplicate = 'FLAGGED'
          AND w.winner_id <> o.id
      `);
      rows = (result as unknown as { rowCount?: number })?.rowCount ?? 0;
    });
    if (rows > 0) {
      this.logger.log(`Backfilled duplicate_of_id on ${rows} flagged duplicate orders`);
    }
  }

  /** Every 2 hours, on the hour (00:00, 02:00, 04:00 … server time). */
  @Cron('0 0 */2 * * *')
  async handleTestOrderPurge(): Promise<void> {
    try {
      await this.purgeTestOrders();
    } catch (err) {
      this.logger.error(`Test-order purge run failed: ${(err as Error)?.message ?? err}`);
    }
    try {
      await this.purgeTestCartOrders();
    } catch (err) {
      this.logger.error(`Test cart-order purge run failed: ${(err as Error)?.message ?? err}`);
    }
    try {
      await this.purgeTestFollowUpOrders();
    } catch (err) {
      this.logger.error(`Test follow-up order purge run failed: ${(err as Error)?.message ?? err}`);
    }
    try {
      await this.purgeUniversalDuplicates();
    } catch (err) {
      this.logger.error(`Universal duplicate purge run failed: ${(err as Error)?.message ?? err}`);
    }
    try {
      await this.followUpService.retryFailedGraduations();
    } catch (err) {
      this.logger.error(`Follow-up graduation retry failed: ${(err as Error)?.message ?? err}`);
    }
    try {
      await this.cartOrdersService.retryFailedGraduations();
    } catch (err) {
      this.logger.error(`Cart order graduation retry failed: ${(err as Error)?.message ?? err}`);
    }
  }

  /**
   * Find test orders, skip+log the stock-moved ones, transition the rest to
   * DELETED. Per CEO directive 2026-05-23, no `orders` row is ever hard-deleted
   * — they go to the Deleted tab and can be restored by Admin/SuperAdmin.
   *
   * @param allDates    When true, scan every order; when false (cron default),
   *                    only those created in the last 48 hours.
   */
  async purgeTestOrders(
    allDates = false,
  ): Promise<{ deleted: number; cancelled: number; skipped: number }> {
    // Cron scans a 48-hour window to catch yesterday's late and early-morning
    // test orders too, without sweeping the whole table on every tick. Manual
    // trigger (UI) passes `allDates=true` for a one-shot full sweep.
    const dateFilter = allDates
      ? undefined
      : gte(schema.orders.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000));

    // Test orders that already moved stock — never auto-deleted here; the
    // lifecycle forbids DELETED from those states because real inventory
    // would have to be reversed. Surface them so a human can correct stock
    // and decide what to do with the row.
    const stockMoved = await this.db
      .select({
        id: schema.orders.id,
        customerName: schema.orders.customerName,
        status: schema.orders.status,
      })
      .from(schema.orders)
      .where(and(TEST_NAME_MATCH, notInArray(schema.orders.status, [...STOCK_NEUTRAL_STATUSES]), dateFilter))
      .orderBy(schema.orders.createdAt);

    if (stockMoved.length > 0) {
      const preview = stockMoved
        .slice(0, 30)
        .map((o) => `${o.id} (${o.customerName} · ${o.status})`)
        .join('; ');
      this.logger.warn(
        `${stockMoved.length} test order(s) already moved stock — NOT auto-deleted, ` +
          `need manual review (correct inventory + decide by hand): ${preview}` +
          (stockMoved.length > 30 ? ` … +${stockMoved.length - 30} more` : ''),
      );
    }

    // Deletable test orders — pre-confirmation + CANCELLED statuses.
    // Already-DELETED orders are skipped (no-op).
    const targets = await this.db
      .select({
        id: schema.orders.id,
        customerName: schema.orders.customerName,
        status: schema.orders.status,
        branchId: schema.orders.branchId,
      })
      .from(schema.orders)
      .where(and(TEST_NAME_MATCH, inArray(schema.orders.status, [...PRE_DELETE_STATUSES]), dateFilter))
      .orderBy(schema.orders.createdAt)
      .limit(MAX_PER_RUN);

    if (targets.length === 0) {
      return { deleted: 0, cancelled: 0, skipped: stockMoved.length };
    }

    const ids = targets.map((t) => t.id);
    const preview = targets
      .slice(0, 30)
      .map((t) => `${t.id} (${t.customerName} · ${t.status})`)
      .join('; ');

    // One SYSTEM-attributed transaction: flip status → DELETED and set
    // deleted_at for backward compat with isNull(deleted_at) filters.
    // Emit ORDER_DELETED timeline events for audit trail.
    const now = new Date();
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx
        .update(schema.orders)
        .set({ status: 'DELETED', deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(schema.orders.id, ids),
            // Defense in depth — never let a concurrent state change push a
            // stock-moved order into DELETED via this UPDATE.
            inArray(schema.orders.status, [...PRE_DELETE_STATUSES]),
          ),
        );
      await tx.insert(schema.orderTimelineEvents).values(
        targets.map((t) => ({
          orderId: t.id,
          eventType: 'ORDER_DELETED' as const,
          // SYSTEM_ACTOR_ID is a reserved UUID that doesn't exist in the users
          // table — the FK on actor_id would reject it. Use null + actorName
          // instead; null actor_id is the established convention for system and
          // edge-form events in the timeline.
          actorId: null,
          actorName: 'System' as const,
          description: 'Order deleted because it was detected as a test order (its name contains the word "test").',
          metadata: { reason: 'TEST_ORDER' },
          branchId: t.branchId ?? null,
        })),
      );
    });

    // Also soft-delete follow-up copies of these test orders so they don't
    // linger in the follow-up pipeline after the source is purged.
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      const bySource = await tx
        .update(schema.followUpOrders)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            inArray(schema.followUpOrders.sourceOrderId, ids),
            isNull(schema.followUpOrders.deletedAt),
          ),
        )
        .returning({ id: schema.followUpOrders.id });

      // Also catch follow-up orders where the customer name itself is a test name
      // (cart-origin follow-ups have no sourceOrderId but may have test customer names).
      // Same guards as the main target query: pre-delivery statuses only (a
      // DELIVERED/REMITTED follow-up has a graduated copy that deducted stock —
      // deleting the pipeline row would silently diverge the two tables) and
      // the 48h window so old legitimate rows with "test" in the name survive.
      const byName = await tx
        .update(schema.followUpOrders)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            sql`${schema.followUpOrders.customerName} ~* '\\mtest\\M'`,
            inArray(schema.followUpOrders.status, [...PRE_DELETE_STATUSES]),
            gte(schema.followUpOrders.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000)),
            isNull(schema.followUpOrders.deletedAt),
          ),
        )
        .returning({ id: schema.followUpOrders.id });

      // Detailed deletion comment on each removed follow-up copy.
      const fuIds = [...bySource, ...byName].map((r) => r.id);
      if (fuIds.length > 0) {
        await tx.insert(schema.followUpOrderTimelineEvents).values(
          fuIds.map((fid) => ({
            followUpOrderId: fid,
            eventType: 'ORDER_DELETED',
            actorId: null,
            actorName: 'System' as const,
            description: 'Order deleted because it was detected as a test order (its name contains the word "test").',
            metadata: { reason: 'TEST_ORDER' },
            branchId: null,
          })),
        );
      }
    }).catch(() => {}); // Non-critical — best-effort cleanup

    // The deletion happened outside the tRPC mutation path, so the
    // status-count / time-series cache (`cache:orders:aggregates:*`, populated
    // by orders.router `getStatusCounts`) still has the old counts. Bust it so
    // marketing overview strips reflect the deleted state on the next read.
    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    this.logger.log(
      `Deleted ${targets.length} test order(s) → Deleted tab` +
        (stockMoved.length > 0 ? ` (${stockMoved.length} stock-moved skipped)` : '') +
        `. Targets: ${preview}` +
        (targets.length > 30 ? ` … +${targets.length - 30} more` : ''),
    );
    return { deleted: targets.length, cancelled: targets.length, skipped: stockMoved.length };
  }

  /**
   * Purge test orders from the cart_orders table. Same logic as purgeTestOrders
   * but targets the cart_orders + cart_order_timeline_events tables.
   * Cart orders use plain text status (not enum), same lifecycle states.
   */
  async purgeTestCartOrders(
    allDates = false,
  ): Promise<{ deleted: number }> {
    const dateFilter = allDates
      ? undefined
      : gte(schema.cartOrders.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const stockMoved = await this.db
      .select({ id: schema.cartOrders.id, customerName: schema.cartOrders.customerName, status: schema.cartOrders.status })
      .from(schema.cartOrders)
      .where(and(TEST_NAME_MATCH_CART, notInArray(schema.cartOrders.status, [...STOCK_NEUTRAL_STATUSES]), dateFilter))
      .orderBy(schema.cartOrders.createdAt);

    if (stockMoved.length > 0) {
      const preview = stockMoved.slice(0, 30).map((o) => `${o.id} (${o.customerName} · ${o.status})`).join('; ');
      this.logger.warn(`${stockMoved.length} test cart order(s) already moved stock — NOT auto-deleted: ${preview}`);
    }

    const targets = await this.db
      .select({ id: schema.cartOrders.id, customerName: schema.cartOrders.customerName, status: schema.cartOrders.status, branchId: schema.cartOrders.branchId })
      .from(schema.cartOrders)
      .where(and(TEST_NAME_MATCH_CART, inArray(schema.cartOrders.status, [...PRE_DELETE_STATUSES]), isNull(schema.cartOrders.deletedAt), dateFilter))
      .orderBy(schema.cartOrders.createdAt)
      .limit(MAX_PER_RUN);

    if (targets.length === 0) return { deleted: 0 };

    const ids = targets.map((t) => t.id);
    const now = new Date();

    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx
        .update(schema.cartOrders)
        .set({ status: 'DELETED', deletedAt: now, updatedAt: now })
        .where(and(inArray(schema.cartOrders.id, ids), inArray(schema.cartOrders.status, [...PRE_DELETE_STATUSES])));
      await tx.insert(schema.cartOrderTimelineEvents).values(
        targets.map((t) => ({
          cartOrderId: t.id,
          eventType: 'ORDER_DELETED',
          actorId: null,
          actorName: 'System' as const,
          description: 'Order deleted because it was detected as a test order (its name contains the word "test").',
          metadata: { reason: 'TEST_ORDER' },
          branchId: t.branchId ?? null,
        })),
      );
    });

    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    const preview = targets.slice(0, 30).map((t) => `${t.id} (${t.customerName})`).join('; ');
    this.logger.log(`Deleted ${targets.length} test cart order(s). Targets: ${preview}`);
    return { deleted: targets.length };
  }

  /**
   * Purge test orders from the follow_up_orders table. Same logic as
   * purgeTestOrders but targets follow_up_orders + follow_up_order_timeline_events.
   */
  async purgeTestFollowUpOrders(
    allDates = false,
  ): Promise<{ deleted: number }> {
    const dateFilter = allDates
      ? undefined
      : gte(schema.followUpOrders.createdAt, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const stockMoved = await this.db
      .select({ id: schema.followUpOrders.id, customerName: schema.followUpOrders.customerName, status: schema.followUpOrders.status })
      .from(schema.followUpOrders)
      .where(and(TEST_NAME_MATCH_FU, notInArray(schema.followUpOrders.status, [...STOCK_NEUTRAL_STATUSES]), dateFilter))
      .orderBy(schema.followUpOrders.createdAt);

    if (stockMoved.length > 0) {
      const preview = stockMoved.slice(0, 30).map((o) => `${o.id} (${o.customerName} · ${o.status})`).join('; ');
      this.logger.warn(`${stockMoved.length} test follow-up order(s) already moved stock — NOT auto-deleted: ${preview}`);
    }

    const targets = await this.db
      .select({ id: schema.followUpOrders.id, customerName: schema.followUpOrders.customerName, status: schema.followUpOrders.status, branchId: schema.followUpOrders.branchId })
      .from(schema.followUpOrders)
      .where(and(TEST_NAME_MATCH_FU, inArray(schema.followUpOrders.status, [...PRE_DELETE_STATUSES]), isNull(schema.followUpOrders.deletedAt), dateFilter))
      .orderBy(schema.followUpOrders.createdAt)
      .limit(MAX_PER_RUN);

    if (targets.length === 0) return { deleted: 0 };

    const ids = targets.map((t) => t.id);
    const now = new Date();

    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx
        .update(schema.followUpOrders)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(inArray(schema.followUpOrders.id, ids), inArray(schema.followUpOrders.status, [...PRE_DELETE_STATUSES])));
      await tx.insert(schema.followUpOrderTimelineEvents).values(
        targets.map((t) => ({
          followUpOrderId: t.id,
          eventType: 'ORDER_DELETED',
          actorId: null,
          actorName: 'System' as const,
          description: 'Order deleted because it was detected as a test order (its name contains the word "test").',
          metadata: { reason: 'TEST_ORDER' },
          branchId: t.branchId ?? null,
        })),
      );
    });

    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    const preview = targets.slice(0, 30).map((t) => `${t.id} (${t.customerName})`).join('; ');
    this.logger.log(`Deleted ${targets.length} test follow-up order(s). Targets: ${preview}`);
    return { deleted: targets.length };
  }

  /**
   * Universal 14-day dedup flagging (CEO directive 2026-05-26):
   * Same phone (hash or last 9 digits) + same country (currency) + any overlapping
   * product within 14 days = duplicate.
   * Winner: highest lifecycle status, ties → oldest created_at.
   * Early-stage losers (UNPROCESSED / CS_ASSIGNED / CS_ENGAGED): soft-deleted + FLAGGED.
   * Late-stage losers (CONFIRMED+): FLAGGED only — stock may be allocated.
   * CFA row recorded for MB visibility. Completed (already-delivered) winners
   * that pre-date the loser are excluded so legitimate repeat purchases survive.
   *
   * Per-company switch: DUPLICATE_RULES.cleanupCron (mode + window), resolved by
   * the loser's branch company. OFF skips the company; FLAG never deletes and
   * leaves already-flagged orders alone. DISMISSED / MERGED orders (CS decided)
   * are never touched in any mode.
   *
   * Each run checks orders from the company's window plus a 2-day margin, see
   * `duplicateLosersQuery`.
   */
  async purgeUniversalDuplicates(
    allDates = false,
  ): Promise<{ deleted: number; skipped: number }> {
    const { byGroup, fallback } = await this.duplicateRules.allCompanies();
    const companyRules = [...byGroup.entries()].map(([groupId, r]) => ({ groupId, ...r.cleanupCron }));
    if (fallback.cleanupCron.mode === 'OFF' && companyRules.every((r) => r.mode === 'OFF')) {
      return { deleted: 0, skipped: 0 };
    }

    const losers = await this.db.execute<DuplicateLoserRow>(
      duplicateLosersQuery({ companyRules, fallback: fallback.cleanupCron, allDates }),
    );

    if (losers.length === 0) {
      return { deleted: 0, skipped: 0 };
    }

    // Group by loser order so we collect all product IDs per loser
    const loserMap = new Map<string, {
      loserId: string;
      customerName: string;
      customerPhone: string | null;
      customerPhoneHash: string;
      mbId: string | null;
      campaignId: string | null;
      branchId: string | null;
      status: string;
      winnerId: string;
      winnerMbId: string | null;
      winnerOrderNumber: number | null;
      productIds: string[];
      ruleMode: 'DELETE' | 'FLAG';
    }>();
    for (const row of losers) {
      const existing = loserMap.get(row.loser_id);
      if (existing) {
        if (!existing.productIds.includes(row.product_id)) {
          existing.productIds.push(row.product_id);
        }
      } else {
        loserMap.set(row.loser_id, {
          loserId: row.loser_id,
          customerName: row.loser_customer_name,
          customerPhone: row.loser_customer_phone,
          customerPhoneHash: row.loser_customer_phone_hash,
          mbId: row.loser_mb_id,
          campaignId: row.loser_campaign_id,
          branchId: row.loser_branch_id,
          status: row.loser_status,
          winnerId: row.winner_id,
          winnerMbId: row.winner_mb_id,
          winnerOrderNumber: row.winner_order_number,
          productIds: [row.product_id],
          ruleMode: row.rule_mode,
        });
      }
    }

    const loserEntries = [...loserMap.values()];
    const loserIds = loserEntries.map((e) => e.loserId);
    const preview = loserEntries
      .slice(0, 20)
      .map((e) => `${e.loserId} (${e.customerName} · ${e.status} → winner ${e.winnerId.slice(0, 8)}…)`)
      .join('; ');

    const now = new Date();
    // Early-stage statuses where no stock has moved — safe to soft-delete.
    const SAFE_TO_DELETE_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'];
    // Delete only in DELETE-mode companies; FLAG-mode companies flag every stage.
    const willDelete = (e: { status: string; ruleMode: 'DELETE' | 'FLAG' }) =>
      e.ruleMode === 'DELETE' && SAFE_TO_DELETE_STATUSES.includes(e.status);
    const softDeleteIds = loserEntries.filter(willDelete).map((e) => e.loserId);
    const flagOnlyIds = loserEntries.filter((e) => !willDelete(e)).map((e) => e.loserId);

    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      // 1a. Soft-delete early-stage duplicates — removes them from CS queues
      //     and counts so they don't drag down confirmation rates.
      if (softDeleteIds.length > 0) {
        // Set duplicateOfId per-row so the Compare button on the order detail
        // page can diff the deleted duplicate against its winner. Winner varies
        // per loser, so update each group of losers sharing a winner separately.
        const byWinner = new Map<string, string[]>();
        for (const e of loserEntries) {
          if (!willDelete(e)) continue;
          const ids = byWinner.get(e.winnerId) ?? [];
          ids.push(e.loserId);
          byWinner.set(e.winnerId, ids);
        }
        for (const [winnerId, ids] of byWinner) {
          await tx
            .update(schema.orders)
            .set({
              isDuplicate: 'FLAGGED',
              duplicateOfId: winnerId,
              status: 'DELETED',
              deletedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                inArray(schema.orders.id, ids),
                isNull(schema.orders.deletedAt),
              ),
            );
        }
      }

      // 1b. Flag-only for CONFIRMED+ orders — stock may be allocated, can't
      //     safely delete without inventory reversal. CS/HoCS handles manually.
      if (flagOnlyIds.length > 0) {
        const byWinner = new Map<string, string[]>();
        for (const e of loserEntries) {
          if (willDelete(e)) continue;
          const ids = byWinner.get(e.winnerId) ?? [];
          ids.push(e.loserId);
          byWinner.set(e.winnerId, ids);
        }
        for (const [winnerId, ids] of byWinner) {
          await tx
            .update(schema.orders)
            .set({
              isDuplicate: 'FLAGGED',
              duplicateOfId: winnerId,
              updatedAt: now,
            })
            .where(
              and(
                inArray(schema.orders.id, ids),
                isNull(schema.orders.deletedAt),
              ),
            );
        }
      }

      // 2. Timeline events for audit trail
      // Resolve company prefixes up front — the map below is sync.
      const prefixByLoser = new Map<string, string | null>();
      for (const e of loserEntries) {
        prefixByLoser.set(e.loserId, await this.resolveOrderPrefix({ branchId: e.branchId ?? null }));
      }
      await tx.insert(schema.orderTimelineEvents).values(
        loserEntries.map((e) => {
          const winnerLabel = e.winnerOrderNumber
            ? formatOrderNumber(e.winnerOrderNumber, prefixByLoser.get(e.loserId))
            : e.winnerId.slice(0, 8);
          const wasSoftDeleted = willDelete(e);
          return {
            orderId: e.loserId,
            eventType: 'ORDER_DUPLICATE_FLAGGED' as const,
            actorId: null,
            actorName: 'System' as const,
            description: wasSoftDeleted
              ? `Auto-deleted duplicate: same phone + product within the duplicate window (winner: ${winnerLabel})`
              : `Flagged as duplicate: same phone + product within the duplicate window (winner: ${winnerLabel})`,
            metadata: { reason: 'DUPLICATE_RULE', winnerId: e.winnerId },
            branchId: e.branchId ?? null,
          };
        }),
      );
    });

    // 3. Record cross_funnel_attempts outside the tx — best-effort for MB
    //    visibility. A CFA failure must never prevent deletion.
    const cfaRows = loserEntries
      .filter((e) => e.mbId)
      .flatMap((e) =>
        e.productIds.map((productId) => ({
          customerPhoneHash: e.customerPhoneHash,
          customerPhone: e.customerPhone,
          customerName: e.customerName,
          productId,
          mediaBuyerId: e.mbId!,
          campaignId: e.campaignId,
          branchId: e.branchId,
          originalOrderId: e.winnerId,
          originalMediaBuyerId: e.winnerMbId,
          // The order this run removed or flagged, so the compare screen can say
          // "created, then cleaned up" instead of "blocked" (0355).
          duplicateOrderId: e.loserId,
        })),
      );
    if (cfaRows.length > 0) {
      await this.db.insert(schema.crossFunnelAttempts).values(cfaRows).catch((err) => {
        this.logger.warn(`CFA insert failed (non-fatal): ${(err as Error)?.message ?? err}`);
      });
    }

    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    this.logger.log(
      `Duplicate cleanup: ${softDeleteIds.length} soft-deleted (early-stage), ${flagOnlyIds.length} flagged-only (CONFIRMED+). Targets: ${preview}` +
        (loserIds.length > 20 ? ` … +${loserIds.length - 20} more` : ''),
    );
    return { deleted: softDeleteIds.length, skipped: flagOnlyIds.length };
  }
}

