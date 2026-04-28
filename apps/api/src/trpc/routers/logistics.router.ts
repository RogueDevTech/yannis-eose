import {
  createProviderSchema,
  updateProviderSchema,
  listProvidersSchema,
  createLocationSchema,
  updateLocationSchema,
  listLocationsSchema,
  createRemittanceSchema,
  listRemittancesSchema,
  markRemittanceReceivedSchema,
  createDeliveryRemittanceSchema,
  listDeliveryRemittancesSchema,
  listDeliveryRemittanceEligibleOrdersSchema,
  markDeliveryRemittanceReceivedSchema,
  getDeliveryRemittanceSchema,
  disputeDeliveryRemittanceSchema,
  submitDeliveryConfirmationSchema,
  listDeliveryConfirmationRequestsSchema,
  approveDeliveryConfirmationSchema,
  rejectDeliveryConfirmationSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { LogisticsService } from '../../logistics/logistics.service';

let logisticsServiceInstance: LogisticsService | null = null;

export function setLogisticsService(service: LogisticsService) {
  logisticsServiceInstance = service;
}

function getLogisticsService(): LogisticsService {
  if (!logisticsServiceInstance) {
    throw new Error('LogisticsService not initialized. Call setLogisticsService() first.');
  }
  return logisticsServiceInstance;
}

export const logisticsRouter = router({
  // Providers
  listProviders: authedProcedure
    .input(listProvidersSchema)
    .query(async ({ input }) => {
      return getLogisticsService().listProviders(input);
    }),

  getProvider: authedProcedure
    .input(z.object({ providerId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getLogisticsService().getProviderById(input.providerId);
    }),

  createProvider: permissionProcedure('logistics.write')
    .input(createProviderSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().createProvider(input, ctx.user.id);
    }),

  updateProvider: permissionProcedure('logistics.write')
    .input(updateProviderSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().updateProvider(input, ctx.user.id);
    }),

  // Locations
  listLocations: authedProcedure
    .input(listLocationsSchema)
    .query(async ({ input }) => {
      return getLogisticsService().listLocations(input);
    }),

  createLocation: permissionProcedure('logistics.write')
    .input(createLocationSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().createLocation(input, ctx.user.id);
    }),

  updateLocation: permissionProcedure('logistics.write')
    .input(updateLocationSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().updateLocation(input, ctx.user.id);
    }),

  // Escalation & Monitoring
  shrinkageAlerts: permissionProcedure('logistics.read')
    .query(async () => {
      return getLogisticsService().getShrinkageAlerts();
    }),

  stuckOrders: permissionProcedure('logistics.read')
    .input(z.object({ thresholdHours: z.number().min(1).default(24) }))
    .query(async ({ input }) => {
      return getLogisticsService().getStuckOrders(input.thresholdHours);
    }),

  transferDelays: permissionProcedure('logistics.read')
    .input(z.object({ thresholdHours: z.number().min(1).default(48) }))
    .query(async ({ input }) => {
      return getLogisticsService().getTransferDelays(input.thresholdHours);
    }),

  healthDashboard: permissionProcedure('logistics.read')
    .query(async () => {
      return getLogisticsService().getLogisticsHealthDashboard();
    }),

  /**
   * List riders (TPL_RIDER, ACTIVE) for dispatch assignment dropdowns.
   * Returns id, name, logisticsLocationId. Gated by logistics.read.
   */
  listRiders: permissionProcedure('logistics.read').query(async () => {
    return getLogisticsService().listRiders();
  }),

  // Transfer remittances (3PL → warehouse)
  createRemittance: permissionProcedure('logistics.remit')
    .input(createRemittanceSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().createRemittance(input, ctx.user);
    }),

  listRemittances: permissionProcedure('logistics.read')
    .input(listRemittancesSchema)
    .query(async ({ input, ctx }) => {
      return getLogisticsService().listRemittances(input, ctx.user);
    }),

  markRemittanceReceived: permissionProcedure('logistics.write')
    .input(markRemittanceReceivedSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().markRemittanceReceived(input, ctx.user);
    }),

  // Delivery remittances. Phase 18 (CEO directive 2026-04-29): the accountant
  // (Finance / Finance hat / admin) is the primary creator while 3PL partners
  // are not on-platform. The legacy TPL_MANAGER path still works — service
  // layer is the gate. tRPC stays as `authedProcedure` so the service can run
  // its multi-role check; the explicit `logistics.remit` permission is no
  // longer the right gate now that Finance is the main caller.
  createDeliveryRemittance: authedProcedure
    .input(createDeliveryRemittanceSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().createDeliveryRemittance(input, ctx.user);
    }),

  listDeliveryRemittances: authedProcedure
    .input(listDeliveryRemittancesSchema)
    .query(async ({ input, ctx }) => {
      return getLogisticsService().listDeliveryRemittances(input, ctx.user);
    }),

  listDeliveryRemittanceEligibleOrders: authedProcedure
    .input(listDeliveryRemittanceEligibleOrdersSchema.optional())
    .query(async ({ input, ctx }) => {
      return getLogisticsService().listDeliveryRemittanceEligibleOrders(
        input ?? { page: 1, limit: 100 },
        ctx.user,
      );
    }),

  markDeliveryRemittanceReceived: permissionProcedure('finance.approve')
    .input(markDeliveryRemittanceReceivedSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().markDeliveryRemittanceReceived(input, ctx.user);
    }),

  getDeliveryRemittance: authedProcedure
    .input(getDeliveryRemittanceSchema)
    .query(async ({ input, ctx }) => {
      return getLogisticsService().getDeliveryRemittance(input.deliveryRemittanceId, ctx.user);
    }),

  disputeDeliveryRemittance: permissionProcedure('finance.approve')
    .input(disputeDeliveryRemittanceSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().disputeDeliveryRemittance(input, ctx.user);
    }),

  // Delivery confirmation requests (rider/3PL submit → HOL approve/reject)
  submitDeliveryConfirmation: authedProcedure
    .input(submitDeliveryConfirmationSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().submitDeliveryConfirmation(input, ctx.user);
    }),

  listDeliveryConfirmationRequests: permissionProcedure('logistics.read')
    .input(listDeliveryConfirmationRequestsSchema)
    .query(async ({ input, ctx }) => {
      return getLogisticsService().listDeliveryConfirmationRequests(input, ctx.user);
    }),

  approveDeliveryConfirmation: permissionProcedure('logistics.write')
    .input(approveDeliveryConfirmationSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().approveDeliveryConfirmation(input, ctx.user);
    }),

  rejectDeliveryConfirmation: permissionProcedure('logistics.write')
    .input(rejectDeliveryConfirmationSchema)
    .mutation(async ({ input, ctx }) => {
      return getLogisticsService().rejectDeliveryConfirmation(input, ctx.user);
    }),
});
