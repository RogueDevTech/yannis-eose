import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import type { VoipService } from '../../voip/voip.service';

let voipServiceInstance: VoipService | null = null;

export function setVoipServiceForRouter(service: VoipService) {
  voipServiceInstance = service;
}

function getVoipService(): VoipService {
  if (!voipServiceInstance) {
    throw new Error('VoipService not initialized. Call setVoipServiceForRouter() first.');
  }
  return voipServiceInstance;
}

export const voipRouter = router({
  /**
   * Check if VOIP is enabled and what the active provider is. Any authenticated user can read
   * this — agents need to know whether VOIP is on so the UI can show the Call panel.
   * `provider` and `providerDisplayName` survive for forward-compat with future providers.
   */
  isEnabled: authedProcedure.query(async () => {
    const service = getVoipService();
    const [enabled, provider] = await Promise.all([
      service.isVoipEnabled(),
      service.getActiveProviderName(),
    ]);
    const active = (await service.getActiveProvider());
    return {
      enabled,
      provider,
      providerDisplayName: active.displayName,
      supportsBrowserClient: active.supportsBrowserClient,
    };
  }),

  /**
   * SuperAdmin: list all registered providers with whether each is configured. Drives the
   * provider dropdown in Settings — unconfigured providers are shown but disabled with a
   * tooltip listing the env vars the admin needs to set.
   */
  listProviders: permissionProcedure('settings.write').query(async () => {
    return getVoipService()
      .listProviders()
      .map((p) => ({
        name: p.name,
        displayName: p.displayName,
        configured: p.isConfigured(),
        requiredEnvVars: p.requiredEnvVars(),
        supportsBrowserClient: p.supportsBrowserClient,
      }));
  }),

  /**
   * SuperAdmin: switch the active VOIP provider. Refuses if the target's env vars aren't set.
   * The enum is narrow today (only AT) — extend as new providers land.
   */
  setProvider: permissionProcedure('settings.write')
    .input(z.object({ provider: z.enum(['africas_talking']) }))
    .mutation(async ({ input, ctx }) => {
      return getVoipService().setActiveProvider(input.provider, ctx.user.id);
    }),

  /**
   * Toggle VOIP feature flag. SuperAdmin only. Validates the active provider's creds first.
   */
  setEnabled: permissionProcedure('settings.write')
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      return getVoipService().setVoipEnabled(input.enabled, ctx.user.id);
    }),

  /**
   * Get call status by call log ID (for frontend polling).
   */
  callStatus: authedProcedure
    .input(z.object({ callLogId: z.string() }))
    .query(async ({ input }) => {
      const call = await getVoipService().getCallLog(input.callLogId);
      return {
        callStatus: call.callStatus,
        durationSeconds: call.durationSeconds,
        recordingUrl: call.recordingUrl,
      };
    }),

  /**
   * Release expired order locks (admin utility).
   */
  releaseExpiredLocks: permissionProcedure('settings.write')
    .mutation(async ({ ctx }) => {
      const count = await getVoipService().releaseExpiredLocks(ctx.user?.id ?? null);
      return { released: count };
    }),
});
