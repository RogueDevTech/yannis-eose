import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import type { AiAssistantService } from '../../ai-assistant/ai-assistant.service';
import type { OrdersService } from '../../orders/orders.service';
import type { FinanceService } from '../../finance/finance.service';
import type { MarketingService } from '../../marketing/marketing.service';
import type { InventoryService } from '../../inventory/inventory.service';
import type { LogisticsService } from '../../logistics/logistics.service';
import type { UsersService } from '../../users/users.service';
import type { ProductsService } from '../../products/products.service';
import type { ToolExecutorServices } from '../../ai-assistant/ai-tool-executor';

// ─── Service Singletons ──────────────────────────────────────────────

let aiAssistantServiceInstance: AiAssistantService | null = null;
let toolServices: ToolExecutorServices | null = null;

export function setAiAssistantService(service: AiAssistantService) {
  aiAssistantServiceInstance = service;
}

export function setAiAssistantToolServices(services: {
  ordersService: OrdersService;
  financeService: FinanceService;
  marketingService: MarketingService;
  inventoryService: InventoryService;
  logisticsService: LogisticsService;
  usersService: UsersService;
  productsService: ProductsService;
}) {
  toolServices = services;
}

function getAiAssistantService(): AiAssistantService {
  if (!aiAssistantServiceInstance) {
    throw new Error('AiAssistantService not initialized. Call setAiAssistantService() first.');
  }
  return aiAssistantServiceInstance;
}

function getToolServices(): ToolExecutorServices {
  if (!toolServices) {
    throw new Error('AI tool services not initialized. Call setAiAssistantToolServices() first.');
  }
  return toolServices;
}

// ─── Router ──────────────────────────────────────────────────────────

export const aiAssistantRouter = router({
  // ── Chat ─────────────────────────────────────────────

  sendMessage: permissionProcedure('ai.assistant.access')
    .input(
      z.object({
        sessionId: z.string().uuid().optional(),
        message: z.string().min(1).max(4000),
        model: z.string().optional(),
        currentPage: z.string().optional(),
        currentFilters: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await getAiAssistantService().sendMessage({
        sessionId: input.sessionId,
        userId: ctx.user.id,
        userMessage: input.message,
        model: input.model,
        currentPage: input.currentPage,
        currentFilters: input.currentFilters,
        user: {
          id: ctx.user.id,
          role: ctx.user.role,
          permissions: ctx.user.permissions,
        },
        branchId: ctx.currentBranchId ?? null,
        effectiveBranchIds: ctx.effectiveBranchIds ?? null,
        activeGroupId: ctx.activeGroupId ?? null,
        services: getToolServices(),
      });
      return result;
    }),

  // ── Sessions ─────────────────────────────────────────

  listSessions: permissionProcedure('ai.assistant.access')
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      }).default({}),
    )
    .query(async ({ input, ctx }) => {
      return getAiAssistantService().listSessions(ctx.user.id, input.limit, input.offset);
    }),

  getSessionMessages: permissionProcedure('ai.assistant.access')
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getAiAssistantService().getSessionMessages(input.sessionId, ctx.user.id);
    }),

  deleteSession: permissionProcedure('ai.assistant.access')
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await getAiAssistantService().deleteSession(input.sessionId, ctx.user.id);
      return { success: true };
    }),

  // ── Org API Key (settings.system.manage gate) ────────

  saveOrgApiKey: permissionProcedure('settings.system.manage')
    .input(z.object({ apiKey: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      await getAiAssistantService().saveOrgApiKey(
        input.apiKey,
        ctx.activeGroupId ?? null,
        ctx.user.id,
      );
      return { success: true };
    }),

  deleteOrgApiKey: permissionProcedure('settings.system.manage')
    .mutation(async ({ ctx }) => {
      await getAiAssistantService().deleteOrgApiKey(ctx.activeGroupId ?? null);
      return { success: true };
    }),

  orgApiKeyExists: permissionProcedure('ai.assistant.access')
    .query(async ({ ctx }) => {
      return { exists: await getAiAssistantService().orgApiKeyExists(ctx.activeGroupId ?? null) };
    }),

  // ── Personal API Key ─────────────────────────────────

  savePersonalApiKey: permissionProcedure('ai.assistant.access')
    .input(z.object({ apiKey: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      await getAiAssistantService().savePersonalApiKey(input.apiKey, ctx.user.id);
      return { success: true };
    }),

  deletePersonalApiKey: permissionProcedure('ai.assistant.access')
    .mutation(async ({ ctx }) => {
      await getAiAssistantService().deletePersonalApiKey(ctx.user.id);
      return { success: true };
    }),

  personalApiKeyExists: permissionProcedure('ai.assistant.access')
    .query(async ({ ctx }) => {
      return { exists: await getAiAssistantService().personalApiKeyExists(ctx.user.id) };
    }),
});
