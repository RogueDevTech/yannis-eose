import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema, canonicalPermissionCode } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { EventsService } from '../events/events.service';
import { SettingsService } from '../settings/settings.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { randomUUID } from 'crypto';
import { AfricasTalkingProvider } from './providers/africas-talking.provider';
import type {
  CallStatus,
  VoipProvider,
  VoipProviderName,
} from './providers/voip-provider.interface';

type CallLog = typeof schema.callLogs.$inferSelect;

const VOIP_ENABLED_KEY = 'VOIP_ENABLED';
const VOIP_PROVIDER_KEY = 'VOIP_PROVIDER';
const VOIP_ENABLED_CACHE_KEY = 'yannis:voip:enabled';
const VOIP_PROVIDER_CACHE_KEY = 'yannis:voip:provider';
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const DEFAULT_PROVIDER: VoipProviderName = 'africas_talking';

/** Normalize Nigerian local format (0XXXXXXXXX) to E.164 (+234XXXXXXXXX). Both providers expect E.164. */
function toE164Nigeria(phone: string): string {
  const trimmed = phone.trim();
  const match = trimmed.match(/^0(\d{10})$/);
  if (match) return `+234${match[1]}`;
  return trimmed;
}

/**
 * VOIP orchestrator. Owns the per-order locking, call-log lifecycle, and webhook fan-out.
 * Provider-specific work (AT's phone-to-phone bridging via REST + voice-action XML) is
 * delegated to the `VoipProvider` keyed by `VOIP_PROVIDER` in system settings. Africa's
 * Talking is the only live provider; the abstraction stays so a future provider can be
 * plugged in without touching the orchestrator.
 *
 * Adding a new provider:
 *   1. Implement `VoipProvider` in `providers/<name>.provider.ts`.
 *   2. Add it to `VoipModule` providers + `providerByName()` switch below.
 *   3. Add a webhook route in `voip.controller.ts` if its payload format differs.
 *   No DB changes — `call_logs.callToken` is provider-agnostic.
 */
@Injectable()
export class VoipService {
  private readonly logger = new Logger(VoipService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: EventsService,
    private readonly settingsService: SettingsService,
    private readonly atProvider: AfricasTalkingProvider,
  ) {}

  // ─── Feature Flag (on/off) ─────────────────────────────────────

  /** Whether VOIP is enabled at all. Cached in Redis 60s. */
  async isVoipEnabled(): Promise<boolean> {
    const cached = await this.redis.get(VOIP_ENABLED_CACHE_KEY).catch(() => null);
    if (cached !== null) return cached === '1';

    const setting = await this.settingsService.get(VOIP_ENABLED_KEY);
    const enabled = setting?.['enabled'] === true;

    await this.redis.set(VOIP_ENABLED_CACHE_KEY, enabled ? '1' : '0', 'EX', 60).catch(() => undefined);
    return enabled;
  }

  /**
   * Toggle VOIP on/off. SuperAdmin only. Validates that the active provider's credentials
   * are present before enabling — refuses with a clear error otherwise so the admin can
   * configure env vars first instead of getting confusing call failures later.
   */
  async setVoipEnabled(enabled: boolean, actorId: string): Promise<{ enabled: boolean }> {
    if (enabled) {
      const provider = await this.getActiveProvider();
      if (!provider.isConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot enable VOIP: ${provider.displayName} requires these env vars to be set: ${provider.requiredEnvVars().join(', ')}.`,
        });
      }
    }

    await this.settingsService.set(VOIP_ENABLED_KEY, { enabled }, actorId);
    await this.redis.del(VOIP_ENABLED_CACHE_KEY).catch(() => undefined);

    this.logger.log(`VOIP ${enabled ? 'enabled' : 'disabled'} by ${actorId}`);
    return { enabled };
  }

  // ─── Active Provider ───────────────────────────────────────────

  /**
   * Read the active provider slug from settings, fall back to the default. Cached 60s.
   * Returns the slug only — `getActiveProvider()` resolves it to the implementation.
   */
  async getActiveProviderName(): Promise<VoipProviderName> {
    const cached = await this.redis.get(VOIP_PROVIDER_CACHE_KEY).catch(() => null);
    if (cached === 'africas_talking') return cached;

    const setting = await this.settingsService.get(VOIP_PROVIDER_KEY);
    const stored = setting?.['provider'];
    const name: VoipProviderName =
      stored === 'africas_talking' ? stored : DEFAULT_PROVIDER;

    await this.redis.set(VOIP_PROVIDER_CACHE_KEY, name, 'EX', 60).catch(() => undefined);
    return name;
  }

  /** Resolve the active provider implementation. */
  async getActiveProvider(): Promise<VoipProvider> {
    const name = await this.getActiveProviderName();
    return this.providerByName(name);
  }

  /** All registered providers — used by the settings UI to show what's selectable. */
  listProviders(): VoipProvider[] {
    return [this.atProvider];
  }

  /**
   * SuperAdmin: switch the active provider. Refuses to switch to a provider whose env vars
   * aren't set, so the admin doesn't end up enabled-but-broken.
   */
  async setActiveProvider(name: VoipProviderName, actorId: string): Promise<{ provider: VoipProviderName }> {
    const provider = this.providerByName(name);
    if (!provider.isConfigured()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Cannot switch to ${provider.displayName}: missing env vars ${provider.requiredEnvVars().join(', ')}.`,
      });
    }

