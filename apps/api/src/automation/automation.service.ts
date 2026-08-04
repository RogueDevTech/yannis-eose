import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import type {
  CreateMarketingAutomationRuleInput,
  ListMarketingAutomationRulesInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { ChannelRegistryService } from './channels/channel-registry.service';
import { SuppressionService } from './suppression.service';

type Drizzle = PostgresJsDatabase<typeof schema>;

/**
 * Marketing automation — Phase 1 foundation.
 *
 * Owns the CEO-configured `automation_rules` (event journeys + segment
 * broadcasts). This slice implements rule list/create + the channel registry and
 * suppression check that later phases (job poller, segment sweep) build on.
 */
@Injectable()
export class AutomationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
    private readonly channels: ChannelRegistryService,
    private readonly suppression: SuppressionService,
  ) {}

  /** Which channels are usable right now (have credentials). Drives UI hints. */
  configuredChannels() {
    return this.channels.configuredChannels();
  }

  /**
   * List automation rules for the active company. `activeGroupId` scopes to a
   * company; org-wide global users (null) see every rule.
   */
  async list(input: ListMarketingAutomationRulesInput, activeGroupId: string | null) {
    const conditions = [isNull(schema.automationRules.validTo)];
    if (activeGroupId) {
      // Company rules plus any org-wide (null group) rules.
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

  async create(
    input: CreateMarketingAutomationRuleInput,
    actor: SessionUser,
    activeGroupId: string | null,
  ) {
    // Guard: every selected channel must actually be usable, so the CEO isn't left
    // with a rule that silently never sends on one of its channels. (Email is live;
    // SMS/WhatsApp become selectable once their providers report configured.)
    const unconfigured = input.channels.filter((c) => !this.channels.get(c).isConfigured());
    if (unconfigured.length > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `These channels are not configured yet, so the rule could never send on them: ${unconfigured.join(', ')}. Configure them first or remove them.`,
      });
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

  /** Exposed for later phases + the suppression management UI. */
  get suppressionService() {
    return this.suppression;
  }
}
