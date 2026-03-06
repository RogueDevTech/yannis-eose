import { z } from 'zod';

// ============================================
// Invoice Validators
// ============================================

export const createInvoiceSchema = z.object({
  orderId: z.string().uuid().optional(),
  recipientInfo: z.object({
    name: z.string().min(1),
    address: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  }),
  lineItems: z.array(
    z.object({
      description: z.string().min(1),
      quantity: z.number().int().min(1),
      unitPrice: z.coerce.number().min(0).multipleOf(0.01),
    }),
  ).min(1),
  taxRate: z.coerce.number().min(0).max(1).multipleOf(0.0001).optional(),
  dueDate: z.string().date().optional(),
  notes: z.string().max(500).optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceStatusSchema = z.object({
  invoiceId: z.string().uuid(),
  status: z.enum(['SENT', 'PAID', 'OVERDUE', 'CANCELLED']),
});
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusSchema>;

export const listInvoicesSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListInvoicesInput = z.infer<typeof listInvoicesSchema>;

// ============================================
// Approval Request Validators
// ============================================

export const createApprovalRequestSchema = z.object({
  type: z.enum(['MEDIA_SPEND', 'PROCUREMENT', 'LOGISTICS_REIMBURSEMENT', 'AD_HOC']),
  amount: z.coerce.number().min(0).multipleOf(0.01),
  description: z.string().min(5),
  budgetId: z.string().uuid().optional(),
});
export type CreateApprovalRequestInput = z.infer<typeof createApprovalRequestSchema>;

export const processApprovalSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['APPROVED', 'REJECTED', 'QUERIED']),
  reason: z.string().min(5),
});
export type ProcessApprovalInput = z.infer<typeof processApprovalSchema>;

export const listApprovalRequestsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'QUERIED']).optional(),
  approverId: z.string().uuid().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});
export type ListApprovalRequestsInput = z.infer<typeof listApprovalRequestsSchema>;

// ============================================
// Budget Validators
// ============================================

export const setBudgetSchema = z.object({
  name: z.string().min(1),
  departmentOrCampaign: z.string().min(1),
  totalBudget: z.coerce.number().min(0).multipleOf(0.01),
  periodStart: z.string(),
  periodEnd: z.string(),
});
export type SetBudgetInput = z.infer<typeof setBudgetSchema>;

// ============================================
// Profit Report Validators
// ============================================

export const profitReportSchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  groupBy: z.enum(['product', 'campaign', 'mediaBuyer', 'day', 'week', 'month']).default('product'),
});
export type ProfitReportInput = z.infer<typeof profitReportSchema>;
