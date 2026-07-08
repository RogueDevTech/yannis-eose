import { z } from 'zod';

// ============================================
// Vendor Expense Submission Validators (Phase 4B)
// ============================================

const EXPENSE_SUBMISSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const submitExpenseSchema = z.object({
  vendorName: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000),
  amount: z.coerce.number().positive().multipleOf(0.01),
  receiptUrl: z.string().url().optional(),
  branchId: z.string().uuid().optional(),
});
export type SubmitExpenseInput = z.infer<typeof submitExpenseSchema>;

export const approveExpenseSchema = z.object({
  expenseId: z.string().uuid(),
  glAccountId: z.string().uuid(),
});
export type ApproveExpenseInput = z.infer<typeof approveExpenseSchema>;

export const rejectExpenseSchema = z.object({
  expenseId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});
export type RejectExpenseInput = z.infer<typeof rejectExpenseSchema>;

export const listExpensesSchema = z.object({
  groupId: z.string().uuid().nullish(),
  status: z.enum(EXPENSE_SUBMISSION_STATUSES).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(500).default(50),
});
export type ListExpensesInput = z.infer<typeof listExpensesSchema>;

export const getExpenseSchema = z.object({
  expenseId: z.string().uuid(),
});
export type GetExpenseInput = z.infer<typeof getExpenseSchema>;
