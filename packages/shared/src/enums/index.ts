// ============================================
// Yannis EOSE — Shared Enums
// ============================================

export const ORDER_STATUS = {
  UNPROCESSED: 'UNPROCESSED',
  CS_ASSIGNED: 'CS_ASSIGNED',
  CS_ENGAGED: 'CS_ENGAGED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  // Renamed from ALLOCATED — CEO directive 2026-05-04, migration 0110.
  AGENT_ASSIGNED: 'AGENT_ASSIGNED',
  DISPATCHED: 'DISPATCHED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  PARTIALLY_DELIVERED: 'PARTIALLY_DELIVERED',
  RETURNED: 'RETURNED',
  RESTOCKED: 'RESTOCKED',
  WRITTEN_OFF: 'WRITTEN_OFF',
  // Renamed from COMPLETED — CEO directive 2026-05-04, migration 0110.
  REMITTED: 'REMITTED',
  // Soft-removal: excluded from all metrics but row stays in DB. Migration 0153.
  DELETED: 'DELETED',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const USER_ROLE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  // ADMIN = SuperAdmin-equivalent privileges EXCEPT cannot manage another Admin or the SuperAdmin.
  // Multiple ADMINs can exist; SUPER_ADMIN is a singleton.
  ADMIN: 'ADMIN',
  BRANCH_ADMIN: 'BRANCH_ADMIN',
  HEAD_OF_MARKETING: 'HEAD_OF_MARKETING',
  MEDIA_BUYER: 'MEDIA_BUYER',
  HEAD_OF_CS: 'HEAD_OF_CS',
  CS_CLOSER: 'CS_CLOSER',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
  HEAD_OF_LOGISTICS: 'HEAD_OF_LOGISTICS',
  STOCK_MANAGER: 'STOCK_MANAGER',
  TPL_MANAGER: 'TPL_MANAGER',
  TPL_RIDER: 'TPL_RIDER',
  HR_MANAGER: 'HR_MANAGER',
  SUPPORT: 'SUPPORT',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export const MOVEMENT_TYPE = {
  INTAKE: 'INTAKE',
  RESERVATION: 'RESERVATION',
  ALLOCATION: 'ALLOCATION',
  DISPATCH: 'DISPATCH',
  DELIVERY: 'DELIVERY',
  RETURN: 'RETURN',
  RESTOCK: 'RESTOCK',
  WRITE_OFF: 'WRITE_OFF',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export type MovementType = (typeof MOVEMENT_TYPE)[keyof typeof MOVEMENT_TYPE];

export const TRANSFER_STATUS = {
  PENDING: 'PENDING',
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  DISPUTED: 'DISPUTED',
} as const;

export type TransferStatus = (typeof TRANSFER_STATUS)[keyof typeof TRANSFER_STATUS];

export const FUNDING_STATUS = {
  SENT: 'SENT',
  COMPLETED: 'COMPLETED',
  DISPUTED: 'DISPUTED',
} as const;

export type FundingStatus = (typeof FUNDING_STATUS)[keyof typeof FUNDING_STATUS];

export const INVOICE_STATUS = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const PAYOUT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
} as const;

export type PayoutStatus = (typeof PAYOUT_STATUS)[keyof typeof PAYOUT_STATUS];

export const ADJUSTMENT_CATEGORY = {
  BONUS: 'BONUS',
  EXTRA_SHIFT: 'EXTRA_SHIFT',
  PERFORMANCE: 'PERFORMANCE',
  DEDUCTION: 'DEDUCTION',
  CLAWBACK: 'CLAWBACK',
  OTHER: 'OTHER',
} as const;

export type AdjustmentCategory = (typeof ADJUSTMENT_CATEGORY)[keyof typeof ADJUSTMENT_CATEGORY];

export const DEPLOYMENT_TYPE = {
  SNIPPET: 'SNIPPET',
  IFRAME: 'IFRAME',
  HOSTED: 'HOSTED',
} as const;

export type DeploymentType = (typeof DEPLOYMENT_TYPE)[keyof typeof DEPLOYMENT_TYPE];

export const STOCK_STATE = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  ALLOCATED_TO_3PL: 'ALLOCATED_TO_3PL',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURNED',
  WRITTEN_OFF: 'WRITTEN_OFF',
} as const;

export type StockState = (typeof STOCK_STATE)[keyof typeof STOCK_STATE];
