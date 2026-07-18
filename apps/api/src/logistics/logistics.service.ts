import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import {
  eq,
  and,
  asc,
  desc,
  ilike,
  count,
  countDistinct,
  lt,
  gte,
  lte,
  inArray,
  isNotNull,
  isNull,
  not,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, canonicalPermissionCode } from '@yannis/shared';
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
  UpdateDeliveryRemittanceInput,
  ListDeliveryRemittancesInput,
  ListDeliveryRemittanceEligibleOrdersInput,
  MarkDeliveryRemittanceReceivedInput,
  SubmitDeliveryConfirmationInput,
  ListDeliveryConfirmationRequestsInput,
  ApproveDeliveryConfirmationInput,
  RejectDeliveryConfirmationInput,
  DisputeDeliveryRemittanceInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor, withActorAndBranch } from '../common/db/with-actor';
import { branchScopeCondition } from '../common/db/branch-scope-condition';
import { OrdersService } from '../orders/orders.service';
import { GeneralLedgerService } from '../finance/general-ledger.service';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => OrdersService)) private readonly ordersService: OrdersService,
    private readonly generalLedger: GeneralLedgerService,
  ) {}

  /**
   * Phase 20 — true if the actor's effective permissions include any of the
   * given codes (after canonicalization). Used to gate cash-remittance actions
   * by permission instead of hardcoded role, so a custom role template with
   * `finance.cashRemittance.create` can create remittances without holding
   * `FINANCE_OFFICER` itself.
   */
  private actorHasAnyPermission(actor: SessionUser, ...codes: string[]): boolean {
    const required = codes.map((c) => canonicalPermissionCode(c));
    const have = new Set((actor.permissions ?? []).map((c) => canonicalPermissionCode(c)));
    return required.some((c) => have.has(c));
  }

  // ============================================
  // Providers
  // ============================================

  async createProvider(input: CreateProviderInput, actorId: string, groupId?: string | null) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      // Block duplicate names within the same company group
      const groupCondition = groupId
        ? or(eq(schema.logisticsProviders.groupId, groupId), isNull(schema.logisticsProviders.groupId))!
        : isNull(schema.logisticsProviders.groupId);
      const [existing] = await tx
        .select({ id: schema.logisticsProviders.id })
        .from(schema.logisticsProviders)
        .where(and(ilike(schema.logisticsProviders.name, input.name), groupCondition))
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A logistics company with this name already exists' });
      }

      const rows = await tx
        .insert(schema.logisticsProviders)
        .values({
          name: input.name,
          contactInfo: input.contactInfo,
          coverageArea: input.coverageArea,
          rateCard: input.rateCard ?? null,
          groupId: groupId ?? null,
        })
        .returning();

      const provider = rows[0];
      if (!provider) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create logistics company' });
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
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Logistics company not found' });
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
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Logistics company not found' });
    }

    // Get location count
    const locationRows = await this.db
      .select({ count: count() })
      .from(schema.logisticsLocations)
      .where(eq(schema.logisticsLocations.providerId, providerId));

    return { ...rows[0], locationCount: locationRows[0]?.count ?? 0 };
  }

  async listProviders(input: ListProvidersInput, groupId?: string | null) {
    const conditions = [];
    if (input.status) {
      conditions.push(eq(schema.logisticsProviders.status, input.status));
    }
    if (input.search) {
      conditions.push(ilike(schema.logisticsProviders.name, `%${input.search}%`));
    }
    if (input.kind) {
      conditions.push(eq(schema.logisticsProviders.kind, input.kind));
    }
    if (groupId) {
      conditions.push(or(eq(schema.logisticsProviders.groupId, groupId), isNull(schema.logisticsProviders.groupId))!);
    }
    // Providers are company-wide data — groupId already isolates by company.
    // No branch-level filtering needed here; locations have branch scope,
    // but the provider list itself should show all providers in the company.

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [providers, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.logisticsProviders.id,
          name: schema.logisticsProviders.name,
          contactInfo: schema.logisticsProviders.contactInfo,
          coverageArea: schema.logisticsProviders.coverageArea,
          kind: schema.logisticsProviders.kind,
          status: schema.logisticsProviders.status,
          createdAt: schema.logisticsProviders.createdAt,
          updatedAt: schema.logisticsProviders.updatedAt,
          validFrom: schema.logisticsProviders.validFrom,
          validTo: schema.logisticsProviders.validTo,
          modifiedBy: schema.logisticsProviders.modifiedBy,
        })
        .from(schema.logisticsProviders)
        .where(whereClause)
        .orderBy(desc(schema.logisticsProviders.createdAt))
        .limit(input.limit)
        .offset(offset),
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
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Logistics company not found' });
      }

      const rows = await tx
        .insert(schema.logisticsLocations)
        .values({
          providerId: input.providerId,
          name: input.name,
          address: input.address,
          coordinates: input.coordinates ?? null,
          whatsappGroupLink: input.whatsappGroupLink ?? null,
          lowStockThreshold: input.lowStockThreshold ?? null,
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
      if (input.lowStockThreshold !== undefined) updateFields['lowStockThreshold'] = input.lowStockThreshold;

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

  async deleteProvider(providerId: string, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      // Guard: cannot delete a provider whose locations still hold stock.
      const stockRows = await tx
        .select({
          total: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount}), 0)`,
        })
        .from(schema.inventoryLevels)
        .innerJoin(
          schema.logisticsLocations,
          eq(schema.inventoryLevels.locationId, schema.logisticsLocations.id),
        )
        .where(eq(schema.logisticsLocations.providerId, providerId));
      const totalStock = Number(stockRows[0]?.total ?? 0);
      if (totalStock > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot delete this company — its locations still hold ${totalStock} unit(s) of stock. Move or write off all stock first.`,
        });
      }
      // Delete all locations under this provider first (FK constraint).
      await tx
        .delete(schema.logisticsLocations)
        .where(eq(schema.logisticsLocations.providerId, providerId));
      // Delete the provider.
      const rows = await tx
        .delete(schema.logisticsProviders)
        .where(eq(schema.logisticsProviders.id, providerId))
        .returning();
      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Logistics company not found' });
      }
      return rows[0];
    });
  }

  async deleteLocation(locationId: string, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      // Guard: cannot delete a location that still holds stock.
      const stockRows = await tx
        .select({
          total: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount}), 0)`,
        })
        .from(schema.inventoryLevels)
        .where(eq(schema.inventoryLevels.locationId, locationId));
      const totalStock = Number(stockRows[0]?.total ?? 0);
      if (totalStock > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot delete this location — it still holds ${totalStock} unit(s) of stock. Move or write off all stock first.`,
        });
      }
      const rows = await tx
        .delete(schema.logisticsLocations)
        .where(eq(schema.logisticsLocations.id, locationId))
        .returning();
      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Location not found' });
      }
      return rows[0];
    });
  }

  async listLocations(input: ListLocationsInput, groupId?: string | null, effectiveBranchIds?: string[] | null) {
    const conditions = [];
    if (input.providerId) {
      conditions.push(eq(schema.logisticsLocations.providerId, input.providerId));
    }
    if (input.status) {
      conditions.push(eq(schema.logisticsLocations.status, input.status));
    }
    if (input.providerKind) {
      conditions.push(eq(schema.logisticsProviders.kind, input.providerKind));
    }
    if (groupId) {
      conditions.push(or(eq(schema.logisticsProviders.groupId, groupId), isNull(schema.logisticsProviders.groupId))!);
    }
    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
      conditions.push(
        or(inArray(schema.logisticsLocations.branchId, effectiveBranchIds), isNull(schema.logisticsLocations.branchId))!,
      );
    } else if (effectiveBranchIds && effectiveBranchIds.length === 0) {
      conditions.push(sql`false`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    // Subquery: total available stock per location (stock - reserved).
    const stockSub = this.db
      .select({
        locationId: schema.inventoryLevels.locationId,
        totalStock: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}), 0)`.as('total_stock'),
      })
      .from(schema.inventoryLevels)
      .groupBy(schema.inventoryLevels.locationId)
      .as('stock_sub');

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          location: schema.logisticsLocations,
          providerName: schema.logisticsProviders.name,
          providerKind: schema.logisticsProviders.kind,
          totalStock: sql<number>`COALESCE(${stockSub.totalStock}, 0)`.mapWith(Number),
        })
        .from(schema.logisticsLocations)
        .leftJoin(
          schema.logisticsProviders,
          eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
        )
        .leftJoin(stockSub, eq(stockSub.locationId, schema.logisticsLocations.id))
        .where(whereClause)
        .orderBy(desc(schema.logisticsLocations.createdAt))
        .limit(input.limit)
        .offset(offset),
      (input.providerKind || groupId)
        ? this.db
            .select({ count: count() })
            .from(schema.logisticsLocations)
            .leftJoin(
              schema.logisticsProviders,
              eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
            )
            .where(whereClause)
        : this.db.select({ count: count() }).from(schema.logisticsLocations).where(whereClause),
    ]);

    const locations = rows.map((row) => ({
      ...row.location,
      providerName: row.providerName ?? null,
      providerKind: row.providerKind ?? 'THIRD_PARTY',
      totalStock: row.totalStock ?? 0,
    }));

    return {
      locations,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  /**
   * Lightweight provider options for dropdowns / label resolution.
   * Returns minimal fields; filtering is intentionally narrow to keep cache key space small.
   */
  async listProviderOptions(input: {
    status?: 'ACTIVE' | 'INACTIVE';
    kind?: 'THIRD_PARTY' | 'WAREHOUSE';
    groupId?: string | null;
  }): Promise<Array<{ id: string; name: string; kind: string; status: string }>> {
    const conditions = [];
    if (input.status) conditions.push(eq(schema.logisticsProviders.status, input.status));
    if (input.kind) conditions.push(eq(schema.logisticsProviders.kind, input.kind));
    if (input.groupId) conditions.push(or(eq(schema.logisticsProviders.groupId, input.groupId), isNull(schema.logisticsProviders.groupId))!);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return this.db
      .select({
        id: schema.logisticsProviders.id,
        name: schema.logisticsProviders.name,
        kind: schema.logisticsProviders.kind,
        status: schema.logisticsProviders.status,
      })
      .from(schema.logisticsProviders)
      .where(whereClause)
      .orderBy(asc(schema.logisticsProviders.name));
  }

  /**
   * Lightweight location options for dropdowns / label resolution.
   * Returns minimal fields including provider metadata.
   */
  async listLocationOptions(input: {
    status?: 'ACTIVE' | 'INACTIVE';
    providerKind?: 'THIRD_PARTY' | 'WAREHOUSE';
    groupId?: string | null;
  }): Promise<
    Array<{
      id: string;
      name: string;
      status: string;
      providerId: string;
      providerName: string | null;
      providerKind: string;
    }>
  > {
    const conditions = [];
    if (input.status) conditions.push(eq(schema.logisticsLocations.status, input.status));
    if (input.providerKind) conditions.push(eq(schema.logisticsProviders.kind, input.providerKind));
    if (input.groupId) conditions.push(or(eq(schema.logisticsProviders.groupId, input.groupId), isNull(schema.logisticsProviders.groupId))!);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        id: schema.logisticsLocations.id,
        name: schema.logisticsLocations.name,
        status: schema.logisticsLocations.status,
        providerId: schema.logisticsLocations.providerId,
        providerName: schema.logisticsProviders.name,
        providerKind: schema.logisticsProviders.kind,
      })
      .from(schema.logisticsLocations)
      .leftJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(whereClause)
      .orderBy(asc(schema.logisticsLocations.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      providerId: r.providerId,
      providerName: r.providerName ?? null,
      providerKind: r.providerKind ?? 'THIRD_PARTY',
    }));
  }

  // ============================================
  // Company-owned warehouses (provider kind WAREHOUSE)
  // ============================================

  /**
   * Singleton internal warehouse provider — locations of kind WAREHOUSE all hang off it.
   * Auto-created the first time a warehouse is added; survives subsequent calls
   * via `ON CONFLICT DO NOTHING`-style lookup-then-insert.
   */
  private async getOrCreateOurWarehouseProvider(actorId: string, groupId?: string | null): Promise<string> {
    const conditions: SQL[] = [eq(schema.logisticsProviders.kind, 'WAREHOUSE')];
    if (groupId) conditions.push(eq(schema.logisticsProviders.groupId, groupId));
    const existing = await this.db
      .select({ id: schema.logisticsProviders.id })
      .from(schema.logisticsProviders)
      .where(and(...conditions))
      .orderBy(desc(schema.logisticsProviders.createdAt))
      .limit(1);
    if (existing[0]) return existing[0].id;

    return withActor(this.db, { id: actorId }, async (tx) => {
      // Race-safe: re-check inside the actor tx in case a concurrent call won.
      const recheck = await tx
        .select({ id: schema.logisticsProviders.id })
        .from(schema.logisticsProviders)
        .where(and(...conditions))
        .limit(1);
      if (recheck[0]) return recheck[0].id;
      const inserted = await tx
        .insert(schema.logisticsProviders)
        .values({
          name: 'Our warehouses',
          contactInfo: null,
          coverageArea: null,
          kind: 'WAREHOUSE',
          status: 'ACTIVE',
          ...(groupId ? { groupId } : {}),
        })
        .returning({ id: schema.logisticsProviders.id });
      const id = inserted[0]?.id;
      if (!id) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to provision internal warehouse provider',
        });
      }
      return id;
    });
  }

  async createWarehouse(
    input: { name: string; address: string; coordinates?: string },
    actorId: string,
    groupId?: string | null,
  ) {
    const providerId = await this.getOrCreateOurWarehouseProvider(actorId, groupId);
    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.logisticsLocations)
        .values({
          providerId,
          name: input.name.trim(),
          address: input.address.trim(),
          coordinates: input.coordinates?.trim() || null,
        })
        .returning();
      const location = rows[0];
      if (!location) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create warehouse',
        });
      }
      return location;
    });
  }

  async updateWarehouse(
    input: { warehouseId: string; name?: string; address?: string; coordinates?: string },
    actorId: string,
  ) {
    // Confirm the target is an internal WAREHOUSE-kind site — this path must never
    // edit a 3PL partner location (those are managed under Logistics → Partners).
    const [existing] = await this.db
      .select({ id: schema.logisticsLocations.id })
      .from(schema.logisticsLocations)
      .innerJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(
        and(
          eq(schema.logisticsLocations.id, input.warehouseId),
          eq(schema.logisticsProviders.kind, 'WAREHOUSE'),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    }

    return withActor(this.db, { id: actorId }, async (tx) => {
      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateFields['name'] = input.name.trim();
      if (input.address !== undefined) updateFields['address'] = input.address.trim();
      if (input.coordinates !== undefined) {
        updateFields['coordinates'] = input.coordinates.trim() || null;
      }

      const rows = await tx
        .update(schema.logisticsLocations)
        .set(updateFields)
        .where(eq(schema.logisticsLocations.id, input.warehouseId))
        .returning();

      const location = rows[0];
      if (!location) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
      }
      return location;
    });
  }

  async listWarehouses(input: {
    status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    search?: string;
    /** Default `all` — partner sites + our warehouses. `our` — internal WAREHOUSE-kind sites only. */
    listScope?: 'all' | 'our';
    sortBy?: 'createdAt' | 'name' | 'available';
    sortOrder?: 'asc' | 'desc';
    page: number;
    limit: number;
    groupId?: string | null;
  }) {
    const conditions: SQL[] = [];
    if (input.listScope === 'our') {
      conditions.push(eq(schema.logisticsProviders.kind, 'WAREHOUSE'));
    }
    if (input.status) {
      conditions.push(eq(schema.logisticsLocations.status, input.status));
    }
    if (input.search) {
      conditions.push(ilike(schema.logisticsLocations.name, `%${input.search}%`));
    }
    if (input.groupId) {
      // Include providers in the active group OR legacy providers with NULL groupId
      // (pre-multi-company warehouses that haven't been backfilled yet).
      conditions.push(
        or(
          eq(schema.logisticsProviders.groupId, input.groupId),
          isNull(schema.logisticsProviders.groupId),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    // Internal warehouses always surface above partner sites, regardless of secondary sort.
    const kindOrder = asc(
      sql`(CASE WHEN ${schema.logisticsProviders.kind} = 'WAREHOUSE' THEN 0 ELSE 1 END)`,
    );

    // Secondary order — explicit sort. `available` uses a correlated subquery against
    // inventory_levels; warehouses count is small enough that the subquery cost is fine.
    const dirAsc = (input.sortOrder ?? 'desc') === 'asc';
    const dirFn = dirAsc ? asc : desc;
    let secondaryOrder: SQL;
    if (input.sortBy === 'name') {
      secondaryOrder = dirFn(schema.logisticsLocations.name);
    } else if (input.sortBy === 'available') {
      const availableSql = sql`(
        SELECT COALESCE(SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}), 0)
        FROM inventory_levels
        WHERE ${schema.inventoryLevels.locationId} = ${schema.logisticsLocations.id}
      )`;
      secondaryOrder = dirFn(availableSql);
    } else {
      // createdAt fallback — preserves prior default behaviour.
      secondaryOrder = dirFn(schema.logisticsLocations.createdAt);
    }

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.logisticsLocations.id,
          name: schema.logisticsLocations.name,
          address: schema.logisticsLocations.address,
          coordinates: schema.logisticsLocations.coordinates,
          dispatchLocked: schema.logisticsLocations.dispatchLocked,
          status: schema.logisticsLocations.status,
          createdAt: schema.logisticsLocations.createdAt,
          providerKind: schema.logisticsProviders.kind,
          providerName: schema.logisticsProviders.name,
        })
        .from(schema.logisticsLocations)
        .innerJoin(
          schema.logisticsProviders,
          eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
        )
        .where(whereClause)
        .orderBy(kindOrder, secondaryOrder)
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.logisticsLocations)
        .innerJoin(
          schema.logisticsProviders,
          eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
        )
        .where(whereClause),
    ]);

    const warehouseIds = rows.map((r) => r.id);
    const stockByLocation = new Map<
      string,
      { totalStock: number; totalReserved: number; skuCount: number }
    >();

    if (warehouseIds.length > 0) {
      const sums = await this.db
        .select({
          locationId: schema.inventoryLevels.locationId,
          totalStock: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount}), 0)`.mapWith(
            Number,
          ),
          totalReserved: sql<number>`COALESCE(SUM(${schema.inventoryLevels.reservedCount}), 0)`.mapWith(
            Number,
          ),
          skuCount: countDistinct(schema.inventoryLevels.productId),
        })
        .from(schema.inventoryLevels)
        .where(inArray(schema.inventoryLevels.locationId, warehouseIds))
        .groupBy(schema.inventoryLevels.locationId);

      for (const s of sums) {
        stockByLocation.set(s.locationId, {
          totalStock: s.totalStock,
          totalReserved: s.totalReserved,
          skuCount: Number(s.skuCount ?? 0),
        });
      }
    }

    return {
      warehouses: rows.map((w) => ({
        ...w,
        stockSummary: stockByLocation.get(w.id) ?? {
          totalStock: 0,
          totalReserved: 0,
          skuCount: 0,
        },
      })),
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  async getWarehousesOverview(input?: { status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'; groupId?: string | null }) {
    const conditions: SQL[] = [eq(schema.logisticsProviders.kind, 'WAREHOUSE')];
    if (input?.status) {
      conditions.push(eq(schema.logisticsLocations.status, input.status));
    }
    if (input?.groupId) {
      conditions.push(
        or(
          eq(schema.logisticsProviders.groupId, input.groupId),
          isNull(schema.logisticsProviders.groupId),
        )!,
      );
    }
    const whereClause = and(...conditions);

    const stockByLocation = this.db
      .select({
        locationId: schema.inventoryLevels.locationId,
        // Must alias raw SQL fields so `stockByLocation.totalStock` can be referenced
        // from the outer query without Drizzle selection-proxy errors.
        totalStock: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount}), 0)`
          .mapWith(Number)
          .as('totalStock'),
        totalReserved: sql<number>`COALESCE(SUM(${schema.inventoryLevels.reservedCount}), 0)`
          .mapWith(Number)
          .as('totalReserved'),
      })
      .from(schema.inventoryLevels)
      .groupBy(schema.inventoryLevels.locationId)
      .as('stock_by_location');

    const [baseRows, skuRows] = await Promise.all([
      this.db
        .select({
          activeWarehousesCount: countDistinct(schema.logisticsLocations.id),
          dispatchLockedCount: sql<number>`COUNT(DISTINCT CASE WHEN ${schema.logisticsLocations.dispatchLocked} THEN ${schema.logisticsLocations.id} END)`.mapWith(
            Number,
          ),
          warehousesWithAvailableStockCount: sql<number>`COUNT(DISTINCT CASE WHEN COALESCE(${stockByLocation.totalStock}, 0) - COALESCE(${stockByLocation.totalReserved}, 0) > 0 THEN ${schema.logisticsLocations.id} END)`.mapWith(
            Number,
          ),
          totalUnits: sql<number>`COALESCE(SUM(COALESCE(${stockByLocation.totalStock}, 0)), 0)`.mapWith(
            Number,
          ),
          totalReserved: sql<number>`COALESCE(SUM(COALESCE(${stockByLocation.totalReserved}, 0)), 0)`.mapWith(
            Number,
          ),
        })
        .from(schema.logisticsLocations)
        .innerJoin(
          schema.logisticsProviders,
          eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
        )
        .leftJoin(stockByLocation, eq(stockByLocation.locationId, schema.logisticsLocations.id))
        .where(whereClause),
      this.db
        .select({ skuCount: countDistinct(schema.inventoryLevels.productId) })
        .from(schema.inventoryLevels)
        .innerJoin(
          schema.logisticsLocations,
          eq(schema.logisticsLocations.id, schema.inventoryLevels.locationId),
        )
        .innerJoin(
          schema.logisticsProviders,
          eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
        )
        .where(whereClause),
    ]);

    const base = baseRows[0];
    const totalUnits = Number(base?.totalUnits ?? 0);
    const totalReserved = Number(base?.totalReserved ?? 0);
    const totalAvailable = Math.max(0, totalUnits - totalReserved);

    return {
      activeWarehousesCount: Number(base?.activeWarehousesCount ?? 0),
      warehousesWithAvailableStockCount: Number(base?.warehousesWithAvailableStockCount ?? 0),
      dispatchLockedCount: Number(base?.dispatchLockedCount ?? 0),
      totalUnits,
      totalReserved,
      totalAvailable,
      skuCount: Number(skuRows[0]?.skuCount ?? 0),
    };
  }

  async getWarehouseById(warehouseId: string) {
    const [row] = await this.db
      .select({
        id: schema.logisticsLocations.id,
        name: schema.logisticsLocations.name,
        address: schema.logisticsLocations.address,
        coordinates: schema.logisticsLocations.coordinates,
        dispatchLocked: schema.logisticsLocations.dispatchLocked,
        status: schema.logisticsLocations.status,
        createdAt: schema.logisticsLocations.createdAt,
        providerKind: schema.logisticsProviders.kind,
        providerName: schema.logisticsProviders.name,
      })
      .from(schema.logisticsLocations)
      .innerJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(
        and(
          eq(schema.logisticsLocations.id, warehouseId),
          eq(schema.logisticsProviders.kind, 'WAREHOUSE'),
        ),
      )
      .limit(1);

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Warehouse not found' });
    }

    const [stock] = await this.db
      .select({
        totalStock: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount}), 0)`.mapWith(
          Number,
        ),
        totalReserved: sql<number>`COALESCE(SUM(${schema.inventoryLevels.reservedCount}), 0)`.mapWith(
          Number,
        ),
        skuCount: countDistinct(schema.inventoryLevels.productId),
      })
      .from(schema.inventoryLevels)
      .where(eq(schema.inventoryLevels.locationId, warehouseId));

    return {
      ...row,
      stockSummary: {
        totalStock: Number(stock?.totalStock ?? 0),
        totalReserved: Number(stock?.totalReserved ?? 0),
        skuCount: Number(stock?.skuCount ?? 0),
      },
    };
  }

  // ============================================
  // Escalation & Monitoring
  // ============================================

  /**
   * Find all completed transfers where quantityReceived < quantitySent
   * and status is DISPUTED — indicates shrinkage/loss during transit.
   */
  async getShrinkageAlerts(effectiveBranchIds?: string[] | null) {
    const fromLocation = alias(schema.logisticsLocations, 'from_loc');
    const toLocation = alias(schema.logisticsLocations, 'to_loc');

    const conditions: SQL[] = [
      eq(schema.stockTransfers.transferStatus, 'DISPUTED'),
      isNotNull(schema.stockTransfers.quantityReceived),
    ];

    // Stock transfers have no branch column; scope via the initiator's branches
    // when effectiveBranchIds is set (non-global user).
    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
      conditions.push(
        inArray(
          schema.stockTransfers.initiatedBy,
          this.db
            .select({ userId: schema.userBranches.userId })
            .from(schema.userBranches)
            .where(inArray(schema.userBranches.branchId, effectiveBranchIds)),
        ),
      );
    }

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
      .where(and(...conditions))
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
  async getStuckOrders(thresholdHours: number, effectiveBranchIds?: string[] | null) {
    const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const conditions: SQL[] = [
      inArray(schema.orders.status, ['DISPATCHED', 'IN_TRANSIT']),
      lt(schema.orders.updatedAt, cutoff),
    ];
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, null, effectiveBranchIds);
    if (bCond) conditions.push(bCond);

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
      .where(and(...conditions))
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
  async getTransferDelays(thresholdHours: number, effectiveBranchIds?: string[] | null) {
    const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const fromLocation = alias(schema.logisticsLocations, 'from_loc');
    const toLocation = alias(schema.logisticsLocations, 'to_loc');

    const conditions: SQL[] = [
      eq(schema.stockTransfers.transferStatus, 'IN_TRANSIT'),
      lt(schema.stockTransfers.createdAt, cutoff),
    ];

    // Stock transfers have no branch column; scope via the initiator's branches
    // when effectiveBranchIds is set (non-global user).
    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
      conditions.push(
        inArray(
          schema.stockTransfers.initiatedBy,
          this.db
            .select({ userId: schema.userBranches.userId })
            .from(schema.userBranches)
            .where(inArray(schema.userBranches.branchId, effectiveBranchIds)),
        ),
      );
    }

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
      .where(and(...conditions))
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
  async getLogisticsHealthDashboard(effectiveBranchIds?: string[] | null) {
    const [shrinkageAlerts, stuckOrders, transferDelays] = await Promise.all([
      this.getShrinkageAlerts(effectiveBranchIds),
      this.getStuckOrders(24, effectiveBranchIds),
      this.getTransferDelays(48, effectiveBranchIds),
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
  async listRiders(
    effectiveBranchIds?: string[] | null,
  ): Promise<Array<{ id: string; name: string; logisticsLocationId: string | null }>> {
    const conditions: SQL[] = [
      eq(schema.users.role, 'TPL_RIDER'),
      eq(schema.users.status, 'ACTIVE'),
    ];

    // Scope riders to branches the caller can see
    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
      conditions.push(
        inArray(
          schema.users.id,
          this.db
            .select({ userId: schema.userBranches.userId })
            .from(schema.userBranches)
            .where(inArray(schema.userBranches.branchId, effectiveBranchIds)),
        ),
      );
    }

    const rows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        logisticsLocationId: schema.users.logisticsLocationId,
      })
      .from(schema.users)
      .where(and(...conditions))
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
    const remitPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const canRemit =
      actor.role === 'SUPER_ADMIN' ||
      remitPerms.includes(canonicalPermissionCode('logistics.remit'));
    if (!canRemit || !actor.logisticsLocationId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only operators with logistics.remit and an assigned location can submit remittances',
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
          receiptUrl: input.receiptUrl ?? '',
          status: 'SENT',
          sentBy: actor.id,
        })
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create remittance' });
      }
      return row;
    });

    this.notifications.enqueueCreateForRole('HEAD_OF_LOGISTICS', {
      type: 'remittance:sent',
      title: 'Transfer remittance received',
      body: `3PL location submitted a remittance: ${input.quantitySent} unit(s) of product. Please mark as received when stock arrives.`,
      data: { remittanceId: remittance.id, productId: input.productId, quantitySent: input.quantitySent },
    });

    return remittance;
  }

  /**
   * List remittances. TPL_MANAGER sees own location's; HEAD_OF_LOGISTICS sees all (optional locationId filter).
   */
  async listRemittances(input: ListRemittancesInput, actor: SessionUser) {
    const conditions = [];

    const listPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const has = (code: string) =>
      actor.role === 'SUPER_ADMIN' || listPerms.includes(canonicalPermissionCode(code));
    const isOrgWideLogistics = has('logistics.scope.global');
    const isLocationOperator = has('logistics.remit') && !!actor.logisticsLocationId;

    if (isOrgWideLogistics) {
      if (input.locationId) {
        conditions.push(eq(schema.transferRemittances.toLocationId, input.locationId));
      }
    } else if (isLocationOperator) {
      conditions.push(eq(schema.transferRemittances.fromLocationId, actor.logisticsLocationId!));
    } else {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only logistics-scope or location operators can list remittances',
      });
    }

    if (input.status) {
      conditions.push(eq(schema.transferRemittances.status, input.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const fromLoc = alias(schema.logisticsLocations, 'from_loc');
    const toLoc = alias(schema.logisticsLocations, 'to_loc');
    const fromProv = alias(schema.logisticsProviders, 'from_prov');
    const toProv = alias(schema.logisticsProviders, 'to_prov');

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
          fromProviderName: fromProv.name,
          toProviderName: toProv.name,
        })
        .from(schema.transferRemittances)
        .innerJoin(schema.products, eq(schema.transferRemittances.productId, schema.products.id))
        .innerJoin(fromLoc, eq(schema.transferRemittances.fromLocationId, fromLoc.id))
        .innerJoin(toLoc, eq(schema.transferRemittances.toLocationId, toLoc.id))
        .leftJoin(fromProv, eq(fromLoc.providerId, fromProv.id))
        .leftJoin(toProv, eq(toLoc.providerId, toProv.id))
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
   *
   * Phase 21: also accepts the `logistics.transferRemittance.markReceived` permission so
   * a custom role template can grant this without inheriting all of HEAD_OF_LOGISTICS.
   */
  async markRemittanceReceived(input: MarkRemittanceReceivedInput, actor: SessionUser) {
    const isOrgWideLogistics =
      actor.role === 'SUPER_ADMIN' ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global');
    const hasPerm = this.actorHasAnyPermission(actor, 'logistics.transferRemittance.markReceived');
    if (!isOrgWideLogistics && !hasPerm) {
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

    this.notifications.enqueueCreateForLocation(remittance.fromLocationId, {
      type: 'remittance:received',
      title: 'Remittance marked received',
      body: hasShrinkage
        ? `Your remittance was received with a shortfall. Status: DISPUTED.`
        : `Your remittance has been marked as received by Head of Logistics.`,
      data: { remittanceId: remittance.id, status },
    });

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
    // Phase 18 (CEO directive 2026-04-29): the 3PL partners aren't on-platform yet,
    // so the accountant records remittances directly. The legacy TPL_MANAGER path
    // stays alive for when a 3PL actually onboards. Finance roles include the
    // primary FINANCE_OFFICER, anyone with the Finance hat, and admin-class.
    // Phase 20: also accept the explicit `finance.cashRemittance.create` permission
    // so a custom role template can grant just this capability.
    const isTplCaller =
      this.actorHasAnyPermission(actor, 'logistics.remit') && !!actor.logisticsLocationId && (actor.role === 'TPL_MANAGER' || actor.role === 'TPL_RIDER');
    const isFinanceCaller =
      actor.role === 'SUPER_ADMIN' ||
      hasFinanceAccess(actor) ||
      this.actorHasAnyPermission(actor, 'finance.cashRemittance.create');
    if (!isTplCaller && !isFinanceCaller) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          'Only Finance (or a 3PL Manager with an assigned location) can record a delivery remittance',
      });
    }

    const result = await withActorAndBranch(this.db, actor, async (tx) => {
      const orderRows = await tx
        .select({
          id: schema.orders.id,
          status: schema.orders.status,
          logisticsLocationId: schema.orders.logisticsLocationId,
          // Logistics works the order in its CS servicing branch (migration 0150).
          branchId: schema.orders.servicingBranchId,
          totalAmount: schema.orders.totalAmount,
          deliveryFee: schema.orders.deliveryFee,
        })
        .from(schema.orders)
        .where(inArray(schema.orders.id, input.orderIds));

      const foundIds = new Set(orderRows.map((r) => r.id));
      for (const id of input.orderIds) {
        if (!foundIds.has(id)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Order ${id} not found` });
        }
      }

      // All orders must currently be DELIVERED. Any other status is a bug
      // upstream — refuse so we don't accidentally settle a CANCELLED or
      // RETURNED order.
      for (const row of orderRows) {
        if (row.status !== 'DELIVERED') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Order ${row.id} is not DELIVERED. Only delivered orders can be included.`,
          });
        }
      }

      // Resolve the remittance's logistics location. TPL caller: must own all
      // orders. Finance caller: derive from the orders themselves and require
      // they all share one location (one cash drop = one source).
      let remittanceLocationId: string;
      if (isTplCaller) {
        for (const row of orderRows) {
          if (row.logisticsLocationId !== actor.logisticsLocationId) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Orders must belong to your 3PL location',
            });
          }
        }
        remittanceLocationId = actor.logisticsLocationId!;
      } else {
        const distinctLocs = new Set(
          orderRows
            .map((r) => r.logisticsLocationId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        );
        if (distinctLocs.size === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Selected orders are missing a logistics location.',
          });
        }
        if (distinctLocs.size > 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'All orders in a remittance must share the same logistics location. Create one remittance per location.',
          });
        }
        remittanceLocationId = [...distinctLocs][0]!;
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

      const markReceivedNow = !!input.markReceivedNow;
      const now = new Date();

      // Parse remittance-level cost deductions
      const commitmentFee = parseFloat(input.commitmentFee ?? '0') || 0;
      const posFee = parseFloat(input.posFee ?? '0') || 0;
      const failedDeliveryCost = parseFloat(input.failedDeliveryCost ?? '0') || 0;

      const [row] = await tx
        .insert(schema.deliveryRemittances)
        .values({
          logisticsLocationId: remittanceLocationId,
          sentBy: actor.id,
          receiptUrls: input.receiptUrls,
          status: markReceivedNow ? 'RECEIVED' : 'SENT',
          notes: input.notes ?? null,
          ...(commitmentFee > 0 ? { commitmentFee: sql`${commitmentFee.toFixed(2)}::numeric` } : {}),
          ...(posFee > 0 ? { posFee: sql`${posFee.toFixed(2)}::numeric` } : {}),
          ...(failedDeliveryCost > 0 ? { failedDeliveryCost: sql`${failedDeliveryCost.toFixed(2)}::numeric` } : {}),
          ...(markReceivedNow ? { receivedAt: now, receivedBy: actor.id } : {}),
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

      // Apply per-order delivery fees when provided.
      if (input.deliveryFees && Object.keys(input.deliveryFees).length > 0) {
        for (const [orderId, feeStr] of Object.entries(input.deliveryFees)) {
          const fee = parseFloat(feeStr);
          if (!Number.isFinite(fee) || fee < 0) continue;
          await tx
            .update(schema.orders)
            .set({ deliveryFee: sql`${fee.toFixed(2)}::numeric`, updatedAt: now })
            .where(eq(schema.orders.id, orderId));
        }
      }

      // Cascade DELIVERED → REMITTED in the same transaction when the
      // accountant is marking received now. This is the canonical "remittance
      // received and reconciled" signal that CLAUDE.md → Order Lifecycle ties
      // to REMITTED. We bulk-update with status guard ('DELIVERED') so we
      // never accidentally bump a CANCELLED order.
      let completedAmountTotal = 0;
      if (markReceivedNow) {
        for (const orderRow of orderRows) {
          const orderTotal = Number(orderRow.totalAmount ?? 0);
          // Use the input fee (just written above) since orderRows were fetched
          // before the delivery fee update. Fall back to the DB value for orders
          // where no override was provided.
          const inputFee = input.deliveryFees?.[orderRow.id];
          const fee = inputFee != null ? parseFloat(inputFee) : Number(orderRow.deliveryFee ?? 0);
          completedAmountTotal += orderTotal - (Number.isFinite(fee) ? fee : 0);
        }
        // Deduct remittance-level costs from the completed total
        completedAmountTotal -= commitmentFee + posFee + failedDeliveryCost;
        const remittedRows = await tx
          .update(schema.orders)
          .set({ status: 'REMITTED', updatedAt: now })
          .where(
            and(
              inArray(schema.orders.id, input.orderIds),
              eq(schema.orders.status, 'DELIVERED'),
            ),
          )
          .returning({ id: schema.orders.id, branchId: schema.orders.branchId });

        // Write timeline events for each order that transitioned to REMITTED
        if (remittedRows.length > 0) {
          await tx.insert(schema.orderTimelineEvents).values(
            remittedRows.map((r) => ({
              orderId: r.id,
              eventType: 'ORDER_REMITTED' as const,
              actorId: actor.id,
              actorName: actor.name ?? null,
              description: `Cash remittance received. Order marked as remitted.`,
              metadata: { deliveryRemittanceId: row.id },
              branchId: r.branchId ?? null,
            })),
          );
        }

        await tx.insert(schema.deliveryRemittanceOutcomes).values({
          deliveryRemittanceId: row.id,
          status: 'APPROVED',
          amount: sql`${completedAmountTotal.toFixed(2)}::numeric`,
          orderCount: input.orderIds.length,
          recordedBy: actor.id,
        });
      }

      return { remittance: row, orderRows, markReceivedNow, completedAmountTotal };
    });

    // Phase 3 — when a remittance is created already RECEIVED, post its cash
    // settlement to the ledger too (same non-fatal, idempotent contract).
    if (result.markReceivedNow) {
      try {
        const posted = await this.generalLedger.postRemittanceSettlement(result.remittance.id, actor);
        if (!posted.posted && posted.reason && posted.reason !== 'already-posted') {
          this.logger.warn(`Remittance GL not posted for ${result.remittance.id}: ${posted.reason}`);
        }
      } catch (err) {
        this.logger.warn(`Remittance GL posting for ${result.remittance.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Note: per-order order:status_changed socket events are intentionally not
    // emitted here. The Finance page revalidates on its own action submit and
    // Order detail re-fetches on the next open. Adding socket fan-out is a
    // future optimization if real-time CS dashboards need to drop completed
    // orders without a refresh.

    // Notify Finance when a TPL caller drops a remittance for review. Finance-
    // led inserts don't need a self-notification.
    if (isTplCaller) {
      this.notifications.enqueueCreateForRole('FINANCE_OFFICER', {
        type: 'delivery_remittance:sent',
        title: 'Delivery remittance received',
        body: `3PL submitted a delivery remittance with ${input.orderIds.length} order(s). Please review and mark as received.`,
        data: { deliveryRemittanceId: result.remittance.id },
      });
    }

    return result.remittance;
  }

  /**
   * Update a delivery remittance batch's editable fields (costs, notes, receipts,
   * per-order delivery fees). Only allowed while the batch is still SENT (pending).
   */
  async updateDeliveryRemittance(input: UpdateDeliveryRemittanceInput, actor: SessionUser) {
    const isTplCaller =
      this.actorHasAnyPermission(actor, 'logistics.remit') && !!actor.logisticsLocationId && (actor.role === 'TPL_MANAGER' || actor.role === 'TPL_RIDER');
    const isFinanceCaller =
      actor.role === 'SUPER_ADMIN' ||
      hasFinanceAccess(actor) ||
      this.actorHasAnyPermission(actor, 'finance.cashRemittance.create');
    if (!isTplCaller && !isFinanceCaller) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Finance (or a 3PL Manager with an assigned location) can edit a delivery remittance',
      });
    }

    return withActorAndBranch(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.deliveryRemittances)
        .where(eq(schema.deliveryRemittances.id, input.id));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Delivery remittance not found' });
      }

      const now = new Date();

      // Build the update set for batch-level fields
      const updateSet: Record<string, unknown> = { updatedAt: now };

      if (input.receiptUrls !== undefined) {
        updateSet.receiptUrls = input.receiptUrls;
      }
      if (input.notes !== undefined) {
        updateSet.notes = input.notes;
      }
      if (input.commitmentFee !== undefined) {
        const fee = parseFloat(input.commitmentFee) || 0;
        updateSet.commitmentFee = sql`${fee.toFixed(2)}::numeric`;
      }
      if (input.posFee !== undefined) {
        const fee = parseFloat(input.posFee) || 0;
        updateSet.posFee = sql`${fee.toFixed(2)}::numeric`;
      }
      if (input.failedDeliveryCost !== undefined) {
        const cost = parseFloat(input.failedDeliveryCost) || 0;
        updateSet.failedDeliveryCost = sql`${cost.toFixed(2)}::numeric`;
      }

      const [updated] = await tx
        .update(schema.deliveryRemittances)
        .set(updateSet)
        .where(eq(schema.deliveryRemittances.id, input.id))
        .returning();

      // Update per-order delivery fees when provided.
      if (input.deliveryFees && Object.keys(input.deliveryFees).length > 0) {
        // Verify all order IDs belong to this remittance
        const junctionRows = await tx
          .select({ orderId: schema.deliveryRemittanceOrders.orderId })
          .from(schema.deliveryRemittanceOrders)
          .where(eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, input.id));
        const validOrderIds = new Set(junctionRows.map((r) => r.orderId));

        for (const [orderId, feeStr] of Object.entries(input.deliveryFees)) {
          if (!validOrderIds.has(orderId)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Order ${orderId} is not part of this remittance`,
            });
          }
          const fee = parseFloat(feeStr);
          if (!Number.isFinite(fee) || fee < 0) continue;
          await tx
            .update(schema.orders)
            .set({ deliveryFee: sql`${fee.toFixed(2)}::numeric`, updatedAt: now })
            .where(eq(schema.orders.id, orderId));
        }
      }

      return updated;
    });
  }

  /**
   * List delivery remittances. TPL_MANAGER sees own location's; Finance and HoL see all.
   */
  async listDeliveryRemittances(input: ListDeliveryRemittancesInput, actor: SessionUser, groupId?: string | null, effectiveBranchIds?: string[] | null) {
    const isTplCaller =
      this.actorHasAnyPermission(actor, 'logistics.remit') && !!actor.logisticsLocationId && (actor.role === 'TPL_MANAGER' || actor.role === 'TPL_RIDER');
    const canListGlobal =
      actor.role === 'SUPER_ADMIN' ||
      hasFinanceAccess(actor) ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global') ||
      this.actorHasAnyPermission(actor, 'finance.cashRemittance.create') ||
      this.actorHasAnyPermission(actor, 'finance.read');
    if (!isTplCaller && !canListGlobal) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot list delivery remittances' });
    }

    const conditions = [];
    if (isTplCaller && !canListGlobal) {
      conditions.push(eq(schema.deliveryRemittances.logisticsLocationId, actor.logisticsLocationId!));
    } else if (input.logisticsLocationId) {
      conditions.push(eq(schema.deliveryRemittances.logisticsLocationId, input.logisticsLocationId));
    }
    // Phase 18: Sent-by filter (the accountant who recorded a remittance).
    if (input.sentBy) {
      conditions.push(eq(schema.deliveryRemittances.sentBy, input.sentBy));
    }
    // Phase 18: status filter now covers all three values, not just SENT.
    if (input.status) {
      conditions.push(eq(schema.deliveryRemittances.status, input.status));
    }
    if (input.startDate) {
      conditions.push(gte(schema.deliveryRemittances.sentAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.deliveryRemittances.sentAt, nigeriaDayEnd(input.endDate)));
    }
    // Company-group isolation: only remittances from locations in this group's providers
    if (groupId) {
      conditions.push(
        sql`${schema.deliveryRemittances.logisticsLocationId} IN (
          SELECT ll.id FROM logistics_locations ll
          JOIN logistics_providers lp ON lp.id = ll.provider_id
          WHERE (lp.group_id = ${groupId} OR lp.group_id IS NULL)
        )`,
      );
    }

    // Text search — reaches into linked orders and location name via EXISTS subquery
    if (input.search) {
      const term = `%${input.search}%`;
      conditions.push(
        sql`(
          EXISTS (
            SELECT 1 FROM delivery_remittance_orders dro
            JOIN orders o ON o.id = dro.order_id
            WHERE dro.delivery_remittance_id = ${schema.deliveryRemittances.id}
              AND (o.customer_name ILIKE ${term} OR CAST(o.order_number AS text) ILIKE ${term})
          )
          OR EXISTS (
            SELECT 1 FROM logistics_locations ll
            WHERE ll.id = ${schema.deliveryRemittances.logisticsLocationId}
              AND ll.name ILIKE ${term}
          )
        )`,
      );
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
            .select({
              id: schema.logisticsLocations.id,
              name: schema.logisticsLocations.name,
              providerName: schema.logisticsProviders.name,
            })
            .from(schema.logisticsLocations)
            .leftJoin(
              schema.logisticsProviders,
              eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
            )
            .where(inArray(schema.logisticsLocations.id, locationIds))
        : [];
    const locationMap = new Map(locations.map((l) => [l.id, l.name]));
    const locationProviderMap = new Map(locations.map((l) => [l.id, l.providerName ?? null]));

    // Count every order linked to the batch — single grouped query replaces
    // the previous N+1 (one query per remittance). After Finance marks received,
    // rows move DELIVERED → REMITTED — they must still count.
    const remittanceIds = records.map((r) => r.id);
    const orderSummaryRows = remittanceIds.length > 0
      ? await this.db
          .select({
            deliveryRemittanceId: schema.deliveryRemittanceOrders.deliveryRemittanceId,
            count: count(),
            amount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
            deliveryFeeTotal: sql<string>`COALESCE(SUM(COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
          })
          .from(schema.deliveryRemittanceOrders)
          .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
          .where(inArray(schema.deliveryRemittanceOrders.deliveryRemittanceId, remittanceIds))
          .groupBy(schema.deliveryRemittanceOrders.deliveryRemittanceId)
      : [];
    const orderSummaryMap = new Map(
      orderSummaryRows.map((r) => [r.deliveryRemittanceId, { count: r.count, amount: r.amount, deliveryFeeTotal: r.deliveryFeeTotal }]),
    );
    const orderSummaries = records.map((r) => {
      const s = orderSummaryMap.get(r.id);
      return [{ count: s?.count ?? 0, amount: s?.amount ?? '0', deliveryFeeTotal: s?.deliveryFeeTotal ?? '0' }];
    });

    // Count duplicate-flagged orders per batch for the batch list UI
    const dupCountRows = remittanceIds.length > 0
      ? await this.db
          .select({
            deliveryRemittanceId: schema.deliveryRemittanceOrders.deliveryRemittanceId,
            dupCount: count(),
          })
          .from(schema.deliveryRemittanceOrders)
          .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
          .where(
            and(
              inArray(schema.deliveryRemittanceOrders.deliveryRemittanceId, remittanceIds),
              isNotNull(schema.orders.isDuplicate),
            ),
          )
          .groupBy(schema.deliveryRemittanceOrders.deliveryRemittanceId)
      : [];
    const dupCountMap = new Map(dupCountRows.map((r) => [r.deliveryRemittanceId, r.dupCount]));

    const sentByIds = [...new Set(records.map((r) => r.sentBy))];
    const senders =
      sentByIds.length > 0
        ? await this.db
            .select({ id: schema.users.id, name: schema.users.name })
            .from(schema.users)
            .where(inArray(schema.users.id, sentByIds))
        : [];
    const sentByNameMap = new Map(senders.map((u) => [u.id, u.name]));

    const outcomes =
      remittanceIds.length > 0
        ? await this.db
            .select({
              deliveryRemittanceId: schema.deliveryRemittanceOutcomes.deliveryRemittanceId,
              status: schema.deliveryRemittanceOutcomes.status,
              amount: schema.deliveryRemittanceOutcomes.amount,
              orderCount: schema.deliveryRemittanceOutcomes.orderCount,
              reason: schema.deliveryRemittanceOutcomes.reason,
              recordedAt: schema.deliveryRemittanceOutcomes.recordedAt,
            })
            .from(schema.deliveryRemittanceOutcomes)
            .where(inArray(schema.deliveryRemittanceOutcomes.deliveryRemittanceId, remittanceIds))
            .orderBy(desc(schema.deliveryRemittanceOutcomes.recordedAt))
        : [];
    const outcomesByRemittance = new Map<string, typeof outcomes>();
    for (const outcome of outcomes) {
      const bucket = outcomesByRemittance.get(outcome.deliveryRemittanceId) ?? [];
      bucket.push(outcome);
      outcomesByRemittance.set(outcome.deliveryRemittanceId, bucket);
    }

    // Summary aggregation: total remitted amounts by status (across all matching remittances, not just current page).
    // Keep location/date/role scoping but intentionally ignore status filter so all buckets are visible.
    const summaryConditions: SQL[] = [];
    // Company-group isolation on summary — must match the list filter
    if (groupId) {
      summaryConditions.push(
        sql`${schema.deliveryRemittances.logisticsLocationId} IN (
          SELECT ll.id FROM logistics_locations ll
          JOIN logistics_providers lp ON lp.id = ll.provider_id
          WHERE (lp.group_id = ${groupId} OR lp.group_id IS NULL)
        )`,
      );
    }
    if (isTplCaller && !canListGlobal) {
      summaryConditions.push(eq(schema.deliveryRemittances.logisticsLocationId, actor.logisticsLocationId!));
    } else if (input.logisticsLocationId) {
      summaryConditions.push(eq(schema.deliveryRemittances.logisticsLocationId, input.logisticsLocationId));
    }
    // Date filter added separately per query — baseSummaryQuery filters by
    // orders.deliveredAt (matches Delivered/Awaiting), outcomeSummaryQuery
    // filters by deliveryRemittances.sentAt (no orders join available).
    if (input.sentBy) {
      summaryConditions.push(eq(schema.deliveryRemittances.sentBy, input.sentBy));
    }
    const summaryWhere = summaryConditions.length > 0 ? and(...summaryConditions) : undefined;

    // Sum order value on remittance batches. Do NOT require orders.status = DELIVERED — after
    // Finance marks received, orders move to REMITTED and must still count toward batch totals.
    const baseSummaryQuery = this.db
      .select({
        totalRemitted: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
        pendingAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'SENT' THEN (${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)) ELSE 0 END), 0)::text`,
        totalCount: sql<string>`COUNT(DISTINCT ${schema.deliveryRemittances.id})::text`,
        // Order counts (not batch counts) so the stat strip is consistent with Delivered/Awaiting
        batchedOrderCount: sql<string>`COUNT(DISTINCT ${schema.deliveryRemittanceOrders.orderId})::text`,
        receivedOrderCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' THEN ${schema.deliveryRemittanceOrders.orderId} END)::text`,
        pendingCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'SENT' THEN ${schema.deliveryRemittanceOrders.orderId} END)::text`,
        disputedOrderCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'DISPUTED' THEN ${schema.deliveryRemittanceOrders.orderId} END)::text`,
        pendingGrossAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'SENT' THEN ${schema.orders.totalAmount} ELSE 0 END), 0)::text`,
        disputedGrossAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'DISPUTED' THEN ${schema.orders.totalAmount} ELSE 0 END), 0)::text`,
        // Deduction breakdown — RECEIVED batches only (confirmed remittances)
        grossOrderValue: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' THEN ${schema.orders.totalAmount} ELSE 0 END), 0)::text`,
        grossOrderCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' THEN ${schema.deliveryRemittanceOrders.orderId} END)::text`,
        totalDeliveryFees: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' THEN COALESCE(${schema.orders.deliveryFee}, 0) ELSE 0 END), 0)::text`,
        deliveryFeeCount: sql<string>`COUNT(CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' AND COALESCE(${schema.orders.deliveryFee}, 0) > 0 THEN 1 END)::text`,
        totalCommitmentFees: sql<string>`COALESCE(SUM(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' AND COALESCE(${schema.deliveryRemittances.commitmentFee}, 0) > 0 THEN ${schema.deliveryRemittances.commitmentFee} ELSE 0 END), 0)::text`,
        commitmentFeeCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' AND COALESCE(${schema.deliveryRemittances.commitmentFee}, 0) > 0 THEN ${schema.deliveryRemittances.id} END)::text`,
        totalPosFees: sql<string>`COALESCE(SUM(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' AND COALESCE(${schema.deliveryRemittances.posFee}, 0) > 0 THEN ${schema.deliveryRemittances.posFee} ELSE 0 END), 0)::text`,
        posFeeCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' AND COALESCE(${schema.deliveryRemittances.posFee}, 0) > 0 THEN ${schema.deliveryRemittances.id} END)::text`,
        totalFailedDeliveryCosts: sql<string>`COALESCE(SUM(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' AND COALESCE(${schema.deliveryRemittances.failedDeliveryCost}, 0) > 0 THEN ${schema.deliveryRemittances.failedDeliveryCost} ELSE 0 END), 0)::text`,
        failedDeliveryCount: sql<string>`COUNT(DISTINCT CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' AND COALESCE(${schema.deliveryRemittances.failedDeliveryCost}, 0) > 0 THEN ${schema.deliveryRemittances.id} END)::text`,
      })
      .from(schema.deliveryRemittances)
      .innerJoin(
        schema.deliveryRemittanceOrders,
        eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, schema.deliveryRemittances.id),
      )
      .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId));

    // Received/Disputed: count orders (not batches) by joining through
    // deliveryRemittanceOrders so the stat strip shows order counts consistently.
    // Scoped by date, location, group, and sentBy — must mirror summaryConditions
    // so the counts reconcile with the amounts.
    // Outcome count/amount conditions — filter by sentAt to match batch stats.
    const outcomeCountConditions: SQL[] = [];
    if (input.startDate) outcomeCountConditions.push(sql`dr.sent_at >= ${nigeriaDayStart(input.startDate).toISOString()}::timestamptz`);
    if (input.endDate) outcomeCountConditions.push(sql`dr.sent_at <= ${nigeriaDayEnd(input.endDate).toISOString()}::timestamptz`);
    if (groupId) {
      outcomeCountConditions.push(sql`dr.logistics_location_id IN (
        SELECT ll.id FROM logistics_locations ll
        JOIN logistics_providers lp ON lp.id = ll.provider_id
        WHERE (lp.group_id = ${groupId} OR lp.group_id IS NULL)
      )`);
    }
    if (isTplCaller && !canListGlobal) {
      outcomeCountConditions.push(sql`dr.logistics_location_id = ${actor.logisticsLocationId!}`);
    } else if (input.logisticsLocationId) {
      outcomeCountConditions.push(sql`dr.logistics_location_id = ${input.logisticsLocationId}`);
    }
    if (input.sentBy) {
      outcomeCountConditions.push(sql`dr.sent_by = ${input.sentBy}`);
    }
    const outcomeCountWhere = outcomeCountConditions.length > 0 ? sql` AND ${sql.join(outcomeCountConditions, sql` AND `)}` : sql``;

    const outcomeSummaryQuery = this.db
      .select({
        receivedAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittanceOutcomes.status} = 'APPROVED' THEN ${schema.deliveryRemittanceOutcomes.amount} ELSE 0 END), 0)::text`,
        disputedAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittanceOutcomes.status} = 'DISPUTED' THEN ${schema.deliveryRemittanceOutcomes.amount} ELSE 0 END), 0)::text`,
        receivedCount: sql<string>`(SELECT COUNT(DISTINCT dro_inner.order_id) FROM delivery_remittance_orders dro_inner JOIN delivery_remittances dr ON dr.id = dro_inner.delivery_remittance_id JOIN orders o_date ON o_date.id = dro_inner.order_id WHERE dro_inner.delivery_remittance_id IN (SELECT dro_o.delivery_remittance_id FROM delivery_remittance_outcomes dro_o WHERE dro_o.status = 'APPROVED')${outcomeCountWhere})::text`,
        disputedCount: sql<string>`(SELECT COUNT(DISTINCT dro_inner.order_id) FROM delivery_remittance_orders dro_inner JOIN delivery_remittances dr ON dr.id = dro_inner.delivery_remittance_id JOIN orders o_date ON o_date.id = dro_inner.order_id WHERE dro_inner.delivery_remittance_id IN (SELECT dro_o.delivery_remittance_id FROM delivery_remittance_outcomes dro_o WHERE dro_o.status = 'DISPUTED')${outcomeCountWhere})::text`,
      })
      .from(schema.deliveryRemittanceOutcomes)
      .innerJoin(
        schema.deliveryRemittances,
        eq(schema.deliveryRemittanceOutcomes.deliveryRemittanceId, schema.deliveryRemittances.id),
      );

    const awaitingConditions: SQL[] = [
      eq(schema.orders.status, 'DELIVERED'),
      isNull(schema.orders.deletedAt),
      notExists(
        this.db
          .select({ one: sql`1` })
          .from(schema.deliveryRemittanceOrders)
          .where(eq(schema.deliveryRemittanceOrders.orderId, schema.orders.id)),
      ),
    ];
    // Company-group isolation on awaiting orders — scope via logistics location's provider group.
    // Include orders with NULL logisticsLocationId (not yet assigned to a 3PL).
    if (groupId) {
      awaitingConditions.push(
        sql`(${schema.orders.logisticsLocationId} IS NULL OR ${schema.orders.logisticsLocationId} IN (
          SELECT ll.id FROM logistics_locations ll
          JOIN logistics_providers lp ON lp.id = ll.provider_id
          WHERE (lp.group_id = ${groupId} OR lp.group_id IS NULL)
        ))`,
      );
    }
    if (isTplCaller && !canListGlobal) {
      awaitingConditions.push(eq(schema.orders.logisticsLocationId, actor.logisticsLocationId!));
    } else if (input.logisticsLocationId) {
      awaitingConditions.push(eq(schema.orders.logisticsLocationId, input.logisticsLocationId));
    }
    // Awaiting stat is date-independent: an old unremitted order is just as actionable.
    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
      awaitingConditions.push(inArray(schema.orders.servicingBranchId, effectiveBranchIds));
    }

    const awaitingSummaryQuery = this.db
      .select({
        awaitingAmount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
        awaitingCount: sql<string>`COUNT(*)::text`,
        awaitingGrossAmount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount}), 0)::text`,
        awaitingDeliveryFees: sql<string>`COALESCE(SUM(COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
        awaitingDeliveryFeeCount: sql<string>`COUNT(CASE WHEN COALESCE(${schema.orders.deliveryFee}, 0) > 0 THEN 1 END)::text`,
      })
      .from(schema.orders)
      .where(and(...awaitingConditions));

    // Count all delivered orders in the period (both awaiting and on remittance).
    // Uses the SAME scoping as awaitingConditions (minus the status + notExists filters)
    // so the stat strip reconciles: delivered = awaiting + remitted.
    // Include orders with NULL logisticsLocationId — they're still delivered/remitted
    // and must count toward the total.
    const deliveredConditions: SQL[] = [
      inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
      isNull(schema.orders.deletedAt),
    ];
    if (groupId) {
      // Include orders with NULL logisticsLocationId (not yet assigned to a 3PL)
      deliveredConditions.push(
        sql`(${schema.orders.logisticsLocationId} IS NULL OR ${schema.orders.logisticsLocationId} IN (
          SELECT ll.id FROM logistics_locations ll
          JOIN logistics_providers lp ON lp.id = ll.provider_id
          WHERE (lp.group_id = ${groupId} OR lp.group_id IS NULL)
        ))`,
      );
    }
    if (isTplCaller && !canListGlobal) {
      deliveredConditions.push(eq(schema.orders.logisticsLocationId, actor.logisticsLocationId!));
    } else if (input.logisticsLocationId) {
      deliveredConditions.push(eq(schema.orders.logisticsLocationId, input.logisticsLocationId));
    }
    // Date filter by createdAt — matches dashboard/marketing/sales funnels.
    if (input.startDate) deliveredConditions.push(gte(schema.orders.createdAt, nigeriaDayStart(input.startDate)));
    if (input.endDate) deliveredConditions.push(lte(schema.orders.createdAt, nigeriaDayEnd(input.endDate)));
    if (effectiveBranchIds && effectiveBranchIds.length > 0) deliveredConditions.push(inArray(schema.orders.servicingBranchId, effectiveBranchIds));
    const deliveredCountQuery = this.db
      .select({
        deliveredCount: sql<string>`COUNT(*)::text`,
        deliveredAmount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount}), 0)::text`,
        deliveredNetAmount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
      })
      .from(schema.orders)
      .where(and(...deliveredConditions));

    // Batch stats filter by sentAt — matches the Remitted tab's date filter.
    const batchDateConditions: SQL[] = [];
    if (input.startDate) batchDateConditions.push(gte(schema.deliveryRemittances.sentAt, nigeriaDayStart(input.startDate)));
    if (input.endDate) batchDateConditions.push(lte(schema.deliveryRemittances.sentAt, nigeriaDayEnd(input.endDate)));
    const baseSummaryWhere = summaryWhere
      ? (batchDateConditions.length > 0 ? and(summaryWhere, ...batchDateConditions) : summaryWhere)
      : (batchDateConditions.length > 0 ? and(...batchDateConditions) : undefined);

    const [baseSummaryRows, outcomeSummaryRows, awaitingSummaryRows, deliveredRows] = await Promise.all([
      baseSummaryWhere ? baseSummaryQuery.where(baseSummaryWhere) : baseSummaryQuery,
      summaryWhere ? outcomeSummaryQuery.where(summaryWhere) : outcomeSummaryQuery,
      awaitingSummaryQuery,
      deliveredCountQuery,
    ]);

    const baseSummary = baseSummaryRows[0];
    const outcomeSummary = outcomeSummaryRows[0];
    const awaitingSummary = awaitingSummaryRows[0];
    const deliveredSummary = deliveredRows[0];
    const summary = {
      totalRemitted: baseSummary?.totalRemitted ?? '0',
      pendingAmount: baseSummary?.pendingAmount ?? '0',
      receivedAmount: outcomeSummary?.receivedAmount ?? '0',
      disputedAmount: outcomeSummary?.disputedAmount ?? '0',
      totalCount: baseSummary?.totalCount ?? '0',
      batchedOrderCount: baseSummary?.batchedOrderCount ?? '0',
      receivedOrderCount: baseSummary?.receivedOrderCount ?? '0',
      pendingCount: baseSummary?.pendingCount ?? '0',
      disputedOrderCount: baseSummary?.disputedOrderCount ?? '0',
      pendingGrossAmount: baseSummary?.pendingGrossAmount ?? '0',
      disputedGrossAmount: baseSummary?.disputedGrossAmount ?? '0',
      // Outcome-based counts (legacy — may be 0 if no outcome records)
      receivedCount: outcomeSummary?.receivedCount ?? '0',
      disputedCount: outcomeSummary?.disputedCount ?? '0',
      awaitingAmount: awaitingSummary?.awaitingAmount ?? '0',
      awaitingCount: awaitingSummary?.awaitingCount ?? '0',
      awaitingGrossAmount: awaitingSummary?.awaitingGrossAmount ?? '0',
      awaitingDeliveryFees: awaitingSummary?.awaitingDeliveryFees ?? '0',
      awaitingDeliveryFeeCount: awaitingSummary?.awaitingDeliveryFeeCount ?? '0',
      deliveredCount: deliveredSummary?.deliveredCount ?? '0',
      deliveredAmount: deliveredSummary?.deliveredAmount ?? '0',
      deliveredNetAmount: deliveredSummary?.deliveredNetAmount ?? '0',
      // Deduction breakdown for remitted orders
      grossOrderValue: baseSummary?.grossOrderValue ?? '0',
      grossOrderCount: baseSummary?.grossOrderCount ?? '0',
      totalDeliveryFees: baseSummary?.totalDeliveryFees ?? '0',
      deliveryFeeCount: baseSummary?.deliveryFeeCount ?? '0',
      totalCommitmentFees: baseSummary?.totalCommitmentFees ?? '0',
      commitmentFeeCount: baseSummary?.commitmentFeeCount ?? '0',
      totalPosFees: baseSummary?.totalPosFees ?? '0',
      posFeeCount: baseSummary?.posFeeCount ?? '0',
      totalFailedDeliveryCosts: baseSummary?.totalFailedDeliveryCosts ?? '0',
      failedDeliveryCount: baseSummary?.failedDeliveryCount ?? '0',
    };

    const fallbackSummary = {
      totalRemitted: '0', pendingAmount: '0', receivedAmount: '0', disputedAmount: '0',
      totalCount: '0', batchedOrderCount: '0', receivedOrderCount: '0', pendingCount: '0', disputedOrderCount: '0', pendingGrossAmount: '0', disputedGrossAmount: '0', receivedCount: '0', disputedCount: '0',
      awaitingAmount: '0', awaitingCount: '0', awaitingGrossAmount: '0', awaitingDeliveryFees: '0', awaitingDeliveryFeeCount: '0',
      deliveredCount: '0', deliveredAmount: '0', deliveredNetAmount: '0',
      grossOrderValue: '0', grossOrderCount: '0', totalDeliveryFees: '0', deliveryFeeCount: '0',
      totalCommitmentFees: '0', commitmentFeeCount: '0',
      totalPosFees: '0', posFeeCount: '0',
      totalFailedDeliveryCosts: '0', failedDeliveryCount: '0',
    };

    return {
      records: records
        .flatMap((r, i) => {
          const orderCount = orderSummaries[i]?.[0]?.count ?? 0;
          const orderAmount = orderSummaries[i]?.[0]?.amount ?? '0';
          const orderDeliveryFeeTotal = orderSummaries[i]?.[0]?.deliveryFeeTotal ?? '0';
          const base = {
            ...r,
            locationName: locationMap.get(r.logisticsLocationId) ?? null,
            locationProviderName: locationProviderMap.get(r.logisticsLocationId) ?? null,
            sentByName: sentByNameMap.get(r.sentBy) ?? null,
            orderCount,
            duplicateOrderCount: dupCountMap.get(r.id) ?? 0,
            outcomeAmount: orderAmount,
            deliveryFeeTotal: orderDeliveryFeeTotal,
            outcomeOrderCount: orderCount,
            outcomeReason: r.disputeReason,
          };
          const recordOutcomes = outcomesByRemittance.get(r.id) ?? [];
          if (recordOutcomes.length === 0) {
            return [
              {
                ...base,
                outcomeStatus: r.status === 'RECEIVED' ? 'APPROVED' : r.status,
              },
            ];
          }
          return recordOutcomes.map((outcome) => ({
            ...base,
            outcomeStatus: outcome.status,
            outcomeAmount: String(outcome.amount ?? '0'),
            outcomeOrderCount: Number(outcome.orderCount ?? 0),
            outcomeReason: outcome.reason,
          }));
        })
        .filter((row) => {
          if (!input.status) return true;
          if (input.status === 'RECEIVED') return row.outcomeStatus === 'APPROVED';
          if (input.status === 'DISPUTED') return row.outcomeStatus === 'DISPUTED';
          return row.outcomeStatus === 'SENT';
        }),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
      summary: summary ?? fallbackSummary,
    };
  }

  /**
   * Flat list of individual orders across remittance batches (unbatched view).
   * Same filters as `listDeliveryRemittances` but returns one row per order instead of per batch.
   */
  async listDeliveryRemittanceOrders(
    input: ListDeliveryRemittancesInput,
    actor: SessionUser,
    groupId?: string | null,
    effectiveBranchIds?: string[] | null,
  ) {
    const isTplCaller =
      this.actorHasAnyPermission(actor, 'logistics.remit') && !!actor.logisticsLocationId && (actor.role === 'TPL_MANAGER' || actor.role === 'TPL_RIDER');
    const canListGlobal =
      actor.role === 'SUPER_ADMIN' ||
      hasFinanceAccess(actor) ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global') ||
      this.actorHasAnyPermission(actor, 'finance.cashRemittance.create') ||
      this.actorHasAnyPermission(actor, 'finance.read');
    if (!isTplCaller && !canListGlobal) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot list delivery remittances' });
    }

    const conditions: SQL[] = [];
    if (isTplCaller && !canListGlobal) {
      conditions.push(eq(schema.deliveryRemittances.logisticsLocationId, actor.logisticsLocationId!));
    } else if (input.logisticsLocationId) {
      conditions.push(eq(schema.deliveryRemittances.logisticsLocationId, input.logisticsLocationId));
    }
    if (input.sentBy) conditions.push(eq(schema.deliveryRemittances.sentBy, input.sentBy));
    if (input.status) conditions.push(eq(schema.deliveryRemittances.status, input.status));
    if (input.startDate) conditions.push(gte(schema.deliveryRemittances.sentAt, nigeriaDayStart(input.startDate)));
    if (input.endDate) conditions.push(lte(schema.deliveryRemittances.sentAt, nigeriaDayEnd(input.endDate)));
    if (groupId) {
      conditions.push(
        sql`${schema.deliveryRemittances.logisticsLocationId} IN (
          SELECT ll.id FROM logistics_locations ll
          JOIN logistics_providers lp ON lp.id = ll.provider_id
          WHERE (lp.group_id = ${groupId} OR lp.group_id IS NULL)
        )`,
      );
    }
    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
      conditions.push(inArray(schema.orders.servicingBranchId, effectiveBranchIds));
    } else if (effectiveBranchIds && effectiveBranchIds.length === 0) {
      conditions.push(sql`false`);
    }

    // Text search — customer name, order number, or location name
    if (input.search) {
      const term = `%${input.search}%`;
      conditions.push(
        sql`(
          ${schema.orders.customerName} ILIKE ${term}
          OR CAST(${schema.orders.orderNumber} AS text) ILIKE ${term}
        )`,
      );
    }

    if (input.category) {
      switch (input.category) {
        case 'marketing':
          conditions.push(
            sql`(${schema.orders.orderSource} IS NULL OR ${schema.orders.orderSource} = 'edge-form')`,
            eq(schema.orders.isFollowUp, false),
          );
          break;
        case 'cart':
          conditions.push(eq(schema.orders.orderSource, 'online'));
          break;
        case 'follow-up':
          conditions.push(eq(schema.orders.isFollowUp, true));
          break;
        case 'offline':
          conditions.push(eq(schema.orders.orderSource, 'offline'));
          break;
      }
    }

    if (input.deduction) {
      switch (input.deduction) {
        case 'deliveryFee':
          conditions.push(sql`COALESCE(${schema.orders.deliveryFee}, 0) > 0`);
          break;
        case 'commitmentFee':
          conditions.push(sql`COALESCE(${schema.deliveryRemittances.commitmentFee}, 0) > 0`);
          break;
        case 'posFee':
          conditions.push(sql`COALESCE(${schema.deliveryRemittances.posFee}, 0) > 0`);
          break;
        case 'failedDeliveryCost':
          conditions.push(sql`COALESCE(${schema.deliveryRemittances.failedDeliveryCost}, 0) > 0`);
          break;
      }
    }

    const loc = alias(schema.logisticsLocations, 'rem_ord_loc');
    const prov = alias(schema.logisticsProviders, 'rem_ord_prov');
    const csUser = alias(schema.users, 'rem_ord_cs');
    const csBranch = alias(schema.branches, 'rem_ord_branch');
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const baseQuery = this.db
      .select({
        id: schema.orders.id,
        customerName: schema.orders.customerName,
        orderNumber: schema.orders.orderNumber,
        totalAmount: schema.orders.totalAmount,
        deliveryFee: schema.orders.deliveryFee,
        deliveredAt: schema.orders.deliveredAt,
        status: schema.orders.status,
        remittanceId: schema.deliveryRemittances.id,
        remittanceStatus: schema.deliveryRemittances.status,
        sentAt: schema.deliveryRemittances.sentAt,
        locationName: loc.name,
        providerName: prov.name,
        isDuplicate: schema.orders.isDuplicate,
        duplicateOfId: schema.orders.duplicateOfId,
        orderSource: schema.orders.orderSource,
        isFollowUp: schema.orders.isFollowUp,
        csName: csUser.name,
        branchName: csBranch.name,
      })
      .from(schema.deliveryRemittanceOrders)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
      .innerJoin(
        schema.deliveryRemittances,
        eq(schema.deliveryRemittances.id, schema.deliveryRemittanceOrders.deliveryRemittanceId),
      )
      .leftJoin(loc, eq(loc.id, schema.deliveryRemittances.logisticsLocationId))
      .leftJoin(prov, eq(prov.id, loc.providerId))
      .leftJoin(csUser, eq(csUser.id, schema.orders.assignedCsId))
      .leftJoin(csBranch, eq(csBranch.id, schema.orders.servicingBranchId));

    const countBase = this.db
      .select({ count: count() })
      .from(schema.deliveryRemittanceOrders)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
      .innerJoin(
        schema.deliveryRemittances,
        eq(schema.deliveryRemittances.id, schema.deliveryRemittanceOrders.deliveryRemittanceId),
      );

    const sortExprMap: Record<string, SQL> = {
      sentAt: sql`${schema.deliveryRemittances.sentAt}`,
      deliveredAt: sql`${schema.orders.deliveredAt}`,
      totalAmount: sql`COALESCE(${schema.orders.totalAmount}, 0)`,
      deliveryFee: sql`COALESCE(${schema.orders.deliveryFee}, 0)`,
      orderNumber: sql`${schema.orders.orderNumber}`,
    };
    const sortExpr = input.sortBy ? sortExprMap[input.sortBy] ?? sql`${schema.deliveryRemittances.sentAt}` : sql`${schema.deliveryRemittances.sentAt}`;
    // NULLS LAST so NULL delivery fees / amounts don't rank above real values
    const sortDirection = input.sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderClauses = [sql`${sortExpr} ${sql.raw(sortDirection)} NULLS LAST`, desc(schema.orders.deliveredAt)];

    const [rows, totalRows] = await Promise.all([
      whereClause
        ? baseQuery.where(whereClause).orderBy(...orderClauses).limit(input.limit).offset(offset)
        : baseQuery.orderBy(...orderClauses).limit(input.limit).offset(offset),
      whereClause ? countBase.where(whereClause) : countBase,
    ]);

    const total = totalRows[0]?.count ?? 0;

    return {
      orders: rows.map((r) => ({
        id: r.id,
        customerName: r.customerName,
        orderNumber: r.orderNumber,
        totalAmount: r.totalAmount ? String(r.totalAmount) : '0',
        deliveryFee: r.deliveryFee ? String(r.deliveryFee) : null,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        status: r.status,
        remittanceId: r.remittanceId,
        remittanceStatus: r.remittanceStatus,
        sentAt: r.sentAt.toISOString(),
        locationName: r.locationName ?? null,
        providerName: r.providerName ?? null,
        isDuplicate: r.isDuplicate ?? null,
        duplicateOfId: r.duplicateOfId ?? null,
        csName: r.csName ?? null,
        branchName: r.branchName ?? null,
        category: r.isFollowUp ? 'follow-up' as const
          : r.orderSource === 'online' ? 'cart' as const
          : r.orderSource === 'offline' ? 'offline' as const
          : 'marketing' as const,
      })),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Fetch the original order and all its duplicates (same phone + same product)
   * for a side-by-side comparison view. Returns the original first, then duplicates
   * sorted by delivered_at.
   */
  async getDuplicateGroup(orderId: string) {
    // Find the order — either the original or one of its duplicates
    const [order] = await this.db
      .select({
        id: schema.orders.id,
        customerPhoneHash: schema.orders.customerPhoneHash,
        duplicateOfId: schema.orders.duplicateOfId,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    // Resolve the original order ID
    const originalId = order.duplicateOfId ?? order.id;

    // Get the original order's products
    const originalItems = await this.db
      .select({ productId: schema.orderItems.productId })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, originalId));

    const productIds = originalItems.map((i) => i.productId).filter(Boolean) as string[];
    if (productIds.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order has no products' });
    }

    // Get the original order's phone hash
    const [originalOrder] = await this.db
      .select({ customerPhoneHash: schema.orders.customerPhoneHash })
      .from(schema.orders)
      .where(eq(schema.orders.id, originalId))
      .limit(1);

    if (!originalOrder) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Original order not found' });
    }

    const csAlias = alias(schema.users, 'closer');
    const mbAlias = alias(schema.users, 'mb');
    const locAlias = alias(schema.logisticsLocations, 'dup_loc');
    const provAlias = alias(schema.logisticsProviders, 'dup_prov');

    // Fetch all orders in the duplicate group:
    // 1. The original order itself
    // 2. Any order with duplicate_of_id pointing to the original
    // 3. Any order with same phone + overlapping product (catches unflagged duplicates)
    const groupOrders = await this.db
      .select({
        id: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        customerName: schema.orders.customerName,
        customerPhone: schema.orders.customerPhone,
        totalAmount: schema.orders.totalAmount,
        deliveryFee: schema.orders.deliveryFee,
        status: schema.orders.status,
        orderSource: schema.orders.orderSource,
        isFollowUp: schema.orders.isFollowUp,
        createdAt: schema.orders.createdAt,
        confirmedAt: schema.orders.confirmedAt,
        deliveredAt: schema.orders.deliveredAt,
        isDuplicate: schema.orders.isDuplicate,
        duplicateOfId: schema.orders.duplicateOfId,
        closerName: csAlias.name,
        mediaBuyerName: mbAlias.name,
        locationName: locAlias.name,
        providerName: provAlias.name,
      })
      .from(schema.orders)
      .leftJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .leftJoin(csAlias, eq(csAlias.id, schema.orders.assignedCsId))
      .leftJoin(mbAlias, eq(mbAlias.id, schema.orders.mediaBuyerId))
      .leftJoin(locAlias, eq(locAlias.id, schema.orders.logisticsLocationId))
      .leftJoin(provAlias, eq(provAlias.id, locAlias.providerId))
      .where(
        and(
          not(inArray(schema.orders.status, ['CANCELLED', 'DELETED'])),
          isNull(schema.orders.deletedAt),
          or(
            // The original order
            eq(schema.orders.id, originalId),
            // Orders flagged as duplicates of the original
            eq(schema.orders.duplicateOfId, originalId),
            // Unflagged duplicates: same phone + overlapping product
            and(
              eq(schema.orders.customerPhoneHash, originalOrder.customerPhoneHash),
              productIds.length > 0 ? inArray(schema.orderItems.productId, productIds) : sql`FALSE`,
            ),
          ),
        ),
      )
      .orderBy(asc(schema.orders.createdAt));

    // Deduplicate (an order with multiple matching products would appear multiple times)
    const seen = new Set<string>();
    const dedupedOrders = groupOrders.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });

    // Fetch invoices for all orders in the group
    const orderIds = dedupedOrders.map((o) => o.id);
    const invoices = orderIds.length > 0
      ? await this.db
          .select({
            orderId: schema.invoices.orderId,
            id: schema.invoices.id,
            referenceNumber: schema.invoices.referenceNumber,
            totalAmount: schema.invoices.totalAmount,
            status: schema.invoices.status,
            createdAt: schema.invoices.createdAt,
          })
          .from(schema.invoices)
          .where(inArray(schema.invoices.orderId, orderIds))
      : [];
    const invoiceByOrderId = new Map(invoices.map((inv) => [inv.orderId, inv]));

    // Fetch remittance info for all orders
    const remittances = orderIds.length > 0
      ? await this.db
          .select({
            orderId: schema.deliveryRemittanceOrders.orderId,
            remittanceId: schema.deliveryRemittances.id,
            remittanceStatus: schema.deliveryRemittances.status,
            sentAt: schema.deliveryRemittances.sentAt,
            receivedAt: schema.deliveryRemittances.receivedAt,
          })
          .from(schema.deliveryRemittanceOrders)
          .innerJoin(
            schema.deliveryRemittances,
            eq(schema.deliveryRemittances.id, schema.deliveryRemittanceOrders.deliveryRemittanceId),
          )
          .where(inArray(schema.deliveryRemittanceOrders.orderId, orderIds))
      : [];
    const remittanceByOrderId = new Map(remittances.map((r) => [r.orderId, r]));

    // Fetch product names
    const products = productIds.length > 0
      ? await this.db
          .select({ id: schema.products.id, name: schema.products.name })
          .from(schema.products)
          .where(inArray(schema.products.id, productIds))
      : [];

    return {
      originalOrderId: originalId,
      products: products.map((p) => ({ id: p.id, name: p.name })),
      orders: dedupedOrders.map((o) => {
        const inv = invoiceByOrderId.get(o.id);
        const rem = remittanceByOrderId.get(o.id);
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          totalAmount: o.totalAmount ? String(o.totalAmount) : '0',
          deliveryFee: o.deliveryFee ? String(o.deliveryFee) : null,
          status: o.status,
          orderSource: o.orderSource,
          isFollowUp: o.isFollowUp,
          isOriginal: o.id === originalId,
          isDuplicate: o.isDuplicate,
          createdAt: o.createdAt.toISOString(),
          confirmedAt: o.confirmedAt?.toISOString() ?? null,
          deliveredAt: o.deliveredAt?.toISOString() ?? null,
          closerName: o.closerName ?? null,
          mediaBuyerName: o.mediaBuyerName ?? null,
          locationName: o.locationName ?? null,
          providerName: o.providerName ?? null,
          invoice: inv ? {
            id: inv.id,
            referenceNumber: inv.referenceNumber,
            totalAmount: inv.totalAmount ? String(inv.totalAmount) : '0',
            status: inv.status,
            createdAt: inv.createdAt.toISOString(),
          } : null,
          remittance: rem ? {
            id: rem.remittanceId,
            status: rem.remittanceStatus,
            sentAt: rem.sentAt.toISOString(),
            receivedAt: rem.receivedAt?.toISOString() ?? null,
          } : null,
        };
      }),
    };
  }

  /**
   * Finance marks a delivery remittance as received (payment confirmed). Notifies 3PL location.
   */
  async markDeliveryRemittanceReceived(input: MarkDeliveryRemittanceReceivedInput, actor: SessionUser) {
    // Phase 18: Finance / admin / Finance-hat holders can mark received.
    // Phase 20: also accept the explicit `finance.cashRemittance.markReceived`
    // permission so custom role templates can grant just this capability.
    if (
      actor.role !== 'SUPER_ADMIN' &&
      !hasFinanceAccess(actor) &&
      !this.actorHasAnyPermission(actor, 'finance.cashRemittance.markReceived')
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Finance or Super Admin can mark delivery remittances as received',
      });
    }

    const remittance = await withActorAndBranch(this.db, actor, async (tx) => {
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

      const [totals] = await tx
        .select({
          amount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
          orderCount: count(),
        })
        .from(schema.deliveryRemittanceOrders)
        .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
        .where(eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, input.deliveryRemittanceId));

      const now = new Date();

      await tx
        .update(schema.deliveryRemittances)
        .set({
          status: 'RECEIVED',
          receivedAt: now,
          receivedBy: actor.id,
        })
        .where(eq(schema.deliveryRemittances.id, input.deliveryRemittanceId));

      await tx.insert(schema.deliveryRemittanceOutcomes).values({
        deliveryRemittanceId: found.id,
        status: 'APPROVED',
        amount: sql`${totals?.amount ?? '0'}::numeric`,
        orderCount: totals?.orderCount ?? 0,
        recordedBy: actor.id,
      });

      // Cascade DELIVERED → REMITTED on every linked order. Bulk-update with
      // the status guard so we never accidentally bump an order that drifted
      // (e.g. a manual revert before remittance was confirmed).
      const linkedOrderIds = (
        await tx
          .select({ orderId: schema.deliveryRemittanceOrders.orderId })
          .from(schema.deliveryRemittanceOrders)
          .where(eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, input.deliveryRemittanceId))
      ).map((r) => r.orderId);

      if (linkedOrderIds.length > 0) {
        const remittedRows = await tx
          .update(schema.orders)
          .set({ status: 'REMITTED', updatedAt: now })
          .where(
            and(
              inArray(schema.orders.id, linkedOrderIds),
              eq(schema.orders.status, 'DELIVERED'),
            ),
          )
          .returning({ id: schema.orders.id, branchId: schema.orders.branchId });

        // Write timeline events for each order that transitioned to REMITTED
        if (remittedRows.length > 0) {
          await tx.insert(schema.orderTimelineEvents).values(
            remittedRows.map((r) => ({
              orderId: r.id,
              eventType: 'ORDER_REMITTED' as const,
              actorId: actor.id,
              actorName: actor.name ?? null,
              description: `Cash remittance received. Order marked as remitted.`,
              metadata: { deliveryRemittanceId: input.deliveryRemittanceId },
              branchId: r.branchId ?? null,
            })),
          );
        }
      }

      return found;
    });

    // Phase 3 — post the cash settlement to the general ledger (Dr Bank + fees /
    // Cr Debtors per order), nets the AR raised at delivery. Non-fatal + idempotent:
    // a ledger hiccup must never undo a confirmed remittance.
    try {
      const res = await this.generalLedger.postRemittanceSettlement(remittance.id, actor);
      if (!res.posted && res.reason && res.reason !== 'already-posted') {
        this.logger.warn(`Remittance GL not posted for ${remittance.id}: ${res.reason}`);
      }
    } catch (err) {
      this.logger.warn(`Remittance GL posting for ${remittance.id} failed: ${err instanceof Error ? err.message : err}`);
    }

    this.notifications
      .createForLocation(remittance.logisticsLocationId, {
        type: 'delivery_remittance:received',
        title: 'Delivery remittance marked received',
        body: 'Your delivery remittance has been marked as received by Finance. Payment confirmed.',
        data: {
          deliveryRemittanceId: remittance.id,
          splitOutcomes: [{ status: 'APPROVED' }],
        },
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

      const [totals] = await tx
        .select({
          amount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
          orderCount: count(),
        })
        .from(schema.deliveryRemittanceOrders)
        .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
        .where(eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, input.deliveryRemittanceId));

      await tx
        .update(schema.deliveryRemittances)
        .set({
          status: 'DISPUTED',
          disputeReason: input.disputeReason,
          receivedAt: new Date(),
          receivedBy: actor.id,
        })
        .where(eq(schema.deliveryRemittances.id, input.deliveryRemittanceId));

      await tx.insert(schema.deliveryRemittanceOutcomes).values({
        deliveryRemittanceId: found.id,
        status: 'DISPUTED',
        amount: sql`${totals?.amount ?? '0'}::numeric`,
        orderCount: totals?.orderCount ?? 0,
        reason: input.disputeReason,
        recordedBy: actor.id,
      });

      return found;
    });

    this.notifications
      .createForLocation(remittance.logisticsLocationId, {
        type: 'delivery_remittance:disputed',
        title: 'Delivery remittance disputed',
        body: `Your delivery remittance has been disputed by Finance. Reason: ${input.disputeReason}`,
        data: {
          deliveryRemittanceId: remittance.id,
          splitOutcomes: [{ status: 'DISPUTED', reason: input.disputeReason }],
        },
      })
      .catch(() => {});

    return { success: true };
  }

  /**
   * Breakdown of delivered + remitted orders by product.
   * Optional branchId scopes to a single branch.
   * Date filter matches the cash-remittance summary hybrid: orders awaiting
   * remittance are filtered by deliveredAt, remitted orders by sentAt.
   */
  async deliveredOrdersByProduct(
    branchId?: string | null,
    startDate?: string,
    endDate?: string,
    effectiveBranchIds?: string[] | null,
  ) {
    const conditions: SQL[] = [sql`${schema.orders.status} IN ('DELIVERED', 'REMITTED')`];
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    // Match the cash-remittance summary scope: awaiting orders use deliveredAt,
    // remitted orders use the remittance batch sentAt.  Use a scalar subquery
    // to avoid duplicate rows from multiple remittance batches per order.
    if (startDate || endDate) {
      const effectiveDate = sql`COALESCE(
        (SELECT ${schema.deliveryRemittances.sentAt}
         FROM ${schema.deliveryRemittanceOrders}
         JOIN ${schema.deliveryRemittances} ON ${schema.deliveryRemittances.id} = ${schema.deliveryRemittanceOrders.deliveryRemittanceId}
         WHERE ${schema.deliveryRemittanceOrders.orderId} = ${schema.orders.id}
         ORDER BY ${schema.deliveryRemittances.sentAt} DESC
         LIMIT 1),
        ${schema.orders.deliveredAt})`;
      if (startDate) conditions.push(sql`${effectiveDate} >= ${nigeriaDayStart(startDate)}`);
      if (endDate) conditions.push(sql`${effectiveDate} <= ${nigeriaDayEnd(endDate)}`);
    }

    const rows = await this.db
      .select({
        productId: schema.orderItems.productId,
        productName: schema.products.name,
        totalAmount: sql<string>`COALESCE(SUM(${schema.orderItems.unitPrice}), 0)::text`,
        orderCount: sql<number>`COUNT(DISTINCT ${schema.orders.id})::int`,
      })
      .from(schema.orders)
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
      .where(and(...conditions))
      .groupBy(schema.orderItems.productId, schema.products.name)
      .orderBy(sql`SUM(${schema.orderItems.unitPrice}) DESC`)
      .limit(10);

    return rows;
  }

  /**
   * Breakdown of delivered + remitted orders by logistics location.
   * Optional branchId scopes to a single branch.
   * Date filter matches the cash-remittance summary hybrid: orders awaiting
   * remittance are filtered by deliveredAt, remitted orders by sentAt.
   */
  async deliveredOrdersByLocation(
    branchId?: string | null,
    startDate?: string,
    endDate?: string,
    effectiveBranchIds?: string[] | null,
  ) {
    const conditions: SQL[] = [sql`${schema.orders.status} IN ('DELIVERED', 'REMITTED')`];
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    if (startDate || endDate) {
      const effectiveDate = sql`COALESCE(
        (SELECT ${schema.deliveryRemittances.sentAt}
         FROM ${schema.deliveryRemittanceOrders}
         JOIN ${schema.deliveryRemittances} ON ${schema.deliveryRemittances.id} = ${schema.deliveryRemittanceOrders.deliveryRemittanceId}
         WHERE ${schema.deliveryRemittanceOrders.orderId} = ${schema.orders.id}
         ORDER BY ${schema.deliveryRemittances.sentAt} DESC
         LIMIT 1),
        ${schema.orders.deliveredAt})`;
      if (startDate) conditions.push(sql`${effectiveDate} >= ${nigeriaDayStart(startDate)}`);
      if (endDate) conditions.push(sql`${effectiveDate} <= ${nigeriaDayEnd(endDate)}`);
    }

    const rows = await this.db
      .select({
        locationId: schema.orders.logisticsLocationId,
        locationName: schema.logisticsLocations.name,
        totalAmount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
        orderCount: sql<number>`COUNT(*)::int`,
      })
      .from(schema.orders)
      .innerJoin(
        schema.logisticsLocations,
        eq(schema.logisticsLocations.id, schema.orders.logisticsLocationId),
      )
      .where(and(...conditions))
      .groupBy(schema.orders.logisticsLocationId, schema.logisticsLocations.name)
      .orderBy(sql`SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)) DESC`)
      .limit(10);

    return rows;
  }

  /**
   * List delivered orders for the 3PL's location that are not yet in any delivery remittance (for "select orders" UI).
   */
  async listDeliveryRemittanceEligibleOrders(
    input: ListDeliveryRemittanceEligibleOrdersInput,
    actor: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    // Phase 18 — accountant view of "delivered orders not yet on a remittance".
    // TPL_MANAGER keeps their own-location-only behavior for the legacy 3PL
    // path. Finance / admin / Finance-hat get the full multi-location list,
    // optionally narrowed by a logistics location filter (for one-cash-drop-
    // per-location remittances).
    // Phase 20: also accept `finance.cashRemittance.create` so any custom role
    // that can create remittances can preview the eligible orders.
    const isTplCaller =
      this.actorHasAnyPermission(actor, 'logistics.remit') && !!actor.logisticsLocationId && (actor.role === 'TPL_MANAGER' || actor.role === 'TPL_RIDER');
    const canListGlobal =
      actor.role === 'SUPER_ADMIN' ||
      hasFinanceAccess(actor) ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global') ||
      this.actorHasAnyPermission(actor, 'finance.cashRemittance.create') ||
      this.actorHasAnyPermission(actor, 'finance.read');
    if (!isTplCaller && !canListGlobal) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You cannot list delivery remittance eligible orders',
      });
    }

    const conditions = [eq(schema.orders.status, 'DELIVERED')];

    if (isTplCaller && !canListGlobal) {
      conditions.push(eq(schema.orders.logisticsLocationId, actor.logisticsLocationId!));
    } else if (input.logisticsLocationId) {
      conditions.push(eq(schema.orders.logisticsLocationId, input.logisticsLocationId));
    }

    // No date filter — eligible orders are always all-time (every unremitted
    // delivered order is actionable). Date filters only apply to Remitted tab.
    // Company-group isolation via order's servicing branch
    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
      conditions.push(inArray(schema.orders.servicingBranchId, effectiveBranchIds));
    }

    // When specific order IDs are requested, scope to exactly those
    if (input.orderIds && input.orderIds.length > 0) {
      conditions.push(inArray(schema.orders.id, input.orderIds));
    }

    // Anti-join: exclude orders already on any remittance batch.
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${schema.deliveryRemittanceOrders} WHERE ${schema.deliveryRemittanceOrders.orderId} = ${schema.orders.id})`,
    );

    const locAlias = alias(schema.logisticsLocations, 'eligible_loc');
    const provAlias = alias(schema.logisticsProviders, 'eligible_loc_provider');

    if (input.search && input.search.trim()) {
      const trimmed = input.search.trim();
      const term = `%${trimmed}%`;
      // Parse "YNS-00123", "YNS00123", or bare "00123" → exact order_number match.
      // Mirrors orders.service.ts so the placeholder's "order ID" promise is real
      // (the visible YNS-XXXXX ref, not the internal UUID).
      const orderNumMatch = trimmed.match(/^(?:YNS[- ]?)?(\d{1,7})$/i);
      const parsedOrderNum = orderNumMatch?.[1] ? parseInt(orderNumMatch[1], 10) : NaN;
      const orderNumberClause =
        !Number.isNaN(parsedOrderNum) && parsedOrderNum > 0
          ? sql` OR ${schema.orders.orderNumber} = ${parsedOrderNum}`
          : sql``;
      conditions.push(
        sql`(${schema.orders.customerName} ILIKE ${term} OR ${schema.orders.id}::text ILIKE ${term}${orderNumberClause} OR (${schema.invoices.id} IS NOT NULL AND ${schema.invoices.referenceNumber}::text ILIKE ${term}) OR (${schema.invoices.recipientInfo} IS NOT NULL AND ${schema.invoices.recipientInfo}->>'name' ILIKE ${term}) OR ${locAlias.name} ILIKE ${term} OR ${provAlias.name} ILIKE ${term})`,
      );
    }

    const whereClause = and(...conditions);
    const offset = (input.page - 1) * input.limit;

    const [orders, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.orders.id,
          customerName: schema.orders.customerName,
          totalAmount: schema.orders.totalAmount,
          deliveredAt: schema.orders.deliveredAt,
          deliveryFee: schema.orders.deliveryFee,
          logisticsLocationId: schema.orders.logisticsLocationId,
          logisticsLocationName: locAlias.name,
          logisticsLocationProviderName: provAlias.name,
          invoiceId: schema.invoices.id,
          invoiceReferenceNumber: schema.invoices.referenceNumber,
          invoiceRecipientInfo: schema.invoices.recipientInfo,
          invoiceLineItems: schema.invoices.lineItems,
          invoiceTaxRate: schema.invoices.taxRate,
          invoiceTotalAmount: schema.invoices.totalAmount,
          invoiceStatus: schema.invoices.status,
          invoiceDueDate: schema.invoices.dueDate,
          invoiceCreatedAt: schema.invoices.createdAt,
          isDuplicate: schema.orders.isDuplicate,
          duplicateOfId: schema.orders.duplicateOfId,
        })
        .from(schema.orders)
        .leftJoin(locAlias, eq(schema.orders.logisticsLocationId, locAlias.id))
        .leftJoin(provAlias, eq(locAlias.providerId, provAlias.id))
        .leftJoin(schema.invoices, eq(schema.invoices.orderId, schema.orders.id))
        .where(whereClause)
        .orderBy(desc(schema.orders.deliveredAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(distinct ${schema.orders.id})` })
        .from(schema.orders)
        .leftJoin(locAlias, eq(schema.orders.logisticsLocationId, locAlias.id))
        .leftJoin(provAlias, eq(locAlias.providerId, provAlias.id))
        .leftJoin(schema.invoices, eq(schema.invoices.orderId, schema.orders.id))
        .where(whereClause),
    ]);

    return {
      orders: orders.map((o) => ({
        id: o.id,
        customerName: o.customerName,
        totalAmount: o.totalAmount != null ? String(o.totalAmount) : null,
        deliveryFee: o.deliveryFee != null ? String(o.deliveryFee) : null,
        deliveredAt: o.deliveredAt?.toISOString() ?? null,
        logisticsLocationId: o.logisticsLocationId ?? null,
        logisticsLocationName: o.logisticsLocationName ?? null,
        logisticsLocationProviderName: o.logisticsLocationProviderName ?? null,
        isDuplicate: o.isDuplicate ?? null,
        duplicateOfId: o.duplicateOfId ?? null,
        invoice:
          o.invoiceId != null && o.invoiceReferenceNumber != null && o.invoiceCreatedAt
            ? {
                id: o.invoiceId,
                orderId: o.id,
                referenceNumber: o.invoiceReferenceNumber,
                referenceFormatted: this.formatInvoiceReference(o.invoiceReferenceNumber),
                recipientInfo: this.parseInvoiceRecipient(o.invoiceRecipientInfo),
                lineItems: this.parseInvoiceLineItems(o.invoiceLineItems),
                totalAmount:
                  o.invoiceTotalAmount != null ? String(o.invoiceTotalAmount) : '0',
                taxRate: o.invoiceTaxRate != null ? String(o.invoiceTaxRate) : null,
                status: o.invoiceStatus ?? 'DRAFT',
                dueDate: o.invoiceDueDate?.toISOString() ?? null,
                createdAt: o.invoiceCreatedAt.toISOString(),
              }
            : null,
      })),
      total: totalRows[0]?.count ?? 0,
    };
  }

  /** Matches `FinanceService.formatReference` — invoice display string. */
  private formatInvoiceReference(refNumber: number): string {
    const year = new Date().getFullYear();
    return `INV-${year}-${String(refNumber).padStart(4, '0')}`;
  }

  private parseInvoiceRecipient(raw: unknown): {
    name: string;
    address?: string;
    email?: string;
    phone?: string;
  } {
    if (!raw || typeof raw !== 'object') return { name: '' };
    const o = raw as Record<string, unknown>;
    return {
      name: typeof o.name === 'string' ? o.name : String(o.name ?? ''),
      address: typeof o.address === 'string' ? o.address : undefined,
      email: typeof o.email === 'string' ? o.email : undefined,
      phone: typeof o.phone === 'string' ? o.phone : undefined,
    };
  }

  private parseInvoiceLineItems(raw: unknown): Array<{
    description: string;
    quantity: number;
    unitPrice: string;
  }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ description: string; quantity: number; unitPrice: string }> = [];
    for (const li of raw) {
      if (!li || typeof li !== 'object') continue;
      const x = li as Record<string, unknown>;
      const qty = typeof x.quantity === 'number' ? x.quantity : Number(x.quantity);
      out.push({
        description:
          typeof x.description === 'string' ? x.description : String(x.description ?? ''),
        quantity: Number.isFinite(qty) ? qty : 0,
        unitPrice: String(x.unitPrice ?? '0'),
      });
    }
    return out;
  }

  /**
   * Get a single delivery remittance by ID with its orders (for detail view).
   */
  async getDeliveryRemittance(deliveryRemittanceId: string, actor: SessionUser) {
    const isTplCaller =
      this.actorHasAnyPermission(actor, 'logistics.remit') && !!actor.logisticsLocationId && (actor.role === 'TPL_MANAGER' || actor.role === 'TPL_RIDER');
    const canViewGlobal =
      actor.role === 'SUPER_ADMIN' ||
      hasFinanceAccess(actor) ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global') ||
      this.actorHasAnyPermission(actor, 'finance.cashRemittance.create') ||
      this.actorHasAnyPermission(actor, 'finance.read');
    if (!isTplCaller && !canViewGlobal) {
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
    // Location operators (3PL) without org-wide visibility see only their own location's remittances.
    if (isTplCaller && !canViewGlobal && actor.logisticsLocationId !== remittance.logisticsLocationId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view your location\'s remittances' });
    }

    const junctionRows = await this.db
      .select({ orderId: schema.deliveryRemittanceOrders.orderId })
      .from(schema.deliveryRemittanceOrders)
      .where(eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, deliveryRemittanceId));

    const orderIds = junctionRows.map((r) => r.orderId);
    const locationLookupRow =
      orderIds.length > 0
        ? (
            await this.db
              .select({
                name: schema.logisticsLocations.name,
                providerName: schema.logisticsProviders.name,
              })
              .from(schema.logisticsLocations)
              .leftJoin(
                schema.logisticsProviders,
                eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
              )
              .where(eq(schema.logisticsLocations.id, remittance.logisticsLocationId))
              .limit(1)
          )[0]
        : null;
    const locationName = locationLookupRow?.name ?? null;
    const locationProviderName = locationLookupRow?.providerName ?? null;

    const markedPaidForBatch = remittance.status === 'RECEIVED';

    let orders: Array<{
      id: string;
      customerName: string;
      totalAmount: string | null;
      deliveryFee: string | null;
      deliveredAt: string | null;
      status: string;
      invoice: {
        id: string;
        orderId: string;
        referenceNumber: number;
        referenceFormatted: string;
        recipientInfo: { name: string; address?: string; email?: string; phone?: string };
        lineItems: Array<{ description: string; quantity: number; unitPrice: string }>;
        totalAmount: string;
        taxRate: string | null;
        status: string;
        dueDate: string | null;
        createdAt: string;
        markedPaid: boolean;
      } | null;
    }> = [];
    if (orderIds.length > 0) {
      const orderRows = await this.db
        .select({
          id: schema.orders.id,
          customerName: schema.orders.customerName,
          totalAmount: schema.orders.totalAmount,
          deliveryFee: schema.orders.deliveryFee,
          deliveredAt: schema.orders.deliveredAt,
          status: schema.orders.status,
          invoiceId: schema.invoices.id,
          invoiceReferenceNumber: schema.invoices.referenceNumber,
          invoiceRecipientInfo: schema.invoices.recipientInfo,
          invoiceLineItems: schema.invoices.lineItems,
          invoiceTaxRate: schema.invoices.taxRate,
          invoiceTotalAmount: schema.invoices.totalAmount,
          invoiceStatus: schema.invoices.status,
          invoiceDueDate: schema.invoices.dueDate,
          invoiceCreatedAt: schema.invoices.createdAt,
          isDuplicate: schema.orders.isDuplicate,
          duplicateOfId: schema.orders.duplicateOfId,
        })
        .from(schema.orders)
        .leftJoin(schema.invoices, eq(schema.invoices.orderId, schema.orders.id))
        .where(inArray(schema.orders.id, orderIds));
      orders = orderRows.map((o) => ({
        id: o.id,
        customerName: o.customerName,
        totalAmount: o.totalAmount != null ? String(o.totalAmount) : null,
        deliveryFee: o.deliveryFee != null ? String(o.deliveryFee) : null,
        deliveredAt: o.deliveredAt?.toISOString() ?? null,
        status: o.status,
        isDuplicate: o.isDuplicate ?? null,
        duplicateOfId: o.duplicateOfId ?? null,
        invoice:
          o.invoiceId != null && o.invoiceReferenceNumber != null && o.invoiceCreatedAt
            ? {
                id: o.invoiceId,
                orderId: o.id,
                referenceNumber: o.invoiceReferenceNumber,
                referenceFormatted: this.formatInvoiceReference(o.invoiceReferenceNumber),
                recipientInfo: this.parseInvoiceRecipient(o.invoiceRecipientInfo),
                lineItems: this.parseInvoiceLineItems(o.invoiceLineItems),
                totalAmount:
                  o.invoiceTotalAmount != null ? String(o.invoiceTotalAmount) : '0',
                taxRate: o.invoiceTaxRate != null ? String(o.invoiceTaxRate) : null,
                status: o.invoiceStatus ?? 'DRAFT',
                dueDate: o.invoiceDueDate?.toISOString() ?? null,
                createdAt: o.invoiceCreatedAt.toISOString(),
                markedPaid: markedPaidForBatch,
              }
            : null,
      }));
    }

    const actorIds = [
      ...new Set(
        [remittance.sentBy, remittance.receivedBy].filter((id): id is string => id != null && id !== ''),
      ),
    ];
    const actorNames =
      actorIds.length > 0
        ? await this.db
            .select({ id: schema.users.id, name: schema.users.name })
            .from(schema.users)
            .where(inArray(schema.users.id, actorIds))
        : [];
    const nameById = new Map(actorNames.map((u) => [u.id, u.name]));

    return {
      ...remittance,
      locationName,
      locationProviderName,
      sentByName: nameById.get(remittance.sentBy) ?? null,
      receivedByName: remittance.receivedBy ? (nameById.get(remittance.receivedBy) ?? null) : null,
      orderCount: orders.length,
      orders,
    };
  }

  // ============================================
  // Delivery confirmation requests (rider/3PL → HOL approval)
  // ============================================

  async submitDeliveryConfirmation(input: SubmitDeliveryConfirmationInput, actor: SessionUser) {
    const hasPerm =
      actor.role === 'SUPER_ADMIN' ||
      this.actorHasAnyPermission(actor, 'logistics.deliveryConfirmation.submit') ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global');
    if (!hasPerm) {
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

    this.notifications.enqueueCreateForRole('HEAD_OF_LOGISTICS', {
      type: 'logistics:delivery_confirmation_pending',
      title: 'Delivery confirmation pending',
      body: `Order ${input.orderId.slice(0, 8)}… — ${input.newStatus} confirmation awaiting your approval.`,
      data: { requestId: request.id, orderId: input.orderId },
    });

    return request;
  }

  async listDeliveryConfirmationRequests(
    input: ListDeliveryConfirmationRequestsInput,
    actor: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    const isOrgWide =
      actor.role === 'SUPER_ADMIN' ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global');
    const hasPerm = this.actorHasAnyPermission(actor, 'logistics.deliveryConfirmation.review');
    if (!isOrgWide && !hasPerm) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Head of Logistics can list delivery confirmation requests',
      });
    }

    const conditions: SQL[] = [];
    if (input.status) {
      conditions.push(eq(schema.deliveryConfirmationRequests.status, input.status));
    }

    // Branch-scope via the related order's servicingBranchId (subquery avoids join shape change)
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, null, effectiveBranchIds);
    if (bCond) {
      conditions.push(
        inArray(
          schema.deliveryConfirmationRequests.orderId,
          this.db
            .select({ id: schema.orders.id })
            .from(schema.orders)
            .where(bCond),
        ),
      );
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
    const isOrgWide =
      actor.role === 'SUPER_ADMIN' ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global');
    const hasPerm = this.actorHasAnyPermission(actor, 'logistics.deliveryConfirmation.review');
    if (!isOrgWide && !hasPerm) {
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
    const isOrgWide =
      actor.role === 'SUPER_ADMIN' ||
      this.actorHasAnyPermission(actor, 'logistics.scope.global');
    const hasPerm = this.actorHasAnyPermission(actor, 'logistics.deliveryConfirmation.review');
    if (!isOrgWide && !hasPerm) {
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

  // ============================================
  // Logistics Team Analysis (provider performance rollup)
  // ============================================

  /**
   * Roll up order-level outcomes by logistics provider company so the
   * `/admin/logistics/team` page can rank "GoKada" / "Kwik Delivery" etc. by
   * delivery + delinquency rate.
   *
   * - Includes providers with zero allocated orders (left join) so newly added
   *   companies are visible with all-zero metrics.
   * - Filters orders by `allocatedAt` (the canonical "in-flight at provider"
   *   timestamp). Orders that never reached AGENT_ASSIGNED are not the provider's
   *   responsibility yet.
   * - When `branchId` is given, restricts to that branch. SuperAdmin / org-wide
   *   HoLogistics passes null → no filter (sees all branches).
   * - Defaults to month-to-date when no date range is provided.
   */
  async getLogisticsProviderPerformance(
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
    productId?: string,
    /** When true, include all providers even those with zero activity (for exports). */
    includeInactive?: boolean,
    /** Company-group isolation — when set, only providers in this group are listed. */
    activeGroupId?: string | null,
  ): Promise<
    Array<{
      providerId: string;
      providerName: string;
      contactInfo: string;
      coverageArea: string;
      status: string;
      locationCount: number;
      totalAssigned: number;
      delivered: number;
      partiallyDelivered: number;
      returned: number;
      writtenOff: number;
      cancelled: number;
      inTransit: number;
      dispatched: number;
      allocated: number;
      deliveryRate: number;
      delinquencyRate: number;
      statusBreakdown: { status: string; count: number; pct: number }[];
      /** Sum of order totals on this provider's RECEIVED batches in the period. */
      remittedAmount: string;
      /** Sum of order totals on this provider's still-SENT (Pending) batches in the period. */
      pendingRemittanceAmount: string;
      /** Sum of order totals on this provider's DISPUTED batches in the period. */
      disputedRemittanceAmount: string;
      /** Total units (bottles) delivered — SUM(order_items.quantity) for DELIVERED/REMITTED orders. */
      unitsDelivered: number;
      /** Available stock across all locations for this provider. */
      availableStock: number;
      /** Reserved stock across all locations for this provider. */
      reservedStock: number;
      /** Stock reconciliation totals for consistency check. */
      stockReceived: number;
      stockSold: number;
      stockTransferredOut: number;
      stockAdjusted: number;
      stockWrittenOff: number;
      stockDispatched: number;
    }>
  > {
    // Default to month-to-date when no range supplied — matches marketing page UX.
    let effectiveStart: Date | null = null;
    let effectiveEnd: Date | null = null;
    if (startDate || endDate) {
      if (startDate) effectiveStart = nigeriaDayStart(startDate);
      if (endDate) effectiveEnd = nigeriaDayEnd(endDate);
    } else {
      const now = new Date();
      effectiveStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      effectiveEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      );
    }

    // ── Pass 1: location count per provider ────────────────────────────────
    const locationCountRows = await this.db
      .select({
        providerId: schema.logisticsLocations.providerId,
        count: count(),
      })
      .from(schema.logisticsLocations)
      .groupBy(schema.logisticsLocations.providerId);
    const locationCountByProvider = new Map<string, number>();
    for (const row of locationCountRows) {
      if (row.providerId) locationCountByProvider.set(row.providerId, Number(row.count) || 0);
    }

    // ── Pass 2: per-(provider, status) order counts ────────────────────────
    // Join orders → logistics_locations to resolve provider_id; the order itself
    // also carries `logistics_provider_id` but the location-derived link is the
    // canonical one (set during AGENT_ASSIGNED transition).
    // Date filter: use COALESCE(allocated_at, delivered_at, created_at) so orders
    // that skipped AGENT_ASSIGNED (e.g. follow-up/cart direct-deliver) are still counted.
    const logisticsDateCol = sql`COALESCE(${schema.orders.allocatedAt}, ${schema.orders.deliveredAt}, ${schema.orders.createdAt})`;
    const orderConditions: SQL[] = [isNotNull(schema.orders.logisticsLocationId)];
    if (effectiveStart) orderConditions.push(sql`${logisticsDateCol} >= ${effectiveStart.toISOString()}::timestamptz`);
    if (effectiveEnd) orderConditions.push(sql`${logisticsDateCol} <= ${effectiveEnd.toISOString()}::timestamptz`);
    const bCond1 = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond1) orderConditions.push(bCond1);

    const statusRows = await this.db
      .select({
        providerId: schema.logisticsLocations.providerId,
        status: schema.orders.status,
        count: count(),
      })
      .from(schema.orders)
      .innerJoin(
        schema.logisticsLocations,
        eq(schema.logisticsLocations.id, schema.orders.logisticsLocationId),
      )
      .where(and(...orderConditions))
      .groupBy(schema.logisticsLocations.providerId, schema.orders.status);

    const statusCountsByProvider = new Map<string, Map<string, number>>();
    for (const row of statusRows) {
      if (!row.providerId) continue;
      let bucket = statusCountsByProvider.get(row.providerId);
      if (!bucket) {
        bucket = new Map<string, number>();
        statusCountsByProvider.set(row.providerId, bucket);
      }
      bucket.set(row.status, Number(row.count) || 0);
    }

    // ── Pass 3: list providers (always, including zero-order ones) ─────────
    // Company-group isolation: only providers in the active group are listed,
    // mirroring listProviders. Without this the report leaks providers (and
    // their stock) from other companies.
    const providers = await this.db
      .select({
        id: schema.logisticsProviders.id,
        name: schema.logisticsProviders.name,
        status: schema.logisticsProviders.status,
        contactInfo: schema.logisticsProviders.contactInfo,
        coverageArea: schema.logisticsProviders.coverageArea,
      })
      .from(schema.logisticsProviders)
      .where(activeGroupId ? or(eq(schema.logisticsProviders.groupId, activeGroupId), isNull(schema.logisticsProviders.groupId))! : undefined);

    // ── Pass 4: per-provider remittance amounts ────────────────────────────
    // Approved/disputed from delivery_remittance_outcomes (same source of
    // truth as the Finance page) so the "Remitted" stat matches. Date filter
    // is on deliveryRemittances.sentAt to align with Finance's bucketing.
    // Pending (SENT) batches don't have outcome rows yet, so we query them
    // separately from order totals.
    const remitSentAtConditions: SQL[] = [];
    if (effectiveStart) remitSentAtConditions.push(sql`${schema.deliveryRemittances.sentAt} >= ${effectiveStart.toISOString()}::timestamptz`);
    if (effectiveEnd) remitSentAtConditions.push(sql`${schema.deliveryRemittances.sentAt} <= ${effectiveEnd.toISOString()}::timestamptz`);
    if (activeGroupId) {
      remitSentAtConditions.push(
        or(eq(schema.logisticsProviders.groupId, activeGroupId), isNull(schema.logisticsProviders.groupId))!,
      );
    }

    // 4a: RECEIVED batches — sum order totals (matches Cash Remittances page)
    const receivedConditions: SQL[] = [eq(schema.deliveryRemittances.status, 'RECEIVED'), ...remitSentAtConditions];
    const outcomeRows = await this.db
      .select({
        providerId: schema.logisticsLocations.providerId,
        remittedAmount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
        remittedOrderCount: sql<string>`COUNT(DISTINCT ${schema.deliveryRemittanceOrders.orderId})::text`,
        disputedRemittanceAmount: sql<string>`'0'`,
      })
      .from(schema.deliveryRemittances)
      .innerJoin(
        schema.deliveryRemittanceOrders,
        eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, schema.deliveryRemittances.id),
      )
      .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
      .innerJoin(
        schema.logisticsLocations,
        eq(schema.logisticsLocations.id, schema.deliveryRemittances.logisticsLocationId),
      )
      .innerJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(and(...receivedConditions))
      .groupBy(schema.logisticsLocations.providerId);

    // 4a-disputed: DISPUTED batches from outcomes
    const disputedConditions: SQL[] = [...remitSentAtConditions];
    if (activeGroupId) {
      // already in remitSentAtConditions
    }
    const disputedRows = await this.db
      .select({
        providerId: schema.logisticsLocations.providerId,
        disputedRemittanceAmount: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittanceOutcomes.status} = 'DISPUTED' THEN ${schema.deliveryRemittanceOutcomes.amount} ELSE 0 END), 0)::text`,
      })
      .from(schema.deliveryRemittanceOutcomes)
      .innerJoin(
        schema.deliveryRemittances,
        eq(schema.deliveryRemittanceOutcomes.deliveryRemittanceId, schema.deliveryRemittances.id),
      )
      .innerJoin(
        schema.logisticsLocations,
        eq(schema.logisticsLocations.id, schema.deliveryRemittances.logisticsLocationId),
      )
      .innerJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(disputedConditions.length > 0 ? and(...disputedConditions) : undefined)
      .groupBy(schema.logisticsLocations.providerId);

    // 4b: pending (SENT) batches — no outcome rows yet, sum from order totals
    const pendingConditions: SQL[] = [eq(schema.deliveryRemittances.status, 'SENT')];
    if (effectiveStart) pendingConditions.push(sql`${schema.deliveryRemittances.sentAt} >= ${effectiveStart.toISOString()}::timestamptz`);
    if (effectiveEnd) pendingConditions.push(sql`${schema.deliveryRemittances.sentAt} <= ${effectiveEnd.toISOString()}::timestamptz`);
    if (activeGroupId) {
      pendingConditions.push(
        or(eq(schema.logisticsProviders.groupId, activeGroupId), isNull(schema.logisticsProviders.groupId))!,
      );
    }

    const pendingRows = await this.db
      .select({
        providerId: schema.logisticsLocations.providerId,
        pendingRemittanceAmount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
      })
      .from(schema.deliveryRemittances)
      .innerJoin(
        schema.deliveryRemittanceOrders,
        eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, schema.deliveryRemittances.id),
      )
      .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
      .innerJoin(
        schema.logisticsLocations,
        eq(schema.logisticsLocations.id, schema.deliveryRemittances.logisticsLocationId),
      )
      .innerJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(and(...pendingConditions))
      .groupBy(schema.logisticsLocations.providerId);

    // Merge outcome + pending + disputed results per provider
    const remittanceRows = [...outcomeRows, ...pendingRows, ...disputedRows].reduce<
      Array<{ providerId: string | null; remittedAmount: string; remittedOrderCount: string; pendingRemittanceAmount: string; disputedRemittanceAmount: string }>
    >((acc, _row) => {
      const row = _row as Record<string, string | null>;
      const pid = row.providerId;
      let entry = acc.find((e) => e.providerId === pid);
      if (!entry) {
        entry = { providerId: pid ?? null, remittedAmount: '0', remittedOrderCount: '0', pendingRemittanceAmount: '0', disputedRemittanceAmount: '0' };
        acc.push(entry);
      }
      if ('remittedAmount' in row && row.remittedAmount !== '0') entry.remittedAmount = row.remittedAmount ?? '0';
      if ('remittedOrderCount' in row && row.remittedOrderCount !== '0') entry.remittedOrderCount = row.remittedOrderCount ?? '0';
      if ('pendingRemittanceAmount' in row && row.pendingRemittanceAmount !== '0') entry.pendingRemittanceAmount = row.pendingRemittanceAmount ?? '0';
      if ('disputedRemittanceAmount' in row && row.disputedRemittanceAmount !== '0') entry.disputedRemittanceAmount = row.disputedRemittanceAmount ?? '0';
      return acc;
    }, []);

    const remittanceByProvider = new Map<string, { received: string; receivedOrderCount: string; pending: string; disputed: string }>();
    for (const r of remittanceRows) {
      if (r.providerId) {
        remittanceByProvider.set(r.providerId, {
          received: r.remittedAmount,
          receivedOrderCount: r.remittedOrderCount,
          pending: r.pendingRemittanceAmount,
          disputed: r.disputedRemittanceAmount,
        });
      }
    }

    // 4c: owing — DELIVERED orders NOT on any remittance batch
    const owingConditions: SQL[] = [
      eq(schema.orders.status, 'DELIVERED'),
      sql`${schema.orders.id} NOT IN (SELECT dro.order_id FROM delivery_remittance_orders dro)`,
    ];
    if (effectiveStart) owingConditions.push(sql`${schema.orders.deliveredAt} >= ${effectiveStart.toISOString()}::timestamptz`);
    if (effectiveEnd) owingConditions.push(sql`${schema.orders.deliveredAt} <= ${effectiveEnd.toISOString()}::timestamptz`);
    if (effectiveBranchIds?.length) {
      owingConditions.push(inArray(schema.orders.servicingBranchId, effectiveBranchIds));
    }

    const owingRows = await this.db
      .select({
        providerId: schema.logisticsLocations.providerId,
        owingAmount: sql<string>`COALESCE(SUM(${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)), 0)::text`,
        owingCount: count(),
      })
      .from(schema.orders)
      .innerJoin(
        schema.logisticsLocations,
        eq(schema.logisticsLocations.id, schema.orders.logisticsLocationId),
      )
      .where(and(...owingConditions))
      .groupBy(schema.logisticsLocations.providerId);

    const owingByProvider = new Map(
      owingRows.map((r) => [r.providerId, { amount: r.owingAmount, count: r.owingCount }]),
    );

    // ── Pass 5: units (bottles) delivered per provider ─────────────────────
    // SUM(order_items.quantity) for DELIVERED + REMITTED orders, same period
    // and branch scope as Pass 2. Gives the CEO a "bottles sold" metric.
    const unitsDateCol = sql`COALESCE(${schema.orders.allocatedAt}, ${schema.orders.deliveredAt}, ${schema.orders.createdAt})`;
    const unitsConditions: SQL[] = [
      isNotNull(schema.orders.logisticsLocationId),
      inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
    ];
    if (effectiveStart) unitsConditions.push(sql`${unitsDateCol} >= ${effectiveStart.toISOString()}::timestamptz`);
    if (effectiveEnd) unitsConditions.push(sql`${unitsDateCol} <= ${effectiveEnd.toISOString()}::timestamptz`);
    const bCond3 = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond3) unitsConditions.push(bCond3);

    const unitsRows = await this.db
      .select({
        providerId: schema.logisticsLocations.providerId,
        totalUnits: sql<string>`COALESCE(SUM(${schema.orderItems.quantity}), 0)::text`,
      })
      .from(schema.orders)
      .innerJoin(
        schema.logisticsLocations,
        eq(schema.logisticsLocations.id, schema.orders.logisticsLocationId),
      )
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .where(and(...unitsConditions))
      .groupBy(schema.logisticsLocations.providerId);

    const unitsByProvider = new Map<string, number>();
    for (const row of unitsRows) {
      if (row.providerId) unitsByProvider.set(row.providerId, Number(row.totalUnits) || 0);
    }

    // ── Pass 6: available stock per provider ──────────────────────────────
    const stockConds: SQL[] = [];
    if (productId) stockConds.push(eq(schema.inventoryLevels.productId, productId));
    const stockRows = await this.db
      .select({
        providerId: schema.logisticsLocations.providerId,
        availableStock: sql<string>`COALESCE(SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}), 0)::text`,
        reservedStock: sql<string>`COALESCE(SUM(${schema.inventoryLevels.reservedCount}), 0)::text`,
      })
      .from(schema.inventoryLevels)
      .innerJoin(
        schema.logisticsLocations,
        eq(schema.logisticsLocations.id, schema.inventoryLevels.locationId),
      )
      .where(stockConds.length > 0 ? and(...stockConds) : undefined)
      .groupBy(schema.logisticsLocations.providerId);

    const stockByProvider = new Map<string, { available: number; reserved: number }>();
    for (const row of stockRows) {
      if (row.providerId) stockByProvider.set(row.providerId, { available: Number(row.availableStock) || 0, reserved: Number(row.reservedStock) || 0 });
    }

    // ── Pass 7: stock reconciliation totals per provider ────────────────────
    // Aggregates received (INTAKE+TRANSFER_IN+RESTOCK), sold (DELIVERY),
    // transferred out, adjustments, write-offs, and dispatched per provider
    // so the team table can show a consistency check.
    const reconRows = await this.db.execute<{
      providerId: string;
      received: number;
      sold: number;
      transferredOut: number;
      adjusted: number;
      writtenOff: number;
      dispatched: number;
    }>(sql`
      SELECT
        ll.provider_id AS "providerId",
        COALESCE(SUM(CASE
          WHEN sm.movement_type IN ('INTAKE','RESTOCK') THEN ABS(sm.quantity)
          WHEN sm.movement_type = 'TRANSFER_IN' AND (ll_from.provider_id IS NULL OR ll_from.provider_id != ll.provider_id) THEN ABS(sm.quantity)
          ELSE 0
        END), 0)::int AS "received",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'DELIVERY' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "sold",
        COALESCE(SUM(CASE
          WHEN sm.movement_type = 'TRANSFER_OUT' AND (ll_to.provider_id IS NULL OR ll_to.provider_id != ll.provider_id) THEN ABS(sm.quantity)
          ELSE 0
        END), 0)::int AS "transferredOut",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'ADJUSTMENT' THEN sm.quantity ELSE 0 END), 0)::int AS "adjusted",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'WRITE_OFF' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "writtenOff",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'DISPATCH' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "dispatched"
      FROM stock_movements sm
      INNER JOIN logistics_locations ll ON ll.id = COALESCE(sm.from_location_id, sm.to_location_id)
      LEFT JOIN logistics_locations ll_from ON ll_from.id = sm.from_location_id
      LEFT JOIN logistics_locations ll_to ON ll_to.id = sm.to_location_id
      WHERE sm.movement_type IN ('INTAKE','TRANSFER_IN','RESTOCK','DELIVERY','TRANSFER_OUT','ADJUSTMENT','WRITE_OFF','DISPATCH')
        ${productId ? sql`AND sm.product_id = ${productId}::uuid` : sql``}
      GROUP BY ll.provider_id
    `);
    const reconByProvider = new Map<string, { received: number; sold: number; transferredOut: number; adjusted: number; writtenOff: number; dispatched: number }>();
    for (const r of reconRows) {
      if (r.providerId) reconByProvider.set(r.providerId, r);
    }

    // ── Build rollup ───────────────────────────────────────────────────────
    const result = providers.map((p) => {
      const counts = statusCountsByProvider.get(p.id) ?? new Map<string, number>();
      const get = (s: string): number => counts.get(s) ?? 0;

      const delivered = get('DELIVERED');
      const partiallyDelivered = get('PARTIALLY_DELIVERED');
      const returned = get('RETURNED');
      const writtenOff = get('WRITTEN_OFF');
      const cancelled = get('CANCELLED');
      const inTransit = get('IN_TRANSIT');
      const dispatched = get('DISPATCHED');
      const allocated = get('AGENT_ASSIGNED');
      const restocked = get('RESTOCKED');
      const completed = get('REMITTED');

      const totalAssigned =
        delivered +
        partiallyDelivered +
        returned +
        writtenOff +
        cancelled +
        inTransit +
        dispatched +
        allocated +
        restocked +
        completed;

      // DELIVERED + COMPLETED both count as delivered for the rate (COMPLETED is
      // the post-remittance terminal state). Numerator stays the headline
      // "delivered" column to keep the table scannable.
      const deliveredForRate = delivered + completed;
      const deliveryRate = totalAssigned > 0 ? (deliveredForRate / totalAssigned) * 100 : 0;
      const delinquencyRate =
        totalAssigned > 0
          ? ((returned + partiallyDelivered + writtenOff) / totalAssigned) * 100
          : 0;

      // Stacked-bar percentages — sum to ~100 (rounding aside).
      const statusBreakdown: { status: string; count: number; pct: number }[] = [];
      const statusOrder: string[] = [
        'DELIVERED',
        'REMITTED',
        'PARTIALLY_DELIVERED',
        'IN_TRANSIT',
        'DISPATCHED',
        'AGENT_ASSIGNED',
        'RETURNED',
        'WRITTEN_OFF',
        'RESTOCKED',
        'CANCELLED',
      ];
      for (const s of statusOrder) {
        const c = get(s);
        if (c <= 0) continue;
        statusBreakdown.push({
          status: s,
          count: c,
          pct: totalAssigned > 0 ? (c / totalAssigned) * 100 : 0,
        });
      }

      const remit = remittanceByProvider.get(p.id);
      return {
        providerId: p.id,
        providerName: p.name,
        contactInfo: p.contactInfo ?? '',
        coverageArea: p.coverageArea ?? '',
        status: p.status,
        locationCount: locationCountByProvider.get(p.id) ?? 0,
        totalAssigned,
        delivered: delivered + completed,
        partiallyDelivered,
        returned,
        writtenOff,
        cancelled,
        inTransit,
        dispatched,
        allocated,
        deliveryRate,
        delinquencyRate,
        statusBreakdown,
        remittedAmount: remit?.received ?? '0',
        remittedOrderCount: Number(remit?.receivedOrderCount ?? '0'),
        pendingRemittanceAmount: remit?.pending ?? '0',
        disputedRemittanceAmount: remit?.disputed ?? '0',
        owingAmount: owingByProvider.get(p.id)?.amount ?? '0',
        owingCount: owingByProvider.get(p.id)?.count ?? 0,
        unitsDelivered: unitsByProvider.get(p.id) ?? 0,
        availableStock: stockByProvider.get(p.id)?.available ?? 0,
        reservedStock: stockByProvider.get(p.id)?.reserved ?? 0,
        stockReceived: reconByProvider.get(p.id)?.received ?? 0,
        stockSold: reconByProvider.get(p.id)?.sold ?? 0,
        stockTransferredOut: reconByProvider.get(p.id)?.transferredOut ?? 0,
        stockAdjusted: reconByProvider.get(p.id)?.adjusted ?? 0,
        stockWrittenOff: reconByProvider.get(p.id)?.writtenOff ?? 0,
        stockDispatched: reconByProvider.get(p.id)?.dispatched ?? 0,
      };
    });

    // When group-scoped (and not exporting all), hide providers with zero ORDER
    // activity in the selected group. Stock alone should not cause a provider from
    // another company group to appear — stock is location-level, not branch-scoped.
    const filtered = effectiveBranchIds?.length && !includeInactive
      ? result.filter((p) => p.totalAssigned > 0)
      : result;

    // Sort: highest delivery rate first, then largest volume — providers with no
    // orders sink to the bottom (deliveryRate 0, totalAssigned 0).
    filtered.sort((a, b) => {
      if (b.deliveryRate !== a.deliveryRate) return b.deliveryRate - a.deliveryRate;
      return b.totalAssigned - a.totalAssigned;
    });

    return filtered;
  }

  /**
   * Per-location performance rollup — mirrors `getLogisticsProviderPerformance` but
   * groups by `logistics_locations.id` instead of `logistics_providers.id`. Used by
   * the "By Location" view toggle on the Logistics Team Analysis page.
   */
  async getLogisticsLocationPerformance(
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
    productId?: string,
    /** Company-group isolation — when set, only locations of providers in this group are listed. */
    activeGroupId?: string | null,
  ) {
    let effectiveStart: Date | null = null;
    let effectiveEnd: Date | null = null;
    if (startDate || endDate) {
      if (startDate) effectiveStart = nigeriaDayStart(startDate);
      if (endDate) effectiveEnd = nigeriaDayEnd(endDate);
    } else {
      const now = new Date();
      effectiveStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      effectiveEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    }

    // All locations with their provider. Company-group isolation: only
    // locations whose provider is in the active group (locations inherit group
    // via their provider). Without this the report leaks other companies' depots.
    const locations = await this.db
      .select({
        id: schema.logisticsLocations.id,
        name: schema.logisticsLocations.name,
        providerId: schema.logisticsLocations.providerId,
        providerName: schema.logisticsProviders.name,
        status: schema.logisticsLocations.status,
      })
      .from(schema.logisticsLocations)
      .innerJoin(schema.logisticsProviders, eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId))
      .where(activeGroupId ? or(eq(schema.logisticsProviders.groupId, activeGroupId), isNull(schema.logisticsProviders.groupId))! : undefined);

    if (locations.length === 0) return [];

    // Orders per location
    const dateCol = sql`COALESCE(${schema.orders.allocatedAt}, ${schema.orders.deliveredAt}, ${schema.orders.createdAt})`;
    const orderConds: SQL[] = [isNotNull(schema.orders.logisticsLocationId)];
    if (effectiveStart) orderConds.push(sql`${dateCol} >= ${effectiveStart.toISOString()}::timestamptz`);
    if (effectiveEnd) orderConds.push(sql`${dateCol} <= ${effectiveEnd.toISOString()}::timestamptz`);
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) orderConds.push(bCond);

    const statusRows = await this.db
      .select({
        locationId: schema.orders.logisticsLocationId,
        status: schema.orders.status,
        cnt: count(),
      })
      .from(schema.orders)
      .where(and(...orderConds))
      .groupBy(schema.orders.logisticsLocationId, schema.orders.status);

    const statusByLoc = new Map<string, Map<string, number>>();
    for (const r of statusRows) {
      if (!r.locationId) continue;
      let m = statusByLoc.get(r.locationId);
      if (!m) { m = new Map(); statusByLoc.set(r.locationId, m); }
      m.set(r.status, Number(r.cnt) || 0);
    }

    // Stock per location
    const locStockConds: SQL[] = [];
    if (productId) locStockConds.push(eq(schema.inventoryLevels.productId, productId));
    const stockRows = await this.db
      .select({
        locationId: schema.inventoryLevels.locationId,
        available: sql<string>`COALESCE(SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}), 0)::text`,
        reserved: sql<string>`COALESCE(SUM(${schema.inventoryLevels.reservedCount}), 0)::text`,
      })
      .from(schema.inventoryLevels)
      .where(locStockConds.length > 0 ? and(...locStockConds) : undefined)
      .groupBy(schema.inventoryLevels.locationId);
    const stockByLoc = new Map<string, { available: number; reserved: number }>();
    for (const r of stockRows) stockByLoc.set(r.locationId, { available: Number(r.available) || 0, reserved: Number(r.reserved) || 0 });

    // Reconciliation per location
    const reconRows = await this.db.execute<{
      locationId: string; received: number; sold: number; transferredOut: number; adjusted: number; writtenOff: number; dispatched: number;
    }>(sql`
      SELECT
        COALESCE(sm.from_location_id, sm.to_location_id) AS "locationId",
        COALESCE(SUM(CASE WHEN sm.movement_type IN ('INTAKE','TRANSFER_IN','RESTOCK') THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "received",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'DELIVERY' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "sold",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'TRANSFER_OUT' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "transferredOut",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'ADJUSTMENT' THEN sm.quantity ELSE 0 END), 0)::int AS "adjusted",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'WRITE_OFF' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "writtenOff",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'DISPATCH' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "dispatched"
      FROM stock_movements sm
      WHERE sm.movement_type IN ('INTAKE','TRANSFER_IN','RESTOCK','DELIVERY','TRANSFER_OUT','ADJUSTMENT','WRITE_OFF','DISPATCH')
        ${productId ? sql`AND sm.product_id = ${productId}::uuid` : sql``}
      GROUP BY COALESCE(sm.from_location_id, sm.to_location_id)
    `);
    const reconByLoc = new Map<string, { received: number; sold: number; transferredOut: number; adjusted: number; writtenOff: number; dispatched: number }>();
    for (const r of reconRows) if (r.locationId) reconByLoc.set(r.locationId, r);

    // Units delivered per location
    const unitsConds: SQL[] = [isNotNull(schema.orders.logisticsLocationId), inArray(schema.orders.status, ['DELIVERED', 'REMITTED'])];
    if (effectiveStart) unitsConds.push(sql`${dateCol} >= ${effectiveStart.toISOString()}::timestamptz`);
    if (effectiveEnd) unitsConds.push(sql`${dateCol} <= ${effectiveEnd.toISOString()}::timestamptz`);
    const bCond2 = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond2) unitsConds.push(bCond2);

    const unitsRows = await this.db
      .select({
        locationId: schema.orders.logisticsLocationId,
        totalUnits: sql<string>`COALESCE(SUM(${schema.orderItems.quantity}), 0)::text`,
      })
      .from(schema.orders)
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .where(and(...unitsConds))
      .groupBy(schema.orders.logisticsLocationId);
    const unitsByLoc = new Map<string, number>();
    for (const r of unitsRows) if (r.locationId) unitsByLoc.set(r.locationId, Number(r.totalUnits) || 0);

    // Remittance per location
    const remitConds: SQL[] = [];
    if (effectiveStart) remitConds.push(sql`COALESCE(${schema.orders.allocatedAt}, ${schema.orders.deliveredAt}, ${schema.orders.createdAt}) >= ${effectiveStart.toISOString()}::timestamptz`);
    if (effectiveEnd) remitConds.push(sql`COALESCE(${schema.orders.allocatedAt}, ${schema.orders.deliveredAt}, ${schema.orders.createdAt}) <= ${effectiveEnd.toISOString()}::timestamptz`);
    const bCond3 = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond3) remitConds.push(bCond3);

    const remitRows = await this.db
      .select({
        locationId: schema.deliveryRemittances.logisticsLocationId,
        remitted: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'RECEIVED' THEN (${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)) ELSE 0 END), 0)::text`,
        pending: sql<string>`COALESCE(SUM(CASE WHEN ${schema.deliveryRemittances.status} = 'SENT' THEN (${schema.orders.totalAmount} - COALESCE(${schema.orders.deliveryFee}, 0)) ELSE 0 END), 0)::text`,
      })
      .from(schema.deliveryRemittances)
      .innerJoin(schema.deliveryRemittanceOrders, eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, schema.deliveryRemittances.id))
      .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
      .where(remitConds.length > 0 ? and(...remitConds) : undefined)
      .groupBy(schema.deliveryRemittances.logisticsLocationId);
    const remitByLoc = new Map<string, { remitted: string; pending: string }>();
    for (const r of remitRows) if (r.locationId) remitByLoc.set(r.locationId, { remitted: r.remitted, pending: r.pending });

    // Build
    const result = locations.map((loc) => {
      const counts = statusByLoc.get(loc.id) ?? new Map<string, number>();
      const get = (s: string) => counts.get(s) ?? 0;
      const delivered = get('DELIVERED') + get('REMITTED');
      const returned = get('RETURNED');
      const partiallyDelivered = get('PARTIALLY_DELIVERED');
      const writtenOff = get('WRITTEN_OFF');
      const inTransit = get('IN_TRANSIT');
      const dispatched = get('DISPATCHED');
      const totalAssigned = delivered + returned + partiallyDelivered + writtenOff + get('CANCELLED') + inTransit + dispatched + get('AGENT_ASSIGNED') + get('RESTOCKED');
      const deliveryRate = totalAssigned > 0 ? (delivered / totalAssigned) * 100 : 0;
      const delinquencyRate = totalAssigned > 0 ? ((returned + partiallyDelivered + writtenOff) / totalAssigned) * 100 : 0;
      const stock = stockByLoc.get(loc.id);
      const recon = reconByLoc.get(loc.id);
      const remit = remitByLoc.get(loc.id);
      return {
        locationId: loc.id,
        locationName: loc.name,
        providerId: loc.providerId,
        providerName: loc.providerName,
        status: loc.status ?? 'ACTIVE',
        totalAssigned,
        delivered,
        inTransit,
        dispatched,
        returned,
        partiallyDelivered,
        writtenOff,
        deliveryRate,
        delinquencyRate,
        unitsDelivered: unitsByLoc.get(loc.id) ?? 0,
        availableStock: stock?.available ?? 0,
        reservedStock: stock?.reserved ?? 0,
        remittedAmount: remit?.remitted ?? '0',
        pendingRemittanceAmount: remit?.pending ?? '0',
        stockReceived: recon?.received ?? 0,
        stockSold: recon?.sold ?? 0,
        stockTransferredOut: recon?.transferredOut ?? 0,
        stockAdjusted: recon?.adjusted ?? 0,
        stockWrittenOff: recon?.writtenOff ?? 0,
        stockDispatched: recon?.dispatched ?? 0,
      };
    });

    // When group-scoped, hide locations with zero ORDER activity in the selected group.
    // Stock alone doesn't qualify — it's location-level, not branch-scoped.
    const filtered = effectiveBranchIds?.length
      ? result.filter((l) => l.totalAssigned > 0)
      : result;

    filtered.sort((a, b) => {
      if (b.deliveryRate !== a.deliveryRate) return b.deliveryRate - a.deliveryRate;
      return b.totalAssigned - a.totalAssigned;
    });

    return filtered;
  }
}
