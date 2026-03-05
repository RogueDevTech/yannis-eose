import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, lt, desc, count, gte, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';

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

  /**
   * Save or upsert a cart. Called by Edge Worker when user fills name + phone.
   * Same campaign + phone + product = upsert (refresh updated_at).
   */
  async save(input: {
    campaignId: string;
    mediaBuyerId?: string;
    customerName: string;
    customerPhoneHash: string;
    productId: string;
    offerLabel?: string;
  }) {
    const existing = await this.db
      .select()
      .from(schema.cartAbandonments)
      .where(
        and(
          eq(schema.cartAbandonments.campaignId, input.campaignId),
          eq(schema.cartAbandonments.customerPhoneHash, input.customerPhoneHash),
          eq(schema.cartAbandonments.productId, input.productId),
          eq(schema.cartAbandonments.status, 'PENDING'),
        ),
      )
      .limit(1);

    const now = new Date();
    const existingRow = existing[0];
    if (existingRow) {
      await this.db
        .update(schema.cartAbandonments)
        .set({
          customerName: input.customerName,
          offerLabel: input.offerLabel ?? existingRow.offerLabel,
          mediaBuyerId: input.mediaBuyerId ?? existingRow.mediaBuyerId,
          updatedAt: now,
        })
        .where(eq(schema.cartAbandonments.id, existingRow.id));
      this.events.emitToRoom('cs-all', 'cart:updated', {});
      return { id: existingRow.id, created: false };
    }

    const [row] = await this.db
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
    this.events.emitToRoom('cs-all', 'cart:updated', {});
    return { id: row.id, created: true };
  }

  /**
   * Mark cart as CONVERTED when user submits order.
   */
  async convert(cartId: string, orderId: string): Promise<void> {
    await this.db
      .update(schema.cartAbandonments)
      .set({
        status: 'CONVERTED',
        convertedOrderId: orderId,
        updatedAt: new Date(),
      })
      .where(eq(schema.cartAbandonments.id, cartId));
    this.events.emitToRoom('cs-all', 'cart:updated', {});
  }

  /**
   * Mark cart as CONVERTED by phone hash + product (when cartId not available).
   * Matches both PENDING and ABANDONED so we "bring back" carts that were marked abandoned if the user completes later.
   */
  async convertByPhoneAndProduct(
    campaignId: string,
    customerPhoneHash: string,
    productId: string,
    orderId: string,
  ): Promise<void> {
    await this.db
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
    this.events.emitToRoom('cs-all', 'cart:updated', {});
  }

  /**
   * Cron: mark PENDING carts as ABANDONED every 10 minutes.
   * Carts not updated in 5+ minutes are considered abandoned.
   * If the user later completes the order, we still convert the cart (CONVERTED) via convert() / convertByPhoneAndProduct().
   */
  @Cron('0 */10 * * * *') // Every 10 minutes at :00 seconds
  async handleAbandonedCarts(): Promise<void> {
    const thresholdMinutes = 5;
    const count = await this.markAbandoned(thresholdMinutes);
    if (count > 0) {
      console.log(`[Cart] Marked ${count} cart(s) as abandoned`);
    }
  }

  /**
   * Mark PENDING carts as ABANDONED if updated_at is older than threshold.
   */
  async markAbandoned(thresholdMinutes: number): Promise<number> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const result = await this.db
      .update(schema.cartAbandonments)
      .set({ status: 'ABANDONED', updatedAt: new Date() })
      .where(
        and(
          eq(schema.cartAbandonments.status, 'PENDING'),
          lt(schema.cartAbandonments.updatedAt, threshold),
        ),
      )
      .returning({ id: schema.cartAbandonments.id });

    if (result.length > 0) {
      this.events.emitToRoom('cs-all', 'cart:updated', {});
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
      .where(eq(schema.cartAbandonments.status, 'PENDING'))
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
