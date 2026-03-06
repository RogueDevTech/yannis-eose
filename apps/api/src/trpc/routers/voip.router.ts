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
   * Check if VOIP feature is enabled.
   * Any authenticated user can check (CS agents need to know the mode).
   */
  isEnabled: authedProcedure.query(async () => {
    const enabled = await getVoipService().isVoipEnabled();
    return { enabled };
  }),

  /**
   * Toggle VOIP feature flag. SuperAdmin only.
   */
  setEnabled: permissionProcedure('settings.write')
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      return getVoipService().setVoipEnabled(input.enabled, ctx.user.id);
    }),

  /**
   * Generate a Twilio access token for WebRTC browser client.
   * CS agents call this to register their browser as a VOIP endpoint.
   */
  generateToken: authedProcedure.mutation(async ({ ctx }) => {
    return getVoipService().generateAccessToken(ctx.user.id);
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
