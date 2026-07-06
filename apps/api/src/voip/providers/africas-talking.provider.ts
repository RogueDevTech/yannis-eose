import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../../database/database.module';
import { EventsService } from '../../events/events.service';
import type {
  CallLog,
  CallStatus,
  InitiateCallResult,
  Order,
  VoipProvider,
} from './voip-provider.interface';

/**
 * Normalize Nigerian local format (0XXXXXXXXX) to E.164 (+234XXXXXXXXX) for AT.
 * Africa's Talking voice API expects E.164 with the leading +.
 */
function toE164Nigeria(phone: string): string {
  const trimmed = phone.trim();
  const match = trimmed.match(/^0(\d{10})$/);
  if (match) return `+234${match[1]}`;
  return trimmed;
}

/**
 * Africa's Talking implementation of `VoipProvider`.
 *
 * Bridging model — phone-to-phone, no browser SDK:
 *   1. Server POSTs to AT's `/voice/call` with `from = AT_PHONE_NUMBER`, `to = AGENT_PHONE`.
 *   2. AT calls the agent's mobile/landline first.
 *   3. When the agent picks up, AT fetches our voice action XML at `/voip/voice/africas-talking`
 *      which responds with `<Dial phoneNumbers="+234CUSTOMER" />` — bridging the two parties.
 *   4. Status updates land at `/voip/webhook/africas-talking` (configured per AT app).
 *
 * Why phone-to-phone instead of browser WebRTC: Nigerian agents on mobile data have flaky
 * audio; physical-phone bridging is rock-solid and priced in NGN.
 *
 * Required env: AT_USERNAME, AT_API_KEY, AT_PHONE_NUMBER (the originator caller-ID).
 * Agent must have `users.phone` populated — the call fails with a clear error otherwise.
 */
@Injectable()
export class AfricasTalkingProvider implements VoipProvider {
  readonly name = 'africas_talking' as const;
  readonly displayName = "Africa's Talking";
  readonly supportsBrowserClient = false;

  private readonly logger = new Logger(AfricasTalkingProvider.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      process.env['AT_USERNAME'] && process.env['AT_API_KEY'] && process.env['AT_PHONE_NUMBER'],
    );
  }

  requiredEnvVars(): readonly string[] {
    return ['AT_USERNAME', 'AT_API_KEY', 'AT_PHONE_NUMBER'];
  }

  async initiateCall(callLog: CallLog, order: Order): Promise<InitiateCallResult> {
    const username = process.env['AT_USERNAME'];
    const apiKey = process.env['AT_API_KEY'];
    const fromNumber = process.env['AT_PHONE_NUMBER'];
    // AT supports multiple environments via different endpoints. Prod is `api.africastalking.com`,
    // sandbox is `api.sandbox.africastalking.com`. Override via env when testing.
    const apiBase =
      process.env['AT_API_BASE'] ?? 'https://voice.africastalking.com';

    if (!username || !apiKey || !fromNumber) {
      return { success: false, providerError: "Africa's Talking credentials missing at call time" };
    }

    const customerPhone = order.customerPhone?.trim();
    if (!customerPhone) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Cannot place VOIP call: customer phone number is not available for this order.',
      });
    }

    // AT calls the AGENT's phone first (then bridges to customer via voice action XML).
    // Look up the agent's phone — they need to have it set in their profile.
    const [agent] = await this.db
      .select({ phone: schema.users.phone })
      .from(schema.users)
      .where(eq(schema.users.id, callLog.agentId))
      .limit(1);

    const agentPhone = agent?.phone?.trim();
    if (!agentPhone) {
      await this.markFailed(callLog);
      return {
        success: false,
        providerError:
          "Agent phone number is not set. Africa's Talking calls the agent's phone first. Add a phone number in your profile.",
      };
    }

    try {
      // AT's call API: POST /call with form-urlencoded { username, from, to, clientRequestId? }.
      // We pass `clientRequestId` so AT echoes it back on the status webhook — that's how we
      // correlate the webhook back to our call_log row (their sessionId is opaque + only known
      // after the response).
      const params = new URLSearchParams();
      params.append('username', username);
      params.append('from', toE164Nigeria(fromNumber));
      params.append('to', toE164Nigeria(agentPhone));
      params.append('clientRequestId', callLog.callToken ?? callLog.id);

      const response = await fetch(`${apiBase}/call`, {
        method: 'POST',
        headers: {
          apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`AT API error orderId=${order.id} callLogId=${callLog.id}: ${errorBody}`);
        await this.markFailed(callLog);
        return { success: false, providerError: errorBody };
      }

      // AT returns: { entries: [{ phoneNumber, status, sessionId, errorMessage? }], errorMessage? }
      // status of the FIRST leg ("Queued" / "Failed"). We don't act on this — webhooks tell
      // the real story — but log it for forensic debugging.
      const body = (await response.json().catch(() => ({}))) as {
        entries?: Array<{ phoneNumber: string; status: string; sessionId?: string; errorMessage?: string }>;
        errorMessage?: string;
      };
      const firstEntry = body.entries?.[0];
      if (firstEntry?.status && firstEntry.status.toLowerCase() !== 'queued') {
        this.logger.warn(
          `AT call entry not queued orderId=${order.id} callLogId=${callLog.id} status=${firstEntry.status} err=${firstEntry.errorMessage ?? 'n/a'}`,
        );
      }

      this.logger.log(
        `AT call initiated orderId=${order.id} callLogId=${callLog.id} agentPhone=${agentPhone.slice(-4)} sessionId=${firstEntry?.sessionId ?? 'unknown'}`,
      );
      return { success: true };
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `AT call initiation error orderId=${order.id} callLogId=${callLog.id}:`,
        error,
      );
      await this.markFailed(callLog);
      return { success: false, providerError: errMessage };
    }
  }

  /**
   * Map AT's call status strings → internal CallStatus.
   * AT statuses (from voice webhook payload field `status`):
   *   "Queued" | "Ringing" | "Active" | "Completed" | "Busy" | "NoAnswer" | "Failed"
   *   plus event-specific values like "InsufficientCredit" / "Hangup".
   */
  mapWebhookStatus(rawStatus: string): CallStatus {
    const statusMap: Record<string, CallStatus> = {
      queued: 'INITIATED',
      ringing: 'RINGING',
      active: 'IN_PROGRESS',
      'in-progress': 'IN_PROGRESS',
      completed: 'COMPLETED',
      hangup: 'COMPLETED',
      busy: 'BUSY',
      noanswer: 'NO_ANSWER',
      'no-answer': 'NO_ANSWER',
      failed: 'FAILED',
      insufficientcredit: 'FAILED',
      cancelled: 'FAILED',
      canceled: 'FAILED',
    };
    return statusMap[rawStatus.toLowerCase()] ?? 'FAILED';
  }

  // No browser SDK — the agent's physical phone rings. `supportsBrowserClient = false`
  // tells the frontend not to try to obtain a token.

  /**
   * Mark the call log FAILED and notify subscribers. The orchestrator re-fetches the row
   * after `initiateCall` returns, so this update propagates to the UI immediately.
   */
  private async markFailed(callLog: CallLog): Promise<void> {
    await this.db
      .update(schema.callLogs)
      .set({ callStatus: 'FAILED' })
      .where(eq(schema.callLogs.id, callLog.id));
    this.events.emitToRoom(`order:${callLog.orderId}`, 'call:status_changed', {
      callLogId: callLog.id,
      orderId: callLog.orderId,
      status: 'FAILED',
    });
  }
}
