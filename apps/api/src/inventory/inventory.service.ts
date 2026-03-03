import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
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
import { DRIZZLE, PG_CLIENT } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

/** Virtual buffer: show 10% less stock to prevent overselling during bursts */
const VIRTUAL_BUFFER_RATIO = 0.10;

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
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
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const totalLandedCost = (input.factoryCost + input.landingCost).toFixed(2);

    // Create the FIFO batch
    const batchRows = await this.db
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

    const batch = batchRows[0];
    if (!batch) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create stock batch' });
    }

    // Upsert inventory level at the location
    const existingLevel = await this.db
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
      await this.db
        .update(schema.inventoryLevels)
        .set({
          stockCount: sql`${schema.inventoryLevels.stockCount} + ${input.quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.inventoryLevels.id, existingLevel[0].id));
    } else {
      await this.db
        .insert(schema.inventoryLevels)
        .values({
          productId: input.productId,
          locationId: input.locationId,
          batchId: batch.id,
          stockCount: input.quantity,
          reservedCount: 0,
          status: 'AVAILABLE',
        });
    }

    // Log the movement
    await this.db.insert(schema.stockMovements).values({
      productId: input.productId,
      movementType: 'INTAKE',
      quantity: input.quantity,
      toLocationId: input.locationId,
      referenceId: batch.id,
      reason: `Stock intake: ${input.quantity} units at ${totalLandedCost}/unit landed cost`,
      actorId: actor.id,
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
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    // Check source has enough stock
    const sourceLevel = await this.db
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
      await this.db
        .update(schema.inventoryLevels)
        .set({
          stockCount: sql`${schema.inventoryLevels.stockCount} - ${input.quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.inventoryLevels.id, sourceLevel[0].id));
    }

    // Calculate transfer cost from FIFO batch costing
    const costBatches = await this.db
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
    const transferRows = await this.db
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

    const transfer = transferRows[0];
    if (!transfer) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create transfer' });
    }

    // Log movement: OUT from source
    await this.db.insert(schema.stockMovements).values({
      productId: input.productId,
      movementType: 'TRANSFER_OUT',
      quantity: input.quantity,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      referenceId: transfer.id,
      actorId: actor.id,
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
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const transferRows = await this.db
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
    await this.db
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
      const destLevel = await this.db
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
        await this.db
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} + ${input.quantityReceived}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryLevels.id, destLevel[0].id));
      } else {
        await this.db
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
      await this.db.insert(schema.stockMovements).values({
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
  }

  // ============================================
  // Stock Adjustment — Manual Correction
  // ============================================

  async adjust(input: StockAdjustmentInput, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const levelRows = await this.db
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

    await this.db
      .update(schema.inventoryLevels)
      .set({ stockCount: newCount, updatedAt: new Date() })
      .where(eq(schema.inventoryLevels.id, level.id));

    await this.db.insert(schema.stockMovements).values({
      productId: input.productId,
      movementType: 'ADJUSTMENT',
      quantity: input.adjustmentQuantity,
      fromLocationId: input.adjustmentQuantity < 0 ? input.locationId : undefined,
      toLocationId: input.adjustmentQuantity > 0 ? input.locationId : undefined,
      reason: input.reason,
      actorId: actor.id,
    });

    return { stockCount: newCount };
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

    const [levels, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.inventoryLevels)
        .where(whereClause)
        .orderBy(desc(schema.inventoryLevels.updatedAt))
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
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    // Get the current digital count
    const levelRows = await this.db
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

    const rows = await this.db
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
      await this.db
        .update(schema.logisticsLocations)
        .set({ dispatchLocked: true })
        .where(eq(schema.logisticsLocations.id, input.locationId));

      this.events.emitToRoom('alerts', 'ghost-stock:detected', {
        reconciliationId: reconciliation.id,
        locationId: input.locationId,
        productId: input.productId,
        digitalCount,
        physicalCount: input.physicalCount,
        discrepancy,
        reasonCode: input.reasonCode,
      });
    }

    return reconciliation;
  }

  /**
   * Resolve a reconciliation — approve adjusts stock, reject keeps current.
   * Unlocks dispatch at the location.
   */
  async resolveReconciliation(input: ResolveReconciliationInput, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const rows = await this.db
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
      const levelRows = await this.db
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
        await this.db
          .update(schema.inventoryLevels)
          .set({
            stockCount: reconciliation.physicalCount,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryLevels.id, levelRows[0].id));
      }

      // Log adjustment movement
      await this.db.insert(schema.stockMovements).values({
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
    await this.db
      .update(schema.stockReconciliations)
      .set({
        reconciliationStatus: input.approved ? 'APPROVED' : 'REJECTED',
        approvedBy: actor.id,
        resolvedAt: new Date(),
      })
      .where(eq(schema.stockReconciliations.id, input.reconciliationId));

    // Check if there are other pending reconciliations for this location
    const pendingRows = await this.db
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
      await this.db
        .update(schema.logisticsLocations)
        .set({ dispatchLocked: false })
        .where(eq(schema.logisticsLocations.id, reconciliation.locationId));
    }

    return { success: true, dispatchUnlocked: pendingCount === 0 };
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
