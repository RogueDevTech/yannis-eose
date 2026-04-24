import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, or, asc, desc, count, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  StockIntakeInput,
  StockTransferInput,
  VerifyTransferInput,
  StockAdjustmentInput,
  ListInventoryInput,
  ListMovementsInput,
  CreateReconciliationInput,
  ResolveReconciliationInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { withActor } from '../common/db/with-actor';

/** Virtual buffer: show 10% less stock to prevent overselling during bursts */
const VIRTUAL_BUFFER_RATIO = 0.10;

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================
  // Stock Intake — FIFO Batch Creation
  // ============================================

  /**
   * Receive stock into a location as a new FIFO batch.
   * Creates a stock_batch, updates inventory_levels, logs the movement.
   */
  async intake(input: StockIntakeInput, actor: SessionUser) {
    const totalLandedCost = (input.factoryCost + input.landingCost).toFixed(2);

    // All writes wrapped in a single transaction with SET LOCAL yannis.current_user_id so the
    // temporal-history triggers can attribute every row to the actor. A bare
    // `pgClient\`SELECT set_config(..., true)\`` on a 5-connection pool does NOT persist across
    // the follow-up drizzle queries (they land on different pooled connections), which is why
    // stock movements were showing "System" as the actor in the audit trail.
    const batch = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL yannis.current_user_id = ${actor.id}`);

      // Create the FIFO batch
      const batchRows = await tx
        .insert(schema.stockBatches)
        .values({
          productId: input.productId,
          factoryCost: String(input.factoryCost),
          landingCost: String(input.landingCost),
          totalLandedCost,
          quantity: input.quantity,
          remainingQuantity: input.quantity,
        })
        .returning();

      const createdBatch = batchRows[0];
      if (!createdBatch) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create stock batch' });
      }

      // Upsert inventory level at the location
      const existingLevel = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, input.productId),
            eq(schema.inventoryLevels.locationId, input.locationId),
          ),
        )
        .limit(1);

      if (existingLevel[0]) {
        await tx
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} + ${input.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryLevels.id, existingLevel[0].id));
      } else {
        await tx
          .insert(schema.inventoryLevels)
          .values({
            productId: input.productId,
            locationId: input.locationId,
            batchId: createdBatch.id,
            stockCount: input.quantity,
            reservedCount: 0,
            status: 'AVAILABLE',
          });
      }

      // Log the movement
      await tx.insert(schema.stockMovements).values({
        productId: input.productId,
        movementType: 'INTAKE',
        quantity: input.quantity,
        toLocationId: input.locationId,
        referenceId: createdBatch.id,
        reason: `Stock intake: ${input.quantity} units at ${totalLandedCost}/unit landed cost`,
        actorId: actor.id,
      });

      return createdBatch;
    });

    this.events.emitToRoom('inventory', 'stock:updated', {
      productId: input.productId,
      locationId: input.locationId,
    });

    return batch;
  }

  // ============================================
  // Stock Transfer — Warehouse to 3PL
  // ============================================

  /**
   * Initiate a stock transfer between locations.
   * Dual-Entry: stock is IN_TRANSIT until 3PL confirms receipt.
   */
  async initiateTransfer(input: StockTransferInput, actor: SessionUser) {
    const transfer = await withActor(this.db, actor, async (tx) => {
      // Check source has enough stock
      const sourceLevel = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, input.productId),
            eq(schema.inventoryLevels.locationId, input.fromLocationId),
          ),
        )
        .limit(1);

      const available = (sourceLevel[0]?.stockCount ?? 0) - (sourceLevel[0]?.reservedCount ?? 0);
      if (available < input.quantity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Insufficient stock. Available: ${available}, Requested: ${input.quantity}`,
        });
      }

      // Deduct from source
      if (sourceLevel[0]) {
        await tx
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} - ${input.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryLevels.id, sourceLevel[0].id));
      }

      // Calculate transfer cost from FIFO batch costing
      const costBatches = await tx
        .select()
        .from(schema.stockBatches)
        .where(eq(schema.stockBatches.productId, input.productId))
        .orderBy(schema.stockBatches.receivedAt);

      let transferCostTotal = 0;
      let costRemaining = input.quantity;
      for (const batch of costBatches) {
        if (costRemaining <= 0) break;
        const batchRemaining = batch.remainingQuantity ?? 0;
        if (batchRemaining <= 0) continue;

        const units = Math.min(costRemaining, batchRemaining);
        const costPerUnit = parseFloat(batch.totalLandedCost ?? '0');
        transferCostTotal += units * costPerUnit;
        costRemaining -= units;
      }

      // Create transfer record with computed transfer cost
      const transferRows = await tx
        .insert(schema.stockTransfers)
        .values({
          productId: input.productId,
          quantitySent: input.quantity,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          transferStatus: 'IN_TRANSIT',
          transferCost: transferCostTotal > 0 ? transferCostTotal.toFixed(2) : null,
        })
        .returning();

      const newTransfer = transferRows[0];
      if (!newTransfer) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create transfer' });
      }

      // Log movement: OUT from source
      await tx.insert(schema.stockMovements).values({
        productId: input.productId,
        movementType: 'TRANSFER_OUT',
        quantity: input.quantity,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        referenceId: newTransfer.id,
        actorId: actor.id,
      });

      return newTransfer;
    });

    this.events.emitToRoom('inventory', 'transfer:created', {
      transferId: transfer.id,
      productId: input.productId,
    });

    // Notify TPL at receiving location
    this.notifications
      .createForLocation(input.toLocationId, {
        type: 'transfer:sent',
        title: 'Stock transfer incoming',
        body: `A stock transfer is on the way to your location. Please verify and receive when it arrives.`,
        data: { transferId: transfer.id, productId: input.productId, quantity: input.quantity },
      })
      .catch(() => {});

    return transfer;
  }

  /**
   * 3PL manager verifies receipt of a transfer.
   * If received < sent, auto-generates a Shrinkage Alert.
   */
  async verifyTransfer(input: VerifyTransferInput, actor: SessionUser) {
   return withActor(this.db, actor, async (tx) => {
    const transferRows = await tx
      .select()
      .from(schema.stockTransfers)
      .where(eq(schema.stockTransfers.id, input.transferId))
      .limit(1);

    const transfer = transferRows[0];
    if (!transfer) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Transfer not found' });
    }

    if (transfer.transferStatus !== 'IN_TRANSIT') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Transfer is ${transfer.transferStatus}, cannot verify`,
      });
    }

    const hasShrinkage = input.quantityReceived < transfer.quantitySent;

    // Update transfer record
    await tx
      .update(schema.stockTransfers)
      .set({
        quantityReceived: input.quantityReceived,
        transferStatus: hasShrinkage ? 'DISPUTED' : 'RECEIVED',
        shrinkageReason: input.shrinkageReason ?? null,
        verifiedAt: new Date(),
      })
      .where(eq(schema.stockTransfers.id, input.transferId));

    // Shrinkage alert: notify SuperAdmin and Head of Logistics
    if (hasShrinkage) {
      const shortage = transfer.quantitySent - input.quantityReceived;
      this.notifications
        .createForRole('SUPER_ADMIN', {
          type: 'logistics:shrinkage',
          title: 'Stock shrinkage alert',
          body: `Transfer received with shortage: ${shortage} unit(s) missing. Requires investigation.`,
          data: { transferId: transfer.id, productId: transfer.productId, shortage },
        })
        .catch(() => {});
      this.notifications
        .createForRole('HEAD_OF_LOGISTICS', {
          type: 'logistics:shrinkage',
          title: 'Stock shrinkage alert',
          body: `Transfer received with shortage: ${shortage} unit(s) missing. Requires investigation.`,
          data: { transferId: transfer.id, productId: transfer.productId, shortage },
        })
        .catch(() => {});
    }

    // Add stock to destination location
    if (input.quantityReceived > 0) {
      const destLevel = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, transfer.productId),
            eq(schema.inventoryLevels.locationId, transfer.toLocationId),
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
        await tx
          .insert(schema.inventoryLevels)
          .values({
            productId: transfer.productId,
            locationId: transfer.toLocationId,
            stockCount: input.quantityReceived,
            reservedCount: 0,
            status: 'AVAILABLE',
          });
      }

      // Log movement: IN to destination
      await tx.insert(schema.stockMovements).values({
        productId: transfer.productId,
        movementType: 'TRANSFER_IN',
        quantity: input.quantityReceived,
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        referenceId: transfer.id,
        actorId: actor.id,
      });
    }

    // If shrinkage, emit alert to CEO & Head of Logistics
    if (hasShrinkage) {
      const shrinkageQty = transfer.quantitySent - input.quantityReceived;
      this.events.emitToRoom('alerts', 'shrinkage:detected', {
        transferId: transfer.id,
        productId: transfer.productId,
        sent: transfer.quantitySent,
        received: input.quantityReceived,
        shrinkage: shrinkageQty,
        reason: input.shrinkageReason,
      });
    }

    return { success: true, hasShrinkage };
   });
  }

  // ============================================
  // Stock Adjustment — Manual Correction
  // ============================================

  async adjust(input: StockAdjustmentInput, actor: SessionUser) {
    return withActor(this.db, actor, async (tx) => {
      const levelRows = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, input.productId),
            eq(schema.inventoryLevels.locationId, input.locationId),
          ),
        )
        .limit(1);

      const level = levelRows[0];
      if (!level) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No inventory record found for this product at this location',
        });
      }

      const newCount = level.stockCount + input.adjustmentQuantity;
      if (newCount < 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Adjustment would result in negative stock (current: ${level.stockCount})`,
        });
      }

      await tx
        .update(schema.inventoryLevels)
        .set({ stockCount: newCount, updatedAt: new Date() })
        .where(eq(schema.inventoryLevels.id, level.id));

      await tx.insert(schema.stockMovements).values({
        productId: input.productId,
        movementType: 'ADJUSTMENT',
        quantity: input.adjustmentQuantity,
        fromLocationId: input.adjustmentQuantity < 0 ? input.locationId : undefined,
        toLocationId: input.adjustmentQuantity > 0 ? input.locationId : undefined,
        reason: input.reason,
        actorId: actor.id,
      });

      return { stockCount: newCount };
    });
  }

  // ============================================
  // Queries
  // ============================================

  /**
   * Get inventory levels with optional product/location filters.
   * Applies the virtual buffer for sales-facing queries.
   */
  async listLevels(input: ListInventoryInput) {
    const conditions = [];

    if (input.productId) {
      conditions.push(eq(schema.inventoryLevels.productId, input.productId));
    }
    if (input.locationId) {
      conditions.push(eq(schema.inventoryLevels.locationId, input.locationId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    // Build ORDER BY based on sortBy + sortOrder. `available` sorts by (stock_count - reserved_count)
    // so low-stock SKUs surface naturally when viewing "lowest available first".
    const direction = input.sortOrder === 'asc' ? asc : desc;
    const orderBy =
      input.sortBy === 'available'
        ? input.sortOrder === 'asc'
          ? sql`(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}) ASC`
          : sql`(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}) DESC`
        : direction(schema.inventoryLevels.updatedAt);

    const [levels, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.inventoryLevels)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.inventoryLevels)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return {
      levels,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Detail payload for a single inventory row by its inventory_levels.id.
   * Convenience wrapper around `levelDetail` that also resolves product/location names
   * so a full-page view only needs one round-trip.
   */
  async getLevelById(id: string, limit = 200) {
    const rows = await this.db.execute<{
      id: string;
      productId: string;
      productName: string | null;
      locationId: string;
      locationName: string | null;
      stockCount: number;
      reservedCount: number;
      status: string;
      updatedAt: Date;
    }>(sql`
      SELECT
        il.id,
        il.product_id          AS "productId",
        p.name                 AS "productName",
        il.location_id         AS "locationId",
        loc.name               AS "locationName",
        il.stock_count         AS "stockCount",
        il.reserved_count      AS "reservedCount",
        il.status::text        AS "status",
        il.updated_at          AS "updatedAt"
      FROM inventory_levels il
      LEFT JOIN products p ON p.id = il.product_id
      LEFT JOIN logistics_locations loc ON loc.id = il.location_id
      WHERE il.id = ${id}
      LIMIT 1
    `);

    const level = rows[0];
    if (!level) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory level not found' });
    }

    const detail = await this.levelDetail(level.productId, level.locationId, limit);

    return {
      level,
      batches: detail.batches,
      movements: detail.movements,
      total: detail.total,
    };
  }

  /**
   * Detail view for a single (productId, locationId) inventory level.
   *
   * Returns:
   *  - `batches`: stock_batches that had an INTAKE at this location, newest first, with
   *    factoryCost / landingCost / totalLandedCost / quantity / remainingQuantity.
   *  - `movements`: the complete audit trail affecting stock at this location, newest first.
   *    Matches rows where `fromLocationId = X` OR `toLocationId = X` OR the row references
   *    an order whose `logisticsLocationId = X` (rescues historical DELIVERY / RETURN /
   *    WRITE_OFF rows that were written before location fields were stamped).
   */
  async levelDetail(productId: string, locationId: string, limit = 100) {
    // Batches: any stock_batch that was intaken at this location.
    const batches = await this.db.execute<{
      id: string;
      factoryCost: string;
      landingCost: string;
      totalLandedCost: string;
      quantity: number;
      remainingQuantity: number;
      receivedAt: Date;
    }>(sql`
      SELECT DISTINCT ON (sb.id)
        sb.id,
        sb.factory_cost       AS "factoryCost",
        sb.landing_cost       AS "landingCost",
        sb.total_landed_cost  AS "totalLandedCost",
        sb.quantity,
        sb.remaining_quantity AS "remainingQuantity",
        sb.received_at        AS "receivedAt"
      FROM stock_batches sb
      INNER JOIN stock_movements sm
        ON sm.reference_id = sb.id
        AND sm.movement_type = 'INTAKE'
        AND sm.to_location_id = ${locationId}
      WHERE sb.product_id = ${productId}
      ORDER BY sb.id, sb.received_at DESC
    `);

    // Movements: fromLocation or toLocation match, OR the movement references an order
    // at this location (rescues legacy rows without location stamping).
    const movements = await this.db.execute<{
      id: string;
      productId: string;
      movementType: string;
      quantity: number;
      fromLocationId: string | null;
      toLocationId: string | null;
      referenceId: string | null;
      reason: string | null;
      actorId: string | null;
      createdAt: Date;
    }>(sql`
      SELECT
        sm.id,
        sm.product_id        AS "productId",
        sm.movement_type     AS "movementType",
        sm.quantity,
        sm.from_location_id  AS "fromLocationId",
        sm.to_location_id    AS "toLocationId",
        sm.reference_id      AS "referenceId",
        sm.reason,
        sm.actor_id          AS "actorId",
        sm.created_at        AS "createdAt"
      FROM stock_movements sm
      LEFT JOIN orders o ON o.id = sm.reference_id
      WHERE sm.product_id = ${productId}
        AND (
          sm.from_location_id = ${locationId}
          OR sm.to_location_id = ${locationId}
          OR o.logistics_location_id = ${locationId}
        )
      ORDER BY sm.created_at DESC
      LIMIT ${limit}
    `);

    return {
      batches,
      movements,
      total: movements.length,
    };
  }

  /**
   * Get stock movements log.
   */
  async listMovements(input: ListMovementsInput) {
    const conditions = [];

    if (input.productId) {
      conditions.push(eq(schema.stockMovements.productId, input.productId));
    }
    if (input.actorId) {
      conditions.push(eq(schema.stockMovements.actorId, input.actorId));
    }
    if (input.movementType) {
      conditions.push(eq(schema.stockMovements.movementType, input.movementType));
    }
    if (input.locationId) {
      conditions.push(
        or(
          eq(schema.stockMovements.fromLocationId, input.locationId),
          eq(schema.stockMovements.toLocationId, input.locationId),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [movements, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.stockMovements)
        .where(whereClause)
        .orderBy(desc(schema.stockMovements.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.stockMovements)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return {
      movements,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Get pending transfers.
   */
  async listTransfers(status?: string) {
    const conditions = [];
    if (status) {
      conditions.push(eq(schema.stockTransfers.transferStatus, status as 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'DISPUTED'));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return this.db
      .select()
      .from(schema.stockTransfers)
      .where(whereClause)
      .orderBy(desc(schema.stockTransfers.createdAt))
      .limit(50);
  }

  /**
   * Get available stock for a product across all locations.
   * Applies the virtual buffer (10% less for oversell protection).
   */
  async getAvailableStock(productId: string) {
    const levels = await this.db
      .select()
      .from(schema.inventoryLevels)
      .where(eq(schema.inventoryLevels.productId, productId));

    const totalStock = levels.reduce((sum, l) => sum + l.stockCount, 0);
    const totalReserved = levels.reduce((sum, l) => sum + l.reservedCount, 0);
    const available = totalStock - totalReserved;
    const virtualAvailable = Math.floor(available * (1 - VIRTUAL_BUFFER_RATIO));

    return {
      totalStock,
      totalReserved,
      available,
      virtualAvailable,
      byLocation: levels.map((l) => ({
        locationId: l.locationId,
        stockCount: l.stockCount,
        reservedCount: l.reservedCount,
        available: l.stockCount - l.reservedCount,
      })),
    };
  }

  /**
   * Get products that are below their minimum threshold.
   * TODO: re-implement once min_threshold is stored elsewhere (e.g. inventory settings).
   */
  async getLowStockAlerts() {
    return [];
  }

  // ============================================
  // Returns Queue — orders in RETURNED status
  // ============================================

  /**
   * List orders in RETURNED status at a specific location (or all).
   */
  async listReturnedOrders(locationId?: string) {
    const conditions = [eq(schema.orders.status, 'RETURNED')];
    if (locationId) {
      conditions.push(eq(schema.orders.logisticsLocationId, locationId));
    }

    return this.db
      .select()
      .from(schema.orders)
      .where(and(...conditions))
      .orderBy(desc(schema.orders.updatedAt))
      .limit(100);
  }

  // ============================================
  // Stock Reconciliation — Ghost Stock Prevention
  // ============================================

  /**
   * Submit a stock reconciliation report.
   * If physical count !== digital count, locks dispatch at that location.
   */
  async createReconciliation(input: CreateReconciliationInput, actor: SessionUser) {
    const result = await withActor(this.db, actor, async (tx) => {
      // Get the current digital count
      const levelRows = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, input.productId),
            eq(schema.inventoryLevels.locationId, input.locationId),
          ),
        )
        .limit(1);

      const digitalCount = levelRows[0]?.stockCount ?? 0;
      const discrepancy = input.physicalCount - digitalCount;

      const rows = await tx
        .insert(schema.stockReconciliations)
        .values({
          locationId: input.locationId,
          productId: input.productId,
          digitalCount,
          physicalCount: input.physicalCount,
          discrepancy,
          reasonCode: input.reasonCode,
          notes: input.notes ?? null,
          submittedBy: actor.id,
        })
        .returning();

      const reconciliation = rows[0];
      if (!reconciliation) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create reconciliation' });
      }

      // If there's a discrepancy, lock dispatch at this location
      if (discrepancy !== 0) {
        await tx
          .update(schema.logisticsLocations)
          .set({ dispatchLocked: true })
          .where(eq(schema.logisticsLocations.id, input.locationId));
      }

      return { reconciliation, discrepancy, digitalCount };
    });

    if (result.discrepancy !== 0) {
      this.events.emitToRoom('alerts', 'ghost-stock:detected', {
        reconciliationId: result.reconciliation.id,
        locationId: input.locationId,
        productId: input.productId,
        digitalCount: result.digitalCount,
        physicalCount: input.physicalCount,
        discrepancy: result.discrepancy,
        reasonCode: input.reasonCode,
      });
    }

    return result.reconciliation;
  }

  /**
   * Resolve a reconciliation — approve adjusts stock, reject keeps current.
   * Unlocks dispatch at the location.
   */
  async resolveReconciliation(input: ResolveReconciliationInput, actor: SessionUser) {
    return withActor(this.db, actor, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.stockReconciliations)
        .where(eq(schema.stockReconciliations.id, input.reconciliationId))
        .limit(1);

      const reconciliation = rows[0];
      if (!reconciliation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation not found' });
      }

      if (reconciliation.reconciliationStatus !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reconciliation already resolved' });
      }

      if (input.approved) {
        // Adjust inventory to match physical count
        const levelRows = await tx
          .select()
          .from(schema.inventoryLevels)
          .where(
            and(
              eq(schema.inventoryLevels.productId, reconciliation.productId),
              eq(schema.inventoryLevels.locationId, reconciliation.locationId),
            ),
          )
          .limit(1);

        if (levelRows[0]) {
          await tx
            .update(schema.inventoryLevels)
            .set({
              stockCount: reconciliation.physicalCount,
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryLevels.id, levelRows[0].id));
        }

        // Log adjustment movement
        await tx.insert(schema.stockMovements).values({
          productId: reconciliation.productId,
          movementType: 'ADJUSTMENT',
          quantity: reconciliation.discrepancy,
          fromLocationId: reconciliation.discrepancy < 0 ? reconciliation.locationId : undefined,
          toLocationId: reconciliation.discrepancy > 0 ? reconciliation.locationId : undefined,
          referenceId: reconciliation.id,
          reason: `Stock reconciliation: ${reconciliation.reasonCode}. ${reconciliation.notes ?? ''}`.trim(),
          actorId: actor.id,
        });
      }

      // Update reconciliation status
      await tx
        .update(schema.stockReconciliations)
        .set({
          reconciliationStatus: input.approved ? 'APPROVED' : 'REJECTED',
          approvedBy: actor.id,
          resolvedAt: new Date(),
        })
        .where(eq(schema.stockReconciliations.id, input.reconciliationId));

      // Check if there are other pending reconciliations for this location
      const pendingRows = await tx
        .select({ count: count() })
        .from(schema.stockReconciliations)
        .where(
          and(
            eq(schema.stockReconciliations.locationId, reconciliation.locationId),
            eq(schema.stockReconciliations.reconciliationStatus, 'PENDING'),
          ),
        );

      const pendingCount = pendingRows[0]?.count ?? 0;

      // Unlock dispatch if no more pending reconciliations
      if (pendingCount === 0) {
        await tx
          .update(schema.logisticsLocations)
          .set({ dispatchLocked: false })
          .where(eq(schema.logisticsLocations.id, reconciliation.locationId));
      }

      return { success: true, dispatchUnlocked: pendingCount === 0 };
    });
  }

  /**
   * List reconciliation records for a location.
   */
  async listReconciliations(locationId?: string) {
    const conditions = [];
    if (locationId) {
      conditions.push(eq(schema.stockReconciliations.locationId, locationId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return this.db
      .select()
      .from(schema.stockReconciliations)
      .where(whereClause)
      .orderBy(desc(schema.stockReconciliations.createdAt))
      .limit(50);
  }

  /**
   * Check if dispatch is locked at a location.
   */
  async isDispatchLocked(locationId: string) {
    const rows = await this.db
      .select({ dispatchLocked: schema.logisticsLocations.dispatchLocked })
      .from(schema.logisticsLocations)
      .where(eq(schema.logisticsLocations.id, locationId))
      .limit(1);

    return rows[0]?.dispatchLocked ?? false;
  }
}
