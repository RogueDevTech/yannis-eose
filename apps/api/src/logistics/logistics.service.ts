import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, ilike, count, lt, inArray, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { db as schema } from '@yannis/shared';
import type {
  CreateProviderInput,
  UpdateProviderInput,
  ListProvidersInput,
  CreateLocationInput,
  UpdateLocationInput,
  ListLocationsInput,
} from '@yannis/shared';
import { DRIZZLE, PG_CLIENT } from '../database/database.module';

@Injectable()
export class LogisticsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
  ) {}

  // ============================================
  // Providers
  // ============================================

  async createProvider(input: CreateProviderInput, actorId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;

    const rows = await this.db
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
  }

  async updateProvider(input: UpdateProviderInput, actorId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateFields['name'] = input.name;
    if (input.contactInfo !== undefined) updateFields['contactInfo'] = input.contactInfo;
    if (input.coverageArea !== undefined) updateFields['coverageArea'] = input.coverageArea;
    if (input.rateCard !== undefined) updateFields['rateCard'] = input.rateCard;
    if (input.status !== undefined) updateFields['status'] = input.status;

    const rows = await this.db
      .update(schema.logisticsProviders)
      .set(updateFields)
      .where(eq(schema.logisticsProviders.id, input.providerId))
      .returning();

    if (!rows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
    }
    return rows[0];
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
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;

    // Verify provider exists
    const providerRows = await this.db
      .select()
      .from(schema.logisticsProviders)
      .where(eq(schema.logisticsProviders.id, input.providerId))
      .limit(1);

    if (!providerRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found' });
    }

    const rows = await this.db
      .insert(schema.logisticsLocations)
      .values({
        providerId: input.providerId,
        name: input.name,
        address: input.address,
        coordinates: input.coordinates ?? null,
      })
      .returning();

    const location = rows[0];
    if (!location) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create location' });
    }
    return location;
  }

  async updateLocation(input: UpdateLocationInput, actorId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateFields['name'] = input.name;
    if (input.address !== undefined) updateFields['address'] = input.address;
    if (input.coordinates !== undefined) updateFields['coordinates'] = input.coordinates;
    if (input.status !== undefined) updateFields['status'] = input.status;

    const rows = await this.db
      .update(schema.logisticsLocations)
      .set(updateFields)
      .where(eq(schema.logisticsLocations.id, input.locationId))
      .returning();

    if (!rows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Location not found' });
    }
    return rows[0];
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
}
