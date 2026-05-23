import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, gte, inArray, notInArray, sql } from 'drizzle-orm';
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
 * 2026-05-22). CANCELLED is also stock-neutral because the lifecycle only
 * allows cancellation from the pre-confirmation states.
 */
const STOCK_NEUTRAL_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CANCELLED'] as const;

/**
 * Pre-cancellation statuses the cron actually transitions to CANCELLED.
 * Excludes CANCELLED itself (no-op) and every stock-moved status.
 */
const PRE_CANCEL_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'] as const;

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
 * TestOrderPurgeService — scheduled auto-cancellation of test orders.
 *
 * Every 2 hours it scans the **last 48 hours** of orders, finds the ones
 * whose customer name contains the whole word "test" anywhere (see
 * `TEST_NAME_MATCH`), and **transitions** the pre-confirmation ones to
 * `CANCELLED` inside one SYSTEM-attributed transaction — same shape as the
 * manual Cancel flow. Per CEO directive (2026-05-23) **no order ever leaves
 * the DB**; test orders simply surface in the Deleted tab via their normal
 * cancelled state, and Admin/SuperAdmin can restore them like any other
 * cancelled order. Stock-moved test orders are never auto-cancelled — they
 * are surfaced as a warning for a human to clean up alongside inventory.
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
   * Boot-time sweep so a fresh deploy clears recent test orders right away —
   * otherwise the first effect of a deploy would not be visible until the next
   * 2-hour cron tick. Same 48-hour window as the cron; errors swallowed so a
   * purge hiccup never blocks the API from coming up.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.purgeTestOrders();
    } catch (err) {
      this.logger.error(
        `Boot-time test-order purge failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /** Every 2 hours, on the hour (00:00, 02:00, 04:00 … server time). */
  @Cron('0 0 */2 * * *')
  async handleTestOrderPurge(): Promise<void> {
    try {
      await this.purgeTestOrders();
    } catch (err) {
      // Never let a purge failure bubble — log and let the next run retry.
      this.logger.error(`Test-order purge run failed: ${(err as Error)?.message ?? err}`);
    }
  }

  /**
   * Find test orders, skip+log the stock-moved ones, transition the rest to
   * CANCELLED. Per CEO directive 2026-05-23, no `orders` row is ever deleted
   * — they go to the Deleted tab via their cancelled state and can be
   * restored by Admin/SuperAdmin like any other cancelled order.
   *
   * @param allDates    When true, scan every order; when false (cron default),
   *                    only those created in the last 48 hours.
   * Returns `{ cancelled, skipped }` (see `deleted` alias for back-compat).
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

    // Test orders that already moved stock — never auto-cancelled here; the
    // lifecycle forbids CANCELLED from those states because real inventory
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
        `${stockMoved.length} test order(s) already moved stock — NOT auto-cancelled, ` +
          `need manual review (correct inventory + decide by hand): ${preview}` +
          (stockMoved.length > 30 ? ` … +${stockMoved.length - 30} more` : ''),
      );
    }

    // Cancellable test orders — pre-confirmation statuses only (already-CANCELLED
    // skipped: it's a no-op and would emit a spurious timeline event).
    const targets = await this.db
      .select({
        id: schema.orders.id,
        customerName: schema.orders.customerName,
        status: schema.orders.status,
        branchId: schema.orders.branchId,
      })
      .from(schema.orders)
      .where(and(TEST_NAME_MATCH, inArray(schema.orders.status, [...PRE_CANCEL_STATUSES]), dateFilter))
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

    // One SYSTEM-attributed transaction: flip status → CANCELLED and emit an
    // ORDER_CANCELLED timeline event per order so the Deleted tab and audit
    // trail look identical to a manual cancel. Pre-confirmation statuses are
    // stock-neutral by lifecycle, so there's nothing to release.
    const now = new Date();
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx
        .update(schema.orders)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(
          and(
            inArray(schema.orders.id, ids),
            // Defense in depth — never let a concurrent state change push a
            // stock-moved order into CANCELLED via this UPDATE.
            inArray(schema.orders.status, [...PRE_CANCEL_STATUSES]),
          ),
        );
      await tx.insert(schema.orderTimelineEvents).values(
        targets.map((t) => ({
          orderId: t.id,
          eventType: 'ORDER_CANCELLED' as const,
          actorId: SYSTEM_ACTOR_ID,
          actorName: 'System' as const,
          description: 'Auto-cancelled: test-order purge (customer name contains "test")',
          branchId: t.branchId ?? null,
        })),
      );
    });

    // The cancellation happened outside the tRPC mutation path, so the
    // status-count / time-series cache (`cache:orders:aggregates:*`, populated
    // by orders.router `getStatusCounts`) still has the old counts. Bust it so
    // marketing overview strips reflect the cancelled state on the next read.
    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    this.logger.log(
      `Cancelled ${targets.length} test order(s) → Deleted tab` +
        (stockMoved.length > 0 ? ` (${stockMoved.length} stock-moved skipped)` : '') +
        `. Targets: ${preview}` +
        (targets.length > 30 ? ` … +${targets.length - 30} more` : ''),
    );
    // `deleted` is retained for backward compat with existing toast UIs that
    // read that field — same count, just sourced from the cancellation now.
    return { deleted: targets.length, cancelled: targets.length, skipped: stockMoved.length };
  }
}
