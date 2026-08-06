import {
  createMarketingAutomationRuleSchema,
  listMarketingAutomationRulesSchema,
  updateMarketingAutomationRuleSchema,
  toggleMarketingAutomationRuleSchema,
  automationRuleIdSchema,
  testMarketingAutomationRuleSchema,
} from '@yannis/shared';
import { router, permissionProcedure } from '../trpc';
import type { AutomationService } from '../../automation/automation.service';

// Module-level singleton wired by TrpcModule.onModuleInit() (see trpc.module.ts).
let automationServiceInstance: AutomationService | null = null;

export function setAutomationService(service: AutomationService) {
  automationServiceInstance = service;
}

export function getAutomationService(): AutomationService {
  if (!automationServiceInstance) {
    throw new Error('AutomationService not initialized. Call setAutomationService() first.');
  }
  return automationServiceInstance;
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
});
