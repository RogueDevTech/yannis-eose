import { z } from 'zod';

// ============================================
// WHT Deductions Validators (Phase 6B)
// ============================================

export const recordWhtSchema = z.object({
  groupId: z.string().uuid().nullish(),
  vendorName: z.string().trim().min(1).max(200),
  vendorId: z.string().uuid().nullish(),
  paymentDate: z.string().date(),
  grossAmount: z.coerce.number().positive(),
  whtRate: z.coerce.number().min(0).max(100).default(5),
  description: z.string().trim().max(500).optional(),
});
export type RecordWhtInput = z.infer<typeof recordWhtSchema>;

export const listWhtSchema = z.object({
  groupId: z.string().uuid().nullish(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(500).default(50),
});
export type ListWhtInput = z.infer<typeof listWhtSchema>;

export const generateWhtCertificateSchema = z.object({
  deductionId: z.string().uuid(),
});
export type GenerateWhtCertificateInput = z.infer<typeof generateWhtCertificateSchema>;

// ============================================
// Budget vs Actual Validators (Phase 6A)
// ============================================

export const budgetVsActualSchema = z.object({
  groupId: z.string().uuid().nullish(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export type BudgetVsActualInput = z.infer<typeof budgetVsActualSchema>;

export interface BudgetVsActualRow {
  budgetId: string;
  budgetName: string;
  department: string;
  budgetAmount: number;
  actualSpend: number;
  variance: number;
  variancePct: number;
  status: 'under' | 'warning' | 'over';
}

// ============================================
// VAT Return Summary Validators (Phase 6C)
// ============================================

export const vatReturnSummarySchema = z.object({
  groupId: z.string().uuid().nullish(),
  startDate: z.string().date(),
  endDate: z.string().date(),
});
export type VatReturnSummaryInput = z.infer<typeof vatReturnSummarySchema>;

export interface VatReturnSummary {
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  transactions: VatTransaction[];
}

export interface VatTransaction {
  id: string;
  postingDate: string;
  voucherType: string;
  voucherId: string;
  debit: number;
  credit: number;
  remarks: string | null;
}
