import {
  createMarketingAutomationRuleSchema,
  listMarketingAutomationRulesSchema,
  updateMarketingAutomationRuleSchema,
  toggleMarketingAutomationRuleSchema,
  automationRuleIdSchema,
  testMarketingAutomationRuleSchema,
  createAutomationMessageTemplateSchema,
  updateAutomationMessageTemplateSchema,
  listAutomationMessageTemplatesSchema,
  automationMessageTemplateIdSchema,
  createTargetGroupSchema,
  updateTargetGroupSchema,
  listTargetGroupsSchema,
  targetGroupIdSchema,
  listTargetGroupMembersSchema,
  importTargetGroupMemberSchema,
} from '@yannis/shared';
import { router, permissionProcedure } from '../trpc';
import type { AutomationService } from '../../automation/automation.service';
import type { TargetGroupService } from '../../automation/target-group.service';

// Module-level singleton wired by TrpcModule.onModuleInit() (see trpc.module.ts).
let automationServiceInstance: AutomationService | null = null;
let targetGroupServiceInstance: TargetGroupService | null = null;

export function setAutomationService(service: AutomationService) {
  automationServiceInstance = service;
}

export function getAutomationService(): AutomationService {
  if (!automationServiceInstance) {
    throw new Error('AutomationService not initialized. Call setAutomationService() first.');
  }
  return automationServiceInstance;
}

export function setTargetGroupService(service: TargetGroupService) {
  targetGroupServiceInstance = service;
}

export function getTargetGroupService(): TargetGroupService {
  if (!targetGroupServiceInstance) {
    throw new Error('TargetGroupService not initialized. Call setTargetGroupService() first.');
  }
  return targetGroupServiceInstance;
}

/**
 * Marketing automation router. All procedures gate on `marketing.automation.manage`
 * (SUPER_ADMIN / SUPPORT bypass; ADMIN via snapshot; HEAD_OF_MARKETING via grant).
 */
export const automationRouter = router({
  /** Channels usable right now (have credentials) — drives the create form's channel hints. */
  configuredChannels: permissionProcedure('marketing.automation.manage').query(async () => {
    return getAutomationService().configuredChannels();
  }),

  list: permissionProcedure('marketing.automation.manage')
    .input(listMarketingAutomationRulesSchema)
    .query(async ({ input, ctx }) => {
      return getAutomationService().list(input, ctx.activeGroupId);
    }),

  /** Fetch a single rule (company-scoped). */
  get: permissionProcedure('marketing.automation.manage')
    .input(automationRuleIdSchema)
    .query(async ({ input, ctx }) => {
      return getAutomationService().getById(input.ruleId, ctx.activeGroupId);
    }),

  create: permissionProcedure('marketing.automation.manage')
    .input(createMarketingAutomationRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getAutomationService().create(input, ctx.user, ctx.activeGroupId);
    }),

  update: permissionProcedure('marketing.automation.manage')
    .input(updateMarketingAutomationRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getAutomationService().update(input, ctx.user, ctx.activeGroupId);
    }),

  toggle: permissionProcedure('marketing.automation.manage')
    .input(toggleMarketingAutomationRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getAutomationService().setEnabled(input.ruleId, input.enabled, ctx.user, ctx.activeGroupId);
    }),

  remove: permissionProcedure('marketing.automation.manage')
    .input(automationRuleIdSchema)
    .mutation(async ({ input, ctx }) => {
      return getAutomationService().remove(input.ruleId, ctx.user, ctx.activeGroupId);
    }),

  /** On-demand fire of a SEGMENT broadcast. */
  runNow: permissionProcedure('marketing.automation.manage')
    .input(automationRuleIdSchema)
    .mutation(async ({ input, ctx }) => {
      return getAutomationService().runNow(input.ruleId, ctx.activeGroupId);
    }),

  /** Send a one-off test message on a chosen channel to a chosen address. */
  testSend: permissionProcedure('marketing.automation.manage')
    .input(testMarketingAutomationRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getAutomationService().testSend(input, ctx.activeGroupId);
    }),

  // ── Message templates (own table; includes EMAIL + subject) ──
  templates: router({
    list: permissionProcedure('marketing.automation.manage')
      .input(listAutomationMessageTemplatesSchema)
      .query(async ({ input, ctx }) => {
        return getAutomationService().listTemplates(input, ctx.activeGroupId);
      }),

    create: permissionProcedure('marketing.automation.manage')
      .input(createAutomationMessageTemplateSchema)
      .mutation(async ({ input, ctx }) => {
        return getAutomationService().createTemplate(input, ctx.user, ctx.activeGroupId);
      }),

    update: permissionProcedure('marketing.automation.manage')
      .input(updateAutomationMessageTemplateSchema)
      .mutation(async ({ input, ctx }) => {
        return getAutomationService().updateTemplate(input, ctx.user, ctx.activeGroupId);
      }),

    archive: permissionProcedure('marketing.automation.manage')
      .input(automationMessageTemplateIdSchema)
      .mutation(async ({ input, ctx }) => {
        return getAutomationService().archiveTemplate(input.templateId, ctx.user, ctx.activeGroupId);
      }),
  }),

  // ── Target Groups (reusable audiences) ──────────────────────
  targetGroups: router({
    list: permissionProcedure('marketing.automation.manage')
      .input(listTargetGroupsSchema)
      .query(async ({ input, ctx }) => {
        return getTargetGroupService().list(input, ctx.activeGroupId);
      }),

    get: permissionProcedure('marketing.automation.manage')
      .input(targetGroupIdSchema)
      .query(async ({ input, ctx }) => {
        return getTargetGroupService().getById(input.groupId, ctx.activeGroupId);
      }),

    members: permissionProcedure('marketing.automation.manage')
      .input(listTargetGroupMembersSchema)
      .query(async ({ input, ctx }) => {
        return getTargetGroupService().listMembers(input, ctx.activeGroupId);
      }),

    create: permissionProcedure('marketing.automation.manage')
      .input(createTargetGroupSchema)
      .mutation(async ({ input, ctx }) => {
        return getTargetGroupService().create(input, ctx.user, ctx.activeGroupId);
      }),

    update: permissionProcedure('marketing.automation.manage')
      .input(updateTargetGroupSchema)
      .mutation(async ({ input, ctx }) => {
        return getTargetGroupService().update(input, ctx.user, ctx.activeGroupId);
      }),

    archive: permissionProcedure('marketing.automation.manage')
      .input(targetGroupIdSchema)
      .mutation(async ({ input, ctx }) => {
        return getTargetGroupService().archive(input.groupId, ctx.user, ctx.activeGroupId);
      }),

    syncNow: permissionProcedure('marketing.automation.manage')
      .input(targetGroupIdSchema)
      .mutation(async ({ input, ctx }) => {
        return getTargetGroupService().syncGroup(input.groupId, ctx.user, ctx.activeGroupId);
      }),

    /** Import one member row (one call per CSV/Excel row). */
    importMember: permissionProcedure('marketing.automation.manage')
      .input(importTargetGroupMemberSchema)
      .mutation(async ({ input, ctx }) => {
        return getTargetGroupService().importMember(input, ctx.user, ctx.activeGroupId);
      }),
  }),
});
