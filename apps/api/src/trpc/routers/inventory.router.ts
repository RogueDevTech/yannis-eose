import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import {
  stockIntakeSchema,
  stockTransferSchema,
  stockTransferBatchSchema,
  verifyTransferSchema,
  approveTransferSchema,
  rejectTransferSchema,
  stockAdjustmentSchema,
  listInventorySchema,
  listMovementsSchema,
  createReconciliationSchema,
  resolveReconciliationSchema,
  createShipmentSchema,
  updateShipmentLinesSchema,
  shipmentTransitionSchema,
  verifyShipmentSchema,
  cancelShipmentSchema,
  listShipmentsSchema,
  getShipmentSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  listWarehousesSchema,
} from '@yannis/shared';
import type { InventoryService } from '../../inventory/inventory.service';
import type { ShipmentsService } from '../../inventory/shipments.service';
import type { LogisticsService } from '../../logistics/logistics.service';
import { getProductsService } from './products.router';
import { getLogisticsService } from './logistics.router';
import { getSettingsService } from './settings.router';

let inventoryServiceInstance: InventoryService | null = null;
let shipmentsServiceInstance: ShipmentsService | null = null;
let logisticsServiceInstance: LogisticsService | null = null;

export function setInventoryService(service: InventoryService) {
  inventoryServiceInstance = service;
}

export function setShipmentsService(service: ShipmentsService) {
  shipmentsServiceInstance = service;
}

export function setLogisticsServiceForInventory(service: LogisticsService) {
  logisticsServiceInstance = service;
}

/** Exported for cross-router lookups (e.g. `*PageBundle` procedures). */
export function getInventoryService(): InventoryService {
  if (!inventoryServiceInstance) {
    throw new Error('InventoryService not initialized. Call setInventoryService() first.');
  }
  return inventoryServiceInstance;
}

function getShipmentsService(): ShipmentsService {
  if (!shipmentsServiceInstance) {
    throw new Error('ShipmentsService not initialized. Call setShipmentsService() first.');
  }
  return shipmentsServiceInstance;
}

function getLogisticsServiceForInventory(): LogisticsService {
  if (!logisticsServiceInstance) {
    throw new Error('LogisticsService not initialized for inventory router.');
  }
  return logisticsServiceInstance;
}

