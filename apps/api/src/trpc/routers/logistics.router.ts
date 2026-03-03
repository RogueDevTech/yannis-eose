import {
  createProviderSchema,
  updateProviderSchema,
  listProvidersSchema,
  createLocationSchema,
  updateLocationSchema,
  listLocationsSchema,
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
});
