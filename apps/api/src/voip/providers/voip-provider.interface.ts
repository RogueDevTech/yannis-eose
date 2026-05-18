import { db as schema } from '@yannis/shared';

/**
 * The set of recognized VOIP providers. Stored as the `provider` field in the
 * `VOIP_PROVIDER` system setting; each value maps to a concrete `VoipProvider`
 * implementation registered in `VoipModule`.
 *
 * Africa's Talking is the only live provider. The abstraction is preserved so a future
 * provider (e.g. Termii, a self-hosted SIP gateway, another regional carrier) can be plugged
 * in without touching the orchestrator. To add one:
 *   1. Add its slug to this union.
 *   2. Implement the `VoipProvider` interface in `providers/<name>.provider.ts`.
 *   3. Register it in `VoipModule`.
 *   4. Wire its slug into `VoipService.providerByName()` switch.
 */
export type VoipProviderName = 'africas_talking';

export type CallStatus =
  | 'INITIATED'
  | 'RINGING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'NO_ANSWER'
  | 'BUSY';

export type Order = typeof schema.orders.$inferSelect;
export type CallLog = typeof schema.callLogs.$inferSelect;

/** Result of an outbound call attempt. `providerError` surfaces vendor-specific text for debugging. */
export interface InitiateCallResult {
  success: boolean;
  providerError?: string;
}

/** Optional access-token issuance for browser-side VOIP SDKs. Only some providers need this. */
export interface AccessToken {
  token: string;
  identity: string;
}

/**
 * Interface every VOIP provider implements. The orchestrator (`VoipService`) reads the active
 * provider from settings and delegates to it. New providers should be drop-in: implement these
 * methods and the rest of the system stays unchanged.
 */
export interface VoipProvider {
  /** Stable identifier — must match a `VoipProviderName`. */
  readonly name: VoipProviderName;

  /** Human-readable name for UI display (e.g. "Africa's Talking"). */
  readonly displayName: string;

  /**
   * Whether the provider's required env credentials are present. Used by the settings UI to
   * show which providers are actually selectable, and by the toggle endpoint to validate
   * that switching is safe.
   */
  isConfigured(): boolean;

  /** List the env vars the provider expects. Surfaced to admins when validation fails. */
  requiredEnvVars(): readonly string[];

  /**
   * Place the call. Implementations dispatch via REST (preferred) or SDK. Update the call_log
   * status to `FAILED` themselves on hard failures so the caller sees the latest state via
   * `voip.service.ts` re-fetches the call_log after this method returns so the client sees
   * FAILED immediately if the provider's REST call rejected.
   */
  initiateCall(callLog: CallLog, order: Order): Promise<InitiateCallResult>;

  /**
   * Translate a provider-specific status string (e.g. AT's "Ringing" / "Active" / "Completed")
   * into the internal `CallStatus` enum. Lower-case input to be safe; map unknown statuses to
   * `FAILED` rather than crashing.
   */
  mapWebhookStatus(rawStatus: string): CallStatus;

  /**
   * Generate a browser-side access token. Throw `TRPCError` if not supported by this provider
   * (e.g. Africa's Talking with phone-bridging doesn't need a browser token). The frontend
   * checks `provider.supportsBrowserClient` before requesting one.
   */
  generateAccessToken?(agentId: string): Promise<AccessToken>;

  /**
   * Whether the provider expects the agent's browser to register as a softphone vs. calling
   * the agent's physical phone directly. Drives frontend UX:
   *   - true  → in-browser modal with mute/hangup, browser microphone needed.
   *   - false → "your phone is ringing" toast, server-side bridging only.
   */
  readonly supportsBrowserClient: boolean;
}
