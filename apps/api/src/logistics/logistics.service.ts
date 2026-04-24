import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, ilike, count, lt, gte, lte, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  CreateProviderInput,
  UpdateProviderInput,
  ListProvidersInput,
  CreateLocationInput,
  UpdateLocationInput,
  ListLocationsInput,
  CreateRemittanceInput,
  ListRemittancesInput,
  MarkRemittanceReceivedInput,
  CreateDeliveryRemittanceInput,
  ListDeliveryRemittancesInput,
  MarkDeliveryRemittanceReceivedInput,
  SubmitDeliveryConfirmationInput,
  ListDeliveryConfirmationRequestsInput,
  ApproveDeliveryConfirmationInput,
  RejectDeliveryConfirmationInput,
  DisputeDeliveryRemittanceInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor } from '../common/db/with-actor';
import { OrdersService } from '../orders/orders.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class LogisticsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => OrdersService)) private readonly ordersService: OrdersService,
  ) {}

  // ============================================
  // Providers
  // ============================================

  async createProvider(input: CreateProviderInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.logisticsProviders)
        .values({
          name: input.name,
          contactInfo: input.contactInfo ?? null,
          coverageArea: input.coverageArea ?? null,
          rateCard: input.rateCard ?? null,
        })
        .returning();

      const provider = rows[0];
      if (!provider) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create provider' });
      }
      return provider;
    });
  }

  async updateProvider(input: UpdateProviderInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateFields['name'] = input.name;
      if (input.contactInfo !== undefined) updateFields['contactInfo'] = input.contactInfo;
      if (input.coverageArea !== undefined) updateFields['coverageArea'] = input.coverageArea;
      if (input.rateCard !== undefined) updateFields['rateCard'] = input.rateCard;
      if (input.status !== undefined) updateFields['status'] = input.status;

      const rows = await tx
        .update(schema.logisticsProviders)
        .set(updateFields)
        .where(eq(schema.logisticsProviders.id, input.providerId))
        .returning();

      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
      }
      return rows[0];
    });
  }

  async getProviderById(providerId: string) {
    const rows = await this.db
      .select()
      .from(schema.logisticsProviders)
      .where(eq(schema.logisticsProviders.id, providerId))
      .limit(1);

    if (!rows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
    }

    // Get location count
    const locationRows = await this.db
      .select({ count: count() })
      .from(schema.logisticsLocations)
      .where(eq(schema.logisticsLocations.providerId, providerId));

    return { ...rows[0], locationCount: locationRows[0]?.count ?? 0 };
  }

  async listProviders(input: ListProvidersInput) {
    const conditions = [];
    if (input.status) {
      conditions.push(eq(schema.logisticsProviders.status, input.status));
    }
    if (input.search) {
      conditions.push(ilike(schema.logisticsProviders.name, `%${input.search}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [providers, totalRows] = await Promise.all([
      this.db.select().from(schema.logisticsProviders).where(whereClause)
        .orderBy(desc(schema.logisticsProviders.createdAt))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.logisticsProviders).where(whereClause),
    ]);

    return {
      providers,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  // ============================================
  // Locations
  // ============================================

  async createLocation(input: CreateLocationInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      // Verify provider exists
      const providerRows = await tx
        .select()
        .from(schema.logisticsProviders)
        .where(eq(schema.logisticsProviders.id, input.providerId))
        .limit(1);

      if (!providerRows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
      }

      const rows = await tx
        .insert(schema.logisticsLocations)
        .values({
          providerId: input.providerId,
          name: input.name,
          address: input.address,
          coordinates: input.coordinates ?? null,
          whatsappGroupLink: input.whatsappGroupLink ?? null,
        })
        .returning();

      const location = rows[0];
      if (!location) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create location' });
      }
      return location;
    });
  }

  async updateLocation(input: UpdateLocationInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateFields['name'] = input.name;
      if (input.address !== undefined) updateFields['address'] = input.address;
      if (input.coordinates !== undefined) updateFields['coordinates'] = input.coordinates;
      if (input.status !== undefined) updateFields['status'] = input.status;
      if (input.whatsappGroupLink !== undefined) updateFields['whatsappGroupLink'] = input.whatsappGroupLink;

      const rows = await tx
        .update(schema.logisticsLocations)
        .set(updateFields)
        .where(eq(schema.logisticsLocations.id, input.locationId))
        .returning();

      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Location not found' });
      }
      return rows[0];
    });
  }

  async listLocations(input: ListLocationsInput) {
    const conditions = [];
    if (input.providerId) {
      conditions.push(eq(schema.logisticsLocations.providerId, input.providerId));
    }
    if (input.status) {
      conditions.push(eq(schema.logisticsLocations.status, input.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [locations, totalRows] = await Promise.all([
      this.db.select().from(schema.logisticsLocations).where(whereClause)
        .orderBy(desc(schema.logisticsLocations.createdAt))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.logisticsLocations).where(whereClause),
    ]);

    return {
      locations,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  // ============================================
  // Escalation & Monitoring
  // ============================================

  /**
   * Find all completed transfers where quantityReceived < quantitySent
   * and status is DISPUTED — indicates shrinkage/loss during transit.
   */
  async getShrinkageAlerts() {
    const fromLocation = alias(schema.logisticsLocations, 'from_loc');
    const toLocation = alias(schema.logisticsLocations, 'to_loc');

    const alerts = await this.db
      .select({
        transferId: schema.stockTransfers.id,
        productId: schema.stockTransfers.productId,
        productName: schema.products.name,
        fromLocationId: schema.stockTransfers.fromLocationId,
        fromLocationName: fromLocation.name,
        toLocationId: schema.stockTransfers.toLocationId,
        toLocationName: toLocation.name,
        quantitySent: schema.stockTransfers.quantitySent,
        quantityReceived: schema.stockTransfers.quantityReceived,
        shrinkageReason: schema.stockTransfers.shrinkageReason,
        createdAt: schema.stockTransfers.createdAt,
        verifiedAt: schema.stockTransfers.verifiedAt,
      })
      .from(schema.stockTransfers)
      .innerJoin(schema.products, eq(schema.stockTransfers.productId, schema.products.id))
      .innerJoin(fromLocation, eq(schema.stockTransfers.fromLocationId, fromLocation.id))
      .innerJoin(toLocation, eq(schema.stockTransfers.toLocationId, toLocation.id))
      .where(
        and(
          eq(schema.stockTransfers.transferStatus, 'DISPUTED'),
          isNotNull(schema.stockTransfers.quantityReceived),
        ),
      )
      .orderBy(desc(schema.stockTransfers.createdAt));

    return alerts.map((a) => ({
      ...a,
      shortage: a.quantitySent - (Number(a.quantityReceived) || 0),
    }));
  }

  /**
   * Find orders stuck in DISPATCHED or IN_TRANSIT for more than
   * the given threshold hours — indicates delivery issues.
   */
  async getStuckOrders(thresholdHours: number) {
    const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const stuckOrders = await this.db
      .select({
        orderId: schema.orders.id,
        status: schema.orders.status,
        customerName: schema.orders.customerName,
        deliveryAddress: schema.orders.deliveryAddress,
        riderId: schema.orders.riderId,
        riderName: schema.users.name,
        logisticsLocationId: schema.orders.logisticsLocationId,
        dispatchedAt: schema.orders.dispatchedAt,
        updatedAt: schema.orders.updatedAt,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.riderId, schema.users.id))
      .where(
        and(
          inArray(schema.orders.status, ['DISPATCHED', 'IN_TRANSIT']),
          lt(schema.orders.updatedAt, cutoff),
        ),
      )
      .orderBy(schema.orders.updatedAt);

    return stuckOrders.map((o) => {
      const stuckSinceMs = Date.now() - new Date(o.updatedAt).getTime();
      const stuckHours = Math.round(stuckSinceMs / (1000 * 60 * 60) * 10) / 10;
      return {
        ...o,
        stuckHours,
      };
    });
  }

  /**
   * Find stock transfers in IN_TRANSIT status where createdAt is older
   * than the threshold hours — indicates delayed transfers.
   */
  async getTransferDelays(thresholdHours: number) {
    const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const fromLocation = alias(schema.logisticsLocations, 'from_loc');
    const toLocation = alias(schema.logisticsLocations, 'to_loc');

    const delayedTransfers = await this.db
      .select({
        transferId: schema.stockTransfers.id,
        productId: schema.stockTransfers.productId,
        productName: schema.products.name,
        fromLocationId: schema.stockTransfers.fromLocationId,
        fromLocationName: fromLocation.name,
        toLocationId: schema.stockTransfers.toLocationId,
        toLocationName: toLocation.name,
        quantitySent: schema.stockTransfers.quantitySent,
        createdAt: schema.stockTransfers.createdAt,
      })
      .from(schema.stockTransfers)
      .innerJoin(schema.products, eq(schema.stockTransfers.productId, schema.products.id))
      .innerJoin(fromLocation, eq(schema.stockTransfers.fromLocationId, fromLocation.id))
      .innerJoin(toLocation, eq(schema.stockTransfers.toLocationId, toLocation.id))
      .where(
        and(
          eq(schema.stockTransfers.transferStatus, 'IN_TRANSIT'),
          lt(schema.stockTransfers.createdAt, cutoff),
        ),
      )
      .orderBy(schema.stockTransfers.createdAt);

    return delayedTransfers.map((t) => {
      const delayMs = Date.now() - new Date(t.createdAt).getTime();
      const delayHours = Math.round(delayMs / (1000 * 60 * 60) * 10) / 10;
      return {
        ...t,
        delayHours,
      };
    });
  }

  /**
   * Aggregated logistics health dashboard combining shrinkage alerts,
   * stuck orders (>24h), and transfer delays (>48h).
   */
  async getLogisticsHealthDashboard() {
    const [shrinkageAlerts, stuckOrders, transferDelays] = await Promise.all([
      this.getShrinkageAlerts(),
      this.getStuckOrders(24),
      this.getTransferDelays(48),
    ]);

    return {
      shrinkageAlerts,
      shrinkageCount: shrinkageAlerts.length,
      stuckOrders,
      stuckOrdersCount: stuckOrders.length,
      transferDelays,
      transferDelaysCount: transferDelays.length,
      totalEscalations: shrinkageAlerts.length + stuckOrders.length + transferDelays.length,
    };
  }

  /**
   * List riders (TPL_RIDER users) for dispatch dropdowns.
   * Returns id, name, logisticsLocationId. Gated by logistics.read.
   */
  async listRiders(): Promise<Array<{ id: string; name: string; logisticsLocationId: string | null }>> {
    const rows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        logisticsLocationId: schema.users.logisticsLocationId,
      })
      .from(schema.users)
      .where(and(eq(schema.users.role, 'TPL_RIDER'), eq(schema.users.status, 'ACTIVE')))
      .orderBy(schema.users.name);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      logisticsLocationId: r.logisticsLocationId,
    }));
  }

  // ============================================
  // Transfer Remittances (3PL → warehouse)
  // ============================================

  /**
   * TPL_MANAGER submits a remittance (sending stock back to main warehouse) with receipt.
   * fromLocationId = user's logisticsLocationId. Notifies Head of Logistics.
   */
  async createRemittance(input: CreateRemittanceInput, actor: SessionUser) {
    if (actor.role !== 'TPL_MANAGER' || !actor.logisticsLocationId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only 3PL Managers with an assigned location can submit remittances',
      });
    }

    const remittance = await withActor(this.db, actor, async (tx) => {
      // Validate toLocation exists and is different from from
      const toLoc = await tx
        .select()
        .from(schema.logisticsLocations)
        .where(eq(schema.logisticsLocations.id, input.toLocationId))
        .limit(1);
      if (!toLoc[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Destination location not found' });
      }
      if (input.toLocationId === actor.logisticsLocationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot remit to your own location' });
      }

      // Validate product exists
      const product = await tx
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, input.productId))
        .limit(1);
      if (!product[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      }

      const [row] = await tx
        .insert(schema.transferRemittances)
        .values({
          fromLocationId: actor.logisticsLocationId!,
          toLocationId: input.toLocationId,
          productId: input.productId,
          quantitySent: input.quantitySent,
          receiptUrl: input.receiptUrl,
          status: 'SENT',
          sentBy: actor.id,
        })
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create remittance' });
      }
      return row;
    });

    this.notifications
      .createForRole('HEAD_OF_LOGISTICS', {
        type: 'remittance:sent',
        title: 'Transfer remittance received',
        body: `3PL location submitted a remittance: ${input.quantitySent} unit(s) of product. Please mark as received when stock arrives.`,
        data: { remittanceId: remittance.id, productId: input.productId, quantitySent: input.quantitySent },
      })
      .catch(() => {});

    return remittance;
  }

  /**
   * List remittances. TPL_MANAGER sees own location's; HEAD_OF_LOGISTICS sees all (optional locationId filter).
   */
  async listRemittances(input: ListRemittancesInput, actor: SessionUser) {
    const conditions = [];

    if (actor.role === 'TPL_MANAGER' && actor.logisticsLocationId) {
      conditions.push(eq(schema.transferRemittances.fromLocationId, actor.logisticsLocationId));
    } else if (actor.role === 'HEAD_OF_LOGISTICS' || (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN')) {
      if (input.locationId) {
        conditions.push(eq(schema.transferRemittances.toLocationId, input.locationId));
      }
    } else {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only 3PL Manager or Head of Logistics can list remittances' });
    }

    if (input.status) {
      conditions.push(eq(schema.transferRemittances.status, input.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const fromLoc = alias(schema.logisticsLocations, 'from_loc');
    const toLoc = alias(schema.logisticsLocations, 'to_loc');

    const [records, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.transferRemittances.id,
          fromLocationId: schema.transferRemittances.fromLocationId,
          toLocationId: schema.transferRemittances.toLocationId,
          productId: schema.transferRemittances.productId,
          productName: schema.products.name,
          quantitySent: schema.transferRemittances.quantitySent,
          quantityReceived: schema.transferRemittances.quantityReceived,
          receiptUrl: schema.transferRemittances.receiptUrl,
          status: schema.transferRemittances.status,
          sentAt: schema.transferRemittances.sentAt,
          sentBy: schema.transferRemittances.sentBy,
          receivedAt: schema.transferRemittances.receivedAt,
          receivedBy: schema.transferRemittances.receivedBy,
          shrinkageReason: schema.transferRemittances.shrinkageReason,
          fromLocationName: fromLoc.name,
          toLocationName: toLoc.name,
        })
        .from(schema.transferRemittances)
        .innerJoin(schema.products, eq(schema.transferRemittances.productId, schema.products.id))
        .innerJoin(fromLoc, eq(schema.transferRemittances.fromLocationId, fromLoc.id))
        .innerJoin(toLoc, eq(schema.transferRemittances.toLocationId, toLoc.id))
        .where(whereClause)
        .orderBy(desc(schema.transferRemittances.sentAt))
        .limit(input.limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.transferRemittances).where(whereClause),
    ]);

    return {
      records,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  /**
   * HEAD_OF_LOGISTICS marks a remittance as received. Updates inventory at toLocationId and notifies 3PL.
   */
  async markRemittanceReceived(input: MarkRemittanceReceivedInput, actor: SessionUser) {
    if (actor.role !== 'HEAD_OF_LOGISTICS' && (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Head of Logistics can mark remittances as received' });
    }

    const { remittance, status, hasShrinkage } = await withActor(this.db, actor, async (tx) => {
      const [found] = await tx
        .select()
        .from(schema.transferRemittances)
        .where(eq(schema.transferRemittances.id, input.remittanceId))
        .limit(1);

      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Remittance not found' });
      }
      if (found.status !== 'SENT') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Remittance is already ${found.status}` });
      }

      const hasShort = input.quantityReceived < found.quantitySent;
      const newStatus: 'DISPUTED' | 'RECEIVED' = hasShort ? 'DISPUTED' : 'RECEIVED';

      await tx
        .update(schema.transferRemittances)
        .set({
          quantityReceived: input.quantityReceived,
          status: newStatus,
          receivedAt: new Date(),
          receivedBy: actor.id,
          shrinkageReason: input.shrinkageReason ?? null,
        })
        .where(eq(schema.transferRemittances.id, input.remittanceId));

      if (input.quantityReceived > 0) {
        const destLevel = await tx
          .select()
          .from(schema.inventoryLevels)
          .where(
            and(
              eq(schema.inventoryLevels.productId, found.productId),
              eq(schema.inventoryLevels.locationId, found.toLocationId),
            ),
          )
          .limit(1);

        if (destLevel[0]) {
          await tx
            .update(schema.inventoryLevels)
            .set({
              stockCount: sql`${schema.inventoryLevels.stockCount} + ${input.quantityReceived}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryLevels.id, destLevel[0].id));
        } else {
          await tx.insert(schema.inventoryLevels).values({
            productId: found.productId,
            locationId: found.toLocationId,
            stockCount: input.quantityReceived,
            reservedCount: 0,
            status: 'AVAILABLE',
          });
        }

        await tx.insert(schema.stockMovements).values({
          productId: found.productId,
          movementType: 'TRANSFER_IN',
          quantity: input.quantityReceived,
          fromLocationId: found.fromLocationId,
          toLocationId: found.toLocationId,
          referenceId: found.id,
          actorId: actor.id,
        });
      }

      return { remittance: found, status: newStatus, hasShrinkage: hasShort };
    });

    this.notifications
      .createForLocation(remittance.fromLocationId, {
        type: 'remittance:received',
        title: 'Remittance marked received',
        body: hasShrinkage
          ? `Your remittance was received with a shortfall. Status: DISPUTED.`
          : `Your remittance has been marked as received by Head of Logistics.`,
        data: { remittanceId: remittance.id, status },
      })
      .catch(() => {});

    return { success: true, status };
  }

  // ============================================
  // Delivery remittances (3PL batches delivered orders + receipts; Finance marks received)
  // ============================================

  /**
   * TPL_MANAGER creates a delivery remittance: select delivered orders + payment receipt URLs.
   * Orders must be DELIVERED, belong to actor's location, and not already in another remittance.
   */
  async createDeliveryRemittance(input: CreateDeliveryRemittanceInput, actor: SessionUser) {
    if (actor.role !== 'TPL_MANAGER' || !actor.logisticsLocationId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only 3PL Managers with an assigned location can submit delivery remittances',
      });
    }

    const remittance = await withActor(this.db, actor, async (tx) => {
      const orderRows = await tx
        .select({ id: schema.orders.id, status: schema.orders.status, logisticsLocationId: schema.orders.logisticsLocationId })
        .from(schema.orders)
        .where(inArray(schema.orders.id, input.orderIds));

      const foundIds = new Set(orderRows.map((r) => r.id));
      for (const id of input.orderIds) {
        if (!foundIds.has(id)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Order ${id} not found` });
        }
      }

      for (const row of orderRows) {
        if (row.status !== 'DELIVERED') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Order ${row.id} is not DELIVERED. Only delivered orders can be included.`,
          });
        }
        if (row.logisticsLocationId !== actor.logisticsLocationId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Orders must belong to your 3PL location',
          });
        }
      }

      const alreadyRemitted = await tx
        .select({ orderId: schema.deliveryRemittanceOrders.orderId })
        .from(schema.deliveryRemittanceOrders)
        .where(inArray(schema.deliveryRemittanceOrders.orderId, input.orderIds));
      if (alreadyRemitted.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One or more orders are already part of a delivery remittance',
        });
      }

      const [row] = await tx
        .insert(schema.deliveryRemittances)
        .values({
          logisticsLocationId: actor.logisticsLocationId!,
          sentBy: actor.id,
          receiptUrls: input.receiptUrls,
          status: 'SENT',
        })
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create delivery remittance' });
      }

      await tx.insert(schema.deliveryRemittanceOrders).values(
        input.orderIds.map((orderId) => ({
          deliveryRemittanceId: row.id,
          orderId,
        })),
      );

      return row;
    });

    this.notifications
      .createForRole('FINANCE_OFFICER', {
        type: 'delivery_remittance:sent',
        title: 'Delivery remittance received',
        body: `3PL submitted a delivery remittance with ${input.orderIds.length} order(s). Please review and mark as received.`,
        data: { deliveryRemittanceId: remittance.id },
      })
      .catch(() => {});

    return remittance;
  }

  /**
   * List delivery remittances. TPL_MANAGER sees own location's; Finance and HoL see all.
   */
  async listDeliveryRemittances(input: ListDeliveryRemittancesInput, actor: SessionUser) {
    const canList =
      actor.role === 'TPL_MANAGER' ||
      actor.role === 'HEAD_OF_LOGISTICS' ||
      actor.role === 'FINANCE_OFFICER' ||
      (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN');
    if (!canList) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot list delivery remittances' });
    }

    const conditions = [];
    if (actor.role === 'TPL_MANAGER' && actor.logisticsLocationId) {
      conditions.push(eq(schema.deliveryRemittances.logisticsLocationId, actor.logisticsLocationId));
    } else if (input.logisticsLocationId) {
      conditions.push(eq(schema.deliveryRemittances.logisticsLocationId, input.logisticsLocationId));
    }
    if (input.status) {
      conditions.push(eq(schema.deliveryRemittances.status, input.status));
    }
    if (input.startDate) {
      conditions.push(gte(schema.deliveryRemittances.sentAt, new Date(input.startDate + 'T00:00:00')));
    }
    if (input.endDate) {
      conditions.push(lte(schema.deliveryRemittances.sentAt, new Date(input.endDate + 'T23:59:59')));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [records, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.deliveryRemittances)
        .where(whereClause)
        .orderBy(desc(schema.deliveryRemittances.sentAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.deliveryRemittances)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;
    const locationIds = [...new Set(records.map((r) => r.logisticsLocationId))];
    const locations =
      locationIds.length > 0
        ? await this.db
            .select({ id: schema.logisticsLocations.id, name: schema.logisticsLocations.name })
            .from(schema.logisticsLocations)
            .where(inArray(schema.logisticsLocations.id, locationIds))
        : [];
    const locationMap = new Map(locations.map((l) => [l.id, l.name]));

    const orderCounts = await Promise.all(
      records.map((r) =>
        this.db
          .select({ count: count() })
          .from(schema.deliveryRemittanceOrders)
          .where(eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, r.id)),
      ),
    );

    // Summary aggregation: total remitted amounts by status (across all matching remittances, not just current page)
    // Build conditions without status filter for summary (we want all statuses)
    const summaryConditions = conditions.filter((c) => c !== (input.status ? eq(schema.deliveryRemittances.status, input.status) : undefined));
    const summaryWhere = summaryConditions.length > 0 ? and(...summaryConditions) : undefined;

    const summaryRows = await this.db
      .select({
        totalRemitted: sql<string>`COALESCE(SUM(${schema.orders.totalAmount}), 0)::text`,
        pendingAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'SENT' THEN ${schema.orders.totalAmount} ELSE 0 END), 0)::text`,
        receivedAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' THEN ${schema.orders.totalAmount} ELSE 0 END), 0)::text`,
        disputedAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'DISPUTED' THEN ${schema.orders.totalAmount} ELSE 0 END), 0)::text`,
        totalCount: sql<string>`COUNT(DISTINCT ${schema.deliveryRemittances.id})::text`,
        pendingCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'SENT' THEN ${schema.deliveryRemittances.id} END)::text`,
        receivedCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' THEN ${schema.deliveryRemittances.id} END)::text`,
        disputedCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'DISPUTED' THEN ${schema.deliveryRemittances.id} END)::text`,
      })
      .from(schema.deliveryRemittances)
      .innerJoin(schema.deliveryRemittanceOrders, eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, schema.deliveryRemittances.id))
      .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
      .where(summaryWhere);

    const summary = summaryRows[0] ?? {
      totalRemitted: '0', pendingAmount: '0', receivedAmount: '0', disputedAmount: '0',
      totalCount: '0', pendingCount: '0', receivedCount: '0', disputedCount: '0',
    };

    return {
      records: records.map((r, i) => ({
        ...r,
        locationName: locationMap.get(r.logisticsLocationId) ?? null,
        orderCount: orderCounts[i]?.[0]?.count ?? 0,
      })),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
      summary,
    };
  }

  /**
   * Finance marks a delivery remittance as received (payment confirmed). Notifies 3PL location.
   */
  async markDeliveryRemittanceReceived(input: MarkDeliveryRemittanceReceivedInput, actor: SessionUser) {
    if (actor.role !== 'FINANCE_OFFICER' && (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Finance or Super Admin can mark delivery remittances as received',
      });
    }

    const remittance = await withActor(this.db, actor, async (tx) => {
      const [found] = await tx
        .select()
        .from(schema.deliveryRemittances)
        .where(eq(schema.deliveryRemittances.id, input.deliveryRemittanceId))
        .limit(1);

      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Delivery remittance not found' });
      }
      if (found.status !== 'SENT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Delivery remittance is already ${found.status}`,
        });
      }

      await tx
        .update(schema.deliveryRemittances)
        .set({
          status: 'RECEIVED',
          receivedAt: new Date(),
          receivedBy: actor.id,
        })
        .where(eq(schema.deliveryRemittances.id, input.deliveryRemittanceId));

      return found;
    });

    this.notifications
      .createForLocation(remittance.logisticsLocationId, {
        type: 'delivery_remittance:received',
        title: 'Delivery remittance marked received',
        body: 'Your delivery remittance has been marked as received by Finance. Payment confirmed.',
        data: { deliveryRemittanceId: remittance.id },
      })
      .catch(() => {});

    return { success: true };
  }

  /**
   * Finance disputes a delivery remittance (payment not received / receipt invalid). Notifies 3PL location.
   */
  async disputeDeliveryRemittance(input: DisputeDeliveryRemittanceInput, actor: SessionUser) {
    if (actor.role !== 'FINANCE_OFFICER' && (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Finance or Super Admin can dispute delivery remittances',
      });
    }

    const remittance = await withActor(this.db, actor, async (tx) => {
      const [found] = await tx
        .select()
        .from(schema.deliveryRemittances)
        .where(eq(schema.deliveryRemittances.id, input.deliveryRemittanceId))
        .limit(1);

      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Delivery remittance not found' });
      }
      if (found.status !== 'SENT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Delivery remittance is already ${found.status}`,
        });
      }

      await tx
        .update(schema.deliveryRemittances)
        .set({
          status: 'DISPUTED',
          disputeReason: input.disputeReason,
          receivedAt: new Date(),
          receivedBy: actor.id,
        })
        .where(eq(schema.deliveryRemittances.id, input.deliveryRemittanceId));

      return found;
    });

    this.notifications
      .createForLocation(remittance.logisticsLocationId, {
        type: 'delivery_remittance:disputed',
        title: 'Delivery remittance disputed',
        body: `Your delivery remittance has been disputed by Finance. Reason: ${input.disputeReason}`,
        data: { deliveryRemittanceId: remittance.id },
      })
      .catch(() => {});

    return { success: true };
  }

  /**
   * List delivered orders for the 3PL's location that are not yet in any delivery remittance (for "select orders" UI).
   */
  async listDeliveryRemittanceEligibleOrders(actor: SessionUser) {
    if (actor.role !== 'TPL_MANAGER' || !actor.logisticsLocationId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only 3PL Managers with an assigned location can list eligible orders',
      });
    }

    const remittedOrderIds = await this.db
      .select({ orderId: schema.deliveryRemittanceOrders.orderId })
      .from(schema.deliveryRemittanceOrders);

    const remittedSet = new Set(remittedOrderIds.map((r) => r.orderId));

    const orders = await this.db
      .select({
        id: schema.orders.id,
        customerName: schema.orders.customerName,
        totalAmount: schema.orders.totalAmount,
        deliveredAt: schema.orders.deliveredAt,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.logisticsLocationId, actor.logisticsLocationId),
          eq(schema.orders.status, 'DELIVERED'),
        ),
      )
      .orderBy(desc(schema.orders.deliveredAt));

    return orders.filter((o) => !remittedSet.has(o.id)).map((o) => ({
      id: o.id,
      customerName: o.customerName,
      totalAmount: o.totalAmount != null ? String(o.totalAmount) : null,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
    }));
  }

  /**
   * Get a single delivery remittance by ID with its orders (for detail view).
   */
  async getDeliveryRemittance(deliveryRemittanceId: string, actor: SessionUser) {
    const canView =
      actor.role === 'TPL_MANAGER' ||
      actor.role === 'HEAD_OF_LOGISTICS' ||
      actor.role === 'FINANCE_OFFICER' ||
      (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN');
    if (!canView) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot view delivery remittances' });
    }

    const [remittance] = await this.db
      .select()
      .from(schema.deliveryRemittances)
      .where(eq(schema.deliveryRemittances.id, deliveryRemittanceId))
      .limit(1);

    if (!remittance) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Delivery remittance not found' });
    }
    if (actor.role === 'TPL_MANAGER' && actor.logisticsLocationId !== remittance.logisticsLocationId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view your location\'s remittances' });
    }

    const junctionRows = await this.db
      .select({ orderId: schema.deliveryRemittanceOrders.orderId })
      .from(schema.deliveryRemittanceOrders)
      .where(eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, deliveryRemittanceId));

    const orderIds = junctionRows.map((r) => r.orderId);
    const locationName =
      orderIds.length > 0
        ? (
            await this.db
              .select({ name: schema.logisticsLocations.name })
              .from(schema.logisticsLocations)
              .where(eq(schema.logisticsLocations.id, remittance.logisticsLocationId))
              .limit(1)
          )[0]?.name ?? null
        : null;

    let orders: Array<{ id: string; customerName: string; totalAmount: string | null; deliveredAt: string | null }> = [];
    if (orderIds.length > 0) {
      const orderRows = await this.db
        .select({
          id: schema.orders.id,
          customerName: schema.orders.customerName,
          totalAmount: schema.orders.totalAmount,
          deliveredAt: schema.orders.deliveredAt,
        })
        .from(schema.orders)
        .where(inArray(schema.orders.id, orderIds));
      orders = orderRows.map((o) => ({
        id: o.id,
        customerName: o.customerName,
        totalAmount: o.totalAmount != null ? String(o.totalAmount) : null,
        deliveredAt: o.deliveredAt?.toISOString() ?? null,
      }));
    }

    return {
      ...remittance,
      locationName,
      orders,
    };
  }

  // ============================================
  // Delivery confirmation requests (rider/3PL → HOL approval)
  // ============================================

  async submitDeliveryConfirmation(input: SubmitDeliveryConfirmationInput, actor: SessionUser) {
    if (actor.role !== 'TPL_RIDER' && actor.role !== 'TPL_MANAGER' && actor.role !== 'HEAD_OF_LOGISTICS' && (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only riders or 3PL managers can submit delivery confirmations',
      });
    }

    const request = await withActor(this.db, actor, async (tx) => {
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, input.orderId))
        .limit(1);

      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }
      if (order.status !== 'IN_TRANSIT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Order must be IN_TRANSIT to submit delivery confirmation. Current status: ${order.status}`,
        });
      }

      const [existing] = await tx
        .select()
        .from(schema.deliveryConfirmationRequests)
        .where(
          and(
            eq(schema.deliveryConfirmationRequests.orderId, input.orderId),
            eq(schema.deliveryConfirmationRequests.status, 'PENDING'),
          ),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A delivery confirmation request is already pending for this order',
        });
      }

      const payload = input.metadata ?? {};
      const rows = await tx
        .insert(schema.deliveryConfirmationRequests)
        .values({
          orderId: input.orderId,
          requestedBy: actor.id,
          status: 'PENDING',
          payload: { newStatus: input.newStatus, ...payload },
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create delivery confirmation request' });
      }
      return row;
    });

    this.notifications
      .createForRole('HEAD_OF_LOGISTICS', {
        type: 'logistics:delivery_confirmation_pending',
        title: 'Delivery confirmation pending',
        body: `Order ${input.orderId.slice(0, 8)}… — ${input.newStatus} confirmation awaiting your approval.`,
        data: { requestId: request.id, orderId: input.orderId },
      })
      .catch(() => {});

    return request;
  }

  async listDeliveryConfirmationRequests(input: ListDeliveryConfirmationRequestsInput, actor: SessionUser) {
    if (actor.role !== 'HEAD_OF_LOGISTICS' && (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Head of Logistics can list delivery confirmation requests',
      });
    }

    const conditions = [];
    if (input.status) {
      conditions.push(eq(schema.deliveryConfirmationRequests.status, input.status));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [requests, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.deliveryConfirmationRequests)
        .where(whereClause)
        .orderBy(desc(schema.deliveryConfirmationRequests.requestedAt))
        .limit(input.limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.deliveryConfirmationRequests).where(whereClause),
    ]);

    const orderIds = [...new Set(requests.map((r) => r.orderId))];
    const orders =
      orderIds.length === 0
        ? []
        : await this.db
            .select({
              id: schema.orders.id,
              status: schema.orders.status,
              customerName: schema.orders.customerName,
              deliveryAddress: schema.orders.deliveryAddress,
              riderId: schema.orders.riderId,
              logisticsLocationId: schema.orders.logisticsLocationId,
            })
            .from(schema.orders)
            .where(inArray(schema.orders.id, orderIds));

    const requesterIds = [...new Set(requests.map((r) => r.requestedBy))];
    const requesters =
      requesterIds.length === 0
        ? []
        : await this.db
            .select({ id: schema.users.id, name: schema.users.name })
            .from(schema.users)
            .where(inArray(schema.users.id, requesterIds));

    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const requesterMap = new Map(requesters.map((u) => [u.id, u.name]));

    return {
      requests: requests.map((r) => ({
        ...r,
        order: orderMap.get(r.orderId),
        requesterName: requesterMap.get(r.requestedBy) ?? null,
      })),
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  async approveDeliveryConfirmation(input: ApproveDeliveryConfirmationInput, actor: SessionUser) {
    if (actor.role !== 'HEAD_OF_LOGISTICS' && (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Head of Logistics can approve delivery confirmations',
      });
    }

    const { request, newStatus, metadata } = await withActor(this.db, actor, async (tx) => {
      const [found] = await tx
        .select()
        .from(schema.deliveryConfirmationRequests)
        .where(eq(schema.deliveryConfirmationRequests.id, input.requestId))
        .limit(1);

      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Delivery confirmation request not found' });
      }
      if (found.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request has already been processed' });
      }
      if (found.requestedBy === actor.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot approve your own request' });
      }

      const p = found.payload as { newStatus: 'DELIVERED' | 'PARTIALLY_DELIVERED'; [k: string]: unknown };
      const ns = p?.newStatus ?? 'DELIVERED';
      const { newStatus: _omit, ...payloadRest } = p;
      const md = payloadRest as Parameters<OrdersService['transition']>[0]['metadata'];

      await tx
        .update(schema.deliveryConfirmationRequests)
        .set({
          status: 'APPROVED',
          approvedBy: actor.id,
          approvedAt: new Date(),
        })
        .where(eq(schema.deliveryConfirmationRequests.id, input.requestId));

      return { request: found, newStatus: ns, metadata: md };
    });

    try {
      await this.ordersService.transition(
        { orderId: request.orderId, newStatus, metadata },
        actor,
      );
    } catch (err) {
      await withActor(this.db, actor, async (tx) => {
        await tx
          .update(schema.deliveryConfirmationRequests)
          .set({ status: 'REJECTED', rejectionReason: err instanceof Error ? err.message : 'Transition failed' })
          .where(eq(schema.deliveryConfirmationRequests.id, input.requestId));
      });
      throw err;
    }

    this.notifications
      .create({
        userId: request.requestedBy,
        type: 'logistics:delivery_confirmation_processed',
        title: 'Delivery confirmation approved',
        body: `Your delivery confirmation for order has been approved.`,
        data: { requestId: request.id, orderId: request.orderId, action: 'APPROVED' },
      })
      .catch(() => {});

    return { ...request, status: 'APPROVED' as const, approvedBy: actor.id, approvedAt: new Date() };
  }

  async rejectDeliveryConfirmation(input: RejectDeliveryConfirmationInput, actor: SessionUser) {
    if (actor.role !== 'HEAD_OF_LOGISTICS' && (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Head of Logistics can reject delivery confirmations',
      });
    }

    const request = await withActor(this.db, actor, async (tx) => {
      const [found] = await tx
        .select()
        .from(schema.deliveryConfirmationRequests)
        .where(eq(schema.deliveryConfirmationRequests.id, input.requestId))
        .limit(1);

      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Delivery confirmation request not found' });
      }
      if (found.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request has already been processed' });
      }

      await tx
        .update(schema.deliveryConfirmationRequests)
        .set({
          status: 'REJECTED',
          approvedBy: actor.id,
          approvedAt: new Date(),
          rejectionReason: input.reason ?? null,
        })
        .where(eq(schema.deliveryConfirmationRequests.id, input.requestId));

      return found;
    });

    this.notifications
      .create({
        userId: request.requestedBy,
        type: 'logistics:delivery_confirmation_processed',
        title: 'Delivery confirmation rejected',
        body: input.reason ? `Your delivery confirmation was rejected: ${input.reason}` : 'Your delivery confirmation was rejected.',
        data: { requestId: request.id, orderId: request.orderId, action: 'REJECTED' },
      })
      .catch(() => {});

    return { ...request, status: 'REJECTED' as const, approvedBy: actor.id, approvedAt: new Date(), rejectionReason: input.reason ?? null };
  }
}