    await this.settingsService.set(VOIP_PROVIDER_KEY, { provider: name }, actorId);
    await this.redis.del(VOIP_PROVIDER_CACHE_KEY).catch(() => undefined);

    this.logger.log(`VOIP provider switched to ${name} by ${actorId}`);
    return { provider: name };
  }

  private providerByName(name: VoipProviderName): VoipProvider {
    switch (name) {
      case 'africas_talking':
        return this.atProvider;
      default: {
        // Exhaustive match — TS will error if a new VoipProviderName is added without handling.
        const _exhaustive: never = name;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Unknown VOIP provider: ${String(_exhaustive)}`,
        });
      }
    }
  }

  // ─── Initiate Call ─────────────────────────────────────────────

  /**
   * Initiate a call for a CS_ENGAGED order.
   *   - VOIP disabled        → log a MANUAL_CALL entry (no provider call).
   *   - VOIP enabled         → delegate to the active provider's `initiateCall()`.
   *   - Active provider unconfigured → fail loudly (not silent-mock — that hides bugs).
   *
   * `providerError` echoes any vendor-specific error string for client-side debugging.
   * Re-fetches the call log after the provider returns so the client sees the latest status
   * (e.g. FAILED set by the provider on REST error).
   */
  async initiateCall(
    orderId: string,
    actor: SessionUser,
  ): Promise<{ callLog: CallLog; providerError?: string }> {
    const voipEnabled = await this.isVoipEnabled();

    type CallInitResult = { callLog: CallLog; order: typeof schema.orders.$inferSelect; isManual: boolean };
    const { callLog, order, isManual } = await withActor(this.db, actor, async (tx): Promise<CallInitResult> => {
      const orderRows = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1);

      const foundOrder = orderRows[0];
      if (!foundOrder) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }
      if (foundOrder.status !== 'CS_ENGAGED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot initiate call: order is in ${foundOrder.status} status, must be CS_ENGAGED`,
        });
      }

      const voipPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
      const isElevated =
        actor.role === 'SUPER_ADMIN' ||
        voipPerms.includes(canonicalPermissionCode('cs.scope.global')) ||
        voipPerms.includes(canonicalPermissionCode('orders.update.any_branch'));
      if (!isElevated && foundOrder.assignedCsId !== actor.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not assigned to this order' });
      }

      if (!voipEnabled) {
        // Manual fallback — VOIP feature flag is off; agent calls from their personal phone
        // and the system records the attempt as a manual log entry.
        const manualRows = await tx
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
        return { callLog: manualRows[0]!, order: foundOrder, isManual: true };
      }

      // Block if there's already an in-flight call on this order.
      const activeCallRows = await tx
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

      const callToken = randomUUID();
      const insertedRows = await tx
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

      const inserted = insertedRows[0];
      if (!inserted) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create call log' });
      }

      await tx
        .update(schema.orders)
        .set({
          lockedBy: actor.id,
          lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      return { callLog: inserted, order: foundOrder, isManual: false };
    });

    // Manual-call path short-circuits — no provider involvement.
    if (isManual) {
      this.events.emitToRoom(`order:${orderId}`, 'call:status_changed', {
        callLogId: callLog.id,
        orderId,
        status: 'MANUAL_CALL',
      });
      return { callLog };
    }

    // Provider delegation. If env isn't configured we still go through the provider so it
    // can return a descriptive error — silent-mock paths used to hide misconfigurations
    // until the first real call failed at runtime.
    const provider = await this.getActiveProvider();
    let providerError: string | undefined;
    if (provider.isConfigured()) {
      const result = await provider.initiateCall(callLog, order);
      providerError = result.providerError;
    } else {
      // Configured-required path: fail visibly. Admins can either configure env or pick a
      // different provider in Settings.
      providerError = `${provider.displayName} is selected as the active provider but its credentials are not configured (${provider.requiredEnvVars().join(', ')}). Configure env vars or switch provider in Settings.`;
      await this.db
        .update(schema.callLogs)
        .set({ callStatus: 'FAILED' })
        .where(eq(schema.callLogs.id, callLog.id));
    }

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

    const reFetched = await this.getCallLog(callLog.id);
    return { callLog: reFetched, providerError };
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

  // ─── Voice-action helpers (used by provider-specific controller routes) ──

  /**
   * Resolve the customer phone for a given callToken — used by the AT voice-action XML
   * endpoint to know who to bridge the agent to once their leg goes active. Returns null when
   * the call_log or order is missing or has no customer phone.
   */
  async lookupCustomerPhoneByCallToken(callToken: string): Promise<string | null> {
    if (!callToken) return null;
    const [row] = await this.db
      .select({ customerPhone: schema.orders.customerPhone })
      .from(schema.callLogs)
      .innerJoin(schema.orders, eq(schema.callLogs.orderId, schema.orders.id))
      .where(eq(schema.callLogs.callToken, callToken))
      .limit(1);

    const raw = row?.customerPhone?.trim();
    if (!raw) return null;
    // Reuse Nigerian E.164 normalization (kept as a static helper below) so the customer
    // number going into the Dial XML is always +234... — AT requires this.
    return toE164Nigeria(raw);
  }

  // ─── Webhook ───────────────────────────────────────────────────

  /**
   * Handle a status webhook from any provider. Caller (controller) is responsible for parsing
   * the provider-specific payload and resolving the right provider so we can map its status
   * vocabulary. The shared work — find the call log, persist new status, emit Socket.io events,
   * release the order lock when terminal — happens here.
   */
  async handleWebhookStatusUpdate(
    callToken: string,
    rawStatus: string,
    duration: number | undefined,
    providerName: VoipProviderName,
  ): Promise<CallLog> {
    const rows = await this.db
      .select()
      .from(schema.callLogs)
      .where(eq(schema.callLogs.callToken, callToken))
      .limit(1);

    const callLog = rows[0];
    if (!callLog) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Call log not found for this token' });
    }

    const provider = this.providerByName(providerName);
    const mappedStatus = provider.mapWebhookStatus(rawStatus);
    const updated = await this.updateCallStatus(callLog.id, mappedStatus, duration);

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

    if (['COMPLETED', 'FAILED', 'BUSY', 'NO_ANSWER'].includes(mappedStatus)) {
      await this.db
        .update(schema.orders)
        .set({ lockedBy: null, lockedUntil: null, updatedAt: new Date() })
        .where(eq(schema.orders.id, callLog.orderId));
    }

    return updated;
  }

  // ─── Lock Management ───────────────────────────────────────────

  async releaseExpiredLocks(actorId?: string | null): Promise<number> {
    const runUpdate = async (
      db:
        | PostgresJsDatabase<typeof schema>
        | Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0],
    ) =>
      db
        .update(schema.orders)
        .set({ lockedBy: null, lockedUntil: null, updatedAt: new Date() })
        .where(
          and(
            sql`${schema.orders.lockedUntil} IS NOT NULL`,
            sql`${schema.orders.lockedUntil} < NOW()`,
          ),
        )
        .returning({ id: schema.orders.id });

    const result = actorId
      ? await withActor(this.db, { id: actorId }, (tx) => runUpdate(tx))
      : await runUpdate(this.db);

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
    const updateFields: Record<string, unknown> = { callStatus: status };
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
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update call status' });
    }
    return updated;
  }
}
