import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, inArray, notInArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { SYSTEM_ACTOR_ID } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';

/**
 * Order statuses that have NOT moved any inventory yet. Test orders past
 * CONFIRMED have reserved / allocated / deducted stock from batches — purging
 * those silently would leave stock counts wrong, so the cron skips them and
 * logs them for manual review instead (CEO directive 2026-05-22).
 *
 * CANCELLED is stock-neutral: the lifecycle only allows cancellation from the
 * pre-confirmation states, so a cancelled order never reserved stock.
 */
const STOCK_NEUTRAL_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CANCELLED'] as const;

/**
 * Hard cap on orders removed per run — a guardrail so a mis-firing match can
 * never wipe the table in one pass. A genuine backlog drains across runs.
 */
const MAX_PER_RUN = 200;

/**
 * Whole-word "test" match on the customer name: the name IS "test", or "test"
 * followed by a non-letter (`test`, `Test 1`, `test-order`, `TEST2`). The
 * trailing `[^[:alpha:]]` is the safety net — it means a real customer named
 * "Testimony" or "Tester" can never match. `~*` is case-insensitive; `btrim`
 * tolerates stray leading/trailing whitespace in the stored name.
 */
const TEST_NAME_MATCH = sql`btrim(${schema.orders.customerName}) ~* '^test([^[:alpha:]]|$)'`;

/**
 * TestOrderPurgeService — scheduled hard-delete of test orders.
 *
 * Every 2 hours it finds orders whose customer name is the whole word "test"
 * and removes the stock-neutral ones (order + all FK children) inside one
 * SYSTEM-attributed transaction. The `orders` temporal history table retains
 * the purged rows, so the database-level audit trail survives the delete.
 *
 * **Safety:** ships disarmed — runs as a DRY RUN (logs the exact orders it
 * would delete, deletes nothing) until `TEST_ORDER_PURGE_ENABLED=true` is set
 * in the API environment. Review one dry-run log before arming.
 */
@Injectable()
export class TestOrderPurgeService {
  private readonly logger = new Logger('TestOrderPurge');

  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

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
   * Find test orders, skip+log the stock-moved ones, hard-delete the rest.
   * Returns `{ deleted, skipped }`. Safe to call manually.
   */
  async purgeTestOrders(): Promise<{ deleted: number; skipped: number }> {
    const armed = process.env.TEST_ORDER_PURGE_ENABLED === 'true';

    // Test orders that already moved stock — never purged here; surfaced for a
    // human to clean up (so inventory can be corrected at the same time).
    const stockMoved = await this.db
      .select({
        id: schema.orders.id,
        customerName: schema.orders.customerName,
        status: schema.orders.status,
      })
      .from(schema.orders)
      .where(and(TEST_NAME_MATCH, notInArray(schema.orders.status, [...STOCK_NEUTRAL_STATUSES])))
      .orderBy(schema.orders.createdAt);

    if (stockMoved.length > 0) {
      const preview = stockMoved
        .slice(0, 30)
        .map((o) => `${o.id} (${o.customerName} · ${o.status})`)
        .join('; ');
      this.logger.warn(
        `${stockMoved.length} test order(s) already moved stock — NOT purged, ` +
          `need manual review (delete + correct inventory by hand): ${preview}` +
          (stockMoved.length > 30 ? ` … +${stockMoved.length - 30} more` : ''),
      );
    }

    // Purgeable test orders — stock-neutral statuses only, capped per run.
    const targets = await this.db
      .select({
        id: schema.orders.id,
        customerName: schema.orders.customerName,
        status: schema.orders.status,
      })
      .from(schema.orders)
      .where(and(TEST_NAME_MATCH, inArray(schema.orders.status, [...STOCK_NEUTRAL_STATUSES])))
      .orderBy(schema.orders.createdAt)
      .limit(MAX_PER_RUN);

    if (targets.length === 0) {
      return { deleted: 0, skipped: stockMoved.length };
    }

    const ids = targets.map((t) => t.id);
    const preview = targets
      .slice(0, 30)
      .map((t) => `${t.id} (${t.customerName} · ${t.status})`)
      .join('; ');

    if (!armed) {
      this.logger.warn(
        `DRY RUN — would hard-delete ${targets.length} test order(s). ` +
          `Set TEST_ORDER_PURGE_ENABLED=true to arm. Targets: ${preview}` +
          (targets.length > 30 ? ` … +${targets.length - 30} more` : ''),
      );
      return { deleted: 0, skipped: stockMoved.length };
    }

    // Hard delete — one SYSTEM-attributed transaction, children before parent
    // so every foreign key is satisfied. The `orders` temporal history table
    // keeps the removed rows, attributed to SYSTEM.
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      // Unlink rows that merely *reference* an order (don't delete the record).
      await tx
        .update(schema.cartAbandonments)
        .set({ convertedOrderId: null })
        .where(inArray(schema.cartAbandonments.convertedOrderId, ids));
      await tx
        .update(schema.crossFunnelAttempts)
        .set({ originalOrderId: null })
        .where(inArray(schema.crossFunnelAttempts.originalOrderId, ids));

      // Delete FK children, then the orders themselves.
      await tx.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, ids));
      await tx
        .delete(schema.orderTimelineEvents)
        .where(inArray(schema.orderTimelineEvents.orderId, ids));
      await tx.delete(schema.callLogs).where(inArray(schema.callLogs.orderId, ids));
      await tx.delete(schema.outboundMessages).where(inArray(schema.outboundMessages.orderId, ids));
      await tx
        .delete(schema.deliveryRemittanceOrders)
        .where(inArray(schema.deliveryRemittanceOrders.orderId, ids));
      await tx
        .delete(schema.deliveryConfirmationRequests)
        .where(inArray(schema.deliveryConfirmationRequests.orderId, ids));
      await tx.delete(schema.invoices).where(inArray(schema.invoices.orderId, ids));
      await tx.delete(schema.orders).where(inArray(schema.orders.id, ids));
    });

    this.logger.log(
      `Hard-deleted ${targets.length} test order(s)` +
        (stockMoved.length > 0 ? ` (${stockMoved.length} stock-moved skipped)` : '') +
        `. Targets: ${preview}` +
        (targets.length > 30 ? ` … +${targets.length - 30} more` : ''),
    );
    return { deleted: targets.length, skipped: stockMoved.length };
  }
}
