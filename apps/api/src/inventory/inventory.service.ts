import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, or, asc, desc, count, sql, inArray, gt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  StockIntakeInput,
  StockTransferInput,
  StockTransferBatchInput,
  VerifyTransferInput,
  ApproveTransferInput,
  RejectTransferInput,
  StockAdjustmentInput,
  ListInventoryInput,
  ListMovementsInput,
  CreateReconciliationInput,
  ResolveReconciliationInput,
} from '@yannis/shared';

/** Transaction executor from `withActor` / `.transaction` — matches FIFO paging helpers. */
type InventoryDbTx = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

/** Result of creating a single transfer line — drives the post-commit side effects. */
type TransferLineResult = {
  transfer: typeof schema.stockTransfers.$inferSelect;
  requiresApproval: boolean;
  sourceProviderKind: 'WAREHOUSE' | 'THIRD_PARTY' | null;
  sourceLocationName: string;
};
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevel } from '../common/authz';
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
  private static readonly DEFAULT_LOW_STOCK_THRESHOLD = 100;
  private static readonly LOW_STOCK_DEDUP_HOURS = 6;

  /**
   * Cached check for migration 0143 (`logistics_locations.low_stock_threshold`).
   * `null` = not yet checked, `true` = column exists, `false` = column missing.
   * Re-checked on each app restart.
   */
  private hasLocationThresholdCol: boolean | null = null;
  private async locationThresholdColExists(): Promise<boolean> {
    if (this.hasLocationThresholdCol !== null) return this.hasLocationThresholdCol;
    try {
      await this.db.execute(sql`SELECT low_stock_threshold FROM logistics_locations LIMIT 0`);
      this.hasLocationThresholdCol = true;
    } catch {
      this.hasLocationThresholdCol = false;
    }
    return this.hasLocationThresholdCol;
  }
  private static readonly FIFO_BATCH_PAGE_SIZE = 256;

  /**
   * Org-wide low-stock threshold from `system_settings.INVENTORY_LOW_STOCK_CONFIG`.
   * Falls back to {@link DEFAULT_LOW_STOCK_THRESHOLD} when the row is missing or
   * malformed. A configured `0` is honoured (it means "global alerts off") —
   * per-location overrides can still fire independently.
   */
  private async getGlobalLowStockThreshold(): Promise<number> {
    const cfg = await this.settings.get('INVENTORY_LOW_STOCK_CONFIG');
    const raw =
      (cfg?.['threshold'] as number | string | undefined) ??
      InventoryService.DEFAULT_LOW_STOCK_THRESHOLD;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
    return typeof n === 'number' && Number.isFinite(n)
      ? n
      : InventoryService.DEFAULT_LOW_STOCK_THRESHOLD;
  }

  /**
   * Fire in-app + push notifications to stock-aware admins when available stock at
   * (productId, locationId) drops below the EFFECTIVE threshold after a reduction.
   * Effective threshold = the location's own `low_stock_threshold` if set,
   * otherwise the org-wide threshold.
   *
   * Rate-limited: at most one notification per (productId, locationId) per 6 hours,
   * deduped against the notifications table by type and data payload.
   */
  async checkLowStockAndNotify(productId: string, locationId: string): Promise<void> {
    try {
      const globalThreshold = await this.getGlobalLowStockThreshold();

      const hasLocCol = await this.locationThresholdColExists();

      const [row] = await this.db
        .select({
          stockCount: schema.inventoryLevels.stockCount,
          reservedCount: schema.inventoryLevels.reservedCount,
          locationName: schema.logisticsLocations.name,
          // Company-group of the owning provider — stamped on the notification
          // so the feed's group-isolation filter can scope it correctly.
          groupId: schema.logisticsProviders.groupId,
          ...(hasLocCol ? { locationThreshold: schema.logisticsLocations.lowStockThreshold } : {}),
        })
        .from(schema.inventoryLevels)
        .leftJoin(
          schema.logisticsLocations,
          eq(schema.logisticsLocations.id, schema.inventoryLevels.locationId),
        )
        .leftJoin(
          schema.logisticsProviders,
          eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
        )
        .where(
          and(
            eq(schema.inventoryLevels.productId, productId),
            eq(schema.inventoryLevels.locationId, locationId),
          ),
        )
        .limit(1);
      if (!row) return;

      // Per-location override wins; null inherits the org-wide threshold.
      const threshold = (row as { locationThreshold?: number | null }).locationThreshold ?? globalThreshold;
      if (!Number.isFinite(threshold) || threshold <= 0) return;

      const available = row.stockCount - row.reservedCount;
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

      // Lookup product name for a friendly body (location name came back above).
      const [productRow] = await this.db
        .select({ name: schema.products.name })
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1);
      const productName = productRow?.name ?? 'Unknown product';
      const locationName = row.locationName ?? 'Unknown location';

      const body = `Only ${available} unit${available === 1 ? '' : 's'} of ${productName} left at ${locationName} (threshold ${threshold}). Time to restock.`;
      const payload = {
        type: 'inventory:low_stock' as const,
        title: 'Low stock alert',
        body,
        data: { productId, locationId, available, threshold, groupId: row.groupId ?? null },
      };

      const roles = ['SUPER_ADMIN', 'ADMIN', 'STOCK_MANAGER'] as const;
      for (const role of roles) {
        this.notifications.enqueueCreateForRole(role, payload);
      }
    } catch {
      // Notifications are best-effort — never break a stock mutation because of them.
    }
  }

  /**
   * Deferred low-stock check — does not block the caller or extend mutation latency.
   * Fan-out notifications run after inventory rows are stable.
   */
  scheduleLowStockCheck(productId: string, locationId: string): void {
    void this.checkLowStockAndNotify(productId, locationId).catch((err: unknown) => {
      this.logger.warn(
        `Deferred low-stock check failed — product=${productId} location=${locationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  // ============================================
  // FIFO — paged batches (remaining > 0, received_at,id)
  // ============================================

  /**
   * Next window of active FIFO batches. Always reads from the head (`remaining > 0`, oldest first)
   * so partial consumption of the last row on a page cannot skip remaining units (keyset cursors would).
   */
  private async fifoActiveBatchPage(
    tx: InventoryDbTx,
    productId: string,
  ): Promise<Array<typeof schema.stockBatches.$inferSelect>> {
    return tx
      .select()
      .from(schema.stockBatches)
      .where(and(eq(schema.stockBatches.productId, productId), gt(schema.stockBatches.remainingQuantity, 0)))
      .orderBy(asc(schema.stockBatches.receivedAt), asc(schema.stockBatches.id))
      .limit(InventoryService.FIFO_BATCH_PAGE_SIZE);
  }

  /**
   * FIFO landed cost for exactly `quantity` units — read-only simulation (CONFIRMED order, transfer costing).
   * Same per-unit arithmetic as legacy `parseFloat(batch.totalLandedCost)`.
   */
  async computeFifoLandedCostForQuantityInTx(
    tx: InventoryDbTx,
    productId: string,
    quantityNeeded: number,
  ): Promise<number> {
    if (quantityNeeded <= 0) return 0;
    let costTotal = 0;
    let costRemaining = quantityNeeded;

    while (costRemaining > 0) {
      const page = await this.fifoActiveBatchPage(tx, productId);
      if (page.length === 0) break;

      for (const batch of page) {
        if (costRemaining <= 0) break;
        const batchRemaining = batch.remainingQuantity ?? 0;
        const units = Math.min(costRemaining, batchRemaining);
        const costPerUnit = parseFloat(batch.totalLandedCost ?? '0');
        costTotal += units * costPerUnit;
        costRemaining -= units;
      }
    }

    return costTotal;
  }

  /** Apply FIFO decrement for delivery — updates `remaining_quantity`. */
  private async consumeFifoRemainingInTx(
    tx: InventoryDbTx,
    productId: string,
    quantityNeeded: number,
    errorInsufficientMessage: string,
  ): Promise<void> {
    if (quantityNeeded <= 0) return;
    let remaining = quantityNeeded;

    while (remaining > 0) {
      const page = await this.fifoActiveBatchPage(tx, productId);
      if (page.length === 0) break;

      for (const batch of page) {
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
    }

    if (remaining > 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: errorInsufficientMessage });
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
   * Resolve the source location's `(providerKind, providerId, locationName)` so
   * `canApproveSourceTransfer` can decide if the actor is the source authority.
   */
  private async getSourceLocationInfo(
    tx: InventoryDbTx,
    locationId: string,
  ): Promise<{ providerKind: 'WAREHOUSE' | 'THIRD_PARTY' | null; providerId: string | null; locationName: string }> {
    const rows = await tx
      .select({
        locationName: schema.logisticsLocations.name,
        providerId: schema.logisticsLocations.providerId,
        providerKind: schema.logisticsProviders.kind,
      })
      .from(schema.logisticsLocations)
      .leftJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(eq(schema.logisticsLocations.id, locationId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Source location not found' });
    }
    return {
      providerKind: (row.providerKind as 'WAREHOUSE' | 'THIRD_PARTY' | null) ?? null,
      providerId: row.providerId ?? null,
      locationName: row.locationName ?? 'source',
    };
  }

  /**
   * Source-authority rule (role-based, no per-location manager assignment yet).
   *
   * | Source provider kind | Actors who skip approval (source authority)                                 |
   * | -------------------- | --------------------------------------------------------------------------- |
   * | WAREHOUSE            | STOCK_MANAGER, BRANCH_ADMIN, SUPER_ADMIN, ADMIN                             |
   * | THIRD_PARTY          | TPL_MANAGER, HEAD_OF_LOGISTICS, SUPER_ADMIN, ADMIN                          |
   *
   * HEAD_OF_LOGISTICS does NOT skip approval for WAREHOUSE sources — that's the
   * whole point of the gate. Stock managers must consciously sign off on stock
   * leaving the warehouse.
   */
  private canApproveSourceTransfer(
    actor: SessionUser,
    _providerKind: 'WAREHOUSE' | 'THIRD_PARTY' | null,
  ): boolean {
    if (isAdminLevel(actor)) return true;
    // Stock Manager + Head of Logistics go straight to RECEIVED — no approval
    // bottleneck. HoL manages agent-to-agent movements and notifies management
    // but doesn't wait for human approval (CEO directive 2026-05-25).
    return actor.role === 'STOCK_MANAGER' || actor.role === 'HEAD_OF_LOGISTICS';
  }

  /**
   * Roles to fan-out the "transfer pending approval" notification to.
   * Mirrors `canApproveSourceTransfer` minus admin-class (admins get notified
   * about everything via their broad permissions; we don't want to spam them
   * for every transfer — the `STOCK_MANAGER` / `TPL_MANAGER` row + their
   * `inventory.approveTransfer` grant cover their need to approve).
   */
  private getSourceAuthorityRolesForNotification(
    _providerKind: 'WAREHOUSE' | 'THIRD_PARTY' | null,
  ): Array<'STOCK_MANAGER'> {
    // Stock Manager is the sole approver for all pending transfers.
    return ['STOCK_MANAGER'];
  }

  /**
   * Initiate a stock transfer between locations.
   *
   * If the actor is the source-authority for the FROM location they keep the
   * legacy fast-path: source stock deducts immediately, status starts at
   * IN_TRANSIT, and the receiver verifies on arrival.
   *
   * Otherwise the row starts as PENDING (no source deduction, no movement row
   * yet). The source authority pool is notified to approve. On approve, source
   * stock deducts and the row flips to IN_TRANSIT. Reject is a clean status flip
   * to REJECTED — inventory-neutral. This way ops can record planned moves
   * without nuking the warehouse's view of available stock.
   *
   * See CLAUDE.md → Transfer Approval Gate.
   */
  async initiateTransfer(input: StockTransferInput, actor: SessionUser) {
    const now = new Date();
    const result = await withActor(this.db, actor, async (tx) => {
      const sourceInfo = await this.getSourceLocationInfo(tx, input.fromLocationId);
      return this.createTransferLineInTx(
        tx,
        { productId: input.productId, quantity: input.quantity },
        input.fromLocationId,
        input.toLocationId,
        sourceInfo,
        actor,
        now,
      );
    });

    await this.emitTransferSideEffects(
      result,
      { productId: input.productId, quantity: input.quantity },
      input.fromLocationId,
      input.toLocationId,
      actor,
    );

    return result.transfer;
  }

  /**
   * Multi-product transfer — one source → one destination, N product lines,
   * all created atomically in a single transaction. Either every line is
   * recorded or none is (one line short on stock rolls the whole batch back).
   * Each line still becomes its own `stock_transfers` row with an independent
   * approve / verify lifecycle, since a 3PL receives per product.
   *
   * See CLAUDE.md → Transfer Approval Gate.
   */
  async initiateTransferBatch(input: StockTransferBatchInput, actor: SessionUser) {
    const now = new Date();
    const results = await withActor(this.db, actor, async (tx) => {
      // Source location info is identical for every line — resolve it once.
      const sourceInfo = await this.getSourceLocationInfo(tx, input.fromLocationId);
      const lineResults: TransferLineResult[] = [];
      for (const line of input.lines) {
        lineResults.push(
          await this.createTransferLineInTx(
            tx,
            line,
            input.fromLocationId,
            input.toLocationId,
            sourceInfo,
            actor,
            now,
          ),
        );
      }
      return lineResults;
    });

    // Post-commit side effects, per line (events + notification fan-out).
    for (let i = 0; i < results.length; i += 1) {
      await this.emitTransferSideEffects(
        results[i]!,
        input.lines[i]!,
        input.fromLocationId,
        input.toLocationId,
        actor,
      );
    }

    return results.map((r) => r.transfer);
  }

  /**
   * Create one transfer row inside an existing transaction — the per-line core
   * shared by {@link initiateTransfer} (single) and {@link initiateTransferBatch}
   * (multi-product). Validates source stock, computes FIFO landed cost, inserts
   * the `stock_transfers` row, and — on the source-authority fast-path — deducts
   * source stock + writes the TRANSFER_OUT movement. Side effects that must run
   * AFTER commit (socket events, notifications) are returned for the caller to
   * hand to {@link emitTransferSideEffects}.
   */
  private async createTransferLineInTx(
    tx: InventoryDbTx,
    line: { productId: string; quantity: number },
    fromLocationId: string,
    toLocationId: string,
    sourceInfo: { providerKind: 'WAREHOUSE' | 'THIRD_PARTY' | null; locationName: string },
    actor: SessionUser,
    now: Date,
  ): Promise<TransferLineResult> {
    const requiresApproval = !this.canApproveSourceTransfer(actor, sourceInfo.providerKind);

    const sourceLevel = await tx
      .select()
      .from(schema.inventoryLevels)
      .where(
        and(
          eq(schema.inventoryLevels.productId, line.productId),
          eq(schema.inventoryLevels.locationId, fromLocationId),
        ),
      )
      .limit(1);

    const available = (sourceLevel[0]?.stockCount ?? 0) - (sourceLevel[0]?.reservedCount ?? 0);
    if (available < line.quantity) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Insufficient stock. Available: ${available}, Requested: ${line.quantity}`,
      });
    }

    const transferCostTotal = await this.computeFifoLandedCostForQuantityInTx(
      tx,
      line.productId,
      line.quantity,
    );

    const transferRows = await tx
      .insert(schema.stockTransfers)
      .values({
        productId: line.productId,
        quantitySent: line.quantity,
        // Source-authority fast-path: auto-receive with full quantity.
        quantityReceived: requiresApproval ? null : line.quantity,
        fromLocationId,
        toLocationId,
        transferStatus: requiresApproval ? 'PENDING' : 'RECEIVED',
        transferCost: transferCostTotal > 0 ? transferCostTotal.toFixed(2) : null,
        verifiedAt: requiresApproval ? null : now,
        initiatedBy: actor.id,
      })
      .returning();

    const newTransfer = transferRows[0];
    if (!newTransfer) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create transfer' });
    }

    // Fast-path (source-authority initiator): deduct source, add to destination,
    // and write both movement rows inside the same transaction so the transfer
    // lands as RECEIVED in one step — no separate approve/verify needed.
    if (!requiresApproval) {
      // Deduct source stock
      if (sourceLevel[0]) {
        await tx
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} - ${line.quantity}`,
            updatedAt: now,
          })
          .where(eq(schema.inventoryLevels.id, sourceLevel[0].id));
      }
      await tx.insert(schema.stockMovements).values({
        productId: line.productId,
        movementType: 'TRANSFER_OUT',
        quantity: line.quantity,
        fromLocationId,
        toLocationId,
        referenceId: newTransfer.id,
        actorId: actor.id,
      });

      // Add stock to destination
      const destLevel = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, line.productId),
            eq(schema.inventoryLevels.locationId, toLocationId),
          ),
        )
        .limit(1);

      if (destLevel[0]) {
        await tx
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} + ${line.quantity}`,
            updatedAt: now,
          })
          .where(eq(schema.inventoryLevels.id, destLevel[0].id));
      } else {
        await tx
          .insert(schema.inventoryLevels)
          .values({
            productId: line.productId,
            locationId: toLocationId,
            stockCount: line.quantity,
            reservedCount: 0,
            status: 'AVAILABLE',
          });
      }

      // Log TRANSFER_IN movement
      await tx.insert(schema.stockMovements).values({
        productId: line.productId,
        movementType: 'TRANSFER_IN',
        quantity: line.quantity,
        fromLocationId,
        toLocationId,
        referenceId: newTransfer.id,
        actorId: actor.id,
      });

      // Write settlement outcome row
      await tx.insert(schema.stockTransferOutcomes).values({
        transferId: newTransfer.id,
        status: 'APPROVED',
        quantity: line.quantity,
        recordedBy: actor.id,
      });
    }

    return {
      transfer: newTransfer,
      requiresApproval,
      sourceProviderKind: sourceInfo.providerKind,
      sourceLocationName: sourceInfo.locationName,
    };
  }

  /**
   * Post-commit side effects for one created transfer line: socket events plus,
   * for approval-gated transfers, the source-authority notification fan-out, or
   * for fast-path transfers the low-stock check. Best-effort — never throws.
   */
  private async emitTransferSideEffects(
    result: TransferLineResult,
    line: { productId: string; quantity: number },
    fromLocationId: string,
    toLocationId: string,
    actor: SessionUser,
  ): Promise<void> {
    if (result.requiresApproval) {
      this.events.emitToRoom('inventory', 'transfer:pending_approval', {
        transferId: result.transfer.id,
        productId: line.productId,
      });

      // Fan out to the source-authority pool. Best-effort, non-blocking.
      try {
        const [productRow] = await this.db
          .select({ name: schema.products.name })
          .from(schema.products)
          .where(eq(schema.products.id, line.productId))
          .limit(1);
        const productName = productRow?.name ?? 'product';
        const payload = {
          type: 'inventory:transfer_pending_approval' as const,
          title: 'Transfer awaiting your approval',
          body: `${actor.name ?? 'Someone'} initiated a transfer of ${line.quantity} × ${productName} out of ${result.sourceLocationName}. Approve before stock leaves.`,
          data: {
            transferId: result.transfer.id,
            productId: line.productId,
            quantity: line.quantity,
            fromLocationId,
            toLocationId,
            initiatedBy: actor.id,
          },
        };
        for (const role of this.getSourceAuthorityRolesForNotification(result.sourceProviderKind)) {
          this.notifications.enqueueCreateForRole(role, payload);
        }
      } catch {
        // Notifications are best-effort.
      }
    } else {
      this.events.emitToRoom('inventory', 'transfer:created', {
        transferId: result.transfer.id,
        productId: line.productId,
        completed: true,
      });
      this.scheduleLowStockCheck(line.productId, fromLocationId);
      this.scheduleLowStockCheck(line.productId, toLocationId);
    }
  }

  /**
   * Source-authority approves a PENDING transfer. This is when source stock
   * actually deducts and the TRANSFER_OUT movement row is written.
   *
   * Re-checks availability inside the transaction — the picture can change
   * between initiate and approve (other allocations, other approvals against
   * the same source). If the source no longer has the requested quantity, the
   * approver gets the same BAD_REQUEST shape as `initiateTransfer`.
   */
  async approveTransfer(input: ApproveTransferInput, actor: SessionUser) {
    const now = new Date();
    const result = await withActor(this.db, actor, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.stockTransfers)
        .where(eq(schema.stockTransfers.id, input.transferId))
        .limit(1);
      const transfer = rows[0];
      if (!transfer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Transfer not found' });
      }
      if (transfer.transferStatus !== 'PENDING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot approve a transfer in status ${transfer.transferStatus}`,
        });
      }

      const sourceInfo = await this.getSourceLocationInfo(tx, transfer.fromLocationId);
      if (!this.canApproveSourceTransfer(actor, sourceInfo.providerKind)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorised to approve transfers from this source location',
        });
      }

      const sourceLevel = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.productId, transfer.productId),
            eq(schema.inventoryLevels.locationId, transfer.fromLocationId),
          ),
        )
        .limit(1);
      const available = (sourceLevel[0]?.stockCount ?? 0) - (sourceLevel[0]?.reservedCount ?? 0);
      if (available < transfer.quantitySent) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Insufficient stock at source. Available: ${available}, Requested: ${transfer.quantitySent}`,
        });
      }

      // Deduct source, add to destination, flip to RECEIVED in one tx.
      if (sourceLevel[0]) {
        await tx
          .update(schema.inventoryLevels)
          .set({
            stockCount: sql`${schema.inventoryLevels.stockCount} - ${transfer.quantitySent}`,
            updatedAt: now,
          })
          .where(eq(schema.inventoryLevels.id, sourceLevel[0].id));
      }
      await tx
        .update(schema.stockTransfers)
        .set({
          transferStatus: 'RECEIVED',
          quantityReceived: transfer.quantitySent,
          approvedBy: actor.id,
          approvedAt: now,
          verifiedAt: now,
        })
        .where(eq(schema.stockTransfers.id, transfer.id));
      await tx.insert(schema.stockMovements).values({
        productId: transfer.productId,
        movementType: 'TRANSFER_OUT',
        quantity: transfer.quantitySent,
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        referenceId: transfer.id,
        actorId: actor.id,
      });

      // Add stock to destination
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
            stockCount: sql`${schema.inventoryLevels.stockCount} + ${transfer.quantitySent}`,
            updatedAt: now,
          })
          .where(eq(schema.inventoryLevels.id, destLevel[0].id));
      } else {
        await tx.insert(schema.inventoryLevels).values({
          productId: transfer.productId,
          locationId: transfer.toLocationId,
          stockCount: transfer.quantitySent,
          reservedCount: 0,
          status: 'AVAILABLE',
        });
      }

      // TRANSFER_IN movement
      await tx.insert(schema.stockMovements).values({
        productId: transfer.productId,
        movementType: 'TRANSFER_IN',
        quantity: transfer.quantitySent,
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        referenceId: transfer.id,
        actorId: actor.id,
      });

      // Settlement outcome
      await tx.insert(schema.stockTransferOutcomes).values({
        transferId: transfer.id,
        status: 'APPROVED',
        quantity: transfer.quantitySent,
        recordedBy: actor.id,
      });

      return { transfer, sourceLocationName: sourceInfo.locationName };
    });

    this.events.emitToRoom('inventory', 'transfer:approved', {
      transferId: result.transfer.id,
      productId: result.transfer.productId,
    });
    this.scheduleLowStockCheck(result.transfer.productId, result.transfer.fromLocationId);

    if (result.transfer.initiatedBy) {
      try {
        const [productRow] = await this.db
          .select({ name: schema.products.name })
          .from(schema.products)
          .where(eq(schema.products.id, result.transfer.productId))
          .limit(1);
        const productName = productRow?.name ?? 'product';
        this.notifications.enqueueCreate({
          userId: result.transfer.initiatedBy,
          type: 'inventory:transfer_approved',
          title: 'Transfer approved',
          body: `${actor.name ?? 'A source manager'} approved your transfer of ${result.transfer.quantitySent} × ${productName} out of ${result.sourceLocationName}. Stock has been received at destination.`,
          data: {
            transferId: result.transfer.id,
            productId: result.transfer.productId,
            approvedBy: actor.id,
          },
        });
      } catch {
        // Notifications are best-effort.
      }
    }

    return { success: true };
  }

  /**
   * Source-authority rejects a PENDING transfer. Pure status flip — no inventory
   * side effects, since nothing was deducted at initiate. The original initiator
   * gets a notification with the rejection reason.
   */
  async rejectTransfer(input: RejectTransferInput, actor: SessionUser) {
    const reason = input.reason.trim();
    if (reason.length < 10) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Rejection reason must be at least 10 characters',
      });
    }

    const now = new Date();
    const result = await withActor(this.db, actor, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.stockTransfers)
        .where(eq(schema.stockTransfers.id, input.transferId))
        .limit(1);
      const transfer = rows[0];
      if (!transfer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Transfer not found' });
      }
      if (transfer.transferStatus !== 'PENDING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot reject a transfer in status ${transfer.transferStatus}`,
        });
      }

      const sourceInfo = await this.getSourceLocationInfo(tx, transfer.fromLocationId);
      if (!this.canApproveSourceTransfer(actor, sourceInfo.providerKind)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorised to reject transfers from this source location',
        });
      }

      await tx
        .update(schema.stockTransfers)
        .set({
          transferStatus: 'REJECTED',
          rejectedBy: actor.id,
          rejectedAt: now,
          rejectionReason: reason,
        })
        .where(eq(schema.stockTransfers.id, transfer.id));

      return { transfer };
    });

    this.events.emitToRoom('inventory', 'transfer:rejected', {
      transferId: result.transfer.id,
      productId: result.transfer.productId,
    });

    if (result.transfer.initiatedBy) {
      try {
        const [productRow] = await this.db
          .select({ name: schema.products.name })
          .from(schema.products)
          .where(eq(schema.products.id, result.transfer.productId))
          .limit(1);
        const productName = productRow?.name ?? 'product';
        this.notifications.enqueueCreate({
          userId: result.transfer.initiatedBy,
          type: 'inventory:transfer_rejected',
          title: 'Transfer rejected',
          body: `${actor.name ?? 'The source manager'} rejected your transfer of ${result.transfer.quantitySent} × ${productName}. Reason: ${reason}`,
          data: {
            transferId: result.transfer.id,
            productId: result.transfer.productId,
            rejectedBy: actor.id,
            rejectionReason: reason,
          },
        });
      } catch {
        // Notifications are best-effort.
      }
    }

    return { success: true };
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
      // Company-group of the destination's provider — stamped so the feed's
      // group-isolation filter scopes the alert to the right company.
      const [destProvider] = await tx
        .select({ groupId: schema.logisticsProviders.groupId })
        .from(schema.logisticsLocations)
        .innerJoin(
          schema.logisticsProviders,
          eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
        )
        .where(eq(schema.logisticsLocations.id, transfer.toLocationId))
        .limit(1);
      const groupId = destProvider?.groupId ?? null;
      const shrinkageData = { transferId: transfer.id, productId: transfer.productId, shortage, groupId };
      this.notifications.enqueueCreateForRole('SUPER_ADMIN', {
        type: 'logistics:shrinkage',
        title: 'Stock shrinkage alert',
        body: `Transfer received with shortage: ${shortage} unit(s) missing. Requires investigation.`,
        data: shrinkageData,
      });
      this.notifications.enqueueCreateForRole('HEAD_OF_LOGISTICS', {
        type: 'logistics:shrinkage',
        title: 'Stock shrinkage alert',
        body: `Transfer received with shortage: ${shortage} unit(s) missing. Requires investigation.`,
        data: shrinkageData,
      });
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
      if (transfer.transferStatus === 'REJECTED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Transfer is already rejected' });
      }

      // PENDING transfers never deducted source stock — cancelling is a pure
      // status flip. No movement rows, no inventory changes.
      if (transfer.transferStatus === 'PENDING') {
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
            message: `Cannot cancel. Destination only has ${Math.max(0, destAvailable)} unit(s) free, but ${receivedQty} were sent there. Use a Stock Adjustment instead.`,
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
    }).then((result) => {
      if (input.adjustmentQuantity < 0) {
        this.scheduleLowStockCheck(input.productId, input.locationId);
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
  /**
   * Parse JSON aggregation payloads from `json_agg` — driver may return object or string.
   */
  private parseShipmentLayersPayload(raw: unknown): Array<{ id: string; referenceLabel: string }> {
    if (raw == null) return [];
    if (Array.isArray(raw)) {
      return raw.filter(
        (x): x is { id: string; referenceLabel: string } =>
          typeof x === 'object' &&
          x !== null &&
          'id' in x &&
          'referenceLabel' in x &&
          typeof (x as { id: unknown }).id === 'string' &&
          typeof (x as { referenceLabel: unknown }).referenceLabel === 'string',
      );
    }
    if (typeof raw === 'string') {
      try {
        const v = JSON.parse(raw) as unknown;
        return this.parseShipmentLayersPayload(v);
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Annotate paginated `inventory_levels` rows with active FIFO shipment refs + manual-intake flag.
   */
  private async enrichLevelsWithShipmentLayers<
    T extends {
      id: string;
      productId: string;
      locationId: string;
      stockCount: number;
      reservedCount: number;
      status: string;
      batchId: string | null;
      updatedAt: Date;
    },
  >(levels: T[]): Promise<
    Array<
      T & {
        shipmentLayers: Array<{ id: string; referenceLabel: string }>;
        hasManualFifoRemaining: boolean;
      }
    >
  > {
    if (levels.length === 0) return [];

    const ids = levels.map((l) => l.id);
    const metaRows = await this.db
      .select({
        id: schema.inventoryLevels.id,
        // Correlated subquery: the body references the outer `inventory_levels`
        // row's product_id / location_id. Drizzle's column-template
        // interpolation generates a bare `product_id` / `location_id`
        // identifier without a table qualifier, which collides with
        // `stock_batches.product_id` and `stock_movements.to_location_id` etc.
        // inside this subquery (Postgres errors with "column reference is
        // ambiguous"). Use the literal table-qualified identifier instead.
        shipmentLayers: sql<unknown>`COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', x.id,
                'referenceLabel',
                  'SHIP-' ||
                  EXTRACT(YEAR FROM x.created_at AT TIME ZONE 'UTC')::int::text ||
                  '-' ||
                  LPAD(x.reference_number::text, 4, '0')
              )
              ORDER BY x.reference_number
            )
            FROM (
              SELECT DISTINCT ship.id, ship.reference_number, ship.created_at
              FROM stock_batches sb
              INNER JOIN shipment_lines sl ON sl.batch_id = sb.id
              INNER JOIN shipments ship ON ship.id = sl.shipment_id
              WHERE sb.product_id = inventory_levels.product_id
                AND sb.remaining_quantity > 0
                AND ship.destination_location_id = inventory_levels.location_id
            ) x
          ),
          '[]'::json
        )`,
        hasManualFifoRemaining: sql<boolean>`EXISTS (
          SELECT 1
          FROM stock_batches sb
          INNER JOIN stock_movements sm
            ON sm.reference_id = sb.id
           AND sm.movement_type = 'INTAKE'
           AND sm.to_location_id = inventory_levels.location_id
           AND sm.product_id = inventory_levels.product_id
          WHERE sb.remaining_quantity > 0
            AND NOT EXISTS (SELECT 1 FROM shipment_lines sl WHERE sl.batch_id = sb.id)
        )`,
      })
      .from(schema.inventoryLevels)
      .where(inArray(schema.inventoryLevels.id, ids));

    const byId = new Map(metaRows.map((r) => [r.id, r]));

    return levels.map((level) => {
      const meta = byId.get(level.id);
      return {
        ...level,
        shipmentLayers: this.parseShipmentLayersPayload(meta?.shipmentLayers),
        hasManualFifoRemaining: Boolean(meta?.hasManualFifoRemaining),
      };
    });
  }

  async listLevels(input: ListInventoryInput, groupId?: string | null, effectiveBranchIds?: string[] | null) {
    const conditions = [];

    if (input.productId) {
      conditions.push(eq(schema.inventoryLevels.productId, input.productId));
    }
    if (input.locationId) {
      conditions.push(eq(schema.inventoryLevels.locationId, input.locationId));
    }
    if (input.providerId) {
      conditions.push(
        sql`${schema.inventoryLevels.locationId} IN (
          SELECT ll.id FROM logistics_locations ll
          WHERE ll.provider_id = ${input.providerId}
        )`,
      );
    }
    // Company-group isolation: only show inventory at locations belonging to providers in this group
    if (groupId) {
      conditions.push(
        sql`${schema.inventoryLevels.locationId} IN (
          SELECT ll.id FROM logistics_locations ll
          JOIN logistics_providers lp ON lp.id = ll.provider_id
          WHERE lp.group_id = ${groupId}
        )`,
      );
    }
    // Branch-scope isolation via effectiveBranchIds
    if (effectiveBranchIds) {
      if (effectiveBranchIds.length === 0) {
        conditions.push(sql`false`);
      } else {
        const inClause = sql.join(effectiveBranchIds.map(id => sql`${id}`), sql`, `);
        conditions.push(
          sql`${schema.inventoryLevels.locationId} IN (
            SELECT ll.id FROM logistics_locations ll
            WHERE ll.branch_id IS NULL OR ll.branch_id IN (${inClause})
          )`,
        );
      }
    }
    if (input.shipmentId) {
      // Fully-qualify the outer-table refs with `inventory_levels.…` — both
      // `inventory_levels` and `stock_batches sb` carry `product_id` /
      // `location_id`, so a bare `product_id` in this EXISTS body resolves
      // ambiguously and Postgres errors with "column reference is ambiguous".
      conditions.push(
        sql`EXISTS (
          SELECT 1
          FROM stock_batches sb
          INNER JOIN shipment_lines sl ON sl.batch_id = sb.id
          INNER JOIN shipments sh ON sh.id = sl.shipment_id
          WHERE sh.id = ${input.shipmentId}::uuid
            AND sb.product_id = inventory_levels.product_id
            AND inventory_levels.location_id = sh.destination_location_id
            AND sb.remaining_quantity > 0
        )`,
      );
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

    // Units delivered to customers — sum of DELIVERY stock-movement quantities
    // (stored negative; ABS gives units shipped out). Scoped to the same
    // product/location filters as the level sums so the overview strip stays
    // internally consistent. `stock_movements` has no shipment/search linkage,
    // so those filters don't narrow this figure.
    const deliveredConditions = [eq(schema.stockMovements.movementType, 'DELIVERY')];
    if (input.productId) {
      deliveredConditions.push(eq(schema.stockMovements.productId, input.productId));
    }
    if (input.locationId) {
      deliveredConditions.push(eq(schema.stockMovements.fromLocationId, input.locationId));
    }

    // "Show every location even at zero inventory" — only when a product is the
    // sole narrowing filter (no shipment / location filter). Bounded by the
    // active-location count, so we fetch all rows and paginate in memory.
    const expandAllLocations =
      !!input.productId && !input.shipmentId && !input.locationId;

    // Explicit column projection (was `select()`): keeps synthetic zero rows
    // trivial to construct and avoids over-fetching temporal/JSON columns.
    const levelsQuery = this.db
      .select({
        id: schema.inventoryLevels.id,
        productId: schema.inventoryLevels.productId,
        locationId: schema.inventoryLevels.locationId,
        batchId: schema.inventoryLevels.batchId,
        stockCount: schema.inventoryLevels.stockCount,
        reservedCount: schema.inventoryLevels.reservedCount,
        status: schema.inventoryLevels.status,
        updatedAt: schema.inventoryLevels.updatedAt,
      })
      .from(schema.inventoryLevels)
      .where(whereClause)
      .orderBy(orderBy);

    // Must be computed before Promise.all so the levels query knows whether to skip LIMIT/OFFSET.
    const shouldExpandLocations = expandAllLocations || (!input.productId && !input.shipmentId && !input.search && !input.locationId);

    const [levelsRaw, totalRows, sumsRows, deliveredRows, activeLocations, globalThreshold] =
      await Promise.all([
        shouldExpandLocations ? levelsQuery : levelsQuery.limit(input.limit).offset(offset),
        this.db
          .select({ count: count() })
          .from(schema.inventoryLevels)
          .where(whereClause),
        this.db
          .select({
            totalStock: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount}), 0)`.mapWith(
              Number,
            ),
            totalReserved: sql<number>`COALESCE(SUM(${schema.inventoryLevels.reservedCount}), 0)`.mapWith(
              Number,
            ),
            totalLocations: sql<number>`COUNT(DISTINCT ${schema.inventoryLevels.locationId})`.mapWith(
              Number,
            ),
          })
          .from(schema.inventoryLevels)
          .where(whereClause),
        this.db
          .select({
            totalDelivered: sql<number>`COALESCE(SUM(ABS(${schema.stockMovements.quantity})), 0)`.mapWith(
              Number,
            ),
          })
          .from(schema.stockMovements)
          .where(and(...deliveredConditions)),
        // Active locations + their per-location threshold overrides — drives the
        // effective-threshold annotation and the all-locations expansion.
        (async () => {
          const hasLocCol = await this.locationThresholdColExists();
          return this.db
            .select({
              id: schema.logisticsLocations.id,
              ...(hasLocCol ? { lowStockThreshold: schema.logisticsLocations.lowStockThreshold } : {}),
            })
            .from(schema.logisticsLocations)
            .where(eq(schema.logisticsLocations.status, 'ACTIVE'));
        })(),
        this.getGlobalLowStockThreshold(),
      ]);

    const thresholdByLocation = new Map(
      activeLocations.map((l) => [l.id, (l as { lowStockThreshold?: number | null }).lowStockThreshold ?? null]),
    );

    type RawLevel = (typeof levelsRaw)[number];
    let workingRaw: RawLevel[] = levelsRaw;

    // Inject synthetic zero-rows for locations with no inventory when
    // filtering by a single product — show every location (even those
    // that never stocked the product) so stock gaps are visible.
    if (shouldExpandLocations) {
      const now = new Date();

      if (expandAllLocations && input.productId) {
        const byLocation = new Map(levelsRaw.map((l) => [l.locationId, l]));
        workingRaw = activeLocations.map((loc): RawLevel => {
          const real = byLocation.get(loc.id);
          if (real) return real;
          return {
            id: `zero:${input.productId}:${loc.id}`,
            productId: input.productId!,
            locationId: loc.id,
            batchId: null,
            stockCount: 0,
            reservedCount: 0,
            status: 'AVAILABLE',
            updatedAt: now,
          };
        });
      }

      // Re-apply the requested sort across the merged (real + synthetic) set.
      workingRaw.sort((a, b) => {
        if (input.sortBy === 'available') {
          const av = a.stockCount - a.reservedCount;
          const bv = b.stockCount - b.reservedCount;
          return input.sortOrder === 'asc' ? av - bv : bv - av;
        }
        const at = a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0;
        const bt = b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0;
        return input.sortOrder === 'asc' ? at - bt : bt - at;
      });
    }

    const total = shouldExpandLocations ? workingRaw.length : (totalRows[0]?.count ?? 0);
    const pagedRaw = shouldExpandLocations
      ? workingRaw.slice(offset, offset + input.limit)
      : workingRaw;

    // Enrich only real rows — synthetic zero rows have no FIFO shipment layers.
    const realPaged = pagedRaw.filter((l) => !l.id.startsWith('zero:') && !l.id.startsWith('empty:'));
    const enrichedReal = await this.enrichLevelsWithShipmentLayers(realPaged);
    const enrichedById = new Map(enrichedReal.map((l) => [l.id, l]));

    const levels = pagedRaw.map((l) => {
      const enriched = enrichedById.get(l.id);
      const base = enriched ?? { ...l, shipmentLayers: [], hasManualFifoRemaining: false };
      const locationThreshold = thresholdByLocation.get(l.locationId) ?? null;
      return {
        ...base,
        locationLowStockThreshold: locationThreshold,
        effectiveLowStockThreshold: locationThreshold ?? globalThreshold,
      };
    });

    const sums = sumsRows[0];

    return {
      levels,
      totals: {
        totalStock: sums?.totalStock ?? 0,
        totalReserved: sums?.totalReserved ?? 0,
        totalDelivered: deliveredRows[0]?.totalDelivered ?? 0,
        totalLocations: sums?.totalLocations ?? 0,
      },
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Aggregated stock per (product, location) — no batches, no pagination.
   * Used by the transfer form to show "X units in stock" per location without
   * being affected by FIFO batch count × page-size limits.
   */
  async listLevelsSummary(): Promise<
    Array<{
      productId: string;
      locationId: string;
      stockCount: number;
      reservedCount: number;
    }>
  > {
    const rows = await this.db
      .select({
        productId: schema.inventoryLevels.productId,
        locationId: schema.inventoryLevels.locationId,
        stockCount:
          sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount}), 0)`.mapWith(Number),
        reservedCount:
          sql<number>`COALESCE(SUM(${schema.inventoryLevels.reservedCount}), 0)`.mapWith(Number),
      })
      .from(schema.inventoryLevels)
      .groupBy(schema.inventoryLevels.productId, schema.inventoryLevels.locationId);
    return rows;
  }

  /**
   * Detail payload for a single inventory row by its inventory_levels.id.
   * Convenience wrapper around `levelDetail` that also resolves product/location names
   * so a full-page view only needs one round-trip.
   */
  async getLevelById(
    id: string,
    opts: { page?: number; limit?: number; startDate?: string; endDate?: string } = {},
  ) {
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

    const detail = await this.levelDetail(level.productId, level.locationId, opts);

    return {
      level,
      batches: detail.batches,
      movements: detail.movements,
      total: detail.total,
      page: detail.page,
      limit: detail.limit,
      totalPages: detail.totalPages,
      inQty: detail.inQty,
      outQty: detail.outQty,
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
  async levelDetail(
    productId: string,
    locationId: string,
    opts: { page?: number; limit?: number; startDate?: string; endDate?: string } | number = {},
  ) {
    // Back-compat: callers passing a bare `limit` number still work.
    const normalized = typeof opts === 'number' ? { limit: opts } : opts;
    const limit = Math.max(1, Math.min(normalized.limit ?? 20, 200));
    const page = Math.max(1, normalized.page ?? 1);
    const offset = (page - 1) * limit;
    const startDate = normalized.startDate?.trim() || null;
    const endDate = normalized.endDate?.trim() || null;

    // Batches: any stock_batch that was intaken at this location.
    // Not paginated/date-filtered — these are the cost layers currently feeding FIFO.
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
    // Joined with users (actor) + orders + locations so the audit panel can show
    // "who moved what, where, and why" without extra round-trips.
    // Date filter is applied to sm.created_at; endDate is treated as inclusive end-of-day.
    // Single roll-up query: total event count + signed in/out unit totals scoped to
    // (product, location, date range). Used both for pagination and for the overview
    // stat strip on the detail page so its numbers stay correct as the user pages
    // through the audit trail.
    const aggregateRows = await this.db.execute<{
      total: number;
      inQty: number;
      outQty: number;
      deliveredQty: number;
    }>(sql`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(
          CASE
            WHEN sm.movement_type IN ('INTAKE','TRANSFER_IN','RESTOCK') THEN ABS(sm.quantity)
            WHEN sm.movement_type = 'ADJUSTMENT' AND sm.quantity > 0 THEN sm.quantity
            ELSE 0
          END
        ), 0)::int AS "inQty",
        COALESCE(SUM(
          CASE
            WHEN sm.movement_type IN ('DELIVERY','TRANSFER_OUT','WRITE_OFF','RETURN','DISPATCH') THEN ABS(sm.quantity)
            WHEN sm.movement_type = 'ADJUSTMENT' AND sm.quantity < 0 THEN ABS(sm.quantity)
            ELSE 0
          END
        ), 0)::int AS "outQty",
        COALESCE(SUM(
          CASE WHEN sm.movement_type = 'DELIVERY' THEN ABS(sm.quantity) ELSE 0 END
        ), 0)::int AS "deliveredQty"
      FROM stock_movements sm
      LEFT JOIN orders o ON o.id = sm.reference_id
      WHERE sm.product_id = ${productId}
        AND (
          sm.from_location_id = ${locationId}
          OR sm.to_location_id = ${locationId}
          OR o.logistics_location_id = ${locationId}
        )
        AND (${startDate}::date IS NULL OR sm.created_at >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR sm.created_at < (${endDate}::date + INTERVAL '1 day'))
    `);
    const aggregate = aggregateRows[0] ?? { total: 0, inQty: 0, outQty: 0, deliveredQty: 0 };
    const total = aggregate.total;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const movements = await this.db.execute<{
      id: string;
      productId: string;
      movementType: string;
      quantity: number;
      fromLocationId: string | null;
      fromLocationName: string | null;
      toLocationId: string | null;
      toLocationName: string | null;
      referenceId: string | null;
      orderShortId: string | null;
      orderNumber: number | null;
      reason: string | null;
      actorId: string | null;
      actorName: string | null;
      actorRole: string | null;
      createdAt: Date;
    }>(sql`
      SELECT
        sm.id,
        sm.product_id        AS "productId",
        sm.movement_type     AS "movementType",
        sm.quantity,
        sm.from_location_id  AS "fromLocationId",
        from_loc.name        AS "fromLocationName",
        sm.to_location_id    AS "toLocationId",
        to_loc.name          AS "toLocationName",
        sm.reference_id      AS "referenceId",
        CASE WHEN o.id IS NOT NULL THEN o.id ELSE NULL END AS "orderShortId",
        o.order_number       AS "orderNumber",
        sm.reason,
        sm.actor_id          AS "actorId",
        u.name               AS "actorName",
        u.role::text         AS "actorRole",
        sm.created_at        AS "createdAt"
      FROM stock_movements sm
      LEFT JOIN orders o ON o.id = sm.reference_id
      LEFT JOIN users u ON u.id = sm.actor_id
      LEFT JOIN logistics_locations from_loc ON from_loc.id = sm.from_location_id
      LEFT JOIN logistics_locations to_loc ON to_loc.id = sm.to_location_id
      WHERE sm.product_id = ${productId}
        AND (
          sm.from_location_id = ${locationId}
          OR sm.to_location_id = ${locationId}
          OR o.logistics_location_id = ${locationId}
        )
        AND (${startDate}::date IS NULL OR sm.created_at >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR sm.created_at < (${endDate}::date + INTERVAL '1 day'))
      ORDER BY sm.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    return {
      batches,
      movements,
      total,
      page,
      limit,
      totalPages,
      inQty: aggregate.inQty,
      outQty: aggregate.outQty,
      deliveredQty: aggregate.deliveredQty,
    };
  }

  /**
   * List shipments that were received at this provider's locations.
   * Powers the shipment filter dropdown on the provider detail page.
   */
  async getProviderShipments(providerId: string) {
    const locRows = await this.db
      .select({ id: schema.logisticsLocations.id })
      .from(schema.logisticsLocations)
      .where(eq(schema.logisticsLocations.providerId, providerId));

    if (locRows.length === 0) return [];

    const rows = await this.db
      .select({
        id: schema.shipments.id,
        referenceNumber: schema.shipments.referenceNumber,
        label: schema.shipments.label,
        destinationName: schema.logisticsLocations.name,
        verifiedAt: schema.shipments.verifiedAt,
      })
      .from(schema.shipments)
      .innerJoin(schema.logisticsLocations, eq(schema.logisticsLocations.id, schema.shipments.destinationLocationId))
      .where(
        and(
          inArray(schema.shipments.destinationLocationId, locRows.map((r) => r.id)),
          eq(schema.shipments.status, 'VERIFIED'),
        ),
      )
      .orderBy(desc(schema.shipments.verifiedAt));

    return rows.map((r) => ({
      id: r.id,
      referenceNumber: r.referenceNumber,
      label: r.label,
      destinationName: r.destinationName,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Per-location breakdown for a logistics provider.
   * Returns stock available, received, sold, and remittance data per location.
   */
  async getProviderLocationBreakdown(opts: {
    providerId: string;
    shipmentId?: string;
  }) {
    const locRows = await this.db
      .select({
        id: schema.logisticsLocations.id,
        name: schema.logisticsLocations.name,
      })
      .from(schema.logisticsLocations)
      .where(eq(schema.logisticsLocations.providerId, opts.providerId));

    if (locRows.length === 0) return [];

    // Stock per location
    const stockRows = await this.db.execute<{
      locationId: string;
      available: number;
      reserved: number;
    }>(sql`
      SELECT
        il.location_id AS "locationId",
        COALESCE(SUM(il.stock_count - il.reserved_count), 0)::int AS "available",
        COALESCE(SUM(il.reserved_count), 0)::int AS "reserved"
      FROM inventory_levels il
      WHERE il.location_id IN (${sql.join(locRows.map((l) => sql`${l.id}::uuid`), sql`,`)})
      GROUP BY il.location_id
    `);
    const stockMap = new Map<string, { available: number; reserved: number }>();
    for (const r of stockRows) stockMap.set(r.locationId, { available: r.available, reserved: r.reserved });

    const locIdList = sql.join(locRows.map((l) => sql`${l.id}::uuid`), sql`,`);

    // Received per location (all-time — total stock ever sent, not date-filtered)
    // Exclude intra-provider TRANSFER_IN (where both source and dest belong to this provider)
    // — those are just internal moves, not new stock entering the provider.
    const recvRows = await this.db.execute<{
      locationId: string;
      received: number;
    }>(sql`
      SELECT
        sm.to_location_id AS "locationId",
        COALESCE(SUM(ABS(sm.quantity)), 0)::int AS "received"
      FROM stock_movements sm
      WHERE sm.movement_type IN ('INTAKE','TRANSFER_IN','RESTOCK')
        AND sm.to_location_id IN (${locIdList})
        AND NOT (sm.movement_type = 'TRANSFER_IN' AND sm.from_location_id IN (${locIdList}))
      GROUP BY sm.to_location_id
    `);
    const recvMap = new Map<string, number>();
    for (const r of recvRows) recvMap.set(r.locationId, r.received);

    // Sold per location (all-time)
    const soldRows = await this.db.execute<{
      locationId: string;
      sold: number;
    }>(sql`
      SELECT
        COALESCE(sm.from_location_id, o.logistics_location_id) AS "locationId",
        COALESCE(SUM(ABS(sm.quantity)), 0)::int AS "sold"
      FROM stock_movements sm
      LEFT JOIN orders o ON o.id = sm.reference_id
      WHERE sm.movement_type = 'DELIVERY'
        AND (
          sm.from_location_id IN (${locIdList})
          OR o.logistics_location_id IN (${locIdList})
        )
      GROUP BY COALESCE(sm.from_location_id, o.logistics_location_id)
    `);
    const soldMap = new Map<string, number>();
    for (const r of soldRows) soldMap.set(r.locationId, r.sold);

    // Reconciliation: transferred out, adjustments, write-offs, dispatched per location
    // Exclude intra-provider TRANSFER_OUT (destination is also this provider's location)
    const reconRows = await this.db.execute<{
      locationId: string;
      transferredOut: number;
      adjusted: number;
      writtenOff: number;
      dispatched: number;
    }>(sql`
      SELECT
        COALESCE(sm.from_location_id, sm.to_location_id) AS "locationId",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'TRANSFER_OUT' AND NOT (sm.to_location_id IN (${locIdList})) THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "transferredOut",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'ADJUSTMENT' THEN sm.quantity ELSE 0 END), 0)::int AS "adjusted",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'WRITE_OFF' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "writtenOff",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'DISPATCH' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "dispatched"
      FROM stock_movements sm
      WHERE sm.movement_type IN ('TRANSFER_OUT', 'ADJUSTMENT', 'WRITE_OFF', 'DISPATCH')
        AND (sm.from_location_id IN (${locIdList}) OR sm.to_location_id IN (${locIdList}))
      GROUP BY COALESCE(sm.from_location_id, sm.to_location_id)
    `);
    const reconMap = new Map<string, { transferredOut: number; adjusted: number; writtenOff: number; dispatched: number }>();
    for (const r of reconRows) reconMap.set(r.locationId, r);

    // Remittance per location
    const remitRows = await this.db.execute<{
      locationId: string;
      qtyRemitted: number;
      qtyPending: number;
      amountRemitted: string;
      amountPending: string;
      qtyAwaitingRemittance: number;
      amountAwaitingRemittance: string;
    }>(sql`
      SELECT
        o.logistics_location_id AS "locationId",
        COALESCE(SUM(CASE WHEN dro.order_id IS NOT NULL AND dr.status = 'RECEIVED' THEN oi.quantity ELSE 0 END), 0)::int AS "qtyRemitted",
        COALESCE(SUM(CASE WHEN dro.order_id IS NOT NULL AND dr.status = 'SENT' THEN oi.quantity ELSE 0 END), 0)::int AS "qtyPending",
        COALESCE(SUM(CASE WHEN dro.order_id IS NOT NULL AND dr.status = 'RECEIVED' THEN oi.unit_price ELSE 0 END), 0)::text AS "amountRemitted",
        COALESCE(SUM(CASE WHEN dro.order_id IS NOT NULL AND dr.status = 'SENT' THEN oi.unit_price ELSE 0 END), 0)::text AS "amountPending",
        COALESCE(SUM(CASE WHEN dro.order_id IS NULL THEN oi.quantity ELSE 0 END), 0)::int AS "qtyAwaitingRemittance",
        COALESCE(SUM(CASE WHEN dro.order_id IS NULL THEN oi.unit_price ELSE 0 END), 0)::text AS "amountAwaitingRemittance"
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      LEFT JOIN delivery_remittance_orders dro ON dro.order_id = o.id
      LEFT JOIN delivery_remittances dr ON dr.id = dro.delivery_remittance_id
      WHERE o.logistics_location_id IN (${sql.join(locRows.map((l) => sql`${l.id}::uuid`), sql`,`)})
        AND o.status IN ('DELIVERED', 'REMITTED')
      GROUP BY o.logistics_location_id
    `);
    const remitMap = new Map<string, { qtyRemitted: number; qtyPending: number; amountRemitted: string; amountPending: string; qtyAwaitingRemittance: number; amountAwaitingRemittance: string }>();
    for (const r of remitRows) remitMap.set(r.locationId, r);

    return locRows.map((l) => {
      const rm = remitMap.get(l.id);
      const rc = reconMap.get(l.id);
      return {
        locationId: l.id,
        locationName: l.name,
        available: stockMap.get(l.id)?.available ?? 0,
        reserved: stockMap.get(l.id)?.reserved ?? 0,
        received: recvMap.get(l.id) ?? 0,
        sold: soldMap.get(l.id) ?? 0,
        transferredOut: rc?.transferredOut ?? 0,
        adjusted: rc?.adjusted ?? 0,
        writtenOff: rc?.writtenOff ?? 0,
        dispatched: rc?.dispatched ?? 0,
        qtyRemitted: rm?.qtyRemitted ?? 0,
        qtyPending: rm?.qtyPending ?? 0,
        amountRemitted: rm?.amountRemitted ?? '0',
        amountPending: rm?.amountPending ?? '0',
        qtyAwaitingRemittance: rm?.qtyAwaitingRemittance ?? 0,
        amountAwaitingRemittance: rm?.amountAwaitingRemittance ?? '0',
      };
    });
  }

  /**
   * Per-product stock + sold breakdown for a logistics provider.
   * Returns current available stock and units sold (DELIVERY movements) in the date range.
   */
  async getProviderProductBreakdown(opts: {
    providerId: string;
    shipmentId?: string;
  }) {
    const shipmentId = opts.shipmentId?.trim() || null;

    // Resolve location IDs for this provider
    const locRows = await this.db
      .select({ id: schema.logisticsLocations.id })
      .from(schema.logisticsLocations)
      .where(eq(schema.logisticsLocations.providerId, opts.providerId));
    const locationIds = locRows.map((r) => r.id);

    if (locationIds.length === 0) return [];

    const locationList = sql.join(locationIds.map((id) => sql`${id}::uuid`), sql`,`);

    // Current stock per product across provider locations
    const stockRows = await this.db.execute<{
      productId: string;
      productName: string | null;
      available: number;
      reserved: number;
    }>(sql`
      SELECT
        il.product_id AS "productId",
        p.name AS "productName",
        COALESCE(SUM(il.stock_count - il.reserved_count), 0)::int AS "available",
        COALESCE(SUM(il.reserved_count), 0)::int AS "reserved"
      FROM inventory_levels il
      INNER JOIN products p ON p.id = il.product_id
      WHERE il.location_id IN (${locationList})
      GROUP BY il.product_id, p.name
    `);

    // Received — optionally scoped to a specific shipment's batches
    const shipmentReceivedClause = shipmentId
      ? sql`AND sm.reference_id IN (SELECT sb.id FROM stock_batches sb WHERE sb.shipment_id = ${shipmentId}::uuid)`
      : sql``;

    const receivedRows = await this.db.execute<{
      productId: string;
      received: number;
    }>(sql`
      SELECT
        sm.product_id AS "productId",
        COALESCE(SUM(ABS(sm.quantity)), 0)::int AS "received"
      FROM stock_movements sm
      WHERE sm.movement_type IN ('INTAKE','TRANSFER_IN','RESTOCK')
        AND sm.to_location_id IN (${locationList})
        AND NOT (sm.movement_type = 'TRANSFER_IN' AND sm.from_location_id IN (${locationList}))
        ${shipmentReceivedClause}
      GROUP BY sm.product_id
    `);
    const receivedMap = new Map<string, number>();
    for (const r of receivedRows) receivedMap.set(r.productId, r.received);

    // Sold (all-time)
    const soldRows = await this.db.execute<{
      productId: string;
      sold: number;
    }>(sql`
      SELECT
        sm.product_id AS "productId",
        COALESCE(SUM(ABS(sm.quantity)), 0)::int AS "sold"
      FROM stock_movements sm
      LEFT JOIN orders o ON o.id = sm.reference_id
      WHERE sm.movement_type = 'DELIVERY'
        AND (
          sm.from_location_id IN (${locationList})
          OR sm.to_location_id IN (${locationList})
          OR o.logistics_location_id IN (${locationList})
        )
      GROUP BY sm.product_id
    `);
    const soldMap = new Map<string, number>();
    for (const r of soldRows) soldMap.set(r.productId, r.sold);

    // Reconciliation: transferred out, adjustments, write-offs, dispatched per product
    const reconRows = await this.db.execute<{
      productId: string;
      transferredOut: number;
      adjusted: number;
      writtenOff: number;
      dispatched: number;
    }>(sql`
      SELECT
        sm.product_id AS "productId",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'TRANSFER_OUT' AND NOT (sm.to_location_id IN (${locationList})) THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "transferredOut",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'ADJUSTMENT' THEN sm.quantity ELSE 0 END), 0)::int AS "adjusted",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'WRITE_OFF' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "writtenOff",
        COALESCE(SUM(CASE WHEN sm.movement_type = 'DISPATCH' THEN ABS(sm.quantity) ELSE 0 END), 0)::int AS "dispatched"
      FROM stock_movements sm
      WHERE sm.movement_type IN ('TRANSFER_OUT', 'ADJUSTMENT', 'WRITE_OFF', 'DISPATCH')
        AND (sm.from_location_id IN (${locationList}) OR sm.to_location_id IN (${locationList}))
      GROUP BY sm.product_id
    `);
    const productReconMap = new Map<string, { transferredOut: number; adjusted: number; writtenOff: number; dispatched: number }>();
    for (const r of reconRows) productReconMap.set(r.productId, r);

    // Per-product remittance (all-time)
    const revenueRows = await this.db.execute<{
      productId: string;
      qtyRemitted: number;
      qtyPending: number;
      amountRemitted: string;
      amountPending: string;
      qtyAwaitingRemittance: number;
      amountAwaitingRemittance: string;
    }>(sql`
      SELECT
        oi.product_id AS "productId",
        COALESCE(SUM(CASE WHEN dro.order_id IS NOT NULL AND dr.status = 'RECEIVED' THEN oi.quantity ELSE 0 END), 0)::int AS "qtyRemitted",
        COALESCE(SUM(CASE WHEN dro.order_id IS NOT NULL AND dr.status = 'SENT' THEN oi.quantity ELSE 0 END), 0)::int AS "qtyPending",
        COALESCE(SUM(CASE WHEN dro.order_id IS NOT NULL AND dr.status = 'RECEIVED' THEN oi.unit_price ELSE 0 END), 0)::text AS "amountRemitted",
        COALESCE(SUM(CASE WHEN dro.order_id IS NOT NULL AND dr.status = 'SENT' THEN oi.unit_price ELSE 0 END), 0)::text AS "amountPending",
        COALESCE(SUM(CASE WHEN dro.order_id IS NULL THEN oi.quantity ELSE 0 END), 0)::int AS "qtyAwaitingRemittance",
        COALESCE(SUM(CASE WHEN dro.order_id IS NULL THEN oi.unit_price ELSE 0 END), 0)::text AS "amountAwaitingRemittance"
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      LEFT JOIN delivery_remittance_orders dro ON dro.order_id = o.id
      LEFT JOIN delivery_remittances dr ON dr.id = dro.delivery_remittance_id
      WHERE o.logistics_location_id IN (${locationList})
        AND o.status IN ('DELIVERED', 'REMITTED')
      GROUP BY oi.product_id
    `);

    const revenueMap = new Map<string, { qtyRemitted: number; qtyPending: number; amountRemitted: string; amountPending: string; qtyAwaitingRemittance: number; amountAwaitingRemittance: string }>();
    for (const r of revenueRows) {
      revenueMap.set(r.productId, r);
    }

    return stockRows.map((r) => {
      const rv = revenueMap.get(r.productId);
      const rc = productReconMap.get(r.productId);
      return {
        productId: r.productId,
        productName: r.productName ?? 'Unknown',
        received: receivedMap.get(r.productId) ?? 0,
        sold: soldMap.get(r.productId) ?? 0,
        available: r.available,
        reserved: r.reserved,
        transferredOut: rc?.transferredOut ?? 0,
        adjusted: rc?.adjusted ?? 0,
        writtenOff: rc?.writtenOff ?? 0,
        dispatched: rc?.dispatched ?? 0,
        qtyRemitted: rv?.qtyRemitted ?? 0,
        qtyPending: rv?.qtyPending ?? 0,
        amountRemitted: rv?.amountRemitted ?? '0',
        amountPending: rv?.amountPending ?? '0',
        qtyAwaitingRemittance: rv?.qtyAwaitingRemittance ?? 0,
        amountAwaitingRemittance: rv?.amountAwaitingRemittance ?? '0',
      };
    });
  }

  /**
   * Stock movements across ALL locations belonging to a logistics provider.
   * Powers the provider detail page "Stock Activity" tab — same column layout
   * as the per-location inventory detail page, plus a `productName` column.
   */
  async getProviderMovements(opts: {
    providerId: string;
    productId?: string;
    locationId?: string;
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const limit = Math.max(1, Math.min(opts.limit ?? 40, 200));
    const page = Math.max(1, opts.page ?? 1);
    const offset = (page - 1) * limit;
    const startDate = opts.startDate?.trim() || null;
    const endDate = opts.endDate?.trim() || null;
    const productId = opts.productId?.trim() || null;
    const locationId = opts.locationId?.trim() || null;

    // Resolve location IDs for this provider
    const locRows = await this.db
      .select({ id: schema.logisticsLocations.id })
      .from(schema.logisticsLocations)
      .where(eq(schema.logisticsLocations.providerId, opts.providerId));
    let locationIds = locRows.map((r) => r.id);

    // If a specific location is selected, scope to just that one
    if (locationId && locationIds.includes(locationId)) {
      locationIds = [locationId];
    }

    if (locationIds.length === 0) {
      return {
        movements: [],
        total: 0,
        page,
        limit,
        totalPages: 1,
        inQty: 0,
        outQty: 0,
        deliveredQty: 0,
        products: [],
      };
    }

    // Build location scope clause (reused in aggregate + rows queries)
    const locationList = sql.join(locationIds.map((id) => sql`${id}::uuid`), sql`,`);

    // Product filter (optional)
    const productClause = productId
      ? sql`AND sm.product_id = ${productId}::uuid`
      : sql``;

    // ── Aggregate ──
    const aggregateRows = await this.db.execute<{
      total: number;
      inQty: number;
      outQty: number;
      deliveredQty: number;
    }>(sql`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(
          CASE
            WHEN sm.movement_type IN ('INTAKE','TRANSFER_IN','RESTOCK') THEN ABS(sm.quantity)
            WHEN sm.movement_type = 'ADJUSTMENT' AND sm.quantity > 0 THEN sm.quantity
            ELSE 0
          END
        ), 0)::int AS "inQty",
        COALESCE(SUM(
          CASE
            WHEN sm.movement_type IN ('DELIVERY','TRANSFER_OUT','WRITE_OFF','RETURN','DISPATCH') THEN ABS(sm.quantity)
            WHEN sm.movement_type = 'ADJUSTMENT' AND sm.quantity < 0 THEN ABS(sm.quantity)
            ELSE 0
          END
        ), 0)::int AS "outQty",
        COALESCE(SUM(
          CASE WHEN sm.movement_type = 'DELIVERY' THEN ABS(sm.quantity) ELSE 0 END
        ), 0)::int AS "deliveredQty"
      FROM stock_movements sm
      LEFT JOIN orders o ON o.id = sm.reference_id
      WHERE (
        sm.from_location_id IN (${locationList})
        OR sm.to_location_id IN (${locationList})
        OR o.logistics_location_id IN (${locationList})
      )
      ${productClause}
      AND (${startDate}::date IS NULL OR sm.created_at >= ${startDate}::date)
      AND (${endDate}::date IS NULL OR sm.created_at < (${endDate}::date + INTERVAL '1 day'))
    `);
    const aggregate = aggregateRows[0] ?? { total: 0, inQty: 0, outQty: 0, deliveredQty: 0 };
    const total = aggregate.total;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    // ── Movement rows ──
    const movements = await this.db.execute<{
      id: string;
      productId: string;
      productName: string | null;
      movementType: string;
      quantity: number;
      fromLocationId: string | null;
      fromLocationName: string | null;
      toLocationId: string | null;
      toLocationName: string | null;
      referenceId: string | null;
      orderShortId: string | null;
      orderNumber: number | null;
      reason: string | null;
      actorId: string | null;
      actorName: string | null;
      actorRole: string | null;
      createdAt: Date;
    }>(sql`
      SELECT
        sm.id,
        sm.product_id        AS "productId",
        p.name               AS "productName",
        sm.movement_type     AS "movementType",
        sm.quantity,
        sm.from_location_id  AS "fromLocationId",
        from_loc.name        AS "fromLocationName",
        sm.to_location_id    AS "toLocationId",
        to_loc.name          AS "toLocationName",
        sm.reference_id      AS "referenceId",
        CASE WHEN o.id IS NOT NULL THEN o.id ELSE NULL END AS "orderShortId",
        o.order_number       AS "orderNumber",
        sm.reason,
        sm.actor_id          AS "actorId",
        u.name               AS "actorName",
        u.role::text         AS "actorRole",
        sm.created_at        AS "createdAt"
      FROM stock_movements sm
      LEFT JOIN orders o ON o.id = sm.reference_id
      LEFT JOIN users u ON u.id = sm.actor_id
      LEFT JOIN logistics_locations from_loc ON from_loc.id = sm.from_location_id
      LEFT JOIN logistics_locations to_loc ON to_loc.id = sm.to_location_id
      LEFT JOIN products p ON p.id = sm.product_id
      WHERE (
        sm.from_location_id IN (${locationList})
        OR sm.to_location_id IN (${locationList})
        OR o.logistics_location_id IN (${locationList})
      )
      ${productClause}
      AND (${startDate}::date IS NULL OR sm.created_at >= ${startDate}::date)
      AND (${endDate}::date IS NULL OR sm.created_at < (${endDate}::date + INTERVAL '1 day'))
      ORDER BY sm.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    // ── Distinct products for filter dropdown ──
    const productRows = await this.db.execute<{
      id: string;
      name: string;
    }>(sql`
      SELECT DISTINCT p.id, p.name
      FROM stock_movements sm
      LEFT JOIN orders o ON o.id = sm.reference_id
      INNER JOIN products p ON p.id = sm.product_id
      WHERE (
        sm.from_location_id IN (${locationList})
        OR sm.to_location_id IN (${locationList})
        OR o.logistics_location_id IN (${locationList})
      )
      AND (${startDate}::date IS NULL OR sm.created_at >= ${startDate}::date)
      AND (${endDate}::date IS NULL OR sm.created_at < (${endDate}::date + INTERVAL '1 day'))
      ORDER BY p.name
    `);

    return {
      movements,
      total,
      page,
      limit,
      totalPages,
      inQty: aggregate.inQty,
      outQty: aggregate.outQty,
      deliveredQty: aggregate.deliveredQty,
      products: productRows,
    };
  }

  /**
   * Branch scope for movement reads — mirrors `ShipmentsService.resolveBranchFilter`.
   * `inventory_levels` is RLS branch-scoped; `stock_movements` has no RLS, so we filter
   * here or branch users would see org-wide ledger rows while Stock Levels stayed empty.
   */
  private movementsReadBranchFilter(
    actor: SessionUser,
    currentBranchId: string | null,
    effectiveBranchIds?: string[] | null,
  ): { branchId: string | null; effectiveBranchIds: string[] | null } {
    if (isAdminLevel(actor)) return { branchId: null, effectiveBranchIds: null };
    if (currentBranchId) return { branchId: currentBranchId, effectiveBranchIds: null };
    if (effectiveBranchIds && effectiveBranchIds.length > 0) return { branchId: null, effectiveBranchIds };
    return { branchId: null, effectiveBranchIds: null };
  }

  /**
   * Get stock movements log.
   */
  async listMovements(
    input: ListMovementsInput,
    actor: SessionUser,
    currentBranchId: string | null,
    effectiveBranchIds?: string[] | null,
  ) {
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
    if (input.shipmentId) {
      // Trace: every INTAKE movement for this shipment carries `referenceId = shipment_line.id`.
      // Filter by EXISTS against shipment_lines so the index lookup stays in the planner without
      // pulling the full lines into memory. See validators/inventory.ts → `listMovementsSchema.shipmentId`
      // for the rationale + scope (intake events only; downstream allocation/delivery references
      // the order, not the line).
      conditions.push(
        sql<boolean>`EXISTS (
          SELECT 1 FROM shipment_lines sl
          WHERE sl.id = ${schema.stockMovements.referenceId}
            AND sl.shipment_id = ${input.shipmentId}
        )`,
      );
    }

    const branchScope = this.movementsReadBranchFilter(actor, currentBranchId, effectiveBranchIds);
    if (branchScope.branchId) {
      conditions.push(
        sql<boolean>`(
          EXISTS (
            SELECT 1 FROM logistics_locations ll
            WHERE ll.id = ${schema.stockMovements.fromLocationId}
              AND (ll.branch_id IS NULL OR ll.branch_id = ${branchScope.branchId})
          )
          OR EXISTS (
            SELECT 1 FROM logistics_locations ll
            WHERE ll.id = ${schema.stockMovements.toLocationId}
              AND (ll.branch_id IS NULL OR ll.branch_id = ${branchScope.branchId})
          )
        )`,
      );
    } else if (branchScope.effectiveBranchIds && branchScope.effectiveBranchIds.length > 0) {
      const ids = branchScope.effectiveBranchIds;
      const inClause = sql.join(ids.map(id => sql`${id}`), sql`, `);
      conditions.push(
        sql<boolean>`(
          EXISTS (
            SELECT 1 FROM logistics_locations ll
            WHERE ll.id = ${schema.stockMovements.fromLocationId}
              AND (ll.branch_id IS NULL OR ll.branch_id IN (${inClause}))
          )
          OR EXISTS (
            SELECT 1 FROM logistics_locations ll
            WHERE ll.id = ${schema.stockMovements.toLocationId}
              AND (ll.branch_id IS NULL OR ll.branch_id IN (${inClause}))
          )
        )`,
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
   * Get transfers with optional status filter.
   *
   * `viewer` is optional — when provided, every PENDING row is annotated with
   * `canApprove: boolean` so the client can render the Approve / Reject buttons
   * without mirroring the source-authority rule. Server is canonical.
   */
  async listTransfers(status?: string, viewer?: SessionUser, page = 1, limit = 1000, groupId?: string | null) {
    const conditions = [];
    if (status) {
      conditions.push(
        eq(
          schema.stockTransfers.transferStatus,
          status as 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'DISPUTED' | 'CANCELLED' | 'REJECTED',
        ),
      );
    }
    // Company-group isolation: only transfers involving locations in this group's providers
    if (groupId) {
      conditions.push(
        sql`${schema.stockTransfers.fromLocationId} IN (
          SELECT ll.id FROM logistics_locations ll
          JOIN logistics_providers lp ON lp.id = ll.provider_id
          WHERE lp.group_id = ${groupId}
        )`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 1000);
    const offset = (safePage - 1) * safeLimit;

    const [transfers, countRows] = await Promise.all([
      this.db
        .select()
        .from(schema.stockTransfers)
        .where(whereClause)
        .orderBy(desc(schema.stockTransfers.createdAt))
        .limit(safeLimit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.stockTransfers)
        .where(whereClause),
    ]);
    const total = countRows[0]?.count ?? 0;

    if (transfers.length === 0) return { transfers: [], total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };

    // Batch-resolve location names so the frontend never sees "Unknown location".
    const allLocationIds = Array.from(
      new Set(transfers.flatMap((t) => [t.fromLocationId, t.toLocationId])),
    );
    const locationNameRows = allLocationIds.length
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
          .where(inArray(schema.logisticsLocations.id, allLocationIds))
      : [];
    const locationNameMap = new Map(locationNameRows.map((r) => [r.id, r.name]));
    const locationProviderMap = new Map(locationNameRows.map((r) => [r.id, r.providerName ?? null]));

    const transferIds = transfers.map((t) => t.id);
    // Sender preference: TRANSFER_OUT movement actor (set on initiate fast-path
    // and on approve), then fall back to `initiated_by` (set on every initiate)
    // so PENDING rows still surface their initiator's name.
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

    // Fallback: for PENDING transfers (no TRANSFER_OUT movement yet) we look up
    // the initiator's name via stock_transfers.initiated_by → users.name.
    const missingInitiatorIds = Array.from(
      new Set(
        transfers
          .filter((t) => !senderByTransferId.has(t.id) && t.initiatedBy)
          .map((t) => t.initiatedBy as string),
      ),
    );
    if (missingInitiatorIds.length > 0) {
      const initiatorRows = await this.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(inArray(schema.users.id, missingInitiatorIds));
      const nameById = new Map(initiatorRows.map((r) => [r.id, r.name]));
      for (const t of transfers) {
        if (senderByTransferId.has(t.id)) continue;
        if (t.initiatedBy && nameById.has(t.initiatedBy)) {
          senderByTransferId.set(t.id, nameById.get(t.initiatedBy)!);
        }
      }
    }

    // Enrich every row with the source provider's kind so the client can render
    // "requires approval" affordances and gate the Approve/Reject buttons.
    const sourceLocationIds = Array.from(new Set(transfers.map((t) => t.fromLocationId)));
    const providerInfoRows = sourceLocationIds.length
      ? await this.db
          .select({
            locationId: schema.logisticsLocations.id,
            providerKind: schema.logisticsProviders.kind,
          })
          .from(schema.logisticsLocations)
          .leftJoin(
            schema.logisticsProviders,
            eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
          )
          .where(inArray(schema.logisticsLocations.id, sourceLocationIds))
      : [];
    const providerKindByLocation = new Map<string, 'WAREHOUSE' | 'THIRD_PARTY' | null>();
    for (const row of providerInfoRows) {
      providerKindByLocation.set(
        row.locationId,
        (row.providerKind as 'WAREHOUSE' | 'THIRD_PARTY' | null) ?? null,
      );
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
      const sourceProviderKind = providerKindByLocation.get(transfer.fromLocationId) ?? null;
      // Only PENDING rows are actionable. Non-PENDING rows are always
      // `canApprove: false` regardless of viewer role — keeps the UI honest.
      const canApprove =
        viewer && transfer.transferStatus === 'PENDING'
          ? this.canApproveSourceTransfer(viewer, sourceProviderKind)
          : false;
      const fromLocationName = locationNameMap.get(transfer.fromLocationId) ?? null;
      const toLocationName = locationNameMap.get(transfer.toLocationId) ?? null;
      const fromProviderName = locationProviderMap.get(transfer.fromLocationId) ?? null;
      const toProviderName = locationProviderMap.get(transfer.toLocationId) ?? null;
      if (outcomes.length === 0) {
        return [
          {
            ...transfer,
            senderName,
            sourceProviderKind,
            canApprove,
            fromLocationName,
            toLocationName,
            fromProviderName,
            toProviderName,
            outcomeStatus: transfer.transferStatus === 'RECEIVED' ? 'APPROVED' : transfer.transferStatus,
            outcomeQuantity: transfer.quantityReceived,
            outcomeReason: transfer.shrinkageReason,
          },
        ];
      }
      return outcomes.map((outcome) => ({
        ...transfer,
        senderName,
        sourceProviderKind,
        canApprove,
        fromLocationName,
        toLocationName,
        fromProviderName,
        toProviderName,
        outcomeStatus: outcome.outcomeStatus,
        outcomeQuantity: outcome.outcomeQuantity,
        outcomeReason: outcome.outcomeReason,
      }));
    });

    const paginationMeta = { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
    if (!status) return { transfers: mapped, ...paginationMeta };
    if (status === 'RECEIVED') {
      return { transfers: mapped.filter((row) => row.outcomeStatus === 'APPROVED'), ...paginationMeta };
    }
    if (status === 'DISPUTED') {
      return { transfers: mapped.filter((row) => row.outcomeStatus === 'DISPUTED'), ...paginationMeta };
    }
    return { transfers: mapped.filter((row) => row.transferStatus === status), ...paginationMeta };
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
   * Stock available per product — CEO dashboard widget.
   * SUM(stock_count - reserved_count) across all locations, grouped by product.
   * Joins product name and brand name via product_categories.
   */
  async getStockPerProduct(activeGroupId?: string | null): Promise<
    Array<{ productId: string; productName: string; brandName: string | null; available: number }>
  > {
    const conditions: Parameters<typeof and>[0][] = [];
    if (activeGroupId) {
      conditions.push(eq(schema.products.groupId, activeGroupId));
    }
    let query = this.db
      .select({
        productId: schema.inventoryLevels.productId,
        productName: schema.products.name,
        brandName: schema.productCategories.brandName,
        totalStock: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount}), 0)::int`,
        totalReserved: sql<number>`COALESCE(SUM(${schema.inventoryLevels.reservedCount}), 0)::int`,
      })
      .from(schema.inventoryLevels)
      .innerJoin(schema.products, eq(schema.inventoryLevels.productId, schema.products.id))
      .leftJoin(schema.productCategories, eq(schema.products.categoryId, schema.productCategories.id))
      .$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    const rows = await query
      .groupBy(schema.inventoryLevels.productId, schema.products.name, schema.productCategories.brandName)
      .orderBy(schema.products.name);

    return rows.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      brandName: r.brandName ?? null,
      available: r.totalStock - r.totalReserved,
    }));
  }

  /**
   * Get products that are below their minimum threshold.
   * TODO: re-implement once min_threshold is stored elsewhere (e.g. inventory settings).
   */
  /**
   * Return all inventory levels where (stockCount - reservedCount) < the
   * EFFECTIVE threshold — the location's own `low_stock_threshold` if set,
   * otherwise the org-wide threshold. Drives the low-stock banner on the
   * inventory page. Each item carries its own effective `threshold`.
   *
   * Note: no early-return when the global threshold is 0/disabled — a location
   * with an explicit override should still surface (COALESCE handles it).
   */
  async getLowStockAlerts(groupId?: string | null, effectiveBranchIds?: string[] | null) {
    const globalThreshold = await this.getGlobalLowStockThreshold();
    const hasLocCol = await this.locationThresholdColExists();

    // Single raw query that covers BOTH cases:
    //  1. inventory_levels rows where available < effective threshold
    //  2. active locations with NO inventory_levels rows at all (0 stock)
    // Uses a LEFT JOIN from locations → levels so empty locations appear as NULLs.
    const thresholdSql = hasLocCol ? 'll.low_stock_threshold' : 'NULL::integer';
    // groupId is a session-validated UUID; still use a safe UUID check before raw interpolation
    const groupFilter = groupId && /^[0-9a-f-]{36}$/i.test(groupId)
      ? `AND ll.provider_id IN (SELECT lp.id FROM logistics_providers lp WHERE lp.group_id = '${groupId}')`
      : '';
    // Branch-scope isolation via effectiveBranchIds
    let branchFilter = '';
    if (effectiveBranchIds) {
      if (effectiveBranchIds.length === 0) {
        branchFilter = 'AND false';
      } else {
        const safeIds = effectiveBranchIds.filter(id => /^[0-9a-f-]{36}$/i.test(id));
        if (safeIds.length > 0) {
          branchFilter = `AND (ll.branch_id IS NULL OR ll.branch_id IN (${safeIds.map(id => `'${id}'`).join(', ')}))`;
        }
      }
    }

    const rows = await this.db.execute<{
      level_id: string | null;
      product_id: string | null;
      location_id: string;
      stock_count: number;
      reserved_count: number;
      product_name: string | null;
      location_name: string;
      effective_threshold: number;
    }>(sql.raw(`
      SELECT
        il.id AS level_id,
        il.product_id,
        ll.id AS location_id,
        COALESCE(il.stock_count, 0) AS stock_count,
        COALESCE(il.reserved_count, 0) AS reserved_count,
        p.name AS product_name,
        ll.name AS location_name,
        COALESCE(${thresholdSql}, ${globalThreshold}) AS effective_threshold
      FROM logistics_locations ll
      LEFT JOIN inventory_levels il ON il.location_id = ll.id
      LEFT JOIN products p ON p.id = il.product_id
      WHERE ll.status = 'ACTIVE'
        ${groupFilter}
        ${branchFilter}
        AND (
          (il.id IS NOT NULL AND (il.stock_count - il.reserved_count) < COALESCE(${thresholdSql}, ${globalThreshold}))
          OR
          (il.id IS NULL)
        )
      ORDER BY COALESCE(il.stock_count - il.reserved_count, 0) ASC
      LIMIT 50
    `));

    return {
      threshold: globalThreshold,
      items: rows.map((r) => ({
        // Empty locations have no level — use a synthetic key so the UI can render them.
        levelId: r.level_id ?? `empty-${r.location_id}`,
        productId: r.product_id ?? null,
        productName: r.product_name ?? (r.level_id ? 'Unknown product' : 'No stock received'),
        locationId: r.location_id,
        locationName: r.location_name ?? 'Unknown location',
        stockCount: Number(r.stock_count),
        reservedCount: Number(r.reserved_count),
        availableCount: Number(r.stock_count) - Number(r.reserved_count),
        threshold: Number(r.effective_threshold),
      })),
    };
  }

  /**
   * Set (or clear) a location's per-location low-stock alert threshold.
   * `threshold === null` clears the override so the location inherits the
   * org-wide threshold again. Wrapped in `withActor` — the write is captured by
   * the `logistics_locations` temporal-audit trigger (Pillar 4).
   */
  async setLocationLowStockThreshold(
    locationId: string,
    threshold: number | null,
    actor: SessionUser,
  ): Promise<void> {
    const hasLocCol = await this.locationThresholdColExists();
    if (!hasLocCol) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Per-location thresholds require migration 0143. Run migrations and restart.',
      });
    }
    await withActor(this.db, actor, async (tx) => {
      const updated = await tx
        .update(schema.logisticsLocations)
        .set({ lowStockThreshold: threshold, updatedAt: new Date() })
        .where(eq(schema.logisticsLocations.id, locationId))
        .returning({ id: schema.logisticsLocations.id });
      if (!updated[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Location not found' });
      }
    });
  }

  /**
   * List every active location with its per-location low-stock override and
   * the resolved org-wide threshold. Drives the per-location threshold editor
   * on the inventory page — surfaces locations even when they hold zero
   * inventory so admins can pre-set alerts before stock arrives.
   */
  async listLocationThresholds(): Promise<{
    globalThreshold: number;
    locations: Array<{
      id: string;
      name: string;
      providerName: string | null;
      providerKind: 'WAREHOUSE' | 'THIRD_PARTY' | null;
      lowStockThreshold: number | null;
      effectiveThreshold: number;
    }>;
  }> {
    const globalThreshold = await this.getGlobalLowStockThreshold();

    const hasLocCol = await this.locationThresholdColExists();

    const rows = await this.db
      .select({
        id: schema.logisticsLocations.id,
        name: schema.logisticsLocations.name,
        ...(hasLocCol ? { lowStockThreshold: schema.logisticsLocations.lowStockThreshold } : {}),
        providerName: schema.logisticsProviders.name,
        providerKind: schema.logisticsProviders.kind,
      })
      .from(schema.logisticsLocations)
      .leftJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(eq(schema.logisticsLocations.status, 'ACTIVE'))
      .orderBy(asc(schema.logisticsLocations.name));

    return {
      globalThreshold,
      locations: rows.map((r) => {
        const locThreshold = (r as { lowStockThreshold?: number | null }).lowStockThreshold ?? null;
        return {
          id: r.id,
          name: r.name,
          providerName: r.providerName ?? null,
          providerKind:
            r.providerKind === 'WAREHOUSE'
              ? ('WAREHOUSE' as const)
              : r.providerKind === 'THIRD_PARTY'
                ? ('THIRD_PARTY' as const)
                : null,
          lowStockThreshold: locThreshold,
          effectiveThreshold: locThreshold ?? globalThreshold,
        };
      }),
    };
  }

  // ============================================
  // Returns Queue — orders in RETURNED status
  // ============================================

  /**
   * List orders in RETURNED status at a specific location (or all).
   */
  async listReturnedOrders(locationId?: string, effectiveBranchIds?: string[] | null) {
    const conditions = [eq(schema.orders.status, 'RETURNED')];
    if (locationId) {
      conditions.push(eq(schema.orders.logisticsLocationId, locationId));
    }
    // Branch-scope isolation via effectiveBranchIds
    if (effectiveBranchIds) {
      if (effectiveBranchIds.length === 0) {
        conditions.push(sql`false`);
      } else {
        conditions.push(inArray(schema.orders.servicingBranchId, effectiveBranchIds));
      }
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
  async listReconciliations(locationId?: string, effectiveBranchIds?: string[] | null) {
    const conditions = [];
    if (locationId) {
      conditions.push(eq(schema.stockReconciliations.locationId, locationId));
    }
    // Branch-scope isolation via effectiveBranchIds
    if (effectiveBranchIds) {
      if (effectiveBranchIds.length === 0) {
        conditions.push(sql`false`);
      } else {
        const inClause = sql.join(effectiveBranchIds.map(id => sql`${id}`), sql`, `);
        conditions.push(
          sql`${schema.stockReconciliations.locationId} IN (
            SELECT ll.id FROM logistics_locations ll
            WHERE ll.branch_id IS NULL OR ll.branch_id IN (${inClause})
          )`,
        );
      }
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

  /**
   * Load order line quantities, expanding bundle products into their component
   * products. If product A is a bundle of (B×2, C×1) and the order has A×3,
   * the returned map contains B→6, C→3 (not A→3). Standalone products pass
   * through unchanged. This is the single chokepoint — every inventory op
   * (assert, reserve, release, deliver, FIFO) calls this, so bundle awareness
   * propagates automatically.
   */
  private async loadAggregatedOrderLineQuantities(orderId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        productId: schema.orderItems.productId,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    if (rows.length === 0) return new Map();

    // Check which of these products are bundles (have components)
    const productIds = [...new Set(rows.map((r) => r.productId))];
    const bundleRows = await this.db
      .select({
        bundleProductId: schema.productBundleComponents.bundleProductId,
        componentProductId: schema.productBundleComponents.componentProductId,
        quantity: schema.productBundleComponents.quantity,
      })
      .from(schema.productBundleComponents)
      .where(inArray(schema.productBundleComponents.bundleProductId, productIds));

    // Group bundle components by bundle product ID
    const bundleMap = new Map<string, Array<{ componentProductId: string; quantity: number }>>();
    for (const row of bundleRows) {
      let components = bundleMap.get(row.bundleProductId);
      if (!components) {
        components = [];
        bundleMap.set(row.bundleProductId, components);
      }
      components.push({ componentProductId: row.componentProductId, quantity: row.quantity });
    }

    // Expand: bundle items → component items; standalone items pass through
    const byProduct = new Map<string, number>();
    for (const row of rows) {
      const components = bundleMap.get(row.productId);
      if (components) {
        // Bundle product — expand into component quantities
        for (const comp of components) {
          const need = row.quantity * comp.quantity;
          byProduct.set(comp.componentProductId, (byProduct.get(comp.componentProductId) ?? 0) + need);
        }
      } else {
        // Standalone product — pass through
        byProduct.set(row.productId, (byProduct.get(row.productId) ?? 0) + row.quantity);
      }
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

    // Previously this iterated `byProduct` and ran two queries PER product
    // (`inventoryLevels` + `stockBatches`) sequentially — N×2 round-trips
    // dominate the CONFIRM latency on a remote DB. Two batched aggregate
    // queries (one per scope) drop it to a constant 2 round-trips that run
    // in parallel. We `GROUP BY product_id` and `SUM(...)` server-side so
    // we only pull one row per product, regardless of how many locations
    // / batches each one has.
    const productIds = [...byProduct.keys()];
    const [shelfRows, batchRows] = await Promise.all([
      this.db
        .select({
          productId: schema.inventoryLevels.productId,
          available: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}), 0)::int`,
        })
        .from(schema.inventoryLevels)
        .where(inArray(schema.inventoryLevels.productId, productIds))
        .groupBy(schema.inventoryLevels.productId),
      this.db
        .select({
          productId: schema.stockBatches.productId,
          remaining: sql<number>`COALESCE(SUM(${schema.stockBatches.remainingQuantity}), 0)::int`,
        })
        .from(schema.stockBatches)
        .where(inArray(schema.stockBatches.productId, productIds))
        .groupBy(schema.stockBatches.productId),
    ]);

    const shelfByProduct = new Map<string, number>();
    for (const row of shelfRows) shelfByProduct.set(row.productId, Number(row.available) || 0);
    const fifoByProduct = new Map<string, number>();
    for (const row of batchRows) fifoByProduct.set(row.productId, Number(row.remaining) || 0);

    for (const [productId, need] of byProduct) {
      const shelfAvailable = shelfByProduct.get(productId) ?? 0;
      if (shelfAvailable < need) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot confirm: insufficient sellable shelf stock for this order (need ${need}, have ${shelfAvailable} across locations).`,
        });
      }
      const fifoAvailable = fifoByProduct.get(productId) ?? 0;
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

    const productIds = [...byProduct.keys()];
    const shelfAgg = await this.db
      .select({
        productId: schema.inventoryLevels.productId,
        available: sql<number>`COALESCE(
          SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}),
          0
        )::int`,
      })
      .from(schema.inventoryLevels)
      .where(
        and(
          eq(schema.inventoryLevels.locationId, locationId),
          inArray(schema.inventoryLevels.productId, productIds),
        ),
      )
      .groupBy(schema.inventoryLevels.productId);

    const availableByProduct = new Map<string, number>();
    for (const row of shelfAgg) {
      availableByProduct.set(row.productId, Number(row.available) || 0);
    }

    for (const [productId, need] of byProduct) {
      const avail = availableByProduct.get(productId) ?? 0;
      if (avail < need) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            avail <= 0
              ? 'This logistics company location has no sellable shelf stock for a product on the order. Receive stock (intake or verified transfer) before allocating.'
              : `Insufficient stock at the selected location for this order (available ${avail}, need ${need} for one SKU).`,
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
          .orderBy(
            desc(
              sql`(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount})`,
            ),
          );

        if (rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Inventory row disappeared between validation and reservation.',
          });
        }

        const totalFree = rows.reduce(
          (sum, r) => sum + (r.stockCount - r.reservedCount),
          0,
        );
        if (totalFree < qty) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Stock changed while allocating. Not enough free units left at this location.',
          });
        }

        let remaining = qty;
        for (const level of rows) {
          if (remaining <= 0) break;
          const free = level.stockCount - level.reservedCount;
          if (free <= 0) continue;
          const add = Math.min(remaining, free);
          await tx
            .update(schema.inventoryLevels)
            .set({
              reservedCount: sql`${schema.inventoryLevels.reservedCount} + ${add}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryLevels.id, level.id));
          remaining -= add;
        }
        if (remaining > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Stock changed while allocating. Not enough free units left at this location.',
          });
        }

        await tx.insert(schema.stockMovements).values({
          productId,
          movementType: 'ALLOCATION',
          quantity: qty,
          toLocationId: locationId,
          referenceId: orderId,
          reason: `Allocated to logistics company for order ${orderId}`,
          actorId: actor.id,
        });
      }
    });
  }

  /**
   * Reverse {@link reserveForAllocateWithMovements} at a prior 3PL when reallocating ALLOCATED → ALLOCATED.
   */
  async releaseAllocationReserveAtLocation(orderId: string, locationId: string, actor: SessionUser): Promise<void> {
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
          .orderBy(desc(schema.inventoryLevels.reservedCount));

        if (rows.length === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Inventory row missing at prior allocation location during reallocation.',
          });
        }
        const totalReserved = rows.reduce((sum, r) => sum + r.reservedCount, 0);
        if (totalReserved < qty) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Cannot reallocate: reserved quantity at the prior location is below this order (inventory may have been adjusted).',
          });
        }

        let remaining = qty;
        for (const level of rows) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, level.reservedCount);
          if (take <= 0) continue;
          await tx
            .update(schema.inventoryLevels)
            .set({
              reservedCount: sql`${schema.inventoryLevels.reservedCount} - ${take}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryLevels.id, level.id));
          remaining -= take;
        }

        await tx.insert(schema.stockMovements).values({
          productId,
          movementType: 'ADJUSTMENT',
          quantity: qty,
          fromLocationId: locationId,
          referenceId: orderId,
          reason: `Reallocation: released logistics company reservation for order ${orderId}`,
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
        await this.consumeFifoRemainingInTx(
          tx,
          productId,
          lineQty,
          'Cannot record delivery: insufficient FIFO batch remaining for a product on this order.',
        );

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
          .orderBy(desc(schema.inventoryLevels.stockCount));

        if (levelRows.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Cannot record delivery: no inventory level at the fulfillment location for a product on this order.',
          });
        }

        const totalStock = levelRows.reduce((sum, r) => sum + r.stockCount, 0);
        const totalReserved = levelRows.reduce((sum, r) => sum + r.reservedCount, 0);
        if (totalStock < lineQty) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot record delivery: shelf count at location is below shipped quantity.',
          });
        }

        let stockRemaining = lineQty;
        for (const level of levelRows) {
          if (stockRemaining <= 0) break;
          const take = Math.min(stockRemaining, level.stockCount);
          if (take <= 0) continue;
          await tx
            .update(schema.inventoryLevels)
            .set({
              stockCount: sql`${schema.inventoryLevels.stockCount} - ${take}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryLevels.id, level.id));
          stockRemaining -= take;
        }

        const reservedToRelease = Math.min(lineQty, totalReserved);
        let resRemaining = reservedToRelease;
        const rowsAfter = await tx
          .select()
          .from(schema.inventoryLevels)
          .where(
            and(
              eq(schema.inventoryLevels.productId, productId),
              eq(schema.inventoryLevels.locationId, logisticsLocationId),
            ),
          )
          .orderBy(desc(schema.inventoryLevels.reservedCount));

        for (const level of rowsAfter) {
          if (resRemaining <= 0) break;
          const take = Math.min(resRemaining, level.reservedCount);
          if (take <= 0) continue;
          await tx
            .update(schema.inventoryLevels)
            .set({
              reservedCount: sql`${schema.inventoryLevels.reservedCount} - ${take}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryLevels.id, level.id));
          resRemaining -= take;
        }
      }
    });

    for (const productId of byProduct.keys()) {
      this.scheduleLowStockCheck(productId, logisticsLocationId);
    }
  }

  /**
   * Reverse DELIVERY stock deductions for a delivered order that is being deleted
   * (Finance dual-approval flow). Creates offsetting ADJUSTMENT movements and
   * restores inventory levels at the original fulfillment locations.
   */
  async reverseDeliveryForOrder(orderId: string, actor: SessionUser): Promise<void> {
    // Find all DELIVERY movements for this order
    const deliveryMovements = await this.db
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.referenceId, orderId),
          eq(schema.stockMovements.movementType, 'DELIVERY'),
        ),
      );

    if (deliveryMovements.length === 0) {
      // No stock was moved — nothing to reverse (e.g. order was pre-shipment)
      return;
    }

    await withActor(this.db, actor, async (tx) => {
      for (const mov of deliveryMovements) {
        const reverseQty = Math.abs(mov.quantity); // DELIVERY has negative qty
        const locationId = mov.fromLocationId;

        // Create offsetting ADJUSTMENT movement
        await tx.insert(schema.stockMovements).values({
          productId: mov.productId,
          movementType: 'ADJUSTMENT',
          quantity: reverseQty,
          toLocationId: locationId,
          referenceId: orderId,
          reason: `Stock reversal: delivered order deleted (dual-approval). Reversing ${reverseQty} units.`,
          actorId: actor.id,
        });

        // Restore inventory level at the original location.
        // Both stockCount and reservedCount were decremented on delivery
        // (completeDeliveryInventory), so restore both on reversal.
        if (locationId) {
          await tx
            .update(schema.inventoryLevels)
            .set({
              stockCount: sql`${schema.inventoryLevels.stockCount} + ${reverseQty}`,
              reservedCount: sql`${schema.inventoryLevels.reservedCount} + ${reverseQty}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.inventoryLevels.productId, mov.productId),
                eq(schema.inventoryLevels.locationId, locationId),
              ),
            );
        }
      }
    });
  }
}
