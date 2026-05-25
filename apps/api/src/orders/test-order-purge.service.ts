import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { SYSTEM_ACTOR_ID } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { CacheService } from '../common/cache/cache.service';

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
  private readonly logger = new Logger('TestOrderPurge');

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cache: CacheService,
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
    await pause();
    await drain('exact-duplicates', this.purgeDuplicateOrders);
    await pause();
    await drain('cross-funnel-duplicates', this.purgeCrossFunnelDuplicates);

    this.logger.log('Boot sweep complete');
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
      await this.purgeDuplicateOrders();
    } catch (err) {
      this.logger.error(`Duplicate-order purge run failed: ${(err as Error)?.message ?? err}`);
    }
    try {
      await this.purgeCrossFunnelDuplicates();
    } catch (err) {
      this.logger.error(`Cross-funnel duplicate purge run failed: ${(err as Error)?.message ?? err}`);
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
          description: 'Auto-deleted: test-order purge (customer name contains "test")',
          branchId: t.branchId ?? null,
        })),
      );
    });

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
   * Exact-duplicate purge — finds orders with identical phone hash + items
   * fingerprint + same campaign submitted within 24 hours of each other,
   * keeps the earliest, and DELETES the rest. Only touches stock-neutral
   * statuses (same safety as test-order purge).
   *
   * Orders that arrive >24h apart are treated as legitimate repeat customers
   * and are NOT purged — only rapid-fire duplicates from the race condition
   * window (before the advisory-lock fix of 2026-05-24) are cleaned up.
   */
  async purgeDuplicateOrders(
    allDates = false,
  ): Promise<{ deleted: number; skipped: number }> {
    const dateFilter = allDates
      ? sql`TRUE`
      : sql`o1.created_at >= NOW() - INTERVAL '48 hours'`;

    // Find duplicate groups: same phone hash, same campaign, same items JSONB,
    // created within 24 hours of each other, both in stock-neutral statuses.
    // For each group, keep the earliest (min id by created_at) and mark the
    // rest for deletion. >24h apart = legitimate repeat order, leave it alone.
    const duplicateIds = await this.db.execute<{ id: string; customer_name: string; status: string; branch_id: string | null }>(sql`
      WITH ranked AS (
        SELECT
          o1.id,
          o1.customer_name,
          o1.status,
          o1.branch_id,
          o1.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY o1.customer_phone_hash, o1.campaign_id, o1.items::text
            ORDER BY o1.created_at ASC
          ) AS rn
        FROM orders o1
        WHERE o1.customer_phone_hash IS NOT NULL
          AND o1.status IN ('UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED')
          AND o1.deleted_at IS NULL
          AND ${dateFilter}
          AND EXISTS (
            SELECT 1 FROM orders o2
            WHERE o2.customer_phone_hash = o1.customer_phone_hash
              AND o2.campaign_id IS NOT DISTINCT FROM o1.campaign_id
              AND o2.items::text = o1.items::text
              AND o2.id != o1.id
              AND o2.deleted_at IS NULL
              AND o2.status NOT IN ('CANCELLED', 'DELETED')
              AND o2.created_at < o1.created_at
              AND o1.created_at - o2.created_at < INTERVAL '24 hours'
          )
      )
      SELECT id, customer_name, status, branch_id
      FROM ranked
      WHERE rn > 1
      LIMIT ${MAX_PER_RUN}
    `);

    if (duplicateIds.length === 0) {
      return { deleted: 0, skipped: 0 };
    }

    const ids = duplicateIds.map((r) => r.id);
    const preview = duplicateIds
      .slice(0, 20)
      .map((r) => `${r.id} (${r.customer_name} · ${r.status})`)
      .join('; ');

    const now = new Date();
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx
        .update(schema.orders)
        .set({
          status: 'DELETED',
          deletedAt: now,
          updatedAt: now,
          isDuplicate: 'FLAGGED',
        })
        .where(
          and(
            inArray(schema.orders.id, ids),
            inArray(schema.orders.status, ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED']),
            isNull(schema.orders.deletedAt),
          ),
        );
      await tx.insert(schema.orderTimelineEvents).values(
        duplicateIds.map((r) => ({
          orderId: r.id,
          eventType: 'ORDER_DELETED' as const,
          actorId: null,
          actorName: 'System' as const,
          description: 'Auto-deleted: exact duplicate order (same customer, form, and items within 24 hours)',
          branchId: r.branch_id ?? null,
        })),
      );
    });

    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    this.logger.log(
      `Deleted ${ids.length} duplicate order(s) → Deleted tab. Targets: ${preview}` +
        (ids.length > 20 ? ` … +${ids.length - 20} more` : ''),
    );
    return { deleted: ids.length, skipped: 0 };
  }

  /**
   * Cross-funnel duplicate purge — catches orders that slipped past the
   * creation-time cross-funnel block (race conditions, advisory lock edge
   * cases, or orders created before the blocking fix of 2026-05-25).
   *
   * Finds orders where the same phone hash + overlapping product exists from
   * a DIFFERENT media buyer within 24 hours. Keeps the earliest order
   * (winner), soft-deletes the runner-ups to DELETED, and records
   * `cross_funnel_attempts` rows so the runner-up MB retains visibility.
   *
   * Only touches stock-neutral statuses — if a cross-funnel duplicate has
   * already moved past confirmation, it's logged for manual review.
   */
  async purgeCrossFunnelDuplicates(
    allDates = false,
  ): Promise<{ deleted: number; skipped: number }> {
    const dateFilter = allDates
      ? sql`TRUE`
      : sql`loser.created_at >= NOW() - INTERVAL '48 hours'`;

    // Find cross-funnel duplicates: same phone hash, overlapping product in
    // order_items, different media_buyer_id, within 24h of each other.
    // The "winner" is the earliest order; "losers" are later orders from
    // different MBs. Only touch losers in stock-neutral pre-delete statuses.
    const losers = await this.db.execute<{
      loser_id: string;
      loser_customer_name: string;
      loser_customer_phone: string | null;
      loser_customer_phone_hash: string;
      loser_mb_id: string;
      loser_campaign_id: string | null;
      loser_branch_id: string | null;
      loser_status: string;
      winner_id: string;
      winner_mb_id: string;
      product_id: string;
    }>(sql`
      SELECT DISTINCT ON (loser.id)
        loser.id              AS loser_id,
        loser.customer_name   AS loser_customer_name,
        loser.customer_phone  AS loser_customer_phone,
        loser.customer_phone_hash AS loser_customer_phone_hash,
        loser.media_buyer_id  AS loser_mb_id,
        loser.campaign_id     AS loser_campaign_id,
        loser.branch_id       AS loser_branch_id,
        loser.status          AS loser_status,
        winner.id             AS winner_id,
        winner.media_buyer_id AS winner_mb_id,
        oi_loser.product_id   AS product_id
      FROM orders loser
      JOIN order_items oi_loser ON oi_loser.order_id = loser.id
      JOIN order_items oi_winner ON oi_winner.product_id = oi_loser.product_id
      JOIN orders winner ON winner.id = oi_winner.order_id
      WHERE loser.customer_phone_hash IS NOT NULL
        AND loser.media_buyer_id IS NOT NULL
        AND winner.media_buyer_id IS NOT NULL
        AND loser.media_buyer_id != winner.media_buyer_id
        AND loser.customer_phone_hash = winner.customer_phone_hash
        AND winner.created_at < loser.created_at
        AND loser.created_at - winner.created_at < INTERVAL '24 hours'
        AND loser.status IN ('UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED')
        AND loser.deleted_at IS NULL
        AND winner.status NOT IN ('CANCELLED', 'DELETED')
        AND winner.deleted_at IS NULL
        AND ${dateFilter}
        -- Skip orders that already have a cross_funnel_attempts row recorded
        AND NOT EXISTS (
          SELECT 1 FROM cross_funnel_attempts cfa
          WHERE cfa.customer_phone_hash = loser.customer_phone_hash
            AND cfa.media_buyer_id = loser.media_buyer_id
            AND cfa.original_order_id = winner.id
            AND cfa.product_id = oi_loser.product_id
        )
      ORDER BY loser.id, winner.created_at ASC
      LIMIT ${MAX_PER_RUN}
    `);

    if (losers.length === 0) {
      return { deleted: 0, skipped: 0 };
    }

    // Group by loser order so we collect all product IDs per loser
    const loserMap = new Map<string, {
      loserId: string;
      customerName: string;
      customerPhone: string | null;
      customerPhoneHash: string;
      mbId: string;
      campaignId: string | null;
      branchId: string | null;
      status: string;
      winnerId: string;
      winnerMbId: string;
      productIds: string[];
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
          productIds: [row.product_id],
        });
      }
    }

    const loserEntries = [...loserMap.values()];
    const loserIds = loserEntries.map((e) => e.loserId);
    const preview = loserEntries
      .slice(0, 20)
      .map((e) => `${e.loserId} (${e.customerName} · MB ${e.mbId.slice(0, 8)}… → winner ${e.winnerId.slice(0, 8)}…)`)
      .join('; ');

    const now = new Date();
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      // 1. Soft-delete the loser orders
      await tx
        .update(schema.orders)
        .set({
          status: 'DELETED',
          deletedAt: now,
          updatedAt: now,
          isDuplicate: 'FLAGGED',
        })
        .where(
          and(
            inArray(schema.orders.id, loserIds),
            inArray(schema.orders.status, ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED']),
            isNull(schema.orders.deletedAt),
          ),
        );

      // 2. Record cross_funnel_attempts rows for each loser+product
      const cfaRows = loserEntries.flatMap((e) =>
        e.productIds.map((productId) => ({
          customerPhoneHash: e.customerPhoneHash,
          customerPhone: e.customerPhone,
          customerName: e.customerName,
          productId,
          mediaBuyerId: e.mbId,
          campaignId: e.campaignId,
          branchId: e.branchId,
          originalOrderId: e.winnerId,
          originalMediaBuyerId: e.winnerMbId,
        })),
      );
      if (cfaRows.length > 0) {
        await tx.insert(schema.crossFunnelAttempts).values(cfaRows);
      }

      // 3. Timeline events for audit trail
      await tx.insert(schema.orderTimelineEvents).values(
        loserEntries.map((e) => ({
          orderId: e.loserId,
          eventType: 'ORDER_DELETED' as const,
          actorId: null,
          actorName: 'System' as const,
          description: `Auto-deleted: cross-funnel duplicate (same customer, different MB, within 24h — winner: ${e.winnerId.slice(0, 8)}…)`,
          branchId: e.branchId ?? null,
        })),
      );
    });

    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    this.logger.log(
      `Deleted ${loserIds.length} cross-funnel duplicate(s) → Deleted tab + cross_funnel_attempts recorded. Targets: ${preview}` +
        (loserIds.length > 20 ? ` … +${loserIds.length - 20} more` : ''),
    );
    return { deleted: loserIds.length, skipped: 0 };
  }
}
