import { z } from 'zod';

// ============================================
// Invoice Validators
// ============================================

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
  // Accept ISO datetime alongside `YYYY-MM-DD` so the time-aware DateFilterBar
  // narrows revenue + cost windows to the exact moment the user picked.
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
  groupBy: z.enum(['product', 'campaign', 'mediaBuyer', 'day', 'week', 'month']).default('product'),
  branchId: z.string().uuid().nullish(),
  /**
   * Optional Media Buyer filter — restricts revenue (delivered orders by MB)
   * AND ad spend (logs by MB) to that buyer's slice. Other cost layers
   * (commission, fulfillment, ops) attribute to all delivered orders, so the
   * filter narrows what's "their funnel's" without misallocating shared costs.
   */
  mediaBuyerId: z.string().uuid().nullish(),
  /** When true with `groupBy: 'product'`, returns `byProduct` rows (extra query — avoid on hot paths like CEO dashboard). */
  includeProductBreakdown: z.boolean().optional(),
});
export type ProfitReportInput = z.infer<typeof profitReportSchema>;

/** Per-shipment unit economics — costs in vs revenue out for one inbound shipment. */
export const profitByShipmentSchema = z.object({
  shipmentId: z.string().uuid(),
});
export type ProfitByShipmentInput = z.infer<typeof profitByShipmentSchema>;

/** Delivered-order lines + product ad spend + proportional shared costs (commission, fulfillment, ops). */
export interface ProductProfitBreakdownRow {
  productId: string;
  productName: string;
  revenue: number;
  landedCost: number;
  deliveryFee: number;
  adSpend: number;
  allocatedCommission: number;
  allocatedFulfillment: number;
  allocatedOperationalLoss: number;
  contribution: number;
  marginPct: number;
  /** Distinct delivered orders in range that include this product. */
  orderCount: number;
}
