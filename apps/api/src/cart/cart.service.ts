import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, lt, desc, count, gte, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { SYSTEM_ACTOR_ID } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { withActor } from '../common/db/with-actor';

type CartDbOrTx =
  | PostgresJsDatabase<typeof schema>
  | Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0];

function maskPhone(phoneHash: string): string {
  if (phoneHash.length <= 8) return '****';
  return `${phoneHash.slice(0, 4)}****${phoneHash.slice(-4)}`;
}

@Injectable()
export class CartService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
  ) {}

  private async getCampaignBranchId(campaignId: string): Promise<string | null> {
    const rows = await this.db
      .select({ branchId: schema.campaigns.branchId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    return rows[0]?.branchId ?? null;
  }

  /**
   * Save or upsert a cart. Called by Edge Worker when user fills name + phone.
   * Same campaign + phone + product = upsert (refresh updated_at).
   * When actorId is provided (e.g. edge-form), audit trail records it; otherwise no actor.
   */
  async save(
    input: {
      campaignId: string;
      mediaBuyerId?: string;
      customerName: string;
      customerPhoneHash: string;
      productId: string;
      offerLabel?: string;
    },
    actorId?: string | null,
  ) {
    const run = async (db: CartDbOrTx) => {
      // Upsert key: campaign_id + phone_hash — one active PENDING cart per person per campaign.
      const existing = await db
        .select()
        .from(schema.cartAbandonments)
        .where(
          and(
            eq(schema.cartAbandonments.campaignId, input.campaignId),
            eq(schema.cartAbandonments.customerPhoneHash, input.customerPhoneHash),
            eq(schema.cartAbandonments.status, 'PENDING'),
          ),
        )
        .limit(1);

      const now = new Date();
      const existingRow = existing[0];
      if (existingRow) {
        await db
          .update(schema.cartAbandonments)
          .set({
            customerName: input.customerName,
            productId: input.productId,
            offerLabel: input.offerLabel ?? null,
            mediaBuyerId: input.mediaBuyerId ?? existingRow.mediaBuyerId,
            updatedAt: now,
          })
          .where(eq(schema.cartAbandonments.id, existingRow.id));
        return { id: existingRow.id, created: false as const };
      }

      const [row] = await db
        .insert(schema.cartAbandonments)
        .values({
          campaignId: input.campaignId,
          mediaBuyerId: input.mediaBuyerId ?? null,
          customerName: input.customerName,
          customerPhoneHash: input.customerPhoneHash,
          productId: input.productId,
          offerLabel: input.offerLabel ?? null,
          status: 'PENDING',
        })
        .returning({ id: schema.cartAbandonments.id });

      if (!row) {
        throw new Error('Failed to create cart');
      }
      return { id: row.id, created: true as const };
    };

    const result = actorId
      ? await withActor(this.db, { id: actorId }, (tx) => run(tx))
      : await run(this.db);

    const branchId = await this.getCampaignBranchId(input.campaignId);
    this.events.emitToRoom('cs-all', 'cart:updated', {}, branchId);
    return result;
  }

  /**
   * Mark cart as CONVERTED when user submits order.
   * When actorId is provided (e.g. from order create flow), audit trail records it.
   */
  async convert(cartId: string, orderId: string, actorId?: string | null): Promise<void> {
    const run = async (db: CartDbOrTx) => {
      const cartRows = await db
        .select({ campaignId: schema.cartAbandonments.campaignId })
        .from(schema.cartAbandonments)
        .where(eq(schema.cartAbandonments.id, cartId))
        .limit(1);

      await db
        .update(schema.cartAbandonments)
        .set({
          status: 'CONVERTED',
          convertedOrderId: orderId,
          updatedAt: new Date(),
        })
        .where(eq(schema.cartAbandonments.id, cartId));

      return cartRows[0]?.campaignId ?? null;
    };

    const campaignId = actorId
      ? await withActor(this.db, { id: actorId }, (tx) => run(tx))
      : await run(this.db);

    const branchId = campaignId ? await this.getCampaignBranchId(campaignId) : null;
    this.events.emitToRoom('cs-all', 'cart:updated', {}, branchId);
  }

  /**
   * Mark cart as CONVERTED by phone hash + product (when cartId not available).
   * Matches both PENDING and ABANDONED so we "bring back" carts that were marked abandoned if the user completes later.
   * When actorId is provided, audit trail records it.
   */
  async convertByPhoneAndProduct(
    campaignId: string,
    customerPhoneHash: string,
    productId: string,
    orderId: string,
    actorId?: string | null,
  ): Promise<void> {
    const run = async (db: CartDbOrTx) =>
      db
        .update(schema.cartAbandonments)
        .set({
          status: 'CONVERTED',
          convertedOrderId: orderId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.cartAbandonments.campaignId, campaignId),
            eq(schema.cartAbandonments.customerPhoneHash, customerPhoneHash),
            eq(schema.cartAbandonments.productId, productId),
            inArray(schema.cartAbandonments.status, ['PENDING', 'ABANDONED']),
          ),
        );

    if (actorId) {
      await withActor(this.db, { id: actorId }, (tx) => run(tx));
    } else {
      await run(this.db);
    }

    const branchId = await this.getCampaignBranchId(campaignId);
    this.events.emitToRoom('cs-all', 'cart:updated', {}, branchId);
  }

  /**
   * Cron: mark PENDING carts as ABANDONED every 10 minutes.
   * Carts not updated in 5+ minutes are considered abandoned.
   * If the user later completes the order, we still convert the cart (CONVERTED) via convert() / convertByPhoneAndProduct().
   */
  @Cron('0 */10 * * * *') // Every 10 minutes at :00 seconds
  async handleAbandonedCarts(): Promise<void> {
    const thresholdMinutes = 5;
    const count = await this.markAbandoned(thresholdMinutes, SYSTEM_ACTOR_ID);
    if (count > 0) {
      console.log(`[Cart] Marked ${count} cart(s) as abandoned`);
    }
  }

  /**
   * Mark PENDING carts as ABANDONED if updated_at is older than threshold.
   * When actorId is provided (e.g. from tRPC or SYSTEM_ACTOR_ID for cron), audit trail records it.
   */
  async markAbandoned(thresholdMinutes: number, actorId?: string | null): Promise<number> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const run = async (db: CartDbOrTx) =>
      db
        .update(schema.cartAbandonments)
        .set({ status: 'ABANDONED', updatedAt: new Date() })
        .where(
          and(
            eq(schema.cartAbandonments.status, 'PENDING'),
            lt(schema.cartAbandonments.updatedAt, threshold),
          ),
        )
        .returning({ id: schema.cartAbandonments.id, campaignId: schema.cartAbandonments.campaignId });

    const result = actorId
      ? await withActor(this.db, { id: actorId }, (tx) => run(tx))
      : await run(this.db);

    if (result.length > 0) {
      const campaignIds = Array.from(new Set(result.map((row) => row.campaignId)));
      for (const campaignId of campaignIds) {
        const branchId = await this.getCampaignBranchId(campaignId);
        this.events.emitToRoom('cs-all', 'cart:updated', {}, branchId);
      }
    }
    return result.length;
  }

  /**
   * List PENDING carts for CS dashboard (cart abandonment). Returns customer name, product, campaign, masked phone.
   */
  async listPending(limit = 50): Promise<
    Array<{
      id: string;
      customerName: string;
      customerPhoneDisplay: string;
      productId: string;
      productName: string | null;
      campaignId: string;
      campaignName: string | null;
      offerLabel: string | null;
      updatedAt: Date;
    }>
  > {
    // DISTINCT ON (customerPhoneHash) keeps only the latest cart per customer phone.
    // A customer changing product/offer selections creates multiple rows — we show only the most recent.
    const rows = await this.db.execute<{
      id: string;
      customerName: string;
      customerPhoneHash: string;
      productId: string;
      productName: string | null;
      campaignId: string;
      campaignName: string | null;
      offerLabel: string | null;
      updatedAt: Date;
    }>(sql`
      SELECT DISTINCT ON (ca.customer_phone_hash)
        ca.id,
        ca.customer_name   AS "customerName",
        ca.customer_phone_hash AS "customerPhoneHash",
        ca.product_id      AS "productId",
        p.name             AS "productName",
        ca.campaign_id     AS "campaignId",
        c.name             AS "campaignName",
        ca.offer_label     AS "offerLabel",
        ca.updated_at      AS "updatedAt"
      FROM cart_abandonments ca
      LEFT JOIN products p ON p.id = ca.product_id
      LEFT JOIN campaigns c ON c.id = ca.campaign_id
      WHERE ca.status = 'PENDING'
      ORDER BY ca.customer_phone_hash, ca.updated_at DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerPhoneDisplay: maskPhone(r.customerPhoneHash),
      productId: r.productId,
      productName: r.productName ?? null,
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? null,
      offerLabel: r.offerLabel ?? null,
      updatedAt: r.updatedAt ?? new Date(),
    }));
  }

  /**
   * List ABANDONED carts in the last 24h for CS dashboard (Cart Abandonment tab).
   * Same shape as listPending so the UI can render both.
   */
  async listAbandoned(limit = 50): Promise<
    Array<{
      id: string;
      customerName: string;
      customerPhoneDisplay: string;
      productId: string;
      productName: string | null;
      campaignId: string;
      campaignName: string | null;
      offerLabel: string | null;
      updatedAt: Date;
    }>
  > {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        id: schema.cartAbandonments.id,
        customerName: schema.cartAbandonments.customerName,
        customerPhoneHash: schema.cartAbandonments.customerPhoneHash,
        productId: schema.cartAbandonments.productId,
        productName: schema.products.name,
        campaignId: schema.cartAbandonments.campaignId,
        campaignName: schema.campaigns.name,
        offerLabel: schema.cartAbandonments.offerLabel,
        updatedAt: schema.cartAbandonments.updatedAt,
      })
      .from(schema.cartAbandonments)
      .leftJoin(schema.products, eq(schema.cartAbandonments.productId, schema.products.id))
      .leftJoin(schema.campaigns, eq(schema.cartAbandonments.campaignId, schema.campaigns.id))
      .where(
        and(
          eq(schema.cartAbandonments.status, 'ABANDONED'),
          gte(schema.cartAbandonments.updatedAt, twentyFourHoursAgo),
        ),
      )
      .orderBy(desc(schema.cartAbandonments.updatedAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerPhoneDisplay: maskPhone(r.customerPhoneHash),
      productId: r.productId,
      productName: r.productName ?? null,
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? null,
      offerLabel: r.offerLabel ?? null,
      updatedAt: r.updatedAt ?? new Date(),
    }));
  }

  /**
   * Live activity feed for CS dashboard.
   * Merges two sources:
   *   1. Cart-originated activity — carts in last 6h + their linked order status
   *   2. Direct orders (no cart) created in last 6h
   * Deduplicates by phone hash across both sources (latest activity wins).
   */
  async listActivity(limit = 60): Promise<
    Array<{
      id: string;
      customerName: string;
      customerPhoneDisplay: string;
      productName: string | null;
      offerLabel: string | null;
      cartStatus: 'PENDING' | 'ABANDONED' | 'CONVERTED' | null;
      orderStatus: string | null;
      linkedOrderId: string | null;
      totalAmount: string | null;
      updatedAt: Date;
    }>
  > {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sixHoursAgo = todayStart.toISOString();
    const rows = await this.db.execute<{
      id: string;
      customerName: string;
      customerPhoneHash: string;
      productName: string | null;
      offerLabel: string | null;
      cartStatus: 'PENDING' | 'ABANDONED' | 'CONVERTED' | null;
      orderStatus: string | null;
      linkedOrderId: string | null;
      totalAmount: string | null;
      updatedAt: Date;
    }>(sql`
      SELECT DISTINCT ON (phone_hash)
        id,
        "customerName",
        phone_hash        AS "customerPhoneHash",
        "productName",
        "offerLabel",
        "cartStatus",
        "orderStatus",
        "linkedOrderId",
        "totalAmount",
        "updatedAt"
      FROM (
        -- Source 1: cart-originated (with or without linked order)
        SELECT
          ca.id,
          ca.customer_name                                              AS "customerName",
          ca.customer_phone_hash                                        AS phone_hash,
          p.name                                                        AS "productName",
          ca.offer_label                                                AS "offerLabel",
          ca.status::text                                               AS "cartStatus",
          o.status                                                      AS "orderStatus",
          ca.converted_order_id                                         AS "linkedOrderId",
          COALESCE(o.total_amount, ot.price)::text                     AS "totalAmount",
          GREATEST(ca.updated_at, COALESCE(o.updated_at, ca.updated_at)) AS "updatedAt"
        FROM cart_abandonments ca
        LEFT JOIN products p ON p.id = ca.product_id
        LEFT JOIN orders o ON o.id = ca.converted_order_id
        LEFT JOIN campaigns c ON c.id = ca.campaign_id
        LEFT JOIN offer_templates ot ON ot.id = c.offer_template_id
        WHERE ca.updated_at >= ${sixHoursAgo}
          AND ca.status IN ('PENDING', 'ABANDONED', 'CONVERTED')

        UNION ALL

        -- Source 2: direct orders with no linked cart (created in last 6h)
        SELECT
          o.id,
          o.customer_name                                               AS "customerName",
          o.customer_phone_hash                                         AS phone_hash,
          p.name                                                        AS "productName",
          NULL::text                                                    AS "offerLabel",
          NULL::text                                                    AS "cartStatus",
          o.status                                                      AS "orderStatus",
          o.id                                                          AS "linkedOrderId",
          o.total_amount::text                                          AS "totalAmount",
          o.updated_at                                                  AS "updatedAt"
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.updated_at >= ${sixHoursAgo}
          AND NOT EXISTS (
            SELECT 1 FROM cart_abandonments ca
            WHERE ca.converted_order_id = o.id
          )
      ) combined
      ORDER BY phone_hash, "updatedAt" DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerPhoneDisplay: maskPhone(r.customerPhoneHash),
      productName: r.productName ?? null,
      offerLabel: r.offerLabel ?? null,
      cartStatus: r.cartStatus,
      orderStatus: r.orderStatus ?? null,
      linkedOrderId: r.linkedOrderId ?? null,
      totalAmount: r.totalAmount ?? null,
      updatedAt: r.updatedAt ?? new Date(),
    }));
  }

  /**
   * Delete an abandoned cart by ID. Head of CS / SuperAdmin only.
   * Only ABANDONED carts can be deleted (not PENDING or CONVERTED).
   */
  async deleteAbandoned(cartId: string, actorId: string): Promise<{ deleted: boolean }> {
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL yannis.current_user_id = ${actorId}`);
      return tx
        .delete(schema.cartAbandonments)
        .where(
          and(
            eq(schema.cartAbandonments.id, cartId),
            eq(schema.cartAbandonments.status, 'ABANDONED'),
          ),
        )
        .returning({ id: schema.cartAbandonments.id });
    });
    return { deleted: result.length > 0 };
  }

  /**
   * Get cart abandonment stats for CS dashboard.
   */
  async getStats(): Promise<{ pending: number; abandonedLast24h: number }> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [pendingRes, abandonedRes] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(schema.cartAbandonments)
        .where(eq(schema.cartAbandonments.status, 'PENDING')),
      this.db
        .select({ count: count() })
        .from(schema.cartAbandonments)
        .where(
          and(
            eq(schema.cartAbandonments.status, 'ABANDONED'),
            gte(schema.cartAbandonments.updatedAt, twentyFourHoursAgo),
          ),
        ),
    ]);

    return {
      pending: pendingRes[0]?.count ?? 0,
      abandonedLast24h: abandonedRes[0]?.count ?? 0,
    };
  }
}
