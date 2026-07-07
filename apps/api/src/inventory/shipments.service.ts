import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  CreateShipmentInput,
  UpdateShipmentLinesInput,
  ShipmentTransitionInput,
  VerifyShipmentInput,
  CancelShipmentInput,
  ListShipmentsInput,
  ShipmentStatus,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { withActorAndBranch } from '../common/db/with-actor';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevel } from '../common/authz';
import { canonicalPermissionCode } from '@yannis/shared';
import { InventoryService } from './inventory.service';
import { GeneralLedgerService } from '../finance/general-ledger.service';

type ShipmentLineReceipt = VerifyShipmentInput['lines'][number];

/**
 * Inbound shipment service — supplier → warehouse receipts.
 *
 * Companion to `InventoryService.intake()` (single-product correction). This
 * service handles the multi-line, lifecycle-driven flow for actual supplier
 * deliveries: CREATED → IN_TRANSIT → ARRIVED → VERIFIED → CLOSED, with
 * CANCELLED at any pre-VERIFY stage.
 *
 * On VERIFY, every line writes a `stock_batches` row, upserts
 * `inventory_levels.stock_count`, and logs an `INTAKE` `stock_movements` row —
 * mirroring the existing `intake()` upsert exactly, just batched across N
 * lines inside one `withActorAndBranch` transaction.
 */
