import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import {
  stockIntakeSchema,
  stockTransferSchema,
  verifyTransferSchema,
  stockAdjustmentSchema,
  listInventorySchema,
  listMovementsSchema,
  createReconciliationSchema,
  resolveReconciliationSchema,
} from '@yannis/shared';
import type { InventoryService } from '../../inventory/inventory.service';

let inventoryServiceInstance: InventoryService | null = null;

export function setInventoryService(service: InventoryService) {
  inventoryServiceInstance = service;
}

function getInventoryService(): InventoryService {
  if (!inventoryServiceInstance) {
    throw new Error('InventoryService not initialized. Call setInventoryService() first.');
  }
  return inventoryServiceInstance;
}

export const inventoryRouter = router({
  /**
   * List inventory levels — filtered by product/location.
   */
  levels: authedProcedure
    .input(listInventorySchema)
    .query(async ({ input }) => {
      return getInventoryService().listLevels(input);
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
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      return getInventoryService().levelDetail(input.productId, input.locationId, input.limit);
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
   * Verify transfer receipt — 3PL Manager.
   */
  verifyTransfer: permissionProcedure('inventory.verifyTransfer')
    .input(verifyTransferSchema)
    .mutation(async ({ input, ctx }) => {
      return getInventoryService().verifyTransfer(input, ctx.user);
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
    .query(async ({ input }) => {
      return getInventoryService().listMovements(input);
    }),

  /**
   * List stock transfers.
   */
  transfers: authedProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      return getInventoryService().listTransfers(input.status);
    }),

  /**
   * Low stock alerts — products below threshold.
   */
  lowStockAlerts: permissionProcedure('inventory.lowStockAlerts')
    .query(async () => {
      return getInventoryService().getLowStockAlerts();
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
   * Check dispatch lock status for a location.
   */
  dispatchLockStatus: authedProcedure
    .input(z.object({ locationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return { locked: await getInventoryService().isDispatchLocked(input.locationId) };
    }),
});
