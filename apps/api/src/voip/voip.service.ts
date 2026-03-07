import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { DRIZZLE, PG_CLIENT, REDIS } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { SettingsService } from '../settings/settings.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { randomUUID } from 'crypto';

type CallLog = typeof schema.callLogs.$inferSelect;
type CallStatus = 'INITIATED' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'NO_ANSWER' | 'BUSY';

const VOIP_SETTING_KEY = 'VOIP_ENABLED';
const VOIP_CACHE_KEY = 'yannis:voip:enabled';
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class VoipService {
  private readonly logger = new Logger(VoipService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: EventsService,
    private readonly settingsService: SettingsService,
  ) {}

  // ─── Feature Flag ──────────────────────────────────────────────

  /**
   * Check if VOIP is enabled via system settings.
   * Cached in Redis for 60 seconds.
   */
  async isVoipEnabled(): Promise<boolean> {
    const cached = await this.redis.get(VOIP_CACHE_KEY);
    if (cached !== null) return cached === '1';

    const setting = await this.settingsService.get(VOIP_SETTING_KEY);
    const enabled = setting?.['enabled'] === true;

    await this.redis.set(VOIP_CACHE_KEY, enabled ? '1' : '0', 'EX', 60);
    return enabled;
  }

  /**
   * Toggle VOIP feature flag. SuperAdmin only (enforced at router level).
   * Validates Twilio env vars are present before enabling.
   */
  async setVoipEnabled(enabled: boolean, actorId: string): Promise<{ enabled: boolean }> {
    if (enabled) {
      const sid = process.env['TWILIO_ACCOUNT_SID'];
      const token = process.env['TWILIO_AUTH_TOKEN'];
      const phone = process.env['TWILIO_PHONE_NUMBER'];

      if (!sid || !token || !phone) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Cannot enable VOIP: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER must be configured in environment variables.',
        });
      }
    }

    await this.settingsService.set(VOIP_SETTING_KEY, { enabled }, actorId);
    await this.redis.del(VOIP_CACHE_KEY);

    this.logger.log(`VOIP ${enabled ? 'enabled' : 'disabled'} by ${actorId}`);
    return { enabled };
  }

  // ─── Initiate Call ─────────────────────────────────────────────

  /**
   * Initiate a call for a CS_ENGAGED order.
   * When VOIP is enabled and Twilio is configured: places a real Twilio call.
   * When VOIP is enabled but Twilio not configured: uses mock simulation.
   * When VOIP is disabled: creates a MANUAL_CALL log (fallback mode).
   */
  async initiateCall(orderId: string, actor: SessionUser): Promise<CallLog> {
    // Set actor for audit trail
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    // 1. Verify order exists
    const orderRows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const order = orderRows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    // 2. Verify order is in CS_ENGAGED status
    if (order.status !== 'CS_ENGAGED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot initiate call: order is in ${order.status} status, must be CS_ENGAGED`,
      });
    }

    // 3. Verify the agent is assigned to this order (or has elevated role)
    const isElevated = actor.role === 'HEAD_OF_CS' || actor.role === 'SUPER_ADMIN';
    if (!isElevated && order.assignedCsId !== actor.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not assigned to this order',
      });
    }

    // 4. Check VOIP feature flag
    const voipEnabled = await this.isVoipEnabled();

    if (!voipEnabled) {
      // Fallback: create a manual call log entry (no Twilio, no mock)
      const manualRows = await this.db
        .insert(schema.callLogs)
        .values({
          orderId,
          agentId: actor.id,
          callStatus: 'MANUAL_CALL',
          callToken: null,
          durationSeconds: null,
          recordingUrl: null,
          transcript: null,
        })
        .returning();

      const manualLog = manualRows[0]!;

      this.events.emitToRoom(`order:${orderId}`, 'call:status_changed', {
        callLogId: manualLog.id,
        orderId,
        status: 'MANUAL_CALL',
      });

      return manualLog;
    }

    // ── VOIP Mode ─────────────────────────────────────────────

    // 5. Check for active calls on this order
    const activeCallRows = await this.db
      .select()
      .from(schema.callLogs)
      .where(
        and(
          eq(schema.callLogs.orderId, orderId),
          or(
            eq(schema.callLogs.callStatus, 'INITIATED'),
            eq(schema.callLogs.callStatus, 'RINGING'),
            eq(schema.callLogs.callStatus, 'IN_PROGRESS'),
          ),
        ),
      )
      .limit(1);

    if (activeCallRows[0]) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `There is already an active call (${activeCallRows[0].callStatus}) for this order`,
      });
    }

    // 6. Generate call token
    const callToken = randomUUID();

    // 7. Insert call log with INITIATED status
    const insertedRows = await this.db
      .insert(schema.callLogs)
      .values({
        orderId,
        agentId: actor.id,
        callToken,
        callStatus: 'INITIATED',
        durationSeconds: null,
        recordingUrl: null,
        transcript: null,
      })
      .returning();

    const callLog = insertedRows[0];
    if (!callLog) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create call log',
      });
    }

    // 8. Lock the order for 15 minutes (prevents other agents from taking it)
    await this.db
      .update(schema.orders)
      .set({
        lockedBy: actor.id,
        lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, orderId));

    // 9. Initiate call: real Twilio or mock
    if (process.env['TWILIO_ACCOUNT_SID'] && process.env['TWILIO_AUTH_TOKEN']) {
      await this.initiateTwilioCall(callLog, order);
    } else {
      this.simulateMockCall(callLog.id, orderId);
    }

    // Emit initial event
    this.events.emitToRoom(`order:${orderId}`, 'call:status_changed', {
      callLogId: callLog.id,
      orderId,
      status: 'INITIATED',
    });

    this.events.emitToUser(actor.id, 'call:status_changed', {
      callLogId: callLog.id,
      orderId,
      status: 'INITIATED',
    });

    return callLog;
  }

  // ─── Query Helpers ─────────────────────────────────────────────

  async getCallLog(callLogId: string): Promise<CallLog> {
    const rows = await this.db
      .select()
      .from(schema.callLogs)
      .where(eq(schema.callLogs.id, callLogId))
      .limit(1);

    const callLog = rows[0];
    if (!callLog) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Call log not found' });
    }

    return callLog;
  }

  async getCallLogsForOrder(orderId: string): Promise<CallLog[]> {
    return this.db
      .select()
      .from(schema.callLogs)
      .where(eq(schema.callLogs.orderId, orderId))
      .orderBy(desc(schema.callLogs.startedAt));
  }

  async getLatestCallForOrder(orderId: string): Promise<CallLog | null> {
    const rows = await this.db
      .select()
      .from(schema.callLogs)
      .where(eq(schema.callLogs.orderId, orderId))
      .orderBy(desc(schema.callLogs.startedAt))
      .limit(1);

    return rows[0] ?? null;
  }

  // ─── Webhook ───────────────────────────────────────────────────

  /**
   * Handle a Twilio StatusCallback webhook.
   * Updates the call log status and duration, emits Socket.io event.
   */
  async handleWebhookStatusUpdate(
    callToken: string,
    status: string,
    duration?: number,
  ): Promise<CallLog> {
    const rows = await this.db
      .select()
      .from(schema.callLogs)
      .where(eq(schema.callLogs.callToken, callToken))
      .limit(1);

    const callLog = rows[0];
    if (!callLog) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Call log not found for this token',
      });
    }

    const mappedStatus = this.mapTwilioStatus(status);
    const updated = await this.updateCallStatus(callLog.id, mappedStatus, duration);

    // Emit Socket.io events
    this.events.emitToRoom(`order:${callLog.orderId}`, 'call:status_changed', {
      callLogId: callLog.id,
      orderId: callLog.orderId,
      status: mappedStatus,
      durationSeconds: duration ?? null,
    });

    this.events.emitToUser(callLog.agentId, 'call:status_changed', {
      callLogId: callLog.id,
      orderId: callLog.orderId,
      status: mappedStatus,
      durationSeconds: duration ?? null,
    });

    // Release lock when call ends
    if (['COMPLETED', 'FAILED', 'BUSY', 'NO_ANSWER'].includes(mappedStatus)) {
      await this.db
        .update(schema.orders)
        .set({
          lockedBy: null,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, callLog.orderId));
    }

    return updated;
  }

  // ─── Lock Management ───────────────────────────────────────────

  /**
   * Release expired order locks.
   * Can be called periodically via a cron or on-demand.
   * When actorId is provided (e.g. from tRPC), audit trail records that user.
   */
  async releaseExpiredLocks(actorId?: string | null): Promise<number> {
    if (actorId) {
      await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;
    }
    const result = await this.db
      .update(schema.orders)
      .set({
        lockedBy: null,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          sql`${schema.orders.lockedUntil} IS NOT NULL`,
          sql`${schema.orders.lockedUntil} < NOW()`,
        ),
      )
      .returning({ id: schema.orders.id });

    if (result.length > 0) {
      this.logger.log(`Released ${result.length} expired order lock(s)`);
    }

    return result.length;
  }

  // ─── Private ───────────────────────────────────────────────────

  private async updateCallStatus(
    callLogId: string,
    status: CallStatus,
    durationSeconds?: number,
  ): Promise<CallLog> {
    const updateFields: Record<string, unknown> = {
      callStatus: status,
    };

    if (durationSeconds !== undefined) {
      updateFields['durationSeconds'] = durationSeconds;
    }

    const updatedRows = await this.db
      .update(schema.callLogs)
      .set(updateFields)
      .where(eq(schema.callLogs.id, callLogId))
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update call status',
      });
    }

    return updated;
  }

  /**
   * Simulate a mock VOIP call with timed status transitions.
   * Used in development when Twilio credentials are not configured.
   *
   * Timeline: 0s→INITIATED, 2s→RINGING, 5s→IN_PROGRESS, 20s→COMPLETED(20s)
   */
  private simulateMockCall(callLogId: string, orderId: string): void {
    setTimeout(async () => {
      try {
        await this.updateCallStatus(callLogId, 'RINGING');
        this.events.emitToRoom(`order:${orderId}`, 'call:status_changed', {
          callLogId, orderId, status: 'RINGING',
        });
      } catch { /* mock — swallow */ }
    }, 2000);

    setTimeout(async () => {
      try {
        await this.updateCallStatus(callLogId, 'IN_PROGRESS');
        this.events.emitToRoom(`order:${orderId}`, 'call:status_changed', {
          callLogId, orderId, status: 'IN_PROGRESS',
        });
      } catch { /* mock — swallow */ }
    }, 5000);

    setTimeout(async () => {
      try {
        await this.updateCallStatus(callLogId, 'COMPLETED', 20);
        this.events.emitToRoom(`order:${orderId}`, 'call:status_changed', {
          callLogId, orderId, status: 'COMPLETED', durationSeconds: 20,
        });
        // Release lock after mock call completes
        const logRows = await this.db
          .select({ orderId: schema.callLogs.orderId })
          .from(schema.callLogs)
          .where(eq(schema.callLogs.id, callLogId))
          .limit(1);
        if (logRows[0]) {
          await this.db
            .update(schema.orders)
            .set({ lockedBy: null, lockedUntil: null, updatedAt: new Date() })
            .where(eq(schema.orders.id, logRows[0].orderId));
        }
      } catch { /* mock — swallow */ }
    }, 20000);
  }

  /**
   * Initiate a real Twilio call.
   * Connects the agent to the customer via a VOIP bridge.
   */
  private async initiateTwilioCall(
    callLog: CallLog,
    order: typeof schema.orders.$inferSelect,
  ): Promise<void> {
    const accountSid = process.env['TWILIO_ACCOUNT_SID'];
    const authToken = process.env['TWILIO_AUTH_TOKEN'];
    const twilioPhoneNumber = process.env['TWILIO_PHONE_NUMBER'];
    const webhookBaseUrl = process.env['VOIP_WEBHOOK_BASE_URL'] ?? process.env['API_PUBLIC_URL'] ?? 'http://localhost:4444';

    if (!accountSid || !authToken || !twilioPhoneNumber) {
      this.simulateMockCall(callLog.id, callLog.orderId);
      return;
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

      const params = new URLSearchParams();
      params.append('To', order.customerPhoneHash);
      params.append('From', twilioPhoneNumber);
      params.append('StatusCallback', `${webhookBaseUrl}/voip/webhook/status?callToken=${callLog.callToken}`);
      params.append('StatusCallbackEvent', 'initiated ringing answered completed');
      params.append('StatusCallbackMethod', 'POST');
      params.append('Twiml', '<Response><Say>Connecting you to an agent.</Say><Dial><Client>agent_' + callLog.agentId + '</Client></Dial></Response>');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Twilio API error: ${errorBody}`);
        await this.updateCallStatus(callLog.id, 'FAILED');
        this.events.emitToRoom(`order:${callLog.orderId}`, 'call:status_changed', {
          callLogId: callLog.id, orderId: callLog.orderId, status: 'FAILED',
        });
      }
    } catch (error) {
      this.logger.error(`Twilio call initiation error:`, error);
      await this.updateCallStatus(callLog.id, 'FAILED');
      this.events.emitToRoom(`order:${callLog.orderId}`, 'call:status_changed', {
        callLogId: callLog.id, orderId: callLog.orderId, status: 'FAILED',
      });
    }
  }

  /**
   * Generate a Twilio access token for WebRTC browser client.
   * The token allows the agent's browser to register as a Twilio Device
   * and receive/make calls via the VOIP bridge.
   *
   * Requires: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID
   */
  async generateAccessToken(agentId: string): Promise<{ token: string; identity: string }> {
    const voipEnabled = await this.isVoipEnabled();
    if (!voipEnabled) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'VOIP is not enabled. Enable it in Settings first.',
      });
    }

    const accountSid = process.env['TWILIO_ACCOUNT_SID'];
    const apiKeySid = process.env['TWILIO_API_KEY_SID'];
    const apiKeySecret = process.env['TWILIO_API_KEY_SECRET'];
    const twimlAppSid = process.env['TWILIO_TWIML_APP_SID'];

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      // In dev without full Twilio config, return a mock token
      this.logger.warn('Twilio credentials not fully configured — returning mock access token');
      return {
        token: `mock_token_${agentId}_${Date.now()}`,
        identity: `agent_${agentId}`,
      };
    }

    try {
      // Use Twilio's JWT library to generate an access token
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const twilio = require('twilio');
      const AccessToken = twilio.jwt.AccessToken;
      const VoiceGrant = AccessToken.VoiceGrant;

      const identity = `agent_${agentId}`;

      const voiceGrant = new VoiceGrant({
        outgoingApplicationSid: twimlAppSid,
        incomingAllow: true,
      });

      const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
        identity,
        ttl: 3600, // 1 hour
      });

      token.addGrant(voiceGrant);

      return {
        token: token.toJwt(),
        identity,
      };
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
      this.logger.error(
        `Failed to generate Twilio access token: ${errMessage}${errCode != null ? ` [code=${String(errCode)}]` : ''}${errStack ? `\n${errStack}` : ''}`,
      );
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to generate VOIP access token',
      });
    }
  }

  private mapTwilioStatus(twilioStatus: string): CallStatus {
    const statusMap: Record<string, CallStatus> = {
      'queued': 'INITIATED',
      'initiated': 'INITIATED',
      'ringing': 'RINGING',
      'in-progress': 'IN_PROGRESS',
      'completed': 'COMPLETED',
      'failed': 'FAILED',
      'busy': 'BUSY',
      'no-answer': 'NO_ANSWER',
      'canceled': 'FAILED',
    };

    return statusMap[twilioStatus.toLowerCase()] ?? 'FAILED';
  }
}