@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly inventory: InventoryService,
    private readonly generalLedger: GeneralLedgerService,
  ) {}

  // ============================================================
  // Permissions
  // ============================================================

  private hasIntakePermission(actor: SessionUser): boolean {
    if (isAdminLevel(actor)) return true;
    const want = canonicalPermissionCode('inventory.intake');
    return (actor.permissions ?? []).map((c) => canonicalPermissionCode(c)).includes(want);
  }

  private hasVerifyPermission(actor: SessionUser): boolean {
    if (isAdminLevel(actor)) return true;
    const want = canonicalPermissionCode('inventory.verifyTransfer');
    return (actor.permissions ?? []).map((c) => canonicalPermissionCode(c)).includes(want);
  }

  // ============================================================
  // Helpers
  // ============================================================

  /** `SHIP-2026-0042` — mirrors `finance.service.ts::formatReference`. */
  static formatReference(refNumber: number, year: number = new Date().getFullYear()): string {
    return `SHIP-${year}-${String(refNumber).padStart(4, '0')}`;
  }

  /**
   * Allocate the parent shipment's `total_landing_cost` across lines.
   * Weight by `received_qty × factory_cost` so high-cost SKUs absorb a fair
   * share of the freight; falls back to qty-only when all factory costs are
   * zero (e.g. rough planning data).
   */
  private allocateLandingCost(
    lines: Array<{ id: string; receivedQuantity: number; factoryCost: string | number }>,
    total: number,
  ): Map<string, number> {
    const out = new Map<string, number>();
    if (total <= 0) {
      for (const line of lines) out.set(line.id, 0);
      return out;
    }

    const valueWeights = lines.map((line) => {
      const fc =
        typeof line.factoryCost === 'string' ? parseFloat(line.factoryCost) : line.factoryCost;
      return Math.max(0, line.receivedQuantity) * (Number.isFinite(fc) && fc > 0 ? fc : 0);
    });
    const valueSum = valueWeights.reduce((a, b) => a + b, 0);

    if (valueSum > 0) {
      let allocated = 0;
      lines.forEach((line, idx) => {
        if (idx === lines.length - 1) {
          // Final line eats rounding so the sum exactly matches `total`.
          out.set(line.id, Math.round((total - allocated) * 100) / 100);
        } else {
          const slice = Math.round(((valueWeights[idx]! / valueSum) * total) * 100) / 100;
          out.set(line.id, slice);
          allocated += slice;
        }
      });
      return out;
    }

    // Qty-only fallback
    const qtySum = lines.reduce((a, l) => a + Math.max(0, l.receivedQuantity), 0);
    if (qtySum <= 0) {
      for (const line of lines) out.set(line.id, 0);
      return out;
    }
    let allocated = 0;
    lines.forEach((line, idx) => {
      if (idx === lines.length - 1) {
        out.set(line.id, Math.round((total - allocated) * 100) / 100);
      } else {
        const slice =
          Math.round(((Math.max(0, line.receivedQuantity) / qtySum) * total) * 100) / 100;
        out.set(line.id, slice);
        allocated += slice;
      }
    });
    return out;
  }

  /**
   * Per-status × role transitions. Mirrors the shape used by
   * `payroll-batch.service.ts::getAllowedTransitions`.
   */
  private getAllowedTransitions(
    shipment: { status: ShipmentStatus },
    actor: SessionUser,
  ): string[] {
    const out: string[] = [];
    const canEdit = this.hasIntakePermission(actor);
    const canVerify = this.hasVerifyPermission(actor);

    if (canEdit) {
      if (shipment.status === 'CREATED') out.push('MARK_IN_TRANSIT', 'MARK_ARRIVED', 'CANCEL', 'EDIT_LINES');
      if (shipment.status === 'IN_TRANSIT') out.push('MARK_ARRIVED', 'CANCEL', 'EDIT_LINES');
      if (shipment.status === 'ARRIVED') out.push('EDIT_LINES', 'CANCEL');
    }
    if (canVerify) {
      if (shipment.status === 'ARRIVED') out.push('VERIFY');
      if (shipment.status === 'VERIFIED') out.push('CLOSE');
    }
    return Array.from(new Set(out));
  }

  /**
   * Branch scoping — non-admins are auto-scoped to their `currentBranchId`
   * via `logistics_locations.branch_id`. Admins (and viewers without a
   * current branch) see all.
   */
  private async resolveBranchFilter(
    actor: SessionUser,
    currentBranchId: string | null,
    effectiveBranchIds?: string[] | null,
  ): Promise<{ branchId: string | null; effectiveBranchIds: string[] | null }> {
    if (isAdminLevel(actor)) return { branchId: null, effectiveBranchIds: null };
    if (currentBranchId) return { branchId: currentBranchId, effectiveBranchIds: null };
    if (effectiveBranchIds && effectiveBranchIds.length > 0) return { branchId: null, effectiveBranchIds };
    return { branchId: null, effectiveBranchIds: null };
  }

  /**
   * Validate that a logistics location belongs to the actor's branch
   * (admins bypass). Throws FORBIDDEN otherwise.
   *
   * `logistics_locations.branch_id` exists in the DB (migration 0041) but the
   * Drizzle schema in `logistics.ts` doesn't yet expose it as a typed column —
   * use raw SQL for the read until that drift is reconciled.
   */
  private async assertLocationInActorBranch(
    locationId: string,
    actor: SessionUser,
    currentBranchId: string | null,
  ): Promise<void> {
    if (isAdminLevel(actor) || !currentBranchId) return;
    const rows = await this.db.execute<{ branch_id: string | null }>(sql`
      SELECT branch_id FROM logistics_locations WHERE id = ${locationId} LIMIT 1
    `);
    const row = (rows as unknown as Array<{ branch_id: string | null }>)[0];
    if (!row) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Destination location not found.' });
    }
    if (row.branch_id && row.branch_id !== currentBranchId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Destination location is not in your active branch.',
      });
    }
  }

  // ============================================================
  // Reads
  // ============================================================

  async listShipments(
    input: ListShipmentsInput,
    actor: SessionUser,
    currentBranchId: string | null,
    effectiveBranchIds?: string[] | null,
    groupId?: string | null,
  ) {
    const baseConditions = [];
    if (input.destinationLocationId)
      baseConditions.push(eq(schema.shipments.destinationLocationId, input.destinationLocationId));
    if (input.search) {
      const q = `%${input.search}%`;
      baseConditions.push(
        or(
          ilike(schema.shipments.label, q),
          ilike(schema.shipments.supplierName, q),
          ilike(schema.shipments.supplierReference, q),
        ),
      );
    }
    if (input.fromDate) {
      baseConditions.push(gte(schema.shipments.createdAt, nigeriaDayStart(input.fromDate)));
    }
    if (input.toDate) {
      baseConditions.push(lte(schema.shipments.createdAt, nigeriaDayEnd(input.toDate)));
    }

    // Company-group isolation: scope through provider's group_id
    if (groupId) {
      baseConditions.push(
        sql<boolean>`EXISTS (
          SELECT 1 FROM logistics_locations ll
          JOIN logistics_providers lp ON lp.id = ll.provider_id
          WHERE ll.id = ${schema.shipments.destinationLocationId}
            AND lp.group_id = ${groupId}
        )`,
      );
    } else {
      // Legacy branch-level scoping for non-group setups
      const branchScope = await this.resolveBranchFilter(actor, currentBranchId, effectiveBranchIds);
      if (branchScope.branchId) {
        baseConditions.push(
          sql<boolean>`EXISTS (
            SELECT 1 FROM logistics_locations ll
            WHERE ll.id = ${schema.shipments.destinationLocationId}
              AND ll.branch_id = ${branchScope.branchId}
          )`,
        );
      } else if (branchScope.effectiveBranchIds && branchScope.effectiveBranchIds.length > 0) {
        const ids = branchScope.effectiveBranchIds;
        baseConditions.push(
          sql<boolean>`EXISTS (
            SELECT 1 FROM logistics_locations ll
            WHERE ll.id = ${schema.shipments.destinationLocationId}
              AND ll.branch_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
          )`,
        );
      }
    }

    const conditions = [...baseConditions];
    if (input.status) conditions.push(eq(schema.shipments.status, input.status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const summaryWhereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [rows, totalRows, summaryRows] = await Promise.all([
      this.db
        .select({
          id: schema.shipments.id,
          referenceNumber: schema.shipments.referenceNumber,
          label: schema.shipments.label,
          status: schema.shipments.status,
          destinationLocationId: schema.shipments.destinationLocationId,
          destinationLocationName: schema.logisticsLocations.name,
          supplierName: schema.shipments.supplierName,
          supplierReference: schema.shipments.supplierReference,
          expectedArrivalAt: schema.shipments.expectedArrivalAt,
          arrivedAt: schema.shipments.arrivedAt,
          verifiedAt: schema.shipments.verifiedAt,
          closedAt: schema.shipments.closedAt,
          totalLandingCost: schema.shipments.totalLandingCost,
          createdAt: schema.shipments.createdAt,
        })
        .from(schema.shipments)
        .leftJoin(
          schema.logisticsLocations,
          eq(schema.shipments.destinationLocationId, schema.logisticsLocations.id),
        )
        .where(whereClause)
        .orderBy(desc(schema.shipments.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.shipments)
        .where(whereClause),
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          created: sql<number>`count(*) filter (where ${schema.shipments.status} = 'CREATED')::int`,
          inTransit: sql<number>`count(*) filter (where ${schema.shipments.status} = 'IN_TRANSIT')::int`,
          arrived: sql<number>`count(*) filter (where ${schema.shipments.status} = 'ARRIVED')::int`,
          verified: sql<number>`count(*) filter (where ${schema.shipments.status} = 'VERIFIED')::int`,
          closed: sql<number>`count(*) filter (where ${schema.shipments.status} = 'CLOSED')::int`,
          cancelled: sql<number>`count(*) filter (where ${schema.shipments.status} = 'CANCELLED')::int`,
        })
        .from(schema.shipments)
        .where(summaryWhereClause),
    ]);

    // Pull line counts in one batch query so the list table can show "3 lines".
    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await this.db
          .select({
            shipmentId: schema.shipmentLines.shipmentId,
            lineCount: sql<number>`count(*)::int`,
            totalExpected: sql<number>`coalesce(sum(${schema.shipmentLines.expectedQuantity}), 0)::int`,
            totalReceived: sql<number>`coalesce(sum(${schema.shipmentLines.receivedQuantity}), 0)::int`,
          })
          .from(schema.shipmentLines)
          .where(inArray(schema.shipmentLines.shipmentId, ids))
          .groupBy(schema.shipmentLines.shipmentId)
      : [];
    const countsByShipment = new Map(
      counts.map((c) => [
        c.shipmentId,
        { lineCount: c.lineCount, totalExpected: c.totalExpected, totalReceived: c.totalReceived },
      ]),
    );

    const summary = summaryRows[0];

    return {
      rows: rows.map((row) => ({
        ...row,
        referenceLabel: ShipmentsService.formatReference(
          row.referenceNumber,
          row.createdAt instanceof Date ? row.createdAt.getFullYear() : new Date().getFullYear(),
        ),
        ...(countsByShipment.get(row.id) ?? { lineCount: 0, totalExpected: 0, totalReceived: 0 }),
      })),
      pagination: {
        page: input.page,
        limit: input.limit,
        total: Number(totalRows[0]?.count ?? 0),
        totalPages: Math.ceil(Number(totalRows[0]?.count ?? 0) / input.limit),
      },
      summary: {
        total: Number(summary?.total ?? 0),
        created: Number(summary?.created ?? 0),
        inTransit: Number(summary?.inTransit ?? 0),
        arrived: Number(summary?.arrived ?? 0),
        verified: Number(summary?.verified ?? 0),
        closed: Number(summary?.closed ?? 0),
        cancelled: Number(summary?.cancelled ?? 0),
      },
    };
  }

  async getShipment(shipmentId: string, actor: SessionUser, currentBranchId: string | null, effectiveBranchIds?: string[] | null) {
    const [row] = await this.db
      .select({
        id: schema.shipments.id,
        referenceNumber: schema.shipments.referenceNumber,
        label: schema.shipments.label,
        status: schema.shipments.status,
        destinationLocationId: schema.shipments.destinationLocationId,
        destinationLocationName: schema.logisticsLocations.name,
        // logistics_locations.branch_id exists in the DB (migration 0041) but
        // is not yet on the Drizzle schema — read raw and alias.
        destinationBranchId: sql<string | null>`${schema.logisticsLocations}.branch_id`,
        supplierName: schema.shipments.supplierName,
        supplierReference: schema.shipments.supplierReference,
        expectedArrivalAt: schema.shipments.expectedArrivalAt,
        arrivedAt: schema.shipments.arrivedAt,
        verifiedAt: schema.shipments.verifiedAt,
        closedAt: schema.shipments.closedAt,
        cancelledAt: schema.shipments.cancelledAt,
        totalLandingCost: schema.shipments.totalLandingCost,
        cancelledReason: schema.shipments.cancelledReason,
        verifiedBy: schema.shipments.verifiedBy,
        closedBy: schema.shipments.closedBy,
        cancelledBy: schema.shipments.cancelledBy,
        notes: schema.shipments.notes,
        createdAt: schema.shipments.createdAt,
        updatedAt: schema.shipments.updatedAt,
      })
      .from(schema.shipments)
      .leftJoin(
        schema.logisticsLocations,
        eq(schema.shipments.destinationLocationId, schema.logisticsLocations.id),
      )
      .where(eq(schema.shipments.id, shipmentId))
      .limit(1);

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found.' });
    }

    if (
      !isAdminLevel(actor) &&
      row.destinationBranchId &&
      (
        (currentBranchId && row.destinationBranchId !== currentBranchId) ||
        (!currentBranchId && effectiveBranchIds && effectiveBranchIds.length > 0 && !effectiveBranchIds.includes(row.destinationBranchId))
      )
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This shipment belongs to a different branch.',
      });
    }

    const lines = await this.db
      .select({
        id: schema.shipmentLines.id,
        productId: schema.shipmentLines.productId,
        productName: schema.products.name,
        expectedQuantity: schema.shipmentLines.expectedQuantity,
        receivedQuantity: schema.shipmentLines.receivedQuantity,
        factoryCost: schema.shipmentLines.factoryCost,
        allocatedLandingCost: schema.shipmentLines.allocatedLandingCost,
        batchId: schema.shipmentLines.batchId,
        varianceReason: schema.shipmentLines.varianceReason,
        createdAt: schema.shipmentLines.createdAt,
      })
      .from(schema.shipmentLines)
      .leftJoin(schema.products, eq(schema.shipmentLines.productId, schema.products.id))
      .where(eq(schema.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(schema.shipmentLines.createdAt));

    const batchIds = Array.from(
      new Set(lines.map((line) => line.batchId).filter((batchId): batchId is string => typeof batchId === 'string' && batchId.length > 0)),
    );


    const productIds = Array.from(new Set(lines.map((line) => line.productId)));

    // Batch remaining (shipment-scoped FIFO) + inventory levels across ALL locations for these products
    const [batchRows, allLevelRows] = await Promise.all([
      batchIds.length > 0
        ? this.db
            .select({
              id: schema.stockBatches.id,
              remainingQuantity: schema.stockBatches.remainingQuantity,
            })
            .from(schema.stockBatches)
            .where(inArray(schema.stockBatches.id, batchIds))
        : Promise.resolve([]),
      productIds.length > 0
        ? this.db
            .select({
              productId: schema.inventoryLevels.productId,
              locationId: schema.inventoryLevels.locationId,
              locationName: schema.logisticsLocations.name,
              stockCount: schema.inventoryLevels.stockCount,
              reservedCount: schema.inventoryLevels.reservedCount,
            })
            .from(schema.inventoryLevels)
            .innerJoin(
              schema.logisticsLocations,
              eq(schema.inventoryLevels.locationId, schema.logisticsLocations.id),
            )
            .where(inArray(schema.inventoryLevels.productId, productIds))
        : Promise.resolve([]),
    ]);

    const batchRemainingById = new Map(
      batchRows.map((batch) => [batch.id, Number(batch.remainingQuantity ?? 0)]),
    );

    // Build per-line reserved at destination warehouse
    const reservedByProductId = new Map<string, number>();
    for (const level of allLevelRows) {
      if (level.locationId === row.destinationLocationId) {
        reservedByProductId.set(level.productId, Number(level.reservedCount ?? 0));
      }
    }

    const linesWithStatus = lines.map((line) => {
      const receivedQuantity = line.receivedQuantity != null ? Number(line.receivedQuantity) : null;
      const batchRemaining =
        line.batchId && batchRemainingById.has(line.batchId)
          ? batchRemainingById.get(line.batchId) ?? 0
          : null;
      const currentReservedCount = line.batchId ? (reservedByProductId.get(line.productId) ?? 0) : null;
      return {
        ...line,
        batchRemainingQuantity: batchRemaining,
        consumedQuantity:
          receivedQuantity != null && batchRemaining != null
            ? Math.max(receivedQuantity - batchRemaining, 0)
            : null,
        currentReservedCount,
      };
    });

    const summary = linesWithStatus.reduce(
      (acc, line) => {
        const received = line.receivedQuantity != null ? Number(line.receivedQuantity) : 0;
        const remaining = line.batchRemainingQuantity ?? 0;
        const consumed = line.consumedQuantity ?? 0;
        const reserved = line.currentReservedCount ?? 0;
        if (line.batchId) acc.verifiedLineCount += 1;
        acc.totalReceived += received;
        acc.remainingFromShipment += remaining;
        acc.consumedFromShipment += consumed;
        acc.currentReserved += reserved;
        return acc;
      },
      {
        totalReceived: 0,
        remainingFromShipment: 0,
        consumedFromShipment: 0,
        currentReserved: 0,
        verifiedLineCount: 0,
      },
    );

    // Sold per location: DELIVERY movements for these products, grouped by from_location_id
    const soldRows = productIds.length > 0
      ? await this.db.execute<{ locationId: string; sold: number }>(sql`
          SELECT sm.from_location_id AS "locationId",
                 COALESCE(SUM(ABS(sm.quantity)), 0)::int AS "sold"
          FROM stock_movements sm
          WHERE sm.movement_type = 'DELIVERY'
            AND sm.product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
          GROUP BY sm.from_location_id
        `)
      : [];
    const soldByLocationId = new Map(soldRows.map((r) => [r.locationId, r.sold]));

    // Stock distribution: aggregate across all locations that hold these products
    type StockDistributionEntry = {
      locationId: string;
      locationName: string;
      isDestination: boolean;
      stock: number;
      reserved: number;
      available: number;
      sold: number;
    };
    const locationAgg = new Map<string, StockDistributionEntry>();
    for (const level of allLevelRows) {
      const stockCount = Number(level.stockCount ?? 0);
      const reservedCount = Number(level.reservedCount ?? 0);
      const existing = locationAgg.get(level.locationId);
      if (existing) {
        existing.stock += stockCount;
        existing.reserved += reservedCount;
        existing.available += Math.max(stockCount - reservedCount, 0);
      } else {
        locationAgg.set(level.locationId, {
          locationId: level.locationId,
          locationName: level.locationName,
          isDestination: level.locationId === row.destinationLocationId,
          stock: stockCount,
          reserved: reservedCount,
          available: Math.max(stockCount - reservedCount, 0),
          sold: soldByLocationId.get(level.locationId) ?? 0,
        });
      }
    }
    // Include locations that have sold everything (stock=0 but sold>0)
    for (const [locationId, sold] of soldByLocationId) {
      if (sold > 0 && !locationAgg.has(locationId)) {
        // Need location name — look up from allLevelRows or fallback
        const levelRow = allLevelRows.find((l) => l.locationId === locationId);
        if (levelRow) {
          locationAgg.set(locationId, {
            locationId,
            locationName: levelRow.locationName,
            isDestination: locationId === row.destinationLocationId,
            stock: 0,
            reserved: 0,
            available: 0,
            sold,
          });
        }
      }
    }
    const stockDistribution = Array.from(locationAgg.values()).sort((a, b) =>
      a.isDestination ? -1 : b.isDestination ? 1 : a.locationName.localeCompare(b.locationName),
    );

    return {
      shipment: {
        ...row,
        referenceLabel: ShipmentsService.formatReference(
          row.referenceNumber,
          row.createdAt instanceof Date ? row.createdAt.getFullYear() : new Date().getFullYear(),
        ),
      },
      lines: linesWithStatus,
      summary,
      stockDistribution,
      allowedTransitions: this.getAllowedTransitions({ status: row.status }, actor),
    };
  }

  // ============================================================
  // Writes — lifecycle
  // ============================================================

  async createShipment(input: CreateShipmentInput, actor: SessionUser) {
    if (!this.hasIntakePermission(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to create shipments.',
      });
    }
    await this.assertLocationInActorBranch(
      input.destinationLocationId,
      actor,
      actor.currentBranchId ?? null,
    );

    const arrivedNow = input.arrivedNow === true;
    const status: ShipmentStatus = arrivedNow ? 'ARRIVED' : 'CREATED';

    const created = await withActorAndBranch(this.db, actor, async (tx) => {
      const [parent] = await tx
        .insert(schema.shipments)
        .values({
          status,
          destinationLocationId: input.destinationLocationId,
          label: input.label?.trim() ? input.label.trim() : null,
          supplierName: input.supplierName?.trim() ? input.supplierName.trim() : null,
          supplierReference: input.supplierReference?.trim()
            ? input.supplierReference.trim()
            : null,
          expectedArrivalAt: input.expectedArrivalDate
            ? new Date(`${input.expectedArrivalDate}T12:00:00`)
            : null,
          arrivedAt: arrivedNow ? new Date() : null,
          totalLandingCost: sql`${input.totalLandingCost ?? 0}::numeric`,
          notes: input.notes?.trim() ? input.notes.trim() : null,
        })
        .returning();

      if (!parent) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create shipment' });
      }

      await tx.insert(schema.shipmentLines).values(
        input.lines.map((line) => ({
          shipmentId: parent.id,
          productId: line.productId,
          expectedQuantity: line.expectedQuantity,
          factoryCost: sql`${line.factoryCost ?? 0}::numeric`,
        })),
      );

      return parent;
    });

    this.events.emitToRoom('inventory', 'shipment:updated', { shipmentId: created.id });
    return created;
  }

  async updateShipmentLines(input: UpdateShipmentLinesInput, actor: SessionUser) {
    if (!this.hasIntakePermission(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to edit shipments.',
      });
    }

    const updated = await withActorAndBranch(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.shipments)
        .where(eq(schema.shipments.id, input.shipmentId))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found.' });
      }
      if (existing.status === 'VERIFIED' || existing.status === 'CLOSED' || existing.status === 'CANCELLED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            existing.status === 'CANCELLED'
              ? 'Cancelled shipments cannot be edited.'
              : 'Verified shipments cannot be edited.',
        });
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.label !== undefined) patch['label'] = input.label?.trim() || null;
      if (input.supplierName !== undefined)
        patch['supplierName'] = input.supplierName?.trim() || null;
      if (input.supplierReference !== undefined)
        patch['supplierReference'] = input.supplierReference?.trim() || null;
      if (input.expectedArrivalDate !== undefined) {
        patch['expectedArrivalAt'] = input.expectedArrivalDate
          ? new Date(`${input.expectedArrivalDate}T12:00:00`)
          : null;
      }
      if (input.notes !== undefined) patch['notes'] = input.notes?.trim() || null;
      if (input.totalLandingCost !== undefined) {
        patch['totalLandingCost'] = sql`${input.totalLandingCost}::numeric`;
      }

      const [parent] = await tx
        .update(schema.shipments)
        .set(patch)
        .where(eq(schema.shipments.id, input.shipmentId))
        .returning();

      if (input.lines && input.lines.length > 0) {
        await tx
          .delete(schema.shipmentLines)
          .where(eq(schema.shipmentLines.shipmentId, input.shipmentId));
        await tx.insert(schema.shipmentLines).values(
          input.lines.map((line) => ({
            shipmentId: input.shipmentId,
            productId: line.productId,
            expectedQuantity: line.expectedQuantity,
            factoryCost: sql`${line.factoryCost ?? 0}::numeric`,
          })),
        );
      }

      return parent!;
    });

    this.events.emitToRoom('inventory', 'shipment:updated', { shipmentId: input.shipmentId });
    return updated;
  }

  async markInTransit(input: ShipmentTransitionInput, actor: SessionUser) {
    if (!this.hasIntakePermission(actor)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No permission.' });
    }
    return withActorAndBranch(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.shipments)
        .where(eq(schema.shipments.id, input.shipmentId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found.' });
      if (existing.status !== 'CREATED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only CREATED shipments can be marked in transit.',
        });
      }
      const [updated] = await tx
        .update(schema.shipments)
        .set({ status: 'IN_TRANSIT', updatedAt: new Date() })
        .where(eq(schema.shipments.id, input.shipmentId))
        .returning();
      this.events.emitToRoom('inventory', 'shipment:updated', { shipmentId: input.shipmentId });
      return updated!;
    });
  }

  async markArrived(input: ShipmentTransitionInput, actor: SessionUser) {
    if (!this.hasIntakePermission(actor)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No permission.' });
    }
    return withActorAndBranch(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.shipments)
        .where(eq(schema.shipments.id, input.shipmentId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found.' });
      if (existing.status !== 'CREATED' && existing.status !== 'IN_TRANSIT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only CREATED or IN_TRANSIT shipments can be marked arrived.',
        });
      }
      const [updated] = await tx
        .update(schema.shipments)
        .set({
          status: 'ARRIVED',
          arrivedAt: existing.arrivedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.shipments.id, input.shipmentId))
        .returning();
      this.events.emitToRoom('inventory', 'shipment:updated', { shipmentId: input.shipmentId });
      return updated!;
    });
  }

  /**
   * Verify shipment receipt — the moment that actually creates inventory.
   *
   * For each line: validate the receipt, allocate landing cost, then in one
   * `withActorAndBranch` transaction insert `stock_batches`, upsert
   * `inventory_levels.stock_count`, and log an `INTAKE` `stock_movements` row
   * — exactly what the existing single-product `intake()` does, just batched.
   */
  async verifyShipment(input: VerifyShipmentInput, actor: SessionUser) {
    if (!this.hasVerifyPermission(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to verify shipments.',
      });
    }

    const result = await withActorAndBranch(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.shipments)
        .where(eq(schema.shipments.id, input.shipmentId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found.' });
      if (existing.status !== 'ARRIVED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            existing.status === 'VERIFIED' || existing.status === 'CLOSED'
              ? 'Shipment is already verified.'
              : 'Mark the shipment as ARRIVED before verifying receipts.',
        });
      }

      const dbLines = await tx
        .select()
        .from(schema.shipmentLines)
        .where(eq(schema.shipmentLines.shipmentId, input.shipmentId));

      // Every line on the shipment must be receipt-confirmed (qty + variance reason if mismatch).
      const receiptMap = new Map<string, ShipmentLineReceipt>(
        input.lines.map((r) => [r.lineId, r]),
      );

      const missingLines = dbLines.filter((l) => !receiptMap.has(l.id));
      if (missingLines.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Confirm received quantity for every line before verifying.',
        });
      }

      // Validate variance reasons.
      const enrichedLines: Array<{
        id: string;
        productId: string;
        receivedQuantity: number;
        factoryCost: string;
        varianceReason: string | null;
      }> = [];
      for (const line of dbLines) {
        const receipt = receiptMap.get(line.id)!;
        const received = receipt.receivedQuantity;
        if (received < 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Received quantity cannot be negative.',
          });
        }
        const matches = received === line.expectedQuantity;
        const reason = receipt.varianceReason?.trim() || null;
        if (!matches && !reason) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Provide a variance reason for the line where received qty (${received}) differs from expected (${line.expectedQuantity}).`,
          });
        }
        enrichedLines.push({
          id: line.id,
          productId: line.productId,
          receivedQuantity: received,
          factoryCost: line.factoryCost,
          varianceReason: matches ? null : reason,
        });
      }

      // Allocate landing cost across the lines that actually received goods.
      const totalLanding = parseFloat(existing.totalLandingCost ?? '0');
      const allocated = this.allocateLandingCost(
        enrichedLines.map((l) => ({
          id: l.id,
          receivedQuantity: l.receivedQuantity,
          factoryCost: l.factoryCost,
        })),
        Number.isFinite(totalLanding) ? totalLanding : 0,
      );

      // Per-line side effects — same shape as InventoryService.intake().
      const touchedLevels: Array<{ productId: string; locationId: string }> = [];
      for (const line of enrichedLines) {
        if (line.receivedQuantity <= 0) {
          // Still update the line so the audit trail records "0 received, reason X".
          await tx
            .update(schema.shipmentLines)
            .set({
              receivedQuantity: 0,
              allocatedLandingCost: sql`${allocated.get(line.id) ?? 0}::numeric`,
              varianceReason: line.varianceReason,
              updatedAt: new Date(),
            })
            .where(eq(schema.shipmentLines.id, line.id));
          continue;
        }

        const factoryCostNum = parseFloat(line.factoryCost) || 0;
        const lineLanding = allocated.get(line.id) ?? 0;
        const perUnitLanding =
          line.receivedQuantity > 0 ? lineLanding / line.receivedQuantity : 0;
        const totalLandedCostPerUnit = factoryCostNum + perUnitLanding;

        // 1) Create FIFO batch
        const [batch] = await tx
          .insert(schema.stockBatches)
          .values({
            productId: line.productId,
            factoryCost: sql`${factoryCostNum}::numeric`,
            landingCost: sql`${perUnitLanding}::numeric`,
            totalLandedCost: sql`${totalLandedCostPerUnit}::numeric`,
            quantity: line.receivedQuantity,
            remainingQuantity: line.receivedQuantity,
          })
          .returning();
        if (!batch) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create stock batch on verify.',
          });
        }

        // 2) Upsert inventory_levels for (product, destination) — mirrors intake()
        const [existingLevel] = await tx
          .select()
          .from(schema.inventoryLevels)
          .where(
            and(
              eq(schema.inventoryLevels.productId, line.productId),
              eq(schema.inventoryLevels.locationId, existing.destinationLocationId),
            ),
          )
          .limit(1);
        if (existingLevel) {
          await tx
            .update(schema.inventoryLevels)
            .set({
              stockCount: sql`${schema.inventoryLevels.stockCount} + ${line.receivedQuantity}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryLevels.id, existingLevel.id));
        } else {
          await tx.insert(schema.inventoryLevels).values({
            productId: line.productId,
            locationId: existing.destinationLocationId,
            batchId: batch.id,
            stockCount: line.receivedQuantity,
            reservedCount: 0,
            status: 'AVAILABLE',
          });
        }

        // 3) Log INTAKE movement
        await tx.insert(schema.stockMovements).values({
          productId: line.productId,
          movementType: 'INTAKE',
          quantity: line.receivedQuantity,
          toLocationId: existing.destinationLocationId,
          referenceId: line.id,
          reason: `Shipment receipt — ${line.receivedQuantity} units${
            line.varianceReason ? ` (variance: ${line.varianceReason})` : ''
          }`,
          actorId: actor.id,
        });

        // 4) Update the shipment line itself
        await tx
          .update(schema.shipmentLines)
          .set({
            receivedQuantity: line.receivedQuantity,
            allocatedLandingCost: sql`${lineLanding}::numeric`,
            batchId: batch.id,
            varianceReason: line.varianceReason,
            updatedAt: new Date(),
          })
          .where(eq(schema.shipmentLines.id, line.id));

        touchedLevels.push({
          productId: line.productId,
          locationId: existing.destinationLocationId,
        });
      }

      // 5) Stamp the parent
      await tx
        .update(schema.shipments)
        .set({
          status: 'VERIFIED',
          verifiedAt: new Date(),
          verifiedBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.shipments.id, input.shipmentId));

      return { touchedLevels };
    });

    // Post-tx: emit socket + low-stock check for each touched (product, location).
    this.events.emitToRoom('inventory', 'shipment:updated', { shipmentId: input.shipmentId });
    this.events.emitToRoom('inventory', 'stock:updated', { shipmentId: input.shipmentId });
    for (const tl of result.touchedLevels) {
      this.inventory.scheduleLowStockCheck(tl.productId, tl.locationId);
    }

    // Phase 4 — capitalise the stock intake to the ledger (Dr Stock In Hand /
    // Cr Creditors). Non-fatal + idempotent: a ledger issue must never undo a
    // verified receipt.
    try {
      const posted = await this.generalLedger.postPurchaseReceipt(input.shipmentId, actor);
      if (!posted.posted && posted.reason && posted.reason !== 'already-posted') {
        this.logger.warn(`Purchase GL not posted for shipment ${input.shipmentId}: ${posted.reason}`);
      }
    } catch (err) {
      this.logger.warn(`Purchase GL posting for shipment ${input.shipmentId} failed: ${err instanceof Error ? err.message : err}`);
    }

    return { success: true };
  }

  async closeShipment(input: ShipmentTransitionInput, actor: SessionUser) {
    if (!this.hasVerifyPermission(actor)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No permission to close shipments.' });
    }
    return withActorAndBranch(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.shipments)
        .where(eq(schema.shipments.id, input.shipmentId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found.' });
      if (existing.status !== 'VERIFIED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only VERIFIED shipments can be closed.',
        });
      }
      const [updated] = await tx
        .update(schema.shipments)
        .set({
          status: 'CLOSED',
          closedAt: new Date(),
          closedBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.shipments.id, input.shipmentId))
        .returning();
      this.events.emitToRoom('inventory', 'shipment:updated', { shipmentId: input.shipmentId });
      return updated!;
    });
  }

  async cancelShipment(input: CancelShipmentInput, actor: SessionUser) {
    if (!this.hasIntakePermission(actor)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No permission.' });
    }
    return withActorAndBranch(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.shipments)
        .where(eq(schema.shipments.id, input.shipmentId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found.' });
      if (existing.status === 'VERIFIED' || existing.status === 'CLOSED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot cancel a verified or closed shipment — its receipts are already in inventory.',
        });
      }
      if (existing.status === 'CANCELLED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Shipment is already cancelled.' });
      }
      const [updated] = await tx
        .update(schema.shipments)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: actor.id,
          cancelledReason: input.reason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(schema.shipments.id, input.shipmentId))
        .returning();
      this.events.emitToRoom('inventory', 'shipment:updated', { shipmentId: input.shipmentId });
      return updated!;
    });
  }
}
