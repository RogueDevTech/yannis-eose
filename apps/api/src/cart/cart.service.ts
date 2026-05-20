import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, lt, desc, count, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { SYSTEM_ACTOR_ID, formatOrderCustomerPhoneDisplay } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { withActor } from '../common/db/with-actor';

type CartDbOrTx =
  | PostgresJsDatabase<typeof schema>
  | Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0];

/**
 * Best-effort display from cart row: digit mask when raw phone is present,
 * otherwise "Hidden" / "—" when only a hash or nothing (never hash fragments as a "phone").
 */
function maskCartPhone(rawPhone: string | null, phoneHash: string): string {
  return formatOrderCustomerPhoneDisplay(rawPhone, phoneHash);
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
      /** Raw phone — captured for CS reveal-to-call when the cart drops off. */
      customerPhone?: string;
      productId: string;
      offerLabel?: string;
      // Progressive form-field capture (migration 0142). Optional — Edge sends
      // whatever the customer has typed at debounce time; we merge field-by-field
      // so a later partial save never wipes an earlier value.
      customerEmail?: string;
      customerAddress?: string;
      deliveryAddress?: string;
      deliveryState?: string;
      deliveryNotes?: string;
      customerGender?: string;
      preferredDeliveryDate?: string;
      paymentMethod?: string;
      quantity?: number;
      customFieldValues?: Record<string, unknown>;
    },
    actorId?: string | null,
  ) {
    const trimmedPhone = input.customerPhone?.trim() || null;
    // Pick only fields that arrived in this payload — never overwrite an earlier
    // captured value with `null` on a partial save. Keys map 1:1 to schema columns.
    const trim = (v: string | undefined) => (typeof v === 'string' ? v.trim() || undefined : undefined);
    const progressive = {
      customerEmail: trim(input.customerEmail),
      customerAddress: trim(input.customerAddress),
      deliveryAddress: trim(input.deliveryAddress),
      deliveryState: trim(input.deliveryState),
      deliveryNotes: trim(input.deliveryNotes),
      customerGender: trim(input.customerGender),
      preferredDeliveryDate: trim(input.preferredDeliveryDate),
      paymentMethod: trim(input.paymentMethod),
      quantity: typeof input.quantity === 'number' ? input.quantity : undefined,
      customFieldValues:
        input.customFieldValues && Object.keys(input.customFieldValues).length > 0
          ? input.customFieldValues
          : undefined,
    } as const;
    const run = async (db: CartDbOrTx) => {
      // Guard: if a CONVERTED cart already exists for this campaign + phone,
      // skip the save — the customer already placed an order and a late-firing
      // debounced cart save must not create a new PENDING row.
      const [converted] = await db
        .select({ id: schema.cartAbandonments.id })
        .from(schema.cartAbandonments)
        .where(
          and(
            eq(schema.cartAbandonments.campaignId, input.campaignId),
            eq(schema.cartAbandonments.customerPhoneHash, input.customerPhoneHash),
            eq(schema.cartAbandonments.status, 'CONVERTED'),
          ),
        )
        .limit(1);
      if (converted) {
        return { id: converted.id, created: false as const };
      }

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
            // Keep an existing phone if the new payload missed it (older Edge Worker
            // builds, partial form retries) — only overwrite when caller actually
            // sent something usable.
            customerPhone: trimmedPhone ?? existingRow.customerPhone,
            // Progressive merge: only overwrite a column when this payload carries a
            // value. `??` keeps the prior captured value intact when the field is
            // missing from the current debounce.
            customerEmail: progressive.customerEmail ?? existingRow.customerEmail,
            customerAddress: progressive.customerAddress ?? existingRow.customerAddress,
            deliveryAddress: progressive.deliveryAddress ?? existingRow.deliveryAddress,
            deliveryState: progressive.deliveryState ?? existingRow.deliveryState,
            deliveryNotes: progressive.deliveryNotes ?? existingRow.deliveryNotes,
            customerGender: progressive.customerGender ?? existingRow.customerGender,
            preferredDeliveryDate: progressive.preferredDeliveryDate ?? existingRow.preferredDeliveryDate,
            paymentMethod: progressive.paymentMethod ?? existingRow.paymentMethod,
            quantity: progressive.quantity ?? existingRow.quantity,
            customFieldValues: progressive.customFieldValues ?? existingRow.customFieldValues,
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
          customerPhone: trimmedPhone,
          productId: input.productId,
          offerLabel: input.offerLabel ?? null,
          status: 'PENDING',
          customerEmail: progressive.customerEmail ?? null,
          customerAddress: progressive.customerAddress ?? null,
          deliveryAddress: progressive.deliveryAddress ?? null,
          deliveryState: progressive.deliveryState ?? null,
          deliveryNotes: progressive.deliveryNotes ?? null,
          customerGender: progressive.customerGender ?? null,
          preferredDeliveryDate: progressive.preferredDeliveryDate ?? null,
          paymentMethod: progressive.paymentMethod ?? null,
          quantity: progressive.quantity ?? null,
          customFieldValues: progressive.customFieldValues ?? null,
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
      customerPhone: string | null;
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
        ca.customer_phone  AS "customerPhone",
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
      customerPhoneDisplay: maskCartPhone(r.customerPhone, r.customerPhoneHash),
      productId: r.productId,
      productName: r.productName ?? null,
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? null,
      offerLabel: r.offerLabel ?? null,
      updatedAt: r.updatedAt ?? new Date(),
    }));
  }

  /**
   * List ABANDONED carts for CS dashboard — persists until cleared via {@link deleteAbandoned}.
   * Paginated; `page` is clamped to the last page when out of range (e.g. after deletes).
   *
   * When `includeRawPhone` is true (caller has `cart.delete` permission), the raw phone
   * is returned alongside the masked display so the abandoned-cart detail modal can render
   * dialable contact details without a second per-card reveal round-trip. The reveal endpoint
   * stays as the audited fallback for cases where the list payload is stale.
   */
  async listAbandoned(opts: { page?: number; limit?: number; includeRawPhone?: boolean } = {}): Promise<{
    items: Array<{
      id: string;
      customerName: string;
      customerPhoneDisplay: string;
      customerPhone: string | null;
      productId: string;
      productName: string | null;
      campaignId: string;
      campaignName: string | null;
      offerLabel: string | null;
      updatedAt: Date;
      // Progressive form-field capture (migration 0142). Surfaced inline so the
      // detail modal pre-fills every value the customer typed — no second fetch.
      customerEmail: string | null;
      customerAddress: string | null;
      deliveryAddress: string | null;
      deliveryState: string | null;
      deliveryNotes: string | null;
      customerGender: string | null;
      preferredDeliveryDate: string | null;
      paymentMethod: string | null;
      quantity: number | null;
      customFieldValues: Record<string, unknown> | null;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    let page = Math.max(1, Math.floor(opts.page ?? 1));

    const abandonedWhere = eq(schema.cartAbandonments.status, 'ABANDONED');
    const totalRows = await this.db.select({ count: count() }).from(schema.cartAbandonments).where(abandonedWhere);
    const total = Number(totalRows[0]?.count ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    if (totalPages > 0 && page > totalPages) page = totalPages;

    const offset = (page - 1) * limit;

    const rows = await this.db
      .select({
        id: schema.cartAbandonments.id,
        customerName: schema.cartAbandonments.customerName,
        customerPhoneHash: schema.cartAbandonments.customerPhoneHash,
        customerPhone: schema.cartAbandonments.customerPhone,
        productId: schema.cartAbandonments.productId,
        productName: schema.products.name,
        campaignId: schema.cartAbandonments.campaignId,
        campaignName: schema.campaigns.name,
        offerLabel: schema.cartAbandonments.offerLabel,
        updatedAt: schema.cartAbandonments.updatedAt,
        customerEmail: schema.cartAbandonments.customerEmail,
        customerAddress: schema.cartAbandonments.customerAddress,
        deliveryAddress: schema.cartAbandonments.deliveryAddress,
        deliveryState: schema.cartAbandonments.deliveryState,
        deliveryNotes: schema.cartAbandonments.deliveryNotes,
        customerGender: schema.cartAbandonments.customerGender,
        preferredDeliveryDate: schema.cartAbandonments.preferredDeliveryDate,
        paymentMethod: schema.cartAbandonments.paymentMethod,
        quantity: schema.cartAbandonments.quantity,
        customFieldValues: schema.cartAbandonments.customFieldValues,
      })
      .from(schema.cartAbandonments)
      .leftJoin(schema.products, eq(schema.cartAbandonments.productId, schema.products.id))
      .leftJoin(schema.campaigns, eq(schema.cartAbandonments.campaignId, schema.campaigns.id))
      .where(abandonedWhere)
      .orderBy(desc(schema.cartAbandonments.updatedAt))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        customerName: r.customerName,
        customerPhoneDisplay: maskCartPhone(r.customerPhone, r.customerPhoneHash),
        customerPhone: opts.includeRawPhone ? r.customerPhone ?? null : null,
        productId: r.productId,
        productName: r.productName ?? null,
        campaignId: r.campaignId,
        campaignName: r.campaignName ?? null,
        offerLabel: r.offerLabel ?? null,
        updatedAt: r.updatedAt ?? new Date(),
        customerEmail: r.customerEmail ?? null,
        customerAddress: r.customerAddress ?? null,
        deliveryAddress: r.deliveryAddress ?? null,
        deliveryState: r.deliveryState ?? null,
        deliveryNotes: r.deliveryNotes ?? null,
        customerGender: r.customerGender ?? null,
        preferredDeliveryDate: r.preferredDeliveryDate ?? null,
        paymentMethod: r.paymentMethod ?? null,
        quantity: r.quantity ?? null,
        customFieldValues: (r.customFieldValues as Record<string, unknown> | null) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Fetch a single cart by id — same row shape as `listAbandoned` items, but with
   * no status filter so a CONVERTED cart (one already recovered into an order) can
   * still be inspected. Powers the "View cart" quick-detail action on the recovered-
   * from-cart orders list. Returns null when the id matches nothing.
   *
   * `includeRawPhone` mirrors `listAbandoned`: only callers who could already trigger
   * the audited reveal (`cart.delete` / SUPER_ADMIN) get the dialable number inline.
   */
  async getById(
    cartId: string,
    opts: { includeRawPhone?: boolean } = {},
  ): Promise<{
    id: string;
    customerName: string;
    customerPhoneDisplay: string;
    customerPhone: string | null;
    productId: string;
    productName: string | null;
    campaignId: string;
    campaignName: string | null;
    offerLabel: string | null;
    updatedAt: Date;
    customerEmail: string | null;
    customerAddress: string | null;
    deliveryAddress: string | null;
    deliveryState: string | null;
    deliveryNotes: string | null;
    customerGender: string | null;
    preferredDeliveryDate: string | null;
    paymentMethod: string | null;
    quantity: number | null;
    customFieldValues: Record<string, unknown> | null;
  } | null> {
    const rows = await this.db
      .select({
        id: schema.cartAbandonments.id,
        customerName: schema.cartAbandonments.customerName,
        customerPhoneHash: schema.cartAbandonments.customerPhoneHash,
        customerPhone: schema.cartAbandonments.customerPhone,
        productId: schema.cartAbandonments.productId,
        productName: schema.products.name,
        campaignId: schema.cartAbandonments.campaignId,
        campaignName: schema.campaigns.name,
        offerLabel: schema.cartAbandonments.offerLabel,
        updatedAt: schema.cartAbandonments.updatedAt,
        customerEmail: schema.cartAbandonments.customerEmail,
        customerAddress: schema.cartAbandonments.customerAddress,
        deliveryAddress: schema.cartAbandonments.deliveryAddress,
        deliveryState: schema.cartAbandonments.deliveryState,
        deliveryNotes: schema.cartAbandonments.deliveryNotes,
        customerGender: schema.cartAbandonments.customerGender,
        preferredDeliveryDate: schema.cartAbandonments.preferredDeliveryDate,
        paymentMethod: schema.cartAbandonments.paymentMethod,
        quantity: schema.cartAbandonments.quantity,
        customFieldValues: schema.cartAbandonments.customFieldValues,
      })
      .from(schema.cartAbandonments)
      .leftJoin(schema.products, eq(schema.cartAbandonments.productId, schema.products.id))
      .leftJoin(schema.campaigns, eq(schema.cartAbandonments.campaignId, schema.campaigns.id))
      .where(eq(schema.cartAbandonments.id, cartId))
      .limit(1);

    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      customerName: r.customerName,
      customerPhoneDisplay: maskCartPhone(r.customerPhone, r.customerPhoneHash),
      customerPhone: opts.includeRawPhone ? r.customerPhone ?? null : null,
      productId: r.productId,
      productName: r.productName ?? null,
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? null,
      offerLabel: r.offerLabel ?? null,
      updatedAt: r.updatedAt ?? new Date(),
      customerEmail: r.customerEmail ?? null,
      customerAddress: r.customerAddress ?? null,
      deliveryAddress: r.deliveryAddress ?? null,
      deliveryState: r.deliveryState ?? null,
      deliveryNotes: r.deliveryNotes ?? null,
      customerGender: r.customerGender ?? null,
      preferredDeliveryDate: r.preferredDeliveryDate ?? null,
      paymentMethod: r.paymentMethod ?? null,
      quantity: r.quantity ?? null,
      customFieldValues: (r.customFieldValues as Record<string, unknown> | null) ?? null,
    };
  }

  /**
   * Live activity feed for CS dashboard.
   * Merges two sources:
   *   1. Cart-originated activity — carts in last 6h + their linked order status
   *   2. Direct orders (no cart) created in last 6h
   * Deduplicates by phone hash across both sources (latest activity wins).
   *
   * Optional filters:
   *   - mediaBuyerId: only include carts/orders owned by this MB (carts joined via
   *     campaigns.media_buyer_id; orders via orders.media_buyer_id directly).
   *   - branchId: only include carts/orders for this branch (carts joined via
   *     campaigns.branch_id; orders via orders.branch_id).
   * When no filter is passed (default), behavior is unchanged — caller has org-wide
   * visibility (CS dashboard / admin Marketing Overview for HoM/admin/global).
   */
  async listActivity(opts: { limit?: number; mediaBuyerId?: string; branchId?: string } = {}): Promise<
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
    const limit = opts.limit ?? 60;
    const mediaBuyerId = opts.mediaBuyerId ?? null;
    const branchId = opts.branchId ?? null;
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
          COALESCE(o.total_amount, ot.price, p.base_sale_price)::text  AS "totalAmount",
          GREATEST(ca.updated_at, COALESCE(o.updated_at, ca.updated_at)) AS "updatedAt"
        FROM cart_abandonments ca
        LEFT JOIN products p ON p.id = ca.product_id
        LEFT JOIN orders o ON o.id = ca.converted_order_id
        LEFT JOIN campaigns c ON c.id = ca.campaign_id
        LEFT JOIN offer_templates ot ON ot.id = c.offer_template_id
        WHERE ca.updated_at >= ${sixHoursAgo}
          AND ca.status IN ('PENDING', 'ABANDONED', 'CONVERTED')
          AND (${mediaBuyerId}::uuid IS NULL OR c.media_buyer_id = ${mediaBuyerId}::uuid)
          AND (${branchId}::uuid IS NULL OR c.branch_id = ${branchId}::uuid)

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
          AND (${mediaBuyerId}::uuid IS NULL OR o.media_buyer_id = ${mediaBuyerId}::uuid)
          AND (${branchId}::uuid IS NULL OR o.branch_id = ${branchId}::uuid)
      ) combined
      ORDER BY phone_hash, "updatedAt" DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerPhoneDisplay: formatOrderCustomerPhoneDisplay(null, r.customerPhoneHash),
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
      await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actorId}, true)`);
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
   * Reveal the raw customer phone for a single dropped-off cart so a Sales rep
   * can dial / SMS / WhatsApp the customer (CEO directive 2026-05-08).
   *
   * Pillar 2: phone is never broadcast in lists — only this single-shot,
   * actor-audited reveal returns the raw value, and only for ABANDONED rows.
   * Pre-directive carts have `customerPhone = NULL` and return
   * `{ phone: '', isDialable: false }` so the UI can render a friendly
   * "phone wasn't captured" message.
   */
  async revealPhoneForAbandonedCart(
    cartId: string,
    actorId: string,
  ): Promise<{ phone: string; isDialable: boolean }> {
    const rows = await this.db
      .select({
        id: schema.cartAbandonments.id,
        status: schema.cartAbandonments.status,
        customerPhone: schema.cartAbandonments.customerPhone,
      })
      .from(schema.cartAbandonments)
      .where(eq(schema.cartAbandonments.id, cartId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new Error('Cart not found');
    }
    // Only ABANDONED carts are surfaced in the dropped-off backlog. PENDING
    // carts are still being filled (we don't out them); CONVERTED rows have
    // a real order whose own reveal flow already covers it.
    if (row.status !== 'ABANDONED') {
      return { phone: '', isDialable: false };
    }

    const phone = row.customerPhone?.trim() ?? '';
    if (!phone) {
      return { phone: '', isDialable: false };
    }

    // Audit the reveal as a write so the action shows up in the actor's
    // activity timeline. The cart row itself isn't mutated — set_config
    // attribution on the tx is enough; nothing to commit.
    await withActor(this.db, { id: actorId }, async (tx) => {
      await tx.execute(
        sql`SELECT 1 FROM cart_abandonments WHERE id = ${cartId} LIMIT 1`,
      );
    });

    return { phone, isDialable: true };
  }

  /**
   * Get cart abandonment stats for CS dashboard.
   */
  async getStats(): Promise<{ pending: number; abandonedOpen: number }> {
    const [pendingRes, abandonedRes] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(schema.cartAbandonments)
        .where(eq(schema.cartAbandonments.status, 'PENDING')),
      this.db
        .select({ count: count() })
        .from(schema.cartAbandonments)
        .where(eq(schema.cartAbandonments.status, 'ABANDONED')),
    ]);

    return {
      pending: pendingRes[0]?.count ?? 0,
      abandonedOpen: abandonedRes[0]?.count ?? 0,
    };
  }

  /**
   * Count open (un-recovered) ABANDONED carts, optionally scoped to one media
   * buyer and/or branch via the cart's campaign. Powers the "Cart abandonment"
   * KPI on the Marketing Orders overview strip — a Media Buyer sees only their
   * own dropped carts; HoM / admin see branch-wide or org-wide.
   */
  async countAbandoned(
    opts: { mediaBuyerId?: string | null; branchId?: string | null } = {},
  ): Promise<number> {
    const conditions = [eq(schema.cartAbandonments.status, 'ABANDONED')];
    if (opts.mediaBuyerId) {
      conditions.push(eq(schema.campaigns.mediaBuyerId, opts.mediaBuyerId));
    }
    if (opts.branchId) {
      conditions.push(eq(schema.campaigns.branchId, opts.branchId));
    }
    const res = await this.db
      .select({ count: count() })
      .from(schema.cartAbandonments)
      .leftJoin(
        schema.campaigns,
        eq(schema.cartAbandonments.campaignId, schema.campaigns.id),
      )
      .where(and(...conditions));
    return Number(res[0]?.count ?? 0);
  }
}
