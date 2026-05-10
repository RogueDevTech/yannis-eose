import { z } from 'zod';

export const csRoutingStrategySchema = z.enum(['WEIGHTED', 'EQUAL']);

export const csRoutingRuleTargetInputSchema = z.object({
  servicingBranchId: z.string().uuid(),
  teamId: z.string().uuid().nullable().optional(),
  weight: z.number().int().min(1).max(100_000).optional(),
});

export const createCsRoutingRuleSchema = z.object({
  ownerBranchId: z.string().uuid(),
  productId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  strategy: csRoutingStrategySchema.optional(),
  targets: z.array(csRoutingRuleTargetInputSchema).min(1).max(50),
});

export const updateCsRoutingRuleSchema = z.object({
  ruleId: z.string().uuid(),
  productId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  strategy: csRoutingStrategySchema.optional(),
  targets: z.array(csRoutingRuleTargetInputSchema).min(1).max(50).optional(),
});

export const deleteCsRoutingRuleSchema = z.object({
  ruleId: z.string().uuid(),
});

export const listCsRoutingRulesSchema = z.object({
  ownerBranchId: z.string().uuid(),
});

export const csRoutingRelationshipModeSchema = z.enum([
  'BRANCH_DEFAULT',
  'PRODUCT_ALLOCATION',
  'SPLIT_ALL_BRANCHES',
]);

export const getCsRoutingBranchSettingsSchema = z.object({
  ownerBranchId: z.string().uuid(),
});

export const setCsRoutingRelationshipModeSchema = z.object({
  ownerBranchId: z.string().uuid(),
  relationshipMode: csRoutingRelationshipModeSchema,
});

export type CreateCsRoutingRuleInput = z.infer<typeof createCsRoutingRuleSchema>;
export type UpdateCsRoutingRuleInput = z.infer<typeof updateCsRoutingRuleSchema>;
export type CsRoutingRelationshipMode = z.infer<typeof csRoutingRelationshipModeSchema>;
export type SetCsRoutingRelationshipModeInput = z.infer<typeof setCsRoutingRelationshipModeSchema>;
