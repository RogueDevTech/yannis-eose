import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, desc, eq, isNull, or, lte, inArray, sql } from 'drizzle-orm';
import {
  db as schema,
  SYSTEM_ACTOR_ID,
  automationTriggerSchema,
  type AutomationTrigger,
  type MarketingAutomationEvent,
} from '@yannis/shared';
import type {
  CreateMarketingAutomationRuleInput,
  ListMarketingAutomationRulesInput,
  UpdateMarketingAutomationRuleInput,
  TestMarketingAutomationRuleInput,
  CreateAutomationMessageTemplateInput,
  UpdateAutomationMessageTemplateInput,
  ListAutomationMessageTemplatesInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { ChannelRegistryService } from './channels/channel-registry.service';
import type { AutomationChannel } from './channels/channel-provider.interface';
import { SuppressionService } from './suppression.service';
import { renderAutomationBody, type AutomationOrderContext } from './render-template';

type Drizzle = PostgresJsDatabase<typeof schema>;

/** Payload passed by lifecycle hooks when an event fires. */
export interface AutomationEventPayload {
  event: MarketingAutomationEvent;
  orderId?: string | null;
  /** Present for cart:abandoned (no order yet). */
  cartId?: string | null;
  customerPhoneHash?: string | null;
  /** New status for order:status_changed / order:confirmed / order:delivered. */
  newStatus?: string | null;
  branchId?: string | null;
  groupId?: string | null;
}

const MAX_JOB_ATTEMPTS = 3;
const POLLER_BATCH = 200;

/**
 * Marketing automation engine.
 *
 * EVENT rules: `onEvent()` is called fire-and-forget from NON-FROZEN lifecycle
 * points (order status transitions + the cart-abandonment cron). It matches
 * enabled rules and enqueues one `automation_jobs` row per (rule × channel),
 * due now or after `delayMinutes`. `drainDueJobs()` (a poller cron) renders the
 * template, checks suppression, sends via the channel provider, and records the
 * outcome on the job. SEGMENT rules broadcast on their `scheduleCron` (or on
 * demand via `runNow`). The frozen edge-form intake path is never touched — a
 * raw "order created" trigger is intentionally unsupported.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly channels: ChannelRegistryService,
    private readonly suppression: SuppressionService,
  ) {}

  /** Which channels are usable right now (have credentials). Drives UI hints. */
  configuredChannels() {
    return this.channels.configuredChannels();
  }

  // ── Rule CRUD ──────────────────────────────────────────────

  async list(input: ListMarketingAutomationRulesInput, activeGroupId: string | null) {
    const conditions = [isNull(schema.automationRules.validTo)];
    if (activeGroupId) {
      conditions.push(
        or(
          eq(schema.automationRules.groupId, activeGroupId),
          isNull(schema.automationRules.groupId),
        )!,
      );
    }
    if (input?.kind) conditions.push(eq(schema.automationRules.kind, input.kind));
    if (input?.enabledOnly) conditions.push(eq(schema.automationRules.enabled, true));

    return this.db
      .select()
      .from(schema.automationRules)
      .where(and(...conditions))
      .orderBy(desc(schema.automationRules.priority), desc(schema.automationRules.createdAt))
      .limit(200);
  }

  private assertChannelsConfigured(channels: string[]) {
    const unconfigured = channels.filter(
      (c) => !this.channels.get(c as AutomationChannel).isConfigured(),
    );
    if (unconfigured.length > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `These channels are not configured yet, so the rule could never send on them: ${unconfigured.join(', ')}. Configure them first or remove them.`,
      });
    }
  }

  async create(
    input: CreateMarketingAutomationRuleInput,
    actor: SessionUser,
    activeGroupId: string | null,
  ) {
    this.assertChannelsConfigured(input.channels);
    // A rule can only be created already-enabled if it can send + target.
    // Otherwise it must be saved as a disabled draft first.
    if (input.enabled) {
      this.assertEnableable({ kind: input.kind, templateId: input.templateId ?? null, trigger: input.trigger ?? {} });
    }

    return withActor(this.db, { id: actor.id }, async (tx) => {
      const rows = await tx
        .insert(schema.automationRules)
        .values({
          groupId: activeGroupId ?? null,
          name: input.name,
          kind: input.kind,
          channels: input.channels,
          templateId: input.templateId ?? null,
          trigger: input.trigger ?? {},
          conditions: input.conditions ?? null,
          delayMinutes: input.delayMinutes ?? null,
          scheduleCron: input.scheduleCron ?? null,
          respectOptOut: input.respectOptOut,
          priority: input.priority,
          enabled: input.enabled,
          sourceBranchId: input.sourceBranchId ?? null,
        })
        .returning();
      const created = rows[0];
      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create automation rule' });
      }
      return created;
    });
  }

  private async requireRule(ruleId: string, activeGroupId: string | null) {
    const [rule] = await this.db
      .select()
      .from(schema.automationRules)
      .where(and(eq(schema.automationRules.id, ruleId), isNull(schema.automationRules.validTo)))
      .limit(1);
    if (!rule) throw new TRPCError({ code: 'NOT_FOUND', message: 'Automation rule not found' });
    // Company isolation: a scoped user may only touch their company's (or org-wide) rules.
    if (activeGroupId && rule.groupId && rule.groupId !== activeGroupId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Rule belongs to another company.' });
    }
    return rule;
  }

  async update(
    input: UpdateMarketingAutomationRuleInput,
    actor: SessionUser,
    activeGroupId: string | null,
  ) {
    const existing = await this.requireRule(input.ruleId, activeGroupId);
    if (input.channels) this.assertChannelsConfigured(input.channels);

    // If the rule will be enabled after this patch, it must be sendable + targeted.
    // Merge the patch over the existing row to evaluate the resulting state.
    const willBeEnabled = input.enabled ?? existing.enabled;
    if (willBeEnabled) {
      this.assertEnableable({
        kind: existing.kind,
        templateId: input.templateId !== undefined ? input.templateId : existing.templateId,
        trigger: input.trigger !== undefined ? input.trigger : existing.trigger,
      });
    }

    return withActor(this.db, { id: actor.id }, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) set['name'] = input.name;
      if (input.channels !== undefined) set['channels'] = input.channels;
      if (input.templateId !== undefined) set['templateId'] = input.templateId;
      if (input.trigger !== undefined) set['trigger'] = input.trigger;
      if (input.conditions !== undefined) set['conditions'] = input.conditions;
      if (input.delayMinutes !== undefined) set['delayMinutes'] = input.delayMinutes;
      if (input.scheduleCron !== undefined) set['scheduleCron'] = input.scheduleCron;
      if (input.respectOptOut !== undefined) set['respectOptOut'] = input.respectOptOut;
      if (input.priority !== undefined) set['priority'] = input.priority;
      if (input.enabled !== undefined) set['enabled'] = input.enabled;
      if (input.sourceBranchId !== undefined) set['sourceBranchId'] = input.sourceBranchId;

      const rows = await tx
        .update(schema.automationRules)
        .set(set)
        .where(eq(schema.automationRules.id, input.ruleId))
        .returning();
      return rows[0]!;
    });
  }

  async setEnabled(ruleId: string, enabled: boolean, actor: SessionUser, activeGroupId: string | null) {
    const rule = await this.requireRule(ruleId, activeGroupId);
    // Enabling requires a sendable, targeted rule; disabling is always allowed.
    if (enabled) {
      this.assertEnableable({ kind: rule.kind, templateId: rule.templateId, trigger: rule.trigger });
    }
    return withActor(this.db, { id: actor.id }, async (tx) => {
      const rows = await tx
        .update(schema.automationRules)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(schema.automationRules.id, ruleId))
        .returning();
      return rows[0]!;
    });
  }

  /** Soft-delete: close the temporal window so it drops out of every list/match. */
  async remove(ruleId: string, actor: SessionUser, activeGroupId: string | null) {
    await this.requireRule(ruleId, activeGroupId);
    await withActor(this.db, { id: actor.id }, async (tx) => {
      await tx
        .update(schema.automationRules)
        .set({ validTo: new Date(), updatedAt: new Date() })
        .where(eq(schema.automationRules.id, ruleId));
      // Cancel any of its still-pending jobs so nothing sends after deletion.
      await tx
        .update(schema.automationJobs)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(and(eq(schema.automationJobs.ruleId, ruleId), eq(schema.automationJobs.status, 'PENDING')));
    });
    return { deleted: true };
  }

  /** Fetch a single rule (company-scoped). Used by the edit/detail surfaces. */
  async getById(ruleId: string, activeGroupId: string | null) {
    return this.requireRule(ruleId, activeGroupId);
  }

  /**
   * A rule can be saved as a disabled DRAFT with no template/audience, but it can
   * only be ENABLED once it can actually send and target: it needs a message
   * template, and a SEGMENT rule needs a non-empty audience. Throws otherwise so
   * a live rule is never a silent no-op.
   */
  private assertEnableable(rule: {
    kind: string;
    templateId: string | null;
    trigger: unknown;
  }) {
    if (!rule.templateId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Add a message template before enabling this rule, otherwise it has nothing to send.',
      });
    }
    if (rule.kind === 'SEGMENT') {
      const parsed = automationTriggerSchema.safeParse(rule.trigger ?? {});
      const seg = parsed.success ? parsed.data.segment : undefined;
      const hasAudience =
        !!seg &&
        (!!seg.targetGroupId ||
          (seg.statuses?.length ?? 0) > 0 ||
          (seg.branchIds?.length ?? 0) > 0 ||
          seg.sinceDays != null);
      if (!hasAudience) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Choose a target group or define an audience (status, branch, or recency) before enabling this broadcast, otherwise it reaches no one.',
        });
      }
    }
  }

  // ── Automation message templates (own table) ────────────────

  async listTemplates(
    input: ListAutomationMessageTemplatesInput,
    activeGroupId: string | null,
  ) {
    const conditions = [isNull(schema.automationMessageTemplates.validTo)];
    if (activeGroupId) {
      conditions.push(
        or(
          eq(schema.automationMessageTemplates.groupId, activeGroupId),
          isNull(schema.automationMessageTemplates.groupId),
        )!,
      );
    }
    // Channel filter: match templates that INCLUDE the requested channel (array contains).
    if (input?.channel) {
      conditions.push(sql`${schema.automationMessageTemplates.channels} @> ARRAY[${input.channel}]::text[]`);
    }
    if (!input?.includeArchived) {
      conditions.push(eq(schema.automationMessageTemplates.status, 'ACTIVE'));
    }
    return this.db
      .select()
      .from(schema.automationMessageTemplates)
      .where(and(...conditions))
      .orderBy(desc(schema.automationMessageTemplates.createdAt))
      .limit(200);
  }

  async createTemplate(
    input: CreateAutomationMessageTemplateInput,
    actor: SessionUser,
    activeGroupId: string | null,
  ) {
    return withActor(this.db, { id: actor.id }, async (tx) => {
      const rows = await tx
        .insert(schema.automationMessageTemplates)
        .values({
          groupId: activeGroupId ?? null,
          name: input.name,
          channels: input.channels,
          // Subject only meaningful when the template can send email.
          subject: input.channels.includes('EMAIL') ? (input.subject ?? null) : null,
          body: input.body,
        })
        .returning();
      const created = rows[0];
      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create template' });
      }
      return created;
    });
  }

  private async requireTemplate(templateId: string, activeGroupId: string | null) {
    const [tpl] = await this.db
      .select()
      .from(schema.automationMessageTemplates)
      .where(
        and(
          eq(schema.automationMessageTemplates.id, templateId),
          isNull(schema.automationMessageTemplates.validTo),
        ),
      )
      .limit(1);
    if (!tpl) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
    if (activeGroupId && tpl.groupId && tpl.groupId !== activeGroupId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Template belongs to another company.' });
    }
    return tpl;
  }

  async updateTemplate(
    input: UpdateAutomationMessageTemplateInput,
    actor: SessionUser,
    activeGroupId: string | null,
  ) {
    const existing = await this.requireTemplate(input.templateId, activeGroupId);
    const nextChannels = input.channels ?? existing.channels ?? [];
    const includesEmail = nextChannels.includes('EMAIL');
    return withActor(this.db, { id: actor.id }, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) set['name'] = input.name;
      if (input.channels !== undefined) set['channels'] = input.channels;
      if (input.body !== undefined) set['body'] = input.body;
      // Subject only applies when Email is among the channels; clear it otherwise.
      if (input.subject !== undefined || input.channels !== undefined) {
        set['subject'] = includesEmail ? (input.subject ?? existing.subject ?? null) : null;
      }
      const rows = await tx
        .update(schema.automationMessageTemplates)
        .set(set)
        .where(eq(schema.automationMessageTemplates.id, input.templateId))
        .returning();
      return rows[0]!;
    });
  }

  async archiveTemplate(templateId: string, actor: SessionUser, activeGroupId: string | null) {
    await this.requireTemplate(templateId, activeGroupId);
    return withActor(this.db, { id: actor.id }, async (tx) => {
      const rows = await tx
        .update(schema.automationMessageTemplates)
        .set({ status: 'ARCHIVED', updatedAt: new Date() })
        .where(eq(schema.automationMessageTemplates.id, templateId))
        .returning();
      return rows[0]!;
    });
  }

  // ── EVENT engine: match rules → enqueue jobs ────────────────

  /**
   * Fire-and-forget entry point called from lifecycle hooks. Never throws to the
   * caller (marketing must never break an order flow). Matches enabled EVENT
   * rules for this event and enqueues a job per (rule × channel).
   */
  onEvent(payload: AutomationEventPayload): void {
    void this.matchAndEnqueue(payload).catch((err) =>
      this.logger.warn(
        `automation.onEvent(${payload.event}) failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  private async matchAndEnqueue(payload: AutomationEventPayload): Promise<void> {
    const rules = await this.db
      .select()
      .from(schema.automationRules)
      .where(
        and(
          isNull(schema.automationRules.validTo),
          eq(schema.automationRules.enabled, true),
          eq(schema.automationRules.kind, 'EVENT'),
          // group scope: rule is org-wide OR matches the event's company.
          payload.groupId
            ? or(isNull(schema.automationRules.groupId), eq(schema.automationRules.groupId, payload.groupId))!
            : sql`true`,
        ),
      );

    const now = Date.now();
    for (const rule of rules) {
      const trigger = this.parseTrigger(rule.trigger);
      if (!trigger || trigger.event !== payload.event) continue;
      // status_changed rules may narrow to a specific target status.
      if (
        payload.event === 'order:status_changed' &&
        trigger.toStatus &&
        trigger.toStatus !== payload.newStatus
      ) {
        continue;
      }
      // Branch scope filter.
      if (rule.sourceBranchId && payload.branchId && rule.sourceBranchId !== payload.branchId) {
        continue;
      }

      const scheduledAt = new Date(now + (rule.delayMinutes ?? 0) * 60_000);
      const channels = (rule.channels?.length ? rule.channels : rule.channel ? [rule.channel] : []) as string[];
      if (channels.length === 0) continue;

      await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
        for (const channel of channels) {
          await tx.insert(schema.automationJobs).values({
            ruleId: rule.id,
            customerPhoneHash: payload.customerPhoneHash ?? '',
            orderId: payload.orderId ?? null,
            channel: channel as AutomationChannel,
            scheduledAt,
            status: 'PENDING',
          });
        }
      });
    }
  }

  private parseTrigger(raw: unknown): AutomationTrigger | null {
    const parsed = automationTriggerSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : null;
  }

  // ── Job poller: drain due jobs → render → send → log ────────

  /** Every minute: send all jobs whose scheduled_at has passed. */
  @Cron('15 * * * * *')
  async pollJobs(): Promise<void> {
    try {
      await this.drainDueJobs();
    } catch (err) {
      this.logger.warn(`automation job poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async drainDueJobs(): Promise<{ processed: number; sent: number }> {
    const due = await this.db
      .select()
      .from(schema.automationJobs)
      .where(
        and(
          eq(schema.automationJobs.status, 'PENDING'),
          lte(schema.automationJobs.scheduledAt, new Date()),
          isNull(schema.automationJobs.validTo),
        ),
      )
      .orderBy(schema.automationJobs.scheduledAt)
      .limit(POLLER_BATCH);

    let sent = 0;
    for (const job of due) {
      const ok = await this.processJob(job).catch((err) => {
        this.logger.warn(`automation job ${job.id} threw: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      });
      if (ok) sent += 1;
    }
    return { processed: due.length, sent };
  }

  private async processJob(job: typeof schema.automationJobs.$inferSelect): Promise<boolean> {
    const [rule] = await this.db
      .select()
      .from(schema.automationRules)
      .where(eq(schema.automationRules.id, job.ruleId))
      .limit(1);

    // Rule gone/disabled between enqueue and send → skip cleanly.
    if (!rule || rule.validTo || !rule.enabled) {
      await this.finishJob(job.id, 'SKIPPED', null, 'Rule disabled or removed before send.');
      return false;
    }

    const channel = job.channel as AutomationChannel;
    const provider = this.channels.get(channel);
    if (!provider.isConfigured()) {
      await this.finishJob(job.id, 'SKIPPED', null, `${channel} channel not configured.`);
      return false;
    }

    // Resolve recipient + placeholder context from the order (raw phone/email
    // stays server-side; never surfaced to a viewer — Pillar 2).
    const ctx = await this.resolveContext(job.orderId);
    // Order-less jobs (Target Group members) carry their email directly on the job.
    const to = channel === 'EMAIL' ? (ctx.email ?? job.recipientEmail) : ctx.phone;
    if (!to) {
      await this.finishJob(job.id, 'SKIPPED', null, `No ${channel === 'EMAIL' ? 'email' : 'phone'} on record.`);
      return false;
    }

    // Suppression / opt-out.
    if (rule.respectOptOut) {
      const suppressed = await this.suppression.isSuppressed({
        channel,
        phoneHash: job.customerPhoneHash || null,
        email: ctx.email ?? job.recipientEmail,
      });
      if (suppressed) {
        await this.finishJob(job.id, 'SKIPPED', null, 'Recipient is on the opt-out list.');
        return false;
      }
    }

    const rendered = await this.renderTemplate(rule.templateId, ctx.order);
    if (!rendered) {
      await this.finishJob(job.id, 'SKIPPED', null, 'Rule has no message template.');
      return false;
    }

    const result = await provider.send({
      to,
      // Email uses the template's subject; fall back to the rule name when absent.
      subject: rendered.subject ?? rule.name,
      body: rendered.body,
    });

    if (result.success) {
      const outboundMessageId = await this.logOutbound(job, channel, rendered.body);
      await this.finishJob(job.id, 'SENT', outboundMessageId, null);
      return true;
    }

    // Retry with backoff up to MAX_JOB_ATTEMPTS, else FAILED.
    const attempts = job.attempts + 1;
    if (attempts < MAX_JOB_ATTEMPTS) {
      await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
        await tx
          .update(schema.automationJobs)
          .set({
            attempts,
            scheduledAt: new Date(Date.now() + attempts * 5 * 60_000),
            errorMessage: result.error ?? 'send failed',
            updatedAt: new Date(),
          })
          .where(eq(schema.automationJobs.id, job.id));
      });
    } else {
      await this.finishJob(job.id, 'FAILED', null, result.error ?? 'send failed', attempts);
    }
    return false;
  }

  private async finishJob(
    jobId: string,
    status: 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELLED',
    outboundMessageId: string | null,
    errorMessage: string | null,
    attempts?: number,
  ): Promise<void> {
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx
        .update(schema.automationJobs)
        .set({
          status,
          sentAt: status === 'SENT' ? new Date() : null,
          outboundMessageId,
          errorMessage,
          ...(attempts != null ? { attempts } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.automationJobs.id, jobId));
    });
  }

  /**
   * Log to outbound_messages ONLY when the send is tied to a real order (that
   * table requires order_id + agent_id). Segment broadcasts with no order are
   * recorded on the job row itself (status/sentAt) and skip this table.
   */
  private async logOutbound(
    job: typeof schema.automationJobs.$inferSelect,
    channel: AutomationChannel,
    body: string,
  ): Promise<string | null> {
    if (!job.orderId) return null;
    const messageChannel = channel === 'EMAIL' ? 'SMS' : channel; // outbound_messages has no EMAIL; log non-email as-is
    if (channel === 'EMAIL') return null; // email automation sends are tracked on the job, not the CS message log
    try {
      const rows = await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) =>
        tx
          .insert(schema.outboundMessages)
          .values({
            orderId: job.orderId!,
            agentId: SYSTEM_ACTOR_ID,
            channel: messageChannel as 'SMS' | 'WHATSAPP',
            renderedBody: body,
            status: 'SENT',
          })
          .returning({ id: schema.outboundMessages.id }),
      );
      return rows[0]?.id ?? null;
    } catch (err) {
      this.logger.warn(`logOutbound failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Resolve raw email/phone + placeholder context from an order (server-side only). */
  private async resolveContext(orderId: string | null): Promise<{
    email: string | null;
    phone: string | null;
    order: AutomationOrderContext | null;
  }> {
    if (!orderId) return { email: null, phone: null, order: null };
    const [row] = await this.db
      .select({
        id: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        customerName: schema.orders.customerName,
        customerPhone: schema.orders.customerPhone,
        customerEmail: schema.orders.customerEmail,
        deliveryAddress: schema.orders.deliveryAddress,
        totalAmount: schema.orders.totalAmount,
        paymentStatus: schema.orders.paymentStatus,
        preferredDeliveryDate: schema.orders.preferredDeliveryDate,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    if (!row) return { email: null, phone: null, order: null };
    return {
      email: row.customerEmail ?? null,
      phone: row.customerPhone ?? null,
      order: {
        id: row.id,
        orderNumber: row.orderNumber,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        deliveryAddress: row.deliveryAddress,
        totalAmount: row.totalAmount,
        paymentStatus: row.paymentStatus,
        preferredDeliveryDate: row.preferredDeliveryDate,
      },
    };
  }

  /**
   * Render a rule's message content from the automation template table. Returns
   * both the rendered body and the (email) subject; null when there is no template
   * or it no longer exists. Placeholders are substituted from the order context.
   */
  private async renderTemplate(
    templateId: string | null,
    order: AutomationOrderContext | null,
  ): Promise<{ body: string; subject: string | null } | null> {
    if (!templateId) return null;
    const [tpl] = await this.db
      .select({ body: schema.automationMessageTemplates.body, subject: schema.automationMessageTemplates.subject })
      .from(schema.automationMessageTemplates)
      .where(eq(schema.automationMessageTemplates.id, templateId))
      .limit(1);
    if (!tpl) return null;
    return {
      body: order ? renderAutomationBody(tpl.body, order) : tpl.body,
      subject: tpl.subject ?? null,
    };
  }

  // ── SEGMENT broadcasts: scheduled + on-demand ───────────────

  /** Every 5 minutes: fire SEGMENT rules whose cron matches this minute. */
  @Cron('30 */5 * * * *')
  async pollSegments(): Promise<void> {
    try {
      const rules = await this.db
        .select()
        .from(schema.automationRules)
        .where(
          and(
            isNull(schema.automationRules.validTo),
            eq(schema.automationRules.enabled, true),
            eq(schema.automationRules.kind, 'SEGMENT'),
          ),
        );
      for (const rule of rules) {
        if (!rule.scheduleCron) continue; // manual-only
        if (!this.cronMatchesNow(rule.scheduleCron)) continue;
        await this.enqueueSegment(rule).catch((err) =>
          this.logger.warn(`segment ${rule.id} enqueue failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    } catch (err) {
      this.logger.warn(`segment poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** On-demand run of a SEGMENT (or re-fire an EVENT template) via the UI. */
  async runNow(ruleId: string, activeGroupId: string | null): Promise<{ enqueued: number }> {
    const rule = await this.requireRule(ruleId, activeGroupId);
    if (rule.kind !== 'SEGMENT') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Run now applies to SEGMENT broadcasts only.' });
    }
    return this.enqueueSegment(rule);
  }

  private async enqueueSegment(rule: typeof schema.automationRules.$inferSelect): Promise<{ enqueued: number }> {
    const trigger = this.parseTrigger(rule.trigger);
    const seg = trigger?.segment ?? {};

    // Target Group audience — resolve members from the materialized membership
    // table. Members may have no order, so we carry their email on the job and
    // send email-only (raw phone isn't stored for order-less members).
    if (seg.targetGroupId) {
      return this.enqueueForTargetGroup(rule, seg.targetGroupId);
    }

    const where = [] as ReturnType<typeof eq>[];
    if (seg.statuses?.length) {
      where.push(inArray(schema.orders.status, seg.statuses as (typeof schema.orders.status.enumValues)[number][]));
    }
    if (seg.branchIds?.length) {
      where.push(inArray(schema.orders.branchId, seg.branchIds));
    } else if (rule.sourceBranchId) {
      where.push(eq(schema.orders.branchId, rule.sourceBranchId));
    }
    if (seg.sinceDays) {
      where.push(
        sql`${schema.orders.createdAt} >= now() - (${seg.sinceDays} || ' days')::interval` as unknown as ReturnType<typeof eq>,
      );
    }

    const audience = await this.db
      .select({
        id: schema.orders.id,
        phoneHash: schema.orders.customerPhoneHash,
      })
      .from(schema.orders)
      .where(where.length ? and(...where) : sql`false`) // never broadcast to ALL orders unintentionally
      .limit(5000);

    const channels = (rule.channels?.length ? rule.channels : rule.channel ? [rule.channel] : []) as string[];
    if (channels.length === 0 || audience.length === 0) return { enqueued: 0 };

    let enqueued = 0;
    const now = new Date();
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      for (const o of audience) {
        for (const channel of channels) {
          await tx.insert(schema.automationJobs).values({
            ruleId: rule.id,
            customerPhoneHash: o.phoneHash,
            orderId: o.id,
            channel: channel as AutomationChannel,
            scheduledAt: now,
            status: 'PENDING',
          });
          enqueued += 1;
        }
      }
    });
    return { enqueued };
  }

  /**
   * Enqueue jobs for a Target Group's members. Members are keyed by phone hash and
   * carry a denormalized email; since they may have no order, we send EMAIL only
   * (raw phone isn't stored for order-less members — Lead Fortress). Members
   * without an email are skipped. The email is stamped on the job's recipientEmail.
   */
  private async enqueueForTargetGroup(
    rule: typeof schema.automationRules.$inferSelect,
    targetGroupId: string,
  ): Promise<{ enqueued: number }> {
    // COMPANY ISOLATION: the group must belong to the rule's company (or be
    // org-wide). Without this check a rule could point at another company's group
    // id and broadcast to their members — a cross-company data leak.
    const [group] = await this.db
      .select({ id: schema.targetGroups.id, groupId: schema.targetGroups.groupId })
      .from(schema.targetGroups)
      .where(and(eq(schema.targetGroups.id, targetGroupId), isNull(schema.targetGroups.validTo)))
      .limit(1);
    if (!group) return { enqueued: 0 };
    if (rule.groupId && group.groupId && group.groupId !== rule.groupId) {
      this.logger.warn(
        `rule ${rule.id} (company ${rule.groupId}) referenced target group ${targetGroupId} of company ${group.groupId} — skipped for isolation`,
      );
      return { enqueued: 0 };
    }

    const members = await this.db
      .select({
        phoneHash: schema.targetGroupMembers.customerPhoneHash,
        email: schema.targetGroupMembers.customerEmail,
      })
      .from(schema.targetGroupMembers)
      .where(
        and(
          eq(schema.targetGroupMembers.targetGroupId, targetGroupId),
          isNull(schema.targetGroupMembers.validTo),
        ),
      )
      .limit(5000);

    // Order-less members are email-only. Filter to those with an email.
    const emailable = members.filter((m) => !!m.email);
    const channels = (rule.channels?.length ? rule.channels : rule.channel ? [rule.channel] : []) as string[];
    // Only EMAIL can reach order-less group members; other channels are skipped here.
    const emailChannels = channels.filter((c) => c === 'EMAIL');
    if (emailChannels.length === 0 || emailable.length === 0) return { enqueued: 0 };

    let enqueued = 0;
    const now = new Date();
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      for (const m of emailable) {
        await tx.insert(schema.automationJobs).values({
          ruleId: rule.id,
          customerPhoneHash: m.phoneHash,
          orderId: null,
          channel: 'EMAIL' as AutomationChannel,
          recipientEmail: m.email,
          scheduledAt: now,
          status: 'PENDING',
        });
        enqueued += 1;
      }
    });
    return { enqueued };
  }

  /**
   * Minimal cron matcher (minute hour dom month dow) for the segment scheduler.
   * Supports wildcard, step (star-slash-n), and comma lists — enough for the
   * rule builder's presets. Evaluated in Africa/Lagos to match payroll/cron.
   */
  private cronMatchesNow(cron: string): boolean {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const now = new Date();
    const lagos = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => lagos.find((p) => p.type === t)?.value ?? '';
    const minute = Number(get('minute'));
    const hour = Number(get('hour'));
    const dom = Number(get('day'));
    const month = Number(get('month'));
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = dowMap[get('weekday')] ?? 0;

    const fieldMatches = (field: string, value: number): boolean => {
      if (field === '*') return true;
      for (const token of field.split(',')) {
        if (token.startsWith('*/')) {
          const step = Number(token.slice(2));
          if (step > 0 && value % step === 0) return true;
        } else if (Number(token) === value) {
          return true;
        }
      }
      return false;
    };

    return (
      fieldMatches(parts[0]!, minute) &&
      fieldMatches(parts[1]!, hour) &&
      fieldMatches(parts[2]!, dom) &&
      fieldMatches(parts[3]!, month) &&
      fieldMatches(parts[4]!, dow)
    );
  }

  // ── Test send (UI "send test") ──────────────────────────────

  async testSend(input: TestMarketingAutomationRuleInput, activeGroupId: string | null) {
    const rule = await this.requireRule(input.ruleId, activeGroupId);
    const provider = this.channels.get(input.channel);
    if (!provider.isConfigured()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `${input.channel} channel is not configured.` });
    }
    const ctx = input.sampleOrderId ? await this.resolveContext(input.sampleOrderId) : { order: null };
    const rendered = await this.renderTemplate(rule.templateId, ctx.order);
    const body = rendered?.body ?? `Test message from automation rule "${rule.name}".`;
    const subject = `[Test] ${rendered?.subject ?? rule.name}`;
    const result = await provider.send({ to: input.to, subject, body });
    if (!result.success) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: result.error ?? 'Test send failed.' });
    }
    return { success: true, providerMessageId: result.providerMessageId ?? null };
  }

  /** Exposed for later phases + the suppression management UI. */
  get suppressionService() {
    return this.suppression;
  }
}
