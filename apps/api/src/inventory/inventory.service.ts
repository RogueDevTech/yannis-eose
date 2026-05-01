import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, or, asc, desc, count, sql, inArray } from 'drizzle-orm';
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
import { SettingsService } from '../settings/settings.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { withActor, withActorAndBranch } from '../common/db/with-actor';
import { isMissingRelationError } from '../common/db/missing-relation';

/** Virtual buffer: show 10% less stock to prevent overselling during bursts */
const VIRTUAL_BUFFER_RATIO = 0.10;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /** Default low-stock threshold used when the setting row is missing or malformed. */
  private static readonly DEFAULT_LOW_STOCK_THRESHOLD = 10;
  private static readonly LOW_STOCK_DEDUP_HOURS = 6;

  /**
   * Fire in-app + push notifications to stock-aware admins when available stock at
   * (productId, locationId) drops below the configured threshold after a reduction.
   *
   * Rate-limited: at most one notification per (productId, locationId) per 6 hours,
   * deduped against the notifications table by type and data payload.
   */
  async checkLowStockAndNotify(productId: string, locationId: string): Promise<void> {
    try {
      const cfg = await this.settings.get('INVENTORY_LOW_STOCK_CONFIG');
      const thresholdRaw = (cfg?.['threshold'] as number | string | undefined) ?? InventoryService.DEFAULT_LOW_STOCK_THRESHOLD;
      const threshold = typeof thresholdRaw === 'string' ? parseInt(thresholdRaw, 10) : thresholdRaw;
      if (!Number.isFinite(threshold) || threshold <= 0) return;

      const [level] = await this.db
        .select({
          stockCount: schema.inventoryLevels.stockCount,
          reservedCount: schema.inventoryLevels.reservedCount,
        })
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, productId),
            eq(schema.inventoryLevels.locationId, locationId),
          ),
        )
        .limit(1);
      if (!level) return;

      const available = level.stockCount - level.reservedCount;
      if (available >= threshold) return;

      // Dedup: skip if we already notified about this (productId, locationId) recently.
      const sinceIso = new Date(Date.now() - InventoryService.LOW_STOCK_DEDUP_HOURS * 3_600_000).toISOString();
      const recent = await this.db.execute<{ id: string }>(sql`
        SELECT id
        FROM notifications
        WHERE type = 'inventory:low_stock'
          AND data->>'productId' = ${productId}
          AND data->>'locationId' = ${locationId}
          AND created_at >= ${sinceIso}
        LIMIT 1
      `);
      if (recent.length > 0) return;

      // Lookup product + location names for a friendly body.
      const [productRow] = await this.db
        .select({ name: schema.products.name })
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1);
      const [locationRow] = await this.db
        .select({ name: schema.logisticsLocations.name })
        .from(schema.logisticsLocations)
        .where(eq(schema.logisticsLocations.id, locationId))
        .limit(1);
      const productName = productRow?.name ?? 'Unknown product';
      const locationName = locationRow?.name ?? 'Unknown location';

      const body = `Only ${available} unit${available === 1 ? '' : 's'} of ${productName} left at ${locationName} (threshold ${threshold}). Time to restock.`;
      const payload = {
        type: 'inventory:low_stock' as const,
        title: 'Low stock alert',
        body,
        data: { productId, locationId, available, threshold },
      };

      // Target roles that can actually act on low stock.
      for (const role of ['SUPER_ADMIN', 'ADMIN', 'STOCK_MANAGER'] as const) {
        await this.notifications.createForRole(role, payload).catch(() => {});
      }
    } catch {
      // Notifications are best-effort — never break a stock mutation because of them.
    }
  }

  // ============================================
  // Stock Intake — FIFO Batch Creation
  // ============================================

  /**
   * Receive stock into a location as a new FIFO batch.
   * Creates a stock_batch, updates inventory_levels, logs the movement.
   */
  async intake(input: StockIntakeInput, actor: SessionUser) {
    const totalLandedCost = input.factoryCost + input.landingCost;
    const reasonUnitCost = totalLandedCost.toFixed(2);

    try {
      // Branch context is set alongside the actor because `inventory_levels` is
      // branch-scoped (RLS in migration 0042). Without `yannis.current_branch_id`,
      // the existing-row UPDATE branch can fail policy checks when the user has
      // a branch selected but the row's `branch_id` doesn't match.
      const batch = await withActorAndBranch(this.db, actor, async (tx) => {
        // Create the FIFO batch. Numeric fields are explicitly cast to avoid trigger/history
        // failures where numeric values can degrade to text through dynamic SQL paths.
        const batchRows = await tx
          .insert(schema.stockBatches)
          .values({
            productId: input.productId,
            factoryCost: sql`${input.factoryCost}::numeric`,
            landingCost: sql`${input.landingCost}::numeric`,
            totalLandedCost: sql`${totalLandedCost}::numeric`,
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
          reason: `Stock intake: ${input.quantity} units at ${reasonUnitCost}/unit landed cost`,
          actorId: actor.id,
        });

        return createdBatch;
      });

      this.events.emitToRoom('inventory', 'stock:updated', {
        productId: input.productId,
        locationId: input.locationId,
      });

      return batch;
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }

      // Always log the underlying error with full context — without this, we get
      // "Unexpected Server Error" on the client and zero clue server-side.
      const dbError = error as { code?: string; message?: string; detail?: string };
      this.logger.error(
        `intake failed actor=${actor.id} branch=${actor.currentBranchId ?? 'none'} product=${input.productId} location=${input.locationId} pgcode=${dbError.code ?? 'none'} msg=${dbError.message ?? '(no message)'} detail=${dbError.detail ?? ''}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (dbError.code === '23503') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid product or location selected for stock intake.',
        });
      }

      if (dbError.code === '22P02' || dbError.code === '23514') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid stock intake values. Please check quantity and costs.',
        });
      }

      // RLS policy violation — almost always means the row's branch_id doesn't
      // match the actor's current branch. Surface a helpful message instead of
      // the generic "Unexpected Server Error".
      if (dbError.code === '42501') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'Stock intake blocked by branch isolation. Switch to the location\'s branch (or All branches) and retry.',
        });
      }

      // Bubble the actual underlying message up so the user can act on it. The
      // catch-all used to swallow this and return "Failed to complete stock
      // intake." which was indistinguishable from any other failure.
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: dbError.message
          ? `Stock intake failed: ${dbError.message}`
          : 'Stock intake failed. Check API logs for details.',
      });
    }
  }

  // ============================================
  // Stock Transfer — Warehouse to 3PL
  // ============================================

  /**
   * Initiate a stock transfer between locations.
   * Deducts from source immediately and records transfer as IN_TRANSIT.
   * Destination stock is credited only when Logistics verifies receipt.
   */
  async initiateTransfer(input: StockTransferInput, actor: SessionUser) {
    const now = new Date();
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
            updatedAt: now,
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

      const transferRows = await tx
        .insert(schema.stockTransfers)
        .values({
          productId: input.productId,
          quantitySent: input.quantity,
          quantityReceived: null,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          transferStatus: 'IN_TRANSIT',
          transferCost: transferCostTotal > 0 ? transferCostTotal.toFixed(2) : null,
          verifiedAt: null,
        })
        .returning();

      const newTransfer = transferRows[0];
      if (!newTransfer) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create transfer' });
      }

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
      completed: false,
    });

    await this.checkLowStockAndNotify(input.productId, input.fromLocationId);

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

    const approvedQuantity = Math.max(0, input.quantityReceived);
    const disputedQuantity = Math.max(0, transfer.quantitySent - approvedQuantity);

    // Update transfer record
    await tx
      .update(schema.stockTransfers)
      .set({
        quantityReceived: approvedQuantity,
        transferStatus: hasShrinkage ? 'DISPUTED' : 'RECEIVED',
        shrinkageReason: input.shrinkageReason ?? null,
        receiverNotes: input.receiverNotes ?? null,
        verifiedAt: new Date(),
      })
      .where(eq(schema.stockTransfers.id, input.transferId));

    const outcomeRows: Array<{
      transferId: string;
      status: 'APPROVED' | 'DISPUTED';
      quantity: number;
      reason?: string | null;
      recordedBy: string;
    }> = [];
    if (approvedQuantity > 0) {
      outcomeRows.push({
        transferId: transfer.id,
        status: 'APPROVED',
        quantity: approvedQuantity,
        recordedBy: actor.id,
      });
    }
    if (disputedQuantity > 0) {
      outcomeRows.push({
        transferId: transfer.id,
        status: 'DISPUTED',
        quantity: disputedQuantity,
        reason: input.shrinkageReason ?? null,
        recordedBy: actor.id,
      });
    }
    if (outcomeRows.length > 0) {
      await tx.insert(schema.stockTransferOutcomes).values(outcomeRows);
    }

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
    if (approvedQuantity > 0) {
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
            stockCount: sql`${schema.inventoryLevels.stockCount} + ${approvedQuantity}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryLevels.id, destLevel[0].id));
      } else {
        await tx
          .insert(schema.inventoryLevels)
          .values({
            productId: transfer.productId,
            locationId: transfer.toLocationId,
            stockCount: approvedQuantity,
            reservedCount: 0,
            status: 'AVAILABLE',
          });
      }

      // Log movement: IN to destination
      await tx.insert(schema.stockMovements).values({
        productId: transfer.productId,
        movementType: 'TRANSFER_IN',
        quantity: approvedQuantity,
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
        received: approvedQuantity,
        shrinkage: shrinkageQty,
        reason: input.shrinkageReason,
      });
    }

    return { success: true, hasShrinkage };
   });
  }

  /**
   * Cancel a stock transfer that was created in error.
   *
   * Adds the originally-sent quantity back to the source location, deducts the
   * received quantity from the destination, and flips the transfer row to
   * CANCELLED. Also writes two reversal movements (RETURN out of destination,
   * INTAKE-style return into source) so the audit trail explains the swing.
   *
   * Hard rules:
   *  - The transfer must not already be CANCELLED.
   *  - Destination must currently have at least the received quantity available
   *    (`stockCount - reservedCount`). If not, units have been allocated/shipped
   *    and cancelling would break inventory accounting — the user must do a
   *    Stock Adjustment instead.
   */
  async cancelTransfer(input: { transferId: string; reason?: string | null }, actor: SessionUser) {
    return withActorAndBranch(this.db, actor, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.stockTransfers)
        .where(eq(schema.stockTransfers.id, input.transferId))
        .limit(1);
      const transfer = rows[0];
      if (!transfer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Transfer not found' });
      }
      if (transfer.transferStatus === 'CANCELLED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Transfer is already cancelled' });
      }

      const receivedQty = transfer.quantityReceived ?? 0;
      const sentQty = transfer.quantitySent;

      // Refuse if destination can't give the units back. We use available
      // (stock - reserved) to avoid yanking units that are already on a CS-
      // confirmed order.
      if (receivedQty > 0) {
        const destRows = await tx
          .select()
          .from(schema.inventoryLevels)
          .where(
            and(
              eq(schema.inventoryLevels.productId, transfer.productId),
              eq(schema.inventoryLevels.locationId, transfer.toLocationId),
            ),
          )
          .limit(1);
        const dest = destRows[0];
        const destAvailable = (dest?.stockCount ?? 0) - (dest?.reservedCount ?? 0);
        if (!dest || destAvailable < receivedQty) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot cancel — destination only has ${Math.max(0, destAvailable)} unit(s) free, but ${receivedQty} were sent there. Use a Stock Adjustment instead.`,
          });
        }
      }

      const now = new Date();

      // 1. Deduct from destination (reverse the credit)
      if (receivedQty > 0) {
        await tx
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} - ${receivedQty}`,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.inventoryLevels.productId, transfer.productId),
              eq(schema.inventoryLevels.locationId, transfer.toLocationId),
            ),
          );
        await tx.insert(schema.stockMovements).values({
          productId: transfer.productId,
          movementType: 'TRANSFER_OUT',
          quantity: receivedQty,
          fromLocationId: transfer.toLocationId,
          toLocationId: transfer.fromLocationId,
          referenceId: transfer.id,
          reason: input.reason
            ? `Transfer cancelled: ${input.reason}`
            : 'Transfer cancelled',
          actorId: actor.id,
        });
      }

      // 2. Add back to source (reverse the debit). We restore the originally
      // sent quantity, not the received quantity — the source lost `sentQty`
      // when the transfer was initiated, so that's what comes back.
      const sourceRows = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, transfer.productId),
            eq(schema.inventoryLevels.locationId, transfer.fromLocationId),
          ),
        )
        .limit(1);
      if (sourceRows[0]) {
        await tx
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} + ${sentQty}`,
            updatedAt: now,
          })
          .where(eq(schema.inventoryLevels.id, sourceRows[0].id));
      } else {
        await tx.insert(schema.inventoryLevels).values({
          productId: transfer.productId,
          locationId: transfer.fromLocationId,
          stockCount: sentQty,
          reservedCount: 0,
          status: 'AVAILABLE',
        });
      }
      await tx.insert(schema.stockMovements).values({
        productId: transfer.productId,
        movementType: 'TRANSFER_IN',
        quantity: sentQty,
        fromLocationId: transfer.toLocationId,
        toLocationId: transfer.fromLocationId,
        referenceId: transfer.id,
        reason: input.reason
          ? `Transfer cancelled: ${input.reason}`
          : 'Transfer cancelled',
        actorId: actor.id,
      });

      // 3. Mark the transfer row CANCELLED. We tuck the cancellation reason
      // into shrinkage_reason since stock_transfers doesn't have a dedicated
      // field — UI labels it correctly based on transferStatus.
      await tx
        .update(schema.stockTransfers)
        .set({
          transferStatus: 'CANCELLED',
          shrinkageReason: input.reason?.trim() ? input.reason.trim() : transfer.shrinkageReason,
        })
        .where(eq(schema.stockTransfers.id, input.transferId));

      this.events.emitToRoom('inventory', 'transfer:cancelled', {
        transferId: transfer.id,
        productId: transfer.productId,
      });

      return { success: true };
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
    }).then(async (result) => {
      // Fire low-stock alert only on net reductions. Fire-and-forget; never blocks the mutation.
      if (input.adjustmentQuantity < 0) {
        await this.checkLowStockAndNotify(input.productId, input.locationId);
      }
      return result;
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
    if (input.search) {
      // Substring match against the product name. Subquery keeps the outer query simple
      // (no JOIN rewrite) while still letting Postgres use the products(name) index.
      conditions.push(
        sql`${schema.inventoryLevels.productId} IN (SELECT id FROM products WHERE name ILIKE ${'%' + input.search + '%'})`,
      );
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

    const transfers = await this.db
      .select()
      .from(schema.stockTransfers)
      .where(whereClause)
      .orderBy(desc(schema.stockTransfers.createdAt))
      .limit(50);

    if (transfers.length === 0) return transfers;

    const transferIds = transfers.map((t) => t.id);
    const senderRows = await this.db
      .select({
        transferId: schema.stockMovements.referenceId,
        senderName: schema.users.name,
      })
      .from(schema.stockMovements)
      .innerJoin(schema.users, eq(schema.users.id, schema.stockMovements.actorId))
      .where(
        and(
          eq(schema.stockMovements.movementType, 'TRANSFER_OUT'),
          inArray(schema.stockMovements.referenceId, transferIds),
        ),
      );

    const senderByTransferId = new Map<string, string>();
    for (const row of senderRows) {
      if (!row.transferId || !row.senderName || senderByTransferId.has(row.transferId)) continue;
      senderByTransferId.set(row.transferId, row.senderName);
    }

    let outcomeRows: Array<{
      transferId: string;
      outcomeStatus: 'APPROVED' | 'DISPUTED';
      outcomeQuantity: number;
      outcomeReason: string | null;
      outcomeRecordedAt: Date;
    }> = [];
    if (transferIds.length > 0) {
      try {
        outcomeRows = await this.db
          .select({
            transferId: schema.stockTransferOutcomes.transferId,
            outcomeStatus: schema.stockTransferOutcomes.status,
            outcomeQuantity: schema.stockTransferOutcomes.quantity,
            outcomeReason: schema.stockTransferOutcomes.reason,
            outcomeRecordedAt: schema.stockTransferOutcomes.recordedAt,
          })
          .from(schema.stockTransferOutcomes)
          .where(inArray(schema.stockTransferOutcomes.transferId, transferIds))
          .orderBy(desc(schema.stockTransferOutcomes.recordedAt));
      } catch (err) {
        if (!isMissingRelationError(err, 'stock_transfer_outcomes')) throw err;
        // Fallback to transfer-level status fields if the outcomes split table is absent.
        outcomeRows = [];
      }
    }

    const outcomesByTransfer = new Map<string, typeof outcomeRows>();
    for (const row of outcomeRows) {
      const bucket = outcomesByTransfer.get(row.transferId) ?? [];
      bucket.push(row);
      outcomesByTransfer.set(row.transferId, bucket);
    }

    const mapped = transfers.flatMap((transfer) => {
      const senderName = senderByTransferId.get(transfer.id) ?? null;
      const outcomes = outcomesByTransfer.get(transfer.id) ?? [];
      if (outcomes.length === 0) {
        return [
          {
            ...transfer,
            senderName,
            outcomeStatus: transfer.transferStatus === 'RECEIVED' ? 'APPROVED' : transfer.transferStatus,
            outcomeQuantity: transfer.quantityReceived,
            outcomeReason: transfer.shrinkageReason,
          },
        ];
      }
      return outcomes.map((outcome) => ({
        ...transfer,
        senderName,
        outcomeStatus: outcome.outcomeStatus,
        outcomeQuantity: outcome.outcomeQuantity,
        outcomeReason: outcome.outcomeReason,
      }));
    });

    if (!status) return mapped;
    if (status === 'RECEIVED') {
      return mapped.filter((row) => row.outcomeStatus === 'APPROVED');
    }
    if (status === 'DISPUTED') {
      return mapped.filter((row) => row.outcomeStatus === 'DISPUTED');
    }
    return mapped.filter((row) => row.transferStatus === status);
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
  /**
   * Return all inventory levels where (stockCount - reservedCount) < configured threshold.
   * Drives the low-stock banner on the inventory page. Joined with product + location names.
   */
  async getLowStockAlerts() {
    const cfg = await this.settings.get('INVENTORY_LOW_STOCK_CONFIG');
    const thresholdRaw = (cfg?.['threshold'] as number | string | undefined) ?? InventoryService.DEFAULT_LOW_STOCK_THRESHOLD;
    const threshold = typeof thresholdRaw === 'string' ? parseInt(thresholdRaw, 10) : thresholdRaw;
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return { threshold: 0, items: [] };
    }

    const rows = await this.db
      .select({
        levelId: schema.inventoryLevels.id,
        productId: schema.inventoryLevels.productId,
        locationId: schema.inventoryLevels.locationId,
        stockCount: schema.inventoryLevels.stockCount,
        reservedCount: schema.inventoryLevels.reservedCount,
        productName: schema.products.name,
        locationName: schema.logisticsLocations.name,
      })
      .from(schema.inventoryLevels)
      .leftJoin(schema.products, eq(schema.inventoryLevels.productId, schema.products.id))
      .leftJoin(
        schema.logisticsLocations,
        eq(schema.inventoryLevels.locationId, schema.logisticsLocations.id),
      )
      .where(
        sql`(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}) < ${threshold}`,
      )
      .orderBy(
        sql`(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}) ASC`,
      )
      .limit(50);

    return {
      threshold,
      items: rows.map((r) => ({
        levelId: r.levelId,
        productId: r.productId,
        productName: r.productName ?? 'Unknown product',
        locationId: r.locationId,
        locationName: r.locationName ?? 'Unknown location',
        stockCount: r.stockCount,
        reservedCount: r.reservedCount,
        availableCount: r.stockCount - r.reservedCount,
      })),
    };
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

  // ── Order lifecycle inventory integrity (global + per-location) ─────────────

  private async loadAggregatedOrderLineQuantities(orderId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        productId: schema.orderItems.productId,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    const byProduct = new Map<string, number>();
    for (const row of rows) {
      byProduct.set(row.productId, (byProduct.get(row.productId) ?? 0) + row.quantity);
    }
    return byProduct;
  }

  /**
   * CONFIRMED gate: total (stock − reserved) across all locations and FIFO batch
   * remaining must cover every product on the order.
   */
  async assertGlobalAvailabilityForOrder(orderId: string): Promise<void> {
    const byProduct = await this.loadAggregatedOrderLineQuantities(orderId);
    if (byProduct.size === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order has no line items to confirm against inventory.' });
    }

    for (const [productId, need] of byProduct) {
      const levels = await this.db
        .select()
        .from(schema.inventoryLevels)
        .where(eq(schema.inventoryLevels.productId, productId));
      const shelfAvailable = levels.reduce((sum, l) => sum + (l.stockCount - l.reservedCount), 0);
      if (shelfAvailable < need) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot confirm: insufficient sellable shelf stock for this order (need ${need}, have ${shelfAvailable} across locations).`,
        });
      }

      const batches = await this.db
        .select({ remaining: schema.stockBatches.remainingQuantity })
        .from(schema.stockBatches)
        .where(eq(schema.stockBatches.productId, productId));
      const fifoAvailable = batches.reduce((sum, b) => sum + (b.remaining ?? 0), 0);
      if (fifoAvailable < need) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot confirm: insufficient FIFO batch remaining for a product on this order (need ${need}, have ${fifoAvailable}).`,
        });
      }
    }
  }

  /**
   * ALLOCATED gate: each line must fit in unreserved stock at the chosen 3PL location.
   */
  async assertLocationCanFulfillOrder(orderId: string, locationId: string): Promise<void> {
    const byProduct = await this.loadAggregatedOrderLineQuantities(orderId);
    if (byProduct.size === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order has no line items to allocate.' });
    }

    for (const [productId, need] of byProduct) {
      const rows = await this.db
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, productId),
            eq(schema.inventoryLevels.locationId, locationId),
          ),
        )
        .limit(1);
      const level = rows[0];
      if (!level) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This 3PL location has no inventory row for a product on the order. Receive stock (intake or verified transfer) before allocating.',
        });
      }
      const avail = level.stockCount - level.reservedCount;
      if (avail < need) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Insufficient stock at the selected location for this order (available ${avail}, need ${need} for one SKU).`,
        });
      }
    }
  }

  /**
   * ALLOCATED side effect: bump reserved_count at the 3PL and append ALLOCATION movements in one transaction.
   */
  async reserveForAllocateWithMovements(orderId: string, locationId: string, actor: SessionUser): Promise<void> {
    const byProduct = await this.loadAggregatedOrderLineQuantities(orderId);
    if (byProduct.size === 0) return;

    await withActor(this.db, actor, async (tx) => {
      for (const [productId, qty] of byProduct) {
        const rows = await tx
          .select()
          .from(schema.inventoryLevels)
          .where(
            and(
              eq(schema.inventoryLevels.productId, productId),
              eq(schema.inventoryLevels.locationId, locationId),
            ),
          )
          .limit(1);
        const level = rows[0];
        if (!level) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Inventory row disappeared between validation and reservation.',
          });
        }
        const avail = level.stockCount - level.reservedCount;
        if (avail < qty) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Stock changed while allocating — not enough free units left at this location.',
          });
        }
        await tx
          .update(schema.inventoryLevels)
          .set({
            reservedCount: sql`${schema.inventoryLevels.reservedCount} + ${qty}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryLevels.id, level.id));

        await tx.insert(schema.stockMovements).values({
          productId,
          movementType: 'ALLOCATION',
          quantity: qty,
          toLocationId: locationId,
          referenceId: orderId,
          reason: `Allocated to 3PL for order ${orderId}`,
          actorId: actor.id,
        });
      }
    });
  }

  /**
   * DELIVERED: consume FIFO batches, decrement shelf + reserved at the fulfillment location,
   * and append DELIVERY movements — one atomic transaction with actor attribution.
   */
  async completeDeliveryInventory(
    orderId: string,
    logisticsLocationId: string,
    actor: SessionUser,
  ): Promise<void> {
    const byProduct = await this.loadAggregatedOrderLineQuantities(orderId);
    if (byProduct.size === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order has no line items for delivery.' });
    }

    await withActor(this.db, actor, async (tx) => {
      for (const [productId, lineQty] of byProduct) {
        const batches = await tx
          .select()
          .from(schema.stockBatches)
          .where(eq(schema.stockBatches.productId, productId))
          .orderBy(asc(schema.stockBatches.receivedAt));

        let remaining = lineQty;
        for (const batch of batches) {
          if (remaining <= 0) break;
          const batchRemaining = batch.remainingQuantity ?? 0;
          if (batchRemaining <= 0) continue;
          const deduct = Math.min(remaining, batchRemaining);
          await tx
            .update(schema.stockBatches)
            .set({ remainingQuantity: batchRemaining - deduct })
            .where(eq(schema.stockBatches.id, batch.id));
          remaining -= deduct;
        }
        if (remaining > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot record delivery: insufficient FIFO batch remaining for a product on this order.',
          });
        }

        await tx.insert(schema.stockMovements).values({
          productId,
          movementType: 'DELIVERY',
          quantity: -lineQty,
          fromLocationId: logisticsLocationId,
          referenceId: orderId,
          reason: `Delivered: order ${orderId}`,
          actorId: actor.id,
        });

        const levelRows = await tx
          .select()
          .from(schema.inventoryLevels)
          .where(
            and(
              eq(schema.inventoryLevels.productId, productId),
              eq(schema.inventoryLevels.locationId, logisticsLocationId),
            ),
          )
          .limit(1);
        const level = levelRows[0];
        if (!level) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Cannot record delivery: no inventory level at the fulfillment location for a product on this order.',
          });
        }
        if (level.stockCount < lineQty) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot record delivery: shelf count at location is below shipped quantity.',
          });
        }
        const reservedRelease = Math.min(level.reservedCount, lineQty);
        await tx
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} - ${lineQty}`,
            reservedCount: sql`${schema.inventoryLevels.reservedCount} - ${reservedRelease}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryLevels.id, level.id));
      }
    });

    for (const productId of byProduct.keys()) {
      await this.checkLowStockAndNotify(productId, logisticsLocationId);
    }
  }
}
