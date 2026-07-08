import { z } from 'zod';

// ============================================
// Bank Reconciliation Validators (Phase 6D)
// ============================================

const statementLineSchema = z.object({
  date: z.string().date(),
  description: z.string().trim().max(500),
  amount: z.coerce.number(),
});

export const createReconciliationSchema = z.object({
  groupId: z.string().uuid().nullish(),
  bankAccountId: z.string().uuid(),
  statementDate: z.string().date(),
  statementBalance: z.coerce.number(),
  statementLines: z.array(statementLineSchema).min(1),
});
export type CreateReconciliationInput = z.infer<typeof createReconciliationSchema>;

export const matchLineSchema = z.object({
  lineId: z.string().uuid(),
  glEntryId: z.string().uuid(),
});
export type MatchLineInput = z.infer<typeof matchLineSchema>;

export const unmatchLineSchema = z.object({
  lineId: z.string().uuid(),
});
export type UnmatchLineInput = z.infer<typeof unmatchLineSchema>;

export const completeReconciliationSchema = z.object({
  reconciliationId: z.string().uuid(),
});
export type CompleteReconciliationInput = z.infer<typeof completeReconciliationSchema>;

export const listReconciliationsSchema = z.object({
  groupId: z.string().uuid().nullish(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
});
export type ListReconciliationsInput = z.infer<typeof listReconciliationsSchema>;

export const getReconciliationSchema = z.object({
  reconciliationId: z.string().uuid(),
});
export type GetReconciliationInput = z.infer<typeof getReconciliationSchema>;