export const inventoryRouter = router({
  /**
   * List inventory levels — filtered by product/location.
   */
  levels: authedProcedure
    .input(listInventorySchema)
    .query(async ({ input, ctx }) => {
      return getInventoryService().listLevels(input, ctx.activeGroupId);
    }),

  /** Aggregated stock per (product, location) — no batch rows, no pagination. */
  levelsSummary: authedProcedure.query(async () => {
    return getInventoryService().listLevelsSummary();
  }),

  /**
   * Get available stock for a product (with virtual buffer).
   */
  availableStock: authedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getInventoryService().getAvailableStock(input.productId);
    }),

  /**
   * Detail view for a single inventory row — FIFO batches intaken at this location
   * plus the full movement history affecting stock at this (product, location).
   */
  levelDetail: authedProcedure
    .input(z.object({
      productId: z.string().uuid(),
      locationId: z.string().uuid(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(200).default(20),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return getInventoryService().levelDetail(input.productId, input.locationId, {
        page: input.page,
        limit: input.limit,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  /**
   * Stock movements across all locations belonging to a logistics provider.
   * Powers the provider detail "Stock Activity" tab.
   */
  providerLocationBreakdown: authedProcedure
    .input(z.object({
      providerId: z.string().uuid(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return getInventoryService().getProviderLocationBreakdown(input);
    }),

  providerProductBreakdown: authedProcedure
    .input(z.object({
      providerId: z.string().uuid(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return getInventoryService().getProviderProductBreakdown(input);
    }),

  providerMovements: authedProcedure
    .input(z.object({
      providerId: z.string().uuid(),
      productId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(200).default(40),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return getInventoryService().getProviderMovements(input);
    }),

  /**
   * Single-inventory-row detail page loader — returns level + product/location names
   * + batches + movements in one round-trip.
   */
  getLevelById: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(1000).default(50),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return getInventoryService().getLevelById(input.id, {
        page: input.page,
        limit: input.limit,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  /**
   * Stock intake — receive new stock batch.
   * Stock Manager or SuperAdmin only.
   */
  intake: permissionProcedure('inventory.intake')
    .input(stockIntakeSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().intake(input, ctx.user);
    }),

  /**
   * Initiate stock transfer between locations.
   */
  transfer: permissionProcedure('inventory.transfer')
    .input(stockTransferSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().initiateTransfer(input, ctx.user);
    }),

  /**
   * Multi-product stock transfer — one source → one destination, N product
   * lines, created atomically in a single transaction.
   */
  transferBatch: permissionProcedure('inventory.transfer')
    .input(stockTransferBatchSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().initiateTransferBatch(input, ctx.user);
    }),

  /**
   * Approve a PENDING transfer. Source authority only (gated by
   * `inventory.approveTransfer` permission AND a server-side
   * `canApproveSourceTransfer` check that compares the actor's role against
   * the source location's provider kind).
   *
   * On approval, source stock deducts and the row flips to IN_TRANSIT.
   */
  approveTransfer: permissionProcedure('inventory.approveTransfer')
    .input(approveTransferSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().approveTransfer(input, ctx.user);
    }),

  /**
   * Reject a PENDING transfer. Pure status flip — no inventory side effects.
   * Reason is mandatory (min 10 chars). Same gate as approveTransfer.
   */
  rejectTransfer: permissionProcedure('inventory.approveTransfer')
    .input(rejectTransferSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().rejectTransfer(input, ctx.user);
    }),

  /**
   * Verify transfer receipt — 3PL Manager, Stock Manager, or Head of Logistics (when 3PL is not on-platform).
   */
  verifyTransfer: permissionProcedure('inventory.verifyTransfer')
    .input(verifyTransferSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().verifyTransfer(input, ctx.user);
    }),

  /**
   * Cancel a transfer that was created in error. Reverses both inventory legs
   * and writes audit movements. Same permission as initiating — Stock Manager
   * (and admin-class) can undo their own mistake without going through HoL.
   */
  cancelTransfer: permissionProcedure('inventory.transfer')
    .input(
      z.object({
        transferId: z.string().uuid(),
        reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().cancelTransfer(input, ctx.user);
    }),

  /**
   * Manual stock adjustment.
   */
  adjust: permissionProcedure('inventory.adjust')
    .input(stockAdjustmentSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().adjust(input, ctx.user);
    }),

  /**
   * Stock movement history log.
   */
  movements: authedProcedure
    .input(listMovementsSchema)
    .query(async ({ input, ctx }) => {
      return getInventoryService().listMovements(input, ctx.user, ctx.currentBranchId ?? null, ctx.effectiveBranchIds);
    }),

  /**
   * List stock transfers.
   */
  transfers: authedProcedure
    .input(z.object({ status: z.string().optional(), page: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(1000).optional() }))
    .query(async ({ input, ctx }) => {
      return getInventoryService().listTransfers(input.status, ctx.user, input.page, input.limit, ctx.activeGroupId);
    }),

  /**
   * Low stock alerts — products below threshold.
   */
  lowStockAlerts: permissionProcedure('inventory.lowStockAlerts')
    .query(async () => {
      return getInventoryService().getLowStockAlerts();
    }),

  /**
   * List every active location alongside the per-location low-stock override
   * and the resolved org-wide threshold. Surfaces zero-inventory locations
   * too — drives the per-location alert editor on /admin/inventory.
   */
  locationLowStockThresholds: permissionProcedure('inventory.lowStockAlerts')
    .query(async () => {
      return getInventoryService().listLocationThresholds();
    }),

  /**
   * Set (or clear) a location's per-location low-stock alert threshold.
   * Passing `threshold: null` clears the override so the location inherits
   * the org-wide threshold again. Admin-class only — gated by the
   * `system_settings` write capability.
   */
  setLocationLowStockThreshold: permissionProcedure('inventory.lowStockAlerts')
    .input(
      z.object({
        locationId: z.string().uuid(),
        threshold: z.number().int().min(1).max(10000).nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await getInventoryService().setLocationLowStockThreshold(
        input.locationId,
        input.threshold,
        ctx.user,
      );
      return { success: true };
    }),

  /**
   * List returned orders (for returns queue).
   */
  returnedOrders: permissionProcedure('inventory.returnedOrders')
    .input(z.object({ locationId: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      return getInventoryService().listReturnedOrders(input.locationId);
    }),

  /**
   * Submit stock reconciliation.
   */
  createReconciliation: permissionProcedure('inventory.createReconciliation')
    .input(createReconciliationSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().createReconciliation(input, ctx.user);
    }),

  /**
   * Resolve (approve/reject) a reconciliation.
   */
  resolveReconciliation: permissionProcedure('inventory.resolveReconciliation')
    .input(resolveReconciliationSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().resolveReconciliation(input, ctx.user);
    }),

  /**
   * List reconciliation records.
   */
  reconciliations: permissionProcedure('inventory.reconciliations')
    .input(z.object({ locationId: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      return getInventoryService().listReconciliations(input.locationId);
    }),

  /**
   * Single-request bundle for `/tpl/inventory` and `/admin/inventory` page
   * loaders. Replaces 7 parallel HTTP round-trips — `inventory.levels`,
   * `inventory.movements`, `products.options`, `logistics.locationOptions`,
   * `inventory.transfers`, `inventory.returnedOrders`,
   * `inventory.reconciliations` — with a single request. Same fan-out runs
   * server-side via `Promise.all`.
   *
   * Permission gate matches the page (`inventory.read`). Per-piece permissions
   * for `returnedOrders` and `reconciliations` are re-checked inline so the
   * bundle can no-op those slices for callers without the underlying grant.
   */
  inventoryPageBundle: permissionProcedure('inventory.read')
    .input(
      z.object({
        // Levels filter scope.
        locationId: z.string().uuid().optional(),
        levelsPage: z.number().int().min(1).default(1),
        levelsLimit: z.number().int().min(1).max(200).default(100),
        // Movements filter scope.
        movementsPage: z.number().int().min(1).default(1),
        movementsLimit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const perms = ctx.user.permissions ?? [];
      const canSeeReturned = perms.includes('inventory.returnedOrders');
      const canSeeReconciliations = perms.includes('inventory.reconciliations');

      // Match `listInventorySchema` defaults (see `inventory.levels` procedure).
      const levelsInput = {
        page: input.levelsPage,
        limit: input.levelsLimit,
        sortBy: 'updatedAt' as const,
        sortOrder: 'desc' as const,
        ...(input.locationId && { locationId: input.locationId }),
      };
      const movementsInput = {
        page: input.movementsPage,
        limit: input.movementsLimit,
        ...(input.locationId && { locationId: input.locationId }),
      };

      const [
        levels,
        movements,
        products,
        locations,
        transfers,
        returnedOrders,
        reconciliations,
      ] = await Promise.all([
        getInventoryService().listLevels(levelsInput),
        getInventoryService().listMovements(
          movementsInput,
          ctx.user,
          ctx.currentBranchId ?? null,
          ctx.effectiveBranchIds,
        ),
        getProductsService().listOptions(
          {},
          ctx.user.id,
          ctx.user.role,
        ),
        getLogisticsService().listLocationOptions({ status: 'ACTIVE' }),
        getInventoryService().listTransfers(undefined, ctx.user).then((r) => r.transfers),
        canSeeReturned
          ? getInventoryService().listReturnedOrders(input.locationId)
          : Promise.resolve([]),
        canSeeReconciliations
          ? getInventoryService().listReconciliations(input.locationId)
          : Promise.resolve([]),
      ]);

      return {
        levels,
        movements,
        products,
        locations,
        transfers,
        returnedOrders,
        reconciliations,
      };
    }),

  /**
   * Single-request bundle for `/admin/inventory` page loader.
   *
   * Replaces 9 parallel HTTP round-trips — `inventory.levels`,
   * `inventory.movements`, `products.options`, `logistics.locationOptions`
   * (warehouse-only), `logistics.locationOptions` (display labels),
   * `settings.getSystemSettings`, `inventory.lowStockAlerts`,
   * `inventory.shipments.list`, and `inventory.warehouses.list` — with one
   * request. Same fan-out runs server-side via `Promise.all`.
   *
   * The `orders.deliveryMovementCustomerNames` follow-up still runs as a
   * separate request because it depends on the resolved movements payload.
   */
  inventoryAdminPageBundle: permissionProcedure('inventory.read')
    .input(
      z.object({
        // Levels filter scope.
        productId: z.string().uuid().optional(),
        locationId: z.string().uuid().optional(),
        shipmentId: z.string().uuid().optional(),
        search: z.string().trim().min(1).max(100).optional(),
        sortBy: z.enum(['updatedAt', 'available']).default('updatedAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
        levelsPage: z.number().int().min(1).default(1),
        levelsLimit: z.number().int().min(1).max(100).default(20),
        // Shipments page (single-page strip on the page).
        shipmentsLimit: z.number().int().min(1).max(200).default(100),
        warehousesLimit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const levelsInput = {
        page: input.levelsPage,
        limit: input.levelsLimit,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
        ...(input.productId && { productId: input.productId }),
        ...(input.locationId && { locationId: input.locationId }),
        ...(input.shipmentId && { shipmentId: input.shipmentId }),
        ...(input.search && { search: input.search }),
      };
      const movementsInput = {
        page: 1,
        limit: 50,
        sortBy: 'createdAt' as const,
        sortOrder: 'desc' as const,
        // Trace a single shipment's intake into the movement log when the user navigates
        // here from a Shipment detail page (button "View shipment stock"). Same scope rules
        // apply (referenceId IN shipment_lines for this shipment) — see InventoryService.listMovements.
        ...(input.shipmentId && { shipmentId: input.shipmentId }),
      };

      const [
        levels,
        movements,
        products,
        warehouseLocations,
        displayLocations,
        systemSettings,
        lowStockAlerts,
        locationThresholds,
        shipments,
        warehouses,
      ] = await Promise.all([
        getInventoryService().listLevels(levelsInput, ctx.activeGroupId),
        getInventoryService().listMovements(
          movementsInput,
          ctx.user,
          ctx.currentBranchId ?? null,
          ctx.effectiveBranchIds,
        ),
        getProductsService().listOptions(
          {},
          ctx.user.id,
          ctx.user.role,
          ctx.activeGroupId,
        ),
        getLogisticsService().listLocationOptions({
          status: 'ACTIVE',
          providerKind: 'WAREHOUSE',
          groupId: ctx.activeGroupId,
        }),
        getLogisticsService().listLocationOptions({ status: 'ACTIVE', groupId: ctx.activeGroupId }),
        getSettingsService().getAll(ctx.activeGroupId).catch(() => [] as unknown[]),
        getInventoryService().getLowStockAlerts(ctx.activeGroupId).catch((err) => {
          console.error('[inventoryAdminPageBundle] getLowStockAlerts failed:', err?.message ?? err);
          return { threshold: 10, items: [] as unknown[] };
        }),
        getInventoryService()
          .listLocationThresholds()
          .catch(() => ({ globalThreshold: 10, locations: [] as Array<unknown> })),
        getShipmentsService()
          .listShipments(
            { page: 1, limit: input.shipmentsLimit },
            ctx.user,
            ctx.currentBranchId ?? null,
            ctx.effectiveBranchIds,
            ctx.activeGroupId,
          )
          .catch(() => null),
        getLogisticsServiceForInventory()
          .listWarehouses({ status: 'ACTIVE', listScope: 'our', page: 1, limit: input.warehousesLimit, groupId: ctx.activeGroupId })
          .catch(() => null),
      ]);

      return {
        levels,
        movements,
        products,
        warehouseLocations,
        displayLocations,
        systemSettings,
        lowStockAlerts,
        locationThresholds,
        shipments,
        warehouses,
      };
    }),

  /**
   * Check dispatch lock status for a location.
   */
  dispatchLockStatus: authedProcedure
    .input(z.object({ locationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return { locked: await getInventoryService().isDispatchLocked(input.locationId) };
    }),

  // ============================================
  // Inbound shipments — multi-line supplier receipts
  // ============================================
  shipments: router({
    list: permissionProcedure('inventory.shipments.read')
      .input(listShipmentsSchema)
      .query(async ({ input, ctx }) => {
        return getShipmentsService().listShipments(input, ctx.user, ctx.currentBranchId ?? null, ctx.effectiveBranchIds, ctx.activeGroupId);
      }),

    get: permissionProcedure('inventory.shipments.read')
      .input(getShipmentSchema)
      .query(async ({ input, ctx }) => {
        return getShipmentsService().getShipment(
          input.shipmentId,
          ctx.user,
          ctx.currentBranchId ?? null,
          ctx.effectiveBranchIds,
        );
      }),

    create: permissionProcedure('inventory.intake')
      .input(createShipmentSchema)
      .mutation(async ({ input, ctx }) => {
        return getShipmentsService().createShipment(input, ctx.user);
      }),

    updateLines: permissionProcedure('inventory.intake')
      .input(updateShipmentLinesSchema)
      .mutation(async ({ input, ctx }) => {
        return getShipmentsService().updateShipmentLines(input, ctx.user);
      }),

    markInTransit: permissionProcedure('inventory.intake')
      .input(shipmentTransitionSchema)
      .mutation(async ({ input, ctx }) => {
        return getShipmentsService().markInTransit(input, ctx.user);
      }),

    markArrived: permissionProcedure('inventory.intake')
      .input(shipmentTransitionSchema)
      .mutation(async ({ input, ctx }) => {
        return getShipmentsService().markArrived(input, ctx.user);
      }),

    verify: permissionProcedure('inventory.verifyTransfer')
      .input(verifyShipmentSchema)
      .mutation(async ({ input, ctx }) => {
        return getShipmentsService().verifyShipment(input, ctx.user);
      }),

    close: permissionProcedure('inventory.verifyTransfer')
      .input(shipmentTransitionSchema)
      .mutation(async ({ input, ctx }) => {
        return getShipmentsService().closeShipment(input, ctx.user);
      }),

    cancel: permissionProcedure('inventory.intake')
      .input(cancelShipmentSchema)
      .mutation(async ({ input, ctx }) => {
        return getShipmentsService().cancelShipment(input, ctx.user);
      }),
  }),

  // ============================================
  // Company-owned warehouses (provider kind WAREHOUSE) — distinct from 3PL partners
  // ============================================
  warehouses: router({
    list: permissionProcedure('inventory.read')
      .input(listWarehousesSchema)
      .query(async ({ input, ctx }) => {
        return getLogisticsServiceForInventory().listWarehouses({ ...input, groupId: ctx.activeGroupId });
      }),

    overview: permissionProcedure('inventory.read')
      .query(async ({ ctx }) => {
        return getLogisticsServiceForInventory().getWarehousesOverview({ status: 'ACTIVE', groupId: ctx.activeGroupId });
      }),

    get: permissionProcedure('inventory.read')
      .input(z.object({ warehouseId: z.string().uuid() }))
      .query(async ({ input }) => {
        return getLogisticsServiceForInventory().getWarehouseById(input.warehouseId);
      }),

    create: permissionProcedure('inventory.warehouses.write')
      .input(createWarehouseSchema)
      .mutation(async ({ input, ctx }) => {
        return getLogisticsServiceForInventory().createWarehouse(
          { name: input.name, address: input.address, coordinates: input.coordinates },
          ctx.user.id,
        );
      }),

    update: permissionProcedure('inventory.warehouses.write')
      .input(updateWarehouseSchema)
      .mutation(async ({ input, ctx }) => {
        return getLogisticsServiceForInventory().updateWarehouse(
          {
            warehouseId: input.warehouseId,
            name: input.name,
            address: input.address,
            coordinates: input.coordinates,
          },
          ctx.user.id,
        );
      }),
  }),
});
